import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { FbsTsdAssembly, Prisma, StockStatus } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { approvedUnitRelabel, finishKizReview, assertUnusedReplacement } from '../../common/kiz-review-queue';

const ACTION = 'FBS_PHYSICAL_KIZ_RELABEL';
const CLOSED = ['DONE', 'CANCELLED', 'REJECTED'];
type Tx = Prisma.TransactionClient;
type Task = FbsTsdAssembly;
type Intent = { stage: string; context: string; oldKiz: string; oldMarkId: string; proposalId?: string; newKiz?: string; newMarkId?: string };
export const physicalKizRelabelEnabled = () => process.env.WMS_FBS_KIZ_RELABEL_ENABLED === 'true';
// FIX: a planned size replacement keeps source stock until BOTH KIZ scans prove the physical pair.
export const pendingSizeKizRelabel = (task: Task) => physicalKizRelabelEnabled() && task.requiresKiz &&
  task.relabelRequired && Boolean(task.sourceSkuId) && !task.relabelConfirmedAt;
const sameKiz = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const context = (t: Task) => JSON.stringify([t.id, t.clientId, t.requestId, t.connectionId, t.orderId, t.skuId,
  t.boxId, t.barcode, t.workerUserId, t.deviceCode, t.startedAt?.toISOString() ?? null]);

async function latest(tx: Tx, task: Task, user: AuthUser) {
  const row = await tx.auditLog.findFirst({where: {action: ACTION, entity: 'FbsTsdAssembly', entityId: task.id, userId: user.id},
    orderBy: [{createdAt: 'desc'}, {id: 'desc'}], select: {id: true, payload: true}});
  const intent = row?.payload as unknown as Intent | undefined;
  return row && intent?.context === context(task) ? {id: row.id, intent} : null;
}

// FIX: persisted intent restores the old scan after a TSD restart without changing inventory.
export async function readPhysicalKizRelabel(tx: Tx, task: Task, user: AuthUser) {
  if (!physicalKizRelabelEnabled() || task.kiz || !task.boxId || !task.barcode || task.status !== 'IN_PROGRESS') return null;
  const row = await latest(tx, task, user);
  return row?.intent.stage === 'PROPOSED' ? {id: row.id, oldKiz: row.intent.oldKiz, boxCode: task.boxCode} : null;
}

