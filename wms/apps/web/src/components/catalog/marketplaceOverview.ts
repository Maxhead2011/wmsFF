// FIX: compare saved identities without changing links, stock or publication settings.
export type OverviewLink = {id:string;marketplace:string;skuId:string|null;status:string;barcodes?:string[];size?:string|null;color?:string|null;sku:{id:string;size:string|null;color:string|null;barcodes?:{value:string}[]}|null};
export function linksForSku<T extends OverviewLink>(rows:T[],skuId:string):T[]{return rows.filter(r=>r.status==='LINKED'&&r.skuId===skuId);}
export function auditLinks(rows:OverviewLink[]){
 const issues:{id:string;message:string}[]=[];
 const norm=(v?:string|null)=>(v??'').trim().toLocaleLowerCase('ru-RU');
 for(const r of rows){
  let message='';
  if(r.status==='SAVED_CARD'){
   const candidates=rows.filter(other=>other.marketplace!==r.marketplace&&other.barcodes?.some(b=>r.barcodes?.includes(b)));
   message=candidates.length>1?'Несколько карточек другого маркетплейса с тем же ШК — требуется ручная проверка':candidates.length===1?'Найден кандидат другого маркетплейса по ШК — сверьте размер и цвет, связь не изменена':'Соответствие на другом маркетплейсе по сохранённым ШК не найдено';
  }
  else if(r.status!=='LINKED'||!r.skuId||!r.sku)message='Связь требует ручной проверки';
  else if(!r.barcodes?.length||!r.sku.barcodes?.length)message='Недостаточно данных ШК для проверки';
  else if(['size','color'].some(k=>{const f=k as 'size'|'color';return norm(r[f])&&norm(r.sku![f])&&norm(r[f])!==norm(r.sku![f]);}))message='Различаются размер или цвет — проверьте связь';
  else if(!r.barcodes.some(b=>r.sku!.barcodes!.some(s=>s.value===b)))message='ШК маркетплейса отличаются от складских — проверьте связь';
  else if(rows.some(other=>other.id!==r.id&&other.status==='LINKED'&&other.skuId&&other.skuId!==r.skuId&&other.barcodes?.some(b=>r.barcodes!.includes(b))))message='Один ШК связан с разными складскими товарами — требуется проверка';
  if(message)issues.push({id:r.id,message});
 }
 return issues;
}
