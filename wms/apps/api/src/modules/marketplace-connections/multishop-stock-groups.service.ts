import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { ShopAssignment, ShopGroup, validateShopGroups } from './multishop-stock-plan';

export type ShopConfiguration = { groups: ShopGroup[]; assignments: ShopAssignment[] };
const keyFor = (clientId: string) => `marketplace.multishop.draft.v1:${clientId}`;

// FIX: settings alone never activate external writes; drafts are versioned and audited.
@Injectable()
export class MultishopStockGroupsService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService) {}

  capabilities() { return { enabled: process.env.WMS_MULTISHOP_STOCK_ENABLED === 'true', publicationEnabled: process.env.WMS_MULTISHOP_PUBLICATION_ENABLED === 'true' }; }

  authorize(clientId: string, user: AuthUser, write = false) {
    if (!this.capabilities().enabled || user.isDemo) throw new ForbiddenException('Группы магазинов недоступны.');
    if (typeof clientId !== 'string' || !clientId.trim()) throw new BadRequestException('Выберите клиента.');
    this.scopes.requireClientAccess(user, clientId, write ? 'write' : 'read');
    // A client-wide configuration may cover multiple branches; branch-local staff cannot replace it.
    if (write && !user.permissionCodes.includes('system:admin') && !user.roleCodes.includes('CLIENT') && (user.warehouseIds?.length ?? 0) > 0) {
      throw new ForbiddenException('Общие группы магазинов настраивает администратор сети или клиент с правом изменения.');
    }
  }

  private connections(db: Prisma.TransactionClient, clientId: string) {
    return db.clientMarketplaceConnection.findMany({ where: { clientId, isActive: true, marketplace: { in: ['WILDBERRIES', 'OZON'] } },
      select: { id: true, accountName: true, marketplace: true, fbsExecutionWarehouseId: true }, orderBy: [{ marketplace: 'asc' }, { id: 'asc' }] });
  }

  async read(clientId: string, user: AuthUser) {
    this.authorize(clientId, user);
    const [saved, connections] = await Promise.all([
      this.prisma.systemSetting.findUnique({ where: { key: keyFor(clientId) } }), this.connections(this.prisma, clientId),
    ]);
    const state = saved?.value as unknown as { revision: string; config: ShopConfiguration } | undefined;
    let invalidReason: string | null = null;
    if (state) {
      try { validateShopGroups(state.config.groups, state.config.assignments, connections.map(c => ({ id: c.id, warehouseId: c.fbsExecutionWarehouseId }))); }
      catch (error) { invalidReason = error instanceof Error ? error.message : 'Проверьте настройки групп.'; }
    }
    return { ...this.capabilities(), revision: state?.revision ?? null, config: state?.config ?? { groups: [], assignments: [] },
      connections, invalidReason, changedAt: saved?.updatedAt.toISOString() ?? null };
  }

  async save(clientId: string, body: { revision: string | null; config: ShopConfiguration }, user: AuthUser) {
    this.authorize(clientId, user, true);
    if (!body || (body.revision !== null && typeof body.revision !== 'string')) throw new BadRequestException('Передайте версию настроек.');
    const key = keyFor(clientId);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const previous = await tx.systemSetting.findUnique({ where: { key } });
      const before = previous?.value as unknown as { revision: string; config: ShopConfiguration } | undefined;
      if ((before?.revision ?? null) !== body.revision) throw new ConflictException('Настройки изменены другим пользователем. Обновите раздел.');
      const connections = await this.connections(tx, clientId);
      try { validateShopGroups(body.config?.groups, body.config?.assignments, connections.map(c => ({ id: c.id, warehouseId: c.fbsExecutionWarehouseId }))); }
      catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Неверные настройки групп.'); }
      const ids = body.config.assignments.map(a => a.skuId);
      if (ids.length) {
        const count = await tx.sku.count({ where: { clientId, id: { in: ids }, isDraft: false } });
        if (count !== ids.length) throw new BadRequestException('Часть товаров недоступна или относится к другому клиенту.');
      }
      // Copy only supported fields; no caller-supplied activation or published state can persist here.
      const config: ShopConfiguration = {
        groups: body.config.groups.map(g => ({ id: g.id, name: g.name, warehouseId: g.warehouseId, lowStockThreshold: g.lowStockThreshold,
          mode: g.mode ?? 'ALLOCATED', safetyReserve: g.safetyReserve ?? 0,
          members: g.members.map(m => ({ connectionId: m.connectionId, percent: m.percent, priority: m.priority, ...(m.marketplaceWarehouseId ? { marketplaceWarehouseId: m.marketplaceWarehouseId } : {}) })) })),
        assignments: body.config.assignments.map(a => ({ skuId: a.skuId, groupId: a.groupId })),
      };
      const value = { revision: randomUUID(), config };
      await tx.systemSetting.upsert({ where: { key }, create: { key, value: value as unknown as Prisma.InputJsonValue, updatedByUserId: user.id },
        update: { value: value as unknown as Prisma.InputJsonValue, updatedByUserId: user.id } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'MULTISHOP_GROUPS_SAVED', entity: 'Client', entityId: clientId,
        payload: { before: previous?.value ?? null, after: value as unknown as Prisma.InputJsonValue } } });
      return { ...value, publicationEnabled: this.capabilities().publicationEnabled };
    });
  }

  async products(clientId: string, query: string, page: number, user: AuthUser) {
    this.authorize(clientId, user);
    const term = typeof query === 'string' ? query.trim().slice(0, 150) : '';
    const current = Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100_000) : 1;
    const where: Prisma.SkuWhereInput = { clientId, isDraft: false, ...(term ? { OR: [
      { name: { contains: term, mode: 'insensitive' } }, { article: { contains: term, mode: 'insensitive' } },
      { barcodes: { some: { value: { contains: term } } } },
    ] } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.sku.findMany({ where, select: { id: true, name: true, article: true, size: true, color: true, barcodes: { select: { value: true } } }, orderBy: { id: 'asc' }, skip: (current - 1) * 50, take: 50 }),
      this.prisma.sku.count({ where }),
    ]);
    return { items, total, page: current, pageSize: 50 };
  }
}
