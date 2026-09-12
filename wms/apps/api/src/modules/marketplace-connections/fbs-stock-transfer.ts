import type { FbsTsdAssembly } from '@prisma/client';

export const NO_STOCK_SUPPLY_NAME = 'logoff нет на складе';
export type StockTransferPurpose = 'NO_STOCK' | 'TRANSFER';

// FIX: permit an explicit attempt from delivery; only WB can confirm the actual move.
export function stockTransferBlockedReason(task: FbsTsdAssembly, link: { syncStatus: string; request?: { status: string } },
  wb: { supplierStatus: string; wbStatus: string } | null): string | null {
  if (!wb || wb.wbStatus !== 'waiting' || !['new', 'confirm', 'complete'].includes(wb.supplierStatus)) {
    return 'WB не подтверждает активный заказ: он отменён, получен или уже обрабатывается WB.';
  }
  if (link.syncStatus !== 'ACTIVE') return 'Есть незавершённое изменение привязки заказа.';
  if (link.request && !['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'IN_WORK'].includes(link.request.status)) {
    return 'Исходная заявка уже упакована, закрыта или отменена.';
  }
  if (task.itemCount !== 1) return 'Перенос поддерживает поштучные заказы WB.';
  if (!['WAITING_STOCK', 'RESERVED', 'RELEASED'].includes(task.status) || task.boxId || task.barcode ||
    task.kiz || task.sourceBarcode || task.startedAt || task.completedAt || task.cargoPackingId || task.stickerBarcode ||
    task.stickerPartA || task.stickerPartB) {
    return 'Товар уже отбирали или упаковали. Сначала требуется решение менеджера по физической сборке.';
  }
  return null;
}

type Reservation = { taskId: string; boxId: string | null; itemCount: number };
type Bucket = { skuId: string; boxId: string | null; quantity: number };
// FIX: allocate the selection as a whole, preserving its own reservations and not promising the same unit twice.
export function ordersWithoutTransferStock(orders: { key: string; taskId?: string; skuId: string; itemCount: number }[],
  balances: Bucket[], reservations: Map<string, Reservation[]>, withoutBoxes: boolean): Set<string> {
  const buckets = new Map<string, Bucket & { reserved: Reservation[]; free: number }>();
  for (const balance of balances) {
    const key = JSON.stringify([balance.skuId, withoutBoxes ? null : balance.boxId]);
    const bucket = buckets.get(key) ?? { skuId: balance.skuId, boxId: withoutBoxes ? null : balance.boxId,
      quantity: 0, reserved: [], free: 0 };
    bucket.quantity += balance.quantity; buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.reserved = (reservations.get(bucket.skuId) ?? []).filter(row => withoutBoxes || row.boxId === bucket.boxId);
    bucket.free = Math.max(0, bucket.quantity - bucket.reserved.reduce((sum, row) => sum + row.itemCount, 0));
  }
  const missing = new Set<string>();
  const hasReservation = (order: typeof orders[number]) => (reservations.get(order.skuId) ?? []).some(row => row.taskId === order.taskId);
  for (const order of [...orders].sort((a, b) => Number(hasReservation(b)) - Number(hasReservation(a)) || a.key.localeCompare(b.key))) {
    const candidates = [...buckets.values()].filter(bucket => bucket.skuId === order.skuId).map(bucket => {
      const others = bucket.reserved.filter(row => row.taskId !== order.taskId).reduce((sum, row) => sum + row.itemCount, 0);
      const own = bucket.reserved.filter(row => row.taskId === order.taskId).reduce((sum, row) => sum + row.itemCount, 0);
      return { bucket, credit: Math.min(own, Math.max(0, bucket.quantity - others)) };
    }).sort((a, b) => b.credit - a.credit);
    const candidate = candidates.find(row => row.bucket.free + row.credit >= order.itemCount);
    if (!candidate) missing.add(order.key);
    else candidate.bucket.free = Math.max(0, candidate.bucket.free - Math.max(0, order.itemCount - candidate.credit));
  }
  return missing;
}
