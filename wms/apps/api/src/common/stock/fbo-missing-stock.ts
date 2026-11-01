import type { Prisma } from '@prisma/client';

const prefix = '[FBO_MISSING_STOCK]';
export const missingStockComment = (boxId:string,skuId:string,quantity:number) => prefix+JSON.stringify({boxId,skuId,quantity});

// FIX: a report only withholds the reported units until the same box has a verified recount.
export async function missingStockHolds(db:Prisma.TransactionClient,clientId:string,warehouseId:string|null|undefined,skuIds:string[]) {
  const result=new Map<string,Map<string,number>>();
  if(!warehouseId || !skuIds.length || process.env.WMS_FBO_EXCEL_PICK_CHECK_ENABLED!=='true')return result;
  const reports = await db.auditLog.findMany({
    where:{entity:'FboMissingStock',entityId:warehouseId,action:'HOLD',payload:{path:['clientId'],equals:clientId}},
    select:{createdAt:true,payload:true}
  });
  const relevant = reports.map(report=>({at:report.createdAt,data:report.payload as {boxId:string;skuId:string;quantity:number}}))
    .filter(report=>skuIds.includes(report.data.skuId));
  if(!relevant.length)return result;
  const counts=await db.inventoryAuditBox.findMany({where:{clientId,boxId:{in:[...new Set(relevant.map(r=>r.data.boxId))]},
    status:{in:['MATCHED','RESOLVED']},session:{warehouseId}},select:{boxId:true,startedAt:true}});
  for(const report of relevant){
    const h=report.data;
    const verified=counts.some(count=>count.boxId===h.boxId && count.startedAt>=report.at);
    if(verified)continue;
    const box=result.get(h.boxId)??new Map<string,number>();
    box.set(h.skuId,Math.max(box.get(h.skuId)??0,h.quantity));result.set(h.boxId,box);
  }
  return result;
}
