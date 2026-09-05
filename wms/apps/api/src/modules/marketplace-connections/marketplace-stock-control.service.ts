import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';

const PREFIX = 'marketplace.stockControl.client.';

// FIX: an absent setting preserves existing clients; an invalid stored value fails closed.
export function stockControlEnabled(setting: { value: unknown } | null) {
  return setting === null || setting.value === true;
}

@Injectable()
export class MarketplaceStockControlService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService) {}

  async isEnabled(clientId: string) {
    if (!clientId) throw new BadRequestException('Не указан клиент для отправки остатков.');
    return stockControlEnabled(await this.prisma.systemSetting.findUnique({ where: { key: PREFIX + clientId } }));
  }

  // FIX: read the shared database before every outbound batch, without a process-local cache.
  async assertEnabled(clientId: string) {
    if (!await this.isEnabled(clientId)) {
      throw new ForbiddenException('Контроль остатков на МП через WMS отключён для клиента. Остатками управляет отдел продаж. Включить контроль можно в разделе «Администрирование → Контроль остатков на МП».');
    }
  }

  private requireAdmin(user: AuthUser) {
    if (user.isDemo || user.roleCodes.includes('CLIENT') || !user.permissionCodes.includes('system:admin')) {
      throw new ForbiddenException('Контроль остатков на МП доступен только администратору.');
    }
  }

  async list(user: AuthUser) {
    this.requireAdmin(user);
    const clients = await this.prisma.client.findMany({
      where: { id: this.scopes.resolveClientFilter(user) },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    const settings = await this.prisma.systemSetting.findMany({
      where: { key: { in: clients.map((client) => PREFIX + client.id) } },
      include: { updatedBy: { select: { name: true } } },
    });
    const byKey = new Map(settings.map((setting) => [setting.key, setting]));
    return clients.map((client) => {
      const setting = byKey.get(PREFIX + client.id) ?? null;
      return { ...client, enabled: stockControlEnabled(setting), updatedAt: setting?.updatedAt ?? null, updatedBy: setting?.updatedBy?.name ?? null };
    });
  }

  async update(clientId: string, body: { enabled?: unknown; expectedEnabled?: unknown }, user: AuthUser) {
    this.requireAdmin(user);
    this.scopes.requireClientAccess(user, clientId, 'write');
    if (typeof body.enabled !== 'boolean' || typeof body.expectedEnabled !== 'boolean') {
      throw new BadRequestException('Передайте enabled и expectedEnabled как true или false.');
    }
    const enabled = body.enabled;
    const key = PREFIX + clientId;
    // FIX: serialize administrator changes and persist the setting together with its audit record.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const client = await tx.client.findUnique({ where: { id: clientId }, select: { id: true, code: true, name: true } });
      if (!client) throw new NotFoundException('Клиент не найден.');
      const previous = await tx.systemSetting.findUnique({ where: { key } });
      const before = stockControlEnabled(previous);
      if (before !== body.expectedEnabled) throw new ConflictException('Настройку уже изменил другой администратор. Обновите список.');
      const setting = await tx.systemSetting.upsert({
        where: { key },
        create: { key, value: enabled, updatedByUserId: user.id },
        update: { value: enabled, updatedByUserId: user.id },
      });
      await tx.auditLog.create({ data: {
        userId: user.id, action: 'administration.marketplace-stock-control.update', entity: 'Client', entityId: clientId,
        payload: { clientCode: client.code, clientName: client.name, before, after: enabled, scope: 'ALL_BRANCHES_AND_MARKETPLACE_ACCOUNTS' },
      } });
      return { ...client, enabled, updatedAt: setting.updatedAt, updatedBy: user.name };
    });
  }
}
