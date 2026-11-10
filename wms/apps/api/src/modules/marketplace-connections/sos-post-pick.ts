import { Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { clientReceiptKizPolicyKey } from '../../common/client-receipt-kiz-policy';
import { randomUUID } from 'node:crypto';
import { fbsActionStatusEnabled } from '../../common/stock/fbs-request-auto-status';

// FIX: completed unmarked orders use a printing-only ledger, never SOS picking.
export const SOS_POST_PICK = 'SOS_POST_PICK';
export const sosPostPickEnabled = () => process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED === 'true';
const codes = (v: unknown): string[] => Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
const key = (t: any) => `${t.requestId}:${t.connectionId}:${t.orderId}`;
const text = (v: unknown, label: string) => {
  if (typeof v !== 'string' || !v.trim() || v.length > 150) throw new BadRequestException(label);
  return v.trim();
};
export function postPickReady(t: any) {
  // FIX: marked Ozon is printing-only after completed, confirmed picking.
  const markingReady = t.requiresKiz === false && !t.kiz ||
    fbsActionStatusEnabled() && t.marketplace === 'OZON' && t.requiresKiz === true && !!t.kiz && t.wbMetaStatus === 'ACCEPTED';
  return t.status === 'COMPLETED' && !!t.completedAt && markingReady &&
    !t.sourceBoxPending && ['WILDBERRIES', 'OZON'].includes(t.marketplace) &&
    (t.marketplace !== 'OZON' || !!t.marketplaceSubmittedAt);
}
export function postPickMatches(t: any, barcode: string) {
  const lines = t.ozonPickState?.data?.lines;
  const scanned = Array.isArray(lines) ? lines.flatMap((l: any) => codes(l.barcodes)) : [];
  return [...codes(t.barcodes), ...codes(t.sourceBarcodes), ...scanned, t.barcode, t.sourceBarcode].includes(barcode);
}
function scope(user: any) {
  if (!sosPostPickEnabled()) throw new NotFoundException('Печать после отбора не включена.');
  if (user.isDemo) throw new ForbiddenException();
  if (!user.activeWarehouseId) throw new BadRequestException('Выберите филиал.');
}
export async function postPickTasks(db: any, clients: any, user: any, requestId?: string) {
  scope(user);
  let requests = await db.clientRequest.findMany({ where: {
    ...(requestId ? { id: requestId } : {}), clientId: clients.resolveClientFilter(user),
    // FIX: match the WMS active-request list; completed history is not a print queue.
    warehouseId: user.activeWarehouseId, status: { notIn: ['DONE', 'CANCELLED', 'REJECTED'] },
  }, select: { id: true, number: true, title: true, status: true, clientId: true,
    client: { select: { id: true, name: true, code: true } } }, orderBy: { number: 'desc' } });
  // FIX: client policy routes the workflow; SKU marking remains an additional safeguard.
  const policies: any[] = [];
  const clientIds = [...new Set<string>(requests.map((r: any) => r.clientId))];
  for (let offset = 0; offset < clientIds.length; offset += 500) policies.push(...await db.systemSetting.findMany({
    where: { key: { in: clientIds.slice(offset, offset + 500).map(clientReceiptKizPolicyKey) } },
    select: { key: true, value: true },
  }));
  const marked = new Set(policies.filter(p => p.value?.required === true).map(p => p.key));
  requests = requests.filter((r: any) => fbsActionStatusEnabled() || !marked.has(clientReceiptKizPolicyKey(r.clientId)));
  const tasks: any[] = [];
  for (let offset = 0; offset < requests.length; offset += 500) {
    const ids = requests.slice(offset, offset + 500).map((r: any) => r.id);
    const rows = await db.fbsTsdAssembly.findMany({ where: { requestId: { in: ids },
      clientId: clients.resolveClientFilter(user), status: 'COMPLETED',
      ...(fbsActionStatusEnabled() ? { OR: [{ requiresKiz: false }, { marketplace: 'OZON', requiresKiz: true, wbMetaStatus: 'ACCEPTED' }] } : { requiresKiz: false }),
      marketplace: { in: ['WILDBERRIES', 'OZON'] } },
      orderBy: [{ completedAt: 'asc' }, { id: 'asc' }] });
    // FIX: deployed Prisma predates the relation; use the existing parameterized state table.
    const ozonIds = rows.filter((t: any) => t.marketplace === 'OZON').map((t: any) => t.id);
    if (ozonIds.length) {
      const states = await db.$queryRaw(Prisma.sql`SELECT "assemblyId", "data" FROM "OzonFbsPickState" WHERE "assemblyId" IN (${Prisma.join(ozonIds)})`);
      const byId = new Map(states.map((s: any) => [s.assemblyId, s.data]));
      rows.forEach((t: any) => { if (byId.has(t.id)) t.ozonPickState = { data: byId.get(t.id) }; });
    }
    const links = await db.fbsOrderRequestLink.findMany({ where: { requestId: { in: ids },
      syncStatus: 'ACTIVE', lastCategory: { in: ['active', 'shipped'] } },
      select: { requestId: true, connectionId: true, orderId: true } });
    const allowed = new Set(links.map(key));
    tasks.push(...rows.filter((t: any) => postPickReady(t) && allowed.has(key(t)) &&
      (!marked.has(clientReceiptKizPolicyKey(t.clientId)) || fbsActionStatusEnabled() && t.marketplace === 'OZON')));
  }
  return { requests, tasks };
}
export async function listPostPick(db: any, clients: any, user: any) {
  if (!sosPostPickEnabled()) return { requests: [] };
  const { requests, tasks } = await postPickTasks(db, clients, user);
  const jobs: any[] = [];
  for (let offset = 0; offset < tasks.length; offset += 500) jobs.push(...await db.fbsPrintJob.findMany({
    where: { assemblyId: { in: tasks.slice(offset, offset + 500).map(t => t.id) }, source: SOS_POST_PICK },
    select: { assemblyId: true, status: true },
  }));
  return { requests: requests.flatMap((r: any) => {
    const selected = tasks.filter(t => t.requestId === r.id);
    if (!selected.length) return [];
    const printed = selected.filter(t => jobs.some(j => j.assemblyId === t.id && j.status === 'PRINTED')).length;
    const queued = selected.filter(t => !jobs.some(j => j.assemblyId === t.id && j.status === 'PRINTED') && jobs.some(j => j.assemblyId === t.id && ['QUEUED','CLAIMED'].includes(j.status))).length;
    return [{ requestId: r.id, requestNumber: r.number, title: r.title, client: r.client,
      status: r.status, printOnly: true, totalOrders: selected.length, printedOrders: printed,
      queuedOrders: queued, availableOrders: selected.length - printed - queued }];
  }) };
}

export async function queuePostPick(db: any, clients: any, user: any, body: any,
  loadSticker: (task: any) => Promise<any>) {
  scope(user);
  const requestId = text(body.requestId, 'Выберите заявку.');
  const barcode = text(body.barcode, 'Отсканируйте ШК товара.');
  const stationId = text(body.stationId, 'Выберите принтер.');
  const operationId = text(body.operationId, 'Нет номера операции печати.');
  if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(operationId)) throw new BadRequestException('Неверный номер операции печати.');
  const repeatId = body.repeatAssemblyId ? text(body.repeatAssemblyId, 'Неверный повтор.') : null;
  const context = await postPickTasks(db, clients, user, requestId);
  const request = context.requests[0];
  if (!request) throw new NotFoundException('Заявка недоступна в выбранном филиале.');
  clients.requireClientAccess(user, request.clientId, 'write');
  const historyId = `sos-post:${operationId}`;
  const response = (job: any) => ({ printJobId: job.id, assemblyId: job.assemblyId,
    requestNumber: job.requestNumber, orderId: job.orderId, productName: job.productName,
    printStatus: job.status, message: 'Стикер передан на печать. Отбор и остатки не изменены.' });
  const prior = await db.fbsPrintJob.findUnique({ where: { historyId } });
  if (prior) {
    if (prior.source !== SOS_POST_PICK || prior.requestId !== requestId || prior.stationId !== stationId ||
      prior.requestedById !== user.id || prior.kiz !== barcode || repeatId && prior.assemblyId !== repeatId) throw new ConflictException('Операция уже использована для другого сканирования.');
    return response(prior);
  }
  const station = await db.fbsPrintStation.findFirst({ where: { id: stationId, enabled: true } });
  if (!station?.lastSeenAt || Date.now() - new Date(station.lastSeenAt).getTime() > 120_000) throw new ConflictException('Принтер не в сети.');
  const candidates = context.tasks.filter(t => postPickMatches(t, barcode) && (!repeatId || t.id === repeatId));
  const jobs = await db.fbsPrintJob.findMany({ where: { requestId, source: SOS_POST_PICK }, orderBy: { createdAt: 'desc' } });
  const task = repeatId ? candidates[0] : candidates.find(t => !jobs.some((j: any) => j.assemblyId === t.id));
  if (!task) throw new ConflictException({ message: 'Нет нераспечатанного отобранного заказа с этим ШК. Для повтора выберите «Повторить печать».', repeatAssemblyId: candidates.at(-1)?.id ?? null });
  if (repeatId && jobs.some((j: any) => j.assemblyId === repeatId && ['QUEUED', 'CLAIMED'].includes(j.status))) throw new ConflictException('Стикер ещё в очереди или печатается. Проверьте принтер.');
  const sticker = await loadSticker(task);
  if (!sticker?.imageBase64 || !sticker.barcode || sticker.contentType && sticker.contentType !== 'image/png') throw new ConflictException('Маркетплейс пока не вернул пригодный стикер. Повторите позже.');
  return db.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `sos-post:${requestId}`);
    const retry = await tx.fbsPrintJob.findUnique({ where: { historyId } });
    if (retry) return response(retry);
    const current = await postPickTasks(tx, clients, user, requestId);
    if (!current.tasks.some(t => t.id === task.id && postPickMatches(t, barcode))) throw new ConflictException('Состав заявки изменился. Обновите список.');
    const latest = await tx.fbsPrintJob.findFirst({ where: { assemblyId: task.id, source: SOS_POST_PICK }, orderBy: { createdAt: 'desc' } });
    if (latest && (!repeatId || ['QUEUED','CLAIMED'].includes(latest.status))) throw new ConflictException('Другой сотрудник уже отправил этот стикер. Повторите сканирование для следующего заказа.');
    const job = await tx.fbsPrintJob.create({ data: { id: randomUUID(), historyId, source: SOS_POST_PICK,
      stationId, assemblyId: task.id, requestId, requestNumber: request.number, orderId: task.orderId,
      // This required legacy field stores the scanned product code, never a marking claim.
      kiz: barcode, warehouseName: task.marketplace === 'OZON' ? 'Ozon' : 'Wildberries',
      productName: task.productName, stickerCode: sticker.barcode, stickerMime: 'image/png',
      stickerBase64: sticker.imageBase64, requestedById: user.id, requestedBy: user.name,
      deviceCode: `SOS-POST:${String(body.deviceCode ?? '').slice(0,100)}` } });
    await tx.auditLog.create({ data: { userId: user.id, action: repeatId ? 'SOS_POST_PICK_REPRINT_QUEUED' : 'SOS_POST_PICK_PRINT_QUEUED',
      entity: 'ClientRequest', entityId: requestId, payload: { printJobId: job.id, assemblyId: task.id, orderId: task.orderId, stationId, barcode } } });
    return response(job);
  }, { timeout: 30_000 });
}
