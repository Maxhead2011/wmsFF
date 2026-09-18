export type AvailabilityDay = { skuId: string; warehouseId: string; day: string; observedMask: number; positiveMask: number };
export const moscowDay = (time: number) => new Date(time + 3 * 3600000).toISOString().slice(0, 10);
export function countHours(mask: number) { let n = mask & 0xffffff, count = 0; while (n) { count += n & 1; n >>>= 1; } return count; }

// FIX: unknown hours are not zero stock; only sufficiently observed days enter demand rates.
export function stockDemandCoverage(skuId: string, warehouseIds: string[], days: AvailabilityDay[], dailyOrders: Map<string, Map<string, number>>, from: string, until: string) {
  const exposure = new Map<string, number>();
  const units = new Map<string, number>();
  const covered = new Map<string, number>();
  const dailyRates = new Map<string, number>();
  let stockoutDays = 0;
  for (const row of days) {
    if (row.skuId !== skuId || !warehouseIds.includes(row.warehouseId) || row.day < from || row.day >= until) continue;
    const observed = countHours(row.observedMask), positive = countHours(row.positiveMask & row.observedMask);
    if (observed < 18) continue;
    const ordered = dailyOrders.get(row.day)?.get(row.warehouseId) ?? 0;
    // Orders on an allegedly all-zero day indicate insufficient temporal resolution.
    if (positive === 0 && ordered > 0) continue;
    covered.set(row.warehouseId, (covered.get(row.warehouseId) ?? 0) + 1);
    if (positive === 0) { stockoutDays++; continue; }
    const availableDayFraction = positive / 24;
    exposure.set(row.warehouseId, (exposure.get(row.warehouseId) ?? 0) + availableDayFraction);
    units.set(row.warehouseId, (units.get(row.warehouseId) ?? 0) + ordered);
    dailyRates.set(row.day, (dailyRates.get(row.day) ?? 0) + ordered / availableDayFraction);
  }
  const rates = new Map(warehouseIds.map(id => [id, Math.round(1000 * (units.get(id) ?? 0) / (exposure.get(id) || 1))]));
  // A warehouse observed only without stock cannot be assigned zero demand.
  const sufficient = warehouseIds.length > 0 && warehouseIds.every(id => (covered.get(id) ?? 0) >= 7 && (exposure.get(id) ?? 0) >= 3);
  return { sufficient, rates, dailyRates: [...dailyRates.values()], stockoutDays, coveredDays: Math.min(...warehouseIds.map(id => covered.get(id) ?? 0), 30) };
}

// FIX: bounded transfers preserve exactly 100% without exceeding the per-warehouse step.
export function limitShareChange(current: Array<{ warehouseId: string; percent: number }>, suggested: Array<{ warehouseId: string; percent: number }>, maxStep = 10) {
  if (!Number.isInteger(maxStep) || maxStep < 0 || maxStep > 100) throw new Error('Шаг долей должен быть от 0 до 100 п.п.');
  const rows = current.map(row => ({ ...row, initial: row.percent, desired: suggested.find(s => s.warehouseId === row.warehouseId)?.percent ?? row.percent }));
  for (let i = 0; i < 100; i++) {
    const donor = rows.filter(r => r.percent > r.desired && r.initial - r.percent < maxStep).sort((a, b) => (b.percent - b.desired) - (a.percent - a.desired) || a.warehouseId.localeCompare(b.warehouseId))[0];
    const recipient = rows.filter(r => r.percent < r.desired && r.percent - r.initial < maxStep).sort((a, b) => (b.desired - b.percent) - (a.desired - a.percent) || a.warehouseId.localeCompare(b.warehouseId))[0];
    if (!donor || !recipient) break;
    donor.percent--; recipient.percent++;
  }
  return rows.map(({ warehouseId, percent }) => ({ warehouseId, percent }));
}
