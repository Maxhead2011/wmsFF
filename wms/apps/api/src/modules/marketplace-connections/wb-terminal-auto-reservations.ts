import { PrismaClient, Prisma } from '@prisma/client';
type RemoteStatus = {supplierStatus: string; wbStatus: string};
const untouched = (task: any) => task && task.marketplace === 'WILDBERRIES' &&
  task.requestId === `AUTO:WILDBERRIES:${task.connectionId}:${task.orderId}` &&
  ['RESERVED', 'WAITING_STOCK'].includes(task.status) &&
  ![task.startedAt, task.completedAt, task.workerUserId, task.boxId, task.barcode, task.sourceBarcode, task.kiz, task.relabelConfirmedAt, task.cargoPackingId, task.marketplaceSubmittedAt].some(Boolean);
const terminal = (status?: RemoteStatus) => status && (
  status.supplierStatus === 'cancel' && ['canceled', 'canceled_by_client', 'declined_by_client'].includes(status.wbStatus) ||
  status.supplierStatus === 'complete' && ['sold', 'sorted', 'ready_for_pickup'].includes(status.wbStatus));

// FIX: old AUTO demand outlives the marketplace order lookback. Close only
// untouched, unlinked demand with a fresh exact terminal response. This never
// returns, picks, ships, or manufactures physical stock or shipment history.
export async function reconcileTerminalAutoReservations(db: PrismaClient, clientId: string,
  read: (apiKey: string, ids: string[]) => Promise<Map<string, RemoteStatus>>) {
  if (process.env.WMS_WB_TERMINAL_AUTO_RESERVATIONS_ENABLED !== 'true') return {checked: 0, released: 0};
  if (!(process.env.WMS_WB_TERMINAL_AUTO_RESERVATION_CLIENTS ?? '').split(',').map(id => id.trim()).includes(clientId)) return {checked: 0, released: 0};
  const tasks = await db.fbsTsdAssembly.findMany({where: {clientId, marketplace: 'WILDBERRIES',
    requestId: {startsWith: 'AUTO:'}, status: {in: ['RESERVED', 'WAITING_STOCK']},
    updatedAt: {lt: new Date(Date.now() - 15 * 60_000)},
    startedAt: null, completedAt: null, boxId: null, barcode: null, sourceBarcode: null, kiz: null, relabelConfirmedAt: null,
  }, orderBy: [{updatedAt: 'asc'}, {id: 'asc'}], take: 1000});
  if (!tasks.length) return {checked: 0, released: 0};
  const connections = await db.clientMarketplaceConnection.findMany({where: {clientId, isActive: true,
    marketplace: 'WILDBERRIES', id: {in: [...new Set(tasks.map(t => t.connectionId))]}}, select: {id: true, clientId: true, apiKey: true}});
  let checked = 0, released = 0;
  for (const connection of connections) {
    if (connection.clientId !== clientId) continue;
    const candidates = tasks.filter(t => t.clientId === clientId && t.connectionId === connection.id && untouched(t));
    if (!candidates.length) continue;
    const statuses = await read(connection.apiKey, candidates.map(t => t.orderId));
    checked += candidates.length;
    for (const task of candidates) {
      const status = statuses.get(task.orderId);
      if (!terminal(status)) continue;
      released += await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "FbsTsdAssembly" WHERE id=${task.id} AND "clientId"=${clientId} FOR UPDATE`;
        const fresh = await tx.fbsTsdAssembly.findUnique({where: {id: task.id}});
        if (!untouched(fresh) || fresh!.clientId !== clientId || fresh!.connectionId !== connection.id ||
          fresh!.orderId !== task.orderId || fresh!.updatedAt.getTime() !== task.updatedAt.getTime()) return 0;
        const evidence = await Promise.all([
          tx.fbsOrderRequestLink.findFirst({where: {clientId, connectionId: connection.id, marketplace: 'WILDBERRIES', orderId: task.orderId}, select: {id: true}}),
          tx.stockMovement.findFirst({where: {clientId, OR: [{sourceDocument: fresh!.requestId}, {idempotencyKey: {startsWith: `fbs-sticker-pick:${task.id}:`}}]}, select: {id: true}}),
          tx.fbsPrintJob.findFirst({where: {assemblyId: task.id}, select: {id: true}}),
          tx.wbOrderShipment.findFirst({where: {clientId, connectionId: connection.id, orderId: task.orderId}, select: {id: true}}),
          tx.shippedKizHistory.findFirst({where: {clientId, OR: [{assemblyId: task.id}, {orderId: task.orderId}]}, select: {id: true}}),
        ]);
        if (evidence.some(Boolean)) return 0;
        const changed = await tx.fbsTsdAssembly.updateMany({where: {id: task.id, updatedAt: fresh!.updatedAt, status: fresh!.status},
          data: {status: 'RELEASED', reservedBoxId: null, reservedBoxCode: null, reservedAt: null,
            errorMessage: `Автоматический резерв снят: WB ${status!.supplierStatus}/${status!.wbStatus}. Физический остаток не изменён.`}});
        if (!changed.count) return 0;
        await tx.auditLog.create({data: {action: 'FBS_TERMINAL_AUTO_RESERVATION_RELEASED', entity: 'FbsTsdAssembly', entityId: task.id,
          payload: {clientId, connectionId: connection.id, orderId: task.orderId, skuId: fresh!.skuId,
            quantity: fresh!.itemCount, beforeStatus: fresh!.status, afterStatus: 'RELEASED', wb: status!, checkedAt: new Date().toISOString(), physicalStockChanged: false}}});
        return 1;
      }, {isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000});
    }
  }
  return {checked, released};
}