async function lockedTask(tx: Tx, task: Task, user: AuthUser, requireLease: (fresh: Task | null) => void) {
  if (!physicalKizRelabelEnabled()) throw new ForbiddenException('Переклейка КИЗ в этом окружении выключена.');
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "FbsTsdAssembly" WHERE "id" = ${task.id} FOR UPDATE`);
  const fresh = await tx.fbsTsdAssembly.findUnique({where: {id: task.id}});
  requireLease(fresh);
  if (!fresh || fresh.updatedAt.getTime() !== task.updatedAt.getTime() || context(fresh) !== context(task)) {
    throw new ConflictException('Задание изменилось. Обновите сборку перед переклейкой.');
  }
  if (fresh.workerUserId !== user.id || fresh.deviceCode !== user.deviceCode || fresh.status !== 'IN_PROGRESS' ||
      !fresh.boxId || !fresh.barcode || fresh.itemCount !== 1 || fresh.marketplace !== 'WILDBERRIES' || fresh.completedAt) {
    throw new BadRequestException('Переклейка доступна после сканирования короба и ШК одной единицы в вашем задании.');
  }
  return fresh;
}

async function source(tx: Tx, task: Task, oldKiz: string) {
  const skuId = pendingSizeKizRelabel(task) ? task.sourceSkuId! : task.skuId;
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Box" WHERE "id" = ${task.boxId!} FOR UPDATE`);
  const [box, request, mark] = await Promise.all([
    tx.box.findUnique({where: {id: task.boxId!}}),
    tx.clientRequest.findUnique({where: {id: task.requestId}}),
    tx.productMark.findFirst({where: {value: {equals: oldKiz, mode: 'insensitive'}}}),
  ]);
  if (!box || !request || !mark || box.clientId !== task.clientId || request.clientId !== task.clientId ||
      !box.warehouseId || box.warehouseId !== request.warehouseId || CLOSED.includes(request.status) ||
      ['archived', 'deleted'].includes(box.status) || mark.clientId !== task.clientId || mark.skuId !== skuId ||
      mark.boxId !== task.boxId || mark.status !== 'AVAILABLE') {
    throw new BadRequestException('Старый КИЗ не подтверждён в доступном остатке выбранного короба и товара. Нужна проверка короба.');
  }
  // FIX: an administrator-approved physical unit does not require a complete box recount.
  const unitApproved = await approvedUnitRelabel(tx,task,oldKiz);
  const [balance, count, picked, linked] = await Promise.all([
    tx.stockBalance.aggregate({where: {clientId: task.clientId, warehouseId: box.warehouseId, skuId,
      boxId: task.boxId, status: 'AVAILABLE'}, _sum: {quantity: true}}),
    unitApproved ? Promise.resolve(1) : tx.productMark.count({where: {clientId: task.clientId, skuId, boxId: task.boxId, status: 'AVAILABLE'}}),
    tx.stockMovement.findFirst({where: {idempotencyKey: {startsWith: `fbs-sticker-pick:${task.id}:`}, quantity: {lt: 0}}}),
    tx.fbsTsdAssembly.findMany({where: {id: {not: task.id}, clientId: task.clientId,
      kiz: {equals: oldKiz, mode: 'insensitive'}, status: {in: ['IN_PROGRESS', 'COMPLETED', 'RETURN_REQUIRED']}},
      select: {requestId: true, status: true, clientId: true, skuId: true, updatedAt: true}}),
  ]);
  if ((balance._sum.quantity ?? 0) < Math.max(1, count) || picked) {
    throw new BadRequestException('Остаток или состав КИЗ изменился, либо товар уже списан. Переклейка остановлена.');
  }
  const requestIds = [...new Set(linked.map(t => t.requestId))];
  const closedRequests = requestIds.length ? await tx.clientRequest.count({where: {id: {in: requestIds}, clientId: task.clientId,
    status: {in: ['DONE', 'CANCELLED', 'REJECTED']}}}) : 0;
  if (closedRequests !== requestIds.length || linked.some(t => !['COMPLETED', 'RETURN_REQUIRED'].includes(t.status))) {
    throw new BadRequestException('Старый КИЗ занят другой незавершённой или неподтверждённой сборкой.');
  }
  // FIX: only a later, completed admin sorting movement proves that a historical
  // RETURN_REQUIRED unit is physically available again. Keep its old task/KIZ intact;
  // this proof permits replacement, never reuse, and is rechecked on application.
  const returns = linked.filter(t => t.status === 'RETURN_REQUIRED');
  if (returns.length && !unitApproved) {
    const movement = mark.stockMovementId
      ? await tx.stockMovement.findUnique({where: {id: mark.stockMovementId}}) : null;
    const sessionId = movement?.sourceDocument?.match(/^PALLET_SORTING:(.+)$/)?.[1];
    const sorting = sessionId ? await tx.palletSortingSession.findUnique({where: {id: sessionId}}) : null;
    if (!movement || !sorting?.completedAt || sorting.clientId !== task.clientId || sorting.warehouseId !== box.warehouseId ||
        movement.clientId !== task.clientId || movement.skuId !== skuId || movement.boxId !== task.boxId ||
        movement.warehouseId !== box.warehouseId || movement.status !== 'AVAILABLE' || movement.quantity !== 1 ||
        !['TRANSFER', 'INVENTORY_ADJUSTMENT'].includes(movement.type) ||
        returns.some(t => t.clientId !== task.clientId || t.skuId !== skuId ||
          !(movement.createdAt > t.updatedAt))) {
      throw new BadRequestException('Возврат старого КИЗ в этот короб не подтверждён завершённой сортировкой. Администратору нужно разобрать старую заявку.');
    }
  }
  return mark;
}

