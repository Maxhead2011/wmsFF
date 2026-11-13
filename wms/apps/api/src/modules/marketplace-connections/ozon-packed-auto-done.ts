import { ClientRequestStatus, Prisma } from '@prisma/client';

// FIX: opt-in for our installation; remote acceptance changes no warehouse ledger.
export const ozonPackedAutoDoneEnabled = () => process.env.WMS_OZON_PACKED_AUTO_DONE_ENABLED === 'true';
type Order = { id: string; connectionId: string; marketplace: string; supplierStatus: string; wbStatus: string };
type Request = { id: string; clientId: string; type: string; status: string; updatedAt: Date;
  fbsEmergencyAssemblyAt: Date | null; fbsOrderLinks: Array<{ connectionId: string; orderId: string; marketplace: string; syncStatus: string }> };

export async function closeOzonPackedRequest(tx: Prisma.TransactionClient, request: Request,
  orders: Order[], explicitBatch: boolean) {
  if (!ozonPackedAutoDoneEnabled() || explicitBatch || request.fbsEmergencyAssemblyAt ||
    request.type !== 'OUTBOUND' || !(process.env.WMS_FBS_ACTION_STATUS_ENABLED === 'true'
      ? ['SUBMITTED','IN_REVIEW','APPROVED','IN_WORK','PACKED'].includes(request.status)
      : request.status === 'PACKED')) return false;
  if (request.fbsOrderLinks.some(link => link.syncStatus === 'MOVING')) return false;
  const links = request.fbsOrderLinks.filter(link => !['REMOVED', 'ADMIN_REMOVED'].includes(link.syncStatus));
  if (!links.length) return false;
  const accepted: Order[] = [];
  for (const link of links) {
    const matches = orders.filter(order => order.connectionId === link.connectionId && order.id === link.orderId);
    if (link.marketplace !== 'OZON' || matches.length !== 1) return false;
    const order = matches[0];
    if (order.marketplace !== 'OZON' || !['delivering', 'delivered'].includes(order.supplierStatus) ||
      order.wbStatus !== order.supplierStatus) return false;
    accepted.push(order);
  }
  const client = await tx.client.findUnique({ where: { id: request.clientId }, select: { isDemo: true } });
  if (!client || client.isDemo) return false;
  // FIX: caller holds the request lock; CAS also protects a stale snapshot/retry.
  // FIX: compare and record the actual pre-handover stage; never touch inventory.
  const previousStatus = request.status as ClientRequestStatus;
  const changed = await tx.clientRequest.updateMany({ where: { id: request.id, clientId: request.clientId,
    status: previousStatus, updatedAt: request.updatedAt, fbsEmergencyAssemblyAt: null }, data: { status: 'DONE' } });
  if (changed.count !== 1) return false;
  // FIX: persist the marketplace evidence in the same transaction as closure.
  for (const order of accepted) {
    await tx.fbsOrderRequestLink.updateMany({
      where: { requestId: request.id, clientId: request.clientId, marketplace: 'OZON',
        connectionId: order.connectionId, orderId: order.id },
      data: { lastSupplierStatus: order.supplierStatus, lastWbStatus: order.wbStatus,
        lastCategory: order.wbStatus === 'sold' ? 'archive' : 'shipped' },
    });
  }
  await tx.clientRequestEvent.create({ data: { requestId: request.id, clientId: request.clientId,
    eventType: 'STATUS_CHANGED', statusFrom: previousStatus, statusTo: 'DONE',
    title: 'Сдано: Ozon принял заказы в доставку',
    body: `Автоматическая сверка ФБС Ozon: ${accepted.map(o => `${o.id}: ${o.supplierStatus}/${o.wbStatus}`).join('; ')}. Изменён только статус заявки; списания, возвраты и остатки не изменялись.` } });
  return true;
}
