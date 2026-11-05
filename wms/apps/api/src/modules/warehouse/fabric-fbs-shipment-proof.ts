import { ConflictException } from '@nestjs/common';
import { FABRIC_TASK_MARKER, readFabricTaskLines } from './fabric-fbs-task-state';
import { fabricCreditMatches } from './fabric-fbs-protection';

// FIX: a task status is not production evidence. Match audit, movement and exact
// request item; never grant another order credit for the same SKU's raw debit.
export async function readFabricShipmentProof(db:any, request:any, warehouseId:string|undefined, eligibleTaskIds:ReadonlySet<string>) {
  // FIX: the caller has already excluded print-confirmed WB shipments.
  if (!eligibleTaskIds.size) return [];
  const tasks=await db.fbsTsdAssembly.findMany({where:{requestId:request.id,clientId:request.clientId,status:'COMPLETED',sourceArticle:FABRIC_TASK_MARKER}});
  if (!tasks.length) return [];
  if (!warehouseId) throw new ConflictException('Не определён склад нарезанных отрезов.');
  const audits=await db.auditLog.findMany({where:{entity:'FabricRolls',entityId:request.clientId,action:'FABRIC_FBS_CUT'},select:{payload:true}});
  const result:any[]=[];
  const used=new Map<string,number>();
  for(const task of tasks){
    if(!eligibleTaskIds.has(task.id) || task.sourceArticle!==FABRIC_TASK_MARKER || task.status!=='COMPLETED') continue;
    const records=audits.map((a:any)=>a.payload).filter((p:any)=>p?.taskId===task.id);
    const lines=await readFabricTaskLines(db,task);
    if(!lines?.length || lines.some(l=>l.remainingUnits!==0 || records.filter((p:any)=>p.lineId===l.lineId && p.skuId===l.skuId).reduce((n:number,p:any)=>n+p.units,0)!==l.quantity))
      throw new ConflictException('Нет полного подтверждения производства отрезов.');
    for(const proof of records){
      const item=request.items.find((i:any)=>i.id===proof.lineId && i.skuId===proof.skuId);
      if(!item) continue; // WB already-shipped items are removed from the remaining request.
      if(!fabricCreditMatches(proof,{...task,taskId:task.id,skuId:proof.skuId,warehouseId}) ||
          !Number.isSafeInteger(proof.units)||proof.units<=0 || proof.clientId!==request.clientId)
        throw new ConflictException('История производства не соответствует отгрузке.');
      const movement=await db.stockMovement.findUnique({where:{idempotencyKey:proof.movementKey}});
      if(!movement || movement.clientId!==request.clientId || movement.sourceDocument!==request.id ||
          movement.skuId!==item.skuId || movement.warehouseId!==warehouseId || movement.status!=='PACKING' ||
          movement.quantity!==proof.units || movement.boxId || movement.palletId ||
          proof.movementKey!==`fbs-sticker-pick:${task.id}:fabric:${proof.key}`)
        throw new ConflictException('Не подтверждён приход отрезов под заказ.');
      const total=(used.get(item.id)??0)+proof.units;
      if(total>item.quantity) throw new ConflictException('Производство превышает количество к отгрузке. Нужна сверка.');
      used.set(item.id,total);
      result.push({itemId:item.id,skuId:item.skuId,warehouseId,boxId:null,palletId:null,quantity:proof.units,movementIds:[movement.id],strictPacking:true});
    }
  }
  return result;
}
