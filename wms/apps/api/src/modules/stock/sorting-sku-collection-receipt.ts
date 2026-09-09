import { ConflictException } from '@nestjs/common';
import { Prisma, StockStatus } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { assertSortingAdmin, sortingKizIdentity } from '../inventory/pallet-sorting-policy';
import type { WrittenOffSortingInput } from './sorting-written-off-recovery';

// FIX: called only within pallet sorting's Serializable transaction. This is placement of
// existing picked stock, not a write-off recovery, surplus receipt or re-pick of the old box.
export async function receiveSkuCollectionSortingUnit(
  tx: Prisma.TransactionClient, input: WrittenOffSortingInput, user: AuthUser,
  increment: (input: { warehouseId: string; clientId: string; skuId: string; boxId: string; palletId: string | null; status: StockStatus; quantity: number }) => Promise<unknown>,
) {
  assertSortingAdmin(user);
  const identity = sortingKizIdentity(input.kiz);
  const prefix = identity.replace(/[\\%_]/g, '\\$&');
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`sorting-kiz:${identity}`}))`);
  const marks = await tx.productMark.findMany({ where: { value: { startsWith: prefix } }, take: 2 });
  const mark = marks[0];
  if (marks.length !== 1 || mark.clientId !== input.clientId || mark.status !== 'PACKING' || mark.boxId || !mark.sourceDocument)
    throw new ConflictException('КИЗ не находится в однозначном отборе по SKU этого клиента. Остатки не изменены.');
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ClientRequest" WHERE "id" = ${mark.sourceDocument} FOR UPDATE`);
  const request = await tx.clientRequest.findUnique({ where: { id: mark.sourceDocument } });
  if (!request || request.type !== 'SKU_COLLECTION' || request.clientId !== input.clientId ||
      request.warehouseId !== user.activeWarehouseId || !['APPROVED', 'IN_WORK', 'PACKED', 'DONE'].includes(request.status))
    throw new ConflictException('КИЗ относится не к действующей сборке по SKU этого клиента и филиала.');
  const scans = await tx.skuCollectionScan.findMany({ where: { requestId: request.id, kiz: { startsWith: prefix } }, include: { source: true }, take: 2 });
  const scan = scans[0], source = scan?.source;
  if (scans.length !== 1 || scan.status !== 'PICKED' || scan.receivedAt || scan.targetBoxId || scan.skuId !== mark.skuId ||
      source.requestId !== request.id || source.clientId !== input.clientId || source.warehouseId !== user.activeWarehouseId ||
      source.skuId !== mark.skuId || source.sourceBoxId !== scan.sourceBoxId ||
      source.receivedQuantity < 0 || source.pickedQuantity <= source.receivedQuantity)
    throw new ConflictException('Не подтверждена незавершённая приёмка этого КИЗа из сборки по SKU.');
  const products = await tx.barcode.findMany({ where: { value: input.barcode, sku: { clientId: input.clientId } }, take: 2 });
  if (products.length !== 1 || products[0].skuId !== mark.skuId)
    throw new ConflictException('ШК не соответствует КИЗу, отобранному по SKU.');
  const target = await tx.box.findUnique({ where: { code: input.toBoxCode } });
  if (!target || target.status !== 'active' || target.clientId !== input.clientId || target.warehouseId !== user.activeWarehouseId)
    throw new ConflictException('Целевой короб недоступен у этого клиента в текущем филиале.');
  const pick = mark.stockMovementId ? await tx.stockMovement.findUnique({ where: { id: mark.stockMovementId } }) : null;
  if (!pick || pick.type !== 'PICK' || pick.status !== 'PACKING' || pick.quantity !== 1 || pick.boxId || pick.palletId ||
      pick.sourceDocument !== request.id || pick.clientId !== input.clientId || pick.warehouseId !== user.activeWarehouseId || pick.skuId !== mark.skuId)
    throw new ConflictException('Не найдено движение отбора этой единицы в промежуточный остаток.');
  const balances = await tx.stockBalance.findMany({ where: { clientId: input.clientId, warehouseId: user.activeWarehouseId,
    skuId: mark.skuId, boxId: null, palletId: null, status: 'PACKING', quantity: { not: 0 } }, take: 2 });
  const balance = balances[0];
  if (balances.length !== 1 || !Number.isInteger(balance.quantity) || balance.quantity < 1 ||
      balance.warehouseId !== user.activeWarehouseId || balance.clientId !== input.clientId || balance.skuId !== mark.skuId ||
      balance.boxId || balance.palletId || balance.status !== 'PACKING')
    throw new ConflictException('Отобранный товар отсутствует в промежуточном остатке. Повторный приход не выполнен.');
  const where = { kiz: { startsWith: prefix } };
  const evidence = await Promise.all([
    tx.fbsTsdAssembly.findFirst({ where, select: { id: true } }), tx.shippedKizHistory.findFirst({ where, select: { id: true } }),
    tx.fbsWebKizStickerPrint.findFirst({ where, select: { id: true } }), tx.fbsAssemblyAttemptHistory.findFirst({ where, select: { id: true } }),
    tx.fbsPrintJob.findFirst({ where, select: { id: true } }),
    tx.kizCirculationItem.findFirst({ where: { kizRaw: { startsWith: prefix } }, select: { id: true } }),
  ]);
  if (evidence.some(Boolean)) throw new ConflictException('Этот КИЗ связан с заказом, отгрузкой, печатью или погашением. Приёмка не выполнена.');
  if (await tx.stockMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey } }))
    throw new ConflictException('Операция уже выполнена. Обновите сортировку.');
  const debit = await tx.stockBalance.updateMany({ where: { id: balance.id, quantity: balance.quantity, updatedAt: balance.updatedAt },
    data: { quantity: { decrement: 1 } } });
  if (debit.count !== 1) throw new ConflictException('Промежуточный остаток изменился. Повторите сканирование.');
  const common = { clientId: input.clientId, warehouseId: user.activeWarehouseId!, skuId: mark.skuId,
    type: 'MOVE' as const, sourceDocument: request.id, comment: `Приёмка сборки по SKU №${request.number} в ${target.code}; сортировка ${input.sessionId}` };
  await tx.stockMovement.create({ data: { ...common, boxId: null, palletId: null, status: 'PACKING', quantity: -1, idempotencyKey: `${input.idempotencyKey}:source` } });
  const movement = await tx.stockMovement.create({ data: { ...common, boxId: target.id, palletId: target.palletId,
    status: 'AVAILABLE', quantity: 1, idempotencyKey: input.idempotencyKey } });
  const changed = await tx.productMark.updateMany({ where: { id: mark.id, status: 'PACKING', boxId: null, sourceDocument: request.id, updatedAt: mark.updatedAt },
    data: { status: 'AVAILABLE', boxId: target.id, stockMovementId: movement.id } });
  if (changed.count !== 1) throw new ConflictException('КИЗ изменился параллельно. Приёмка отменена.');
  const received = await tx.skuCollectionScan.updateMany({ where: { id: scan.id, status: 'PICKED', receivedAt: null, updatedAt: scan.updatedAt },
    data: { status: 'RECEIVED', targetBoxId: target.id, targetBoxCode: target.code, receivedAt: new Date(), receivedByUserId: user.id, receivedByName: user.name } });
  if (received.count !== 1) throw new ConflictException('Единица уже принята другим сотрудником. Обновите сортировку.');
  const counted = await tx.skuCollectionSource.updateMany({ where: { id: source.id, receivedQuantity: source.receivedQuantity, pickedQuantity: source.pickedQuantity, updatedAt: source.updatedAt },
    data: { receivedQuantity: { increment: 1 } } });
  if (counted.count !== 1) throw new ConflictException('Состав сборки по SKU изменился. Приёмка отменена.');
  await increment({ clientId: input.clientId, warehouseId: user.activeWarehouseId!, skuId: mark.skuId, boxId: target.id, palletId: target.palletId, status: StockStatus.AVAILABLE, quantity: 1 });
  const totals = (await tx.skuCollectionSource.aggregate({ where: { requestId: request.id }, _sum: { plannedQuantity: true, pickedQuantity: true, receivedQuantity: true } }))._sum;
  const status = (totals.receivedQuantity ?? 0) >= (totals.plannedQuantity ?? 0) ? 'DONE'
    : (totals.pickedQuantity ?? 0) >= (totals.plannedQuantity ?? 0) ? 'PACKED' : 'IN_WORK';
  await tx.clientRequest.update({ where: { id: request.id }, data: { status } });
  await tx.auditLog.create({ data: { userId: user.id, action: 'PALLET_SORTING_SKU_COLLECTION_RECEIVED', entity: 'ProductMark', entityId: mark.id,
    payload: { sessionId: input.sessionId, identity, barcode: input.barcode, requestId: request.id, scanId: scan.id,
      sourceBoxId: scan.sourceBoxId, targetBoxId: target.id, movementId: movement.id, previousMarkMovementId: mark.stockMovementId,
      packingBalanceId: balance.id, previousPackingQuantity: balance.quantity, quantity: 1 } } });
  return { skuId: mark.skuId, movementId: movement.id, requestId: request.id, scanId: scan.id };
}
