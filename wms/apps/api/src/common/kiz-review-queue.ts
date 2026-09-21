import {BadRequestException, ConflictException, ForbiddenException, NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {ClientRequestStatus, FbsTsdAssembly, Prisma} from '@prisma/client';
import {PrismaService} from './prisma/prisma.service';
import {physicalKizIdentity} from './kiz-physical-identity';
import {inspectKizReuse, kizReuseEnabled, type ReuseDecision} from './kiz-wb-reuse';
import {ClientScopeService} from '../modules/auth/client-scope.service';
import type {AuthUser} from '../modules/auth/auth.types';

export const kizReviewEnabled = () => kizReuseEnabled() && process.env.WMS_KIZ_REVIEW_QUEUE_ENABLED === 'true';
const closed: ClientRequestStatus[] = ['DONE','CANCELLED','REJECTED'];
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const identityOf = (value: string) => physicalKizIdentity(value.replace(/^\(01\)(\d{14})\(21\)/,(_,gtin)=>`01${gtin}21`).replace(/^(01\d{14})\u001d21/,(_,gtin)=>`${gtin}21`));
const prefixesOf = (identity: string) => [identity,']d2'+identity,']D2'+identity,`(01)${identity.slice(2,16)}(21)${identity.slice(18)}`];
type Evidence = Awaited<ReturnType<typeof inspectKizReuse>>;
export const reviewContext = (t: FbsTsdAssembly) => createHash('sha256').update(JSON.stringify([
  t.id,t.clientId,t.connectionId,t.requestId,t.orderId,t.skuId,t.boxId,t.workerUserId,t.startedAt,t.createdAt,
])).digest('hex');
// FIX: approvals never transfer to another unit, task attempt or relabel route.
export function permittedReviewAction(row: {context:string;status:string;resolution:string|null}|null,
  context: string, decision: ReuseDecision): ReuseDecision|null {
  if (!row || row.context !== context || row.status !== 'APPROVED') return null;
  if (row.resolution === 'REUSE' && decision !== 'RELABEL') return 'ALLOW';
  if (row.resolution === 'RELABEL' && decision === 'RELABEL') return 'RELABEL';
  return null;
}
export function requireReviewAdmin(user: AuthUser) {
  if (!kizReviewEnabled() || user.isDemo || !user.roleCodes.some(r=>['ADMIN','OWNER','SUPER_ADMIN'].includes(r)))
    throw new ForbiddenException('Разбор КИЗов доступен администратору и собственнику.');
  if (!user.activeWarehouseId) throw new BadRequestException('Сначала выберите филиал.');
  if (!user.permissionCodes.includes('system:admin') && user.warehouseIds && !user.warehouseIds.includes(user.activeWarehouseId))
    throw new ForbiddenException('Нет доступа к выбранному филиалу.');
}
async function lock(tx: Prisma.TransactionClient, taskId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "FbsTsdAssembly" WHERE "id"=${taskId} FOR UPDATE`);
}
// FIX: persist the case outside the subsequently rejected scanner action. Repeated scans update one row.
export async function queueKizReview(db: PrismaService, clientId: string, kiz: string, taskId: string, evidence: Evidence) {
  if (!kizReviewEnabled()) return evidence.decision;
  const identity=identityOf(kiz);
  if (!identity) throw new BadRequestException('Не удалось определить КИЗ для проверки.');
  return db.$transaction(async tx=>{
    await lock(tx,taskId);
    const task=await tx.fbsTsdAssembly.findUnique({where:{id:taskId}});
    if (!task || task.clientId!==clientId || task.marketplace!=='WILDBERRIES') throw new ConflictException('Задание изменилось.');
    const request=await tx.clientRequest.findUnique({where:{id:task.requestId},select:{clientId:true,warehouseId:true,number:true,status:true}});
    if (!request?.warehouseId || request.clientId!==clientId || closed.includes(request.status) || task.status!=='IN_PROGRESS')
      throw new ConflictException('Заявка больше не доступна для отбора.');
    const key={taskId_kizIdentity:{taskId,kizIdentity:identity}};
    const previous=await tx.kizReviewCase.findUnique({where:key});
    if (evidence.decision==='ALLOW' && !previous) return 'ALLOW';
    const context=reviewContext(task);
    const permission=permittedReviewAction(previous,context,evidence.decision);
    const reset=previous?.context!==context || (previous?.resolution==='REUSE' && evidence.decision==='RELABEL') ||
      (previous?.resolution==='RELABEL' && evidence.decision!=='RELABEL');
    const status=permission ? 'APPROVED' : evidence.decision==='ALLOW' ? 'RESOLVED' : 'OPEN';
    const common={clientId,warehouseId:request.warehouseId,requestId:task.requestId,kiz,context,decision:evidence.decision,status,
      snapshot:json({requestNumber:request.number,orderId:task.orderId,productName:task.productName,article:task.article,
        barcode:task.barcode,boxCode:task.boxCode,workerName:task.workerName,workerUserId:task.workerUserId}),evidence:json(evidence)};
    const row=await tx.kizReviewCase.upsert({where:key,create:{...common,taskId,kizIdentity:identity},
      update:{...common,attempts:{increment:1},...(reset?{resolution:null,reason:null,decidedById:null,decidedByName:null,decidedAt:null,usedAt:null}:{})}});
    if (!previous || reset) await tx.auditLog.create({data:{userId:task.workerUserId,action:'KIZ_REVIEW_OPENED',entity:'KizReviewCase',entityId:row.id,
      payload:json({taskId,clientId,kizIdentity:identity,context,evidence})}});
    return permission ?? (evidence.decision==='ALLOW'?'ALLOW':'REVIEW');
  });
}

export class KizReviewQueue {
  constructor(private readonly db: PrismaService, private readonly clients: ClientScopeService) {}
  async forKiz(identity: string, user: AuthUser) { return (await this.list(user,undefined,identity)).items; }
  async list(user: AuthUser, cursor?: string, identity?: string) {
    requireReviewAdmin(user);
    const items=await this.db.kizReviewCase.findMany({where:{warehouseId:user.activeWarehouseId!,clientId:this.clients.resolveClientFilter(user),
      status:{in:['OPEN','APPROVED']},...(identity?{kizIdentity:identity}:{})},orderBy:[{createdAt:'desc'},{id:'desc'}],take:51,...(cursor?{cursor:{id:cursor},skip:1}:{})});
    const tasks=await this.db.fbsTsdAssembly.findMany({where:{id:{in:items.map(r=>r.taskId)}}});
    const rows=items.slice(0,50).map(({kiz,...r})=>{
      const task=tasks.find(t=>t.id===r.taskId);
      const evidence=r.evidence as unknown as Evidence;
      const history=evidence.history.filter(h=>h.request?.warehouseId===user.activeWarehouseId);
      return {...r,evidence:{...evidence,history,orders:evidence.orders.filter(o=>history.some(h=>h.orderId===o.orderId))},
        active:Boolean(task && task.status==='IN_PROGRESS' && !task.kiz && reviewContext(task)===r.context)};
    });
    return {items:rows,nextCursor:items.length>50?rows[rows.length-1].id:null};
  }
  async decide(id: string, resolution: 'REUSE'|'RELABEL', reason: string, confirmed: boolean, user: AuthUser) {
    requireReviewAdmin(user);
    if (!user.permissionCodes.includes('system:admin') && user.writableWarehouseIds && !user.writableWarehouseIds.includes(user.activeWarehouseId!))
      throw new ForbiddenException('Нет права изменять данные выбранного филиала.');
    if (!['REUSE','RELABEL'].includes(resolution) || !confirmed || reason.trim().length<5 || reason.length>1000)
      throw new BadRequestException('Подтвердите проверку единицы и укажите основание решения (от 5 до 1000 символов).');
    const row=await this.db.kizReviewCase.findFirst({where:{id,warehouseId:user.activeWarehouseId!,clientId:this.clients.resolveClientFilter(user)}});
    if (!row) throw new NotFoundException('Обращение не найдено в выбранном филиале.');
    this.clients.requireClientAccess(user,row.clientId,'write');
    const evidence=await inspectKizReuse(this.db,row.clientId,row.kiz,row.taskId);
    if (resolution==='REUSE' && evidence.decision==='RELABEL') throw new BadRequestException('Подтверждена продажа или погашение. Можно разрешить только переклейку.');
    if (resolution==='RELABEL' && evidence.decision!=='RELABEL') throw new BadRequestException('Необходимость переклейки не подтверждена. Обновите проверку.');
    return this.db.$transaction(async tx=>{
      await lock(tx,row.taskId);
      const task=await tx.fbsTsdAssembly.findUnique({where:{id:row.taskId}});
      const fresh=await tx.kizReviewCase.findUnique({where:{id}});
      if (!task || !fresh || task.kiz || task.status!=='IN_PROGRESS' || task.clientId!==row.clientId ||
        reviewContext(task)!==row.context || fresh.context!==row.context || !['OPEN','APPROVED'].includes(fresh.status))
        throw new ConflictException('Задание или обращение изменилось. Обновите очередь.');
      const request=await tx.clientRequest.findUnique({where:{id:task.requestId}});
      const box=task.boxId?await tx.box.findUnique({where:{id:task.boxId}}):null;
      const marks=await tx.productMark.findMany({where:{clientId:row.clientId,OR:prefixesOf(row.kizIdentity).map(prefix=>({value:{startsWith:prefix}}))}});
      const exact=marks.filter(m=>identityOf(m.value)===row.kizIdentity);
      if(exact.length>1) throw new ConflictException('Найден дубль КИЗа. Сначала разберите дубли.');
      const mark=exact[0];
      if (!request || closed.includes(request.status) || request.clientId!==row.clientId || request.warehouseId!==row.warehouseId ||
        !box || box.clientId!==row.clientId || box.warehouseId!==row.warehouseId || ['archived','deleted'].includes(box.status) ||
        !mark || mark.status!=='AVAILABLE' || mark.skuId!==task.skuId || mark.boxId!==task.boxId)
        throw new ConflictException('Единица не подтверждена в доступном остатке выбранного короба.');
      const balance=await tx.stockBalance.aggregate({where:{clientId:row.clientId,warehouseId:row.warehouseId,skuId:task.skuId,boxId:task.boxId,status:'AVAILABLE'},_sum:{quantity:true}});
      if ((balance._sum.quantity??0)<1) throw new ConflictException('Доступного остатка для единицы нет.');
      const links=await tx.fbsTsdAssembly.findMany({where:{id:{not:task.id},clientId:row.clientId,
        OR:prefixesOf(row.kizIdentity).map(prefix=>({kiz:{startsWith:prefix}}))}});
      // Reuse cannot steal any stored binding; relabel keeps history and retains its normal source checks.
      if (resolution==='REUSE' && links.some(t=>identityOf(t.kiz??'')===row.kizIdentity))
        throw new ConflictException('КИЗ ещё привязан к другой сборке. Сначала разберите прежнюю заявку.');
      if(resolution==='RELABEL') {
        const exactLinks=links.filter(t=>identityOf(t.kiz??'')===row.kizIdentity);
        const requestIds=[...new Set(exactLinks.map(t=>t.requestId))];
        const closedCount=requestIds.length?await tx.clientRequest.count({where:{id:{in:requestIds},clientId:row.clientId,status:{in:closed}}}):0;
        if(closedCount!==requestIds.length || exactLinks.some(t=>!['COMPLETED','RETURN_REQUIRED'].includes(t.status)))
          throw new ConflictException('КИЗ занят другой незавершённой сборкой. Сначала разберите прежнюю заявку.');
      }
      if (fresh.status==='APPROVED') {
        if(fresh.resolution!==resolution) throw new ConflictException('По обращению уже принято другое решение.');
        return {id,status:fresh.status,resolution:fresh.resolution};
      }
      await tx.kizReviewCase.update({where:{id},data:{status:'APPROVED',resolution,reason:reason.trim(),decidedById:user.id,
        decidedByName:user.name,decidedAt:new Date(),decision:evidence.decision,evidence:json(evidence)}});
      await tx.auditLog.create({data:{userId:user.id,action:'KIZ_REVIEW_APPROVED',entity:'KizReviewCase',entityId:id,
        payload:json({resolution,reason:reason.trim(),confirmed,taskId:task.id,context:row.context,kizIdentity:row.kizIdentity,evidence})}});
      return {id,status:'APPROVED',resolution};
    });
  }
}

// FIX: acceptance consumes only this task's approval; uncertain network retries remain possible beforehand.
export async function finishKizReview(tx: Prisma.TransactionClient, task: FbsTsdAssembly, kiz: string, resolution: 'REUSE'|'RELABEL') {
  if (!kizReviewEnabled()) return;
  await tx.kizReviewCase.updateMany({where:{taskId:task.id,kizIdentity:identityOf(kiz),context:reviewContext(task),
    status:'APPROVED',resolution},data:{status:'USED',usedAt:new Date()}});
}
export async function approvedUnitRelabel(tx: Prisma.TransactionClient, task: FbsTsdAssembly, kiz: string) {
  if (!kizReviewEnabled()) return false;
  return Boolean(await tx.kizReviewCase.findFirst({where:{taskId:task.id,kizIdentity:identityOf(kiz),
    context:reviewContext(task),status:'APPROVED',resolution:'RELABEL'}}));
}
// FIX: a different crypto suffix does not make an already registered serial into a new KIZ.
export async function assertUnusedReplacement(tx: Prisma.TransactionClient, value: string) {
  const identity=identityOf(value);
  if(!identity)throw new BadRequestException('Отсканируйте полный новый КИЗ.');
  await tx.$queryRaw(Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${identity},0))`);
  const prefixes=prefixesOf(identity);
  const [marks,tasks,history]=await Promise.all([
    tx.productMark.findMany({where:{OR:prefixes.map(p=>({value:{startsWith:p}}))},select:{value:true}}),
    tx.fbsTsdAssembly.findMany({where:{OR:prefixes.map(p=>({kiz:{startsWith:p}}))},select:{kiz:true}}),
    tx.shippedKizHistory.findMany({where:{OR:prefixes.map(p=>({kiz:{startsWith:p}}))},select:{kiz:true}}),
  ]);
  if(marks.some(m=>identityOf(m.value)===identity)||[...tasks,...history].some(m=>identityOf(m.kiz??'')===identity))
    throw new BadRequestException('Новый КИЗ уже зарегистрирован или использован. Возьмите свободный новый КИЗ.');
}
