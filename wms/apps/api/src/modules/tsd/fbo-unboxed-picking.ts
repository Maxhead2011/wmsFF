import {BadRequestException,ConflictException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {wbReservationQuantities} from '../../common/stock/wb-order-stock-lifecycle';

// FIX: storage mode changes only the source of picking, never outbound packing.
export const unboxedFboEnabled=()=>process.env.WMS_FBO_UNBOXED_PICK_ENABLED==='true';
export async function unboxedFree(tx:Prisma.TransactionClient,r:{id:string;clientId:string;warehouseId:string|null},skuIds:string[]){
 if(!r.warehouseId)throw new BadRequestException('Укажите филиал заявки.');
 const rows=await tx.stockBalance.findMany({where:{clientId:r.clientId,warehouseId:r.warehouseId,skuId:{in:skuIds},boxId:null,palletId:null,status:'AVAILABLE'}});
 const reserved=await wbReservationQuantities(tx,r.clientId,skuIds,r.warehouseId,r.id);
 return new Map(skuIds.map(id=>[id,Math.max(0,rows.filter(b=>b.skuId===id).reduce((n,b)=>n+b.quantity,0)-(reserved.get(id)??0))]));
}
// Runs within the normal serializable request/action transaction and shares its replay guard.
export async function pickUnboxed(tx:Prisma.TransactionClient,r:any,lines:any[],dto:any,key:string,user:any,move:Function,exactMark:Function){
 if(!unboxedFboEnabled()||!r.client.storesWithoutBoxes||dto.action!=='PICK_UNIT'||dto.sourceBoxCode||dto.palletCode)
  throw new BadRequestException('Для хранения без коробов сканируйте только ШК товара.');
 const line=lines.find(l=>l.remaining>0&&(l.barcode===dto.barcode||l.sku.barcodes.some((b:any)=>b.value===dto.barcode)));
 if(!line)throw new BadRequestException('Этот товар не требуется или уже полностью отобран.');
 const free=await unboxedFree(tx,r,[line.skuId]);
 if((free.get(line.skuId)??0)<1)throw new ConflictException('Нет свободного остатка: товар отсутствует или зарезервирован другой заявкой.');
 const marked=(line.sku.needsChestnyZnak&&!line.sku.isUnmarked)||!!await tx.productMark.findFirst({where:{clientId:r.clientId,skuId:line.skuId,boxId:null,status:'AVAILABLE',stockMovement:{warehouseId:r.warehouseId}}});
 if(marked&&!dto.kiz)throw new BadRequestException('После ШК отсканируйте КИЗ.');
 const mark=dto.kiz?await exactMark(tx,dto.kiz):null;
 if(mark){
  const evidence=mark.stockMovementId?await tx.stockMovement.findUnique({where:{id:mark.stockMovementId}}):null;
  if(mark.clientId!==r.clientId||mark.skuId!==line.skuId||mark.boxId!==null||mark.status!=='AVAILABLE'||evidence?.warehouseId!==r.warehouseId)
   throw new ConflictException('КИЗ не доступен в общем остатке выбранного филиала.');
 }
 const holding=await tx.box.upsert({where:{code:`FBO-PICK-${r.id}`},create:{code:`FBO-PICK-${r.id}`,clientId:r.clientId,warehouseId:r.warehouseId,status:'fbo-picking'},update:{}});
 const unitId=randomUUID(),movement=await move(tx,r,line.skuId,null,holding.id,'AVAILABLE','PACKING',1,`${key}:${unitId}`,user);
 if(mark){const changed=await tx.productMark.updateMany({where:{id:mark.id,boxId:null,status:'AVAILABLE'},data:{boxId:holding.id,status:'PACKING',stockMovementId:movement.id}});if(changed.count!==1)throw new ConflictException('КИЗ уже отобран.');}
 // Empty source fields explicitly mean no physical source box; neither is a Box foreign key.
 await tx.fboAssemblyUnit.create({data:{id:unitId,requestId:r.id,requestItemId:line.id,skuId:line.skuId,barcode:line.barcode,sourceBoxId:'',sourceBoxCode:'',wholeBox:false,markId:mark?.id,activeMarkId:mark?.id,kiz:mark?.value,pickedByUserId:user.id}});
}
