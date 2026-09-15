import { BadRequestException } from '@nestjs/common';

type PickTask = {
  marketplace: string; itemCount: number; barcode: string | null; status: string;
  scannedItemCount?: number; requiresKiz: boolean; relabelRequired?: boolean;
};

// FIX: opt in only on our deployment; WB and the sold VM retain their behavior.
export function ozonTsdPickingEnabled(task: Pick<PickTask, 'marketplace'>) {
  return task.marketplace === 'OZON' && process.env.WMS_OZON_TSD_UNIT_SCANS === 'true';
}

export function ozonScannedItemCount(task: PickTask) {
  if (task.status === 'COMPLETED') return Math.max(1, task.itemCount);
  // FIX: clearing the barcode on release/undo also invalidates old scan progress.
  // An active legacy task with a barcode proves exactly one scan, never N scans.
  return task.barcode ? Math.min(Math.max(1, task.itemCount), Math.max(1, task.scannedItemCount ?? 0)) : 0;
}

export function requireOzonItemsScanned(task: PickTask) {
  if (!ozonTsdPickingEnabled(task) || task.status === 'COMPLETED') return;
  const scanned = ozonScannedItemCount(task);
  if (scanned < Math.max(1, task.itemCount)) {
    throw new BadRequestException(`Отсканировано ${scanned} из ${task.itemCount} ед. Отсканируйте ШК каждой оставшейся единицы.`);
  }
  // FIX: the legacy single-KIZ/relabel fields cannot prove multiple marked units.
  if (task.itemCount > 1 && (task.requiresKiz || task.relabelRequired)) {
    throw new BadRequestException('Заказ Ozon с несколькими КИЗами или переклейкой требует раздельной сборки. Передайте заказ менеджеру.');
  }
}
