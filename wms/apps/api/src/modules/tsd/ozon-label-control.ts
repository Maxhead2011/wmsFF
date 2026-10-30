import {ConflictException} from '@nestjs/common';
// FIX: opt-in control applies only to an actual Ozon assembly, not Lamoda/WB.
export const ozonLabelControlEnabled=()=>process.env.WMS_OZON_LABEL_CONTROL_ENABLED==='true';
export function ozonLabelReceipt(link:any,box:{id:string;direction:string|null}){
 const supplyId=box.direction&&link?.mapping?.[box.direction],op=supplyId&&link?.operations?.[supplyId];
 const entries=Object.entries(link?.operations??{}).flatMap(([s,v]:any)=>(v.cargoes??[]).map((c:any)=>({...c,supplyId:s})));
 const matches=entries.filter((c:any)=>c.key===box.id),receipt=matches[0];
 if(!link?.frozenHash||!op||op.state!=='SUCCESS'||!op.labelUrl||matches.length!==1||receipt.supplyId!==supplyId||!/^\d+$/.test(receipt.cargoId)||entries.filter((c:any)=>c.cargoId===receipt.cargoId).length!==1)
  throw new ConflictException('Сначала передайте грузоместа и получите стикеры Ozon. Соответствие короба должно быть однозначным.');
 return {supplyId:supplyId as string,cargoId:receipt.cargoId as string};
}
export function ozonBoxLabelConfirmed(link:any,box:{id:string;direction:string|null;confirmedAt?:unknown}){
 try{const r=ozonLabelReceipt(link,box),check=link.boxLabelChecks?.[box.id];return !!box.confirmedAt&&!!check?.at&&!!check?.userId&&check.cargoId===r.cargoId&&check.supplyId===r.supplyId&&check.frozenHash===link.frozenHash;}catch{return false;}
}
export async function confirmOzonBoxLabel(tx:any,shipment:any,box:any,barcode:string|undefined,userId:string){
 const link=shipment.integration,receipt=ozonLabelReceipt(link,box);
 if(barcode?.trim()!==receipt.cargoId)throw new ConflictException('Стикер Ozon не соответствует этому коробу. Проверьте наклейку и сканируйте правильную пару.');
 const check={...receipt,frozenHash:link.frozenHash,at:new Date().toISOString(),userId};
 await tx.ozonFboShipment.update({where:{requestId:shipment.requestId},data:{integration:{...link,boxLabelChecks:{...link.boxLabelChecks,[box.id]:check}}}});
 await tx.clientRequestEvent.create({data:{requestId:shipment.requestId,clientId:shipment.clientId??shipment.request?.clientId,eventType:'COMMENT',title:'Проверена наклейка Ozon на коробе',body:`Короб ${box.boxCode} · стикер ${receipt.cargoId} · поставка ${receipt.supplyId}`,createdByUserId:userId}});
}
