import { PrismaService } from '../prisma/prisma.service';
import { finalizeWbOrderShipment } from '../stock/wb-order-stock-lifecycle';
import { reconcileDoneRequestPacking, doneRequestPackingEnabled } from '../stock/done-request-packing';
import { reconcileFbsRequestStatus } from '../stock/fbs-request-auto-status';
import { runReconciliationJobs, type ReconciliationJob } from './queue';
import { withClientKizReview } from '../kiz-client-review';
const chunks = <T>(a:T[],n=1000) => Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));

// FIX: bounded background reconciliation. Never invoked by a read-only screen request.
export async function reconcileWbBackground(db:PrismaService, clientId:string, orders:any[], localOrder:(task:any)=>Promise<any>, notify:(changes:any[])=>Promise<any>) {
  const [tasks,facts,balances,movements] = await Promise.all([
    db.fbsTsdAssembly.findMany({where:{clientId,marketplace:'WILDBERRIES'},select:{id:true,requestId:true,connectionId:true,orderId:true,completedAt:true,stockWarehouseId:true,skuId:true,boxId:true,kiz:true,itemCount:true}}),
    db.wbOrderShipment.findMany({where:{clientId},select:{assemblyId:true}}),
    db.stockBalance.groupBy({by:['warehouseId','skuId'],where:{clientId,status:{in:['PACKING','SHIPPING']}},_max:{updatedAt:true},_sum:{quantity:true},_count:true}),
    db.stockMovement.groupBy({by:['sourceDocument'],where:{clientId,status:{in:['PACKING','SHIPPING']}},_max:{createdAt:true},_count:true}),
  ]);
  const balanceByKey=new Map(balances.map(b=>[`${b.warehouseId}:${b.skuId}`,b]));
  const movementByRequest=new Map(movements.map(m=>[m.sourceDocument,m]));
  const recorded=new Set(facts.map(f=>f.assemblyId));
  const requestIds=[...new Set(tasks.map(t=>t.requestId))];
  const requests=(await Promise.all(chunks(requestIds).map(ids=>db.clientRequest.findMany({where:{clientId,id:{in:ids}},select:{id:true,number:true,warehouseId:true,status:true,updatedAt:true}})))).flat();
  const requestById=new Map(requests.map(r=>[r.id,r]));
  const pending=tasks.filter(t=>!recorded.has(t.id));
  const prints=(await Promise.all(chunks(pending.map(t=>t.id)).map(ids=>db.fbsPrintJob.findMany({where:{assemblyId:{in:ids},status:'PRINTED',deviceCode:{startsWith:'SOS-WB:'}},select:{assemblyId:true,printedAt:true},distinct:['assemblyId'],orderBy:{printedAt:'asc'}})))).flat();
  const printed=new Map(prints.map(p=>[p.assemblyId,p]));
  const orderByKey=new Map(orders.map(o=>[`${o.connectionId}:${o.id}`,o]));
  const jobs:ReconciliationJob[]=[];
  for(const task of pending) {
    const r=requestById.get(task.requestId), print=printed.get(task.id), incoming=orderByKey.get(`${task.connectionId}:${task.orderId}`);
    const done=r?.status==='DONE';
    if(!print && incoming?.category!=='shipped' && !(done&&task.completedAt))continue;
    const cause=print?'PRINT_CONFIRMED':'SHIPMENT_CONFIRMED';
    jobs.push({clientId,entityId:task.id,requestId:task.requestId,warehouseId:task.stockWarehouseId??r?.warehouseId??null,cause,label:task.orderId,
      evidence:{task,request:r,print,balance:balanceByKey.get(`${task.stockWarehouseId??r?.warehouseId}:${task.skuId}`),movements:movementByRequest.get(task.requestId),source:print?'PRINT_CONFIRMED':done?'WMS_REQUEST_SHIPPED':'WB_SHIPMENT_CONFIRMED'},
      run:async()=>{
        const full=await db.fbsTsdAssembly.findUniqueOrThrow({where:{id:task.id}});
        const order=incoming??await localOrder(full),changes:any[]=[];
        await withClientKizReview(db,{id:full.workerUserId??null},()=>db.$transaction(async tx=>{
          await finalizeWbOrderShipment(tx,task.id,print?'PRINT_CONFIRMED':done?'WMS_REQUEST_SHIPPED':'WB_SHIPMENT_CONFIRMED',JSON.parse(JSON.stringify(order)),print?.printedAt??undefined);
          if(print?.printedAt)await reconcileFbsRequestStatus(tx,task.requestId,{stage:'SOS_PRINT',occurredAt:print.printedAt,actorId:full.workerUserId},changes);
        },{timeout:30_000}));
        await notify(changes);
      }});
  }
  if(doneRequestPackingEnabled()) {
    const residuals=await db.stockMovement.groupBy({by:['sourceDocument'],where:{clientId,status:'PACKING',sourceDocument:{in:requests.filter(r=>r.status==='DONE').map(r=>r.id)}},_sum:{quantity:true},having:{quantity:{_sum:{gt:0}}}});
    for(const residual of residuals) {
      const r=requestById.get(residual.sourceDocument!);if(!r)continue;
      jobs.push({clientId,entityId:r.id,requestId:r.id,warehouseId:r.warehouseId,cause:'DONE_PACKING',label:String(r.number),evidence:{r,residual,movements:movementByRequest.get(r.id),balances:r.warehouseId?balances.filter(b=>b.warehouseId===r.warehouseId):[]},run:()=>db.$transaction(tx=>reconcileDoneRequestPacking(tx,r.id),{timeout:30_000})});
    }
  }
  // Closing an already recorded case updates service metadata only.
  for(const ids of chunks([...recorded])) await db.$executeRawUnsafe(
    'UPDATE "WmsReconciliationCase" SET "resolvedAt"=NOW(),"reasonCode"=NULL WHERE "clientId"=$1 AND "entityId"=ANY($2::text[]) AND "resolvedAt" IS NULL AND "cause"<>\'DONE_PACKING\' AND ("leaseUntil" IS NULL OR "leaseUntil"<NOW())',clientId,ids);
  return runReconciliationJobs(db,jobs);
}
