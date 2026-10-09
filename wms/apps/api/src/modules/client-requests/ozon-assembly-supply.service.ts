import {BadGatewayException,BadRequestException,ConflictException,Injectable,NotFoundException} from '@nestjs/common';
import {PrismaService} from '../../common/prisma/prisma.service';
import {ClientScopeService} from '../auth/client-scope.service';
import type {AuthUser} from '../auth/auth.types';
import {assertWarehouseAccess} from './client-request-warehouse-scope';
import {cargoHash,packedCargoes,supplyDifferences,type SupplyIntegration} from './ozon-supply-policy';
import type {OzonDirection} from '../tsd/ozon-fbo-directions';

@Injectable()
export class OzonAssemblySupplyService {
 constructor(private readonly db:PrismaService,private readonly scopes:ClientScopeService){}
 private async load(id:string,user:AuthUser,mode:'read'|'write'='read',db:any=this.db){
  if(process.env.WMS_OZON_FBO_IMPORT_ENABLED!=='true')throw new NotFoundException('Связь Ozon выключена.');
  const s=await db.ozonFboShipment.findUnique({where:{requestId:id},include:{request:{include:{fboAssembly:{include:{boxes:true,units:true}}}}}});
  if(!s)throw new NotFoundException('Сборка Ozon не найдена.');
  this.scopes.requireClientAccess(user,s.request.clientId,mode);assertWarehouseAccess(user,s.request,mode);
  if(!user.activeWarehouseId||s.request.warehouseId!==user.activeWarehouseId)throw new NotFoundException('Выберите филиал сборки.');
  return s;
 }
 private async connection(id:string,clientId:string){
  const c=await this.db.clientMarketplaceConnection.findFirst({where:{id,clientId,marketplace:'OZON',isActive:true}});
  if(!c?.sellerId||!c.apiKey)throw new BadRequestException('Кабинет Ozon не настроен для этого клиента.');return c;
 }
 // FIX: only read operations retry throttling; a write with an unknown result is never repeated.
 async call(c:any,path:string,body:any,read=true):Promise<any>{
  for(let attempt=0;attempt<3;attempt++){
   let r:Response;try{r=await fetch('https://api-seller.ozon.ru'+path,{method:'POST',headers:{'Content-Type':'application/json','Client-Id':c.sellerId,'Api-Key':c.apiKey},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});}catch{throw new BadGatewayException('Нет подтверждённого ответа Ozon. Проверьте статус; не отправляйте повторно.');}
   if(read&&r.status===429&&attempt<2){await new Promise(r=>setTimeout(r,1500*(attempt+1)));continue;}
   const p=await r.json().catch(()=>({}));if(!r.ok)throw new BadGatewayException(`Ozon: HTTP ${r.status}. ${String(p.message??'Ошибка запроса').slice(0,300)}`);return p;
  }
 }
 private async snapshot(c:any,orderId:string):Promise<SupplyIntegration>{
  if(!/^\d+$/.test(orderId)||!Number.isSafeInteger(Number(orderId)))throw new BadRequestException('Укажите числовой ID заявки Ozon из адреса кабинета.');
  const data=await this.call(c,'/v3/supply-order/get',{order_ids:[Number(orderId)]});
  const o=data.orders?.find((o:any)=>String(o.order_id)===orderId);if(!o?.supplies?.length)throw new NotFoundException('Поставка не найдена в выбранном кабинете Ozon.');
  const clusters=await this.call(c,'/v1/cluster/list',{cluster_type:'CLUSTER_TYPE_OZON',cluster_ids:[]});
  const supplies:SupplyIntegration['supplies']=[];
  for(const s of o.supplies){
   const items:any[]=[];let last='';const seen=new Set<string>();
   for(let page=0;;page++){
    if(page>=100)throw new BadGatewayException('Состав Ozon превышает лимит страниц.');
    await new Promise(r=>setTimeout(r,400));
    const b=await this.call(c,'/v1/supply-order/bundle',{bundle_ids:[s.bundle_id],limit:100,last_id:last});
    if(!Array.isArray(b.items))throw new BadGatewayException('Ozon не вернул состав поставки.');items.push(...b.items);
    if(!b.has_next)break;if(!b.last_id||seen.has(b.last_id))throw new BadGatewayException('Ошибка пагинации состава Ozon.');last=b.last_id;seen.add(last);
   }
   const cluster=clusters.clusters?.find((v:any)=>String(v.macrolocal_cluster_id??v.id)===String(s.macrolocal_cluster_id));
   supplies.push({id:String(s.supply_id),name:cluster?.name??s.storage_warehouse?.name??String(s.macrolocal_cluster_id),items:items.map(i=>({barcode:String(i.barcode??''),offerId:String(i.offer_id??''),quantity:Number(i.quantity),quant:Number(i.quant)||1}))});
  }
  return {connectionId:c.id,orderId,orderNumber:String(o.order_number??orderId),place:o.drop_off_warehouse?.name??'',date:o.timeslot?.timeslot?.from??'',state:o.state,supplies,mapping:{},operations:{},checkedAt:new Date().toISOString()};
 }
 private async locked(id:string,user:AuthUser,fn:(s:any,tx:any)=>Promise<any>){
  return this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "ClientRequest" WHERE "id"=${id} FOR UPDATE`;const s=await this.load(id,user,'write',tx);return fn(s,tx);});
 }
 private async save(tx:any,id:string,link:SupplyIntegration,user:AuthUser,action:string){
  await tx.ozonFboShipment.update({where:{requestId:id},data:{integration:link}});
  await tx.auditLog.create({data:{userId:user.id,action,entity:'ClientRequest',entityId:id,payload:{orderId:link.orderId,operations:link.operations}}});
 }
 async view(id:string,user:AuthUser){
  const s=await this.load(id,user),link=s.integration as SupplyIntegration|null;
  const connections=await this.db.clientMarketplaceConnection.findMany({where:{clientId:s.request.clientId,marketplace:'OZON',isActive:true},select:{id:true,accountName:true,sellerId:true}});
  let packingError='';if(link)try{packedCargoes(s.directions,link,s.request.fboAssembly);}catch(e){packingError=e instanceof Error?e.message:String(e);}
  return {requestId:id,directions:s.directions,connections,link,differences:link?supplyDifferences(s.directions,link):[],packingError};
 }
 async bind(id:string,body:{connectionId:string;orderId:string},user:AuthUser){
  const s=await this.load(id,user,'write');if(s.integration?.frozenHash)throw new ConflictException('Состав уже отправляется. Привязка заблокирована.');
  const c=await this.connection(body.connectionId,s.request.clientId),link=await this.snapshot(c,String(body.orderId).trim());
  if(await this.db.ozonFboPlan.findFirst({where:{connectionId:c.id,ozonOrderId:link.orderId}}))throw new ConflictException('Эта поставка уже используется в прежнем плане Ozon. Нужен перенос плана, а не вторая сборка.');
  // Exact names may be suggested; the user sees and explicitly saves all mappings.
  for(const d of s.directions as OzonDirection[]){const matches=link.supplies.filter(v=>v.name.trim().toLocaleLowerCase()===d.name.trim().toLocaleLowerCase());if(matches.length===1)link.mapping[d.name]=matches[0].id;}
  await this.locked(id,user,async(current,tx)=>{
   if(current.integration?.frozenHash)throw new ConflictException('Отправка уже началась.');
   const key=`${c.sellerId}:${link.orderId}`;const other=await tx.ozonFboShipment.findUnique({where:{externalOrderKey:key}});if(other&&other.requestId!==id)throw new ConflictException('Поставка Ozon уже привязана к другой сборке.');
   await tx.ozonFboShipment.update({where:{requestId:id},data:{externalOrderKey:key}});await this.save(tx,id,link,user,'OZON_SUPPLY_BOUND');
  });return this.view(id,user);
 }
 async map(id:string,mapping:Record<string,string>,user:AuthUser){
  await this.locked(id,user,async(s,tx)=>{const l=s.integration as SupplyIntegration;if(!l)throw new ConflictException('Сначала привяжите поставку.');if(l.frozenHash)throw new ConflictException('Отправка уже началась.');
   if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))throw new BadRequestException('Неверное сопоставление.');
   const clean:Record<string,string>={};for(const d of s.directions as OzonDirection[]){const v=mapping[d.name];if(v){if(!l.supplies.some(s=>s.id===v))throw new BadRequestException('Неизвестное направление Ozon.');clean[d.name]=v;}}
   l.mapping=clean;await this.save(tx,id,l,user,'OZON_SUPPLY_MAPPING');});return this.view(id,user);
 }
 async refresh(id:string,user:AuthUser){
  const s=await this.load(id,user,'write'),old=s.integration as SupplyIntegration;if(!old)throw new ConflictException('Сначала привяжите поставку.');
  const c=await this.connection(old.connectionId,s.request.clientId),fresh=await this.snapshot(c,old.orderId);
  await this.locked(id,user,async(cur,tx)=>{const l=cur.integration as SupplyIntegration;if(l?.orderId!==old.orderId||l.connectionId!==old.connectionId)throw new ConflictException('Привязка изменилась. Обновите экран.');await this.save(tx,id,{...fresh,mapping:l.mapping,operations:l.operations,frozenHash:l.frozenHash},user,'OZON_SUPPLY_REFRESH');});
  return this.view(id,user);
 }
 async upload(id:string,confirm:boolean,user:AuthUser){
  if(confirm!==true)throw new BadRequestException('Подтвердите передачу проверенных коробов.');
  await this.refresh(id,user);
  const s=await this.load(id,user,'write'),l=s.integration as SupplyIntegration,c=await this.connection(l.connectionId,s.request.clientId);
  if(l.state!=='DATA_FILLING')throw new ConflictException('Поставка Ozon не в статусе заполнения данных.');
  const cargoes=packedCargoes(s.directions,l,s.request.fboAssembly);
  for(const supplyId of Object.keys(cargoes)){
   if(l.operations[supplyId])continue;
   const existing=await this.call(c,'/v1/cargoes/supplies/get',{supply_ids:[Number(supplyId)]});
   const remote=existing.supplies_cargoes?.find((v:any)=>String(v.supply_id)===supplyId);
   if(!remote||remote.transport_cargoes?.length||remote.cargoes_without_transport_cargoes?.length)throw new ConflictException('В Ozon уже есть грузоместа или их состав не подтверждён. Автоматическая замена запрещена.');
   const claimed=await this.locked(id,user,async(cur,tx)=>{
    const link=cur.integration as SupplyIntegration;if(link.operations[supplyId])return false;
    if(link.orderId!==l.orderId||link.connectionId!==l.connectionId)throw new ConflictException('Привязка изменилась.');
    const now=packedCargoes(cur.directions,link,cur.request.fboAssembly),hash=cargoHash(now);
    if(hash!==cargoHash(cargoes)||(link.frozenHash&&link.frozenHash!==hash))throw new ConflictException('Состав изменился. Повторите сверку.');
    link.frozenHash=hash;link.operations[supplyId]={state:'SENDING'};await this.save(tx,id,link,user,'OZON_CARGO_SENDING');return true;
   });if(!claimed)continue;
   try{
    const result=await this.call(c,'/v1/cargoes/create',{supply_id:Number(supplyId),delete_current_version:false,cargoes:cargoes[supplyId]},false);
    if(!result.operation_id)throw new Error('Ozon не вернул номер операции.');
    await this.locked(id,user,async(cur,tx)=>{const link=cur.integration as SupplyIntegration;link.operations[supplyId]={state:'ACCEPTED',operationId:String(result.operation_id)};await this.save(tx,id,link,user,'OZON_CARGO_ACCEPTED');});
   }catch(e){await this.locked(id,user,async(cur,tx)=>{const link=cur.integration as SupplyIntegration;if(!link.operations[supplyId]?.operationId){link.operations[supplyId]={state:'UNKNOWN',error:e instanceof Error?e.message:String(e)};await this.save(tx,id,link,user,'OZON_CARGO_UNKNOWN');}});throw new ConflictException('Ответ Ozon не подтверждён. Повторная отправка заблокирована; нужна сверка грузомест.');}
  }
  return this.status(id,user);
 }
 async status(id:string,user:AuthUser){
  const s=await this.load(id,user,'write'),l=s.integration as SupplyIntegration;if(!l)throw new ConflictException('Нет привязки.');const c=await this.connection(l.connectionId,s.request.clientId);
  for(const [supplyId,op] of Object.entries(l.operations)){
   if(!op.operationId)continue;
   const r=await this.call(c,'/v2/cargoes/create/info',{operation_id:op.operationId});
   const state=r.status==='SUCCESS'?'SUCCESS':r.status==='FAILED'?'FAILED':'ACCEPTED';
   await this.locked(id,user,async(cur,tx)=>{const link=cur.integration as SupplyIntegration;const current=link.operations[supplyId];if(current.operationId!==op.operationId)return;
    current.state=state;current.error=r.errors?.length?JSON.stringify(r.errors):undefined;
    if(state==='SUCCESS')current.cargoes=(r.result?.cargoes??[]).map((v:any)=>({key:String(v.key),cargoId:String(v.value?.cargo_id??'')}));
    await this.save(tx,id,link,user,'OZON_CARGO_STATUS');});
  }return this.view(id,user);
 }
 async labels(id:string,supplyId:string,user:AuthUser){
  const s=await this.load(id,user,'write'),l=s.integration as SupplyIntegration,op=l?.operations[supplyId];
  if(!op||op.state!=='SUCCESS'||!op.cargoes?.length||op.cargoes.some(v=>!/^\d+$/.test(v.cargoId)))throw new ConflictException('Сначала дождитесь подтверждения грузомест Ozon.');
  const c=await this.connection(l.connectionId,s.request.clientId);
  let operationId=op.labelOperationId;
  if(!operationId){
   const created=await this.call(c,'/v1/cargoes-label/create',{supply_id:Number(supplyId),cargoes:op.cargoes.map(v=>({cargo_id:Number(v.cargoId)}))},false);
   operationId=String(created.operation_id??'');if(!operationId)throw new BadGatewayException('Ozon не вернул операцию подготовки этикеток.');
   await this.locked(id,user,async(cur,tx)=>{const link=cur.integration as SupplyIntegration;link.operations[supplyId].labelOperationId=operationId;await this.save(tx,id,link,user,'OZON_LABEL_REQUEST');});
  }
  const result=await this.call(c,'/v1/cargoes-label/get',{operation_id:operationId});
  const url=result.result?.file_url??result.file_url;
  if(url){if(typeof url!=='string'||!url.startsWith('https://'))throw new BadGatewayException('Ozon вернул некорректную ссылку этикеток.');
   await this.locked(id,user,async(cur,tx)=>{const link=cur.integration as SupplyIntegration;link.operations[supplyId].labelUrl=url;await this.save(tx,id,link,user,'OZON_LABEL_READY');});}
  return this.view(id,user);
 }
}
