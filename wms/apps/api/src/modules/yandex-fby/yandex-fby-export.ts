import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { FBY_TEMPLATE } from './yandex-fby-template';

export type FbyOffer = { offerId: string; name: string; barcodes: string[] };
export type FbyExportContext = {
 status:string; phase:string;
 items:{id:string;skuId:string;quantity:number}[];
 units:{id:string;requestItemId:string;skuId:string;barcode:string;state:string;targetBoxId:string|null}[];
 boxes:{boxId:string;closedAt:Date|null;confirmedAt:Date|null}[];
 mappings:{skuId:string;offerId:string}[];
};
type Row = {offerId:string;name:string;barcode:string;quantity:number};
// FIX: readiness is checked again on the server; exported counts come only from physical units.
export function assertActualFby(c:FbyExportContext) {
 if(!['PACKED','DONE'].includes(c.status)||c.phase!=='COMPLETED')throw new BadRequestException('Завершите сборку, упаковку и проверку коробов.');
 const units=c.units.filter(u=>u.state!=='RETURNED');
 if(!units.length||units.length>100000)throw new BadRequestException('Нет упакованных единиц или превышен размер выгрузки.');
 if(c.boxes.some(b=>!b.closedAt||!b.confirmedAt))throw new BadRequestException('Завершите проверку всех коробов.');
 const seen=new Set<string>(), counts=new Map<string,number>();
 for(const u of units){
  const item=c.items.filter(i=>i.id===u.requestItemId&&i.skuId===u.skuId);
  const box=c.boxes.filter(b=>b.boxId===u.targetBoxId);
  if(seen.has(u.id)||item.length!==1||u.state!=='PACKED'||!u.barcode||box.length!==1||!box[0].closedAt||!box[0].confirmedAt)throw new BadRequestException('Проверьте состав и подтверждение упакованных коробов.');
  seen.add(u.id);counts.set(u.requestItemId,(counts.get(u.requestItemId)??0)+1);
 }
 if(c.items.some(i=>!Number.isSafeInteger(i.quantity)||i.quantity<0||(counts.get(i.id)??0)!==i.quantity))throw new BadRequestException('Фактическая упаковка расходится с планом. Сначала согласуйте состав сборки.');
 return units;
}
export function actualFbyRows(c:FbyExportContext, offers:FbyOffer[]):Row[] {
 const units=assertActualFby(c), rows=new Map<string,Row>(), owners=new Map<string,string>();
 const byBarcode=new Map<string,FbyOffer[]>();for(const o of offers)for(const barcode of new Set(o.barcodes))byBarcode.set(barcode,[...(byBarcode.get(barcode)??[]),o]);
 for(const u of units){
  const explicit=[...new Set(c.mappings.filter(m=>m.skuId===u.skuId).map(m=>m.offerId))];
  const matches=(byBarcode.get(u.barcode)??[]).filter(o=>!explicit.length||explicit.length===1&&o.offerId===explicit[0]);
  if(matches.length!==1)throw new BadRequestException(`Не найдено однозначное соответствие Яндекса для ШК ${u.barcode}. Проверьте карточки выбранного кабинета и привязку товара.`);
  const o=matches[0];
  if(!o.offerId||o.offerId.length>80||!o.name||o.name.length>1000)throw new BadRequestException(`Проверьте SKU и название Яндекса для ШК ${u.barcode}.`);
  if(owners.has(o.offerId)&&owners.get(o.offerId)!==u.skuId)throw new BadRequestException(`Несколько складских товаров соответствуют SKU ${o.offerId}. Проверьте соответствия.`);
  owners.set(o.offerId,u.skuId);
  const row=rows.get(o.offerId)??{offerId:o.offerId,name:o.name,barcode:u.barcode,quantity:0};
  // One SKU can have several valid physical barcodes; the template accepts a comma-separated list.
  row.barcode=[...new Set([...row.barcode.split(', '),u.barcode])].sort().join(', ');row.quantity++;rows.set(o.offerId,row);
 }
 return [...rows.values()].sort((a,b)=>a.offerId.localeCompare(b.offerId));
}
export async function actualFbyWorkbook(rows:Row[]):Promise<Buffer> {
 const book=new ExcelJS.Workbook();
 await book.xlsx.load(Buffer.from(FBY_TEMPLATE,'base64') as any);
 book.creator='LOGOFF WMS';book.lastModifiedBy='LOGOFF WMS';
 const sheet=book.getWorksheet('Поставка')!;
 for(let i=2;i<=sheet.rowCount;i++)sheet.getRow(i).values=[];
 rows.forEach((r,i)=>{const row=sheet.getRow(i+2);row.values=[r.offerId,r.name,r.barcode,r.quantity];for(const n of [1,2,3])row.getCell(n).numFmt='@';row.getCell(4).numFmt='0';});
 return Buffer.from(await book.xlsx.writeBuffer());
}
