import {ConflictException,Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {PrismaService} from '../../common/prisma/prisma.service';
import {StockOperationsService} from '../stock/stock-operations.service';
import type {AuthUser} from '../auth/auth.types';
import {OzonAssemblySupplyService} from './ozon-assembly-supply.service';
import {WbFboSupplyService} from './wb-fbo-supply.service';
import {assertNoOzonAdjustment,supplyOrders} from './ozon-supply-policy';
import {deliveryKey,deliveryVersion,deliveryRetryMs,fboDeliveryEnabled,ozonDeliveryProof,wbDeliveryAccepted} from './fbo-delivery-policy';

// FIX: durable per-request cooldown/lease; no transaction remains open during marketplace HTTP calls.
export async function claimDelivery(db:any,id:string,now=Date.now()){
 return db.$transaction(async(tx:any)=>{
  const key=deliveryKey(id);await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`);
  const old=(await tx.systemSetting.findUnique({where:{key}}))?.value??{};
  if(Number(old.leaseUntil)>now||Number(old.nextAt)>now)return null;
  const state={...old,token:randomUUID(),leaseUntil:now+10*60_000,attempts:(Number(old.attempts)||0)+1,lastAttemptAt:new Date(now).toISOString()};
  await tx.systemSetting.upsert({where:{key},create:{key,value:state},update:{value:state}});return state;
 });
}
export async function finishDelivery(db:any,id:string,claim:any,outcome:string,now=Date.now()){
 return db.$transaction(async(tx:any)=>{
  const key=deliveryKey(id);await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`);
  const old=(await tx.systemSetting.findUnique({where:{key}}))?.value;
  if(old?.token!==claim.token)return;
  const failed=outcome==='RETRY';
  await tx.systemSetting.update({where:{key},data:{value:{...old,token:null,leaseUntil:0,outcome,
   attempts:failed?old.attempts:0,nextAt:now+(failed?deliveryRetryMs(old.attempts):5*60_000),finishedAt:new Date(now).toISOString()}}});
 });
}
@Injectable()
export class FboDeliverySyncService implements OnModuleInit,OnModuleDestroy{
 private timer?:NodeJS.Timeout;private running=false;private stopped=false;private cursor='';
 private readonly log=new Logger(FboDeliverySyncService.name);
 constructor(private readonly db:PrismaService,private readonly ozon:OzonAssemblySupplyService,private readonly wb:WbFboSupplyService,private readonly stock:StockOperationsService){}
 onModuleInit(){if(fboDeliveryEnabled())this.schedule(30_000);}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(ms:number){if(this.stopped)return;this.timer=setTimeout(()=>void this.tick(),ms);this.timer.unref?.();}
 async tick(){
  if(this.running||this.stopped||!fboDeliveryEnabled())return;this.running=true;
  try{
   const rows=await this.db.clientRequest.findMany({where:{type:'OUTBOUND',status:'PACKED',warehouseId:{not:null},client:{isDemo:false},fboAssembly:{phase:'COMPLETED'},fbsOrderLinks:{none:{}},...(this.cursor?{id:{gt:this.cursor}}:{})},orderBy:{id:'asc'},take:100,select:{id:true}});
   if(!rows.length)this.cursor='';
   let count=0;
   for(const row of rows){
    if(this.stopped||!fboDeliveryEnabled())break;
    this.cursor=row.id;
    let context:any;
    try{context=await this.context(row.id);}catch{this.log.warn(JSON.stringify({event:'fbo_delivery_sync',requestId:row.id,outcome:'INVALID_CONTEXT'}));continue;}
    if(!context)continue;
    const claim=await claimDelivery(this.db,row.id);if(!claim)continue;
    let outcome='RETRY';
    try{outcome=await this.reconcile(row.id,context);}
    catch(error){this.log.warn(JSON.stringify({event:'fbo_delivery_sync',requestId:row.id,outcome:'RETRY',code:(error as any)?.getStatus?.()??'INTERNAL'}));}
    await finishDelivery(this.db,row.id,claim,outcome);
    if(++count>=10)break;
   }
  }catch{this.log.warn('FBO delivery cycle failed; persisted leases and cooldowns retained.');}
  finally{this.running=false;if(fboDeliveryEnabled())this.schedule(60_000);}
 }
 private async context(id:string,db:any=this.db){
  const r=await db.clientRequest.findUnique({where:{id},include:{client:{select:{isDemo:true}},fboAssembly:{select:{phase:true}},ozonShipment:{select:{integration:true}},lamodaAssembly:{select:{requestId:true}},yandexFbyShipment:{select:{id:true}},items:{select:{id:true,skuId:true,quantity:true}},_count:{select:{fbsOrderLinks:true}}}});
  if(!r||r.client.isDemo||r.type!=='OUTBOUND'||!['PACKED','DONE'].includes(r.status)||r.fboAssembly?.phase!=='COMPLETED'||!r.warehouseId||r._count.fbsOrderLinks||r.lamodaAssembly||r.yandexFbyShipment)return null;
  const link=r.ozonShipment?.integration??(await db.systemSetting.findUnique({where:{key:'wb-fbo-tracking:v1:'+id}}))?.value;
  if(!link?.connectionId)return null;
  const market=r.ozonShipment?'OZON':'WILDBERRIES';
  if(market==='OZON')assertNoOzonAdjustment(link);
  const connection=await db.clientMarketplaceConnection.findFirst({where:{id:link.connectionId,clientId:r.clientId,marketplace:market,isActive:true}});
  if(!connection)return null;
  const dispatch=(await db.systemSetting.findUnique({where:{key:'wb-fbo-dispatch:v1:'+id}}))?.value;
  if(market==='WILDBERRIES'&&!dispatch?.at)return null;
  const version=deliveryVersion([r.clientId,r.warehouseId,r.items.sort((a:any,b:any)=>a.id.localeCompare(b.id)),market,
   market==='OZON'?link:[link.connectionId,link.supplyId],dispatch]);
  return {r,link,market,connection,dispatch,version};
 }
 async reconcile(id:string,initial?:any){
  if(!fboDeliveryEnabled())return 'DISABLED';
  const c=initial??await this.context(id);if(!c||c.r.status==='DONE')return 'SKIPPED';
  let evidence:any,accepted=false;
  if(c.market==='OZON'){
   const ids=supplyOrders(c.link).map(o=>Number(o.orderId));
   if(!ids.length||ids.length>100||ids.some(n=>!Number.isSafeInteger(n)||n<=0))throw new ConflictException('Некорректная привязка Ozon.');
   const response=await this.ozon.call(c.connection,'/v3/supply-order/get',{order_ids:ids});
   evidence=ozonDeliveryProof(c.link,response);accepted=Boolean(evidence);
  }else{
   evidence=await this.wb.remote(c.connection,c.link.supplyId);
   accepted=wbDeliveryAccepted(evidence,c.r.items.reduce((n:number,i:any)=>n+i.quantity,0),c.dispatch);
  }
  if(!accepted)return 'WAITING_MARKETPLACE';
  const checkedAt=Date.now();
  // System operation has no human actor; undefined leaves the assignee unchanged and writes nullable audit actors.
  const user:AuthUser={id:undefined as unknown as string,email:'',name:'Автоматическая сверка сдачи ФБО',roleCodes:[],permissionCodes:['client-requests:write'],clientScopeMode:'LIMITED',clientIds:[c.r.clientId],writableClientIds:[c.r.clientId],activeWarehouseId:c.r.warehouseId,warehouseIds:[c.r.warehouseId],writableWarehouseIds:[c.r.warehouseId]};
  await this.stock.shipClientRequest({requestId:id,idempotencyKey:`ship-request:${id}`,comment:`Автоматически подтверждена сдача ФБО ${c.market==='OZON'?'Ozon':'WB'}.`},user,async(tx)=>{
   if(!fboDeliveryEnabled()||Date.now()-checkedAt>4*60_000)throw new ConflictException('Проверка сдачи устарела.');
   const fresh=await this.context(id,tx);
   if(!fresh||fresh.version!==c.version)throw new ConflictException('Привязка или состав поставки изменились.');
   if(fresh.r.status==='DONE')return;
   // Evidence and status/stock changes commit or roll back together.
   await tx.auditLog.create({data:{entity:'ClientRequest',entityId:id,action:'FBO_DELIVERY_CONFIRMED',payload:{marketplace:c.market,connectionId:c.connection.id,checkedAt:new Date(checkedAt).toISOString(),evidence}}});
  });
  this.log.log(JSON.stringify({event:'fbo_delivery_sync',requestId:id,outcome:'DONE',marketplace:c.market}));return 'DONE';
 }
}
