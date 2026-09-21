import type { Prisma } from '@prisma/client';
import { assertNoDuplicateGroupOverlap, validateDuplicateGroup, type DuplicateGroup } from './duplicate-stock-groups';
import { calculateDuplicateStockPlan } from './duplicate-stock-plan';
import { NO_WB_RESERVE, parseWbStockReserve, wbStockAfterReserve, type WbStockReserve } from './wb-stock-reserve';

export const duplicatePublicationEnabled = () => process.env.WMS_DUPLICATE_STOCK_PUBLICATION_ENABLED === 'true';
export const duplicateActiveKey = (clientId: string) => 'marketplace.duplicates.active.' + clientId;
export async function commonDuplicateReserve(db: Prisma.TransactionClient, clientId: string): Promise<WbStockReserve> {
  const setting = await db.systemSetting.findUnique({ where: { key: 'marketplace.wbReserve.client.' + clientId } });
  return setting ? parseWbStockReserve(setting.value) : NO_WB_RESERVE;
}

// FIX: activation is separate from editable drafts; only reviewed groups drive real stock.
export async function activeDuplicateGroups(db: Prisma.TransactionClient, clientId: string, connectionId?: string, warehouseId?: string | null) {
  if (!duplicatePublicationEnabled()) return [] as DuplicateGroup[];
  const active = await db.systemSetting.findUnique({ where: { key: duplicateActiveKey(clientId) } });
  if (!active) return [] as DuplicateGroup[];
  const config = active.value as { version?: number; groupIds?: unknown; connectionId?: string; warehouseId?: string };
  if (config?.version !== 1 || !Array.isArray(config.groupIds) || !config.groupIds.length || config.groupIds.some(id => typeof id !== 'string')
    || !config.connectionId || !config.warehouseId) throw new Error('Некорректное включение групп дублей. Отправка остановлена.');
  if (connectionId && connectionId !== config.connectionId) throw new Error('Дубли уже распределяются в другом кабинете.');
  if (warehouseId !== undefined && warehouseId !== config.warehouseId) throw new Error('Изменился склад исполнения группы дублей.');
  if (process.env.WMS_WB_STOCK_FINE_SETTINGS !== 'true' || process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED !== 'true') throw new Error('Для публикации дублей нужны подтверждение WB и единый учёт резервов.');
  const connections = await db.clientMarketplaceConnection.findMany({ where: { clientId, isActive: true }, select: { id: true, marketplace: true, fbsExecutionWarehouseId: true } });
  if (connections.length !== 1 || connections[0].id !== config.connectionId || connections[0].marketplace !== 'WILDBERRIES' || connections[0].fbsExecutionWarehouseId !== config.warehouseId) throw new Error('Публикация этих групп настроена на один кабинет WB и общий склад. Проверьте подключения.');
  const policy = await db.fbsStockAllocationPolicy.findFirst({ where: { clientId, connectionId: config.connectionId, enabled: true }, select: { id: true } });
  if (!policy) throw new Error('Для отправки групп включите действующее распределение WB по складам.');
  const client = await db.client.findUnique({ where: { id: clientId }, select: { relabelingEnabled: true } });
  if (!client?.relabelingEnabled) throw new Error('Переклейка клиента выключена. Публикация дублей остановлена.');
  const setting = await db.systemSetting.findUnique({ where: { key: 'marketplace.duplicates.groups.' + clientId } });
  const data = setting?.value as { version?: number; groups?: unknown[] } | undefined;
  if (data?.version !== 1 || !Array.isArray(data.groups)) throw new Error('Активные группы дублей не найдены.');
  const groups = data.groups.map(validateDuplicateGroup).filter(g => (config.groupIds as string[]).includes(g.id));
  if (groups.length !== new Set(config.groupIds).size || groups.some(g => g.connectionId !== config.connectionId)) throw new Error('Состав активных групп изменён.');
  groups.forEach(g => assertNoDuplicateGroupOverlap(g, groups));
  return groups;
}

export type DuplicateRuntimeQuantity = { skuId: string; chrtId: number; available: number; reserved: number; sellable: number };
export type DuplicateRuntimeMeta = { isSource: boolean; isTarget: boolean; sources: Array<{ skuId: string; label: string; sellable: number; allocated: number }>; allocatedFromSources: number; allocatedToTargets: number; capacity: number };

export function duplicateVariantBudget(variant: DuplicateGroup['variants'][number], base: Map<string, DuplicateRuntimeQuantity>, rule: WbStockReserve,
  skuRules = new Map<string, { reserve: WbStockReserve | null; blocked: boolean }>()) {
  const source = base.get(variant.sourceSkuId);
  if (!source || variant.targets.some(t => !base.has(t.targetId))) throw new Error('Размер WB группы недоступен. Отправка остановлена.');
  const targets = variant.targets.filter(t => t.requiresRelabel).sort((a,b)=>a.targetKey.localeCompare(b.targetKey));
  const unmet = targets.reduce((sum,t)=>{const q=base.get(t.targetId)!;return sum+Math.max(0,q.reserved-q.available);},0);
  const sourceFree = skuRules.get(source.skuId)?.blocked ? 0 : Math.max(0,source.sellable-unmet);
  const ownByTarget = new Map(targets.map(t=>[t.targetId,skuRules.get(t.targetId)?.blocked ? 0 : base.get(t.targetId)!.sellable]));
  const freeBeforeSafety = sourceFree + [...ownByTarget.values()].reduce((a,b)=>a+b,0);
  const safetyReserve = freeBeforeSafety-wbStockAfterReserve(freeBeforeSafety,rule);
  const fromSource = Math.min(sourceFree,safetyReserve);
  let remainder=safetyReserve-fromSource;
  for(const [id,own] of ownByTarget){const held=Math.min(own,remainder);ownByTarget.set(id,own-held);remainder-=held;}
  return { sourceBudget: sourceFree-fromSource, ownByTarget, freeBeforeSafety, safetyReserve,
    totalAvailable: variant.targets.reduce((sum,t)=>sum+base.get(t.targetId)!.available,0),
    totalReserved: variant.targets.reduce((sum,t)=>sum+base.get(t.targetId)!.reserved,0) };
}

