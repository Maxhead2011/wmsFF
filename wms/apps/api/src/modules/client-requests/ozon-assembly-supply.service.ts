import {plannedPackingEnabled,validatePackingPlan} from './ozon-packing-plan';
import {BadGatewayException,BadRequestException,ConflictException,Injectable,NotFoundException} from '@nestjs/common';
import {PrismaService} from '../../common/prisma/prisma.service';
import {ClientScopeService} from '../auth/client-scope.service';
import type {AuthUser} from '../auth/auth.types';
import {assertWarehouseAccess} from './client-request-warehouse-scope';
import {ozonEditDeadline,assertNoOzonAdjustment,bindingIdentity,mergeSupplyOrders,supplyOrders,cargoHash,packedCargoes,supplyDifferences,type SupplyIntegration,type SupplyOrderSnapshot} from './ozon-supply-policy';
import type {OzonDirection} from '../tsd/ozon-fbo-directions';
import {cargoMappingWorkbook} from './ozon-cargo-export';
import {ozonPrintManifest,renderOzonPrintPages,annotateOzonLabels} from './ozon-print-labels';

@Injectable()
export class OzonAssemblySupplyService {
 constructor(private readonly db:PrismaService,private readonly scopes:ClientScopeService){}
 // FIX: prepare one direction at a time; the browser queues only the complete verified set.
 async printLabels(id:string,supplyId:string|undefined,user:AuthUser){
  if(process.env.WMS_PRINT_SERIES_ENABLED!=='true')throw new NotFoundException('Печать через агент выключена.');
  if(!user.permissionCodes.some(p=>['system:admin','print:write'].includes(p)))throw new BadRequestException('Нет права печати.');
  const s=await this.load(id,user),link=s.integration as SupplyIntegration|null;
  const manifest=ozonPrintManifest(s.directions as unknown as Array<{name:string}>,link);
  if(!supplyId)return {...manifest,clientId:s.request.clientId};
  const direction=manifest.supplies.find(v=>v.id===supplyId);
  if(!direction)throw new BadRequestException('Направление не принадлежит этой заявке.');
  const op=link!.operations[supplyId],c=await this.connection(link!.connectionId,s.request.clientId);
  const download=async(url:string)=>{
   const u=new URL(url);
   if(u.protocol!=='https:'||u.username||u.password||!(u.hostname==='ozone.ru'||u.hostname.endsWith('.ozone.ru')))throw new BadRequestException('Некорректный адрес этикеток Ozon.');
   return fetch(u,{signal:AbortSignal.timeout(20000),redirect:'error'});
  };
  let response=op.labelUrl?await download(op.labelUrl):null;
  if(!response||response.status===403||response.status===404){
   await response?.body?.cancel();
   let operationId=op.labelUrl?null:op.labelOperationId;
   if(!operationId){
    const created=await this.call(c,'/v1/cargoes-label/create',{supply_id:Number(supplyId),cargoes:direction.cargoIds.map(cargo_id=>({cargo_id}))},false);
    operationId=String(created.operation_id??'');
    if(!operationId)throw new BadGatewayException('Ozon не вернул операцию подготовки этикеток.');
    await this.locked(id,user,async(cur,tx)=>{const next=cur.integration as SupplyIntegration;next.operations[supplyId].labelOperationId=operationId!;delete next.operations[supplyId].labelUrl;await this.save(tx,id,next,user,'OZON_LABEL_REQUEST');});
   }
   const result=await this.call(c,'/v1/cargoes-label/get',{operation_id:operationId});
   const url=result.result?.file_url??result.file_url;
   if(!url)throw new BadRequestException(`Этикетки «${direction.name}» готовятся в Ozon. Повторите подготовку через несколько секунд; печать ещё не начата.`);
   response=await download(url);
   if(response.ok)await this.locked(id,user,async(cur,tx)=>{const next=cur.integration as SupplyIntegration;next.operations[supplyId].labelUrl=url;await this.save(tx,id,next,user,'OZON_LABEL_READY');});
  }
  if(!response.ok)throw new BadGatewayException(`Ozon: HTTP ${response.status}. Этикетки не отправлены в печать.`);
  const buffer=Buffer.from(await response.arrayBuffer());
  if(buffer.length>20_000_000)throw new BadRequestException('Файл этикеток слишком велик.');
  const rendered=await renderOzonPrintPages(await annotateOzonLabels(buffer,op.cargoes ?? [],link?.packingPlan?.boxes.map(b=>({id:b.key,boxCode:b.boxCode,direction:b.direction}))??s.request.fboAssembly?.boxes ?? []),direction.cargoIds);
  const current=await this.load(id,user);
  if(ozonPrintManifest(current.directions as unknown as Array<{name:string}>,current.integration as SupplyIntegration).fingerprint!==manifest.fingerprint)throw new ConflictException('Состав грузомест изменился. Подготовьте этикетки заново.');
  return {...manifest,clientId:s.request.clientId,...rendered};
 }
 // FIX: scoped read-only export remains available after reopening a completed assembly.
 async cargoMappingFile(id:string,user:AuthUser){
  const s=await this.load(id,user);
  return {fileName:`ozon-boxes-${s.request.number}.xlsx`,buffer:await cargoMappingWorkbook(s.integration?.packingPlan?.boxes?.map((b:any)=>({id:b.key,boxCode:b.boxCode,direction:b.direction}))??s.request.fboAssembly?.boxes??[],s.integration as SupplyIntegration|null)};
 }
 // FIX: persist the authenticated click before returning an existing label URL; no marketplace write.
 async labelDownload(id:string,supplyId:string,user:AuthUser){
  const s=await this.load(id,user),link=s.integration as SupplyIntegration|null;
  const supply=link?.supplies.find(v=>v.id===supplyId),op=link?.operations[supplyId];
  if(!supply||op?.state!=='SUCCESS'||!op.labelUrl)throw new BadRequestException('Стикеры этой поставки ещё не готовы.');
  let url:URL;try{url=new URL(op.labelUrl);}catch{throw new BadRequestException('Некорректная ссылка на стикеры.');}
  if(url.protocol!=='https:'||url.username||url.password)throw new BadRequestException('Некорректная ссылка на стикеры.');
  await this.db.$transaction(async tx=>{
   await tx.clientRequestEvent.create({data:{requestId:id,clientId:s.request.clientId,eventType:'COMMENT',title:'Нажата кнопка «Скачать стикеры Ozon»',body:`Поставка Ozon ${supplyId} · ${supply.name}. Записано нажатие кнопки; сохранение файла и печать не подтверждаются.`,createdByUserId:user.id}});
   await tx.auditLog.create({data:{userId:user.id,action:'OZON_LABEL_DOWNLOAD_CLICK',entity:'ClientRequest',entityId:id,payload:{supplyId,direction:supply.name}}});
  });
  if (process.env.WMS_OZON_BOX_LABEL_ENABLED !== 'true') return {url:url.href};
  if (!url.hostname.endsWith('.ozone.ru') && url.hostname !== 'ozone.ru') throw new BadRequestException('Некорректная ссылка Ozon.');
  const response = await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new BadGatewayException('Скачивание стикеров не удалось. Обновите этикетки Ozon.');
  const pdf = await annotateOzonLabels(Buffer.from(await response.arrayBuffer()),op.cargoes ?? [],link?.packingPlan?.boxes.map(b=>({id:b.key,boxCode:b.boxCode,direction:b.direction}))??s.request.fboAssembly?.boxes ?? []);
  return {url:url.href,pdfBase64:pdf.toString('base64')};
 }
 private async load(id:string,user:AuthUser,mode:'read'|'write'='read',db:any=this.db){
  if(process.env.WMS_OZON_FBO_IMPORT_ENABLED!=='true')throw new NotFoundException('Связь Ozon выключена.');
  const s=await db.ozonFboShipment.findUnique({where:{requestId:id},include:{request:{include:{fboAssembly:{include:{boxes:true,units:true}}}}}});
  if(!s)throw new NotFoundException('Сборка Ozon не найдена.');
  this.scopes.requireClientAccess(user,s.request.clientId,mode);assertWarehouseAccess(user,s.request,mode);
  // FIX: customer imports carry their branch on the scoped request, not in the internal branch selector.
  if(!(user.roleCodes??[]).includes('CLIENT')&&(!user.activeWarehouseId||s.request.warehouseId!==user.activeWarehouseId))throw new NotFoundException('Выберите филиал сборки.');
  if(mode==='write')assertNoOzonAdjustment(s.integration);
  return s;
 }
 private async connection(id:string,clientId:string){
  const c=await this.db.clientMarketplaceConnection.findFirst({where:{id,clientId,marketplace:'OZON',isActive:true}});
  if(!c?.sellerId||!c.apiKey)throw new BadRequestException('Кабинет Ozon не настроен для этого клиента.');return c;
 }
 // FIX: retry only explicit rate-limit rejection for cargo creation, never an ambiguous write.
 async call(c:any,path:string,body:any,read=true):Promise<any>{
  for(let attempt=0;attempt<3;attempt++){
   let r:Response;try{r=await fetch('https://api-seller.ozon.ru'+path,{method:'POST',headers:{'Content-Type':'application/json','Client-Id':c.sellerId,'Api-Key':c.apiKey},body:JSON.stringify(body,(key,value)=>{
    // FIX: Ozon int64 cargo IDs must be emitted as exact numeric tokens.
    if(key==='cargo_id'&&typeof value==='string'&&/^[1-9]\d*$/.test(value))return (JSON as typeof JSON & {rawJSON:(s:string)=>unknown}).rawJSON(value);
    return value;
   }),signal:AbortSignal.timeout(30000)});}catch{throw new BadGatewayException('Нет подтверждённого ответа Ozon. Проверьте статус; не отправляйте повторно.');}
   // FIX: retry explicitly rejected label creation too; network/5xx ambiguity is never retried.
   if((read||path==='/v1/cargoes/create'||path==='/v1/cargoes-label/create')&&r.status===429&&attempt<2){
    const retryAfter=r.headers.get('retry-after');
    const requested=retryAfter?(Number.isFinite(Number(retryAfter))?Number(retryAfter)*1000:Date.parse(retryAfter)-Date.now()):0;
    const delay=Math.max(1500*(attempt+1),Number.isFinite(requested)?requested:0);
    // Do not retry before a long server cooldown, or hold the incoming request indefinitely.
    if(delay<=10000){await r.body?.cancel();await new Promise(r=>setTimeout(r,delay));continue;}
   }
   // FIX: Node 22 supplies the original token before Number rounding.
   const text=await r.text();
   let p:any;try{p=JSON.parse(text,(key,value,context?:{source?:string})=>{
    if(key==='cargo_id'&&typeof value==='number'){
     if(context?.source&&/^[1-9]\d*$/.test(context.source))return context.source;
     if(!Number.isSafeInteger(value))throw new Error('Unsafe cargo ID');
    }return value;
   });}catch{throw new BadGatewayException('Ozon вернул некорректный ответ или неточный номер грузоместа.');}if(!r.ok)throw new BadGatewayException(`Ozon: HTTP ${r.status}. ${String(p.message??'Ошибка запроса').slice(0,300)}`);return p;
  }
 }
 async snapshot(c:any,orderId:string):Promise<SupplyIntegration>{
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
   supplies.push({id:String(s.supply_id),name:cluster?.name??s.storage_warehouse?.name??String(s.macrolocal_cluster_id),items:items.map(i=>({barcode:String(i.barcode??''),offerId:String(i.offer_id??''),quantity:Number(i.quantity),quant:Number(i.quant)||1,...(typeof i.placement_zone==="string"?{placementZone:i.placement_zone}:{}),...(i.sku?{sku:String(i.sku)}:{})}))});
  }
  return {connectionId:c.id,orderId,orderNumber:String(o.order_number??orderId),place:o.drop_off_warehouse?.name??'',date:o.timeslot?.timeslot?.from??'',state:o.state,editDeadlineAt:ozonEditDeadline(o),supplies,mapping:{},operations:{},checkedAt:new Date().toISOString()};
 }
 private async locked(id:string,user:AuthUser,fn:(s:any,tx:any)=>Promise<any>){
  return this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "ClientRequest" WHERE "id"=${id} FOR UPDATE`;const s=await this.load(id,user,'write',tx);assertNoOzonAdjustment(s.integration);return fn(s,tx);});
 }
 private async save(tx:any,id:string,link:SupplyIntegration,user:AuthUser,action:string){
  await tx.ozonFboShipment.update({where:{requestId:id},data:{integration:link}});
  await tx.auditLog.create({data:{userId:user.id,action,entity:'ClientRequest',entityId:id,payload:{orderIds:supplyOrders(link).map(o=>o.orderId),mapping:link.mapping,operations:link.operations}}});
 }
 async view(id:string,user:AuthUser){
  const s=await this.load(id,user),link=s.integration as SupplyIntegration|null;
  const connections=await this.db.clientMarketplaceConnection.findMany({where:{clientId:s.request.clientId,marketplace:'OZON',isActive:true},select:{id:true,accountName:true,sellerId:true}});
  let packingError='';if(link)try{packedCargoes(s.directions,link,s.request.fboAssembly);}catch(e){packingError=e instanceof Error?e.message:String(e);}
  return {plannedPackingSupported:plannedPackingEnabled(),requestId:id,directions:s.directions,connections,link,differences:link?supplyDifferences(s.directions,link):[],packingError};
 }
 async bind(id:string,body:{connectionId:string;orderId:string},user:AuthUser){
  const s=await this.load(id,user,'write');if(s.integration?.frozenHash)throw new ConflictException('Состав уже отправляется. Привязка заблокирована.');
  const value=String(body.orderId).trim();
  const orderId=value.match(/^https:\/\/seller\.ozon\.ru\/app\/supply\/orders\/(\d+)(?:[?#].*)?$/)?.[1]??value;
  const c=await this.connection(body.connectionId,s.request.clientId),link=await this.snapshot(c,orderId);
  if(await this.db.ozonFboPlan.findFirst({where:{connectionId:c.id,ozonOrderId:link.orderId}}))throw new ConflictException('Эта поставка уже используется в прежнем плане Ozon. Нужен перенос плана, а не вторая сборка.');
  await this.locked(id,user,async(current,tx)=>{
   if(current.integration?.frozenHash)throw new ConflictException('Отправка уже началась.');
   const old=current.integration as SupplyIntegration|null;
   if(old&&old.connectionId!==c.id)throw new ConflictException('Все заявки одной сборки должны принадлежать одному кабинету Ozon.');
   const key=`${c.sellerId}:${link.orderId}`;const other=await tx.ozonFboShipment.findUnique({where:{externalOrderKey:key}});if(other&&other.requestId!==id)throw new ConflictException('Поставка Ozon уже привязана к другой сборке.');
   // FIX: serialize ownership across different assemblies as well as concurrent additions to this one.
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
   const owner=await tx.ozonFboOrderBinding.findUnique({where:{externalOrderKey:key}});
   if(owner&&owner.requestId!==id)throw new ConflictException('Поставка Ozon уже привязана к другой сборке.');
   if(!owner)await tx.ozonFboOrderBinding.create({data:{externalOrderKey:key,requestId:id,orderId:link.orderId}});
   const orders=old?supplyOrders(old):[];
   const merged=mergeSupplyOrders(old??link,[...orders.filter(o=>o.orderId!==link.orderId),...supplyOrders(link)]);
   for(const d of current.directions as OzonDirection[]){if(merged.mapping[d.name])continue;const matches=merged.supplies.filter(v=>v.name.trim().toLocaleLowerCase()===d.name.trim().toLocaleLowerCase());if(matches.length===1)merged.mapping[d.name]=matches[0].id;}
   await tx.ozonFboShipment.update({where:{requestId:id},data:{externalOrderKey:current.externalOrderKey??key}});await this.save(tx,id,merged,user,'OZON_SUPPLY_BOUND');
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
  const c=await this.connection(old.connectionId,s.request.clientId),orders:SupplyOrderSnapshot[]=[];
  for(const order of supplyOrders(old))orders.push(...supplyOrders(await this.snapshot(c,order.orderId)));
  await this.locked(id,user,async(cur,tx)=>{const l=cur.integration as SupplyIntegration;if(!l||bindingIdentity(l)!==bindingIdentity(old))throw new ConflictException('Привязка изменилась. Обновите экран.');await this.save(tx,id,mergeSupplyOrders(l,orders),user,'OZON_SUPPLY_REFRESH');});
  return this.view(id,user);
 }
 // FIX: a planned composition is separate from physical scans and never fabricates packing.
 async savePackingPlan(id:string,body:{boxes:unknown;confirm?:boolean},user:AuthUser){
  if(!plannedPackingEnabled())throw new NotFoundException('Упаковка по плану выключена.');
  if(body.confirm!==true)throw new BadRequestException('Подтвердите предварительный план упаковки.');
  await this.refresh(id,user);
  await this.locked(id,user,async(s,tx)=>{
   const link=s.integration as SupplyIntegration;
   if(link.frozenHash||Object.keys(link.operations??{}).length)throw new ConflictException('Отправленный план нельзя менять без сверки Ozon.');
   if(s.request.fboAssembly?.boxes?.length||s.request.fboAssembly?.units?.some((u:any)=>u.state==='PACKED'||u.wholeBox&&u.state!=='RETURNED'))throw new ConflictException('Упаковка уже начата. Нельзя заменить фактическое наполнение планом.');
   const boxes=validatePackingPlan(body.boxes,s.directions,link);
   const previous=link.packingPlan;
   if(previous&&previous.state!=='DRAFT')throw new ConflictException('Операция Ozon ещё не завершена.');
   const clean=boxes.map(b=>({key:b.key,boxCode:b.boxCode,supplyId:b.supplyId,direction:b.direction,items:b.items.map(i=>({skuId:i.skuId,barcode:i.barcode,quantity:i.quantity,zone:i.zone}))}));
   for(const b of clean)if(await tx.box.findUnique({where:{code:b.boxCode}}))throw new ConflictException('ШК планируемого короба уже используется.');
   link.packingPlan={version:(previous?.version??0)+1,state:'DRAFT',boxes:clean};
   await this.save(tx,id,link,user,'OZON_PACKING_PLAN_SAVED');
  });return this.view(id,user);
 }
 async uploadPackingPlan(id:string,body:{confirm?:boolean;replaceEmpty?:boolean},user:AuthUser){
  if(!plannedPackingEnabled())throw new NotFoundException('Упаковка по плану выключена.');
  if(body.confirm!==true)throw new BadRequestException('Подтвердите передачу плана в Ozon.');
  const s=await this.load(id,user,'write'),l=s.integration as SupplyIntegration,plan=l.packingPlan;
  if(!plan||plan.state!=='DRAFT')throw new ConflictException('Нет нового плана. Для отправленного плана проверьте результат.');
  const c=await this.connection(l.connectionId,s.request.clientId);
  // A fresh snapshot must match before the claim; existing nonempty cargo is never overwritten.
  const snapshots=[];for(const order of supplyOrders(l))snapshots.push(...supplyOrders(await this.snapshot(c,order.orderId)));
  const fresh=mergeSupplyOrders(l,snapshots);validatePackingPlan(plan.boxes,s.directions,fresh);
  if(snapshots.some(o=>!['DATA_FILLING','READY_TO_SUPPLY'].includes(o.state)))throw new ConflictException('Ozon больше не разрешает заполнение поставки.');
  const replacements:Record<string,boolean>={},emptyIds:Record<string,string[]>={},payload:Record<string,any[]>={};
  for(const supply of fresh.supplies){
   const result=await this.call(c,'/v1/cargoes/supplies/get',{supply_ids:[Number(supply.id)]});
   const r=result.supplies_cargoes?.find((v:any)=>String(v.supply_id)===supply.id);
   if(!r||!Array.isArray(r.transport_cargoes)||r.transport_cargoes.length||!Array.isArray(r.cargoes_without_transport_cargoes))throw new ConflictException('Не удалось однозначно проверить существующие грузоместа.');
   emptyIds[supply.id]=r.cargoes_without_transport_cargoes.map((b:any)=>String(b.cargo_id)).sort();
   replacements[supply.id]=r.cargoes_without_transport_cargoes.length>0;
   if(replacements[supply.id]){
    if(!body.replaceEmpty)throw new ConflictException('Пустые грузоместа уже созданы. Подтвердите их замену и печать новых этикеток.');
    for(const box of r.cargoes_without_transport_cargoes){
     if(!box.bundle_id)throw new ConflictException('Ozon не вернул состав существующего грузоместа.');
     const bundle=await this.call(c,'/v1/supply-order/bundle',{bundle_ids:[box.bundle_id],limit:100});
     if(!Array.isArray(bundle.items)||bundle.has_next||bundle.items.some((i:any)=>Number(i.quantity)!==0))throw new ConflictException('В Ozon уже есть наполненные грузоместа. Замена запрещена.');
    }
   }
   payload[supply.id]=plan.boxes.filter(b=>b.supplyId===supply.id).map(b=>({key:b.key,value:{type:'BOX',items:b.items.map(i=>{const item=supply.items.find(x=>x.barcode===i.barcode)!;return {barcode:i.barcode,offer_id:item.offerId,quantity:i.quantity,quant:item.quant||1};})}}));
  }
  await this.locked(id,user,async(cur,tx)=>{
   const link=cur.integration as SupplyIntegration;
   if(JSON.stringify(link.packingPlan)!==JSON.stringify(plan)||link.frozenHash||Object.keys(link.operations).length||bindingIdentity(link)!==bindingIdentity(l))throw new ConflictException('План изменился. Обновите страницу.');
   validatePackingPlan(plan.boxes,cur.directions,fresh);
   if(cur.request.fboAssembly?.boxes?.length)throw new ConflictException('Упаковка уже начата.');
   link.packingPlan!.state='SENDING';link.frozenHash=cargoHash(payload);
   link.packingPlan!.dispatch={};
   for(const supplyId of Object.keys(payload)){link.operations[supplyId]={state:'QUEUED'};link.packingPlan!.dispatch[supplyId]={cargoes:payload[supplyId],replaceEmpty:replacements[supplyId],emptyCargoIds:emptyIds[supplyId]};}
   await this.save(tx,id,link,user,'OZON_PLANNED_CARGO_CLAIMED');
  });
  return this.status(id,user);
 }
 // FIX: claim only one queued supply. A crash after claim is deliberately not retried.
 private async dispatchPlanned(id:string,user:AuthUser){
  const s=await this.load(id,user,'write'),link=s.integration as SupplyIntegration,plan=link.packingPlan;
  if(!plan?.dispatch||plan.state==='ACTIVE'||Object.values(link.operations).some(o=>!['QUEUED','SUCCESS'].includes(o.state)))return;
  const supplyId=Object.keys(plan.dispatch).find(k=>link.operations[k]?.state==='QUEUED');if(!supplyId)return;
  const entry=plan.dispatch[supplyId],c=await this.connection(link.connectionId,s.request.clientId);
  const order=supplyOrders(link).find(o=>o.supplies.some(v=>v.id===supplyId));if(!order)throw new ConflictException('Нет заявки Ozon для направления.');
  const fresh=await this.snapshot(c,order.orderId);
  if(!['DATA_FILLING','READY_TO_SUPPLY'].includes(fresh.state))throw new ConflictException('Ozon больше не разрешает заполнение поставки.');
  validatePackingPlan(plan.boxes,s.directions,mergeSupplyOrders(link,supplyOrders(link).map(o=>o.orderId===order.orderId?supplyOrders(fresh)[0]:o)));
  const existing=await this.call(c,'/v1/cargoes/supplies/get',{supply_ids:[Number(supplyId)]});
  const remote=existing.supplies_cargoes?.find((v:any)=>String(v.supply_id)===supplyId);
  if(!remote||!Array.isArray(remote.transport_cargoes)||remote.transport_cargoes.length||!Array.isArray(remote.cargoes_without_transport_cargoes)||JSON.stringify(remote.cargoes_without_transport_cargoes.map((b:any)=>String(b.cargo_id)).sort())!==JSON.stringify(entry.emptyCargoIds))throw new ConflictException('Грузоместа Ozon изменились после подготовки плана.');
  for(const b of remote.cargoes_without_transport_cargoes){
   if(!b.bundle_id)throw new ConflictException('Нет состава грузоместа Ozon.');
   const contents=await this.call(c,'/v1/supply-order/bundle',{bundle_ids:[b.bundle_id],limit:100});
   if(!Array.isArray(contents.items)||contents.has_next||contents.items.some((i:any)=>Number(i.quantity)!==0))throw new ConflictException('Грузоместо уже наполнено. Замена запрещена.');
  }
  const claimed=await this.locked(id,user,async(cur,tx)=>{const l=cur.integration as SupplyIntegration;
   if(l.frozenHash!==link.frozenHash||l.operations[supplyId]?.state!=='QUEUED'||Object.values(l.operations).some(o=>!['QUEUED','SUCCESS'].includes(o.state)))return false;
   l.operations[supplyId]={state:'SENDING'};await this.save(tx,id,l,user,'OZON_PLANNED_CARGO_SENDING');return true;
  });if(!claimed)return;
  try{
   const result=await this.call(c,'/v1/cargoes/create',{supply_id:Number(supplyId),delete_current_version:entry.replaceEmpty,cargoes:entry.cargoes},false);
   if(!result.operation_id)throw new Error('Ozon не вернул номер операции.');
   await this.locked(id,user,async(cur,tx)=>{const l=cur.integration as SupplyIntegration;l.operations[supplyId]={state:'ACCEPTED',operationId:String(result.operation_id)};await this.save(tx,id,l,user,'OZON_PLANNED_CARGO_ACCEPTED');});
  }catch(e){
   await this.locked(id,user,async(cur,tx)=>{const l=cur.integration as SupplyIntegration;if(!l.operations[supplyId].operationId)l.operations[supplyId]={state:'UNKNOWN',error:e instanceof Error?e.message:String(e)};await this.save(tx,id,l,user,'OZON_PLANNED_CARGO_UNCERTAIN');});
   throw new ConflictException('Ответ Ozon не подтверждён. Повтор заблокирован до сверки.');
  }
 }
 // FIX: activate only after exact remote cargo IDs and per-box quantities are read back.
 private async activatePlanned(id:string,user:AuthUser){
  const s=await this.load(id,user,'write'),l=s.integration as SupplyIntegration,p=l.packingPlan;
  if(!p||p.state==='ACTIVE'||!Object.values(l.operations).length||Object.values(l.operations).some(o=>o.state!=='SUCCESS'))return;
  const c=await this.connection(l.connectionId,s.request.clientId),ids=new Set<string>();
  const verified=structuredClone(p.boxes);
  for(const supplyId of new Set(p.boxes.map(b=>b.supplyId))){
   const expected=verified.filter(b=>b.supplyId===supplyId),op=l.operations[supplyId];
   if(op.cargoes?.length!==expected.length)throw new ConflictException('Ozon подтвердил другое число грузомест.');
   for(const b of expected){const matches=op.cargoes.filter(v=>v.key===b.key);if(matches.length!==1||!/^\d+$/.test(matches[0].cargoId)||ids.has(matches[0].cargoId))throw new ConflictException('Неоднозначное сопоставление грузомест Ozon.');b.cargoId=matches[0].cargoId;ids.add(b.cargoId);}
   const result=await this.call(c,'/v1/cargoes/supplies/get',{supply_ids:[Number(supplyId)]});
   const remote=result.supplies_cargoes?.find((v:any)=>String(v.supply_id)===supplyId);
   if(!remote||!Array.isArray(remote.transport_cargoes)||remote.transport_cargoes.length||!Array.isArray(remote.cargoes_without_transport_cargoes)||remote.cargoes_without_transport_cargoes.length!==expected.length)throw new ConflictException('Состав грузомест Ozon не совпал с планом.');
   for(const b of expected){const cargo=remote.cargoes_without_transport_cargoes.find((v:any)=>String(v.cargo_id)===b.cargoId);if(!cargo?.bundle_id)throw new ConflictException('Не найден состав короба Ozon.');
    const result=await this.call(c,'/v1/supply-order/bundle',{bundle_ids:[cargo.bundle_id],limit:100});
    if(!Array.isArray(result.items)||result.has_next)throw new ConflictException('Состав короба Ozon не подтверждён полностью.');
    const actual=new Map<string,number>();for(const i of result.items)actual.set(String(i.barcode),(actual.get(String(i.barcode))||0)+Number(i.quantity));
    if(actual.size!==b.items.length||b.items.some(i=>actual.get(i.barcode)!==i.quantity))throw new ConflictException('Количество товара в коробе Ozon не совпало с планом.');
   }
  }
  await this.locked(id,user,async(cur,tx)=>{const link=cur.integration as SupplyIntegration;
   if(JSON.stringify(link.packingPlan)!==JSON.stringify(p)||link.frozenHash!==l.frozenHash||JSON.stringify(link.operations)!==JSON.stringify(l.operations))throw new ConflictException('План изменился во время сверки.');
   link.packingPlan!.boxes=verified;link.packingPlan!.state='ACTIVE';await this.save(tx,id,link,user,'OZON_PACKING_PLAN_ACTIVE');
  });
 }
 async upload(id:string,confirm:boolean,user:AuthUser){
  if(confirm!==true)throw new BadRequestException('Подтвердите передачу проверенных коробов.');
  if((await this.load(id,user,'write')).integration?.packingPlan)throw new ConflictException('Грузоместа уже управляются планом. Используйте проверку результата.');
  await this.refresh(id,user);
  const s=await this.load(id,user,'write'),l=s.integration as SupplyIntegration,c=await this.connection(l.connectionId,s.request.clientId);
  if(supplyOrders(l).some(o=>o.state!=='DATA_FILLING'&&o.supplies.some(s=>!l.operations[s.id]||l.operations[s.id].state==='FAILED')))throw new ConflictException('Не все неотправленные заявки Ozon в статусе заполнения данных.');
  const cargoes=packedCargoes(s.directions,l,s.request.fboAssembly);
  for(const supplyId of Object.keys(cargoes)){
   // FIX: retry only a durable, freshly confirmed terminal failure.
   const previous=l.operations[supplyId],previousJson=JSON.stringify(previous);
   if(previous&&previous.state!=='FAILED')continue;
   if(previous){
    if(!previous.operationId)throw new ConflictException('Нет номера отклонённой операции. Повтор заблокирован.');
    const checked=await this.call(c,'/v2/cargoes/create/info',{operation_id:previous.operationId});
    if(checked.status!=='FAILED')throw new ConflictException('Статус операции Ozon изменился. Проверьте результат отправки.');
   }
   const existing=await this.call(c,'/v1/cargoes/supplies/get',{supply_ids:[Number(supplyId)]});
   const remote=existing.supplies_cargoes?.find((v:any)=>String(v.supply_id)===supplyId);
   if(!remote||remote.transport_cargoes?.length||remote.cargoes_without_transport_cargoes?.length)throw new ConflictException('В Ozon уже есть грузоместа или их состав не подтверждён. Автоматическая замена запрещена.');
   if(previous&&(!Array.isArray(remote.transport_cargoes)||!Array.isArray(remote.cargoes_without_transport_cargoes)))throw new ConflictException('Ozon не подтвердил отсутствие грузомест. Повтор заблокирован.');
   const claimed=await this.locked(id,user,async(cur,tx)=>{
    const link=cur.integration as SupplyIntegration;if(JSON.stringify(link.operations[supplyId])!==previousJson)return false;
    if(bindingIdentity(link)!==bindingIdentity(l))throw new ConflictException('Привязка изменилась.');
    const now=packedCargoes(cur.directions,link,cur.request.fboAssembly),hash=cargoHash(now);
    if(hash!==cargoHash(cargoes)||(link.frozenHash&&link.frozenHash!==hash))throw new ConflictException('Состав изменился. Повторите сверку.');
    // FIX: retain the previous operation in audit before the atomic replacement claim.
    if(previous)await this.save(tx,id,link,user,'OZON_CARGO_RETRY_PREVIOUS');
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
   // FIX: legacy explicit 429 failures can be released only after a fresh empty-cargo read.
   if(!l.packingPlan&&op.state==='UNKNOWN'&&!op.operationId&&op.error?.startsWith('Ozon: HTTP 429.')){
    const result=await this.call(c,'/v1/cargoes/supplies/get',{supply_ids:[Number(supplyId)]});
    const remote=result.supplies_cargoes?.find((v:any)=>String(v.supply_id)===supplyId);
    if(remote&&Array.isArray(remote.transport_cargoes)&&Array.isArray(remote.cargoes_without_transport_cargoes)&&!remote.transport_cargoes.length&&!remote.cargoes_without_transport_cargoes.length){
     await this.locked(id,user,async(cur,tx)=>{const link=cur.integration as SupplyIntegration;
      if(bindingIdentity(link)!==bindingIdentity(l)||JSON.stringify(link.operations[supplyId])!==JSON.stringify(op))return;
      delete link.operations[supplyId];await this.save(tx,id,link,user,'OZON_CARGO_THROTTLE_RELEASED');
     });
    }
    continue;
   }
   if(!op.operationId)continue;
   const r=await this.call(c,'/v2/cargoes/create/info',{operation_id:op.operationId});
   const state=r.status==='SUCCESS'?'SUCCESS':r.status==='FAILED'?'FAILED':'ACCEPTED';
   await this.locked(id,user,async(cur,tx)=>{const link=cur.integration as SupplyIntegration;const current=link.operations[supplyId];if(current.operationId!==op.operationId||current.state==='SUCCESS'&&state!=='SUCCESS')return;
    current.state=state;current.error=r.errors&&(Array.isArray(r.errors)?r.errors.length:Object.keys(r.errors).length)?JSON.stringify(r.errors):undefined;
    if(state==='SUCCESS')current.cargoes=(r.result?.cargoes??[]).map((v:any)=>({key:String(v.key),cargoId:String(v.value?.cargo_id??'')}));
    await this.save(tx,id,link,user,'OZON_CARGO_STATUS');});
  }
  await this.activatePlanned(id,user);
  await this.dispatchPlanned(id,user);
  return this.view(id,user);
 }
 async labels(id:string,supplyId:string,user:AuthUser){
  const s=await this.load(id,user,'write'),l=s.integration as SupplyIntegration,op=l?.operations[supplyId];
  if(!op||op.state!=='SUCCESS'||!op.cargoes?.length||op.cargoes.some(v=>!/^\d+$/.test(v.cargoId)))throw new ConflictException('Сначала дождитесь подтверждения грузомест Ozon.');
  const c=await this.connection(l.connectionId,s.request.clientId);
  let operationId=op.labelOperationId;
  if(!operationId){
   const created=await this.call(c,'/v1/cargoes-label/create',{supply_id:Number(supplyId),cargoes:op.cargoes.map(v=>({cargo_id:v.cargoId}))},false);
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
