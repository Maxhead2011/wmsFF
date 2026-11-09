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

// FIX: an owner-approved single unit is an exception for this task, never receipt-wide approval.
export async function readPvzApprovedReceiptSource(db: any, input: any) {
  if (!pvzLossEnabled() || !input || !db.fbsTsdAssembly?.findUnique) return null;
  const task = typeof input === 'string' ? await db.fbsTsdAssembly.findUnique({where:{id:input}}) : input;
  if (!task?.id || task.itemCount !== 1 || !['RESERVED','IN_PROGRESS'].includes(task.status) ||
      !await isPvzLossTask(db,task)) return null;
  const records=await db.systemSetting.findMany({where:{key:{in:[pvzLossKey(task.requestId)]}}});
  const value=records.find((r:any)=>r.key===pvzLossKey(task.requestId))?.value;
  const approval=value?.receiptSourceApproval;
  if (!approval || value.taskId!==task.id || approval.taskId!==task.id || approval.skuId!==task.skuId || approval.quantity!==1 ||
      !approval.boxId || !approval.approvedByUserId || !approval.approvedAt ||
      !Number.isFinite(Date.parse(approval.approvedAt)) || task.sourceSkuId || task.relabelRequired ||
      (task.reservedBoxId && task.reservedBoxId!==approval.boxId) ||
      (task.boxId && task.boxId!==approval.boxId)) return null;
  const box=await db.box.findUnique({where:{id:approval.boxId}});
  if (!box || box.clientId!==task.clientId || box.warehouseId!==value.warehouseId ||
      ['deleted','archived','shipped'].includes(box.status)) return null;
  return box;
}

// FIX: explicit source remains scannable without inventing pallet placement or touching other stock.
export async function resolvePvzReceiptStockSource(service: any, task: any) {
  const box=await readPvzApprovedReceiptSource(service.prisma,task);
  if (!box) return null;
  const [balance,reservations]=await Promise.all([
    service.prisma.stockBalance.aggregate({where:{clientId:task.clientId,warehouseId:box.warehouseId,
      skuId:task.skuId,boxId:box.id,status:'AVAILABLE'},_sum:{quantity:true}}),
    service.fbsTsdReservationRows({clientId:task.clientId,skuId:task.skuId,excludeTaskId:task.id}),
  ]);
  const reserved=reservations.filter((r:any)=>r.boxId===box.id).reduce((n:number,r:any)=>n+r.itemCount,0);
  if ((balance._sum.quantity||0)-reserved<1) return null;
  return {sourceSkuId:null,sourceProductName:null,sourceArticle:null,sourceBarcodes:[],
    storageBoxes:[{code:box.code,quantity:1,status:'AVAILABLE'}],withoutBoxQuantity:0,relabelRequired:false};
}

// FIX: a worker can open a proven urgent delivery outside the ordinary fixed window.
export async function isPvzLossRequest(db: any, requestId: string, clientId: string) {
  if (!pvzLossEnabled() || !db.systemSetting?.findMany) return false;
  const records = await db.systemSetting.findMany({where:{key:{in:[pvzLossKey(requestId)]}}});
  const value=records[0]?.value;
  if (!value?.taskId) return false;
  const task=await db.fbsTsdAssembly.findUnique({where:{id:value.taskId}});
  return Boolean(task && task.requestId===requestId && task.clientId===clientId && await isPvzLossTask(db,task));
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
