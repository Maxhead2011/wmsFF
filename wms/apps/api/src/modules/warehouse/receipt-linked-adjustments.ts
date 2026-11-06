import {ConflictException} from '@nestjs/common';
import type {Prisma} from '@prisma/client';
type Receipt={clientId:string;warehouseId:string;sourceDocument:string;received:number;recoveryFileVerified?:boolean;boxes:Array<{id:string;receiptDocument?:string;linkedAdjustmentIds?:string[]}>};
// FIX: explicit, audited movement links affect reporting only; never create a second stock receipt.
export async function applyReceiptLinkedAdjustments(db:Prisma.TransactionClient,clientId:string,warehouseId:string,docs:Receipt[]){
 if(process.env.WMS_RECEIPT_LINKED_ADJUSTMENTS_ENABLED!=='true'||!docs.length)return;
 const settings=await db.systemSetting.findMany({where:{key:{startsWith:`receipt.adjustments.v1:${clientId}:${warehouseId}:`}},select:{value:true}});
 const seen=new Set<string>();
 for(const setting of settings){
  const link=setting.value as any;
  if(link?.clientId!==clientId||link?.warehouseId!==warehouseId)continue;
  const doc=docs.find(d=>d.sourceDocument===link.sourceDocument);if(!doc)continue;
  if(doc.recoveryFileVerified)throw new ConflictException('Приёмка уже восстановлена по файлу. Требуется сверка состава перед актуализацией.');
  if(!Array.isArray(link.movements)||link.movements.length>10000)throw new ConflictException('Некорректная привязка актуализации приёмки.');
  const ids=link.movements.map((m:any)=>m.id);
  if(ids.some((id:any)=>typeof id!=='string'||seen.has(id))||new Set(ids).size!==ids.length)throw new ConflictException('Повторная привязка корректировки приёмки.');
  const rows=await db.stockMovement.findMany({where:{id:{in:ids},clientId,warehouseId,type:'INVENTORY_ADJUSTMENT'}});
  const byId=new Map(rows.map(m=>[m.id,m]));let delta=0;
  for(const expected of link.movements){
   const row=byId.get(expected.id),box=doc.boxes.find(b=>b.id===expected.boxId);
   if(!row||!box||box.receiptDocument!==expected.receiptDocument||row.type!=='INVENTORY_ADJUSTMENT'||row.clientId!==clientId||row.warehouseId!==warehouseId||
    row.boxId!==expected.boxId||row.skuId!==expected.skuId||row.quantity!==expected.quantity||row.sourceDocument!==expected.sourceDocument||
    new Date(row.createdAt).toISOString()!==new Date(expected.createdAt).toISOString())throw new ConflictException('Данные актуализации изменились. Нужна повторная сверка приёмки.');
   if(!Number.isSafeInteger(row.quantity))throw new ConflictException('Некорректное количество актуализации.');
   (box.linkedAdjustmentIds??=[]).push(row.id);seen.add(row.id);delta+=row.quantity;
  }
  if(doc.received+delta<0)throw new ConflictException('Актуализация делает приёмку отрицательной.');
  doc.received+=delta;
 }
}
