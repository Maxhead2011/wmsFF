import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

type Link = { id: string; clientId: string; connectionId: string; orderId: string; requestId: string;
  lastCategory: string | null; lastSupplierStatus: string | null; lastSupplyId: string | null; syncStatus: string };
type Order = { id: string; connectionId: string; marketplace: string; supplierStatus: string; wbStatus: string | null; supplyId: string | null };
// FIX: normal synchronization saves a precise transition before replacing its
// last snapshot. Discovery stays read-only and never infers a return from confirm alone.
export async function recordReshipmentTransition(db: Pick<Prisma.TransactionClient, 'auditLog'>,
  link: Link, order: Order, task: { id: string; requestId: string } | null | undefined) {
  if (process.env.WMS_FBS_RESHIPMENT_ENABLED !== 'true' || !task || task.requestId !== link.requestId ||
      order.marketplace !== 'WILDBERRIES' || order.id !== link.orderId || order.connectionId !== link.connectionId ||
      link.syncStatus !== 'ACTIVE' || link.lastSupplierStatus !== 'complete' || link.lastCategory !== 'shipped' ||
      !link.lastSupplyId || !order.supplyId || order.supplierStatus !== 'confirm' || order.wbStatus !== 'waiting') return;
  const payload = { clientId: link.clientId, connectionId: link.connectionId, orderId: link.orderId,
    requestId: link.requestId, assemblyId: task.id, sourceSupplyId: link.lastSupplyId, targetSupplyId: order.supplyId,
    supplierStatusFrom: 'complete', supplierStatusTo: 'confirm', wbStatus: order.wbStatus };
  const id = `reship-transition:${createHash('sha256').update(JSON.stringify([link.id, payload])).digest('hex')}`;
  await db.auditLog.upsert({ where: { id }, create: { id, action: 'FBS_WB_RETURNED_TO_ASSEMBLY',
    entity: 'FbsOrderRequestLink', entityId: link.id, payload }, update: {} });
}
