import {ConflictException} from '@nestjs/common';

// FIX: Ozon is the demand source; exact client-scoped barcode ownership defines identity.
export function syncComposition(s:any,link:any,catalog:any[]){
 const directions:any[]=[],totals=new Map<string,any>(),rows:any[]=[];
 const names=(s.directions as any[]).map(d=>d.name),mapped=names.map(n=>link.mapping[n]);
 if(new Set(names).size!==names.length||mapped.some(v=>!v)||new Set(mapped).size!==mapped.length||mapped.length!==link.supplies.length||link.supplies.some((v:any)=>!mapped.includes(v.id)))throw new ConflictException('Изменился набор направлений. Сначала нужна сверка привязки поставок.');
 const units=(s.request.fboAssembly?.units??[]).filter((u:any)=>u.state!=='RETURNED');
 if(units.some((u:any)=>u.state==='PACKED'&&!(s.request.fboAssembly?.boxes??[]).some((b:any)=>b.boxId===u.targetBoxId&&names.includes(b.direction))))throw new ConflictException('Упакованный товар без подтверждённого направления требует сверки.');
 for(const name of names){
  const supply=link.supplies.find((v:any)=>v.id===link.mapping[name]),items:any[]=[];
  for(const row of supply.items){
   if(!Number.isSafeInteger(row.quantity)||row.quantity<=0)throw new ConflictException('Ozon вернул некорректное количество.');
   const owners=catalog.filter(c=>c.barcodes.some((b:any)=>b.value===row.barcode));
   if(owners.length!==1)throw new ConflictException(`ШК ${row.barcode}: товар не найден однозначно в карточках клиента.`);
   const sku=owners[0];if(items.some(i=>i.skuId===sku.id))throw new ConflictException('Несколько строк Ozon соответствуют одному товару направления.');
   const item={skuId:sku.id,barcode:row.barcode,name:sku.name,quantity:row.quantity};items.push(item);
   const previous=totals.get(sku.id);if(previous&&previous.barcode!==row.barcode)throw new ConflictException('Разные ШК одного товара по направлениям требуют сверки.');
   totals.set(sku.id,{...item,quantity:(previous?.quantity??0)+row.quantity});
  }
  if(!items.length)throw new ConflictException('Пустая поставка Ozon требует отдельной отмены.');
  const old=s.directions.find((d:any)=>d.name===name).items;
  const boxIds=new Set((s.request.fboAssembly?.boxes??[]).filter((b:any)=>b.direction===name).map((b:any)=>b.boxId));
  for(const skuId of new Set([...old.map((i:any)=>i.skuId),...items.map(i=>i.skuId),...units.filter((u:any)=>boxIds.has(u.targetBoxId)).map((u:any)=>u.skuId)])){
   const after=items.find(i=>i.skuId===skuId),before=old.filter((i:any)=>i.skuId===skuId).reduce((n:number,i:any)=>n+i.quantity,0),packed=units.filter((u:any)=>u.skuId===skuId&&boxIds.has(u.targetBoxId)).length;
   if((after?.quantity??0)<packed)throw new ConflictException(`В направлении ${name} уже упаковано больше, чем указано в Ozon.`);
   rows.push({direction:name,skuId,barcode:after?.barcode??old.find((i:any)=>i.skuId===skuId)?.barcode,name:after?.name,before,after:after?.quantity??0,packed});
  }
  directions.push({name,items});
 }
 for(const skuId of new Set<string>(units.map((u:any)=>u.skuId)))if((totals.get(skuId)?.quantity??0)<units.filter((u:any)=>u.skuId===skuId).length)throw new ConflictException('Уже отобрано больше товара, чем осталось в Ozon. Сначала оформите возврат из сборки.');
 return {directions,items:[...totals.values()],rows,needed:s.request.items.reduce((n:number,i:any)=>n+i.quantity,0),after:[...totals.values()].reduce((n,i)=>n+i.quantity,0)};
}
