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
