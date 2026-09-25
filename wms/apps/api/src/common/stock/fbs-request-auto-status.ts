import { ozonPickLinesEnabled, readOzonPickState } from '../../modules/marketplace-connections/ozon-fbs-pick-lines';
import { ClientRequestStatus, Prisma } from '@prisma/client';

// FIX: opt in only on our WMS; manual status changes remain available.
export const fbsRequestAutoStatusEnabled = () => process.env.WMS_FBS_REQUEST_AUTO_STATUS_ENABLED === 'true';
export const FBS_AUTO_STATUS_TITLE = 'Статус FBS изменён автоматически';
type Trigger = { stage: 'START' | 'PICK' | 'SOS_PRINT'; occurredAt: Date; actorId?: string | null };
export type FbsAutoStatusChange = { clientId: string; requestId: string; number: number; title: string; from: ClientRequestStatus; to: ClientRequestStatus };
const rank: Partial<Record<ClientRequestStatus, number>> = { SUBMITTED: 0, IN_REVIEW: 0, APPROVED: 0, IN_WORK: 1, PACKED: 2, DONE: 3 };
const orderKey = (row: { marketplace: string; connectionId: string; orderId: string }) => JSON.stringify([row.marketplace, row.connectionId, row.orderId]);

// Caller owns the transaction. A request lock serializes concurrent final picks/prints.
export async function reconcileFbsRequestStatus(tx: Prisma.TransactionClient, requestId: string, trigger: Trigger, changes?: FbsAutoStatusChange[]) {
  if (!fbsRequestAutoStatusEnabled()) return;
  await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${requestId} FOR UPDATE`;
  const request = await tx.clientRequest.findUnique({ where: { id: requestId }, select: {
    id: true, number: true, title: true, clientId: true, type: true, status: true,
    items: { select: { id: true, skuId: true, quantity: true } },
    fbsOrderLinks: { select: { marketplace: true, connectionId: true, orderId: true, syncStatus: true } },
  } });
  if (!request || request.type !== 'OUTBOUND' || rank[request.status] === undefined || request.status === 'DONE') return;
  const links = request.fbsOrderLinks.filter(l => l.syncStatus !== 'REMOVED');
  if (!links.length) return; // Excel/FBO and unrelated requests must never be affected.
  // FIX: replaying an old scan/print must not undo a later manual decision.
  const manual = await tx.clientRequestEvent.findFirst({ where: { requestId, eventType: 'STATUS_CHANGED',
    title: { not: FBS_AUTO_STATUS_TITLE }, createdAt: { gte: trigger.occurredAt } }, select: { id: true } });
  if (manual) return;
  const allTasks = await tx.fbsTsdAssembly.findMany({ where: { requestId, clientId: request.clientId }, select: {
    id: true, marketplace: true, connectionId: true, orderId: true, requestItemId: true, skuId: true,
    status: true, itemCount: true, startedAt: true, completedAt: true, workerUserId: true, deviceCode: true,
  } });
  const keys = new Set(links.filter(l => l.syncStatus === 'ACTIVE').map(orderKey));
  const tasks = allTasks.filter(t => keys.has(orderKey(t)));
  const started = tasks.some(t => t.startedAt && t.workerUserId && !t.deviceCode.startsWith('AUTO:') && ['IN_PROGRESS', 'COMPLETED'].includes(t.status));
  if (!started) return;
  let target: ClientRequestStatus = 'IN_WORK';
  const byItem = new Map<string, number>();
  const validTasks = new Set<string>();
  for (const task of tasks) if (task.status === 'COMPLETED' && task.completedAt) {
    // FIX: a multi-product posting contributes each confirmed line to its own request item.
    const lines = ozonPickLinesEnabled() && task.marketplace === 'OZON' ? await readOzonPickState(tx, task.id) : null;
    if (lines) {
      if (lines.submission !== 'COMPLETED' || lines.lines.reduce((n, line) => n + line.quantity, 0) !== task.itemCount ||
        !lines.lines.every(line => line.picks.length === line.quantity && request.items.some(i => i.id === line.requestItemId && i.skuId === line.skuId))) continue;
      for (const line of lines.lines) byItem.set(line.requestItemId, (byItem.get(line.requestItemId) ?? 0) + line.quantity);
      validTasks.add(task.id);
    } else {
      const item = request.items.find(i => i.id === task.requestItemId && i.skuId === task.skuId);
      if (item) { byItem.set(item.id, (byItem.get(item.id) ?? 0) + task.itemCount); validTasks.add(task.id); }
    }
  }
  // FIX: check every order and every line, never just equal total quantities.
  const complete = request.items.length > 0 && links.every(l => l.syncStatus === 'ACTIVE') && tasks.length === links.length &&
    tasks.every(t => validTasks.has(t.id) && t.itemCount > 0) &&
    request.items.every(i => i.quantity > 0 && byItem.get(i.id) === i.quantity);
  if (complete && trigger.stage !== 'START') target = 'PACKED';
  if (complete && trigger.stage !== 'START' && tasks.every(t => t.marketplace === 'WILDBERRIES')) {
    const ids = tasks.map(t => t.id);
    const prints = await tx.fbsPrintJob.findMany({ where: { requestId, assemblyId: { in: ids }, status: 'PRINTED',
      printedAt: { not: null }, deviceCode: { startsWith: 'SOS-WB:' } }, select: { assemblyId: true } });
    const shipments = await tx.wbOrderShipment.findMany({ where: { requestId, assemblyId: { in: ids } }, select: { assemblyId: true, quantity: true } });
    const printed = new Set(prints.map(p => p.assemblyId));
    const shipped = new Map(shipments.map(s => [s.assemblyId, s.quantity]));
    if (tasks.every(t => printed.has(t.id) && shipped.get(t.id) === t.itemCount)) target = 'DONE';
  }
  if (rank[target]! <= rank[request.status]!) return;
  await tx.clientRequest.update({ where: { id: requestId }, data: { status: target } });
  await tx.clientRequestEvent.create({ data: { requestId, clientId: request.clientId, eventType: 'STATUS_CHANGED',
    title: FBS_AUTO_STATUS_TITLE, statusFrom: request.status, statusTo: target, createdByUserId: trigger.actorId ?? null,
    body: target === 'DONE' ? 'Все товары обработаны через SOS WB 2, печать и складское списание подтверждены.' :
      target === 'PACKED' ? 'Отбор всех товаров заявки завершён.' : 'Сотрудник приступил к сборке FBS.' } });
  // FIX: collect the actual transition; the caller sends only after transaction commit.
  changes?.push({ clientId: request.clientId, requestId, number: request.number, title: request.title, from: request.status, to: target });
  return target;
}
