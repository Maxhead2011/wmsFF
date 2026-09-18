import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';

import { fineStockSettingsEnabled, NO_WB_RESERVE, parseWbStockReserve } from './wb-stock-reserve';

const RESERVE_PREFIX = 'marketplace.wbReserve.client.';
const PREFIX = 'marketplace.stockControl.client.';

// FIX: an absent setting preserves existing clients; an invalid stored value fails closed.
export function stockControlEnabled(setting: { value: unknown } | null) {
  return setting === null || setting.value === true;
}

@Injectable()
export class MarketplaceStockControlService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService) {}

  async reserve(clientId: string) {
    if (!fineStockSettingsEnabled()) return { ...NO_WB_RESERVE };
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: RESERVE_PREFIX + clientId } });
    return setting ? parseWbStockReserve(setting.value) : { ...NO_WB_RESERVE };
  }

  async updateReserve(clientId: string, body: { reserve?: unknown; expectedUpdatedAt?: unknown }, user: AuthUser) {
    this.requireAdmin(user);
    this.scopes.requireClientAccess(user, clientId, 'write');
    if (!fineStockSettingsEnabled()) throw new ForbiddenException('Тонкие настройки WB не включены.');
    let value;
    try { value = parseWbStockReserve(body.reserve); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    if (body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== 'string') throw new BadRequestException('Передайте версию настройки.');
    const key = RESERVE_PREFIX + clientId;
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      if (!await tx.client.findUnique({ where: { id: clientId }, select: { id: true } })) throw new NotFoundException('Клиент не найден.');
      const before = await tx.systemSetting.findUnique({ where: { key } });
      if ((before?.updatedAt.toISOString() ?? null) !== body.expectedUpdatedAt) throw new ConflictException('Резерв уже изменён. Обновите список.');
      const saved = await tx.systemSetting.upsert({ where: { key }, create: { key, value, updatedByUserId: user.id }, update: { value, updatedByUserId: user.id } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'WB_STOCK_RESERVE_UPDATED', entity: 'Client', entityId: clientId, payload: { before: before?.value ?? NO_WB_RESERVE, after: value } } });
      return { reserve: value, reserveUpdatedAt: saved.updatedAt.toISOString() };
    });
  }

  async skuRules(clientId: string) {
    const prefix = 'marketplace.wbSkuRule.' + clientId + '.';
    const result = new Map<string, { reserve: ReturnType<typeof parseWbStockReserve> | null; blocked: boolean; updatedAt: string }>();
    if (!fineStockSettingsEnabled()) return result;
    const settings = await this.prisma.systemSetting.findMany({ where: { key: { startsWith: prefix } } });
    for (const row of settings) {
      const value = row.value as { reserve?: unknown; blocked?: unknown };
      if (!value || typeof value.blocked !== 'boolean') throw new BadRequestException('Повреждена настройка исключения WB.');
      result.set(row.key.slice(prefix.length), { reserve: value.reserve == null ? null : parseWbStockReserve(value.reserve), blocked: value.blocked, updatedAt: row.updatedAt.toISOString() });
    }
    return result;
  }

  async analysisSettings(clientId: string) {
    if (!fineStockSettingsEnabled()) return { maxShareChange: 10, updatedAt: null as string | null };
    const row = await this.prisma.systemSetting.findUnique({ where: { key: 'marketplace.wbAnalysis.' + clientId } });
    const maxShareChange = row ? (row.value as { maxShareChange: number }).maxShareChange : 10;
    if (!Number.isInteger(maxShareChange) || maxShareChange < 0 || maxShareChange > 100) throw new BadRequestException('Некорректный шаг рекомендации WB.');
    return { maxShareChange, updatedAt: row?.updatedAt.toISOString() ?? null };
  }

  async updateFineRule(clientId: string, skuId: string | null, body: { reserve?: unknown; blocked?: unknown; maxShareChange?: unknown; expectedUpdatedAt?: unknown }, user: AuthUser) {
    this.requireAdmin(user); this.scopes.requireClientAccess(user, clientId, 'write');
    if (!fineStockSettingsEnabled()) throw new ForbiddenException('Тонкие настройки WB не включены.');
    if (body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== 'string') throw new BadRequestException('Передайте версию настройки.');
    let value: { reserve: ReturnType<typeof parseWbStockReserve> | null; blocked: boolean } | { maxShareChange: number };
    if (skuId) {
      if (typeof body.blocked !== 'boolean' || body.reserve === undefined) throw new BadRequestException('Передайте запрет публикации и резерв (null — наследовать).');
      let reserve;
      try { reserve = body.reserve === null ? null : parseWbStockReserve(body.reserve); } catch (e) { throw new BadRequestException((e as Error).message); }
      if (!await this.prisma.sku.findFirst({ where: { id: skuId, clientId, marketplace: 'WILDBERRIES' }, select: { id: true } })) throw new NotFoundException('Товар WB этого клиента не найден.');
      value = { reserve, blocked: body.blocked };
    } else {
      if (typeof body.maxShareChange !== 'number' || !Number.isInteger(body.maxShareChange) || body.maxShareChange < 0 || body.maxShareChange > 100) throw new BadRequestException('Шаг рекомендации: от 0 до 100 процентных пунктов.');
      value = { maxShareChange: body.maxShareChange };
    }
    const key = skuId ? `marketplace.wbSkuRule.${clientId}.${skuId}` : 'marketplace.wbAnalysis.' + clientId;
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      if (!await tx.client.findUnique({ where: { id: clientId }, select: { id: true } })) throw new NotFoundException('Клиент не найден.');
      const before = await tx.systemSetting.findUnique({ where: { key } });
      if ((before?.updatedAt.toISOString() ?? null) !== body.expectedUpdatedAt) throw new ConflictException('Настройка уже изменена. Обновите раздел.');
      const saved = await tx.systemSetting.upsert({ where: { key }, create: { key, value, updatedByUserId: user.id }, update: { value, updatedByUserId: user.id } });
      await tx.auditLog.create({ data: { userId: user.id, action: skuId ? 'WB_SKU_RULE_UPDATED' : 'WB_ANALYSIS_RULE_UPDATED', entity: skuId ? 'Sku' : 'Client', entityId: skuId ?? clientId, payload: { clientId, before: before?.value ?? null, after: value } } });
      return { ...value, updatedAt: saved.updatedAt.toISOString() };
    });
  }

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
    const reserves = fineStockSettingsEnabled() ? await this.prisma.systemSetting.findMany({ where: { key: { in: clients.map(client => RESERVE_PREFIX + client.id) } } }) : [];
    const reservesByKey = new Map(reserves.map(setting => [setting.key, setting]));
    return clients.map((client) => {
      const setting = byKey.get(PREFIX + client.id) ?? null;
      const reserveSetting = reservesByKey.get(RESERVE_PREFIX + client.id);
      return { ...client, fineSettingsEnabled: fineStockSettingsEnabled(), reserve: reserveSetting ? parseWbStockReserve(reserveSetting.value) : NO_WB_RESERVE, reserveUpdatedAt: reserveSetting?.updatedAt.toISOString() ?? null, enabled: stockControlEnabled(setting), updatedAt: setting?.updatedAt ?? null, updatedBy: setting?.updatedBy?.name ?? null };
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
