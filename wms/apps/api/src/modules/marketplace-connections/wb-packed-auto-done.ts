import { Prisma } from '@prisma/client';

// FIX: opt-in for our installation; remote acceptance changes no warehouse ledger.
export const wbPackedAutoDoneEnabled = () => process.env.WMS_WB_PACKED_AUTO_DONE_ENABLED === 'true';
type Order = { id: string; connectionId: string; marketplace: string; supplierStatus: string; wbStatus: string };
type Request = { id: string; clientId: string; type: string; status: string; updatedAt: Date;
  fbsEmergencyAssemblyAt: Date | null; fbsOrderLinks: Array<{ connectionId: string; orderId: string; marketplace: string; syncStatus: string }> };

export async function closeWbPackedRequest(tx: Prisma.TransactionClient, request: Request,
  orders: Order[], explicitBatch: boolean) {
  if (!wbPackedAutoDoneEnabled() || explicitBatch || request.fbsEmergencyAssemblyAt ||
    request.type !== 'OUTBOUND' || request.status !== 'PACKED') return false;
  if (request.fbsOrderLinks.some(link => link.syncStatus === 'MOVING')) return false;
  const links = request.fbsOrderLinks.filter(link => !['REMOVED', 'ADMIN_REMOVED'].includes(link.syncStatus));
  if (!links.length) return false;
  const accepted: Order[] = [];
  for (const link of links) {
    const matches = orders.filter(order => order.connectionId === link.connectionId && order.id === link.orderId);
    if (link.marketplace !== 'WILDBERRIES' || matches.length !== 1) return false;
    const order = matches[0];
    if (order.marketplace !== 'WILDBERRIES' || order.supplierStatus !== 'complete' ||
      !['sorted', 'ready_for_pickup', 'sold'].includes(order.wbStatus)) return false;
    accepted.push(order);
  }
  const client = await tx.client.findUnique({ where: { id: request.clientId }, select: { isDemo: true } });
  if (!client || client.isDemo) return false;
  // FIX: caller holds the request lock; CAS also protects a stale snapshot/retry.
  const changed = await tx.clientRequest.updateMany({ where: { id: request.id, clientId: request.clientId,
    status: 'PACKED', updatedAt: request.updatedAt, fbsEmergencyAssemblyAt: null }, data: { status: 'DONE' } });
  if (changed.count !== 1) return false;
  await tx.clientRequestEvent.create({ data: { requestId: request.id, clientId: request.clientId,
    eventType: 'STATUS_CHANGED', statusFrom: 'PACKED', statusTo: 'DONE',
    title: 'Сдано: Wildberries принял заказы в доставку',
    body: `Автоматическая сверка ФБС WB: ${accepted.map(o => `${o.id}: ${o.supplierStatus}/${o.wbStatus}`).join('; ')}. Изменён только статус заявки; списания, возвраты и остатки не изменялись.` } });
  return true;
}
