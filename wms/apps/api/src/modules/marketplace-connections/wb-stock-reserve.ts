export type WbStockReserve = { mode: 'NONE' | 'UNITS' | 'PERCENT'; value: number };
export const NO_WB_RESERVE: WbStockReserve = { mode: 'NONE', value: 0 };
export const fineStockSettingsEnabled = () => process.env.WMS_WB_STOCK_FINE_SETTINGS === 'true';

// FIX: invalid saved settings must stop publication, never silently remove a reserve.
export function parseWbStockReserve(input: unknown): WbStockReserve {
  if (!input || typeof input !== 'object') throw new Error('Укажите режим и величину резерва.');
  const { mode, value } = input as WbStockReserve;
  if (!['NONE', 'UNITS', 'PERCENT'].includes(mode) || !Number.isSafeInteger(value) || value < 0 ||
      value > (mode === 'PERCENT' ? 100 : 1_000_000) || (mode === 'NONE' && value !== 0)) {
    throw new Error('Резерв: целое число от 0 до 100 для процентов или от 0 до 1000000 для штук.');
  }
  return { mode, value };
}

export function wbStockAfterReserve(available: number, rule: WbStockReserve = NO_WB_RESERVE) {
  const quantity = Number.isFinite(available) ? Math.max(0, Math.trunc(available)) : 0;
  const reserve = rule.mode === 'PERCENT' ? Math.ceil(quantity * rule.value / 100) : rule.mode === 'UNITS' ? rule.value : 0;
  return Math.max(0, quantity - reserve);
}

// FIX: explicit product exclusion wins over both client and product reserve settings.
export function reserveForSku(plan: { reserve?: WbStockReserve; skuRules?: Map<string, { reserve: WbStockReserve | null; blocked: boolean }> }, skuId: string): WbStockReserve {
  const rule = plan.skuRules?.get(skuId);
  return rule?.blocked ? { mode: 'PERCENT', value: 100 } : rule?.reserve ?? plan.reserve ?? NO_WB_RESERVE;
}
