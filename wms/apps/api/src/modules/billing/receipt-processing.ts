import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { classifyFbsPrimaryProcessingType } from '../marketplace-connections/fbs-primary-processing';
import { receiptDocuments } from '../warehouse/receipt-channel-policy';

export const receiptProcessingEnabled=()=>process.env.WMS_RECEIPT_PROCESSING_ENABLED==='true';
export type ReceiptProcessingKind='WHITE'|'GRAY';
export type ReceiptProcessingProfile={unitPriceRub:string;taxMode:'INCLUDED'|'ADD_6_PERCENT';includedServiceIds:string[]};
export type ReceiptProcessingSelection={kind:ReceiptProcessingKind;revision:number;changedAt:string;changedByName:string;changedByUserId:string};
export const receiptProcessingPrefix=(clientId:string)=>`receipt.processing.v1:${clientId}:`;
export const receiptProcessingKey=(clientId:string,warehouseId:string,id:string)=>`${receiptProcessingPrefix(clientId)}${warehouseId}:${id}`;
export const receiptPricingKey=(clientId:string)=>`receipt.processing.pricing.v1:${clientId}`;
export function normalizeReceiptProfile(raw:any,allowedIds:string[]):ReceiptProcessingProfile{
 if(!raw||!/^\d{1,8}([.,]\d{1,2})?$/.test(String(raw.unitPriceRub))||!['INCLUDED','ADD_6_PERCENT'].includes(raw.taxMode)||!Array.isArray(raw.includedServiceIds))throw new BadRequestException('Проверьте цену, налог и состав обработки.');
 const ids=raw.includedServiceIds;
 if(ids.length>100||new Set(ids).size!==ids.length||ids.some((id:any)=>typeof id!=='string'||!allowedIds.includes(id)))throw new BadRequestException('Проверьте включённые услуги.');
 return {unitPriceRub:new Prisma.Decimal(String(raw.unitPriceRub).replace(',','.')).toFixed(2),taxMode:raw.taxMode,includedServiceIds:ids};
}
// FIX: exact client/warehouse/receipt identity and optimistic revision; changing type never rewrites invoices.
export async function saveReceiptProcessing(db:Prisma.TransactionClient,input:{clientId:string;warehouseId:string;id:string;kind:ReceiptProcessingKind;revision:number},user:{id:string;name:string}){
 if(!receiptProcessingEnabled())throw new NotFoundException('Виды прихода не включены.');
 if(!['WHITE','GRAY'].includes(input.kind)||!Number.isSafeInteger(input.revision)||input.revision<0)throw new BadRequestException('Выберите один вид прихода и актуальную версию.');
 const key=receiptProcessingKey(input.clientId,input.warehouseId,input.id);
 await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`;
 const doc=(await receiptDocuments(db,input.clientId,input.warehouseId,undefined,undefined,true)).find(r=>r.id===input.id);
 if(!doc)throw new NotFoundException('Приёмка не найдена.');
 const saved=await db.systemSetting.findUnique({where:{key}}),previous=saved?.value as any;
 if((previous?.revision??0)!==input.revision)throw new ConflictException('Вид прихода уже изменён. Обновите список.');
 if(previous?.kind===input.kind)return previous;
 const pricing=(await db.systemSetting.findUnique({where:{key:receiptPricingKey(input.clientId)}}))?.value as any;
 if(!pricing?.[input.kind])throw new BadRequestException('Сначала настройте тарифы серой и белой обработки в биллинге клиента.');
 const next={kind:input.kind,revision:input.revision+1,changedAt:new Date().toISOString(),changedByName:user.name,changedByUserId:user.id};
 await db.systemSetting.upsert({where:{key},create:{key,value:next,updatedByUserId:user.id},update:{value:next,updatedByUserId:user.id}});
 await db.auditLog.create({data:{userId:user.id,action:'RECEIPT_PROCESSING_CHANGED',entity:'Receipt',entityId:input.id,payload:{clientId:input.clientId,warehouseId:input.warehouseId,sourceDocument:doc.sourceDocument,previous:previous??null,next}}});
 return next;
}
export type BoxProcessing={receiptId:string;kind:ReceiptProcessingKind;revision:number;profile:ReceiptProcessingProfile;pricingRevision:number};
// FIX: one batched index lookup; no scan through receipt movement history on billing paths.
export async function receiptProcessingByBoxes(db:Prisma.TransactionClient,clientId:string,codes:string[]):Promise<Map<string,BoxProcessing>>{
 const result=new Map<string,BoxProcessing>();if(!receiptProcessingEnabled()||!codes.length)return result;
 const selections=await db.systemSetting.findMany({where:{key:{startsWith:receiptProcessingPrefix(clientId)}}});if(!selections.length)return result;
 const pricing=(await db.systemSetting.findUnique({where:{key:receiptPricingKey(clientId)}}))?.value as any;
 const boxes=await db.$queryRaw<Array<{id:string;code:string;warehouseId:string|null;receiptAt:Date|null}>>(Prisma.sql`
 SELECT b.id,b.code,b."warehouseId",i."receiptAt" FROM "Box" b
 LEFT JOIN "ReceiptStockIdentity" i ON i."boxId"=b.id
 WHERE b."clientId"=${clientId} AND b.code IN (${Prisma.join([...new Set(codes)])})`);
 const assignments=await db.systemSetting.findMany({where:{key:{in:boxes.map(b=>`receipt.membership.v1:${clientId}:${b.id}`)}}});
 for(const b of boxes){if(!b.warehouseId||!b.receiptAt||classifyFbsPrimaryProcessingType(b.code)==='RETURN')continue;
  const assignment=assignments.find(a=>a.key===`receipt.membership.v1:${clientId}:${b.id}`)?.value as any;
  const document=assignment?.clientId===clientId&&assignment?.warehouseId===b.warehouseId?assignment.series:`SERIES:${b.receiptAt.getUTCFullYear()}:${b.code.replace(/_[0-9]+$/,'')}`;
  const id=createHash('sha256').update(JSON.stringify([clientId,b.warehouseId,document])).digest('hex').slice(0,32);
  const selected=selections.find(s=>s.key===receiptProcessingKey(clientId,b.warehouseId!,id))?.value as any;if(!selected)continue;
  const profile=pricing?.[selected.kind];if(!profile)throw new BadRequestException('Для выбранного вида прихода не настроен тариф клиента.');
  if(result.has(b.code))throw new ConflictException('Неоднозначный короб для расчёта вида прихода.');
  result.set(b.code,{receiptId:id,kind:selected.kind,revision:selected.revision,profile,pricingRevision:pricing.revision});
 }return result;
}
export function receiptProfileAmount(profile:ReceiptProcessingProfile){return new Prisma.Decimal(profile.unitPriceRub).div(profile.taxMode==='ADD_6_PERCENT'?'0.94':'1');}

export type PrimaryReceiptLine={key:string;description:string;quantity:number;unitPriceRub:number;priceBeforeTaxRub:number;taxMode:'INCLUDED'|'ADD_6_PERCENT';serviceId:string|null;serviceCode:string;billingPolicy?:string};
// FIX: base receipt price replaces legacy primary prices; included services are not added again.
export function applyReceiptPrimary(lines:PrimaryReceiptLine[],selection:BoxProcessing|undefined,quantity:number):PrimaryReceiptLine[]{
 if(!selection||lines.some(l=>l.key==='RETURN'&&l.quantity>0))return lines;
 if(!Number.isSafeInteger(quantity)||quantity<1)throw new BadRequestException('Некорректное количество для расчёта приёмки.');
 const base={key:'RECEIPT_'+selection.kind,description:(selection.kind==='WHITE'?'Белая обработка':'Серая обработка'),quantity,unitPriceRub:receiptProfileAmount(selection.profile).toDecimalPlaces(2).toNumber(),priceBeforeTaxRub:Number(selection.profile.unitPriceRub),taxMode:selection.profile.taxMode,serviceId:null,serviceCode:'FBS_PRIMARY_'+selection.kind,billingPolicy:'RECEIPT_PROCESSING_V1'};
 return [base,...lines.filter(l=>!['WHITE','GRAY'].includes(l.key)&&!(l.serviceId&&selection.profile.includedServiceIds.includes(l.serviceId))).map(l=>({...l,billingPolicy:'RECEIPT_PROCESSING_V1'}))];
}
