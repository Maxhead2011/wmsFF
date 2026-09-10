import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';

export type ReshipmentMode = 'SAME_ITEM' | 'NEW_ITEM';
export const reshipmentHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// FIX: deployment opt-in keeps the sold WMS unchanged.
export function assertReshipmentEnabled() {
  if (process.env.WMS_FBS_RESHIPMENT_ENABLED !== 'true') throw new ForbiddenException('Повторная отгрузка не включена для этой WMS.');
}
export function reshipmentCycle(task: { id: string; requestId: string; supplyId: string | null }) {
  // FIX: WB/sync can change supplyId while this cycle is still in flight.
  return reshipmentHash([task.id, task.requestId]);
}
export function reshipmentFingerprint(clientId: string, warehouseId: string, mode: ReshipmentMode,
  orders: { id: string; connectionId: string; cycle: string }[]) {
  return reshipmentHash([clientId, warehouseId, mode,
    orders.map(row => JSON.stringify([row.connectionId, row.id, row.cycle])).sort()]);
}
// FIX: discovery history is not a work list. WB complete means "in delivery", not received.
// This presentation classifier deliberately does not grant permission to create/resume.
export function reshipmentVisibility(wb: { supplierStatus: string; wbStatus: string } | null,
  directListed: boolean, returnedEvidence: boolean): 'ACTIONABLE' | 'HIDDEN' | 'UNVERIFIED' {
  if (!wb) return 'UNVERIFIED';
  if (['cancel', 'cancel_carrier'].includes(wb.supplierStatus) ||
    ['sold', 'canceled', 'canceled_by_client', 'declined_by_client', 'defect', 'canceled_by_carrier'].includes(wb.wbStatus)) return 'HIDDEN';
  if (!['new', 'confirm', 'complete'].includes(wb.supplierStatus) ||
    !['waiting', 'sorted', 'ready_for_pickup', 'postponed_delivery', 'accepted_by_carrier', 'sent_to_carrier'].includes(wb.wbStatus)) return 'UNVERIFIED';
  if (wb.wbStatus !== 'waiting') return 'HIDDEN';
  if (wb.supplierStatus === 'complete' && directListed) return 'ACTIONABLE';
  if (wb.supplierStatus === 'confirm' && (directListed || returnedEvidence)) return 'ACTIONABLE';
  return 'HIDDEN';
}
export function reshipmentEligibility(
  task: { status: string; barcode: string | null; kiz: string | null; requiresKiz: boolean;
    completedAt: Date | null; itemCount: number; cargoPackingId: string | null; supplyId: string | null;
    boxId?: string | null; sourceBarcode?: string | null; startedAt?: Date | null },
  link: { lastSupplierStatus: string | null; lastCategory: string | null; lastSupplyId: string | null; syncStatus: string },
  wb: { supplierStatus: string; wbStatus: string } | null, directCandidate: boolean,
  mode: ReshipmentMode = 'SAME_ITEM', returnedEvidence = false,
): string | null {
  if (!wb || wb.wbStatus !== 'waiting' || !['complete', 'confirm'].includes(wb.supplierStatus)) {
    return 'WB не подтверждает заказ для повторной сборки: отменён, получен или статус недоступен.';
  }
  const returned = wb.supplierStatus === 'confirm' && (returnedEvidence || (link.lastSupplierStatus === 'complete' &&
    link.lastCategory === 'shipped' && !!link.lastSupplyId && link.lastSupplyId === task.supplyId));
  if (!(directCandidate && wb.supplierStatus === 'complete') && !returned) {
    return 'Нет подтверждения WB о повторной отгрузке или сохранённого перехода из доставки в сборку.';
  }
  if (['REMOVED', 'MOVING', 'RETURN_REQUIRED'].includes(link.syncStatus)) return 'Заказ ожидает возврата или изменения привязки.';
  if (task.itemCount !== 1) return 'Поддерживаются только поштучные заказы WB.';
  if (task.cargoPackingId) return 'Заказ находится в грузокоробе: сначала требуется явно распаковать его.';
  // FIX: unpicked orders can receive a NEW_ITEM task, but partial physical scans
  // are not silently discarded. Such tasks do not create completed-attempt history.
  if (mode === 'NEW_ITEM' && ['WAITING_STOCK', 'RESERVED', 'RELEASED'].includes(task.status) &&
    !task.completedAt && !task.barcode && !task.kiz && !task.boxId && !task.sourceBarcode && !task.startedAt) return null;
  if (task.status !== 'COMPLETED' || !task.completedAt || !task.barcode || (task.requiresKiz && !task.kiz)) {
    return 'Предыдущая физическая сборка не завершена или не подтверждена сканами.';
  }
  return null;
}
// FIX: after a timeout an empty name search is NOT evidence that POST failed.
export function supplyRecoveryAction(phase: string, supply: { id: string; done: boolean } | null) {
  if (supply?.done) throw new ConflictException('Поставка уже закрыта. Требуется сверка повторной отгрузки.');
  if (supply) return 'USE_EXISTING' as const;
  return phase === 'PLANNED' ? 'CREATE_ONCE' as const : 'RECONCILE_ONLY' as const;
}
