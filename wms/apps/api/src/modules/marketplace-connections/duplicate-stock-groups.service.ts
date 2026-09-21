import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { MarketplaceConnectionsService } from './marketplace-connections.service';
import { calculateDuplicateStockPlan } from './duplicate-stock-plan';
import { assertNoDuplicateGroupOverlap, duplicateGroupsEnabled, duplicateGroupSkuIds, validateDuplicateGroup, type DuplicateGroup } from './duplicate-stock-groups';
import { splitMarketplaceStock, validateAllocationDraft } from './marketplace-allocation';
import { activeDuplicateGroups, commonDuplicateReserve, duplicatePublicationEnabled, duplicateVariantBudget } from './duplicate-stock-runtime';

const selfServiceEnabled = () => process.env.WMS_DUPLICATE_STOCK_SELF_SERVICE_ENABLED === 'true';
const previewKey = (group: DuplicateGroup, revision: string | null) => createHash('sha256').update(JSON.stringify({ group, revision })).digest('hex');
const prefix = 'marketplace.duplicates.groups.';
const select = { id: true, article: true, clientSku: true, internalSku: true, name: true, size: true, color: true, marketplaceProductId: true,
  barcodes: { select: { value: true }, orderBy: [{ isPrimary: 'desc' as const }, { value: 'asc' as const }] } };
