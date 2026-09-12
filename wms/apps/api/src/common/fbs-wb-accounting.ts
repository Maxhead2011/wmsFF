export const FBS_WB_ACCOUNTED = 'WB_ACCOUNTED';
export const FBS_WB_ACCOUNTED_ACTION = 'FBS_WB_ORDER_ACCOUNTED';

// FIX: only our explicitly enabled FBS workflow offers manager accounting.
export function fbsWbAccountingEnabled() {
  return process.env.WMS_FBS_NO_STOCK_TRANSFER_ENABLED === 'true' &&
    process.env.WMS_FBS_RESHIPMENT_ENABLED === 'true' &&
    process.env.WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED === 'true';
}

export function isFbsWbAccounted(row?: { marketplace?: string | null; syncStatus?: string | null } | null) {
  return row?.marketplace === 'WILDBERRIES' && row.syncStatus === FBS_WB_ACCOUNTED;
}

// FIX: absence of transfer permission alone is insufficient (cancellations are excluded).
export function isFbsWbAccountingStatus(status?: { supplierStatus?: string | null; wbStatus?: string | null } | null) {
  return status?.supplierStatus === 'complete' && ['sorted', 'sold', 'ready_for_pickup', 'accepted_by_carrier'].includes(status.wbStatus ?? '');
}

export function isFbsWbAccountingUntouched(task: {
  status: string; itemCount: number; boxId?: string | null; barcode?: string | null;
  sourceBarcode?: string | null; kiz?: string | null; completedAt?: Date | null;
  sourceBoxPending?: boolean; relabelConfirmedAt?: Date | null; cargoPackingId?: string | null;
  cargoPackedAt?: Date | null; marketplaceSubmittedAt?: Date | null;
  stickerBarcode?: string | null; stickerPartA?: string | null; stickerPartB?: string | null;
}) {
  return ['WAITING_STOCK', 'RESERVED', 'RELEASED'].includes(task.status) && task.itemCount === 1 &&
    !task.boxId && !task.barcode && !task.sourceBarcode && !task.kiz && !task.completedAt &&
    !task.sourceBoxPending && !task.relabelConfirmedAt && !task.cargoPackingId && !task.cargoPackedAt &&
    !task.marketplaceSubmittedAt && !task.stickerBarcode && !task.stickerPartA && !task.stickerPartB;
}
