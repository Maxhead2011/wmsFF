import { ConflictException, ForbiddenException } from '@nestjs/common';
import { clientKizIdentity, clientKizGuardEnabled, lockClientKiz } from '../../common/kiz-client-registry';
import { assertClientKizUse, clientPhysicalMark, refreshClientKizClaim, assertClientRequestKizShipment, finishClientRequestKizShipment } from '../../common/kiz-client-review';
import { captureShippedKizHistory } from '../../common/shipment-history/shipped-kiz-history';
import { ozonUnitMarksEnabled } from '../../common/ozon-unit-marks';
import { wbReservationQuantities } from '../../common/stock/wb-order-stock-lifecycle';
import { OzonPickState, ozonPickLinesEnabled, ozonPostingProducts, readOzonPickState, writeOzonPickState } from './ozon-fbs-pick-lines';

export type OzonRecoveryUnit = { productId: number; skuId: string; barcode: string; kiz: string };
export type OzonRecoveryPlanInput = {
 clientId: string; orderId: string; posting: any; skus: any[]; units: OzonRecoveryUnit[];
 shipped?: boolean;
};
// FIX: pure preview of confirmed physical packing; no marketplace or inventory writes.
export function planOzonMarkedRecovery(input: OzonRecoveryPlanInput) {
 const fail=()=>{throw new ConflictException('Состав, КИЗ или привязка товара Ozon не совпадают. Восстановление остановлено.');};
 if(!input.clientId || !input.orderId || input.posting?.posting_number!==input.orderId ||
    !(input.shipped ? ['delivering','delivered'] : ['awaiting_deliver']).includes(input.posting.status) || !input.units.length) return fail();
 const products=ozonPostingProducts(input.posting), seen=new Set<string>();
 for(const unit of input.units){
  const key=clientKizIdentity(unit.kiz);
  if(!key || seen.has(key) || !/^\d{13,14}$/.test(unit.barcode) || key.slice(2,16)!==unit.barcode.padStart(14,'0')) return fail();
  seen.add(key);
  if(!products.some(p=>p.productId===unit.productId)) return fail();
 }
 return products.map(product=>{
  const units=input.units.filter(u=>u.productId===product.productId);
  if(units.length!==product.quantity || new Set(units.map(u=>u.skuId)).size!==1) return fail();
  const candidates=input.skus.filter(s=>s.id===units[0].skuId&&s.clientId===input.clientId);
  if(candidates.length!==1) return fail();
  const sku=candidates[0], barcodes=(sku.barcodes??[]).map((b:any)=>String(b.value));
  const identifiers=String(sku.marketplaceProductId??'').split(':');
  if(!barcodes.includes(product.offerId)&&sku.marketplaceOfferId!==product.offerId&&
     !identifiers.includes(product.offerId)&&!identifiers.includes(String(product.productId))) return fail();
  if(units.some(u=>!barcodes.some((b:string)=>/^\d{13,14}$/.test(b)&&b.padStart(14,'0')===u.barcode.padStart(14,'0')))) return fail();
  return {...product,skuId:sku.id,name:sku.name??'',units};
 });
}