export async function proposePhysicalKizRelabel(tx: Tx, task: Task, oldKiz: string, user: AuthUser, requireLease: (fresh: Task | null) => void) {
  const fresh = await lockedTask(tx, task, user, requireLease);
  if (fresh.kiz) throw new BadRequestException('Для задания уже записан КИЗ. Продолжите его обработку.');
  const mark = await source(tx, fresh, oldKiz);
  const previous = await latest(tx, fresh, user);
  if (previous?.intent.stage === 'PROPOSED' && sameKiz(previous.intent.oldKiz, oldKiz)) return fresh;
  await tx.auditLog.create({data: {userId: user.id, action: ACTION, entity: 'FbsTsdAssembly', entityId: fresh.id,
    payload: {stage: 'PROPOSED', context: context(fresh), oldKiz: mark.value, oldMarkId: mark.id,
      clientId: fresh.clientId, requestId: fresh.requestId, orderId: fresh.orderId, boxId: fresh.boxId, boxCode: fresh.boxCode}}});
  return tx.fbsTsdAssembly.update({where: {id: fresh.id}, data: {errorMessage: null}});
}

export async function cancelPhysicalKizRelabel(tx: Tx, task: Task, user: AuthUser, proposalId: string, requireLease: (fresh: Task | null) => void) {
  const fresh = await lockedTask(tx, task, user, requireLease);
  const previous = await latest(tx, fresh, user);
  if (previous?.intent.stage === 'CANCELLED' && previous.intent.proposalId === proposalId) return;
  if (!previous || previous.id !== proposalId || previous.intent.stage !== 'PROPOSED') throw new ConflictException('Предложение переклейки изменилось. Обновите задание.');
  await tx.auditLog.create({data: {userId: user.id, action: ACTION, entity: 'FbsTsdAssembly', entityId: fresh.id,
    payload: {...previous.intent, stage: 'CANCELLED', proposalId}}});
}