// FIX: stock already moved to the target is its own pool; unmet target demand consumes
// the original pool only when unified reservations have not yet assigned a source.
export function calculateActiveDuplicateQuantities(groups: DuplicateGroup[], base: Map<string, DuplicateRuntimeQuantity>, commonReserve: WbStockReserve,
  skuRules = new Map<string, { reserve: WbStockReserve | null; blocked: boolean }>()) {
  const quantities = new Map<string, DuplicateRuntimeQuantity>();
  const meta = new Map<string, DuplicateRuntimeMeta>();
  for (const group of groups) {
    assertNoDuplicateGroupOverlap(group, groups);
    const rule = group.reserve.mode === 'COMMON' ? commonReserve : group.reserve;
    const budgets = new Map(group.variants.map(v=>[v.sourceSkuId,duplicateVariantBudget(v,base,rule as WbStockReserve,skuRules)]));
    const stocks = group.variants.map(v => ({ ...v, size: v.sourceSkuId, available: budgets.get(v.sourceSkuId)!.sourceBudget, marketplaceBudget: budgets.get(v.sourceSkuId)!.sourceBudget }));
    const plan = calculateDuplicateStockPlan(group, stocks);
    for (const row of plan.rows) {
      const source = base.get(row.sourceSkuId)!;
      for (const target of row.targets) {
        const own = base.get(target.targetId)!;
        const blocked = skuRules.get(target.targetId)?.blocked;
        const ownSellable = budgets.get(row.sourceSkuId)!.ownByTarget.get(target.targetId) ?? 0;
        const sellable = blocked ? 0 : target.quantity + ownSellable;
        quantities.set(target.targetId, { ...own, sellable });
        meta.set(target.targetId, { isSource: !target.requiresRelabel, isTarget: target.requiresRelabel,
          sources: target.requiresRelabel ? [{ skuId: source.skuId, label: group.name, sellable: row.available, allocated: target.quantity }] : [],
          allocatedFromSources: target.requiresRelabel ? target.quantity : 0,
          allocatedToTargets: target.requiresRelabel ? 0 : row.relabelQuantity, capacity: sellable });
      }
    }
  }
  return { quantities, meta };
}

export async function exactDuplicateSource(db: Prisma.TransactionClient, clientId: string, targetSkuId: string) {
  const groups = await activeDuplicateGroups(db, clientId);
  const sources = groups.flatMap(g => g.variants.filter(v => v.targets.some(t => t.targetId === targetSkuId && t.requiresRelabel)).map(v => v.sourceSkuId));
  if (sources.length > 1) throw new Error('Для дубля задано несколько исходных SKU.');
  return sources[0] ?? null;
}

export function validateActiveDuplicatePairs(groups: DuplicateGroup[], skus: Array<{ id: string; article: string | null; clientSku: string | null; internalSku: string; size: string | null }>,
  mappings: Array<{ sourceArticle: string; targetArticle: string }>) {
  const norm = (s: string | null) => s?.trim().toLowerCase() ?? '';
  const managed = new Set<string>();
  for (const g of groups) for (const v of g.variants) for (const t of v.targets) {
    const source = skus.find(s => s.id === v.sourceSkuId), target = skus.find(s => s.id === t.targetId);
    if (!source || !target || !norm(source.size) || norm(source.size) !== norm(target.size)) throw new Error('Изменился размер или состав активной группы дублей.');
    if (t.requiresRelabel && !mappings.some(m => [target.article, target.clientSku].some(a => norm(a) === norm(m.targetArticle))
      && ([source.article, source.clientSku, source.internalSku].some(a => norm(a) === norm(m.sourceArticle)) || norm(source.internalSku).startsWith(norm(m.sourceArticle) + '-')))) throw new Error('Отсутствует соответствие активной группы в меню «Переклейка».');
    managed.add(t.targetId);
  }
  return managed;
}

// FIX: an unknown original amount must block increases for its duplicate too.
export function unavailableDuplicateChrtIds(groups: DuplicateGroup[], quantities: Map<string, DuplicateRuntimeQuantity>, unknown: Set<number>) {
  const blocked = new Set<number>();
  for (const g of groups) for (const v of g.variants) {
    const ids = v.targets.map(t => quantities.get(t.targetId)?.chrtId).filter((id): id is number => id !== undefined);
    if (ids.some(id => unknown.has(id))) ids.forEach(id => blocked.add(id));
  }
  return blocked;
}
