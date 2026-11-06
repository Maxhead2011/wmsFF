import { ConflictException } from '@nestjs/common';
import { confirmFabricProduction } from './fabric-fbs-confirmation';
import { writeFabricProduction } from './fabric-fbs-production';
import { FABRIC_TASK_MARKER, readFabricTaskLines } from './fabric-fbs-task-state';

// FIX: called only after validating the product scan, within the scan transaction.
export async function recordFabricScan(tx:any, task:any, lineId:string, count:number, user:any, deviceCode:string) {
  await readFabricTaskLines(tx, task); // fail closed if the mode/reservation disappeared
  return confirmFabricProduction(tx, {
    clientId:task.clientId,taskId:task.id,
    owner:{marketplace:task.marketplace,connectionId:task.connectionId,orderId:task.orderId,requestId:task.requestId},lineId,confirmedUnits:count,
    operationId:`scan:${lineId}:${count}`,
  },{userId:user.id,deviceCode},(_,proof)=>writeFabricProduction(tx,proof));
}

// FIX: WB uses the same durable absolute counter as Ozon: one accepted scan, one piece.
export async function scanWbFabric(service:any, task:any, barcode:string, expected:unknown, user:any) {
  if(task.sourceArticle!==FABRIC_TASK_MARKER || task.marketplace!=='WILDBERRIES') return null;
  await service.inventoryLock?.assertStockMovementsAllowed();
  return service.prisma.$transaction(async(tx:any)=>{
    await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${task.requestId} FOR UPDATE`;
    const key=`fabric.rolls.v1:${task.clientId}`;
    const locks=await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked`;
    if(locks[0]?.locked!==true) throw new ConflictException('Ткань обрабатывается другим сотрудником. Повторите скан.');
    await tx.$queryRaw`SELECT id FROM "FbsTsdAssembly" WHERE id=${task.id} FOR UPDATE`;
    const fresh=await tx.fbsTsdAssembly.findUnique({where:{id:task.id}});
    service.requireCurrentFbsTsdLease(fresh,user);
    const lines=await readFabricTaskLines(tx,fresh);
    const line=lines?.find(l=>l.lineId===fresh.requestItemId && l.skuId===fresh.skuId);
    if(lines?.length!==1 || !line || line.quantity!==fresh.itemCount) throw new ConflictException('Состав нарезки изменился.');
    if(!Array.isArray(fresh.barcodes) || !fresh.barcodes.some((v:string)=>v.toLowerCase()===barcode.toLowerCase()))
      throw new ConflictException('Неверный ШК товара. Метры не списаны.');
    if(!Number.isSafeInteger(expected) || Number(expected)<0 || Number(expected)>line.confirmedUnits)
      throw new ConflictException('Обновите счётчик сканирования.');
    // FIX: a validated rescan restores lost barcode proof without another production debit.
    if(line.remainingUnits===0) {
      if(fresh.barcode===barcode) return fresh;
      return tx.fbsTsdAssembly.update({where:{id:fresh.id},data:{barcode,errorMessage:null}});
    }
    if(Number(expected)<line.confirmedUnits) return fresh;
    await recordFabricScan(tx,fresh,line.lineId,line.confirmedUnits+1,user,service.fbsTsdDeviceCode(undefined,user));
    return tx.fbsTsdAssembly.update({where:{id:fresh.id},data:{
      barcode:line.remainingUnits===1?barcode:null,errorMessage:null,
    }});
  });
}
