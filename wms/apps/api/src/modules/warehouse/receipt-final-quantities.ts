import {ConflictException} from '@nestjs/common';
// FIX: final box/SKU composition instead of separate correction movements; no stock writes.
export function receiptFinalQuantities<T extends {boxId:string|null;skuId:string;quantity:number}>(rows:T[]):T[]{
 const groups=new Map<string,T>();
 for(const row of rows){
  if(!row.boxId||!row.skuId||!Number.isSafeInteger(row.quantity))throw new ConflictException('Не удалось проверить состав приёмки.');
  const key=JSON.stringify([row.boxId,row.skuId]),existing=groups.get(key);
  if(existing)existing.quantity+=row.quantity;else groups.set(key,{...row});
 }
 const result=[...groups.values()];
 if(result.some(row=>!Number.isSafeInteger(row.quantity)||row.quantity<0))throw new ConflictException('Итоговое количество товара в коробе отрицательное. Требуется сверка.');
 return result.filter(row=>row.quantity>0);
}
