type Reserve = { mode: 'NONE' | 'UNITS' | 'PERCENT'; value: number; lowStock?: { threshold: number; reserveUnits: number } };
type DisplayPlan = { quantities?: unknown; reserve?: Reserve; skuRules?: Map<string, { reserve?: Reserve | null; blocked?: boolean }> };

// FIX: display the effective plan's reserve, including per-SKU overrides. Plans which
// already reserved a shared pool carry an explicit NONE override: never deduct twice.
export function fbsStockReserveDisplay(available: number, skuId: string, plan: DisplayPlan) {
  const quantity = Number.isFinite(available) ? Math.max(0, Math.trunc(available)) : 0;
  const sku = plan.skuRules?.get(skuId);
  const rule: Reserve = sku?.blocked ? { mode: 'PERCENT', value: 100 }
    : sku?.reserve ?? plan.reserve ?? { mode: 'NONE', value: 0 };
  const reserve = rule.lowStock && quantity < rule.lowStock.threshold ? rule.lowStock.reserveUnits
    : rule.mode === 'PERCENT' ? Math.ceil(quantity * rule.value / 100)
    : rule.mode === 'UNITS' ? rule.value : 0;
  const sellable = Math.max(0, quantity - reserve);
  return { safetyReserve: quantity - sellable, sellable };
}