export type OzonPackedRecoveryInput = {
 taskId: string; operationKey: string; reason: string; units: OzonRecoveryUnit[];
 mode?: 'PACKED' | 'SHIPPED';
};
const recoverySignature = (units: OzonRecoveryUnit[]) => JSON.stringify(units.map(u =>
 [u.productId,u.skuId,u.barcode,clientKizIdentity(u.kiz)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));

// FIX: administrative recovery of confirmed packing or handover of boxless stock.
// No marketplace writes; only SHIPPED mode debits inventory, preserving the existing DONE status.
// Caller is the server service (not an HTTP-supplied posting or user object).
export async function recoverOzonMarkedPacking(service: any, input: OzonPackedRecoveryInput, user: any) {
 const shipped=input.mode==='SHIPPED';
 if(input.mode && !['PACKED','SHIPPED'].includes(input.mode)) throw new ConflictException('Неизвестный режим восстановления.');
 if(!ozonUnitMarksEnabled() || !ozonPickLinesEnabled() || !clientKizGuardEnabled())
  throw new ForbiddenException('Поштучный учёт КИЗ Ozon не включён.');
 if(!user?.id || !user.roleCodes?.some((r:string)=>['ADMIN','OWNER'].includes(r)))
  throw new ForbiddenException('Восстановление доступно администратору или собственнику.');
 if(!input.taskId || !input.operationKey?.trim() || !input.reason?.trim() || !input.units?.length)
  throw new ConflictException('Нужны задание, основание и полный состав КИЗ.');
 const original=await service.prisma.fbsTsdAssembly.findUnique({where:{id:input.taskId}});
 if(!original || original.marketplace!=='OZON') throw new ConflictException('Задание Ozon не найдено.');
 await service.clientScopes.requireClientAccess(user,original.clientId,'write');
 // Existing reader validates the connection belongs to this client; no marketplace mutation.
 const posting=await service.readOzonFbsPickPosting(original);
 return service.prisma.$transaction(async(tx:any)=>{
  await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${original.requestId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "FbsTsdAssembly" WHERE id=${original.id} FOR UPDATE`;
  const task=await tx.fbsTsdAssembly.findUnique({where:{id:original.id}});
  const request=await tx.clientRequest.findUnique({where:{id:original.requestId},include:{items:true}});
  if(!task || !request || task.requestId!==request.id || task.clientId!==original.clientId ||
   task.connectionId!==original.connectionId || task.orderId!==original.orderId || request.clientId!==task.clientId ||
   request.type!=='OUTBOUND' || !request.warehouseId || request.warehouseId!==user.activeWarehouseId ||
   (shipped ? request.status!=='DONE' : ['DONE','CANCELLED','REJECTED'].includes(request.status))) throw new ConflictException('Заявка или филиал изменились.');
  const saved=await readOzonPickState(tx,task.id);
  if(saved?.recovery){
   const prior=saved.lines.flatMap(l=>l.picks.map(p=>({productId:l.productId,skuId:l.skuId,barcode:p.barcode,kiz:p.kiz!})));
   if(saved.recovery.operationKey!==input.operationKey || recoverySignature(prior)!==recoverySignature(input.units) ||
    task.status!=='COMPLETED' || saved.submission!=='COMPLETED' || request.status!==(shipped?'DONE':'PACKED') ||
    (saved.recovery.mode??'PACKED')!==(input.mode??'PACKED'))
    throw new ConflictException('Восстановление уже выполнено с другим составом или состояние изменилось.');
   return {status:'ALREADY_APPLIED',requestId:request.id,units:prior.length};
  }
  if(saved || task.kiz || task.boxId || task.reservedBoxId || task.relabelRequired ||
   task.status!=='IN_PROGRESS' || task.completedAt || task.marketplaceSubmittedAt)
   throw new ConflictException('Есть выполненные операции: требуется отдельная сверка.');
  const siblings=await tx.fbsTsdAssembly.findMany({where:{requestId:request.id}});
  const links=await tx.fbsOrderRequestLink.findMany({where:{requestId:request.id}});
  if(siblings.length!==1 || links.length!==1 || links[0].orderId!==task.orderId || links[0].connectionId!==task.connectionId)
   throw new ConflictException('Восстановление допускается только для заявки на один заказ.');
  if(await tx.stockMovement.findFirst({where:{sourceDocument:request.id}}) ||
   await tx.clientRequestBoxSelection.findFirst({where:{requestItem:{requestId:request.id}}}) ||
   await tx.clientRequestPackage.findFirst({where:{requestId:request.id}}))
   throw new ConflictException('Есть складские операции или грузоместа. Требуется сверка.');
  if(await tx.inventorySession.findFirst({where:{type:'FULL',status:{in:['ACTIVE','REVIEW']}}}))
   throw new ConflictException('Выполняется полная инвентаризация.');
  const skus=await tx.sku.findMany({where:{clientId:task.clientId,id:{in:input.units.map(u=>u.skuId)}},include:{barcodes:true}});
  const plan=planOzonMarkedRecovery({clientId:task.clientId,orderId:task.orderId,posting,skus,units:input.units,shipped});
  if(plan.reduce((n,l)=>n+l.quantity,0)!==task.itemCount || new Set(plan.map(l=>l.skuId)).size!==plan.length)
   throw new ConflictException('Количество задания или привязки товаров требуют сверки.');
  // Retain the original first item id; do not remove rows referenced by existing operations.
  if(request.items.length!==1 || request.items[0].id!==task.requestItemId ||
   request.items[0].skuId!==task.skuId || request.items[0].quantity!==task.itemCount || plan[0].skuId!==task.skuId)
   throw new ConflictException('Исходный состав заявки изменился.');
  for(const key of input.units.map(u=>clientKizIdentity(u.kiz)).sort()) await lockClientKiz(tx,task.clientId,key);
  const reserved=await wbReservationQuantities(tx,task.clientId,plan.map(l=>l.skuId),request.warehouseId,request.id);
  for(const line of plan){
   const rows=await tx.stockBalance.findMany({where:{clientId:task.clientId,warehouseId:request.warehouseId,skuId:line.skuId,status:'AVAILABLE'}});
   const available=rows.reduce((n:number,r:any)=>n+r.quantity,0)-(reserved.get(line.skuId)??0);
   const boxless=rows.filter((r:any)=>!r.boxId&&!r.palletId).reduce((n:number,r:any)=>n+r.quantity,0);
   if(Math.min(available,boxless)<line.quantity) throw new ConflictException('Не хватает свободного бескоробочного остатка.');
  }
  const now=new Date(), state:OzonPickState={version:1,unitMarksVersion:1,lines:[],source:null,
   submission:'COMPLETED',legacyScansDiscarded:false,
   recovery:{operationKey:input.operationKey,actorId:user.id,recordedAt:now.toISOString(),reason:input.reason.trim(),mode:input.mode??'PACKED'}};
  for(const [index,line] of plan.entries()){
   const data={skuId:line.skuId,barcode:line.units[0].barcode,name:line.name,quantity:line.quantity};
   const item=index===0?await tx.clientRequestItem.update({where:{id:task.requestItemId},data})
    :await tx.clientRequestItem.create({data:{requestId:request.id,...data}});
   const {units:lineUnits,...product}=line;
   state.lines.push({...product,article:line.offerId,barcodes:lineUnits.map(u=>u.barcode),requestItemId:item.id,
    picks:line.units.map(u=>({barcode:u.barcode,kiz:u.kiz,boxId:null,boxCode:'БЕЗ КОРОБА',actorId:user.id,at:now.toISOString()}))});
  }
  // Context exists inside the same transaction before claiming the second SKU's mark.
  await writeOzonPickState(tx,task.id,state);
  for(const line of state.lines)for(const pick of line.picks){
   const use={scope:'FBS' as const,clientId:task.clientId,warehouseId:request.warehouseId,requestId:request.id,
    taskId:task.id,skuId:line.skuId,boxId:null,kiz:pick.kiz!};
   const mark=await clientPhysicalMark(tx,task.clientId,pick.kiz!);
   if(mark&&(mark.skuId!==line.skuId || mark.boxId || mark.status!=='AVAILABLE'))
    throw new ConflictException('КИЗ относится к другому товару или месту хранения.');
   if(await assertClientKizUse(tx,use,user)!=='ALLOW') throw new ConflictException('КИЗ требует разбора.');
   const stored=mark??await tx.productMark.create({data:{clientId:task.clientId,skuId:line.skuId,value:pick.kiz,
    sourceDocument:`FBS Ozon, заказ ${task.orderId}: административное восстановление`,status:'AVAILABLE'}});
   pick.markId=stored.id;
   await refreshClientKizClaim(tx,use,stored);
  }
  await writeOzonPickState(tx,task.id,state);
  await tx.fbsTsdAssembly.update({where:{id:task.id},data:{status:'COMPLETED',completedAt:now,
   stockWarehouseId:request.warehouseId,sourceBoxPending:false,errorMessage:null}});
  // FIX: restore already handed-over stock atomically; never reopen a DONE request.
  if(shipped){
   await assertClientRequestKizShipment(tx,request,user);
   for(const line of state.lines){
    let remaining=line.quantity;
    const balances=await tx.stockBalance.findMany({where:{clientId:task.clientId,warehouseId:request.warehouseId,
     skuId:line.skuId,status:'AVAILABLE',boxId:null,palletId:null,quantity:{gt:0}},orderBy:{id:'asc'}});
    for(const balance of balances){
     if(!remaining)break;
     const quantity=Math.min(remaining,balance.quantity);
     const changed=await tx.stockBalance.updateMany({where:{id:balance.id,quantity:{gte:quantity}},data:{quantity:{decrement:quantity}}});
     if(changed.count!==1)throw new ConflictException('Остаток изменился. Повторите сверку.');
     const movement=await tx.stockMovement.create({data:{clientId:task.clientId,warehouseId:request.warehouseId,skuId:line.skuId,
      type:'SHIP',status:'SHIPPING',quantity:-quantity,sourceDocument:request.id,
      idempotencyKey:`ozon-recovery:${request.id}:${line.requestItemId}:${balance.id}`,
      comment:`Восстановление отгрузки Ozon ${task.orderId}: ${input.reason.trim()}`}});
     const offset=line.quantity-remaining;
     for(const pick of line.picks.slice(offset,offset+quantity))await tx.productMark.update({where:{id:pick.markId!},
      data:{status:'SHIPPING',boxId:null,stockMovementId:movement.id}});
     remaining-=quantity;
    }
    if(remaining)throw new ConflictException('Не хватает остатка для восстановления отгрузки.');
   }
   await captureShippedKizHistory(tx,request.id,request.updatedAt);
   await finishClientRequestKizShipment(tx,request);
  }else await tx.clientRequest.update({where:{id:request.id},data:{status:'PACKED'}});
  await tx.clientRequestEvent.create({data:{requestId:request.id,clientId:task.clientId,eventType:'STATUS_CHANGED',
   title:shipped?'Восстановлен учёт отгрузки Ozon':'Восстановлена подтверждённая упаковка Ozon',body:input.reason.trim(),statusFrom:request.status,statusTo:shipped?'DONE':'PACKED',createdByUserId:user.id}});
  await tx.auditLog.create({data:{userId:user.id,entity:'FbsTsdAssembly',entityId:task.id,action:shipped?'OZON_MARKED_SHIPMENT_RECOVERED':'OZON_MARKED_PACKING_RECOVERED',
   payload:JSON.parse(JSON.stringify({operationKey:input.operationKey,reason:input.reason.trim(),beforeItems:request.items,state}))}});
  return {status:'APPLIED',requestId:request.id,units:input.units.length};
 },{isolationLevel:'Serializable',timeout:30000});
}
