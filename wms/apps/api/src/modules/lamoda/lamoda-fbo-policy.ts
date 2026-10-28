import { BadRequestException } from '@nestjs/common';
import { text, type LamodaPlanLine } from './lamoda-policy';
export const lamodaAssemblyEnabled = () => process.env.WMS_LAMODA_ENABLED === 'true' && process.env.WMS_LAMODA_FBO_ASSEMBLY_ENABLED === 'true';
// FIX: URL parsing never fetches arbitrary user-supplied hosts. Live cabinet URL shape remains to be verified.
export function lamodaShipmentId(input: string): string {
  let id=text(input,'ID или ссылка поставки',2000);
  if(/^https?:/i.test(id)) {
    let u:URL; try{u=new URL(id);}catch{throw new BadRequestException('Некорректная ссылка.');}
    if(u.protocol!=='https:'||u.hostname!=='seller.lamoda.tech'||u.port||u.username||u.password||u.search||u.hash) throw new BadRequestException('Введите ID поставки либо прямую ссылку из кабинета Lamoda без дополнительных параметров.');
    id=u.pathname.split('/').filter(Boolean).pop()??'';
  }
  if(!/^(?:MPG\d+|\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id)) throw new BadRequestException('Не удалось определить ID. Скопируйте идентификатор поставки Lamoda.');
  return id;
}
export function lamodaShipmentLines(items:Record<string,unknown>[],destination:string):LamodaPlanLine[] {
  if(!items.length||items.length>1000) throw new BadRequestException('В поставке должно быть от 1 до 1000 строк.');
  const lines=items.map(item=>{
    if(typeof item.sku!=='string'||!item.sku.trim()||typeof item.ean!=='string'||!/^\d{8,14}$/.test(item.ean)||!Number.isSafeInteger(item.quantityPlanned)||Number(item.quantityPlanned)<0||Number(item.quantityPlanned)>100000) throw new BadRequestException('В составе Lamoda отсутствуют корректные SKU, ШК или плановое количество.');
    return {remoteSku:item.sku,barcode:item.ean,quantity:Number(item.quantityPlanned),article:'',destination};
  }).filter(l=>l.quantity>0);
  if(!lines.length) throw new BadRequestException('В поставке нет товара к отбору.');
  return lines;
}
type Product={remoteSku:string;barcode:string|null;externalSku:string|null;skuId:string|null;linkState:string;isPresent:boolean};
// FIX: plans retain Lamoda identifiers; reservations and picking use warehouse identifiers.
export function useLamodaWarehouseBarcodes(resolved:ReturnType<typeof resolveLamodaLines>, skus:{id:string;barcodes:{value:string;isPrimary?:boolean}[]}[]) {
  const convert=(item:typeof resolved.items[number])=>{
    const bars=skus.find(s=>s.id===item.skuId)?.barcodes ?? [];
    const barcode=bars.find(b=>b.value===item.barcode)?.value ?? [...bars].sort((a,b)=>Number(!!b.isPrimary)-Number(!!a.isPrimary)||a.value.localeCompare(b.value))[0]?.value;
    if(!barcode) throw new BadRequestException('Карточки WMS изменились или нет складского ШК. Проверьте соответствия.');
    return {...item,barcode};
  };
  return {items:resolved.items.map(convert),directions:resolved.directions.map(d=>({...d,items:d.items.map(convert)}))};
}
export function resolveLamodaLines(lines:LamodaPlanLine[],products:Product[]) {
  const grouped=new Map<string,{skuId:string;barcode:string;quantity:number}>();
  const byDirection=new Map<string,Map<string,{skuId:string;barcode:string;quantity:number}>>();
  for(const [index,line] of lines.entries()) {
    const matches=products.filter(p=>p.isPresent&&p.linkState==='CONFIRMED'&&p.skuId&&p.barcode===line.barcode&&(!line.remoteSku||p.remoteSku===line.remoteSku)&&(!line.article||p.externalSku===line.article));
    if(matches.length!==1) throw new BadRequestException(`Строка ${index+2}: подтвердите однозначное соответствие товара Lamoda и WMS.`);
    const skuId=matches[0].skuId!, name=line.destination||'Основная поставка';
    const row=grouped.get(skuId)??{skuId,barcode:line.barcode,quantity:0};row.quantity+=line.quantity;grouped.set(skuId,row);
    const dir=byDirection.get(name)??new Map(), item=dir.get(skuId)??{skuId,barcode:line.barcode,quantity:0};item.quantity+=line.quantity;dir.set(skuId,item);byDirection.set(name,dir);
  }
  return {items:[...grouped.values()],directions:[...byDirection].map(([name,items])=>({name,items:[...items.values()]}))};
}
