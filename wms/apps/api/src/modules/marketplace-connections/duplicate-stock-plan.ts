export type DuplicateShare = { targetKey: string; percent: number };
export type DuplicatePolicy = {
  shares: DuplicateShare[];
  // A SKU identifies the exact size/color variant; size text alone is not an identity.
  overrides?: Array<{ sourceSkuId: string; shares: DuplicateShare[] }>;
};
export type DuplicateVariant = {
  sourceSkuId: string;
  size: string;
  // Available after reserves, calculated by the shared stock service.
  available: number;
  // Only the quantity already allocated to this marketplace, never the whole pool again.
  marketplaceBudget: number;
  targets: Array<{ targetKey: string; targetId: string; confirmed: boolean; requiresRelabel: boolean }>;
};

function identity(value: string) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error('Укажите однозначные идентификаторы карточек и вариантов.');
  return value;
}
function quantity(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Количество должно быть неотрицательным целым числом.');
  return value;
}
function sum(values: number[]) { return quantity(values.reduce((a, b) => a + b, 0)); }
function shares(value: DuplicateShare[], expected?: string[]) {
  if (!Array.isArray(value) || value.length < 2) throw new Error('Выберите минимум две карточки.');
  const keys = new Set<string>();
  for (const row of value) {
    const key = identity(row.targetKey);
    if (keys.has(key) || !Number.isInteger(row.percent) || row.percent < 0 || row.percent > 100) throw new Error('Карточки не должны повторяться; доли задаются целыми процентами.');
    keys.add(key);
  }
  if (sum(value.map(row => row.percent)) !== 100) throw new Error('Сумма долей должна составлять 100%.');
  if (expected && (keys.size !== expected.length || expected.some(key => !keys.has(key)))) throw new Error('Исключение размера должно содержать те же карточки, что и общее правило.');
  return [...value].sort((a, b) => a.targetKey < b.targetKey ? -1 : a.targetKey > b.targetKey ? 1 : 0);
}

// FIX: pure planning only. This neither transfers physical stock nor enables a marketplace writer.
export function calculateDuplicateStockPlan(policy: DuplicatePolicy, variants: DuplicateVariant[]) {
  const defaults = shares(policy.shares);
  const sourceIds = new Set<string>();
  const destinationIds = new Set<string>();
  const exceptions = new Map<string, DuplicateShare[]>();
  for (const row of policy.overrides ?? []) {
    const id = identity(row.sourceSkuId);
    if (exceptions.has(id)) throw new Error('Исключение для варианта повторяется.');
    exceptions.set(id, shares(row.shares, defaults.map(s => s.targetKey)));
  }
  const rows = variants.map(variant => {
    const sourceSkuId = identity(variant.sourceSkuId);
    if (sourceIds.has(sourceSkuId)) throw new Error('Исходный физический вариант нельзя учитывать дважды.');
    sourceIds.add(sourceSkuId);
    quantity(variant.available); quantity(variant.marketplaceBudget);
    if (variant.marketplaceBudget > variant.available) throw new Error('Доля площадки превышает доступный физический остаток.');
    const effectiveShares = exceptions.get(sourceSkuId) ?? defaults;
    if (!Array.isArray(variant.targets) || variant.targets.length !== defaults.length) throw new Error('Подтвердите все карточки этого размера и цвета.');
    const targetsByKey = new Map<string, DuplicateVariant['targets'][number]>();
    for (const target of variant.targets) {
      const key = identity(target.targetKey), targetId = identity(target.targetId);
      if (target.confirmed !== true || typeof target.requiresRelabel !== 'boolean') throw new Error('Подтвердите соответствие и необходимость переклейки.');
      if (targetsByKey.has(key) || destinationIds.has(targetId)) throw new Error('Целевая карточка уже использована в другом варианте.');
      targetsByKey.set(key, target); destinationIds.add(targetId);
    }
    const divided = effectiveShares.map(share => {
      const target = targetsByKey.get(share.targetKey);
      if (!target) throw new Error('Соответствие не входит в выбранную группу карточек.');
      const product = BigInt(variant.marketplaceBudget) * BigInt(share.percent);
      return { ...target, percent: share.percent, quantity: Number(product / 100n), remainder: Number(product % 100n) };
    });
    // Largest remainder with a stable key tie-break keeps retries independent of UI sort order.
    let remaining = variant.marketplaceBudget - sum(divided.map(t => t.quantity));
    const priority = [...divided].sort((a, b) => b.remainder - a.remainder || (a.targetKey < b.targetKey ? -1 : a.targetKey > b.targetKey ? 1 : 0));
    for (const target of priority) { if (remaining-- <= 0) break; target.quantity++; }
    const targets = divided.map(({ remainder: _, ...target }) => target);
    return { sourceSkuId, size: variant.size, available: variant.available, marketplaceBudget: variant.marketplaceBudget,
      outsideMarketplace: variant.available - variant.marketplaceBudget, individual: exceptions.has(sourceSkuId), targets,
      relabelQuantity: sum(targets.filter(t => t.requiresRelabel).map(t => t.quantity)) };
  });
  if ([...exceptions.keys()].some(id => !sourceIds.has(id))) throw new Error('Исключение ссылается на отсутствующий вариант. Обновите группу.');
  return { rows, totalAllocated: sum(rows.map(r => r.marketplaceBudget)), totalRelabel: sum(rows.map(r => r.relabelQuantity)) };
}
