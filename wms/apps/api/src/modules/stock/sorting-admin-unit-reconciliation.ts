import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, StockStatus } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { assertSortingAdmin, sortingKizIdentity } from '../inventory/pallet-sorting-policy';

export type AdminSortingUnitInput = {
  toBoxCode: string; barcode: string; kiz: string; sessionId: string; idempotencyKey: string;
  sourceBoxCode?: string; sourceBoxIds?: string[];
};
export type AdminSortingUnitResult = {
  skuId: string; markId: string; movementId: string | null; sourceBoxId: string | null;
  sourceClientId: string | null; sourceWarehouseId: string | null;
  targetClientId: string; targetWarehouseId: string; recovered: boolean; alreadyApplied: boolean;
};

// FIX: exclusively called in administrative sorting's Serializable transaction. The scan changes
// current location/ownership, never shipment/print history; movement + mark + audit commit together.
export async function reconcileAdminSortingUnit(tx: Prisma.TransactionClient, input: AdminSortingUnitInput, user: AuthUser,
  increment: (value: {warehouseId: string; clientId: string; skuId: string; boxId: string; palletId: string | null; status: StockStatus; quantity: number}) => Promise<unknown>,
  parseIdentity: (value: string) => {gtin: string; serial: string} | null): Promise<AdminSortingUnitResult> {
  assertSortingAdmin(user);
  if (user.isDemo) throw new ForbiddenException('Демонстрационная учётная запись не изменяет реальные остатки.');
  const assertVisible = (clientId: string) => {
    if (user.hiddenClientIds?.includes(clientId)) throw new ForbiddenException('Операция недоступна для скрытого клиента.');
  };
  const identity = sortingKizIdentity(input.kiz);
  const barcode = input.barcode.trim();
  if (!barcode || !input.idempotencyKey || !input.sessionId) throw new BadRequestException('Не заполнены данные складской операции.');
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`sorting-kiz:${identity}`}))`);
  const fingerprint = createHash('sha256').update(JSON.stringify([user.id,input.sessionId,input.toBoxCode,barcode,identity])).digest('hex');
  const previous = await tx.auditLog.findFirst({where:{action:'PALLET_SORTING_ADMIN_UNIT',entity:'StockMovement',entityId:input.idempotencyKey}});
  if (previous) {
    const payload = previous.payload as Prisma.JsonObject;
    if (payload.fingerprint !== fingerprint) throw new ConflictException('Ключ операции уже использован для другого скана.');
    const result=payload.result as unknown as AdminSortingUnitResult;
    assertVisible(result.targetClientId);
    if(result.sourceClientId) assertVisible(result.sourceClientId);
    for(const item of Array.isArray(payload.previousMarks)?payload.previousMarks:[]) {
      const clientId=(item as Prisma.JsonObject)?.clientId;
      if(typeof clientId==='string') assertVisible(clientId);
    }
    return {...result, alreadyApplied:true};
  }
  const target = await tx.box.findUnique({where:{code:input.toBoxCode}});
  if (!target?.warehouseId) throw new BadRequestException('Целевой короб не найден или не привязан к филиалу.');
  assertVisible(target.clientId);
  const products = await tx.barcode.findMany({where:{value:barcode,sku:{clientId:target.clientId}},include:{sku:true},take:2});
  if (products.length !== 1) throw new BadRequestException('ШК должен однозначно определять товар клиента целевого короба.');
  const skuId = products[0].sku.id;
  const gtin=identity.slice(2,16), serial=identity.slice(18);
  const prefixes=[identity,`]d2${identity}`,`(01)${gtin}(21)${serial}`,`01${gtin}\u001d21${serial}`,
    `]d201${gtin}\u001d21${serial}`,`01${gtin}<GS>21${serial}`,`]d201${gtin}<GS>21${serial}`].map(s=>s.replace(/[\\%_]/g,'\\$&'));
  // FIX: prefix retrieval includes scanner-wrapper case variants but is not proof of identity.
  // A longer serial or different serial case is another physical unit and must remain untouched.
  const candidates = await tx.productMark.findMany({where:{OR:prefixes.map(value=>({value:{startsWith:value,mode:'insensitive' as const}}))},orderBy:{id:'asc'}});
  const marks = candidates.filter(candidate => {
    const parsed=parseIdentity(candidate.value);
    return parsed?.gtin===gtin && parsed.serial===serial;
  });
  for (const item of marks) assertVisible(item.clientId);
  // FIX: prefer the current target identity on retries, then an actual boxed identity. Historical
  // duplicate records are retained as blocked aliases in the audit, never silently deleted.
  const mark = marks.find(m=>m.boxId===target.id && m.clientId===target.clientId && m.skuId===skuId && m.status==='AVAILABLE')
    ?? marks.find(m=>m.clientId===target.clientId) ?? marks.find(m=>m.boxId && m.status!=='BLOCKED') ?? marks[0];
  const recordedMark = marks.find(m=>m.boxId && m.status!=='BLOCKED') ?? mark;
  const physical = input.sourceBoxCode ? await tx.box.findUnique({where:{code:input.sourceBoxCode}}) : null;
  if (physical) assertVisible(physical.clientId);
  const recorded = recordedMark?.boxId ? await tx.box.findUnique({where:{id:recordedMark.boxId}}) : null;
  if (recorded) assertVisible(recorded.clientId);
  const lockIds = [...new Set([target.id,...marks.map(m=>m.boxId),physical?.id,...input.sourceBoxIds??[]].filter((id): id is string=>Boolean(id)))].sort();
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Box" WHERE id IN (${Prisma.join(lockIds)}) ORDER BY id FOR UPDATE`);
  const physicalSourceIds = physical ? [physical.id] : input.sourceBoxIds ?? [];
  // FIX: existing marks use their recorded SKU/owner; barcode can intentionally correct the target
  // SKU. Unknown marks consume stock matching the scanned barcode from the physical source only.
  const sourceOptions: Prisma.StockBalanceWhereInput[] = marks.filter(m=>m.boxId).map(m=>({boxId:m.boxId,clientId:m.clientId,skuId:m.skuId}));
  if(physicalSourceIds.length) sourceOptions.push({boxId:{in:physicalSourceIds},sku:{barcodes:{some:{value:barcode}}}});
  const sourceWhere: Prisma.StockBalanceWhereInput | null = sourceOptions.length ? {quantity:{gt:0},OR:sourceOptions} : null;
  let balances = sourceWhere ? await tx.stockBalance.findMany({where:sourceWhere,orderBy:{id:'asc'}}) : [];
  if (!mark?.boxId && mark?.stockMovementId) {
    const origin=await tx.stockMovement.findUnique({where:{id:mark.stockMovementId}});
    // FIX: recorded boxless stock takes priority over a physical-box fallback, even when the
    // fallback has quantity. Otherwise another unit is debited while the known one is stranded.
    if (origin?.warehouseId && origin.clientId===mark.clientId && origin.skuId===mark.skuId) balances.push(...await tx.stockBalance.findMany({where:{boxId:null,warehouseId:origin.warehouseId,
      clientId:mark.clientId,skuId:mark.skuId,status:mark.status,quantity:{gt:0}},orderBy:{id:'asc'}}));
  }
  for (const balance of balances) assertVisible(balance.clientId);
  const source = balances.find(b=>b.boxId===mark?.boxId && b.skuId===mark?.skuId && b.clientId===mark?.clientId && b.status===mark?.status)
    ?? balances.find(b=>b.boxId===recordedMark?.boxId && b.skuId===recordedMark?.skuId && b.status===recordedMark?.status)
    ?? balances.find(b=>b.status==='AVAILABLE') ?? balances[0];
  const alreadyThere = mark?.boxId===target.id && mark.clientId===target.clientId && mark.skuId===skuId && mark.status==='AVAILABLE'
    && source?.boxId===target.id && source.skuId===skuId && source.status==='AVAILABLE';
  const audit = async (result: AdminSortingUnitResult) => tx.auditLog.create({data:{userId:user.id,action:'PALLET_SORTING_ADMIN_UNIT',entity:'StockMovement',entityId:input.idempotencyKey,
    payload:{sessionId:input.sessionId,fingerprint,identity,barcode,physicalSourceBoxCode:input.sourceBoxCode??null,
      previousMarks:marks.map(m=>({id:m.id,clientId:m.clientId,skuId:m.skuId,boxId:m.boxId,status:m.status,value:m.value,
        stockMovementId:m.stockMovementId,sourceDocument:m.sourceDocument})),sourceBalanceId:source?.id??null,
      previousQuantity:source?.quantity??0,result}}});
  const retireAliases = async () => {
    for (const alias of marks.filter(m=>m.id!==mark?.id)) {
      const changed=await tx.productMark.updateMany({where:{id:alias.id,updatedAt:alias.updatedAt},data:{status:'BLOCKED',boxId:null}});
      if(changed.count!==1) throw new ConflictException('Привязка КИЗа изменилась параллельно. Повторите скан.');
    }
  };
  if (alreadyThere) {
    const result: AdminSortingUnitResult={skuId,markId:mark.id,movementId:mark.stockMovementId,sourceBoxId:target.id,
      sourceClientId:target.clientId,sourceWarehouseId:target.warehouseId,targetClientId:target.clientId,
      targetWarehouseId:target.warehouseId,recovered:false,alreadyApplied:true};
    if(target.status!=='active') await tx.box.update({where:{id:target.id},data:{status:'active'}});
    await retireAliases();
    await audit(result);
    return result;
  }
  const sourceDocument=`PALLET_SORTING:${input.sessionId}`;
  const comment=`Фактическое перемещение ШК ${barcode}; администратор ${user.id}; КИЗ ${identity}`;
  if (source) {
    const changed=await tx.stockBalance.updateMany({where:{id:source.id,quantity:{gte:1}},data:{quantity:{decrement:1}}});
    if (changed.count!==1) throw new ConflictException('Остаток изменился параллельно. Повторите скан.');
    await tx.stockBalance.deleteMany({where:{id:source.id,quantity:0}});
    await tx.stockMovement.create({data:{clientId:source.clientId,warehouseId:source.warehouseId,skuId:source.skuId,
      boxId:source.boxId,palletId:source.palletId,status:source.status,type:'INVENTORY_ADJUSTMENT',quantity:-1,
      idempotencyKey:`${input.idempotencyKey}:out`,sourceDocument,comment}});
  }
  const movement=await tx.stockMovement.create({data:{clientId:target.clientId,warehouseId:target.warehouseId,skuId,
    boxId:target.id,palletId:target.palletId,status:'AVAILABLE',type:'INVENTORY_ADJUSTMENT',quantity:1,
    idempotencyKey:`${input.idempotencyKey}:in`,sourceDocument,comment}});
  // FIX: retain every previous snapshot in audit. Current aliases no longer advertise the physical
  // unit in another box; the canonical mark itself is reused even for historical SHIPPING records.
  await retireAliases();
  let markId: string;
  if (mark) {
    const changed=await tx.productMark.updateMany({where:{id:mark.id,updatedAt:mark.updatedAt},data:{clientId:target.clientId,skuId,
      boxId:target.id,status:'AVAILABLE',stockMovementId:movement.id,sourceDocument}});
    if(changed.count!==1) throw new ConflictException('КИЗ изменился параллельно. Повторите скан.');
    markId=mark.id;
  } else {
    markId=(await tx.productMark.create({data:{clientId:target.clientId,skuId,boxId:target.id,value:input.kiz.trim(),
      status:'AVAILABLE',stockMovementId:movement.id,sourceDocument}})).id;
  }
  await increment({warehouseId:target.warehouseId,clientId:target.clientId,skuId,boxId:target.id,palletId:target.palletId,status:StockStatus.AVAILABLE,quantity:1});
  if (target.status!=='active') await tx.box.update({where:{id:target.id},data:{status:'active'}});
  const result: AdminSortingUnitResult={skuId,markId,movementId:movement.id,sourceBoxId:source ? source.boxId : recorded?.id??physical?.id??null,
    sourceClientId:source?.clientId??mark?.clientId??physical?.clientId??null,
    sourceWarehouseId:source?.warehouseId??recorded?.warehouseId??physical?.warehouseId??null,
    targetClientId:target.clientId,targetWarehouseId:target.warehouseId,recovered:!source,alreadyApplied:false};
  await audit(result);
  return result;
}
