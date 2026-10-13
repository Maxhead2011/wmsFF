import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { physicalKizIdentity } from './kiz-physical-identity';

// FIX: an explicit manager decision for one physical unit; never an automatic sale override.
export const physicalReuseEnabled = () => process.env.WMS_KIZ_SOLD_PHYSICAL_REUSE_ENABLED === 'true';
const identity = (v: string) => physicalKizIdentity(v.replace(/^\(01\)(\d{14})\(21\)/, (_, gtin) => `01${gtin}21`).replace(/^(01\d{14})\u001d21/, (_, gtin) => `${gtin}21`));
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const prefixes = (v: string) => [v, ']d2'+v, ']D2'+v, `(01)${v.slice(2,16)}(21)${v.slice(18)}`];
export function physicalReuseEligible(e: any) {
  return physicalReuseEnabled() && e?.decision === 'RELABEL' &&
    (e.circulation == null || e.circulation === 'INTRODUCED') &&
    Array.isArray(e.orders) && e.orders.length > 0 && e.orders.length <= 5 &&
    e.orders.every((o: any) => o.verified === true && o.supplierStatus === 'complete' && o.wbStatus === 'sold' && o.containsKiz === true);
}
function evidenceKey(e: any) {
  return digest([e.circulation ?? null, e.orders.map((o: any) => [o.orderId, o.connectionId ?? null, o.supplierStatus, o.wbStatus, o.containsKiz, o.supplyAccepted ?? null]).sort((a: any,b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}
function markKey(m: any) { return digest([m.id,m.clientId,m.skuId,m.boxId,m.status,m.updatedAt]); }
export function physicalReusePermission(row: any, context: string, e: any, mark: any) {
  const p = row?.snapshot?.physicalReuse;
  return !!(physicalReuseEligible(e) && row?.context === context && row.status === 'APPROVED' && row.resolution === 'REUSE' &&
    row.decidedById && row.reason && p?.version === 1 && p.evidenceKey === evidenceKey(e) && mark &&
    mark.status === 'AVAILABLE' && mark.box && !['archived','deleted'].includes(mark.box.status) && p.markKey === markKey(mark));
}
export async function approvePhysicalReuse(tx: any, task: any, mark: any, e: any, user: any, reviewId: string, reason: string) {
  const fail = () => new ConflictException('Единица или прежняя привязка изменилась. Повторите проверку КИЗа.');
  const age = Date.now()-Date.parse(e.checkedAt);
  if (!physicalReuseEligible(e) || !Number.isFinite(age) || age < 0 || age > 60000) throw fail();
  const key = identity(mark.value);
  if (!key) throw fail();
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key},0))`;
  await tx.$queryRaw`SELECT id FROM "ProductMark" WHERE id=${mark.id} FOR UPDATE`;
  const marks = (await tx.productMark.findMany({where:{OR:prefixes(key).map(p=>({value:{startsWith:p}}))}})).filter((m:any)=>identity(m.value)===key);
  if (marks.length !== 1 || markKey(marks[0]) !== markKey(mark) || mark.clientId !== task.clientId ||
      mark.skuId !== task.skuId || mark.boxId !== task.boxId || mark.status !== 'AVAILABLE') throw fail();
  const approvals = await tx.kizReviewCase.findMany({where:{id:{not:reviewId},kizIdentity:key,status:'APPROVED',resolution:'REUSE',taskId:{not:task.id}}});
  if (approvals.length) throw fail();
  const fbo = await tx.fboAssemblyUnit.findMany({where:{OR:[{activeMarkId:mark.id},{OR:prefixes(key).map(p=>({kiz:{startsWith:p}})),state:{in:['PICKED','PACKED']},assembly:{phase:{not:'COMPLETED'},request:{status:{notIn:['DONE','CANCELLED','REJECTED']}}}}]}});
  if (fbo.some((u:any)=>u.activeMarkId===mark.id || identity(u.kiz??'')===key)) throw fail();
  const links = (await tx.fbsTsdAssembly.findMany({where:{id:{not:task.id},OR:prefixes(key).map(p=>({kiz:{startsWith:p}}))}})).filter((t:any)=>identity(t.kiz??'')===key);
  const requests = await tx.clientRequest.findMany({where:{clientId:task.clientId,id:{in:links.map((t:any)=>t.requestId)},status:{in:['DONE','CANCELLED','REJECTED']}}});
  if (links.some((t:any)=>t.clientId!==task.clientId || !['COMPLETED','WB_ACCOUNTED','RELEASED'].includes(t.status) ||
      !requests.some((r:any)=>r.id===t.requestId && r.warehouseId===user.activeWarehouseId) || !e.orders.some((o:any)=>o.orderId===t.orderId))) throw fail();
  // Preserve the complete old task before freeing its unique current binding; shipment history is untouched.
  for (const old of links) {
    await tx.auditLog.create({data:{userId:user.id,action:'KIZ_PHYSICAL_SALE_BINDING_ARCHIVED',entity:'FbsTsdAssembly',entityId:old.id,
      payload:JSON.parse(JSON.stringify({reviewId,taskId:task.id,kizIdentity:key,reason,physicalConfirmation:true,evidence:e,before:old}))}});
    const changed=await tx.fbsTsdAssembly.updateMany({where:{id:old.id,clientId:old.clientId,status:old.status,kiz:old.kiz,updatedAt:old.updatedAt},data:{kiz:null}});
    if(changed.count!==1) throw fail();
  }
  return {version:1,markKey:markKey(mark),evidenceKey:evidenceKey(e),markId:mark.id,previousTaskIds:links.map((t:any)=>t.id)};
}

