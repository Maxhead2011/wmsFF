import type { FbsTsdAssembly, Prisma } from '@prisma/client';
import { loadFboFbsAvailability } from './fbo-fbs-reservations';
import { confirmedUnplacedFboBoxes } from './fbo-unplaced-picking';
import { unboxedFree, unboxedFboEnabled } from './fbo-unboxed-picking';
const untouchedFbsRoute = (task: FbsTsdAssembly) =>
    !task.sourceBarcode && !task.barcode && !task.kiz && !task.relabelConfirmedAt &&
    ((task.status === 'RESERVED' && task.deviceCode === 'AUTO:FBS:PALLET_SORT' && !task.boxId) || task.status === 'IN_PROGRESS');
export async function busyBoxes(tx: Prisma.TransactionClient, ids: string[], requestId: string, allowUntouchedRoutes = false) {
        if (!ids.length) return new Set<string>();
        const boxId = { in: ids };
        const [counts, tasks, selections, parcels] = await Promise.all([
            tx.inventoryAuditBox.findMany({ where: { boxId, status: { in: ['COUNTING', 'MISMATCH'] }, session: { status: { in: ['ACTIVE', 'REVIEW'] } } }, select: { boxId: true } }),
            tx.fbsTsdAssembly.findMany({ where: { OR: [{ boxId }, { reservedBoxId: boxId }], status: { in: ['RESERVED', 'IN_PROGRESS'] } } }),
            tx.clientRequestBoxSelection.findMany({ where: { boxId, requestItem: { request: { id: { not: requestId }, status: { in: ['APPROVED', 'IN_WORK'] } } } }, select: { boxId: true } }),
            tx.fboAssemblyBox.findMany({ where: { activeBoxId: boxId, requestId: { not: requestId } }, select: { activeBoxId: true } }),
        ]);
        return new Set([...counts.map(b => b.boxId), ...selections.map(b => b.boxId), ...parcels.map(b => b.activeBoxId),
            ...tasks.filter(t => !allowUntouchedRoutes || !untouchedFbsRoute(t)).flatMap(t => [t.boxId, t.reservedBoxId])].filter((id): id is string => !!id));
    }
// FIX: count eligible stock without exposing warehouse locations to the client.
export async function fboPickingCapacity(tx: Prisma.TransactionClient, clientId: string, warehouseId: string, skuIds: string[]) {
  const client = await tx.client.findUniqueOrThrow({where:{id:clientId},select:{storesWithoutBoxes:true,stockBalanceMode:true}});
  const scope = {id:'preview', clientId, warehouseId};
  if (client.storesWithoutBoxes) return unboxedFboEnabled() ? unboxedFree(tx,scope,skuIds) : new Map<string,number>();
  const boxes = await tx.box.findMany({where:{clientId,warehouseId,status:'active',balances:{some:{skuId:{in:skuIds},status:'AVAILABLE',quantity:{gt:0}}}},
    select:{id:true,storagePlacement:{select:{id:true}},balances:{where:{skuId:{in:skuIds},status:'AVAILABLE',quantity:{gt:0}},select:{skuId:true,quantity:true,sku:{select:{needsChestnyZnak:true,isUnmarked:true}}}},productMarks:{where:{skuId:{in:skuIds},status:'AVAILABLE'},select:{skuId:true}}}});
  const blocked = await busyBoxes(tx,boxes.map(b=>b.id),scope.id,true);
  const accepted = await confirmedUnplacedFboBoxes(tx,scope,boxes.filter(b=>!b.storagePlacement).map(b=>b.id));
  const availability = await loadFboFbsAvailability(tx,scope,skuIds);
  const totals = new Map<string,number>();
  for (const box of boxes) {
    if (blocked.has(box.id) || (client.stockBalanceMode==='PALLET_SORT' && !box.storagePlacement && !accepted.has(box.id))) continue;
    const marks = new Map<string,number>();
    for(const m of box.productMarks) marks.set(m.skuId,(marks.get(m.skuId)??0)+1);
    for(const row of box.balances){
      const marked=row.sku.needsChestnyZnak && !row.sku.isUnmarked;
      const count=Math.min(row.quantity,availability.free(box.id,row.skuId),marked?(marks.get(row.skuId)??0):Infinity);
      if(count<=0)continue;
      if(marked)marks.set(row.skuId,(marks.get(row.skuId)??0)-count);
      availability.take(box.id,row.skuId,count);
      totals.set(row.skuId,(totals.get(row.skuId)??0)+count);
    }
  }
  return totals;
}
