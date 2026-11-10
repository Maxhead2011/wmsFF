import {createHash} from 'node:crypto';
import {fbsActionStatusEnabled, reconcileFbsRequestStatus} from './fbs-request-auto-status';

type Order = {id:string;connectionId:string;marketplace:string};
const key=(clientId:string,userId:string,bytes:Buffer)=>`fbs.ribbon.v1:${clientId}:${userId}:${createHash('sha256').update(bytes).digest('hex')}`;
// FIX: the server binds exact PDF bytes to the order selection; a caller cannot nominate arbitrary requests.
export async function rememberRibbon(db:any,clientId:string,userId:string,orders:Order[],bytes:Buffer) {
 if(!fbsActionStatusEnabled()||!orders.length||orders.some(o=>!['WILDBERRIES','OZON'].includes(o.marketplace)))return;
 const setting=await db.systemSetting.findUnique({where:{key:`fbs.action-status.v1:${clientId}`}});
 if(setting?.value?.startOnRibbon!==true)return;
 const value={clientId,userId,orders:orders.map(o=>({id:o.id,connectionId:o.connectionId,marketplace:o.marketplace})),generatedAt:Date.now()};
 await db.systemSetting.upsert({where:{key:key(clientId,userId,bytes)},create:{key:key(clientId,userId,bytes),value},update:{value}});
}
export async function readRibbon(db:any,clientId:string,userId:string,bytes:Buffer,warehouseId:string) {
 if(!fbsActionStatusEnabled())return [];
 const value=(await db.systemSetting.findUnique({where:{key:key(clientId,userId,bytes)}}))?.value;
 if(!value||value.clientId!==clientId||value.userId!==userId||!Array.isArray(value.orders)||Date.now()-value.generatedAt>86400000)return [];
 const links=await db.fbsOrderRequestLink.findMany({where:{clientId,syncStatus:'ACTIVE',OR:value.orders.map((o:any)=>({connectionId:o.connectionId,orderId:o.id,marketplace:o.marketplace})),request:{warehouseId,type:'OUTBOUND',status:{notIn:['DONE','CANCELLED','REJECTED']}}},select:{requestId:true,connectionId:true,orderId:true,marketplace:true}});
 return links.map((l:any)=>({requestId:l.requestId,connectionId:l.connectionId,orderId:l.orderId,marketplace:l.marketplace}));
}
export async function confirmRibbon(tx:any,payload:any,jobId:string,at:Date) {
 if(!fbsActionStatusEnabled()||!Array.isArray(payload.fbsRibbon)||!payload.fbsRibbon.length)return;
 for(const requestId of [...new Set<string>(payload.fbsRibbon.map((l:any)=>l.requestId))].sort()) {
  await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${requestId} FOR UPDATE`;
  const r=await tx.clientRequest.findUnique({where:{id:requestId},select:{clientId:true,warehouseId:true}});
  if(r?.clientId!==payload.clientId||r.warehouseId!==payload.warehouseId)continue;
  const selection=payload.fbsRibbon.filter((l:any)=>l.requestId===requestId);
  const links=await tx.fbsOrderRequestLink.findMany({where:{requestId,clientId:payload.clientId,syncStatus:'ACTIVE',OR:selection.map((l:any)=>({connectionId:l.connectionId,orderId:l.orderId,marketplace:l.marketplace}))},select:{orderId:true}});
  if(!links.length)continue;
  await reconcileFbsRequestStatus(tx,requestId,{stage:'RIBBON',occurredAt:at,actorId:payload.requestedById});
  await tx.auditLog.create({data:{userId:payload.requestedById,entity:'ClientRequest',entityId:requestId,action:'FBS_RIBBON_PRINTED',payload:{jobId,at:at.toISOString(),orderIds:links.map((l:any)=>l.orderId)}}});
 }
}