const norm = (s: string | null) => s?.trim().toLowerCase() ?? '';
@Injectable()
export class DuplicateStockGroupsService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService, private readonly marketplaces: MarketplaceConnectionsService) {}
  capabilities() { return { enabled: duplicateGroupsEnabled(), publicationEnabled: duplicatePublicationEnabled(), selfServiceEnabled: selfServiceEnabled() }; }
  private authorize(id: string, user: AuthUser, write = false) {
    if (!duplicateGroupsEnabled() || user.isDemo) throw new ForbiddenException('Распределение между артикулами недоступно.');
    if (!id?.trim()) throw new BadRequestException('Выберите клиента.');
    this.scopes.requireClientAccess(user, id, write && !user.roleCodes.includes('CLIENT') ? 'write' : 'read');
  }
  private connections(clientId: string, db: Prisma.TransactionClient = this.prisma) {
    return db.clientMarketplaceConnection.findMany({ where: { clientId, isActive: true, marketplace: { in: ['WILDBERRIES', 'OZON'] } },
      select: { id: true, marketplace: true, accountName: true, isActive: true, fbsExecutionWarehouseId: true }, orderBy: { id: 'asc' } });
  }
  private decode(value?: Prisma.JsonValue): DuplicateGroup[] {
    if (value === undefined) return [];
    const data = value as unknown as { version: number; groups: unknown[] };
    if (data?.version !== 1 || !Array.isArray(data.groups)) throw new ConflictException('Формат групп требует проверки администратора.');
    try { return data.groups.map(validateDuplicateGroup); } catch { throw new ConflictException('Сохранённые группы требуют проверки администратора.'); }
  }
  async read(clientId: string, user: AuthUser) {
    this.authorize(clientId, user);
    const [setting, connections, mappings, client] = await Promise.all([
      this.prisma.systemSetting.findUnique({ where: { key: prefix + clientId } }), this.connections(clientId),
      this.prisma.clientArticleMapping.findMany({ where: { clientId }, select: { id: true, sourceArticle: true, targetArticle: true } }),
      this.prisma.client.findUnique({ where: { id: clientId }, select: { relabelingEnabled: true } }),
    ]);
    return { groups: this.decode(setting?.value), revision: setting?.updatedAt.toISOString() ?? null, mappings,
      commonReserve: await commonDuplicateReserve(this.prisma, clientId), activeGroupIds: (await activeDuplicateGroups(this.prisma, clientId)).map(g => g.id),
      relabelingEnabled: Boolean(client?.relabelingEnabled), connections: connections.filter(c => c.marketplace === 'WILDBERRIES'), publicationEnabled: duplicatePublicationEnabled(), selfServiceEnabled: selfServiceEnabled() };
  }
  async catalog(clientId: string, body: { search?: unknown; ids?: unknown; page?: unknown }, user: AuthUser) {
    this.authorize(clientId, user);
    if (!body || (body.search !== undefined && typeof body.search !== 'string') || (body.page !== undefined && (!Number.isSafeInteger(body.page) || Number(body.page) < 1))) throw new BadRequestException('Некорректные параметры поиска.');
    if (body.ids !== undefined && (!Array.isArray(body.ids) || body.ids.length > 600 || body.ids.some(id => typeof id !== 'string'))) throw new BadRequestException('Некорректный список карточек.');
    const search = String(body.search ?? '').trim().slice(0, 150), page = Number(body.page ?? 1);
    const where: Prisma.SkuWhereInput = { clientId, marketplace: 'WILDBERRIES', marketplaceProductId: { not: null }, isDraft: false,
      ...(body.ids ? { id: { in: body.ids as string[] } } : search ? { OR: [{ article: { contains: search, mode: 'insensitive' } },
        { clientSku: { contains: search, mode: 'insensitive' } }, { internalSku: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } }, { barcodes: { some: { value: { contains: search } } } }] } : {}) };
    const rows = await this.prisma.sku.findMany({ where, select, orderBy: [{ article: 'asc' }, { size: 'asc' }, { id: 'asc' }],
      skip: body.ids ? 0 : (page - 1) * 50, take: body.ids ? 600 : 51 });
    return { rows: body.ids ? rows : rows.slice(0, 50), page, hasMore: !body.ids && rows.length > 50 };
  }
  private async validate(clientId: string, raw: unknown, user: AuthUser, db: Prisma.TransactionClient = this.prisma, allowNewMappings = false) {
    let group: DuplicateGroup;
    try { group = validateDuplicateGroup(raw); } catch (e) { throw new BadRequestException((e as Error).message); }
    const connections = await this.connections(clientId, db);
    const connection = connections.find(c => c.id === group.connectionId && c.marketplace === 'WILDBERRIES');
    if (!connection?.fbsExecutionWarehouseId) throw new BadRequestException('Выберите активный кабинет WB с настроенным складом исполнения.');
    const warehouseId = connection.fbsExecutionWarehouseId;
    if (!user.roleCodes.includes('CLIENT') && !user.permissionCodes.includes('system:admin')
      && (user.activeWarehouseId !== warehouseId || (user.warehouseIds && !user.warehouseIds.includes(warehouseId)))) throw new ForbiddenException('Выберите доступный филиал исполнения кабинета.');
    const ids = duplicateGroupSkuIds(group);
    const [skus, mappings, client] = await Promise.all([
      db.sku.findMany({ where: { clientId, id: { in: ids }, marketplace: 'WILDBERRIES', marketplaceProductId: { not: null }, isDraft: false }, select }),
      db.clientArticleMapping.findMany({ where: { clientId }, select: { sourceArticle: true, targetArticle: true } }),
      db.client.findUnique({ where: { id: clientId }, select: { relabelingEnabled: true } }),
    ]);
    if (!client?.relabelingEnabled) throw new BadRequestException('Сначала включите клиенту действующий механизм переклейки.');
    if (skus.length !== ids.length) throw new BadRequestException('Карточки должны принадлежать этому клиенту и быть доступны. Обновите выбор.');
    const byId = new Map(skus.map(s => [s.id, s]));
    const missingMappings: Array<{ sourceArticle: string; targetArticle: string }> = [];
    for (const v of group.variants) for (const t of v.targets) {
      const source = byId.get(v.sourceSkuId)!, target = byId.get(t.targetId)!;
      if (!norm(source.size) || norm(source.size) !== norm(target.size)) throw new BadRequestException('Выберите одинаковые непустые размеры исходного и целевого товара.');
      if (!source.barcodes.length || !target.barcodes.length) throw new BadRequestException('У обеих карточек должен быть ШК.');
      // FIX: share settings cannot create a parallel source mapping different from the picking workflow.
      if (t.requiresRelabel && !mappings.some(m => [target.article, target.clientSku].some(a => norm(a) === norm(m.targetArticle))
        && ([source.article, source.clientSku, source.internalSku].some(a => norm(a) === norm(m.sourceArticle)) || norm(source.internalSku).startsWith(norm(m.sourceArticle) + '-')))) {
        if (!allowNewMappings || !selfServiceEnabled()) throw new BadRequestException('Эта пара не настроена в меню «Переклейка». Сначала добавьте там соответствие артикулов.');
        const sourceArticle = source.article?.trim() || source.clientSku?.trim(), targetArticle = target.article?.trim() || target.clientSku?.trim();
        if (!sourceArticle || !targetArticle || norm(sourceArticle) === norm(targetArticle)) throw new BadRequestException('Выберите два разных артикула.');
        // FIX: do not silently replace another source or create relabel chains/cycles.
        const all = [...mappings, ...missingMappings];
        if (all.some(m => norm(m.targetArticle) === norm(targetArticle) && norm(m.sourceArticle) !== norm(sourceArticle))
          || all.some(m => norm(m.targetArticle) === norm(sourceArticle) || norm(m.sourceArticle) === norm(targetArticle)))
          throw new ConflictException('Соответствие конфликтует с существующей переклейкой. Проверьте исходный артикул.');
        if (!missingMappings.some(m => norm(m.sourceArticle) === norm(sourceArticle) && norm(m.targetArticle) === norm(targetArticle))) missingMappings.push({ sourceArticle, targetArticle });
      }
    }
    return { group, connections, warehouseId, skus, mappings, missingMappings };
  }
  async save(clientId: string, body: { group?: unknown; revision?: unknown; deleteId?: unknown }, user: AuthUser) {
    this.authorize(clientId, user, true);
    if (!body || (body.revision !== null && typeof body.revision !== 'string') || (body.deleteId !== undefined && (typeof body.deleteId !== 'string' || body.group !== undefined))) throw new BadRequestException('Передайте группу и версию настроек.');
    const key = prefix + clientId;
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const old = await tx.systemSetting.findUnique({ where: { key } });
      if ((old?.updatedAt.toISOString() ?? null) !== body.revision) throw new ConflictException('Группы изменены другим пользователем. Обновите список.');
      const groups = this.decode(old?.value);
      // FIX: active rules must be changed through a controlled publication transition.
      const active = await activeDuplicateGroups(tx, clientId);
      const changedId = body.deleteId ?? (body.group as { id?: string } | undefined)?.id;
      if (active.some(g => g.id === changedId)) throw new ConflictException('Группа уже управляет остатками WB. Для изменения требуется пересчёт и переключение действующей публикации.');
      if (body.deleteId !== undefined) { if (!groups.some(g => g.id === body.deleteId)) throw new BadRequestException('Группа не найдена.'); }
      else {
        const { group } = await this.validate(clientId, body.group, user, tx, true);
        try { assertNoDuplicateGroupOverlap(group, groups); } catch (e) { throw new BadRequestException((e as Error).message); }
        const index = groups.findIndex(g => g.id === group.id);
        if (index < 0) { if (groups.length >= 100) throw new BadRequestException('Достигнут предел 100 групп.'); groups.push(group); } else groups[index] = group;
      }
      const value = { version: 1, groups: groups.filter(g => g.id !== body.deleteId) } as unknown as Prisma.InputJsonValue;
      const saved = await tx.systemSetting.upsert({ where: { key }, create: { key, value, updatedByUserId: user.id }, update: { value, updatedByUserId: user.id,
        updatedAt: new Date(Math.max(Date.now(), (old?.updatedAt.getTime() ?? 0) + 1)) } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'duplicate.stock.groups.saved', entity: 'Client', entityId: clientId, payload: { before: old?.value ?? null, after: value, publicationEnabled: false } } });
      return { groups: this.decode(saved.value), revision: saved.updatedAt.toISOString(), publicationEnabled: false };
    });
  }
  // FIX: settings + relabel mappings + durable queue event commit atomically under the publisher lock.
  async apply(clientId: string, body: { group?: unknown; revision?: unknown; previewKey?: unknown }, user: AuthUser) {
    this.authorize(clientId, user, true);
    if (!selfServiceEnabled() || !duplicatePublicationEnabled() || process.env.WMS_WB_URGENT_STOCK_SYNC !== 'true') throw new ForbiddenException('Применение распределения пока недоступно.');
    if (!body || (body.revision !== null && typeof body.revision !== 'string')) throw new BadRequestException('Передайте версию настроек.');
    // A fresh calculation verifies catalogue completeness; the worker recalculates again before sending.
    const checked = await this.preview(clientId, { group: body.group }, user);
    if (body.previewKey !== checked.previewKey) throw new ConflictException('Настройки изменились. Повторите предпросмотр.');
    return this.prisma.$transaction(async tx => {
      const key = prefix + clientId;
      const requested = validateDuplicateGroup(body.group);
      const lock = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${'wb.stock.publish.' + requested.connectionId})) AS acquired`;
      if (!lock[0]?.acquired) throw new ConflictException('Сейчас выполняется отправка WB. Повторите применение после её завершения.');
      const { group, connections, warehouseId, missingMappings } = await this.validate(clientId, body.group, user, tx, true);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const old = await tx.systemSetting.findUnique({ where: { key } });
      if ((old?.updatedAt.toISOString() ?? null) !== body.revision) throw new ConflictException('Группы изменены другим пользователем. Обновите список.');
      if (body.previewKey !== previewKey(group, old?.updatedAt.toISOString() ?? null)) throw new ConflictException('Повторите предпросмотр.');
      if (connections.length !== 1 || connections[0].marketplace !== 'WILDBERRIES') throw new BadRequestException('Применение дублей сейчас доступно для одного кабинета WB.');
      if (process.env.WMS_WB_STOCK_FINE_SETTINGS !== 'true' || process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED !== 'true') throw new BadRequestException('Не включён единый учёт и подтверждение остатков WB.');
      const control = await tx.systemSetting.findUnique({ where: { key: 'marketplace.stockControl.client.' + clientId } });
      if (control && control.value !== true) throw new BadRequestException('Включите управление остатками клиента.');
      const groups = this.decode(old?.value), active = await activeDuplicateGroups(tx, clientId);
      const previous = active.find(g => g.id === group.id);
      // Changing percentages is safe. Replacing a live physical source requires a separate migration of outstanding picks.
      if (previous && JSON.stringify(previous.variants) !== JSON.stringify(group.variants)) throw new ConflictException('У действующей группы можно менять доли. Смена артикулов и состава размеров требует завершения и проверки текущих сборок.');
      try { assertNoDuplicateGroupOverlap(group, groups); } catch (e) { throw new BadRequestException((e as Error).message); }
      const ids = duplicateGroupSkuIds(group);
      const policy = await tx.fbsStockAllocationPolicy.findFirst({ where: { clientId, connectionId: group.connectionId, enabled: true }, include: { overrides: true } });
      if (!policy) throw new BadRequestException('Включите распределение WB по складам.');
      if (policy.overrides.some(o => ids.includes(o.skuId))) throw new ConflictException('У товаров есть индивидуальные лимиты распределения по складам. Сначала согласуйте их с долями.');
      const publications = await tx.fbsStockPublication.findMany({ where: { clientId, connectionId: group.connectionId, skuId: { in: ids } } });
      if (publications.some(p => !p.enabled || p.saleLimit !== null || p.relabelManualAmount !== null)) throw new ConflictException('У товаров есть отключённая публикация или ручные лимиты. Сначала снимите конфликтующие настройки.');
      const index = groups.findIndex(g => g.id === group.id);
      if (index < 0) { if (groups.length >= 100) throw new BadRequestException('Достигнут предел 100 групп.'); groups.push(group); } else groups[index] = group;
      for (const mapping of missingMappings) await tx.clientArticleMapping.upsert({ where: { clientId_sourceArticle_targetArticle: { clientId, ...mapping } }, create: { clientId, ...mapping }, update: {} });
      const value = { version: 1, groups } as unknown as Prisma.InputJsonValue;
      const saved = await tx.systemSetting.upsert({ where: { key }, create: { key, value, updatedByUserId: user.id }, update: { value, updatedByUserId: user.id, updatedAt: new Date(Math.max(Date.now(), (old?.updatedAt.getTime() ?? 0) + 1)) } });
      const activeKey = 'marketplace.duplicates.active.' + clientId;
      const activeValue = { version: 1, groupIds: [...new Set([...active.map(g => g.id), group.id])], connectionId: group.connectionId, warehouseId };
      await tx.systemSetting.upsert({ where: { key: activeKey }, create: { key: activeKey, value: activeValue, updatedByUserId: user.id }, update: { value: activeValue, updatedByUserId: user.id } });
      await tx.$executeRaw`INSERT INTO "WbStockSyncEvent" ("clientId", "skuIds", "allSkus") VALUES (${clientId}, ${ids}::text[], false)`;
      await tx.auditLog.create({ data: { userId: user.id, action: 'duplicate.stock.groups.applied', entity: 'Client', entityId: clientId, payload: { before: old?.value ?? null, after: value, createdMappings: missingMappings, active: activeValue } } });
      return { groups: this.decode(saved.value), revision: saved.updatedAt.toISOString(), activeGroupIds: activeValue.groupIds, queued: true, mappingsCreated: missingMappings.length };
    }, { timeout: 30000 });
  }
  async preview(clientId: string, body: { group?: unknown }, user: AuthUser) {
    this.authorize(clientId, user);
    const { group, connections, warehouseId, skus, mappings, missingMappings } = await this.validate(clientId, body?.group, user, this.prisma, true);
    const existing = await this.prisma.systemSetting.findUnique({ where: { key: prefix + clientId } });
    try { assertNoDuplicateGroupOverlap(group, this.decode(existing?.value)); } catch (e) { throw new BadRequestException((e as Error).message); }
    let wbPercent = 100;
    if (connections.some(c => c.marketplace === 'OZON')) {
      const allocation = await this.prisma.systemSetting.findUnique({ where: { key: 'marketplace.allocation.draft.' + clientId } });
      try { const draft = validateAllocationDraft(allocation?.value, connections);
        if (draft.wbConnectionId !== group.connectionId || connections.find(c => c.id === draft.ozonConnectionId)?.fbsExecutionWarehouseId !== warehouseId) throw new Error();
        wbPercent = draft.wbPercent;
      } catch { throw new BadRequestException('Сначала настройте доли WB/Ozon для выбранного кабинета и общего склада исполнения.'); }
    }
    const quantities = await this.marketplaces.calculateFbsStockQuantities(clientId, duplicateGroupSkuIds(group), warehouseId, group.connectionId);
    const reserveRule = group.reserve.mode === 'COMMON' ? await commonDuplicateReserve(this.prisma, clientId) : { mode: group.reserve.mode as 'UNITS' | 'PERCENT', value: group.reserve.value };
    const stocks = group.variants.map(v => {
      const q = quantities.get(v.sourceSkuId);
      if (!q) throw new BadRequestException('Не удалось рассчитать исходный SKU. Проверьте ID размера WB.');
      const budget = duplicateVariantBudget(v, quantities, reserveRule);
      return { ...v, size: skus.find(s => s.id === v.sourceSkuId)!.size!, available: budget.sourceBudget,
        marketplaceBudget: splitMarketplaceStock(budget.sourceBudget, wbPercent).wb, total: budget.totalAvailable, reserved: budget.totalReserved,
        freeBeforeSafety: budget.freeBeforeSafety, safetyReserve: budget.safetyReserve, ownByTarget: budget.ownByTarget };
    });
    const plan = calculateDuplicateStockPlan(group, stocks);
    const publications = await this.prisma.fbsStockPublication.findMany({ where: { clientId, connectionId: group.connectionId, skuId: { in: duplicateGroupSkuIds(group) } },
      select: { skuId: true, enabled: true, saleLimit: true, relabelManualAmount: true } });
    // FIX: the current picking resolver may choose another source of the same size.
    // Draft percentages must not imply that the resolver already obeys exact SKU pairs.
    const relevantMappings = mappings.filter(m => skus.some(s => [s.article, s.clientSku].some(a => norm(a) === norm(m.targetArticle))));
    const candidates = relevantMappings.length ? await this.prisma.sku.findMany({ where: { clientId,
      OR: relevantMappings.flatMap(m => [
        { article: { equals: m.sourceArticle, mode: 'insensitive' as const } },
        { clientSku: { equals: m.sourceArticle, mode: 'insensitive' as const } },
        { internalSku: { equals: m.sourceArticle, mode: 'insensitive' as const } },
        { internalSku: { startsWith: m.sourceArticle + '-', mode: 'insensitive' as const } },
      ]) }, select: { id: true, article: true, clientSku: true, internalSku: true, size: true } }) : [];
    const pickingWarnings = group.variants.flatMap(v => v.targets.filter(t => t.requiresRelabel).flatMap(t => {
      const target = skus.find(s => s.id === t.targetId)!;
      const rules = relevantMappings.filter(m => [target.article, target.clientSku].some(a => norm(a) === norm(m.targetArticle)));
      const matches = candidates.filter(s => norm(s.size) === norm(target.size) && rules.some(m =>
        [s.article, s.clientSku, s.internalSku].some(a => norm(a) === norm(m.sourceArticle)) || norm(s.internalSku).startsWith(norm(m.sourceArticle) + '-')));
      return matches.some(s => s.id !== v.sourceSkuId) ? [{ sourceSkuId: v.sourceSkuId, targetSkuId: t.targetId,
        message: `Для ${target.article || target.clientSku || target.id}, размер ${target.size}, переклейка допускает несколько исходных SKU. Перед включением долей нужно согласовать точную выдачу на сборку.` }] : [];
    }));
    return { ...plan, missingMappings, previewKey: previewKey(group, existing?.updatedAt.toISOString() ?? null), generatedAt: new Date().toISOString(), warehouseId, wbPercent, publicationEnabled: false, publications, pickingWarnings,
      rows: plan.rows.map((r, i) => ({ ...r, total: stocks[i].total, reserved: stocks[i].reserved, freeBeforeSafety: stocks[i].freeBeforeSafety,
        safetyReserve: stocks[i].safetyReserve, source: skus.find(s => s.id === r.sourceSkuId)!,
        targets: r.targets.map(t => ({ ...t, card: skus.find(s => s.id === t.targetId)!, ownStock: stocks[i].ownByTarget.get(t.targetId) ?? 0 })) })) };
  }
}
