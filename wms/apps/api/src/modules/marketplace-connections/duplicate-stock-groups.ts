import { calculateDuplicateStockPlan, type DuplicateShare } from './duplicate-stock-plan';

export type DuplicateGroup = {
  id: string; name: string; connectionId: string;
  shares: Array<DuplicateShare & { label: string }>;
  reserve: { mode: 'COMMON' | 'UNITS' | 'PERCENT'; value: number };
  variants: Array<{ sourceSkuId: string; targets: Array<{ targetKey: string; targetId: string; confirmed: boolean; requiresRelabel: boolean }> }>;
  overrides: Array<{ sourceSkuId: string; shares: DuplicateShare[] }>;
};
export function duplicateGroupsEnabled() { return process.env.WMS_DUPLICATE_STOCK_GROUPS_ENABLED === 'true'; }
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Заполните название и идентификаторы группы.');
  return value.trim();
}
// FIX: the buffer belongs to the physical size/color pool, never to each duplicate card.
export function stockAfterSafetyReserve(available: number, reserve: DuplicateGroup['reserve']) {
  if (reserve.mode === 'COMMON') throw new Error('Общий резерв необходимо загрузить из настроек клиента.');
  if (!Number.isSafeInteger(available) || available < 0) throw new Error('Некорректный свободный остаток.');
  const requested = reserve.mode === 'UNITS' ? reserve.value : Number((BigInt(available) * BigInt(reserve.value) + 99n) / 100n);
  const safetyReserve = Math.min(available, requested);
  return { safetyReserve, distributable: available - safetyReserve };
}
export function validateDuplicateGroup(value: unknown): DuplicateGroup {
  if (!value || typeof value !== 'object') throw new Error('Передайте группу распределения.');
  const g = value as DuplicateGroup;
  if (!Array.isArray(g.shares) || g.shares.length > 6 || !Array.isArray(g.variants) || !g.variants.length || g.variants.length > 100
    || !Array.isArray(g.overrides) || g.overrides.length > 100) throw new Error('Выберите от 2 до 6 карточек и от 1 до 100 вариантов товара.');
  if (!g.reserve || !['COMMON', 'UNITS', 'PERCENT'].includes(g.reserve.mode) || !Number.isSafeInteger(g.reserve.value) || g.reserve.value < 0 || (g.reserve.mode === 'COMMON' && g.reserve.value !== 0)
    || g.reserve.value > (g.reserve.mode === 'PERCENT' ? 100 : 1_000_000)) throw new Error('Страховой резерв: целое неотрицательное количество или процент от 0 до 100.');
  const group: DuplicateGroup = { id: text(g.id, 80), name: text(g.name, 150), connectionId: text(g.connectionId, 80),
    shares: g.shares.map(s => ({ targetKey: text(s.targetKey, 80), label: text(s.label, 150), percent: s.percent })),
    reserve: { mode: g.reserve.mode, value: g.reserve.value },
    variants: g.variants.map(v => ({ sourceSkuId: text(v.sourceSkuId, 80), targets: Array.isArray(v.targets) ? v.targets.map(t => ({
      targetKey: text(t.targetKey, 80), targetId: text(t.targetId, 80), confirmed: t.confirmed, requiresRelabel: t.requiresRelabel,
    })) : [] })), overrides: g.overrides.map(o => ({ sourceSkuId: text(o.sourceSkuId, 80), shares: o.shares })) };
  calculateDuplicateStockPlan(group, group.variants.map(v => ({ ...v, size: '', available: 0, marketplaceBudget: 0 })));
  const sources = new Set(group.variants.map(v => v.sourceSkuId));
  for (const v of group.variants) {
    if (v.targets.filter(t => t.targetId === v.sourceSkuId).length !== 1) throw new Error('В каждом варианте оставьте исходную карточку, даже если её доля равна 0%.');
    for (const t of v.targets) {
      if (t.targetId !== v.sourceSkuId && sources.has(t.targetId)) throw new Error('Цепочки и циклы распределения между исходными товарами запрещены.');
      if (t.requiresRelabel !== (t.targetId !== v.sourceSkuId)) throw new Error('Для другого артикула подтвердите переклейку; для исходного она не нужна.');
    }
  }
  return group;
}
export function duplicateGroupSkuIds(group: DuplicateGroup) {
  return [...new Set(group.variants.flatMap(v => [v.sourceSkuId, ...v.targets.map(t => t.targetId)]))];
}
export function assertNoDuplicateGroupOverlap(group: DuplicateGroup, others: DuplicateGroup[]) {
  const ids = new Set(duplicateGroupSkuIds(group));
  if (others.some(g => g.id !== group.id && duplicateGroupSkuIds(g).some(id => ids.has(id)))) {
    throw new Error('Товар уже входит в другую группу. Один физический остаток нельзя распределять дважды.');
  }
}
