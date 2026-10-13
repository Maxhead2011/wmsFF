import {ConflictException} from '@nestjs/common';
import {createHash} from 'node:crypto';
export function adjustmentHash(value:any):string {const stable=(x:any):any=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
export type AdjustmentRow={direction:string;skuId:string;barcode:string;before:number;packed:number;after:number};
// FIX: distribute only the unfilled quota; never reduce already packed or picked goods.
export function adjustmentRows(plan:any,limits:Record<string,number>):AdjustmentRow[]{
 const rows:AdjustmentRow[]=plan.directions.flatMap((d:any)=>d.items.map((i:any)=>({direction:d.name,skuId:i.skuId,barcode:i.barcode,before:i.quantity,packed:i.packed,after:i.packed})));
 for(const line of plan.lines){const group=rows.filter(r=>r.skuId===line.skuId),before=group.reduce((s,r)=>s+r.before,0),floor=group.reduce((s,r)=>s+r.packed,0),target=Math.min(before,Math.max(line.picked,limits[line.skuId]??before));
  if(before!==line.needed||floor>target)throw new ConflictException('Состав направлений не совпадает с заявкой.');
  let rest=target-floor;const capacity=before-floor;
  const ranked=group.map((r,index)=>{const exact=capacity?rest*(r.before-r.packed)/capacity:0;const n=Math.floor(exact);r.after+=n;return {r,index,remainder:exact-n};});
  rest=target-group.reduce((s,r)=>s+r.after,0);
  for(const {r} of ranked.sort((a,b)=>b.remainder-a.remainder||a.index-b.index)){if(rest>0&&r.after<r.before){r.after++;rest--;}}
 }
 return rows;
}
export function validateAdjustment(rows:AdjustmentRow[],quantities:unknown){
 if(!Array.isArray(quantities)||quantities.length!==rows.length)throw new ConflictException('Повторите предпросмотр корректировки.');
 const out=rows.map((r,i)=>{const after=quantities[i];if(!Number.isSafeInteger(after)||after<r.packed||after>r.before)throw new ConflictException('Количество должно быть целым, не ниже упакованного и не выше плана.');return {...r,after};});
 for(const sku of new Set(rows.map(r=>r.skuId)))if(rows.filter(r=>r.skuId===sku).reduce((s,r)=>s+r.after,0)!==out.filter(r=>r.skuId===sku).reduce((s,r)=>s+r.after,0))throw new ConflictException('Сумма по направлениям должна совпадать с доступным количеством.');
 for(const direction of new Set(out.map(r=>r.direction)))if(!out.some(r=>r.direction===direction&&r.after>0))throw new ConflictException('Направление стало пустым. Его отмена в Ozon требует отдельного решения.');
 return out;
}
