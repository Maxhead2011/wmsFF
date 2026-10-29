import {BadRequestException, ConflictException, ForbiddenException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {clientKizIdentity, clientKizGuardEnabled, clientKizFilter, lookupClientKiz, lockClientKiz} from './kiz-client-registry';

// FIX: one client-scoped, contextual permission for a second dispatch; AVAILABLE is not permission.
export type ClientKizUse = {scope:'FBS'|'FBO'|'RECEIPT';clientId:string;warehouseId:string;requestId:string;
  taskId?:string;kiz:string;skuId?:string|null;boxId?:string|null;operationKey?:string;sourceDocument?:string;
  externalEvidence?:any;receiptInfo?:any;allowRelabel?:boolean};
const json=(v:any)=>JSON.parse(JSON.stringify(v));
const digest=(v:any)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const terminal=['DONE','CANCELLED','REJECTED'];
export const clientUseTaskKey=(i:ClientKizUse)=>`GUARD:${i.scope}:${i.clientId}:${i.taskId||i.requestId||i.operationKey||digest([i.sourceDocument,i.boxId,i.kiz])}`;
export const clientUseContext=(i:ClientKizUse)=>digest([i.scope,i.clientId,i.warehouseId,i.requestId,i.taskId||'',i.skuId||'',i.boxId||'']);
const markVersion=(m:any)=>m?digest([m.id,m.clientId,m.skuId,m.boxId,m.status,m.updatedAt]):null;
const filter=(key:string,field='kiz')=>clientKizFilter(key,field);
async function identityLock(tx:any,clientId:string,key:string){
  await lockClientKiz(tx,clientId,key);
}
export async function clientPhysicalMark(db:any,clientId:string,kiz:string){
 const key=clientKizIdentity(kiz);if(!key)throw new BadRequestException('Не удалось определить GTIN и серийный номер КИЗ.');
 const matches=(await db.productMark.findMany({where:{clientId,...filter(key,'value')},include:{box:true,sku:true}}))
  .filter((m:any)=>clientKizIdentity(m.value)===key);
 if(matches.length>1){const error:any=new ConflictException('ДУБЛЬ КИЗ. Найдено несколько записей у клиента. ОТЛОЖИТЕ ТОВАР и передайте администратору.');error.clientKizAmbiguity={clientId,kiz};throw error;}
 return matches[0]??null;
}
async function history(db:any,i:ClientKizUse){
 const key=clientKizIdentity(i.kiz);
 const [shipments,units,consumed]=await Promise.all([
  db.shippedKizHistory.findMany({where:{clientId:i.clientId,...filter(key)},orderBy:{shippedAt:'desc'},take:501}),
  db.fboAssemblyUnit.findMany({where:{state:{not:'RETURNED'},...filter(key),
   assembly:{request:{clientId:i.clientId,status:'DONE'}}},include:{assembly:{include:{request:true}}},take:501}),
  db.kizReviewCase.findMany({where:{clientId:i.clientId,kizIdentity:key,status:'USED',taskId:{startsWith:'GUARD:'}},take:501}),
 ]);
 const own=(v:any)=>clientKizIdentity(v.kiz??'')===key;
 const events=[...shipments.filter(own).map((s:any)=>({id:`SHIP:${s.id}`,at:s.shippedAt,requestId:s.requestId,
   request:{number:s.requestNumber,warehouseId:s.warehouseId},orderId:s.orderId,boxCode:s.sourceBoxCode,event:'Подтверждённая отгрузка WMS'})),
  ...units.filter(own).map((u:any)=>({id:`FBO:${u.id}`,at:u.assembly?.request?.updatedAt,requestId:u.requestId,
   request:{number:u.assembly?.request?.number,warehouseId:u.assembly?.request?.warehouseId},boxCode:u.sourceBoxCode,event:'Отгрузка FBO, заявка сдана'})),
  ...consumed.map((c:any)=>({id:`CONSUMED:${c.id}`,at:c.usedAt,requestId:c.requestId,request:{warehouseId:c.warehouseId},event:'Разрешение погашено при отгрузке'}))];
 const remote=(i.externalEvidence?.orders??[]).filter((o:any)=>o.verified&&o.containsKiz&&(o.wbStatus==='sold'||o.supplierStatus==='complete'));
 for(const o of remote)events.push({id:`WB:${o.orderId}`,at:null,requestId:'',request:null,orderId:o.orderId,boxCode:null,event:'Подтверждённое использование в WB'} as any);
 const truncated=shipments.length>500||units.length>500||consumed.length>500;
 return {history:events,orders:i.externalEvidence?.orders??[],circulation:i.externalEvidence?.circulation??null,
  checkedAt:new Date().toISOString(),decision:events.length||truncated?'REVIEW':'ALLOW',truncated,
  fingerprint:digest(events.map((e:any)=>e.id).sort())};
}
function required(i:ClientKizUse){
 if(!i.clientId||!i.warehouseId||!clientKizIdentity(i.kiz))throw new BadRequestException('Не определены клиент, филиал или КИЗ.');
 if(i.scope!=='RECEIPT'&&!i.requestId)throw new BadRequestException('Не определена заявка для проверки КИЗ.');
}
async function currentContext(db:any,i:ClientKizUse){
 if(i.scope==='RECEIPT')return null;
 const request=await db.clientRequest.findUnique({where:{id:i.requestId}});
 if(!request||request.clientId!==i.clientId||request.warehouseId!==i.warehouseId||['CANCELLED','REJECTED'].includes(request.status))
  throw new ConflictException('Заявка или клиент изменились. Повторите проверку КИЗ.');
 if(i.scope==='FBS'){
  const task=await db.fbsTsdAssembly.findUnique({where:{id:i.taskId}});
  if(!task||task.clientId!==i.clientId||task.requestId!==i.requestId||task.skuId!==i.skuId||task.boxId!==(i.boxId??null))
   throw new ConflictException('Задание или исходный короб изменились. Повторите проверку КИЗ.');
 }
 return request;
}
export class ClientKizReviewRequired extends ConflictException {
 constructor(public readonly reviewInput:ClientKizUse){super({code:'KIZ_REVIEW_REQUIRED',message:'ОТЛОЖИТЕ ТОВАР. КИЗ ранее отгружался. Повторное использование — только после решения администратора в «КИЗ → Проверки КИЗ».'});}
}
async function assertNoCompetingClaim(tx:any,i:ClientKizUse,key:string,currentId?:string){
 const claims=await tx.kizReviewCase.findMany({where:{clientId:i.clientId,kizIdentity:key,...(currentId?{id:{not:currentId}}:{}),status:'CLAIMED',taskId:{startsWith:'GUARD:'}}});
 for(const claim of claims){
  const request=await tx.clientRequest.findUnique({where:{id:claim.requestId}});
  // A cancelled never-shipped attempt may release its claim; completed shipment never does.
  if(request&&['CANCELLED','REJECTED'].includes(request.status)&&claim.resolution==='FIRST_USE'){
   const prior=claim.snapshot?.clientGuard?.input;
   const oldHistory=prior?await history(tx,{...prior,requestId:''}):null;
   const mark=await clientPhysicalMark(tx,i.clientId,i.kiz);
   const tasks=await tx.fbsTsdAssembly.findMany({where:{clientId:i.clientId,requestId:claim.requestId,kiz:{not:null},status:{in:['IN_PROGRESS','COMPLETED','RETURN_REQUIRED']}}});
   const units=await tx.fboAssemblyUnit.findMany({where:{requestId:claim.requestId,activeMarkId:{not:null},state:{not:'RETURNED'}}});
   if(oldHistory?.decision==='ALLOW'&&mark?.status==='AVAILABLE'&&!tasks.length&&!units.length){
    await tx.kizReviewCase.update({where:{id:claim.id},data:{status:'RESOLVED'}});continue;
   }
  }
  throw new ConflictException('Этот КИЗ уже закреплён за другой сборкой. ОТЛОЖИТЕ ТОВАР.');
 }
}
async function ownExpectedMovement(tx:any,i:ClientKizUse,mark:any,proof:any){
 if(!mark)return !proof.markId;
 if(proof.markId&&proof.markId!==mark.id||mark.clientId!==i.clientId||i.skuId&&mark.skuId!==i.skuId)return false;
 if(proof.markVersion===markVersion(mark))return true;
 if(i.scope==='FBS'){
  const task=await tx.fbsTsdAssembly.findUnique({where:{id:i.taskId}});
  if(clientKizIdentity(task?.kiz??'')!==clientKizIdentity(i.kiz))return false;
  if(!proof.markId&&mark.status==='AVAILABLE'&&mark.boxId===(i.boxId??null)&&
    mark.sourceDocument?.startsWith(`FBS TSD, заказ ${task.orderId}:`))return true;
  const movement=mark.stockMovementId?await tx.stockMovement.findUnique({where:{id:mark.stockMovementId}}):null;
  return movement?.clientId===i.clientId&&movement?.sourceDocument===i.requestId&&movement?.skuId===i.skuId&&movement?.boxId===mark.boxId&&
   ['PACKING','SHIPPING'].includes(mark.status)&&movement.status===mark.status;
 }
 if(i.scope==='FBO'){
  const units=await tx.fboAssemblyUnit.findMany({where:{requestId:i.requestId,markId:mark.id,state:{in:['PICKED','PACKED']}}});
  return units.some((u:any)=>u.skuId===mark.skuId&&clientKizIdentity(u.kiz??'')===clientKizIdentity(i.kiz)&&
   (u.sourceBoxId||null)===(i.boxId||null)&&((u.state==='PACKED'&&u.targetBoxId===mark.boxId)||
    (u.state==='PICKED'&&(u.wholeBox?u.sourceBoxId===mark.boxId:mark.box?.code===`FBO-PICK-${i.requestId}`))));
 }
 return false;
}
async function assertNoActiveBinding(tx:any,i:ClientKizUse,key:string){
 const tasks=(await tx.fbsTsdAssembly.findMany({where:{clientId:i.clientId,id:{not:i.taskId||''},...filter(key),status:{in:['IN_PROGRESS','COMPLETED','RETURN_REQUIRED']}}})).filter((t:any)=>clientKizIdentity(t.kiz??'')===key);
 for(const task of tasks){const request=await tx.clientRequest.findUnique({where:{id:task.requestId}});if(!request||!terminal.includes(request.status))throw new ConflictException('КИЗ занят другой сборкой FBS. ОТЛОЖИТЕ ТОВАР.');}
 const units=(await tx.fboAssemblyUnit.findMany({where:{requestId:{not:i.requestId},activeMarkId:{not:null},...filter(key),assembly:{request:{clientId:i.clientId}}},include:{assembly:{include:{request:true}}}})).filter((u:any)=>clientKizIdentity(u.kiz??'')===key);
 if(units.some((u:any)=>!terminal.includes(u.assembly?.request?.status)))throw new ConflictException('КИЗ занят другой сборкой FBO. ОТЛОЖИТЕ ТОВАР.');
}
// Caller owns the transaction. A refused transaction is persisted by withClientKizReview afterwards.
export async function assertClientKizUse(tx:any,i:ClientKizUse,user:any):Promise<'ALLOW'|'RELABEL'> {
 if(!clientKizGuardEnabled())return 'ALLOW';required(i);
 const key=clientKizIdentity(i.kiz);await identityLock(tx,i.clientId,key);
 await currentContext(tx,i);
 const row=await tx.kizReviewCase.findUnique({where:{taskId_kizIdentity:{taskId:clientUseTaskKey(i),kizIdentity:key}}});
 const e=await history(tx,{...i,externalEvidence:i.externalEvidence??row?.snapshot?.clientGuard?.input?.externalEvidence});
 let mark:any;try{mark=await clientPhysicalMark(tx,i.clientId,i.kiz);}catch(error){if(error instanceof ConflictException)throw new ClientKizReviewRequired(i);throw error;}
 const proof=row?.snapshot?.clientGuard;
 await assertNoCompetingClaim(tx,i,key,row?.id);
 await assertNoActiveBinding(tx,i,key);
 if(e.decision==='ALLOW'){
  if(row?.status==='CLAIMED'&&row.resolution==='FIRST_USE'&&row.context===clientUseContext(i)&&await ownExpectedMovement(tx,i,mark,proof))return 'ALLOW';
  if(row?.status==='CLAIMED'||row?.status==='USED'||row?.status==='REJECTED')throw new ClientKizReviewRequired(i);
  // FIX: receipt and picking serialize on the same identity, including an as-yet unregistered physical mark.
  // Unknown origin stays unknown; an existing genuine receipt is immutable and is never overwritten.
  await tx.$executeRaw(Prisma.sql`INSERT INTO "KizClientRegistry"
   ("clientId",identity,"firstWarehouseId","skuId","operationKey","sourceDocument","userId",source)
   VALUES (${i.clientId},${key},${i.warehouseId},${i.skuId??null},${clientUseTaskKey(i)},${i.requestId},${user.id??null},'LEGACY_UNKNOWN')
   ON CONFLICT ("clientId",identity) DO NOTHING`);
  await tx.kizReviewCase.upsert({where:{taskId_kizIdentity:{taskId:clientUseTaskKey(i),kizIdentity:key}},
   create:{clientId:i.clientId,warehouseId:i.warehouseId,requestId:i.requestId,taskId:clientUseTaskKey(i),kiz:i.kiz,kizIdentity:key,context:clientUseContext(i),
    status:'CLAIMED',decision:'ALLOW',resolution:'FIRST_USE',snapshot:json({scope:i.scope,clientGuard:{version:1,input:i,markId:mark?.id??null,markVersion:markVersion(mark),history:e.fingerprint}}),evidence:json(e)},
   update:{status:'CLAIMED',decision:'ALLOW',resolution:'FIRST_USE',context:clientUseContext(i),decidedById:null,decidedByName:null,decidedAt:null,usedAt:null,
    snapshot:json({scope:i.scope,clientGuard:{version:1,input:i,markId:mark?.id??null,markVersion:markVersion(mark),history:e.fingerprint}}),evidence:json(e)}});
  return 'ALLOW';
 }
 const valid=row&&row.clientId===i.clientId&&row.context===clientUseContext(i)&&row.decidedById&&row.reason&&
  proof?.version===1&&proof.history===e.fingerprint&&!e.truncated&&proof.markId===mark?.id&&
  (!i.skuId||mark?.skuId===i.skuId)&&['APPROVED','CLAIMED'].includes(row.status);
 if(!valid)throw new ClientKizReviewRequired(i);
 if(row.resolution==='RELABEL'&&i.allowRelabel)return 'RELABEL';
 if(row.resolution!=='REUSE'||i.scope==='RECEIPT')throw new ClientKizReviewRequired(i);
 if(row.status==='APPROVED'&&proof.markVersion!==markVersion(mark))throw new ClientKizReviewRequired(i);
 if(row.status==='CLAIMED'&&!await ownExpectedMovement(tx,i,mark,proof))throw new ClientKizReviewRequired(i);
 if(row.status==='APPROVED'){
  await tx.kizReviewCase.update({where:{id:row.id},data:{status:'CLAIMED'}});
  await tx.auditLog.create({data:{userId:user.id,entity:'KizReviewCase',entityId:row.id,action:'KIZ_CLIENT_PERMISSION_CLAIMED',payload:json({context:row.context,identity:key,requestId:i.requestId})}});
 }
 return 'ALLOW';
}
export async function queueClientKizReview(db:any,i:ClientKizUse,user:any){
 if(!clientKizGuardEnabled())throw new ForbiddenException('Проверка КИЗ выключена.');required(i);
 return db.$transaction(async(tx:any)=>{
  const key=clientKizIdentity(i.kiz);await identityLock(tx,i.clientId,key);
  const request=await currentContext(tx,i),e=await history(tx,i);
  let mark:any=null;try{mark=await clientPhysicalMark(tx,i.clientId,i.kiz);}catch(error){if(!(error instanceof ConflictException))throw error;}
  const old=await tx.kizReviewCase.findUnique({where:{taskId_kizIdentity:{taskId:clientUseTaskKey(i),kizIdentity:key}}});
  const context=clientUseContext(i),unchanged=old?.context===context&&old?.snapshot?.clientGuard?.history===e.fingerprint;
  const task=i.scope==='FBS'?await tx.fbsTsdAssembly.findUnique({where:{id:i.taskId}}):null;
  const snapshot={scope:i.scope,requestNumber:request?.number??null,orderId:task?.orderId??null,productName:mark?.sku?.name??i.receiptInfo?.productName??'КИЗ',
   barcode:i.receiptInfo?.barcode??null,boxCode:mark?.box?.code??i.receiptInfo?.firstBoxCode??null,workerName:user.name,receiptInfo:i.receiptInfo,
   clientGuard:{version:1,input:json(i),markId:mark?.id??null,markVersion:markVersion(mark),history:e.fingerprint}};
  const reset=!unchanged||old?.resolution==='FIRST_USE'||old?.status==='APPROVED'&&old?.snapshot?.clientGuard?.markVersion!==markVersion(mark);
  const row=await tx.kizReviewCase.upsert({where:{taskId_kizIdentity:{taskId:clientUseTaskKey(i),kizIdentity:key}},
   create:{clientId:i.clientId,warehouseId:i.warehouseId,requestId:i.requestId||'',taskId:clientUseTaskKey(i),kiz:i.kiz,kizIdentity:key,context,
    status:'OPEN',decision:'REVIEW',snapshot:json(snapshot),evidence:json(e)},
   update:{attempts:{increment:1},...(reset?{context,status:'OPEN',resolution:null,reason:null,decidedById:null,decidedByName:null,decidedAt:null,usedAt:null,snapshot:json(snapshot),evidence:json(e)}:{})}});
  if(!old||reset)await tx.auditLog.create({data:{userId:user.id,entity:'KizReviewCase',entityId:row.id,action:'KIZ_CLIENT_REVIEW_OPENED',payload:json({context,identity:key,previous:old??null})}});
  return {id:row.id,status:row.status,message:'Обращение находится в «КИЗ → Проверки КИЗ». Товар отложите.'};
 });
}
export async function withClientKizReview<T>(db:any,user:any,action:()=>Promise<T>,fboRequestId?:string):Promise<T>{
 try{return await action();}catch(e){if(fboRequestId)await queueFboKizError(db,fboRequestId,e,user);else if(e instanceof ClientKizReviewRequired){await queueClientKizReview(db,e.reviewInput,user);}throw e;}
}
export async function queueFboKizError(db:any,requestId:string,error:any,user:any){
 if(!clientKizGuardEnabled())return;
 if(error instanceof ClientKizReviewRequired){await queueClientKizReview(db,error.reviewInput,user);return;}
 if(!error?.clientKizAmbiguity)return;
 const request=await db.clientRequest.findUnique({where:{id:requestId}});
 if(request?.clientId!==error.clientKizAmbiguity.clientId)return;
 await queueClientKizReview(db,{scope:'FBO',clientId:request.clientId,warehouseId:request.warehouseId,requestId,kiz:error.clientKizAmbiguity.kiz},user);
}
export async function queueReceiptKizReview(db:any,clients:any,body:any,user:any){
 if(!clientKizGuardEnabled())throw new ForbiddenException('Проверка КИЗ выключена.');
 clients.requireClientAccess(user,body.clientId,'write');
 if(!user.activeWarehouseId)throw new BadRequestException('Выберите филиал.');
 const duplicate=await lookupClientKiz(db,body.clientId,body.kiz,user.activeWarehouseId);
 if(!duplicate)throw new ConflictException('КИЗ не найден среди ранее зарегистрированных.');
 const box=body.boxCode?await db.box.findUnique({where:{code:body.boxCode}}):null;
 if(box&&(box.clientId!==body.clientId||box.warehouseId!==user.activeWarehouseId))throw new ForbiddenException('Нет доступа к коробу.');
 return queueClientKizReview(db,{scope:'RECEIPT',clientId:body.clientId,warehouseId:user.activeWarehouseId,requestId:'',kiz:body.kiz,
  boxId:box?.id??null,operationKey:body.operationKey,sourceDocument:body.sourceDocument,receiptInfo:duplicate},user);
}
export function clientReviewPresentation(row:any,warehouseId?:string){
 const {clientGuard,...snapshot}=row.snapshot??{};
 const evidence=row.evidence??{},history=(evidence.history??[]).filter((h:any)=>!warehouseId||h.request?.warehouseId===warehouseId);
 return {scope:row.snapshot?.scope,active:['OPEN','APPROVED'].includes(row.status),physicalReuseAllowed:row.snapshot?.scope!=='RECEIPT',
  decision:'REVIEW',snapshot,evidence:{...evidence,history,orders:(evidence.orders??[]).filter((o:any)=>history.some((h:any)=>h.orderId===o.orderId))}};
}
export async function decideClientKizReview(db:any,clients:any,row:any,resolution:string,reason:string,confirmed:boolean,user:any){
 if(!clientKizGuardEnabled()||user.isDemo||!user.roleCodes?.some((r:string)=>['ADMIN','OWNER','SUPER_ADMIN'].includes(r)))
  throw new ForbiddenException('Решение принимает только администратор.');
 if(!user.activeWarehouseId||row.warehouseId!==user.activeWarehouseId||(!user.permissionCodes?.includes('system:admin')&&user.writableWarehouseIds&&!user.writableWarehouseIds.includes(row.warehouseId)))
  throw new ForbiddenException('Нет права изменять данные филиала.');
 clients.requireClientAccess(user,row.clientId,'write');
 if(!confirmed||!['REUSE','RELABEL','REJECT'].includes(resolution)||typeof reason!=='string'||reason.trim().length<5||reason.length>1000)
  throw new BadRequestException('Подтвердите физическую проверку и укажите основание решения.');
 const input=row.snapshot?.clientGuard?.input;
 // Recheck marketplace evidence when the decision depends on it; never trust a stale screen.
 const external=input?.externalEvidence&&resolution!=='REJECT'
  ?await require('./kiz-wb-reuse').inspectKizReuse(db,row.clientId,row.kiz,input.taskId||''):input?.externalEvidence;
 return db.$transaction(async(tx:any)=>{
  const i:ClientKizUse={...input,externalEvidence:external};if(!i.clientId||i.clientId!==row.clientId)throw new ConflictException('Обращение требует обновления.');
  const key=clientKizIdentity(i.kiz);await identityLock(tx,i.clientId,key);const request=await currentContext(tx,i);
  if(request&&terminal.includes(request.status)&&resolution!=='REJECT')throw new ConflictException('Заявка уже закрыта. Разрешение больше не применимо.');
  const fresh=await tx.kizReviewCase.findUnique({where:{id:row.id}});
  if(!fresh||fresh.context!==row.context||!['OPEN','APPROVED'].includes(fresh.status))throw new ConflictException('Обращение изменилось.');
  let mark:any=null;try{mark=await clientPhysicalMark(tx,i.clientId,i.kiz);}catch(error){if(resolution!=='REJECT'||!(error instanceof ConflictException))throw error;}
  const e=await history(tx,i);
  if(resolution!=='REJECT'){
   if(i.boxId){const box=await tx.box.findUnique({where:{id:i.boxId}});if(!box||box.clientId!==i.clientId||box.warehouseId!==i.warehouseId)throw new ConflictException('Исходный короб недоступен в филиале.');}
   if(e.truncated||!mark||['DEFECT','QUARANTINE','BLOCKED'].includes(mark.status)||i.skuId&&mark.skuId!==i.skuId)
    throw new ConflictException('Физическая единица не определена однозначно. Сначала завершите сверку.');
   if(resolution==='REUSE'&&i.scope==='RECEIPT')throw new ConflictException('Обычная повторная приёмка запрещена. Оформите возврат отдельно; здесь можно отказать или назначить переклейку.');
   if(resolution==='REUSE'&&['RETIRED','WRITTEN_OFF'].includes(e.circulation))throw new ConflictException('КИЗ погашен. Требуется переклейка.');
   const tasks=(await tx.fbsTsdAssembly.findMany({where:{clientId:i.clientId,...filter(key),id:{not:i.taskId||''}}})).filter((t:any)=>clientKizIdentity(t.kiz??'')===key);
   for(const task of tasks){const req=await tx.clientRequest.findUnique({where:{id:task.requestId}});
    if(!req||!terminal.includes(req.status)||!['COMPLETED','RELEASED','WB_ACCOUNTED','CANCELLED'].includes(task.status))throw new ConflictException('КИЗ занят другой сборкой FBS.');}
   const units=(await tx.fboAssemblyUnit.findMany({where:{...filter(key),requestId:{not:i.requestId},activeMarkId:{not:null},assembly:{request:{clientId:i.clientId}}},include:{assembly:{include:{request:true}}}})).filter((u:any)=>clientKizIdentity(u.kiz??'')===key);
   if(units.some((u:any)=>!terminal.includes(u.assembly?.request?.status)))throw new ConflictException('КИЗ занят другой сборкой FBO.');
   if((await tx.kizReviewCase.findMany({where:{clientId:i.clientId,kizIdentity:key,id:{not:row.id},status:{in:['APPROVED','CLAIMED']},taskId:{startsWith:'GUARD:'}}})).length)
    throw new ConflictException('Для КИЗ уже есть действующее разрешение в другой заявке.');
   if(resolution==='REUSE')for(const old of tasks){
    await tx.auditLog.create({data:{userId:user.id,entity:'FbsTsdAssembly',entityId:old.id,action:'KIZ_CLIENT_BINDING_ARCHIVED',payload:json({reviewId:row.id,reason,before:old})}});
    const changed=await tx.fbsTsdAssembly.updateMany({where:{id:old.id,kiz:old.kiz,updatedAt:old.updatedAt},data:{kiz:null}});
    if(changed.count!==1)throw new ConflictException('Прежняя привязка изменилась.');
   }
  }
  if(resolution==='REUSE'){
   const closedUnits=(await tx.fboAssemblyUnit.findMany({where:{...filter(key),requestId:{not:i.requestId},activeMarkId:{not:null},assembly:{request:{clientId:i.clientId,status:{in:terminal}}}},include:{assembly:{include:{request:true}}}})).filter((u:any)=>clientKizIdentity(u.kiz??'')===key);
   for(const old of closedUnits){
    await tx.auditLog.create({data:{userId:user.id,entity:'FboAssemblyUnit',entityId:old.id,action:'KIZ_CLIENT_BINDING_ARCHIVED',payload:json({reviewId:row.id,reason,before:old})}});
    const changed=await tx.fboAssemblyUnit.updateMany({where:{id:old.id,activeMarkId:old.activeMarkId,state:old.state},data:{activeMarkId:null}});
    if(changed.count!==1)throw new ConflictException('Прежняя привязка FBO изменилась.');
   }
  }
  const status=resolution==='REJECT'?'REJECTED':'APPROVED';
  await tx.kizReviewCase.update({where:{id:row.id},data:{status,resolution,reason:reason.trim(),decidedById:user.id,decidedByName:user.name,decidedAt:new Date(),usedAt:null,
   snapshot:json({...fresh.snapshot,clientGuard:{...fresh.snapshot.clientGuard,input:i,markId:mark?.id??null,markVersion:markVersion(mark),history:e.fingerprint}}),evidence:json(e)}});
  await tx.auditLog.create({data:{userId:user.id,entity:'KizReviewCase',entityId:row.id,action:'KIZ_CLIENT_REVIEW_DECIDED',payload:json({resolution,reason,confirmed,context:row.context,identity:key})}});
  return {id:row.id,status,resolution};
 });
}
export async function finishClientKizUse(tx:any,i:ClientKizUse){
 if(!clientKizGuardEnabled())return;
 await tx.kizReviewCase.updateMany({where:{clientId:i.clientId,taskId:clientUseTaskKey(i),kizIdentity:clientKizIdentity(i.kiz),context:clientUseContext(i),status:'CLAIMED',resolution:{in:['REUSE','FIRST_USE']}},data:{status:'USED',usedAt:new Date()}});
}
export async function assertClientRequestKizShipment(tx:any,request:any,user:any){
 if(!clientKizGuardEnabled())return;
 const units=await tx.fboAssemblyUnit.findMany({where:{requestId:request.id,state:{not:'RETURNED'},kiz:{not:null}}});
 for(const unit of units)await assertClientKizUse(tx,{scope:'FBO',clientId:request.clientId,warehouseId:request.warehouseId,requestId:request.id,kiz:unit.kiz,skuId:unit.skuId,boxId:unit.sourceBoxId||null},user);
 const tasks=await tx.fbsTsdAssembly.findMany({where:{requestId:request.id,clientId:request.clientId,kiz:{not:null},status:{notIn:['RELEASED','CANCELLED']}}});
 const shipped=tasks.length?await tx.shippedKizHistory.findMany({where:{clientId:request.clientId,assemblyId:{in:tasks.map((t:any)=>t.id)}}}):[];
 for(const task of tasks){
  if(shipped.some((s:any)=>s.assemblyId===task.id&&s.requestId===request.id&&clientKizIdentity(s.kiz)===clientKizIdentity(task.kiz)))continue;
  await assertClientKizUse(tx,{scope:'FBS',clientId:request.clientId,warehouseId:request.warehouseId,requestId:request.id,taskId:task.id,kiz:task.kiz,skuId:task.skuId,boxId:task.boxId},user);
 }
}
export async function finishClientRequestKizShipment(tx:any,request:any){
 if(!clientKizGuardEnabled())return;
 await tx.kizReviewCase.updateMany({where:{clientId:request.clientId,requestId:request.id,taskId:{startsWith:'GUARD:'},status:'CLAIMED',resolution:{in:['REUSE','FIRST_USE']}},data:{status:'USED',usedAt:new Date()}});
}
// Only the authorized bind transaction may update its own pre-pick mark version.
export async function refreshClientKizClaim(tx:any,i:ClientKizUse,mark:any){
 if(!clientKizGuardEnabled())return;
 const key=clientKizIdentity(i.kiz),row=await tx.kizReviewCase.findUnique({where:{taskId_kizIdentity:{taskId:clientUseTaskKey(i),kizIdentity:key}}});
 if(!row||row.status!=='CLAIMED'||row.context!==clientUseContext(i))throw new ConflictException('Привязка КИЗ не подтверждена.');
 await tx.kizReviewCase.update({where:{id:row.id},data:{snapshot:json({...row.snapshot,clientGuard:{...row.snapshot.clientGuard,markId:mark.id,markVersion:markVersion(mark)}})}});
}
export async function assertFbsClientKiz(db:any,task:any,kiz:string,user:any){
 if(!clientKizGuardEnabled())return 'ALLOW';
 const request=await db.clientRequest.findUnique({where:{id:task.requestId}});
 const i:ClientKizUse={scope:'FBS',clientId:task.clientId,warehouseId:request?.warehouseId,requestId:task.requestId,taskId:task.id,kiz,skuId:task.skuId,boxId:task.boxId,allowRelabel:true};
 return withClientKizReview(db,user,()=>db.$transaction((tx:any)=>assertClientKizUse(tx,i,user)));
}
// Old WB review logic must not auto-approve manual-writeoff histories under the new rule.
export async function strictLegacyQueueDecision(db:any,clientId:string,kiz:string,taskId:string,evidence:any){
 if(!clientKizGuardEnabled())return null;
 const task=await db.fbsTsdAssembly.findUnique({where:{id:taskId}});if(!task||task.clientId!==clientId)return null;
 const request=await db.clientRequest.findUnique({where:{id:task.requestId}});
 const i:ClientKizUse={scope:'FBS',clientId,warehouseId:request?.warehouseId,requestId:task.requestId,taskId,kiz,skuId:task.skuId,boxId:task.boxId,externalEvidence:evidence,allowRelabel:true};
 if((await history(db,i)).decision==='ALLOW')return null;
 const user={id:task.workerUserId,name:task.workerName};
 try{return await db.$transaction((tx:any)=>assertClientKizUse(tx,i,user));}
 catch(e){if(e instanceof ClientKizReviewRequired){await queueClientKizReview(db,i,user);return 'REVIEW';}throw e;}
}
