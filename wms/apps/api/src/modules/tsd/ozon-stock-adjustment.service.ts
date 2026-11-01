import {recordOzonCorrectionEvent} from '../client-requests/ozon-stock-decision';
import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {syncComposition} from './ozon-request-sync-policy';
import {PrismaService} from '../../common/prisma/prisma.service';
import {ClientScopeService} from '../auth/client-scope.service';
import type {AuthUser} from '../auth/auth.types';
import {assertWarehouseAccess} from '../client-requests/client-request-warehouse-scope';
import {OzonAssemblySupplyService} from '../client-requests/ozon-assembly-supply.service';
import {assertNoOzonAdjustment,mergeSupplyOrders,supplyOrders,supplyDifferences,type SupplyIntegration} from '../client-requests/ozon-supply-policy';
import {FboTwoStageService} from './fbo-two-stage.service';
import {wbReservationQuantities} from '../../common/stock/wb-order-stock-lifecycle';
import {adjustmentHash,adjustmentRows,validateAdjustment,type AdjustmentRow} from './ozon-adjustment-policy';
const active=(op:any)=>op&&!['APPLIED','CANCELLED'].includes(op.state);
const composition=(items:any[])=>adjustmentHash(items.map(i=>[i.id,i.skuId,i.barcode,i.quantity]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
@Injectable()
export class OzonStockAdjustmentService {
 constructor(private readonly db:PrismaService,private readonly scopes:ClientScopeService,private readonly fbo:FboTwoStageService,private readonly ozon:OzonAssemblySupplyService){}
 private async load(tx:any,id:string,user:AuthUser){
  if(process.env.WMS_OZON_FBO_IMPORT_ENABLED!=='true')throw new NotFoundException('ФБО Ozon выключено.');
  // FIX: opening customer correction must not grant internal operators new stock privileges.
  if(!(user.roleCodes??[]).includes('CLIENT')&&!(user.permissionCodes??[]).some(p=>['system:admin','stock:write'].includes(p)))throw new ForbiddenException('Нет права изменения складских заявок.');
  const s=await tx.ozonFboShipment.findUnique({where:{requestId:id},include:{request:{include:{items:true,fboAssembly:{include:{units:true,boxes:true}}}}}});
  if(!s)throw new NotFoundException('Сборка Ozon не найдена.');this.scopes.requireClientAccess(user,s.request.clientId,'write');assertWarehouseAccess(user,s.request,'write');
  // FIX: customer imports carry their branch on the scoped request, not in the internal branch selector.
  if(!(user.roleCodes??[]).includes('CLIENT')&&(!user.activeWarehouseId||user.activeWarehouseId!==s.request.warehouseId))throw new ConflictException('Выберите филиал заявки.');return s;
 }
 private async connection(s:any){const c=await this.db.clientMarketplaceConnection.findFirst({where:{id:s.integration?.connectionId,clientId:s.request.clientId,marketplace:'OZON',isActive:true}});if(!s.integration?.connectionId||!c?.apiKey)throw new ConflictException('Сначала привяжите кабинет и поставку Ozon.');return c;}
 private async fresh(s:any,c:any){const old=s.integration as SupplyIntegration,orders=[];for(const o of supplyOrders(old))orders.push(...supplyOrders(await this.ozon.snapshot(c,o.orderId)));return mergeSupplyOrders(old,orders);}
 // FIX: never invalidate existing Ozon labels or unidentified cargoes.
 private async assertEmptyCargoes(c:any,link:SupplyIntegration){
  for(const supply of link.supplies){
   const data=await this.ozon.call(c,'/v1/cargoes/supplies/get',{supply_ids:[Number(supply.id)]});
   const remote=data.supplies_cargoes?.find((v:any)=>String(v.supply_id)===supply.id);
   if(!remote||remote.transport_cargoes?.length||remote.cargoes_without_transport_cargoes?.length)throw new ConflictException('В Ozon уже есть грузоместа или их состав не подтверждён. Сначала нужна сверка грузомест.');
  }
 }
 private async locked(id:string,user:AuthUser,fn:(s:any,tx:any)=>Promise<any>){return this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "ClientRequest" WHERE "id"=${id} FOR UPDATE`;return fn(await this.load(tx,id,user),tx);},{timeout:30000,isolationLevel:'Serializable'});}
 private async assess(tx:any,id:string,user:AuthUser){
  const s=await this.load(tx,id,user);assertNoOzonAdjustment(s.integration);
  if(!['SUBMITTED','APPROVED','IN_WORK'].includes(s.request.status)||s.integration?.frozenHash||Object.keys(s.integration?.operations??{}).length||['CONTROL','COMPLETED'].includes(s.request.fboAssembly?.phase))throw new ConflictException('Корректировка доступна до передачи грузомест и завершения проверки.');
  if(new Set(s.request.items.map((i:any)=>i.skuId)).size!==s.request.items.length)throw new ConflictException('Повторяющиеся строки товара требуют сверки.');
  const {plan}=await this.fbo.adjustmentContext(tx,id,user),skuIds=plan.lines.map(l=>l.skuId),limits:Record<string,number>={};
  const reserved=await wbReservationQuantities(tx,s.request.clientId,skuIds,s.request.warehouseId,id);
  const balances=await tx.stockBalance.findMany({where:{clientId:s.request.clientId,warehouseId:s.request.warehouseId,skuId:{in:skuIds},status:'AVAILABLE',OR:[{boxId:null},{box:{status:'active',clientId:s.request.clientId,warehouseId:s.request.warehouseId}}]},select:{skuId:true,quantity:true}});
  for(const l of plan.lines){const routed=plan.route.flatMap(r=>r.tasks).filter(i=>i.skuId===l.skuId).reduce((n,i)=>n+i.quantity,0),candidate=plan.unboxedPickingSupported?l.remaining:routed+(l.pendingPlacementQuantity??0),stock=balances.filter((b:any)=>b.skuId===l.skuId).reduce((n:number,b:any)=>n+b.quantity,0);limits[l.skuId]=l.picked+Math.max(0,Math.min(candidate,stock-(reserved.get(l.skuId)??0)));}
  if(plan.compositionChanged)throw new ConflictException('Состав сборки требует сверки.');
  const rows=adjustmentRows(plan,limits),basis={status:s.request.status,phase:s.request.fboAssembly?.phase??null,items:s.request.items.map((i:any)=>({id:i.id,skuId:i.skuId,barcode:i.barcode,quantity:i.quantity})).sort((a:any,b:any)=>a.id.localeCompare(b.id)),units:(s.request.fboAssembly?.units??[]).filter((u:any)=>u.state!=='RETURNED').map((u:any)=>({id:u.id,state:u.state,targetBoxId:u.targetBoxId})).sort((a:any,b:any)=>a.id.localeCompare(b.id)),directions:s.directions,connectionId:s.integration?.connectionId,orderIds:s.integration?supplyOrders(s.integration).map(o=>o.orderId):[]};
  return {s,plan,rows,basis,token:adjustmentHash([user.id,id,basis,rows])};
 }
 async preview(id:string,user:AuthUser){const x=await this.db.$transaction(tx=>this.assess(tx,id,user),{isolationLevel:'RepeatableRead',timeout:30000});const c=await this.connection(x.s),link=await this.fresh(x.s,c);await this.assertEmptyCargoes(c,link);if(supplyDifferences(x.s.directions,link).length)throw new ConflictException('Состав WMS уже расходится с Ozon. Сначала выполните сверку поставок.');return {token:x.token,rows:x.rows,lines:x.plan.lines,pendingLocations:x.plan.pendingLocations,route:x.plan.route,needed:x.plan.needed,after:x.rows.reduce((n,r)=>n+r.after,0)};}
 // FIX: inbound synchronization reads Ozon only; a fresh preview guards every local write.
 private async syncAssessment(tx:any,s:any,link:SupplyIntegration,user:AuthUser){
  assertNoOzonAdjustment(s.integration);
  const r=s.request,a=r.fboAssembly;
  if(!['SUBMITTED','APPROVED','IN_WORK'].includes(r.status)||s.integration?.frozenHash||Object.keys(s.integration?.operations??{}).length||a&&(!['PICKING','PACKING'].includes(a.phase)||a.pickClosure))throw new ConflictException('Синхронизация доступна до контроля и передачи грузомест.');
  if(new Set(r.items.map((i:any)=>i.skuId)).size!==r.items.length||r.items.some((i:any)=>!i.skuId))throw new ConflictException('Строки заявки требуют сверки.');
  if(a?.compositionHash&&a.compositionHash!==composition(r.items))throw new ConflictException('Состав сборки требует сверки.');
  if(supplyOrders(link).some(o=>!['DATA_FILLING','READY_TO_SUPPLY'].includes(o.state)))throw new ConflictException('Поставка Ozon больше не находится в подготовке.');
  const barcodes=link.supplies.flatMap(v=>v.items.map(i=>i.barcode));
  const catalog=await tx.sku.findMany({where:{clientId:r.clientId,barcodes:{some:{value:{in:barcodes}}}},include:{barcodes:true}});
  const result=syncComposition(s,link,catalog);
  const basis={status:r.status,items:r.items,directions:s.directions,assembly:a,integration:s.integration};
  // Ignore remote read timestamps, but bind the token to all local progress and remote demand.
  const remote=supplyOrders(link).map(o=>({orderId:o.orderId,state:o.state,supplies:o.supplies}));
  return {...result,token:adjustmentHash([user.id,r.id,basis,remote,result])};
 }
 async syncPreview(id:string,user:AuthUser){
  const initial=await this.load(this.db,id,user),c=await this.connection(initial),link=await this.fresh(initial,c);await this.assertEmptyCargoes(c,link);
  return this.locked(id,user,async(s,tx)=>{if(adjustmentHash(s.integration)!==adjustmentHash(initial.integration))throw new ConflictException('Привязка изменилась. Повторите сверку.');return this.syncAssessment(tx,s,link,user);});
 }
 async syncApply(id:string,body:{token:string;confirm:boolean},user:AuthUser){
  if(body?.confirm!==true||!body.token)throw new BadRequestException('Подтвердите синхронизацию заявки с Ozon.');
  const initial=await this.load(this.db,id,user),c=await this.connection(initial),link=await this.fresh(initial,c);await this.assertEmptyCargoes(c,link);
  return this.locked(id,user,async(s,tx)=>{
   if(adjustmentHash(s.integration)!==adjustmentHash(initial.integration))throw new ConflictException('Привязка изменилась. Повторите сверку.');
   const p=await this.syncAssessment(tx,s,link,user);if(p.token!==body.token)throw new ConflictException('Состав Ozon или сборка изменились. Повторите предпросмотр.');
   const items=[];for(const item of p.items){const old=s.request.items.find((i:any)=>i.skuId===item.skuId);items.push(old?await tx.clientRequestItem.update({where:{id:old.id},data:{quantity:item.quantity,barcode:item.barcode}}):await tx.clientRequestItem.create({data:{requestId:id,...item}}));}
   for(const old of s.request.items)if(!p.items.some(i=>i.skuId===old.skuId))await tx.clientRequestItem.delete({where:{id:old.id}});
   await tx.ozonFboShipment.update({where:{requestId:id},data:{directions:p.directions,integration:link as any}});
   const a=s.request.fboAssembly;if(a){const picked=a.units.filter((u:any)=>u.state!=='RETURNED').length;await tx.fboAssembly.update({where:{requestId:id},data:{compositionHash:composition(items),...(p.after>picked?{phase:'PICKING'}:{})}});}
   await tx.auditLog.create({data:{userId:user.id,action:'OZON_REMOTE_COMPOSITION_SYNC',entity:'ClientRequest',entityId:id,payload:{oldItems:s.request.items,oldDirections:s.directions,rows:p.rows,needed:p.needed,after:p.after,checkedAt:link.checkedAt} as any}});
   return {applied:true,needed:p.needed,after:p.after};
  });
 }
 // FIX: persist intent before external writes; unknown outcomes are never blindly retried.
 async start(id:string,body:{token:string;quantities:number[];confirm:boolean},user:AuthUser){
  if(body?.confirm!==true)throw new BadRequestException('Подтвердите изменение количества в WMS и Ozon.');
  const initial=await this.load(this.db,id,user);if(active(initial.integration?.adjustment))return this.view(id,user);
  const c=await this.connection(initial),fresh=await this.fresh(initial,c);if(supplyDifferences(initial.directions,fresh).length)throw new ConflictException('Состав Ozon изменился. Повторите сверку.');
  if(supplyOrders(fresh).some(o=>!['DATA_FILLING','READY_TO_SUPPLY'].includes(o.state)))throw new ConflictException('Ozon больше не разрешает подготовку этой поставки.');
  await this.assertEmptyCargoes(c,fresh);
  await this.locked(id,user,async(s,tx)=>{const x=await this.assess(tx,id,user);if(x.token!==body.token)throw new ConflictException('Остатки или сборка изменились. Повторите предпросмотр.');if(adjustmentHash(s.directions)!==adjustmentHash(initial.directions)||s.integration.connectionId!==fresh.connectionId||adjustmentHash(supplyOrders(s.integration).map((o:any)=>o.orderId))!==adjustmentHash(supplyOrders(fresh).map(o=>o.orderId)))throw new ConflictException('Привязка изменилась.');
   const rows=validateAdjustment(x.rows,body.quantities);if(rows.every(r=>r.after===r.before))throw new ConflictException('Корректировка не требуется.');
   const directions=(s.directions as any[]).map(d=>({...d,items:d.items.map((i:any)=>({...i,quantity:rows.find(r=>r.direction===d.name&&r.skuId===i.skuId)!.after})).filter((i:any)=>i.quantity>0)}));
   const operations:any[]=[];for(const d of directions){if(!rows.some(r=>r.direction===d.name&&r.after!==r.before))continue;const supply=fresh.supplies.find(v=>v.id===fresh.mapping[d.name]),order=supplyOrders(fresh).find(o=>o.supplies.some(v=>v.id===supply?.id));if(!supply||!order)throw new ConflictException('Нет соответствия направления Ozon.');
    const items=d.items.map((i:any)=>{const m=supply.items.filter(v=>v.barcode===i.barcode);if(m.length!==1||!m[0].sku||!Number.isSafeInteger(Number(m[0].sku)))throw new ConflictException('Ozon не вернул однозначный SKU товара.');return {sku:Number(m[0].sku),quantity:i.quantity,quant:m[0].quant||1};});operations.push({supplyId:supply.id,orderId:order.orderId,state:'PENDING',items});}
   fresh.adjustment={id:randomUUID(),state:'RUNNING',actorId:user.id,createdAt:new Date().toISOString(),basis:x.basis,rows,directions,operations};await tx.ozonFboShipment.update({where:{requestId:id},data:{integration:fresh as any}});await tx.auditLog.create({data:{userId:user.id,action:'OZON_STOCK_ADJUSTMENT_STARTED',entity:'ClientRequest',entityId:id,payload:fresh.adjustment as any}});await recordOzonCorrectionEvent(tx,id,s.request.clientId,user.id,'STARTED',fresh.adjustment.id);
  });return this.resume(id,user);
 }
 async view(id:string,user:AuthUser){const s=await this.load(this.db,id,user),op=s.integration?.adjustment;return {operation:op?{id:op.id,state:op.state,rows:op.rows,operations:op.operations.map((o:any)=>({supplyId:o.supplyId,state:o.state,error:o.error}))}:null};}
 async resume(id:string,user:AuthUser){
  let s=await this.load(this.db,id,user);if(!active(s.integration?.adjustment))return this.view(id,user);const c=await this.connection(s),opId=s.integration.adjustment.id;
  for(const original of s.integration.adjustment.operations){const claim=await this.locked(id,user,async(cur,tx)=>{const a=cur.integration.adjustment;if(a?.id!==opId||!active(a))return null;const op=a.operations.find((o:any)=>o.supplyId===original.supplyId);if(op.state!=='PENDING')return null;op.state='SENDING';await tx.ozonFboShipment.update({where:{requestId:id},data:{integration:cur.integration}});return op;});if(!claim)continue;
   let result:any;try{result=await this.ozon.call(c,'/v1/supply-order/content/update',{order_id:Number(claim.orderId),supply_id:Number(claim.supplyId),items:claim.items},false);}catch(e){const error=e instanceof Error?e.message:String(e);result={uncertain:true,error,...(/Ozon: HTTP (400|401|403|404|422)\./.test(error)?{errors:[error]}:{})};}
   await this.locked(id,user,async(cur,tx)=>{const a=cur.integration.adjustment;if(a?.id!==opId)throw new ConflictException('Операция изменилась.');const op=a.operations.find((o:any)=>o.supplyId===claim.supplyId);op.state=result.operation_id?'ACCEPTED':result.errors?.length?'FAILED':'UNKNOWN';if(op.state==='FAILED'||op.state==='UNKNOWN')await recordOzonCorrectionEvent(tx,id,cur.request.clientId,user.id,op.state,claim.supplyId);op.operationId=result.operation_id?String(result.operation_id):undefined;op.error=result.error??(result.errors?.length?JSON.stringify(result.errors):undefined);await tx.ozonFboShipment.update({where:{requestId:id},data:{integration:cur.integration}});});if(!result.operation_id)break;
  }
  s=await this.load(this.db,id,user);for(const op of s.integration.adjustment.operations){if(!op.operationId||['SUCCESS','FAILED'].includes(op.state))continue;const status=await this.ozon.call(c,'/v1/supply-order/content/update/status',{operation_id:op.operationId});await this.locked(id,user,async(cur,tx)=>{const a=cur.integration.adjustment;if(a?.id!==opId)throw new ConflictException('Операция изменилась.');const current=a.operations.find((v:any)=>v.supplyId===op.supplyId);if(status.status==='FAILED'&&current.state!=='FAILED')await recordOzonCorrectionEvent(tx,id,cur.request.clientId,user.id,'FAILED',op.supplyId);current.state=status.status==='SUCCESS'?'SUCCESS':status.status==='FAILED'?'FAILED':'ACCEPTED';current.error=status.errors?.length?JSON.stringify(status.errors):undefined;await tx.ozonFboShipment.update({where:{requestId:id},data:{integration:cur.integration}});});}
  s=await this.load(this.db,id,user);const fresh=await this.fresh(s,c),a=s.integration.adjustment;
  if(a.operations.every((o:any)=>o.state==='SUCCESS')&&!supplyDifferences(a.directions,fresh).length){await this.locked(id,user,async(cur,tx)=>{
   const op=cur.integration.adjustment;if(op?.id!==opId||!active(op))return;
   if(cur.request.status!==op.basis.status||(cur.request.fboAssembly?.phase??null)!==op.basis.phase)throw new ConflictException('Статус сборки изменился во время корректировки. Требуется сверка.');
   const currentItems=cur.request.items.map((i:any)=>({id:i.id,skuId:i.skuId,barcode:i.barcode,quantity:i.quantity})),currentUnits=(cur.request.fboAssembly?.units??[]).filter((u:any)=>u.state!=='RETURNED').map((u:any)=>({id:u.id,state:u.state,targetBoxId:u.targetBoxId}));
   const ordered=(x:any[])=>[...x].sort((a,b)=>a.id.localeCompare(b.id));if(adjustmentHash(ordered(currentItems))!==adjustmentHash(ordered(op.basis.items))||adjustmentHash(ordered(currentUnits))!==adjustmentHash(ordered(op.basis.units)))throw new ConflictException('Локальная сборка изменилась во время корректировки. Требуется сверка.');
   const items=[];for(const i of cur.request.items){const quantity=op.rows.filter((r:any)=>r.skuId===i.skuId).reduce((n:number,r:any)=>n+r.after,0);if(quantity){await tx.clientRequestItem.update({where:{id:i.id},data:{quantity}});items.push({...i,quantity});}else await tx.clientRequestItem.delete({where:{id:i.id}});}
   op.state='APPLIED';op.appliedAt=new Date().toISOString();fresh.adjustment=op;await tx.ozonFboShipment.update({where:{requestId:id},data:{directions:op.directions,integration:fresh as any}});if(cur.request.fboAssembly)await tx.fboAssembly.update({where:{requestId:id},data:{compositionHash:composition(items)}});await tx.auditLog.create({data:{userId:user.id,action:'OZON_STOCK_ADJUSTMENT_APPLIED',entity:'ClientRequest',entityId:id,payload:{operationId:opId,rows:op.rows}}});await recordOzonCorrectionEvent(tx,id,cur.request.clientId,user.id,'APPLIED',opId);
  });}return this.view(id,user);
 }
 // FIX: cancel only a conclusively rejected, unchanged external operation; never unlock an uncertain write.
 async cancel(id:string,user:AuthUser){const s=await this.load(this.db,id,user),a=s.integration?.adjustment;if(!active(a))return this.view(id,user);
  if(a.operations.some((o:any)=>!['PENDING','FAILED'].includes(o.state)))throw new ConflictException('Есть неподтверждённая или успешная операция Ozon. Сначала завершите сверку.');
  const fresh=await this.fresh(s,await this.connection(s));if(supplyDifferences(a.basis.directions,fresh).length)throw new ConflictException('Ozon уже изменён: отменять локальную корректировку нельзя.');
  await this.locked(id,user,async(cur,tx)=>{const op=cur.integration.adjustment;if(op?.id!==a.id||!active(op)||op.operations.some((o:any)=>!['PENDING','FAILED'].includes(o.state)))throw new ConflictException('Состояние операции изменилось.');op.state='CANCELLED';await tx.ozonFboShipment.update({where:{requestId:id},data:{integration:cur.integration}});await tx.auditLog.create({data:{userId:user.id,action:'OZON_STOCK_ADJUSTMENT_CANCELLED',entity:'ClientRequest',entityId:id,payload:{operationId:a.id}}});});return this.view(id,user);
 }

}
