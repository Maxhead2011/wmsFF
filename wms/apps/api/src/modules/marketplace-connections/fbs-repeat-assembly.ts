import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

// FIX: opt-in only; deployments for the sold WMS keep their existing workflow.
export function assertRepeatAssemblyEnabled() {
  if (process.env.WMS_FBS_REPEAT_ASSEMBLY_ENABLED !== 'true') {
    throw new ForbiddenException('Отдельная повторная сборка не включена для этой WMS.');
  }
}

type CompletedAttempt = {
  id: string;
  status: string;
  barcode: string | null;
  requiresKiz: boolean;
  kiz: string | null;
  wbMetaStatus: string;
  completedAt: Date | null;
  itemCount: number;
  cargoPackingId?: string | null;
};

export function assertRepeatCandidate(
  task: CompletedAttempt,
  wb: { supplierStatus: string; wbStatus: string } | null,
) {
  if (task.status !== 'COMPLETED' || !task.completedAt || !task.barcode ||
      (task.requiresKiz && (!task.kiz || task.wbMetaStatus !== 'ACCEPTED'))) {
    throw new BadRequestException('Повторная сборка разрешена только после завершённой предыдущей попытки.');
  }
  if (task.itemCount !== 1) {
    throw new BadRequestException('Повторная сборка поддерживает только поштучные заказы WB.');
  }
  if (task.cargoPackingId) {
    throw new BadRequestException('Заказ уже включён в грузокороб. Отдельная повторная упаковка грузомест пока не поддерживается; прежний грузокороб не изменён.');
  }
  if (!wb || wb.supplierStatus !== 'complete' || wb.wbStatus !== 'waiting') {
    throw new BadRequestException('WB не подтверждает состояние complete/waiting. Отменённый или уже доставленный заказ нельзя собирать повторно.');
  }
}

// FIX: old movement/history idempotency keys remain attached to the old id.
// Do not mutate the snapshot, reset stock, return old marks or rewrite WB here.
export function createRepeatAttemptData(
  previous: Pick<CompletedAttempt, 'id' | 'requiresKiz'>,
  id: string,
  requestId: string,
  requestItemId: string,
  createdAt: Date,
) {
  if (!id || id === previous.id) throw new BadRequestException('Для повторной сборки требуется новый идентификатор.');
  return {
    id, requestId, requestItemId, createdAt,
    status: 'WAITING_STOCK', deviceCode: 'AUTO', workerUserId: null, workerName: null,
    startedAt: null, reservedBoxId: null, reservedBoxCode: null, reservedAt: null,
    boxId: null, boxCode: null, sourceBoxPending: false, sourceBarcode: null, barcode: null,
    sourceSkuId: null, sourceProductName: null, sourceArticle: null, sourceBarcodes: [],
    storageBoxes: [], relabelRequired: false, relabelConfirmedAt: null,
    kiz: null, wbMetaStatus: previous.requiresKiz ? 'PENDING' : 'NOT_REQUIRED',
    stickerPartA: null, stickerPartB: null, stickerBarcode: null,
    marketplaceSubmittedAt: null, marketplaceLabelBase64: null,
    marketplaceLabelContentType: null, marketplaceSubmitError: null,
    cargoPackingId: null, cargoPackedAt: null, cargoPackedByUserId: null, cargoPackedByName: null,
    errorMessage: null, completedAt: null,
  };
}

export function repeatSelectionFingerprint(
  clientId: string,
  warehouseId: string,
  orders: ReadonlyArray<{ connectionId: string; id: string; assemblyId?: string | null }>,
) {
  const keys = [...new Set(orders.map(order => JSON.stringify([
    order.connectionId, order.id, order.assemblyId,
  ])))].sort();
  return createHash('sha256').update(JSON.stringify([clientId, warehouseId, keys])).digest('hex');
}
