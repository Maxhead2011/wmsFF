import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, StockStatus } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { assertSortingAdmin, sortingKizIdentity } from '../inventory/pallet-sorting-policy';

export type WrittenOffSortingInput = {
  clientId: string; toBoxCode: string; barcode: string; kiz: string; sessionId: string; version: number;
  idempotencyKey: string; confirmRestore?: boolean; restoreFingerprint?: string;
};

// FIX: this helper is called only inside the sorting service's Serializable transaction and locks.
// It restores an existing identity, never creates a second ProductMark or deletes shipment evidence.
export async function restoreWrittenOffSortingUnit(tx: Prisma.TransactionClient, input: WrittenOffSortingInput, user: AuthUser,
  increment: (input: { warehouseId: string; clientId: string; skuId: string; boxId: string; palletId: string | null; status: StockStatus; quantity: number }) => Promise<unknown>,
  validateSource?: (boxId: string) => Promise<void>) {
  assertSortingAdmin(user);
  const identity = sortingKizIdentity(input.kiz);
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`sorting-kiz:${identity}`}))`);
  const gtin=identity.slice(2,16), serial=identity.slice(18);
  const prefixes=[identity,`]d2${identity}`,`(01)${gtin}(21)${serial}`,`01${gtin}\u001d21${serial}`,
    `]d201${gtin}\u001d21${serial}`,`01${gtin}<GS>21${serial}`,`]d201${gtin}<GS>21${serial}`].map(s=>s.replace(/[\\%_]/g,'\\$&'));
  const marks=await tx.productMark.findMany({where:{OR:prefixes.map(p=>({value:{startsWith:p}}))},take:2});
  const mark=marks[0];
  if(marks.length!==1||mark.clientId!==input.clientId||!['BLOCKED','AVAILABLE'].includes(mark.status)) throw new ConflictException('КИЗ не является единственной доступной или списанной записью этого клиента. Восстановление не выполнено.');
  const target=await tx.box.findUnique({where:{code:input.toBoxCode}});
  if(!target||target.status!=='active'||target.clientId!==input.clientId||target.warehouseId!==user.activeWarehouseId||target.id===mark.boxId)
    throw new ConflictException('Целевой короб или филиал изменился. Восстановление не выполнено.');
  const products=await tx.barcode.findMany({where:{value:input.barcode,sku:{clientId:input.clientId}},include:{sku:true},take:2});
  if(products.length!==1||products[0].sku.id!==mark.skuId) throw new ConflictException('ШК не соответствует списанному КИЗу этого клиента.');
  // FIX: never blindly credit a BLOCKED mark; establish its accounting source before offering consent.
  const missingAvailable = mark.status === 'AVAILABLE';
  // FIX: old repair jobs cleared boxId but kept an exact movement FK. Its identity and branch,
  // not a hard-coded sourceDocument name or a one-second timestamp window, prove the old source.
  const linkedRecovery=!mark.boxId&&!missingAvailable&&mark.sourceDocument!=='admin-unpalleted-writeoff';
  const linked=linkedRecovery&&mark.stockMovementId?await tx.stockMovement.findUnique({where:{id:mark.stockMovementId}}):null;
  if(linkedRecovery&&(!linked?.boxId||linked.clientId!==input.clientId||linked.warehouseId!==user.activeWarehouseId||
    linked.skuId!==mark.skuId||!Number.isInteger(linked.quantity)||linked.quantity===0))
    throw new ConflictException('Не удалось сопоставить прежний учёт этого КИЗа с клиентом и филиалом. Остатки не изменены.');
  if(!mark.boxId&&missingAvailable) throw new ConflictException('Нет учётного источника КИЗа. Требуется фактический пересчёт.');
  const writeoffs=linked?[linked]:await tx.stockMovement.findMany({where:{clientId:input.clientId,warehouseId:user.activeWarehouseId,skuId:mark.skuId,
    ...(missingAvailable ? {boxId:mark.boxId,createdAt:{gte:mark.updatedAt}} : {
      type:'INVENTORY_ADJUSTMENT',quantity:{lt:0},createdAt:{gte:new Date(mark.updatedAt.getTime()-1000),lte:mark.updatedAt},
      ...(mark.boxId?{boxId:mark.boxId}:{sourceDocument:'admin-unpalleted-writeoff'})})},
    orderBy:[{createdAt:'desc'},{id:'desc'}],take:2});
  const writeoff=writeoffs[0];
  if(!writeoff?.boxId||(!missingAvailable&&writeoffs.length!==1)) throw new ConflictException('Документ списания отсутствует или неоднозначен. Новый приход не выполнен.');
  let requestProof: unknown = null;
  if(missingAvailable){
    // FIX: request-level SHIP may have consumed a different box while leaving this KIZ AVAILABLE.
    // FIX: keep the debit proof; unrelated request completeness is not proof of this identity's shipment.
    const source=await tx.box.findUnique({where:{id:mark.boxId!}});
    if(!source||source.clientId!==input.clientId||source.warehouseId!==user.activeWarehouseId||
      writeoff.type!=='SHIP'||writeoff.quantity>=0||!Number.isInteger(writeoff.quantity)||writeoff.quantity < -1000||
      !writeoff.sourceDocument||writeoffs[1]?.createdAt.getTime()===writeoff.createdAt.getTime())
      throw new ConflictException('Нет однозначного списания из учётного короба. Восстановление не выполнено.');
    const request=await tx.clientRequest.findFirst({where:{id:writeoff.sourceDocument,clientId:input.clientId},select:{id:true,status:true,updatedAt:true}});
    const assemblies=request ? await tx.fbsTsdAssembly.findMany({where:{requestId:request.id,clientId:input.clientId,skuId:mark.skuId},
      select:{id:true,status:true,completedAt:true,kiz:true,boxCode:true,updatedAt:true},orderBy:{id:'asc'},take:1001}) : [];
    const otherIdentities=assemblies.map(a=>{try{return sortingKizIdentity(a.kiz??'');}catch{return null;}});
    if(otherIdentities.includes(identity)) throw new ConflictException('Этот КИЗ связан со сборкой заказа. Восстановление не выполнено.');
    // FIX: preserve missing/incomplete request evidence in consent and audit, never fabricate completion.
    // The global checks below still reject any order/shipment/print history for the exact scanned KIZ.
    requestProof={request,assemblies:assemblies.map((a,i)=>[a.id,a.status,a.completedAt,a.updatedAt,a.boxCode,otherIdentities[i]])};
  }
  let debit: {id:string;quantity:number;updatedAt:Date;palletId:string|null}|null=null;
  if(linkedRecovery){
    await validateSource?.(writeoff.boxId);
    const source=await tx.box.findUnique({where:{id:writeoff.boxId}});
    if(!source||source.id===target.id||source.status==='deleted'||source.clientId!==input.clientId||source.warehouseId!==user.activeWarehouseId)
      throw new ConflictException('Прежний короб относится к другому клиенту или филиалу.');
    const balances=await tx.stockBalance.findMany({where:{boxId:source.id,skuId:mark.skuId,quantity:{not:0}},orderBy:{id:'asc'}});
    if(balances.some(b=>b.clientId!==input.clientId||b.warehouseId!==user.activeWarehouseId||b.status!=='AVAILABLE'||!Number.isInteger(b.quantity)||b.quantity<0))
      throw new ConflictException('В учётном источнике есть резерв или некорректный остаток. Нужна административная сверка остатков.');
    // FIX: use an existing unmarked unit before creating +1, so a lost KIZ binding cannot duplicate stock.
    if(balances.length){
      const availableMarks=await tx.productMark.findMany({where:{boxId:source.id,skuId:mark.skuId,status:'AVAILABLE'},select:{id:true}});
      if(availableMarks.length>=balances.reduce((sum,b)=>sum+b.quantity,0))
        throw new ConflictException('Все единицы учётного остатка уже имеют другие КИЗы. Подтвердите полный пересчёт этого ШК.');
      debit=balances[0];
    }
  } else if(await tx.stockBalance.findFirst({where:{boxId:writeoff.boxId,skuId:mark.skuId,quantity:{not:0}},select:{id:true}}))
    throw new ConflictException('В прежнем коробе есть учтённый остаток или резерв этого товара. Повторный приход не выполнен.');
  const where={OR:prefixes.map(p=>({kiz:{startsWith:p}}))};
  const evidence=await Promise.all([
    tx.fbsTsdAssembly.findFirst({where,select:{id:true}}),tx.shippedKizHistory.findFirst({where,select:{id:true}}),
    tx.fbsWebKizStickerPrint.findFirst({where,select:{id:true}}),tx.fbsAssemblyAttemptHistory.findFirst({where,select:{id:true}}),
    tx.fbsPrintJob.findFirst({where,select:{id:true}}),tx.kizCirculationItem.findFirst({where:{OR:prefixes.map(p=>({kizRaw:{startsWith:p}}))},select:{id:true}}),
  ]);
  if(evidence.some(Boolean))throw new ConflictException('КИЗ связан с заказом, отгрузкой, печатью или погашением. Восстановление не выполнено.');
  const fingerprint=createHash('sha256').update(JSON.stringify([user.id,input.sessionId,input.version,target.id,identity,input.barcode,
    mark.id,mark.updatedAt,mark.boxId,mark.sourceDocument,writeoff.id,writeoff.quantity,mark.status,requestProof,debit])).digest('hex');
  if(input.confirmRestore!==true||input.restoreFingerprint!==fingerprint) throw new ConflictException({
    code:'SORTING_WRITEOFF_CONFIRM_REQUIRED',fingerprint,
    message:`${linkedRecovery ? 'КИЗ отмечен недоступным и потерял привязку к коробу после прежнего учёта. Связей этого КИЗа с заказами и отгрузкой не найдено.' : missingAvailable ? 'КИЗ числится доступным, но в учётном коробе нет остатка после списания. История старой заявки может быть неполной; связей именно этого КИЗа с заказами и отгрузкой не найдено.' : 'Этот КИЗ ранее списан.'} Подтвердите, что товар с ШК ${input.barcode} физически у вас. ${debit?'Будет перенесена 1 уже учтённая единица; общий остаток не увеличится.':'Будет восстановлена ровно 1 единица.'} Целевой короб: ${target.code}.`,
  });
  if(await tx.stockMovement.findUnique({where:{idempotencyKey:input.idempotencyKey}}))throw new ConflictException('Эта единица уже восстановлена. Обновите сортировку.');
  if(debit){
    const changed=await tx.stockBalance.updateMany({where:{id:debit.id,quantity:debit.quantity,updatedAt:debit.updatedAt},data:{quantity:{decrement:1}}});
    if(changed.count!==1)throw new ConflictException('Исходный остаток изменился. Повторите подтверждение.');
    await tx.stockMovement.create({data:{clientId:input.clientId,warehouseId:user.activeWarehouseId!,skuId:mark.skuId,
      boxId:writeoff.boxId,palletId:debit.palletId,type:'MOVE',status:'AVAILABLE',quantity:-1,
      idempotencyKey:`${input.idempotencyKey}:source`,sourceDocument:`PALLET_SORTING:${input.sessionId}`,
      comment:`Администратор ${user.id}: восстановлена старая привязка КИЗ, перенос существующей единицы.`}});
  }
  const movement=await tx.stockMovement.create({data:{clientId:input.clientId,warehouseId:user.activeWarehouseId!,skuId:mark.skuId,
    boxId:target.id,palletId:target.palletId,type:debit?'MOVE':'INVENTORY_ADJUSTMENT',status:'AVAILABLE',quantity:1,
    idempotencyKey:input.idempotencyKey,sourceDocument:`PALLET_SORTING:${input.sessionId}`,
    comment:`Администратор ${user.id} подтвердил физическое наличие 1 ед.; восстановление привязки КИЗ, прежняя учётная запись ${writeoff.id}.`}});
  const changed=await tx.productMark.updateMany({where:{id:mark.id,clientId:input.clientId,skuId:mark.skuId,status:mark.status,boxId:mark.boxId,updatedAt:mark.updatedAt},
    data:{status:'AVAILABLE',boxId:target.id,stockMovementId:movement.id,sourceDocument:`PALLET_SORTING:${input.sessionId}`}});
  if(changed.count!==1)throw new ConflictException('КИЗ изменился параллельно. Восстановление отменено.');
  await increment({clientId:input.clientId,warehouseId:user.activeWarehouseId!,skuId:mark.skuId,boxId:target.id,palletId:target.palletId,status:StockStatus.AVAILABLE,quantity:1});
  await tx.auditLog.create({data:{userId:user.id,action:'PALLET_SORTING_WRITTEN_OFF_KIZ_RESTORED',entity:'ProductMark',entityId:mark.id,
    payload:{sessionId:input.sessionId,identity,barcode:input.barcode,previousStatus:mark.status,previousBoxId:mark.boxId,
      previousSourceDocument:mark.sourceDocument,writeoffId:writeoff.id,targetBoxId:target.id,movementId:movement.id,quantity:1,fingerprint,
      discrepancy:debit?'ORPHAN_KIZ_EXISTING_STOCK':linkedRecovery?'ORPHAN_KIZ_PHYSICAL_CONFIRMATION':missingAvailable?'AVAILABLE_WITHOUT_BALANCE':'BLOCKED_WRITEOFF',
      sourceDebit:debit?{balanceId:debit.id,previousQuantity:debit.quantity,boxId:writeoff.boxId}:null,requestProof:requestProof as Prisma.InputJsonValue}}});
  return {skuId:mark.skuId,movementId:movement.id,sourceBoxId:debit?writeoff.boxId:null};
}
