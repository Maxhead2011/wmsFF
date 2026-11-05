import { ConflictException } from '@nestjs/common';
import { withLockedFabricLedger } from './fabric-fbs-store';
import { FabricOrderLedger, releaseFabricOrder, fabricOrderKey } from './fabric-fbs-order';
import { FABRIC_TASK_MARKER } from './fabric-fbs-task-state';

// FIX: caller has verified cancellation; participate in its transaction so a
// failed cancellation cannot leave the order without its material reservation.
export async function releaseCancelledFabricOrder(tx:any, task:any):Promise<boolean> {
  if (task.sourceArticle!==FABRIC_TASK_MARKER) return false;
  await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${task.requestId} FOR UPDATE`;
  return withLockedFabricLedger(tx,task.clientId,async raw=>{
    const ledger=releaseFabricOrder(raw as FabricOrderLedger,task);
    const key=fabricOrderKey(task);
    const order=ledger.fbsOrders![key];
    const produced=order.lines.some(line=>ledger.fbsReservations!.some(r=>
      r.key===JSON.stringify([key,line.lineId]) && r.confirmedUnits>0));
    return {ledger,result:produced};
  });
}

export async function releaseCancelledFabricRequest(tx:any, requestId:string) {
  // Disabled installations have never issued fabric tasks; ordinary paths stay unchanged.
  if (process.env.WMS_FBS_FABRIC_CUT_ENABLED!=='true') return;
  await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${requestId} FOR UPDATE`;
  const tasks=await tx.fbsTsdAssembly.findMany({where:{requestId,sourceArticle:FABRIC_TASK_MARKER}});
  for (const task of tasks) await releaseCancelledFabricOrder(tx,task);
}

// FIX: postponement retains the reservation and cuts; real cancellation frees
// only uncut metres. This safety path remains active with new assignment disabled.
export async function releaseFabricTask(db: any, task: any, mode: 'POSTPONE' | 'CLOSED_REQUEST', actor?: {id:string;deviceCode:string}) {
  if (task.sourceArticle !== FABRIC_TASK_MARKER) return false;
  return db.$transaction(async (tx:any) => {
    await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${task.requestId} FOR UPDATE`;
    const request=await tx.clientRequest.findUnique({where:{id:task.requestId}});
    if (!request || request.clientId!==task.clientId) throw new ConflictException('Заявка нарезки не найдена. Требуется сверка.');
    if (mode==='CLOSED_REQUEST' && !['DONE','CANCELLED','REJECTED'].includes(request.status)) return false;
    return withLockedFabricLedger(tx,task.clientId,async raw=>{
      await tx.$queryRaw`SELECT id FROM "FbsTsdAssembly" WHERE id=${task.id} FOR UPDATE`;
      const fresh=await tx.fbsTsdAssembly.findUnique({where:{id:task.id}});
      if (!fresh || fresh.sourceArticle!==FABRIC_TASK_MARKER || fresh.requestId!==task.requestId ||
          fresh.clientId!==task.clientId || fresh.orderId!==task.orderId || fresh.connectionId!==task.connectionId ||
          !(mode==='POSTPONE'?['IN_PROGRESS']:['IN_PROGRESS','RELEASED','RETURN_REQUIRED']).includes(fresh.status) ||
          (actor && (fresh.workerUserId!==actor.id || fresh.deviceCode!==actor.deviceCode)))
        throw new ConflictException('Задание нарезки изменилось. Обновите очередь.');
      if (mode==='POSTPONE' && fresh.marketplaceSubmittedAt) throw new ConflictException('Заказ уже передан маркетплейсу. Завершите задание.');
      const ledger=mode==='CLOSED_REQUEST'?releaseFabricOrder(raw as FabricOrderLedger,fresh):raw;
      // FIX: retry remains harmless, including a postponed task cancelled later.
      if (mode==='CLOSED_REQUEST' && fresh.status==='RETURN_REQUIRED' && JSON.stringify(ledger)===JSON.stringify(raw))
        return {ledger,result:true};
      await tx.fbsTsdAssembly.update({where:{id:fresh.id},data:{status:mode==='POSTPONE'?'RELEASED':'RETURN_REQUIRED',
        workerUserId:null,workerName:null,errorMessage:mode==='POSTPONE'?'Задание отложено. Резерв ткани и нарезанные отрезы сохранены.':'Заявка закрыта. Ненарезанный резерв освобождён; изготовленные отрезы требуют решения менеджера.'}});
      await tx.clientRequestEvent.create({data:{requestId:task.requestId,clientId:task.clientId,eventType:'COMMENT',
        createdByUserId:actor?.id??null,title:mode==='POSTPONE'?'Нарезка отложена':'Освобождён ненарезанный резерв закрытой заявки',
        body:JSON.stringify({taskId:task.id,orderId:task.orderId,mode,stockChanged:false})}});
      return {ledger,result:true};
    });
  });
}
