import { releaseCancelledBindings } from './kiz-cancelled-reuse';
import {BadRequestException, ConflictException, ForbiddenException, NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {ClientRequestStatus, FbsTsdAssembly, Prisma} from '@prisma/client';
import {PrismaService} from './prisma/prisma.service';
import {physicalKizIdentity} from './kiz-physical-identity';
import {inspectKizReuse, kizReuseEnabled, type ReuseDecision} from './kiz-wb-reuse';
import {ClientScopeService} from '../modules/auth/client-scope.service';
import type {AuthUser} from '../modules/auth/auth.types';
import { releaseWrittenOffBindings } from './kiz-manual-writeoff';

export const kizReviewEnabled = () => kizReuseEnabled() && process.env.WMS_KIZ_REVIEW_QUEUE_ENABLED === 'true';
const closed: ClientRequestStatus[] = ['DONE','CANCELLED','REJECTED'];
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const identityOf = (value: string) => physicalKizIdentity(value.replace(/^\(01\)(\d{14})\(21\)/,(_,gtin)=>`01${gtin}21`).replace(/^(01\d{14})\u001d21/,(_,gtin)=>`${gtin}21`));
const prefixesOf = (identity: string) => [identity,']d2'+identity,']D2'+identity,`(01)${identity.slice(2,16)}(21)${identity.slice(18)}`];
type Evidence = Awaited<ReturnType<typeof inspectKizReuse>>;
// FIX: UNIT records deliberately have no request; the namespace separates them from assembly cases.
const unitKey = (markId: string) => `UNIT:${markId}`;
export const unitReviewContext = (m: {id:string;clientId:string;skuId:string;boxId:string|null;status:string;updatedAt:Date}) =>
  createHash('sha256').update(JSON.stringify([m.id,m.clientId,m.skuId,m.boxId,m.status,m.updatedAt])).digest('hex');
async function unitMark(tx: Prisma.TransactionClient, clientId: string, identity: string) {
  const marks=await tx.productMark.findMany({where:{clientId,OR:prefixesOf(identity).map(p=>({value:{startsWith:p}}))},include:{box:true,sku:true}});
  const exact=marks.filter(m=>identityOf(m.value)===identity);
  return exact.length===1?exact[0]:null;
}
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
    if(evidence.decision==='ALLOW'&&evidence.manualWriteoffRecovery){
      await releaseWrittenOffBindings(tx,task,kiz,evidence.manualWriteoffRecovery);
      const context=reviewContext(task);
      const old=await tx.kizReviewCase.findUnique({where:key});
      const data={clientId,warehouseId:request.warehouseId,requestId:task.requestId,kiz,context,decision:'ALLOW',status:'APPROVED',resolution:'REUSE',
        reason:'Автоматически: ручное списание и подтверждённое физическое восстановление',decidedById:null,decidedByName:'Система',decidedAt:new Date(),usedAt:null,evidence:json(evidence),
        snapshot:json({requestNumber:request.number,orderId:task.orderId,productName:task.productName,article:task.article,boxCode:task.boxCode,workerName:task.workerName})};
      const row=await tx.kizReviewCase.upsert({where:key,create:{...data,taskId,kizIdentity:identity},update:{...data,attempts:{increment:1}}});
      if(old?.status!=='APPROVED'||old.context!==context||old.reason!==data.reason)await tx.auditLog.create({data:{userId:task.workerUserId,action:'KIZ_MANUAL_WRITEOFF_REUSE_ALLOWED',entity:'KizReviewCase',entityId:row.id,
        payload:json({taskId,clientId,kizIdentity:identity,reason:data.reason,proof:evidence.manualWriteoffRecovery})}});
      return 'ALLOW';
    }
    // FIX: claim a standalone permission once, atomically, for the next actual picking attempt.
    const mark=await unitMark(tx,clientId,identity);
    if(mark && mark.status==='AVAILABLE' && mark.skuId===task.skuId && mark.boxId===task.boxId && mark.box?.warehouseId===request.warehouseId) {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "KizReviewCase" WHERE "taskId"=${unitKey(mark.id)} FOR UPDATE`);
      const independent=await tx.kizReviewCase.findUnique({where:{taskId_kizIdentity:{taskId:unitKey(mark.id),kizIdentity:identity}}});
      if(independent?.context===unitReviewContext(mark) && ['APPROVED','CLAIMED'].includes(independent.status)) {
        const snapshot=independent.snapshot as Record<string,unknown>;
        const claimed=typeof snapshot.claimedTaskId==='string'?snapshot.claimedTaskId:null;
        const owner=claimed && claimed!==taskId?await tx.fbsTsdAssembly.findUnique({where:{id:claimed}}):null;
        if(owner && (owner.status==='IN_PROGRESS'||owner.kiz)) throw new ConflictException('Разрешение по КИЗу уже используется в другой сборке.');
        const allowed=independent.resolution==='RELABEL'?'RELABEL':permittedReviewAction({...independent,status:'APPROVED'},unitReviewContext(mark),evidence.decision);
        if(allowed) {
          const data={clientId,warehouseId:request.warehouseId,requestId:task.requestId,kiz,context:reviewContext(task),decision:evidence.decision,
            status:'APPROVED',resolution:independent.resolution,reason:independent.reason,decidedById:independent.decidedById,
            decidedByName:independent.decidedByName,decidedAt:independent.decidedAt,evidence:json(evidence),usedAt:null,
            snapshot:json({requestNumber:request.number,orderId:task.orderId,productName:task.productName,boxCode:task.boxCode,workerName:task.workerName,unitApprovalId:independent.id})};
          await tx.kizReviewCase.upsert({where:key,create:{...data,taskId,kizIdentity:identity},update:data});
          if(independent.status!=='CLAIMED'||claimed!==taskId) {
            await tx.kizReviewCase.update({where:{id:independent.id},data:{status:'CLAIMED',snapshot:json({...snapshot,claimedTaskId:taskId})}});
            await tx.auditLog.create({data:{userId:task.workerUserId,action:'KIZ_UNIT_PERMISSION_CLAIMED',entity:'KizReviewCase',entityId:independent.id,payload:json({taskId,kizIdentity:identity})}});
          }
          return allowed;
        }
      }
    }
    const previous=await tx.kizReviewCase.findUnique({where:key});
    if (evidence.decision==='ALLOW' && !previous) return 'ALLOW';
    const context=reviewContext(task);
    const staleUnitPermission=Boolean((previous?.snapshot as Record<string,unknown>|undefined)?.unitApprovalId);
    const permission=staleUnitPermission?null:permittedReviewAction(previous,context,evidence.decision);
    const reset=staleUnitPermission || previous?.context!==context || (previous?.resolution==='REUSE' && evidence.decision==='RELABEL') ||
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
  async unitChoices(identity: string, user: AuthUser) {
    requireReviewAdmin(user);
    const marks=await this.db.productMark.findMany({where:{clientId:this.clients.resolveClientFilter(user),box:{warehouseId:user.activeWarehouseId!},
      OR:prefixesOf(identity).map(p=>({value:{startsWith:p}}))},include:{box:true,sku:true}});
    const exact=marks.filter(m=>identityOf(m.value)===identity);
    if(exact.length!==1)return [];
    const mark=exact[0];
    const evidence=await inspectKizReuse(this.db,mark.clientId,mark.value);
    const saved=await this.db.kizReviewCase.findUnique({where:{taskId_kizIdentity:{taskId:unitKey(mark.id),kizIdentity:identity}}});
    const current=saved?.context===unitReviewContext(mark)&&['APPROVED','CLAIMED'].includes(saved.status)&&
      !(saved.resolution==='REUSE'&&evidence.decision==='RELABEL')?saved:null;
    return [{id:`unit:${mark.id}`,kizIdentity:identity,status:current?.status??'OPEN',decision:evidence.decision,
      resolution:current?.resolution,decidedByName:current?.decidedByName,active:mark.status==='AVAILABLE'&&!['archived','deleted'].includes(mark.box?.status??'deleted'),
      snapshot:{scope:'UNIT',productName:mark.sku.name,boxCode:mark.box?.code},scope:'UNIT'}];
  }
  async list(user: AuthUser, cursor?: string, identity?: string) {
    requireReviewAdmin(user);
    const items=await this.db.kizReviewCase.findMany({where:{warehouseId:user.activeWarehouseId!,clientId:this.clients.resolveClientFilter(user),
      NOT:{taskId:{startsWith:'UNIT:'}},
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
    if(id.startsWith('unit:'))return this.decideUnit(id.slice(5),resolution,reason,user);
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
        await releaseCancelledBindings(tx,row.clientId,row.kiz,evidence,user.id,id,task.id);
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
  private async decideUnit(markId:string,resolution:'REUSE'|'RELABEL',reason:string,user:AuthUser) {
    const initial=await this.db.productMark.findFirst({where:{id:markId,clientId:this.clients.resolveClientFilter(user),box:{warehouseId:user.activeWarehouseId!}}});
    if(!initial)throw new NotFoundException('КИЗ не найден в выбранном филиале.');
    this.clients.requireClientAccess(user,initial.clientId,'write');
    const identity=identityOf(initial.value);
    if(!identity)throw new BadRequestException('КИЗ не распознан.');
    const evidence=await inspectKizReuse(this.db,initial.clientId,initial.value);
    if(resolution==='REUSE'&&evidence.decision==='RELABEL')throw new BadRequestException('Подтверждена продажа или погашение. Можно разрешить только переклейку.');
    if(resolution==='RELABEL'&&evidence.decision!=='RELABEL')throw new BadRequestException('Необходимость переклейки не подтверждена.');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ProductMark" WHERE "id"=${markId} FOR UPDATE`);
      const mark=await unitMark(tx,initial.clientId,identity);
      if(!mark||mark.id!==markId||unitReviewContext(mark)!==unitReviewContext(initial)||mark.status!=='AVAILABLE'||
        !mark.box||mark.box.clientId!==mark.clientId||mark.box.warehouseId!==user.activeWarehouseId||['archived','deleted'].includes(mark.box.status))
        throw new ConflictException('Единица изменилась или недоступна. Повторите проверку КИЗа.');
      const balance=await tx.stockBalance.aggregate({where:{clientId:mark.clientId,warehouseId:user.activeWarehouseId!,skuId:mark.skuId,boxId:mark.boxId,status:'AVAILABLE'},_sum:{quantity:true}});
      if((balance._sum.quantity??0)<1)throw new ConflictException('Нет доступного остатка этой единицы.');
      const links=(await tx.fbsTsdAssembly.findMany({where:{clientId:mark.clientId,OR:prefixesOf(identity).map(p=>({kiz:{startsWith:p}}))}})).filter(t=>identityOf(t.kiz??'')===identity);
      // FIX: admin-only reuse of an audited cancelled return, also from independent TSD lookup.
      if(resolution==='REUSE'&&links.length)await releaseCancelledBindings(tx,mark.clientId,mark.value,evidence,user.id,'unit:'+markId);
      if(resolution==='RELABEL'&&links.length){
        const ids=[...new Set(links.map(t=>t.requestId))];
        if(links.some(t=>!['COMPLETED','RETURN_REQUIRED'].includes(t.status))||await tx.clientRequest.count({where:{id:{in:ids},clientId:mark.clientId,status:{in:closed}}})!==ids.length)
          throw new ConflictException('КИЗ занят незавершённой сборкой.');
      }
      const key={taskId_kizIdentity:{taskId:unitKey(markId),kizIdentity:identity}};
      const old=await tx.kizReviewCase.findUnique({where:key});
      if(old?.context===unitReviewContext(mark)&&['APPROVED','CLAIMED'].includes(old.status)&&
        !(old.resolution==='REUSE'&&resolution==='RELABEL'&&evidence.decision==='RELABEL')) {
        if(old.resolution!==resolution)throw new ConflictException('По этому КИЗу уже принято другое решение.');
        return {id:`unit:${markId}`,status:old.status,resolution};
      }
      const data={clientId:mark.clientId,warehouseId:user.activeWarehouseId!,requestId:'',kiz:mark.value,context:unitReviewContext(mark),status:'APPROVED',
        decision:evidence.decision,resolution,reason:reason.trim(),decidedById:user.id,decidedByName:user.name,decidedAt:new Date(),usedAt:null,evidence:json(evidence),
        snapshot:json({scope:'UNIT',markId,skuId:mark.skuId,boxId:mark.boxId,boxCode:mark.box.code,productName:mark.sku.name})};
      const row=await tx.kizReviewCase.upsert({where:key,create:{...data,taskId:unitKey(markId),kizIdentity:identity},update:data});
      await tx.auditLog.create({data:{userId:user.id,action:'KIZ_UNIT_PERMISSION_APPROVED',entity:'KizReviewCase',entityId:row.id,payload:json({resolution,reason:reason.trim(),markId,kizIdentity:identity,evidence})}});
      return {id:`unit:${markId}`,status:'APPROVED',resolution};
    });
  }
}

