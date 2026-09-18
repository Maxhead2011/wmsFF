import type { WbStockReserve } from './api';

// FIX: keep the preview compact; search still covers all available rows.
export const WB_STOCK_PREVIEW_LIMIT = 30;

// FIX: hide empty stock only in the preview, keeping reserved/blocked goods editable.
export function filterWbStockPreviewRows<T extends { available: number; name: string; barcode: string }>(rows: T[], search: string): T[] {
  const query = search.toLocaleLowerCase();
  return rows.filter(row => row.available > 0 && `${row.name} ${row.barcode}`.toLocaleLowerCase().includes(query));
}

// FIX: preview uses the same integer/largest-remainder rules as publication.
export function wbStockPreview(amount: number, threshold: number, shares: Array<{ warehouseId: string; percent: number; isPrimary: boolean }>) {
  if (!Number.isSafeInteger(amount) || amount < 0 || !shares.length || shares.some(s => !Number.isInteger(s.percent) || s.percent < 0 || s.percent > 100) || shares.reduce((n, s) => n + s.percent, 0) !== 100 || shares.filter(s => s.isPrimary).length !== 1) return null;
  if (amount <= threshold) return shares.map(s => ({ warehouseId: s.warehouseId, amount: s.isPrimary ? amount : 0 }));
  const rows = shares.map((s, index) => ({ warehouseId: s.warehouseId, amount: Math.floor(amount * s.percent / 100), fraction: amount * s.percent / 100 % 1, primary: s.isPrimary, index }));
  const order = [...rows].sort((a, b) => b.fraction - a.fraction || Number(b.primary) - Number(a.primary) || a.index - b.index);
  let remaining = amount - rows.reduce((n, r) => n + r.amount, 0);
  for (let i = 0; remaining > 0; i++, remaining--) order[i % order.length].amount++;
  return rows.map(({ warehouseId, amount }) => ({ warehouseId, amount }));
}

// FIX: the administrator example follows the same strict threshold as server publication.
export function wbReservePreviewAmount(quantity: number, rule: WbStockReserve) {
  const reserve = rule.lowStock && quantity < rule.lowStock.threshold ? rule.lowStock.reserveUnits
    : rule.mode === 'PERCENT' ? Math.ceil(quantity * rule.value / 100) : rule.mode === 'UNITS' ? rule.value : 0;
  return Math.max(0, quantity - reserve);
}
