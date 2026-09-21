export type DuplicateShare = { targetKey: string; label: string; percent: number };
export type DuplicateGroup = {
  id: string; name: string; connectionId: string; shares: DuplicateShare[];
  reserve: { mode: 'UNITS' | 'PERCENT'; value: number };
  variants: Array<{ sourceSkuId: string; targets: Array<{ targetKey: string; targetId: string; confirmed: boolean; requiresRelabel: boolean }> }>;
  overrides: Array<{ sourceSkuId: string; shares: Array<{ targetKey: string; percent: number }> }>;
};
export type DuplicateCard = { id: string; article: string | null; clientSku?: string | null; internalSku?: string | null; name: string; size: string | null; color: string | null; barcodes: Array<{ value: string }> };
// FIX: use the same article aliases as the existing relabel picking workflow.
export function matchesRelabelArticle(card: DuplicateCard, article: string, source = false) {
  const key = article.trim().toLowerCase();
  if (!key) return false;
  const refs = source ? [card.article, card.clientSku, card.internalSku] : [card.article, card.clientSku];
  return refs.some(value => value?.trim().toLowerCase() === key)
    || (source && Boolean(card.internalSku?.trim().toLowerCase().startsWith(key + '-')));
}
export type DuplicateMapping = { id: string; sourceArticle: string; targetArticle: string };
export type DuplicateSettings = { groups: DuplicateGroup[]; revision: string | null; publicationEnabled: boolean; relabelingEnabled: boolean;
  mappings: DuplicateMapping[]; connections: Array<{ id: string; accountName: string | null; fbsExecutionWarehouseId: string | null }> };
export type DuplicatePreview = { generatedAt: string; totalAllocated: number; totalRelabel: number; wbPercent: number; publicationEnabled: boolean;
  pickingWarnings: Array<{ sourceSkuId: string; targetSkuId: string; message: string }>;
  publications: Array<{ skuId: string; enabled: boolean; saleLimit: number | null; relabelManualAmount: number | null }>;
  rows: Array<{ sourceSkuId: string; source: DuplicateCard; size: string; total: number; reserved: number; freeBeforeSafety: number; safetyReserve: number;
    available: number; marketplaceBudget: number; outsideMarketplace: number; individual: boolean;
    targets: Array<{ targetKey: string; targetId: string; percent: number; quantity: number; requiresRelabel: boolean; card: DuplicateCard; ownStock: number | null }> }> };
export function effectiveDuplicateShares(group: DuplicateGroup, sourceSkuId: string) {
  return group.overrides.find(o => o.sourceSkuId === sourceSkuId)?.shares ?? group.shares;
}
// FIX: a missing per-size exception inherits the current common shares; it is not copied once.
export function withDuplicateException(group: DuplicateGroup, sourceSkuId: string, enabled: boolean): DuplicateGroup {
  const overrides = group.overrides.filter(o => o.sourceSkuId !== sourceSkuId);
  if (enabled) overrides.push({ sourceSkuId, shares: effectiveDuplicateShares(group, sourceSkuId).map(s => ({ targetKey: s.targetKey, percent: s.percent })) });
  return { ...group, overrides };
}
export function suggestDuplicateTarget(source: DuplicateCard, candidates: DuplicateCard[]) {
  const size = source.size?.trim().toLowerCase();
  const matches = size ? candidates.filter(c => c.size?.trim().toLowerCase() === size && c.id !== source.id) : [];
  return { targetId: matches.length === 1 ? matches[0].id : '', confirmed: false, requiresRelabel: true };
}
export function duplicateGroupReady(group: DuplicateGroup) {
  const validShares = (shares: Array<{ percent: number }>) => shares.every(s => Number.isInteger(s.percent) && s.percent >= 0 && s.percent <= 100) && shares.reduce((sum, s) => sum + s.percent, 0) === 100;
  return Boolean(group.name.trim() && group.connectionId && group.variants.length && validShares(group.shares)
    && group.overrides.every(o => validShares(o.shares)) && Number.isSafeInteger(group.reserve.value) && group.reserve.value >= 0
    && group.reserve.value <= (group.reserve.mode === 'PERCENT' ? 100 : 1_000_000)
    && group.variants.every(v => v.targets.length === group.shares.length && v.targets.every(t => t.targetId && t.confirmed)));
}
