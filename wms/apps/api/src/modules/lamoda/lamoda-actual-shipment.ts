import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { physicalKizIdentity } from '../../common/kiz-physical-identity';
import { prepareLamodaCommand } from './lamoda-commands';
import { text } from './lamoda-policy';

type Unit = { id:string; skuId:string; state:string; targetBoxId:string|null; kiz:string|null; requiresKiz:boolean };
type Identity = { skuId:string; externalSku:string; ean:string; priceMinor:number };
export type ActualShipmentInput = { externalShipmentId:string; warehouseCode:string; plannedDate:string;
 units:Unit[]; boxes:{boxId:string;closedAt:Date|null;confirmedAt:Date|null}[]; identities:Identity[] };
type Item = {externalSku:string;quantity:number;price:{amount:number;currency:'RUB'};ean:string;markingCodes?:string[]};
type DraftItem=Omit<Item,'price'>&{price?:Item['price']};
type CompositionInput=Pick<ActualShipmentInput,'units'|'boxes'>&{identities:(Omit<Identity,'priceMinor'>&{priceMinor?:number})[]};
// FIX: one deterministic payload for Excel and API, from verified actual units only.
export function buildActualLamodaShipment(input:ActualShipmentInput) {
 const externalShipmentId=text(input.externalShipmentId,'Номер поставки / УПД');
 if(!['BYKOVO','SOFINO'].includes(input.warehouseCode))throw new BadRequestException('Выберите склад Lamoda.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.plannedDate)||!Number.isFinite(Date.parse(input.plannedDate))||new Date(input.plannedDate).toISOString().slice(0,10)!==input.plannedDate)throw new BadRequestException('Некорректная дата поставки.');
 const body={externalShipmentId,warehouseCode:input.warehouseCode,plannedDate:input.plannedDate,items:actualItems(input,true) as Item[]};
 prepareLamodaCommand({kind:'FBO_CREATE',body},'validation');
 return body;
}
// FIX: only the downloadable draft omits commercial fields; actual-unit checks are shared.
export function buildActualLamodaTemplate(input:CompositionInput):Buffer {
 return actualLamodaWorkbook({items:actualItems(input,false)});
}
function actualItems(input:CompositionInput,priced:boolean):DraftItem[] {
 if(!input.units.length||input.units.length>10000)throw new BadRequestException('В поставке должно быть от 1 до 10000 упакованных единиц.');
 const ids=new Set<string>(),marks=new Set<string>(),grouped=new Map<string,DraftItem>();
 for(const u of [...input.units].sort((a,b)=>a.id.localeCompare(b.id))) {
  if(ids.has(u.id))throw new BadRequestException('Повторная единица в составе.');ids.add(u.id);
  const boxes=input.boxes.filter(b=>b.boxId===u.targetBoxId);
  if(u.state!=='PACKED'||boxes.length!==1||!boxes[0].closedAt||!boxes[0].confirmedAt)throw new BadRequestException('Завершите упаковку и проверку всех коробов.');
  const matches=input.identities.filter(i=>i.skuId===u.skuId);
  if(matches.length!==1)throw new BadRequestException('Нужно однозначное соответствие товара Lamoda.');
  const i=matches[0],externalSku=text(i.externalSku,'Артикул продавца Lamoda');
  if(!/^\d{8,14}$/.test(i.ean)||(priced&&(!Number.isSafeInteger(i.priceMinor)||Number(i.priceMinor)<=0)))throw new BadRequestException('Проверьте ШК и цену товара по УПД.');
  if(u.requiresKiz&&!u.kiz)throw new BadRequestException('У маркированной единицы отсутствует КИЗ.');
  if(u.kiz){const identity=physicalKizIdentity(u.kiz);if(!identity||marks.has(identity))throw new BadRequestException('Некорректный или повторный КИЗ.');marks.add(identity);}
  const key=JSON.stringify([externalSku,i.ean,priced?i.priceMinor:null,!!u.kiz]);
  const item:DraftItem=grouped.get(key)??{externalSku,quantity:0,...(priced?{price:{amount:i.priceMinor!,currency:'RUB' as const}}:{}),ean:i.ean,...(u.kiz?{markingCodes:[]}: {})};
  item.quantity++;if(u.kiz)item.markingCodes!.push(u.kiz);grouped.set(key,item);
 }
 if(new Set([...grouped.values()].map(i=>i.externalSku)).size>5000)throw new BadRequestException('Превышен лимит 5000 SKU.');
 return [...grouped.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
// FIX: textual dates/barcodes and one row per marked physical unit; prices converted once.
export function actualLamodaWorkbook(body:{plannedDate?:string;externalShipmentId?:string;items:DraftItem[]}):Buffer {
 const date=body.plannedDate?.split('-').reverse().join('.')??'';
 const rows:unknown[][]=[['Дата поставки',date],['Номер поставки',body.externalShipmentId??''],['Номер документа отгрузки',''],['Seller SKU','Количество','Стоимость','EAN','Вес ЮИ','Data Matrix']];
 for(const i of body.items){for(const code of i.markingCodes??[''])rows.push([i.externalSku,i.markingCodes?1:i.quantity,i.price?i.price.amount/100:'',i.ean,'',code]);}
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Лист1');
 return XLSX.write(book,{type:'buffer',bookType:'xlsx'});
}
