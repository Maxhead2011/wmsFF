import { isOrdinaryUnmarkedPick } from './ordinary-unmarked-pick';
import { finalizeWbOrderShipment, wbOrderStockLifecycleEnabled } from './wb-order-stock-lifecycle';
import { ozonPickLinesEnabled, readOzonPickState } from '../../modules/marketplace-connections/ozon-fbs-pick-lines';
import { ClientRequestStatus, Prisma } from '@prisma/client';

// FIX: opt in only on our WMS; manual status changes remain available.
export const fbsRequestAutoStatusEnabled = () => process.env.WMS_FBS_REQUEST_AUTO_STATUS_ENABLED === 'true';
export const fbsActionStatusEnabled = () => process.env.WMS_FBS_ACTION_STATUS_ENABLED === 'true';
export const FBS_AUTO_STATUS_TITLE = 'Статус FBS изменён автоматически';
type Trigger = { stage: 'START' | 'PICK' | 'SOS_PRINT' | 'RIBBON'; occurredAt: Date; actorId?: string | null };
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
  const actionMode = fbsActionStatusEnabled() && request.fbsOrderLinks.every(l => ['WILDBERRIES','OZON'].includes(l.marketplace));
  const links = request.fbsOrderLinks.filter(l => l.syncStatus !== 'REMOVED' && (!actionMode || l.syncStatus !== 'ADMIN_REMOVED'));
  if (!links.length) return; // Excel/FBO and unrelated requests must never be affected.
  // FIX: replaying an old scan/print must not undo a later manual decision.
  const manual = await tx.clientRequestEvent.findFirst({ where: { requestId, eventType: 'STATUS_CHANGED',
    title: { not: FBS_AUTO_STATUS_TITLE }, createdAt: { gte: trigger.occurredAt } }, select: { id: true } });
  if (manual) return;
  const allTasks = await tx.fbsTsdAssembly.findMany({ where: { requestId, clientId: request.clientId }, select: {
    id: true, marketplace: true, connectionId: true, orderId: true, requestItemId: true, skuId: true,
    requiresKiz: true, kiz: true, barcode: true, sourceBoxPending: true,
    status: true, itemCount: true, startedAt: true, completedAt: true, workerUserId: true, deviceCode: true,
  } });
  const keys = new Set(links.filter(l => l.syncStatus === 'ACTIVE').map(orderKey));
  const tasks = allTasks.filter(t => keys.has(orderKey(t)));
  const started = tasks.some(t => t.startedAt && t.workerUserId && !t.deviceCode.startsWith('AUTO:') && ['IN_PROGRESS', 'COMPLETED'].includes(t.status));
  if (!started && !actionMode) return;
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
  if (!actionMode && complete && trigger.stage !== 'START' && tasks.every(t => t.marketplace === 'WILDBERRIES')) {
    const ids = tasks.map(t => t.id);
    const prints = await tx.fbsPrintJob.findMany({ where: { requestId, assemblyId: { in: ids }, status: 'PRINTED',
      printedAt: { not: null }, deviceCode: { startsWith: 'SOS-WB:' } }, select: { assemblyId: true } });
    const shipments = await tx.wbOrderShipment.findMany({ where: { requestId, assemblyId: { in: ids } }, select: { assemblyId: true, quantity: true } });
    const printed = new Set(prints.map(p => p.assemblyId));
    const shipped = new Map(shipments.map(s => [s.assemblyId, s.quantity]));
    if (tasks.every(t => printed.has(t.id) && shipped.get(t.id) === t.itemCount)) target = 'DONE';
  }
  // FIX: final physical pick and stock shipment share the caller transaction and request lock.
  let ordinaryClosed = false;
  if (complete && trigger.stage === 'PICK' && wbOrderStockLifecycleEnabled() && tasks.every(isOrdinaryUnmarkedPick)) {
    const sosJobs = await tx.fbsPrintJob.findMany({ where: { requestId, assemblyId: { in: tasks.map(t => t.id) },
      deviceCode: { startsWith: 'SOS-WB:' } }, select: { assemblyId: true } });
    if (!sosJobs.length) {
      for (const task of tasks) {
        const fact = await finalizeWbOrderShipment(tx, task.id, 'STANDARD_PICK_CONFIRMED',
          { orderId: task.orderId, barcode: task.barcode, confirmation: 'Товар отобран' }, trigger.occurredAt);
        if (!fact || fact.quantity !== task.itemCount) throw new Error('Не подтверждено складское списание обычного отбора.');
      }
      target = 'DONE'; ordinaryClosed = true;
    }
  }
  // FIX: stock finalization above remains intact. Printing/physical picking is not marketplace acceptance.
  if (actionMode) {
    const policy = await tx.systemSetting.findUnique({where:{key:`fbs.action-status.v1:${request.clientId}`}});
    const startOnRibbon = (policy?.value as {startOnRibbon?:boolean}|undefined)?.startOnRibbon === true;
    target = request.status;
    if (startOnRibbon ? trigger.stage === 'RIBBON' : started) target = 'IN_WORK';
    if (complete) {
      const prints = await tx.fbsPrintJob.findMany({where:{requestId,assemblyId:{in:tasks.map(t=>t.id)},status:'PRINTED',printedAt:{not:null},
        OR:[{deviceCode:{startsWith:'SOS-WB:'},source:{notIn:['TSD_RELABEL','SOS_POST_PICK']}},{source:'SOS_POST_PICK',deviceCode:{startsWith:'SOS-POST:'}}]},select:{assemblyId:true}});
      const printed = new Set(prints.map(p=>p.assemblyId));
      if (tasks.every(t=>printed.has(t.id))) target = 'PACKED';
    }
  }
  if (rank[target]! <= rank[request.status]!) return;
  await tx.clientRequest.update({ where: { id: requestId }, data: { status: target } });
  await tx.clientRequestEvent.create({ data: { requestId, clientId: request.clientId, eventType: 'STATUS_CHANGED',
    title: FBS_AUTO_STATUS_TITLE, statusFrom: request.status, statusTo: target, createdByUserId: trigger.actorId ?? null,
    body: actionMode ? (target === 'PACKED' ? 'Агент подтвердил печать SOS WB 2 по всем действующим заказам заявки.' : trigger.stage === 'RIBBON' ? 'Агент подтвердил печать ленты стикеров. Начата подготовка заказа.' : 'Сотрудник открыл заявку на ТСД и приступил к сборке.') : ordinaryClosed ? 'Все товары без КИЗ отобраны и упакованы; складское списание подтверждено.' : target === 'DONE' ? 'Все товары обработаны через SOS WB 2, печать и складское списание подтверждены.' :
      target === 'PACKED' ? 'Отбор всех товаров заявки завершён.' : 'Сотрудник приступил к сборке FBS.' } });
  // FIX: collect the actual transition; the caller sends only after transaction commit.
  changes?.push({ clientId: request.clientId, requestId, number: request.number, title: request.title, from: request.status, to: target });
  return target;
}
