export type FbsStockAllocationShare = {
  warehouseId: string;
  percent: number;
  isPrimary?: boolean;
};

export type FbsStockAllocationResult = {
  warehouseId: string;
  amount: number;
};

// ADDED: Split one physical WMS balance without ever publishing more than it contains.
export function allocateFbsStock(
  sellableAmount: number,
  lowStockThreshold: number,
  shares: FbsStockAllocationShare[],
): FbsStockAllocationResult[] {
  const amount = nonNegativeInteger(sellableAmount);
  const threshold = nonNegativeInteger(lowStockThreshold);
  const normalized = normalizeShares(shares);
  if (normalized.length === 0) return [];

  const primary = normalized.find((share) => share.isPrimary) ?? normalized[0]!;
  if (amount <= threshold) {
    return normalized.map((share) => ({
      warehouseId: share.warehouseId,
      amount: share.warehouseId === primary.warehouseId ? amount : 0,
    }));
  }

  const rows = normalized.map((share, index) => {
    const exact = (amount * share.percent) / 100;
    const floor = Math.floor(exact);
    return {
      warehouseId: share.warehouseId,
      amount: floor,
      fraction: exact - floor,
      primary: share.warehouseId === primary.warehouseId,
      index,
    };
  });
  let remainder = amount - rows.reduce((sum, row) => sum + row.amount, 0);
  const remainderOrder = [...rows].sort(
    (left, right) =>
      right.fraction - left.fraction ||
      Number(right.primary) - Number(left.primary) ||
      left.index - right.index,
  );
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
    remainderOrder[index % remainderOrder.length]!.amount += 1;
  }
  return rows.map((row) => ({ warehouseId: row.warehouseId, amount: row.amount }));
}

// ADDED: Recommendation only; callers must explicitly save it before it affects WB.
export function recommendFbsStockPercentages(
  warehouseIds: string[],
  demandByWarehouse: ReadonlyMap<string, number>,
): Array<{ warehouseId: string; percent: number }> {
  const ids = [...new Set(warehouseIds.map((value) => value.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const weights = ids.map((warehouseId) => ({
    warehouseId,
    weight: nonNegativeInteger(demandByWarehouse.get(warehouseId) ?? 0),
  }));
  const totalWeight = weights.reduce((sum, row) => sum + row.weight, 0);
  const effective = totalWeight > 0
    ? weights
    : weights.map((row) => ({ ...row, weight: 1 }));
  const effectiveTotal = effective.reduce((sum, row) => sum + row.weight, 0);
  const rows = effective.map((row, index) => {
    const exact = (row.weight * 100) / effectiveTotal;
    const floor = Math.floor(exact);
    return { ...row, percent: floor, fraction: exact - floor, index };
  });
  let remainder = 100 - rows.reduce((sum, row) => sum + row.percent, 0);
  const order = [...rows].sort(
    (left, right) => right.fraction - left.fraction || left.index - right.index,
  );
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
    order[index % order.length]!.percent += 1;
  }
  return rows.map((row) => ({ warehouseId: row.warehouseId, percent: row.percent }));
}

export function validateFbsStockAllocationShares(shares: FbsStockAllocationShare[]) {
  const normalized = normalizeShares(shares);
  if (normalized.length === 0) throw new Error('Нужен хотя бы один рабочий склад WB.');
  if (normalized.filter((share) => share.isPrimary).length !== 1) {
    throw new Error('Выберите ровно один основной склад WB.');
  }
  const total = normalized.reduce((sum, share) => sum + share.percent, 0);
  if (total !== 100) throw new Error(`Сумма долей складов должна быть 100%, сейчас ${total}%.`);
  return normalized;
}

function normalizeShares(shares: FbsStockAllocationShare[]) {
  const seen = new Set<string>();
  return shares.map((share) => {
    const warehouseId = share.warehouseId.trim();
    if (!warehouseId || seen.has(warehouseId)) {
      throw new Error('Рабочие склады WB не должны повторяться.');
    }
    seen.add(warehouseId);
    if (!Number.isInteger(share.percent) || share.percent < 0 || share.percent > 100) {
      throw new Error('Доля каждого склада должна быть целым числом от 0 до 100.');
    }
    return { warehouseId, percent: share.percent, isPrimary: Boolean(share.isPrimary) };
  });
}

function nonNegativeInteger(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