// FIX: acceptance consumes only this task's approval; uncertain network retries remain possible beforehand.
export async function finishKizReview(tx: Prisma.TransactionClient, task: FbsTsdAssembly, kiz: string, resolution: 'REUSE'|'RELABEL') {
  if (!kizReviewEnabled()) return;
  await tx.kizReviewCase.updateMany({where:{taskId:task.id,kizIdentity:identityOf(kiz),context:reviewContext(task),
    status:'APPROVED',resolution},data:{status:'USED',usedAt:new Date()}});
  await tx.kizReviewCase.updateMany({where:{clientId:task.clientId,kizIdentity:identityOf(kiz),taskId:{startsWith:'UNIT:'},status:'CLAIMED',resolution,
    snapshot:{path:['claimedTaskId'],equals:task.id}},data:{status:'USED',usedAt:new Date()}});
}
export async function reusePermissionForProposal(tx:Prisma.TransactionClient,task:FbsTsdAssembly,kiz:string) {
  if(!kizReviewEnabled())return false;
  const identity=identityOf(kiz);
  if(!identity)return false;
  if(await tx.kizReviewCase.findFirst({where:{taskId:task.id,kizIdentity:identity,context:reviewContext(task),status:'APPROVED',resolution:'REUSE'}}))return true;
  const mark=await unitMark(tx,task.clientId,identity);
  if(!mark||mark.skuId!==task.skuId||mark.boxId!==task.boxId||mark.status!=='AVAILABLE')return false;
  return Boolean(await tx.kizReviewCase.findFirst({where:{taskId:unitKey(mark.id),kizIdentity:identity,context:unitReviewContext(mark),status:{in:['APPROVED','CLAIMED']},resolution:'REUSE'}}));
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
