import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

const actions = new Set(['OPEN_BOX', 'MANUAL_OPEN_BOX', 'PACK_UNIT', 'MANUAL_PACK_UNIT', 'PACK_BOX', 'CLOSE_BOX', 'CANCEL_EMPTY_BOX']);
export async function withPackingReceipt(service:any, ack:any, user:any) {
  if (!ack.accepted || process.env.WMS_FBO_COMPACT_PACKING_ENABLED !== 'true' || !actions.has(ack.action)) return ack;
  try {
    const packing = await service.prisma.$transaction(async (tx:Prisma.TransactionClient) =>
      packingReceipt(tx, await service.load(tx, ack.requestId, user, 'write'), ack.action),
      {isolationLevel:'RepeatableRead',timeout:5000});
    return packing ? {...ack,packing} : ack;
  } catch {
    // FIX: a failed refresh cannot invalidate a committed stock operation.
    return ack;
  }
}
// FIX: absolute state from one snapshot, never client-side increments or a route rebuild.
export async function packingReceipt(db: Prisma.TransactionClient, request: any, action: string) {
  if (process.env.WMS_FBO_COMPACT_PACKING_ENABLED !== 'true' || !actions.has(action)) return undefined;
  const id = request.id;
  const [assembly] = await db.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FboAssembly" WHERE "requestId"=${id}`);
  if (!assembly || !['PICKING', 'PACKING'].includes(assembly.phase)) return undefined;
  const composition = createHash('sha256').update(JSON.stringify(request.items.map((i:any) => [i.id,i.skuId,i.barcode,i.quantity]).sort((a:any,b:any) => String(a[0]).localeCompare(String(b[0]))))).digest('hex');
  if (assembly.compositionHash !== composition) return undefined;
  const closure = assembly.pickClosure;
  if (closure && (closure.version !== 1 || !closure.quantities || Array.isArray(closure.quantities) ||
    Object.keys(closure.quantities).length !== request.items.length || request.items.some((i:any) =>
      !Number.isSafeInteger(closure.quantities[i.id]) || closure.quantities[i.id] < 0 || closure.quantities[i.id] > i.quantity))) return undefined;
  const [counts, parcels, packed, whole] = await Promise.all([
    db.fboAssemblyUnit.groupBy({by:['requestItemId','state','wholeBox'],where:{requestId:id,state:{not:'RETURNED'}},_count:{_all:true}}),
    db.fboAssemblyBox.findMany({where:{requestId:id},select:{boxId:true,boxCode:true,wholeBox:true,closedAt:true,confirmedAt:true}}),
    db.fboAssemblyUnit.groupBy({by:['targetBoxId'],where:{requestId:id,state:'PACKED'},_count:{_all:true}}),
    db.fboAssemblyUnit.groupBy({by:['sourceBoxCode'],where:{requestId:id,state:'PICKED',wholeBox:true}}),
  ]);
  const lines = request.items.map((i:any) => {
    const groups=counts.filter(c=>c.requestItemId===i.id),picked=groups.reduce((n,c)=>n+c._count._all,0),packed=groups.filter(c=>c.state==='PACKED').reduce((n,c)=>n+c._count._all,0);
    const needed=closure?closure.quantities[i.id]:i.quantity;
    return {id:i.id,skuId:i.skuId,barcode:i.barcode,name:i.sku?.name??'',article:i.sku?.article??'',size:i.sku?.size??'',requiresKiz:!!i.sku?.needsChestnyZnak&&!i.sku?.isUnmarked,needed,picked,packed,remaining:Math.max(0,needed-picked)};
  });
  return {version:1,requestId:id,phase:assembly.phase,lines,
    needed:lines.reduce((s:number,l:any)=>s+l.needed,0),picked:lines.reduce((s:number,l:any)=>s+l.picked,0),packed:lines.reduce((s:number,l:any)=>s+l.packed,0),
    looseRemaining:counts.filter(c=>c.state==='PICKED'&&!c.wholeBox).reduce((n,c)=>n+c._count._all,0),
    wholeBoxes:whole.map(b=>b.sourceBoxCode),boxes:parcels.map(b=>({code:b.boxCode,wholeBox:b.wholeBox,closed:!!b.closedAt,confirmed:!!b.confirmedAt,quantity:packed.find(p=>p.targetBoxId===b.boxId)?._count._all??0}))};
}
