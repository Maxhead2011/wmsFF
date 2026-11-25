import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import type { MarketplaceConnectionsService } from './marketplace-connections.service';
import type { PreviewFbsReshipmentDto, CreateFbsReshipmentDto } from './dto/fbs-reshipment.dto';
import { reshipmentHash } from './fbs-reshipment';

type DB = Pick<Prisma.TransactionClient,'fbsOrderRequestLink'|'fbsTsdAssembly'|'sku'|'fbsSupplyPlan'>;
type Gateway = Pick<MarketplaceConnectionsService,'readReshipmentWbSupply'|'readReshipmentWbStatuses'>;
const json=(v:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v));
function identity(dto:PreviewFbsReshipmentDto,warehouseId:string){
 if(dto.mode!=='NEW_ITEM'||!dto.existingSupplyId?.trim())throw new BadRequestException('Существующая поставка без сканов поддерживает только новую физическую сборку.');
 return {supplyId:dto.existingSupplyId.trim(),connectionId:dto.orders[0].connectionId,ids:dto.orders.map(o=>o.id).sort(),
  fingerprint:reshipmentHash(['EXISTING_SUPPLY_NEW_ITEM',dto.clientId,warehouseId,dto.orders[0].connectionId,dto.existingSupplyId.trim()])};
}
async function live(wb:Gateway,dto:PreviewFbsReshipmentDto,warehouseId:string,user:AuthUser){
 const key=identity(dto,warehouseId),supply=await wb.readReshipmentWbSupply(dto.clientId,key.connectionId,key.supplyId,user);
 if(supply.done||supply.id!==key.supplyId||reshipmentHash([...supply.orderIds].sort())!==reshipmentHash(key.ids))throw new ConflictException('WB: поставка закрыта или её полный состав изменился.');
 const statuses=await wb.readReshipmentWbStatuses(dto.clientId,key.connectionId,key.ids,user);
 for(const id of key.ids){const s=statuses.get(id);if(!s||s.wbStatus!=='waiting'||!['confirm','complete'].includes(s.supplierStatus))throw new ConflictException(`Заказ ${id}: WB не подтверждает повторную сборку.`);}
 return {key,statuses};
}
async function local(db:DB,dto:PreviewFbsReshipmentDto,warehouseId:string){
 const key=identity(dto,warehouseId),where={clientId:dto.clientId,marketplace:'WILDBERRIES' as const,connectionId:key.connectionId,orderId:{in:key.ids}};
 const links=await db.fbsOrderRequestLink.findMany({where,include:{request:true},orderBy:{orderId:'asc'}});
 if(links.length!==key.ids.length||links.some(l=>l.request.warehouseId!==warehouseId||l.request.clientId!==dto.clientId||l.request.status!=='DONE'||l.syncStatus!=='ACTIVE'||l.lastItemCount!==1||!l.lastSkuId||!l.lastSupplyId||l.lastSupplyId===key.supplyId))throw new ConflictException('Нужны завершённые исходные заявки этого филиала с поштучными заказами и прежней поставкой.');
 if(await db.fbsTsdAssembly.count({where}))throw new ConflictException('Есть задания ТСД: используйте сценарий с сохранением предыдущей физической попытки.');
 const skus=await db.sku.findMany({where:{clientId:dto.clientId,id:{in:links.map(l=>l.lastSkuId!)}},include:{barcodes:true}});
 if(links.some(l=>!skus.some(s=>s.id===l.lastSkuId)))throw new ConflictException('Не найден товар исходного заказа.');
 const plans=await db.fbsSupplyPlan.findMany({where:{clientId:dto.clientId,marketplace:'WILDBERRIES',connectionId:key.connectionId,supplyId:{in:[...new Set(links.map(l=>l.lastSupplyId!))]}}});
 const deliveries=links.map(l=>{const p=plans.find(p=>p.supplyId===l.lastSupplyId);if(!p||!['PICKUP_POINT','VNUKOVO_SORTING_CENTER'].includes(p.deliveryDestination))throw new ConflictException('Не определено назначение исходной поставки.');return {deliveryDestination:p.deliveryDestination,marketplaceWarehouseId:p.marketplaceWarehouseId,marketplaceWarehouseName:p.marketplaceWarehouseName,destinationOfficeId:p.destinationOfficeId,destinationOfficeName:p.destinationOfficeName,itemsPerCargoPlace:p.itemsPerCargoPlace};});
 if(new Set(deliveries.map(reshipmentHash)).size!==1)throw new ConflictException('Разные назначения исходных поставок требуют сверки.');
 const target=await db.fbsSupplyPlan.findFirst({where:{marketplace:'WILDBERRIES',connectionId:key.connectionId,supplyId:key.supplyId}});
 if(target)throw new ConflictException('Новая поставка уже зарегистрирована в WMS; требуется сверка.');
 const previewToken=reshipmentHash([key,links.map(l=>[l.id,l.requestId,l.request.updatedAt,l.updatedAt,l.lastSkuId,l.lastItemCount,l.lastSupplyId]),skus.map(s=>[s.id,s.updatedAt,s.needsChestnyZnak,s.barcodes]),deliveries]);
 return {key,links,skus,delivery:deliveries[0],previewToken};
}
export async function existingSupplyPreview(db:PrismaService,wb:Gateway,dto:PreviewFbsReshipmentDto,warehouseId:string,user:AuthUser){
 await live(wb,dto,warehouseId,user);const plan=await local(db,dto,warehouseId);
 return {previewToken:plan.previewToken,orderCount:plan.links.length,additionalUnits:plan.links.length,supplyId:plan.key.supplyId,
  orders:plan.links.map(l=>({id:l.orderId,connectionId:l.connectionId,sourceRequestNumber:l.request.number,skuId:l.lastSkuId})),
  warning:'Новая физическая сборка без прежних сканов ТСД. Списание только при сканировании; прежние заявки и начисления сохраняются.'};
}
// FIX: a full existing-supply import is local-only, serializable and idempotent. Never synthesize past scans.
export async function createExistingSupplyReshipment(db:PrismaService,wb:Gateway,dto:CreateFbsReshipmentDto,warehouseId:string,user:AuthUser){
 const key=identity(dto,warehouseId);
 const result=async(tx:Prisma.TransactionClient,run:{id:string;requestId:string|null;previewToken:string;snapshot:Prisma.JsonValue})=>{
  const snapshot=run.snapshot as {orderIds?:string[]};
  if(run.previewToken!==dto.previewToken||reshipmentHash(snapshot.orderIds)!==reshipmentHash(key.ids)||!run.requestId)throw new ConflictException('Поставка уже относится к другой операции.');
  const request=await tx.clientRequest.findUniqueOrThrow({where:{id:run.requestId},select:{id:true,number:true,status:true}});
  return {runId:run.id,status:'CREATED',mode:'NEW_ITEM',supplyId:key.supplyId,requestId:request.id,requestNumber:request.number,requestStatus:request.status};
 };
 const old=await db.fbsReshipmentRun.findUnique({where:{fingerprint:key.fingerprint}});
 if(old)return result(db,old);
 const remote=await live(wb,dto,warehouseId,user);
 const plan=await local(db,dto,warehouseId);if(plan.previewToken!==dto.previewToken)throw new ConflictException('Данные изменились после предварительной проверки.');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key.fingerprint}))::text`;
  const old=await tx.fbsReshipmentRun.findUnique({where:{fingerprint:key.fingerprint}});if(old)return result(tx,old);
  const checked=await local(tx,dto,warehouseId);if(checked.previewToken!==dto.previewToken)throw new ConflictException('Заказы изменились во время создания заявки.');
  const runId=randomUUID(),groups=new Map<string,{skuId:string;name:string;quantity:number;comment:string}>();
  for(const l of checked.links){const sku=checked.skus.find(s=>s.id===l.lastSkuId)!;const g=groups.get(sku.id);if(g){g.quantity++;g.comment+=`, ${l.orderId}`;}else groups.set(sku.id,{skuId:sku.id,name:sku.name,quantity:1,comment:`Повторная сборка FBS: ${l.orderId}`});}
  const sourceNumbers=[...new Set(checked.links.map(l=>l.request.number))];
  const request=await tx.clientRequest.create({data:{clientId:dto.clientId,warehouseId,type:'OUTBOUND',status:'IN_WORK',priority:'HIGH',title:`Повторная сборка WB — ${key.ids.length} заказов`,destinationCity:'Повторная отгрузка WB',comment:`Поставка WB: ${key.supplyId}. Исходные заявки: ${sourceNumbers.join(', ')}. НОВЫЕ ЕДИНИЦЫ: списание только при сканировании. Прежние сканы ТСД отсутствуют; история и начисления сохранены.`,createdByUserId:user.id,items:{create:[...groups.values()] }},include:{items:true}});
  await tx.fbsReshipmentRun.create({data:{id:runId,fingerprint:key.fingerprint,previewToken:dto.previewToken,clientId:dto.clientId,warehouseId,connectionId:key.connectionId,mode:'NEW_ITEM',status:'CREATED',phase:'COMPLETED',supplyName:`WMS-EXISTING-${runId}`,supplyId:key.supplyId,requestId:request.id,createdByUserId:user.id,sourceRequestIds:[...new Set(checked.links.map(l=>l.requestId))],snapshot:json({kind:'EXISTING_SUPPLY_NO_PRIOR_SCAN',orderIds:key.ids,links:checked.links,delivery:checked.delivery,physicalStockMutationPerformed:false,additionalStockConsumptionConfirmed:true})}});
  await tx.fbsReshipmentClaim.createMany({data:checked.links.map(l=>({runId,connectionId:key.connectionId,orderId:l.orderId,cycle:reshipmentHash(['NO_PRIOR_SCAN',l.id,l.requestId])}))});
  await tx.fbsSupplyPlan.create({data:{...checked.delivery,clientId:dto.clientId,marketplace:'WILDBERRIES',connectionId:key.connectionId,supplyId:key.supplyId,orderIds:key.ids,cargoPlaceCount:0,cargoPlaceIds:[],cargoPlaceBarcodes:{},createdByUserId:user.id}});
  for(const l of checked.links){const sku=checked.skus.find(s=>s.id===l.lastSkuId)!,item=request.items.find(i=>i.skuId===sku.id)!,status=remote.statuses.get(l.orderId)!;
   await tx.fbsTsdAssembly.create({data:{clientId:dto.clientId,marketplace:'WILDBERRIES',connectionId:key.connectionId,orderId:l.orderId,supplyId:key.supplyId,requestId:request.id,requestItemId:item.id,skuId:sku.id,stockWarehouseId:warehouseId,productName:sku.name,article:sku.article,barcodes:json(sku.barcodes.map(b=>b.value)),storageBoxes:[],itemCount:1,requiresKiz:sku.needsChestnyZnak,wbMetaStatus:sku.needsChestnyZnak?'PENDING':'NOT_REQUIRED',status:'WAITING_STOCK',deviceCode:'AUTO'}});
   const changed=await tx.fbsOrderRequestLink.updateMany({where:{id:l.id,updatedAt:l.updatedAt,requestId:l.requestId},data:{requestId:request.id,lastSupplyId:key.supplyId,lastCategory:'active',lastSupplierStatus:status.supplierStatus,lastWbStatus:status.wbStatus,lastSeenAt:new Date()}});if(changed.count!==1)throw new ConflictException('Заказ уже изменён другой операцией.');
  }
  for(const sourceId of new Set(checked.links.map(l=>l.requestId)))await tx.clientRequestEvent.create({data:{requestId:sourceId,clientId:dto.clientId,eventType:'COMMENT',title:'Создана повторная сборка',body:`Новая заявка №${request.number}, поставка ${key.supplyId}. История и начисления первой отгрузки сохранены.`,createdByUserId:user.id}});
  await tx.clientRequestEvent.create({data:{requestId:request.id,clientId:dto.clientId,eventType:'CREATED',title:'Повторная сборка новых единиц',body:`WB ${key.supplyId}; исходные заявки: ${sourceNumbers.join(', ')}.`,statusTo:'IN_WORK',createdByUserId:user.id}});
  await tx.auditLog.create({data:{userId:user.id,action:'FBS_RESHIPMENT_CREATED',entity:'ClientRequest',entityId:request.id,payload:{runId,supplyId:key.supplyId,mode:'NEW_ITEM',orderIds:key.ids,physicalStockMutationPerformed:false,additionalStockConsumptionConfirmed:true}}});
  return {runId,status:'CREATED',mode:'NEW_ITEM',supplyId:key.supplyId,requestId:request.id,requestNumber:request.number,requestStatus:request.status};
 },{isolationLevel:'Serializable',timeout:30_000});
}
