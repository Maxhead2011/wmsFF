import { createHash } from 'crypto';
import type { AuthUser } from '../modules/auth/auth.types';
import { ClientScopeService } from '../modules/auth/client-scope.service';
// FIX: count unresolved reviews independently of FBS orders and read markers.
export async function openKizReviewCount(db:any,user:AuthUser,clientId?:string):Promise<number|undefined>{
 if(process.env.WMS_KIZ_REVIEW_QUEUE_ENABLED!=='true'||user.isDemo||!user.activeWarehouseId||
   !user.roleCodes.some(r=>['ADMIN','OWNER','SUPER_ADMIN'].includes(r)))return undefined;
 if(!user.permissionCodes.includes('system:admin')&&user.warehouseIds&&!user.warehouseIds.includes(user.activeWarehouseId))return undefined;
 const rows=await db.kizReviewCase.findMany({where:{status:'OPEN',warehouseId:user.activeWarehouseId,
   clientId:new ClientScopeService().resolveClientFilter(user,clientId||undefined),
   NOT:[{taskId:{startsWith:'UNIT:'}},{taskId:{startsWith:'FOUND:'}}]},select:{taskId:true,context:true}});
 const legacy=rows.filter((r:any)=>!r.taskId.startsWith('GUARD:'));
 const tasks=legacy.length?await db.fbsTsdAssembly.findMany({where:{id:{in:legacy.map((r:any)=>r.taskId)}}}):[];
 return rows.filter((r:any)=>{
  if(r.taskId.startsWith('GUARD:'))return true;
  const t=tasks.find((t:any)=>t.id===r.taskId);
  if(!t||t.status!=='IN_PROGRESS'||t.kiz)return false;
  const context=createHash('sha256').update(JSON.stringify([t.id,t.clientId,t.connectionId,t.requestId,t.orderId,t.skuId,t.boxId,t.workerUserId,t.startedAt,t.createdAt])).digest('hex');
  return context===r.context;
 }).length;
}
