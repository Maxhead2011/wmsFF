import {ConflictException} from '@nestjs/common';
import type {Prisma} from '@prisma/client';

export const ADMIN_REMOVED='ADMIN_REMOVED';
export const REMOVAL_ACTION='CLIENT_REQUEST_ADMIN_REMOVED';
export const requestRemovalEnabled=()=>process.env.WMS_REQUEST_REMOVAL_ENABLED==='true';
// FIX: role checks are independent from broad client-request write permissions.
export function canRemoveRequests(user:{roleCodes?:string[];isDemo?:boolean},enabled=requestRemovalEnabled()){
 return enabled&&!user.isDemo&&!!user.roleCodes?.some(r=>r==='ADMIN'||r==='OWNER');
}
export function removalBlockers(r:{type:string;status:string;physical:number;activeWaves:number;deliveries:number}){
 const reasons:string[]=[];
 if(r.type!=='OUTBOUND')reasons.push('Удаление доступно только для отгрузочных заявок ФБО/ФБС.');
 if(!['SUBMITTED','IN_REVIEW','APPROVED','IN_WORK'].includes(r.status))reasons.push('Заявка уже закрыта или упакована.');
 if(r.physical)reasons.push('Есть фактический отбор, упаковка или печать. Сначала выполните возврат товара через исправление этапов.');
 if(r.activeWaves)reasons.push('Заявка входит в активную волну отбора. Сначала отмените волну.');
 if(r.deliveries)reasons.push('Есть связанная заявка на доставку. Сначала завершите её разбор.');
 return reasons;
}
export async function assertRequestNotRemoved(db:Prisma.TransactionClient,id:string){
 if(!requestRemovalEnabled())return;
 if(await db.auditLog.findFirst({where:{action:REMOVAL_ACTION,entity:'ClientRequest',entityId:id},select:{id:true}}))
  throw new ConflictException('Заявка удалена администратором. История доступна в архиве.');
}
export async function lockRequestNotRemoved(db:Prisma.TransactionClient,id:string){
 if(!requestRemovalEnabled())return;
 await db.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${id} FOR UPDATE`;
 await assertRequestNotRemoved(db,id);
}
export async function lockOrderLinks(db:Prisma.TransactionClient,clientId:string,orders:Array<{connectionId:string;id:string}>){
 if(!requestRemovalEnabled())return;
 for(const o of [...orders].sort((a,b)=>`${a.connectionId}:${a.id}`.localeCompare(`${b.connectionId}:${b.id}`)))
  await db.$queryRaw`SELECT id FROM "FbsOrderRequestLink" WHERE "clientId"=${clientId} AND "connectionId"=${o.connectionId} AND "orderId"=${o.id} FOR UPDATE`;
}
// FIX: cancellation must survive scheduler runs and incoming marketplace snapshots.
export async function assertOrdersNotRemoved(db:Prisma.TransactionClient,clientId:string,orders:Array<{connectionId:string;id:string}>){
 if(!requestRemovalEnabled()||!orders.length)return;
 const blocked=await db.fbsOrderRequestLink.findMany({where:{clientId,syncStatus:ADMIN_REMOVED,OR:orders.map(o=>({connectionId:o.connectionId,orderId:o.id}))},select:{orderId:true}});
 if(blocked.length)throw new ConflictException(`Сборка этих заказов удалена администратором: ${blocked.map(o=>o.orderId).join(', ')}. Заказы на маркетплейсе не отменены; требуется отдельное решение.`);
}
export async function withoutRemovedOrders<T extends {connectionId:string;id:string}>(db:Prisma.TransactionClient,clientId:string,orders:T[]):Promise<T[]>{
 if(!requestRemovalEnabled()||!orders.length)return orders;
 const blocked=await db.fbsOrderRequestLink.findMany({where:{clientId,syncStatus:ADMIN_REMOVED,connectionId:{in:[...new Set(orders.map(o=>o.connectionId))]}},select:{connectionId:true,orderId:true}});
 const keys=new Set(blocked.map(o=>`${o.connectionId}:${o.orderId}`));
 return orders.filter(o=>!keys.has(`${o.connectionId}:${o.id}`));
}
