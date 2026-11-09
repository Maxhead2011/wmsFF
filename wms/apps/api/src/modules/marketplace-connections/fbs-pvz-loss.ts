import { BadRequestException, ForbiddenException } from '@nestjs/common';

const prefix = 'fbs.pvzLossSettlement.';
export const pvzLossKey = (requestId: string) => prefix + requestId;
export const pvzLossEnabled = () => process.env.WMS_FBS_PVZ_LOSS_SETTLEMENT_ENABLED === 'true';
export const pvzOrderKey = (row: { requestId: string; connectionId: string; orderId: string }) =>
  JSON.stringify([row.requestId, row.connectionId, row.orderId]);

// FIX: separate purpose, enabled only on our installation and always with the old label.
export function assertPvzLossMode(dto: { pvzLossSettlement?: boolean; preserveOriginalSticker?: boolean; settlementReason?: string }) {
  if (!dto.pvzLossSettlement) return;
  if (!pvzLossEnabled()) throw new ForbiddenException('Режим довоза ПВЗ не включён для этой WMS.');
  if (!dto.preserveOriginalSticker || !dto.settlementReason?.trim() || dto.settlementReason.trim().length > 1000) {
    throw new BadRequestException('Для довоза ПВЗ нужны прежний стикер и основание.');
  }
}

// FIX: legacy RELEASED/null-KIZ attempts require immutable, exact shipment evidence.
export function assertPvzShipment(task: any, shipment: any, warehouseId: string, wb: any) {
  if (!shipment || !['COMPLETED', 'RELEASED'].includes(task.status) || !task.completedAt ||
      task.itemCount !== 1 || task.cargoPackingId || shipment.quantity !== 1 ||
      shipment.clientId !== task.clientId || shipment.connectionId !== task.connectionId ||
      shipment.orderId !== task.orderId || shipment.assemblyId !== task.id ||
      shipment.requestId !== task.requestId || shipment.warehouseId !== warehouseId || shipment.skuId !== task.skuId ||
      !shipment.shippedAt || !shipment.assemblySnapshot?.barcode ||
      (task.requiresKiz && (!shipment.kiz || shipment.assemblySnapshot.kiz !== shipment.kiz)) ||
      !wb || !['complete', 'cancel', 'canceled', 'cancelled'].includes(wb.supplierStatus) ||
      !['waiting', 'sorted', 'canceled', 'cancelled', 'canceled_by_client', 'declined_by_client', 'canceled_by_carrier'].includes(wb.wbStatus)) {
    throw new BadRequestException('Для довоза ПВЗ не подтверждена точная прежняя отгрузка или статус WB.');
  }
}

// FIX: a trusted server record binds the exception to one request/order. Never infer it from titles/comments.
export async function pvzLossOrderKeys(db: any, rows: readonly any[]): Promise<Set<string>> {
  const result = new Set<string>();
  if (!pvzLossEnabled() || !rows.length || !db.systemSetting?.findMany) return result;
  const ids = [...new Set(rows.map(row => row.requestId).filter(Boolean))];
  if (!ids.length) return result;
  const records = await db.systemSetting.findMany({ where: { key: { in: ids.map(pvzLossKey) } } });
  for (const record of records) {
    const value = record.value;
    if (value?.version !== 1 || value.purpose !== 'PVZ_LOSS_SETTLEMENT' || record.key !== pvzLossKey(value.requestId) ||
        !value.clientId || !value.warehouseId || !value.shipmentId || !value.taskId || !value.originalAttemptId) continue;
    for (const row of rows) {
      if (row.requestId !== value.requestId || row.connectionId !== value.connectionId || row.orderId !== value.orderId ||
          (row.marketplace && row.marketplace !== 'WILDBERRIES') ||
          (row.clientId && row.clientId !== value.clientId) ||
          (row.request?.client?.id && row.request.client.id !== value.clientId) ||
          (row.stockWarehouseId && row.stockWarehouseId !== value.warehouseId) ||
          (row.skuId && row.skuId !== value.skuId) ||
          (row.requestItemId && row.id !== value.taskId)) continue;
      result.add(pvzOrderKey(row));
    }
  }
  return result;
}

export async function isPvzLossTask(db: any, task: any) {
  return (await pvzLossOrderKeys(db, [task])).has(pvzOrderKey(task));
}

// FIX: marketplace refresh may update its actual snapshot, never cancel/auto-finish a local settlement.
export async function syncPvzLossBatch(db: any, requestId: string, orders: readonly any[]) {
  if (!pvzLossEnabled() || !db.systemSetting?.findMany) return false;
  const records = await db.systemSetting.findMany({where:{key:{in:[pvzLossKey(requestId)]}}});
  const value = records[0]?.value;
  if (!value?.taskId) return false;
  const task = await db.fbsTsdAssembly.findUnique({where:{id:value.taskId}});
  if (!task || !await isPvzLossTask(db, task)) throw new BadRequestException('Повреждена привязка довоза ПВЗ; требуется проверка администратора.');
  const link = await db.fbsOrderRequestLink.findUnique({where:{marketplace_connectionId_orderId:{marketplace:'WILDBERRIES',connectionId:task.connectionId,orderId:task.orderId}}});
  if (!link || link.requestId !== requestId || link.clientId !== value.clientId || link.syncStatus !== 'ACTIVE') {
    throw new BadRequestException('Привязка довоза ПВЗ изменилась; автоматическое восстановление запрещено.');
  }
  const remote = orders.find(order=>order.connectionId===task.connectionId && order.id===task.orderId);
  if (remote) await db.fbsOrderRequestLink.update({where:{id:link.id},data:{lastCategory:remote.category,lastSupplierStatus:remote.supplierStatus,lastWbStatus:remote.wbStatus,lastSeenAt:new Date()}});
  return true;
}
