import { kizIdentity } from './unprinted-kiz.policy';
import type { Prisma } from '@prisma/client';
type Task={id:string;requestId:string;orderId:string;kiz:string|null;status:string;completedAt:Date|null;workerName:string|null};
type Scan={entityId:string|null;createdAt:Date;payload:unknown};
type Job={id:string;assemblyId:string;requestId:string;orderId:string;kiz:string;status:string;printedAt:Date|null;requestedBy:string};
type Ack={entityId:string|null;createdAt:Date};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'?v as Record<string,unknown>:{};
// FIX: display-only evidence; never change assembly, inventory or WB status.
export function packingProgress(task:Task,scans:Scan[],jobs:Job[],acks:Ack[]) {
 const key=kizIdentity(task.kiz??'');
 const scan=scans.filter(s=>{const p=record(s.payload);return s.entityId===task.id&&p.requestId===task.requestId&&p.orderId===task.orderId&&key!==null&&kizIdentity(String(p.kiz||p.scannedKiz||''))===key;}).sort((a,b)=>+a.createdAt-+b.createdAt)[0];
 const foundAt=task.status==='COMPLETED'&&task.completedAt?(scan?.createdAt??task.completedAt):null;
 const matches=jobs.filter(j=>key!==null&&j.assemblyId===task.id&&j.requestId===task.requestId&&j.orderId===task.orderId&&kizIdentity(j.kiz)===key);
 const printed=matches.flatMap(j=>[...(j.status==='PRINTED'&&j.printedAt?[{at:j.printedAt,by:j.requestedBy}]:[]),...acks.filter(a=>a.entityId===j.id).map(a=>({at:a.createdAt,by:j.requestedBy}))])
  .filter(p=>foundAt!==null&&p.at>=foundAt).sort((a,b)=>+a.at-+b.at)[0];
 return {stage:printed?'PACKED' as const:foundAt?'FOUND' as const:null,foundAt:foundAt?.toISOString()??null,foundBy:foundAt?String(record(scan?.payload).workerName||task.workerName||'Не установлен'):null,packedAt:printed?.at.toISOString()??null,packedBy:printed?.by??null};
}
export async function readPackingProgress(db:Prisma.TransactionClient,requestId:string,tasks:Task[]) {
 const ids=tasks.map(t=>t.id);
 const [scans,jobs]=await Promise.all([
  db.auditLog.findMany({where:{entity:'FbsTsdAssembly',entityId:{in:ids},action:{in:['FBS_KIZ_SCAN_ACCEPTED','FBS_WB_KIZ_REPLACED_AFTER_PRODUCT_PICK']}},select:{entityId:true,createdAt:true,payload:true}}),
  db.fbsPrintJob.findMany({where:{assemblyId:{in:ids},requestId},select:{id:true,assemblyId:true,requestId:true,orderId:true,kiz:true,status:true,printedAt:true,requestedBy:true}}),
 ]);
 const acks=await db.auditLog.findMany({where:{entity:'FbsPrintJob',action:'FBS_TWO_LABELS_PRINTED',entityId:{in:jobs.map(j=>j.id)}},select:{entityId:true,createdAt:true}});
 return new Map(tasks.map(t=>[t.id,packingProgress(t,scans,jobs,acks)]));
}