// FIX: replace a proven physical mark, never an arbitrary mark; quantity is deliberately unchanged.
export async function applyPhysicalKizRelabel(tx: Tx, task: Task, user: AuthUser, proposalId: string, newKiz: string, requireLease: (fresh: Task | null) => void) {
  const fresh = await lockedTask(tx, task, user, requireLease);
  const previous = await latest(tx, fresh, user);
  if (previous?.intent.stage === 'APPLIED' && previous.intent.proposalId === proposalId &&
      sameKiz(previous.intent.newKiz ?? '', newKiz) && fresh.kiz && sameKiz(fresh.kiz, newKiz)) return fresh;
  if (!previous || previous.id !== proposalId || previous.intent.stage !== 'PROPOSED' || fresh.kiz) throw new ConflictException('Переклейка уже изменена. Обновите задание.');
  if (sameKiz(previous.intent.oldKiz, newKiz)) throw new BadRequestException('Отсканируйте новый КИЗ после переклейки, а не старый.');
  const old = await source(tx, fresh, previous.intent.oldKiz);
  if (old.id !== previous.intent.oldMarkId) throw new ConflictException('Запись исходного КИЗ изменилась.');
  if(await approvedUnitRelabel(tx,fresh,previous.intent.oldKiz)) await assertUnusedReplacement(tx,newKiz);
  const [registered, taskUsage, shipped] = await Promise.all([
    tx.productMark.findFirst({where: {value: {equals: newKiz, mode: 'insensitive'}}}),
    tx.fbsTsdAssembly.findFirst({where: {kiz: {equals: newKiz, mode: 'insensitive'}}}),
    tx.shippedKizHistory.findFirst({where: {kiz: {equals: newKiz, mode: 'insensitive'}}}),
  ]);
  if (registered || taskUsage || shipped) throw new BadRequestException('Новый КИЗ уже зарегистрирован или использован. Возьмите свободный новый КИЗ.');
  const sizeRelabel = pendingSizeKizRelabel(fresh);
  if (sizeRelabel && fresh.sourceSkuId !== fresh.skuId) {
    // FIX: convert exactly the scanned source in the same transaction as old/new mark ownership.
    const box = await tx.box.findUniqueOrThrow({where:{id:fresh.boxId!}});
    const balance = await tx.stockBalance.findFirst({where:{clientId:fresh.clientId,warehouseId:box.warehouseId,
      skuId:fresh.sourceSkuId!,boxId:fresh.boxId,status:'AVAILABLE',quantity:{gte:1}},orderBy:{id:'asc'}});
    if (!balance) throw new ConflictException('Исходный остаток изменился. Переклейка не выполнена.');
    const debit=await tx.stockBalance.updateMany({where:{id:balance.id,quantity:{gte:1}},data:{quantity:{decrement:1}}});
    if(debit.count!==1) throw new ConflictException('Исходная единица уже отобрана.');
    const scope={warehouseId:balance.warehouseId,clientId:fresh.clientId,skuId:fresh.skuId,boxId:fresh.boxId,palletId:balance.palletId,status:StockStatus.AVAILABLE};
    const balanceKey=`${fresh.clientId}:${fresh.skuId}:${fresh.boxId}:${balance.palletId??'no-pallet'}:AVAILABLE`;
    await tx.stockBalance.upsert({where:{balanceKey},create:{...scope,balanceKey,quantity:1},update:{quantity:{increment:1}}});
    await tx.stockMovement.createMany({data:[
      {...scope,skuId:fresh.sourceSkuId!,type:'INVENTORY_ADJUSTMENT',quantity:-1,sourceDocument:fresh.requestId,
        idempotencyKey:`fbs-relabel:${fresh.id}:source`,comment:'Переклейка: старый ШК и КИЗ подтверждены'},
      {...scope,type:'INVENTORY_ADJUSTMENT',quantity:1,sourceDocument:fresh.requestId,
        idempotencyKey:`fbs-relabel:${fresh.id}:target`,comment:'Переклейка: новый ШК и КИЗ подтверждены'},
    ]});
  }
  const changed = await tx.productMark.updateMany({where: {id: old.id, value: old.value, boxId: fresh.boxId, status: 'AVAILABLE'},
    data: {boxId: null, status: StockStatus.BLOCKED}});
  if (changed.count !== 1) throw new ConflictException('Исходный КИЗ изменился во время переклейки.');
  const mark = await tx.productMark.create({data: {clientId: fresh.clientId, skuId: fresh.skuId, boxId: fresh.boxId,
    value: newKiz, status: 'AVAILABLE', sourceDocument: `Переклейка КИЗ FBS, заказ ${fresh.orderId}; исходная запись ${old.id}`}});
  const updated = await tx.fbsTsdAssembly.update({where: {id: fresh.id}, data: {kiz: newKiz, wbMetaStatus: 'PENDING', errorMessage: null,
    ...(sizeRelabel?{relabelConfirmedAt:new Date()}: {})}});
  await finishKizReview(tx,fresh,previous.intent.oldKiz,'RELABEL');
  await tx.auditLog.create({data: {userId: user.id, action: ACTION, entity: 'FbsTsdAssembly', entityId: fresh.id,
    payload: {...previous.intent, stage: 'APPLIED', proposalId, newKiz, newMarkId: mark.id,
      oldMark: JSON.parse(JSON.stringify(old)), clientId: fresh.clientId, requestId: fresh.requestId, orderId: fresh.orderId,
      boxId: fresh.boxId, boxCode: fresh.boxCode, quantity: 1, quantityChanged: false,
      sourceSkuId: old.skuId, targetSkuId: fresh.skuId, sourceBarcode: fresh.sourceBarcode, targetBarcode: fresh.barcode}}});
  return updated;
}
