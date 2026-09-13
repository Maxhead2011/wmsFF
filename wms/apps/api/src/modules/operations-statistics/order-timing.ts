// FIX: use marketplace facts only, never a WMS import, planned date or assembly time.
export type SourceOrderTiming = { placedAt?: string | null; handedOverAt?: string | null; warehouseId?: string | null; warehouseName?: string | null };
export function validDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
export function timingSnapshot(source?: SourceOrderTiming) {
  const placedAt = validDate(source?.placedAt), handedOverAt = validDate(source?.handedOverAt);
  return {
    ...(placedAt ? { orderPlacedAt: placedAt } : {}), ...(handedOverAt ? { handedOverAt } : {}),
    ...(source?.warehouseId ? { sellerWarehouseId: source.warehouseId } : {}),
    ...(source?.warehouseName ? { sellerWarehouseName: source.warehouseName } : {}),
  };
}
export const TIMING_ZONES = [
  { label: '0–14 ч', color: 'green' }, { label: '14–18 ч', color: 'yellow' },
  { label: '18–24 ч', color: 'orange' }, { label: '24–48 ч', color: 'red' }, { label: '48+ ч', color: 'darkred' },
] as const;
export function bucketIndex(elapsedMs: number) {
  const hours = elapsedMs / 3_600_000;
  return hours < 14 ? 0 : hours < 18 ? 1 : hours < 24 ? 2 : hours < 48 ? 3 : 4;
}
export type TimingObservation = { state: 'shipped' | 'pending' | 'cancelled' | 'unknown'; elapsedMs: number | null;
  receipt?: 'confirmed' | 'waiting' | 'reshipment' | 'cancelled' | 'unknown'; basis?: 'order-scan' | 'supply-scan' | null };
export function summarizeOrders(orders: TimingObservation[]) {
  const buckets = TIMING_ZONES.map(zone => ({ ...zone, count: 0, percent: 0 }));
  let timedShipped = 0, pending = 0, cancelled = 0, unknown = 0, pendingOver24h = 0, elapsedSum = 0;
  const acceptance = { confirmed: 0, waiting: 0, reshipment: 0, cancelled: 0, unknown: 0 };
  const timingSources = { orderScan: 0, supplyScan: 0 };
  for (const order of orders) {
    acceptance[order.receipt ?? 'unknown']++;
    if (order.state === 'cancelled') { cancelled++; continue; }
    if (order.state === 'unknown' || order.elapsedMs === null || order.elapsedMs < 0 || !Number.isFinite(order.elapsedMs)) { unknown++; continue; }
    if (order.state === 'pending') { pending++; if (order.elapsedMs >= 24 * 3_600_000) pendingOver24h++; continue; }
    timedShipped++; elapsedSum += order.elapsedMs; buckets[bucketIndex(order.elapsedMs)].count++;
    if (order.basis === 'order-scan') timingSources.orderScan++;
    if (order.basis === 'supply-scan') timingSources.supplyScan++;
  }
  for (const bucket of buckets) bucket.percent = timedShipped ? Math.round(bucket.count / timedShipped * 1000) / 10 : 0;
  return { total: orders.length, timedShipped, pending, pendingOver24h, cancelled, unknown, acceptance, timingSources,
    averageHours: timedShipped ? Math.round(elapsedSum / timedShipped / 3_600_000 * 10) / 10 : null, buckets };
}
