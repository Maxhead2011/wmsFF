import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { assertWarehouseAccess } from '../client-requests/client-request-warehouse-scope';
import { buildActualLamodaShipment,buildActualLamodaTemplate } from './lamoda-actual-shipment';
import { LamodaClient, LamodaApiError, type LamodaCredentials } from './lamoda-client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export type SubmissionForm={externalShipmentId:string;warehouseCode:string;plannedDate:string;prices:{skuId:string;priceMinor:number}[]};
type Payload=ReturnType<typeof buildActualLamodaShipment>;
type Receipt={state:string;payload:Payload;remoteId?:string;remoteStatus?:string;error?:string;updatedAt:string};
// FIX: persisted sending state is never retried automatically, including after process failure.
export class LamodaSubmission {
 constructor(private db:PrismaService,private remote:LamodaClient){}
 private async context(tx:Prisma.TransactionClient,accountId:string,requestId:string,user:AuthUser) {
  const b=await tx.lamodaFboAssembly.findFirst({where:{requestId,plan:{accountId}},include:{plan:true,request:{include:{items:{include:{sku:true}}}}}});
  if(!b)throw new NotFoundException('Сборка Lamoda не найдена.');
  assertWarehouseAccess(user,b.plan,'read');
  const rows=await tx.$queryRaw<{submission:Receipt|null}[]>`SELECT "submission" FROM "LamodaFboAssembly" WHERE "requestId"=${requestId}`;
  return {b,receipt:rows[0]?.submission??null};
 }
 private async save(tx:Prisma.TransactionClient,id:string,r:Receipt){await tx.$executeRaw`UPDATE "LamodaFboAssembly" SET "submission"=${JSON.stringify(r)}::jsonb WHERE "requestId"=${id}`;}
 private async composition(tx:Prisma.TransactionClient,accountId:string,id:string,user:AuthUser,form?:SubmissionForm){
  const {b,receipt}=await this.context(tx,accountId,id,user);assertWarehouseAccess(user,b.plan,'write');
  if(b.plan.remoteShipmentId)throw new ConflictException('Сборка уже связана с поставкой Lamoda. Новая поставка не создаётся.');
  if(['CANCELLED','REJECTED'].includes(b.request.status))throw new ConflictException('Заявка отменена.');
  const assembly=await tx.fboAssembly.findUnique({where:{requestId:id},include:{units:true,boxes:true}});
  if(assembly?.phase!=='COMPLETED')throw new ConflictException('Завершите сборку и контроль коробов на ТСД.');
  const cards=await tx.lamodaProduct.findMany({where:{accountId,isPresent:true,linkState:'CONFIRMED'}});
  const lines=b.plan.items as unknown as Array<{barcode:string;article?:string;remoteSku?:string}>;
  const identities=b.request.items.map(item=>{
   const matches=cards.filter(c=>c.skuId===item.skuId&&lines.some(l=>l.barcode===c.barcode&&(!l.remoteSku||l.remoteSku===c.remoteSku)&&(!l.article||l.article===c.externalSku)));
   const prices=form?.prices.filter(p=>p.skuId===item.skuId);
   if(matches.length!==1||(form&&prices?.length!==1)||!matches[0].externalSku)throw new BadRequestException('Подтвердите однозначное соответствие каждому товару; для отправки API укажите цены.');
   if(Array.isArray(b.relabelLabels)){
    const labels=b.relabelLabels as unknown as {skuId:string;barcode:string;article:string}[];
    const frozen=labels.filter(l=>l.skuId===item.skuId);
    if(frozen.length!==1||frozen[0].barcode!==matches[0].barcode||frozen[0].article!==matches[0].remoteSku)throw new ConflictException('Соответствие Lamoda изменилось после переклейки. Проверьте этикетки.');
   }
   if(assembly.units.filter(u=>u.skuId===item.skuId&&u.state==='PACKED').length!==item.quantity)throw new ConflictException('Факт упаковки отличается от состава заявки.');
   return {skuId:item.skuId!,externalSku:matches[0].externalSku,ean:matches[0].barcode??'',priceMinor:prices?.[0]?.priceMinor};
  });
  return {receipt,identities,boxes:assembly.boxes,units:assembly.units.map(u=>({...u,requiresKiz:!!u.markId||b.request.items.some(i=>i.skuId===u.skuId&&i.sku?.needsChestnyZnak&&!i.sku.isUnmarked)}))};
 }
 private async build(tx:Prisma.TransactionClient,accountId:string,id:string,user:AuthUser,form:SubmissionForm){
  const {receipt,...composition}=await this.composition(tx,accountId,id,user,form);
  const payload=buildActualLamodaShipment({...form,...composition,identities:composition.identities.map(i=>({...i,priceMinor:i.priceMinor!}))});
  if(receipt&&!isDeepStrictEqual(receipt.payload,payload))throw new ConflictException('Состав уже зафиксирован для отправки. Сначала сверка с Lamoda.');
  return {payload,receipt};
 }
 async template(accountId:string,id:string,user:AuthUser){return this.db.$transaction(async tx=>{
  const {receipt,...composition}=await this.composition(tx,accountId,id,user);
  if(receipt)throw new ConflictException('Отправка уже выполнялась. Сверьте её статус, прежде чем оформлять поставку вручную.');
  return buildActualLamodaTemplate(composition);
 },{isolationLevel:'RepeatableRead',timeout:30000});}
 async view(accountId:string,id:string,user:AuthUser){return this.db.$transaction(async tx=>{
  const {b,receipt}=await this.context(tx,accountId,id,user);
  const assembly=await tx.fboAssembly.findUnique({where:{requestId:id},select:{phase:true}});
  return {receipt,readyForTemplate:assembly?.phase==='COMPLETED'&&!receipt&&!b.plan.remoteShipmentId,remoteShipmentId:b.plan.remoteShipmentId,items:b.request.items.map(i=>({skuId:i.skuId,name:i.name||i.sku?.name,size:i.sku?.size,quantity:i.quantity}))};
 });}
 async preview(accountId:string,id:string,user:AuthUser,form:SubmissionForm){return this.db.$transaction(tx=>this.build(tx,accountId,id,user,form),{isolationLevel:'RepeatableRead',timeout:30000});}
 async send(accountId:string,id:string,user:AuthUser,form:SubmissionForm,c:LamodaCredentials){
  if(process.env.WMS_LAMODA_FBO_SUBMISSION_ENABLED!=='true')throw new ConflictException('Отправка поставок Lamoda выключена.');
  const prepared=await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "ClientRequest" WHERE "id"=${id} FOR UPDATE`;
   const {payload,receipt}=await this.build(tx,accountId,id,user,form);
   if(receipt)return {payload,receipt,send:false};
   const r:Receipt={state:'SENDING',payload,updatedAt:new Date().toISOString()};
   // Unique operation key protects a reused UPD number across WMS assemblies in one account.
   try {await tx.lamodaOperation.create({data:{id:createHash('sha256').update(JSON.stringify([accountId,payload.externalShipmentId])).digest('hex'),accountId,operationKey:`FBO:${payload.externalShipmentId}`,payloadHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),status:'SENDING'}});}
   catch(e){if((e as {code?:string})?.code==='P2002')throw new ConflictException('Этот номер поставки уже использован. Проверьте другую сборку и кабинет Lamoda.');throw e;}
   await this.save(tx,id,r);
   await tx.auditLog.create({data:{userId:user.id,action:'LAMODA_FBO_SUBMISSION_STARTED',entity:'ClientRequest',entityId:id,payload:{accountId,externalShipmentId:payload.externalShipmentId}}});
   return {payload,receipt:r,send:true};
  },{timeout:30000});
  if(!prepared.send){if(prepared.receipt.state==='SUCCEEDED')return prepared.receipt;throw new ConflictException('Отправка уже выполнялась. Обновите статус; повтор заблокирован до сверки.');}
  let result:Receipt;
  try{
   const response=await this.remote.execute(c,{kind:'FBO_CREATE',body:prepared.payload}) as Record<string,unknown>;
   if(!response||typeof response.id!=='string'||response.externalShipmentId!==prepared.payload.externalShipmentId||response.plannedDate!==prepared.payload.plannedDate)throw new LamodaApiError('INVALID_WRITE_RESPONSE',undefined,'UNKNOWN');
   result={...prepared.receipt,state:'SUCCEEDED',remoteId:response.id,updatedAt:new Date().toISOString()};
  }catch(e){result={...prepared.receipt,state:e instanceof LamodaApiError&&e.outcome==='REJECTED'?'REJECTED':'UNKNOWN',error:e instanceof LamodaApiError?`${e.code}${e.status?` (${e.status})`:''}`:'UNKNOWN_RESULT',updatedAt:new Date().toISOString()};}
  await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "ClientRequest" WHERE "id"=${id} FOR UPDATE`;
   const current=await this.context(tx,accountId,id,user);
   if(current.receipt?.state==='SUCCEEDED'){result=current.receipt;return;}
   await this.save(tx,id,result);
   await tx.lamodaOperation.updateMany({where:{accountId,operationKey:`FBO:${result.payload.externalShipmentId}`,status:'SENDING'},data:{status:result.state,errorCode:result.error??null}});
  });return result;
 }
 async resetRejected(accountId:string,id:string,user:AuthUser){
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "ClientRequest" WHERE "id"=${id} FOR UPDATE`;
   const {b,receipt}=await this.context(tx,accountId,id,user);assertWarehouseAccess(user,b.plan,'write');
   if(receipt?.state!=='REJECTED')throw new ConflictException('Сброс разрешён только после явного отказа API. Неопределённый ответ требует сверки.');
   await tx.auditLog.create({data:{userId:user.id,action:'LAMODA_FBO_REJECTION_RESET',entity:'ClientRequest',entityId:id,payload:{externalShipmentId:receipt.payload.externalShipmentId,error:receipt.error}}});
   await tx.lamodaOperation.deleteMany({where:{accountId,operationKey:`FBO:${receipt.payload.externalShipmentId}`,status:'REJECTED'}});
   await tx.$executeRaw`UPDATE "LamodaFboAssembly" SET "submission"=NULL WHERE "requestId"=${id}`;
   return {reset:true};
  });
 }
 async refresh(accountId:string,id:string,user:AuthUser,c:LamodaCredentials){
  const {receipt}=await this.view(accountId,id,user);
  if(!receipt)throw new ConflictException('Поставка ещё не отправлялась.');
  let remoteId=receipt.remoteId;
  if(!remoteId){
   const matches=(await this.remote.collection(c,'FBO_SHIPMENTS',{from:receipt.payload.plannedDate,to:receipt.payload.plannedDate})).filter(s=>s.externalShipmentId===receipt.payload.externalShipmentId);
   if(matches.length!==1||typeof matches[0].id!=='string')throw new ConflictException('Не удалось однозначно найти поставку. Повторная отправка заблокирована; проверьте кабинет Lamoda.');
   remoteId=matches[0].id;
  }
  const data=await this.remote.fboShipment(c,remoteId);
  if(data.shipment.externalShipmentId!==receipt.payload.externalShipmentId)throw new ConflictException('Идентификатор поставки не совпадает.');
  if(!receipt.remoteId){
   if(data.shipment.plannedDate!==receipt.payload.plannedDate||data.shipment.warehouseCode!==receipt.payload.warehouseCode)throw new ConflictException('Дата или склад найденной поставки отличаются.');
   const counts=(items:{ean?:unknown;quantity?:unknown;quantityPlanned?:unknown}[])=>{
    const m=new Map<string,number>();for(const i of items){const q=i.quantity??i.quantityPlanned;if(typeof i.ean!=='string'||!Number.isSafeInteger(q)||Number(q)<0)throw new ConflictException('Не удалось сверить состав Lamoda.');m.set(i.ean,(m.get(i.ean)??0)+Number(q));}return JSON.stringify([...m].sort());
   };
   if(counts(data.items)!==counts(receipt.payload.items))throw new ConflictException('Состав найденной поставки отличается. Нужна ручная сверка.');
  }
  const next={...receipt,state:'SUCCEEDED',remoteId,remoteStatus:String(data.shipment.status),updatedAt:new Date().toISOString()};
  await this.db.$transaction(async tx=>{
   // FIX: an old read cannot overwrite a reset or a newer submission attempt.
   await tx.$queryRaw`SELECT "id" FROM "ClientRequest" WHERE "id"=${id} FOR UPDATE`;
   const current=await this.context(tx,accountId,id,user);
   if(!isDeepStrictEqual(current.receipt,receipt))throw new ConflictException('Состояние отправки изменилось. Обновите статус ещё раз.');
   await this.save(tx,id,next);
   await tx.lamodaOperation.updateMany({where:{accountId,operationKey:`FBO:${receipt.payload.externalShipmentId}`},data:{status:'SUCCEEDED',errorCode:null}});
  });return next;
 }
}
