import type {Prisma} from '@prisma/client';

// FIX: waive historical scans only after a complete, audited physical disposition.
// Unknown/legacy recovery formats deliberately remain blocked.
export async function hasVerifiedFboReturn(db:Prisma.TransactionClient,r:{id:string;clientId:string;warehouseId:string|null}) {
 const audit=await db.auditLog.findFirst({where:{entity:'ClientRequest',entityId:r.id,action:'FBO_PICKED_UNITS_REDISTRIBUTED'},orderBy:{createdAt:'desc'}});
 if(!audit)return false;
 const payload=audit.payload as any, mappings=payload?.result?.mappings;
 const original=payload?.before?.requests?.find((x:any)=>x.id===r.id)?.fboAssembly?.units;
 if(!Array.isArray(mappings)||!mappings.length||!Array.isArray(original))return false;
 const assembly=await db.fboAssembly.findUnique({where:{requestId:r.id}});
 if(!assembly||assembly.phase!=='PICKING')return false;
 const units=await db.fboAssemblyUnit.findMany({where:{requestId:r.id}});
 if(units.length!==mappings.length||new Set(mappings.map((m:any)=>m.oldUnitId)).size!==units.length)return false;
 if(units.some(u=>u.state!=='RETURNED'||u.activeMarkId||u.targetBoxId||!u.markId))return false;
 if(await db.stockBalance.count({where:{box:{code:`FBO-PICK-${r.id}`},quantity:{not:0}}}))return false;
 const scans=await db.tsdOperation.findMany({where:{status:'ACCEPTED',payload:{path:['requestId'],equals:r.id},operationType:{in:['move_scan','assembly_stage','box_search_scan']}},select:{createdAt:true,operationType:true}});
 if(scans.some(s=>s.operationType!=='assembly_stage'||s.createdAt>audit.createdAt))return false;
 const marks=await db.productMark.findMany({where:{id:{in:units.map(u=>u.markId!)}}});
 for(const u of units){
  const mapping=mappings.find((m:any)=>m.oldUnitId===u.id);
  const before=original.find((o:any)=>o.id===u.id);
  const mark=marks.find(m=>m.id===u.markId);
  if(!mapping||!before||mapping.markId!==u.markId||before.markId!==u.markId||before.skuId!==u.skuId||before.kiz!==u.kiz)return false;
  if(!mark||mark.clientId!==r.clientId||mark.skuId!==u.skuId||mark.value!==u.kiz)return false;
  if(mapping.newUnitId===null){
   if(mapping.destination!==u.sourceBoxCode||mark.boxId!==u.sourceBoxId||mark.status!=='AVAILABLE')return false;
   const box=await db.box.findUnique({where:{id:u.sourceBoxId}});
   if(!box||box.clientId!==r.clientId||box.warehouseId!==r.warehouseId)return false;
  }else{
   if(typeof mapping.newUnitId!=='string'||!Number.isInteger(mapping.destination))return false;
   const target=await db.fboAssemblyUnit.findUnique({where:{id:mapping.newUnitId},include:{assembly:{include:{request:true}}}});
   if(!target||target.requestId===r.id||target.state!=='PICKED'||target.activeMarkId!==u.markId||target.markId!==u.markId||target.skuId!==u.skuId||target.kiz!==u.kiz)return false;
   const request=target.assembly.request;
   if(request.number!==mapping.destination||request.clientId!==r.clientId||request.warehouseId!==r.warehouseId||!['SUBMITTED','APPROVED','IN_WORK'].includes(request.status))return false;
   const box=await db.box.findUnique({where:{code:`FBO-PICK-${target.requestId}`}});
   if(!box||mark.boxId!==box.id||mark.status!=='PACKING'||box.clientId!==r.clientId||box.warehouseId!==r.warehouseId)return false;
  }
 }
 return true;
}
