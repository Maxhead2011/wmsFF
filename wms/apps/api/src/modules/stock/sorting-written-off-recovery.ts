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
  increment: (input: { warehouseId: string; clientId: string; skuId: string; boxId: string; palletId: string | null; status: StockStatus; quantity: number }) => Promise<unknown>) {
  assertSortingAdmin(user);
  const identity = sortingKizIdentity(input.kiz);
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`sorting-kiz:${identity}`}))`);
  const gtin=identity.slice(2,16), serial=identity.slice(18);
  const prefixes=[identity,`]d2${identity}`,`(01)${gtin}(21)${serial}`,`01${gtin}\u001d21${serial}`,
    `]d201${gtin}\u001d21${serial}`,`01${gtin}<GS>21${serial}`,`]d201${gtin}<GS>21${serial}`].map(s=>s.replace(/[\\%_]/g,'\\$&'));
  const marks=await tx.productMark.findMany({where:{OR:prefixes.map(p=>({value:{startsWith:p}}))},take:2});
  const mark=marks[0];
  if(marks.length!==1||mark.clientId!==input.clientId||mark.status!=='BLOCKED') throw new ConflictException('КИЗ не является единственной списанной записью этого клиента. Восстановление не выполнено.');
  const target=await tx.box.findUnique({where:{code:input.toBoxCode}});
  if(!target||target.status!=='active'||target.clientId!==input.clientId||target.warehouseId!==user.activeWarehouseId||target.id===mark.boxId)
    throw new ConflictException('Целевой короб или филиал изменился. Восстановление не выполнено.');
  const products=await tx.barcode.findMany({where:{value:input.barcode,sku:{clientId:input.clientId}},include:{sku:true},take:2});
  if(products.length!==1||products[0].sku.id!==mark.skuId) throw new ConflictException('ШК не соответствует списанному КИЗу этого клиента.');
  // FIX: BLOCKED alone may mean quality hold. Require an unambiguous negative inventory event
  // in the same branch, at the time the mark was blocked (one atomic write-off).
  if(!mark.boxId&&mark.sourceDocument!=='admin-unpalleted-writeoff') throw new ConflictException('Нет доказательства складского списания КИЗа.');
  const writeoffs=await tx.stockMovement.findMany({where:{clientId:input.clientId,warehouseId:user.activeWarehouseId,skuId:mark.skuId,
    type:'INVENTORY_ADJUSTMENT',quantity:{lt:0},createdAt:{gte:new Date(mark.updatedAt.getTime()-1000),lte:mark.updatedAt},
    ...(mark.boxId?{boxId:mark.boxId}:{sourceDocument:'admin-unpalleted-writeoff'})},take:2});
  const writeoff=writeoffs[0];
  if(writeoffs.length!==1||!writeoff.boxId) throw new ConflictException('Документ списания отсутствует или неоднозначен. Новый приход не выполнен.');
  if(await tx.stockBalance.findFirst({where:{boxId:writeoff.boxId,skuId:mark.skuId,quantity:{not:0}},select:{id:true}}))
    throw new ConflictException('В прежнем коробе есть учтённый остаток или резерв этого товара. Повторный приход не выполнен.');
  const where={OR:prefixes.map(p=>({kiz:{startsWith:p}}))};
  const evidence=await Promise.all([
    tx.fbsTsdAssembly.findFirst({where,select:{id:true}}),tx.shippedKizHistory.findFirst({where,select:{id:true}}),
    tx.fbsWebKizStickerPrint.findFirst({where,select:{id:true}}),tx.fbsAssemblyAttemptHistory.findFirst({where,select:{id:true}}),
    tx.fbsPrintJob.findFirst({where,select:{id:true}}),tx.kizCirculationItem.findFirst({where:{OR:prefixes.map(p=>({kizRaw:{startsWith:p}}))},select:{id:true}}),
  ]);
  if(evidence.some(Boolean))throw new ConflictException('КИЗ связан с заказом, отгрузкой, печатью или погашением. Восстановление не выполнено.');
  const fingerprint=createHash('sha256').update(JSON.stringify([user.id,input.sessionId,input.version,target.id,identity,input.barcode,
    mark.id,mark.updatedAt,mark.boxId,mark.sourceDocument,writeoff.id,writeoff.quantity])).digest('hex');
  if(input.confirmRestore!==true||input.restoreFingerprint!==fingerprint) throw new ConflictException({
    code:'SORTING_WRITEOFF_CONFIRM_REQUIRED',fingerprint,
    message:`Этот КИЗ ранее списан. Подтвердите, что товар с ШК ${input.barcode} физически у вас. В короб ${target.code} будет восстановлена ровно 1 единица.`,
  });
  if(await tx.stockMovement.findUnique({where:{idempotencyKey:input.idempotencyKey}}))throw new ConflictException('Эта единица уже восстановлена. Обновите сортировку.');
  const movement=await tx.stockMovement.create({data:{clientId:input.clientId,warehouseId:user.activeWarehouseId!,skuId:mark.skuId,
    boxId:target.id,palletId:target.palletId,type:'INVENTORY_ADJUSTMENT',status:'AVAILABLE',quantity:1,
    idempotencyKey:input.idempotencyKey,sourceDocument:`PALLET_SORTING:${input.sessionId}`,
    comment:`Администратор ${user.id} подтвердил физическое наличие 1 ед.; восстановление КИЗ после списания ${writeoff.id}.`}});
  const changed=await tx.productMark.updateMany({where:{id:mark.id,clientId:input.clientId,skuId:mark.skuId,status:'BLOCKED',boxId:mark.boxId,updatedAt:mark.updatedAt},
    data:{status:'AVAILABLE',boxId:target.id,stockMovementId:movement.id,sourceDocument:`PALLET_SORTING:${input.sessionId}`}});
  if(changed.count!==1)throw new ConflictException('КИЗ изменился параллельно. Восстановление отменено.');
  await increment({clientId:input.clientId,warehouseId:user.activeWarehouseId!,skuId:mark.skuId,boxId:target.id,palletId:target.palletId,status:StockStatus.AVAILABLE,quantity:1});
  await tx.auditLog.create({data:{userId:user.id,action:'PALLET_SORTING_WRITTEN_OFF_KIZ_RESTORED',entity:'ProductMark',entityId:mark.id,
    payload:{sessionId:input.sessionId,identity,barcode:input.barcode,previousStatus:mark.status,previousBoxId:mark.boxId,
      previousSourceDocument:mark.sourceDocument,writeoffId:writeoff.id,targetBoxId:target.id,movementId:movement.id,quantity:1,fingerprint}}});
  return {skuId:mark.skuId,movementId:movement.id};
}
