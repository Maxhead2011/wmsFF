import {ConflictException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {supplyOrders, type SupplyIntegration} from './ozon-supply-policy';
export const fboDeliveryEnabled=()=>process.env.WMS_FBO_DELIVERY_SYNC_ENABLED==='true';
export const deliveryKey=(id:string)=>'fbo-delivery-sync:v1:'+id;
export const deliveryVersion=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const accepted=new Set(['ACCEPTED_AT_SUPPLY_WAREHOUSE','IN_TRANSIT','ACCEPTANCE_AT_STORAGE_WAREHOUSE','REPORTS_CONFIRMATION_AWAITING','COMPLETED']);
const ids=(values:any[],field:string)=>values.map(v=>String(v[field])).sort();
const exact=(a:string[],b:string[])=>a.length>0&&new Set(a).size===a.length&&new Set(b).size===b.length&&JSON.stringify(a)===JSON.stringify(b);
// FIX: exact complete response, all linked orders AND all their directions; never infer acceptance from a partial reply.
export function ozonDeliveryProof(link:SupplyIntegration,data:any){
 const wanted=supplyOrders(link),orders=data?.orders;
 if(!Array.isArray(orders)||!exact(ids(wanted,'orderId'),ids(orders,'order_id')))throw new ConflictException('Ozon не подтвердил все заявки поставки.');
 for(const w of wanted){
  const o=orders.find((v:any)=>String(v.order_id)===w.orderId);
  if(!Array.isArray(o.supplies)||!exact(ids(w.supplies,'id'),ids(o.supplies,'supply_id')))throw new ConflictException('Направления Ozon изменились. Нужна сверка привязки.');
  if(!accepted.has(o.state)||o.supplies.some((s:any)=>!accepted.has(s.state)))return null;
 }
 return orders.map((o:any)=>({orderId:String(o.order_id),state:o.state,supplies:o.supplies.map((s:any)=>({id:String(s.supply_id),state:s.state}))}));
}
export function wbDeliveryAccepted(snapshot:any,quantity:number,dispatch:any){
 return Boolean(dispatch?.at&&[4,5,6].includes(snapshot?.statusId)&&Number.isSafeInteger(quantity)&&quantity>0&&snapshot.quantity===quantity);
}
export const deliveryRetryMs=(attempt:number)=>Math.min(30*60_000,60_000*2**Math.min(5,Math.max(0,attempt-1)));
