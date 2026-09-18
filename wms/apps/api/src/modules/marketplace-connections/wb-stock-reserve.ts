export type WbStockReserve = { mode: 'NONE' | 'UNITS' | 'PERCENT'; value: number; lowStock?: { threshold: number; reserveUnits: number } };
export const NO_WB_RESERVE: WbStockReserve = { mode: 'NONE', value: 0 };
export const fineStockSettingsEnabled = () => process.env.WMS_WB_STOCK_FINE_SETTINGS === 'true';

// FIX: invalid saved settings must stop publication, never silently remove a reserve.
export function parseWbStockReserve(input: unknown): WbStockReserve {
  if (!input || typeof input !== 'object') throw new Error('Укажите режим и величину резерва.');
  const { mode, value, lowStock } = input as WbStockReserve;
  if (!['NONE', 'UNITS', 'PERCENT'].includes(mode) || !Number.isSafeInteger(value) || value < 0 ||
      value > (mode === 'PERCENT' ? 100 : 1_000_000) || (mode === 'NONE' && value !== 0)) {
    throw new Error('Резерв: целое число от 0 до 100 для процентов или от 0 до 1000000 для штук.');
  }
  // FIX: a malformed optional rule must not silently fall back to the main reserve.
  if (lowStock !== undefined) {
    if (!lowStock || typeof lowStock !== 'object' || Array.isArray(lowStock) ||
        !Number.isSafeInteger(lowStock.threshold) || lowStock.threshold < 1 || lowStock.threshold > 1_000_000 ||
        !Number.isSafeInteger(lowStock.reserveUnits) || lowStock.reserveUnits < 0 || lowStock.reserveUnits > 1_000_000) {
      throw new Error('Малый остаток: порог — целое число от 1 до 1000000, резерв — от 0 до 1000000 штук.');
    }
    return { mode, value, lowStock: { threshold: lowStock.threshold, reserveUnits: lowStock.reserveUnits } };
  }
  return { mode, value };
}

export function wbStockAfterReserve(available: number, rule: WbStockReserve = NO_WB_RESERVE) {
  const quantity = Number.isFinite(available) ? Math.max(0, Math.trunc(available)) : 0;
  // FIX: apply the low-stock replacement once to the available pool, before warehouse splitting.
  const reserve = rule.lowStock && quantity < rule.lowStock.threshold ? rule.lowStock.reserveUnits
    : rule.mode === 'PERCENT' ? Math.ceil(quantity * rule.value / 100) : rule.mode === 'UNITS' ? rule.value : 0;
  return Math.max(0, quantity - reserve);
}

// FIX: explicit product exclusion wins over both client and product reserve settings.
export function reserveForSku(plan: { reserve?: WbStockReserve; skuRules?: Map<string, { reserve: WbStockReserve | null; blocked: boolean }> }, skuId: string): WbStockReserve {
  const rule = plan.skuRules?.get(skuId);
  return rule?.blocked ? { mode: 'PERCENT', value: 100 } : rule?.reserve ?? plan.reserve ?? NO_WB_RESERVE;
}
