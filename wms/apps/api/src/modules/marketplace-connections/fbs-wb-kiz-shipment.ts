import { ConflictException } from '@nestjs/common';
import { MovementType, Prisma, StockStatus, type FbsTsdAssembly } from '@prisma/client';

export const WB_KIZ_SHIPMENT_PREFIX = 'fbs-wb-shipment:';

// FIX: resolve a shipment only from the exact linked pair; a suggested box is not source evidence.
export async function inspectWbKizShipment(tx: Prisma.TransactionClient, task: FbsTsdAssembly, warehouseId: string) {
  if (!task.kiz?.trim() || !task.barcode?.trim() || task.itemCount !== 1) {
    throw new ConflictException('Для отгрузки по WB нужна точная пара КИЗ–ШК одной единицы.');
  }
  const [sku, mark, previous] = await Promise.all([
    tx.sku.findFirst({ where: { id: task.skuId, clientId: task.clientId }, include: { barcodes: true } }),
    tx.productMark.findUnique({ where: { clientId_value: { clientId: task.clientId, value: task.kiz } } }),
    tx.shippedKizHistory.findUnique({ where: { assemblyId: task.id } }),
  ]);
  if (!sku || !sku.barcodes.some(row => row.value === task.barcode) ||
    (mark && (mark.clientId !== task.clientId || mark.skuId !== task.skuId || mark.value !== task.kiz))) {
    throw new ConflictException('КИЗ и ШК не подтверждены для товара этого заказа. Нужна проверка пары.');
  }
  if (previous) {
    if (previous.clientId !== task.clientId || previous.requestId !== task.requestId || previous.orderId !== task.orderId ||
      previous.kiz !== task.kiz || previous.barcode !== task.barcode || previous.warehouseId !== warehouseId) {
      throw new ConflictException('Для заказа уже сохранена другая отгрузка. Нужна проверка истории.');
    }
    return { sku, mark, previous, source: null, sourceBoxCode: previous.sourceBoxCode ?? 'Без короба' };
  }
  if (mark && mark.updatedAt > (task.completedAt ?? task.updatedAt) && !['PACKING', 'SHIPPING'].includes(mark.status)) {
    throw new ConflictException('КИЗ изменён после сборки: возможна повторная приёмка. Нужна проверка истории.');
  }
  if (mark?.boxId && task.boxId && mark.boxId !== task.boxId) {
    throw new ConflictException('Исходный короб заказа и короб КИЗ не совпадают. Нужна проверка источника.');
  }
  const boxId = mark?.boxId ?? task.boxId;
  const source = boxId ? await tx.box.findFirst({ where: { id: boxId }, select: {
    id: true, code: true, clientId: true, warehouseId: true, palletId: true,
  } }) : null;
  if (source && (source.clientId !== task.clientId || source.warehouseId !== warehouseId)) {
    throw new ConflictException('Источник КИЗ находится у другого клиента или в другом филиале.');
  }
  return { sku, mark, previous: null, source, sourceBoxCode: source?.code ?? 'Без короба' };
}

// FIX: one immutable per-order shipment, with no arbitrary allocation from another box.
export async function shipWbKiz(tx: Prisma.TransactionClient, task: FbsTsdAssembly, warehouseId: string, checkedAt: Date) {
  const evidence = await inspectWbKizShipment(tx, task, warehouseId);
  const { sku, mark, source, previous, sourceBoxCode } = evidence;
  if (previous) return { shipped: true, sourceBoxCode, sourceBoxId: task.boxId, balanceDeducted: 0, alreadyShipped: true };
  const shippableStatuses: StockStatus[] = [StockStatus.AVAILABLE, StockStatus.PACKING, StockStatus.SHIPPING];
  if (mark && !shippableStatuses.includes(mark.status)) {
    throw new ConflictException('КИЗ заблокирован или зарезервирован другой складской операцией.');
  }
  const key = `${WB_KIZ_SHIPMENT_PREFIX}${task.id}`;
  if (await tx.stockMovement.findUnique({ where: { idempotencyKey: key } })) {
    throw new ConflictException('Отгрузка уже записана, но история пары не совпадает. Нужна проверка.');
  }
  // A previous request-wide shipment must not become a second per-order deduction.
  const previousRequestShipments = await tx.stockMovement.findMany({ where: {
    clientId: task.clientId, sourceDocument: task.requestId, type: MovementType.SHIP, quantity: { lt: 0 },
  }, select: { idempotencyKey: true } });
  if (previousRequestShipments.some(row => !row.idempotencyKey?.startsWith(WB_KIZ_SHIPMENT_PREFIX))) {
    throw new ConflictException('По заявке уже выполнена отгрузка. Сначала проверьте существующую историю КИЗ.');
  }
  const pickRows = await tx.stockMovement.findMany({ where: {
    clientId: task.clientId, skuId: task.skuId, warehouseId,
    idempotencyKey: { startsWith: `fbs-sticker-pick:${task.id}:` },
    status: { in: [StockStatus.PACKING, StockStatus.SHIPPING] },
  }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const netPicked = pickRows.reduce((sum, row) => sum + row.quantity, 0);
  const pickedLocation = netPicked > 0 ? [...pickRows].reverse().find(row => row.quantity > 0) : undefined;
  // Receipt directly linked to this mark can establish an actual no-box source.
  const markMovement = mark?.stockMovementId ? await tx.stockMovement.findUnique({ where: { id: mark.stockMovementId } }) : null;
  if (markMovement?.type === MovementType.SHIP) {
    throw new ConflictException('Для КИЗ уже существует списание. Проверьте отгрузку перед повторным подтверждением.');
  }
  const provenNoBox = mark?.boxId === null && markMovement?.clientId === task.clientId &&
    markMovement.skuId === task.skuId && markMovement.warehouseId === warehouseId && markMovement.boxId === null &&
    markMovement.quantity > 0 && ['RECEIPT', 'INITIAL_IMPORT'].includes(markMovement.type);
  const canUseAvailable = mark?.status === StockStatus.AVAILABLE && (Boolean(source) || provenNoBox);
  const stockStatuses: StockStatus[] = pickedLocation
    ? (mark?.status === StockStatus.SHIPPING ? [StockStatus.SHIPPING, StockStatus.PACKING] : [StockStatus.PACKING, StockStatus.SHIPPING])
    : [StockStatus.AVAILABLE];
  const stockBoxId = pickedLocation ? pickedLocation.boxId : source?.id ?? null;
  const stockPalletId = pickedLocation ? pickedLocation.palletId : source?.palletId ?? null;
  const balances = pickedLocation || canUseAvailable ? await tx.stockBalance.findMany({ where: {
    clientId: task.clientId, skuId: task.skuId, warehouseId, boxId: stockBoxId, palletId: stockPalletId,
    status: { in: stockStatuses }, quantity: { gt: 0 },
  }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }] }) : [];
  const balance = balances.filter(row => row.clientId === task.clientId && row.skuId === task.skuId &&
    row.warehouseId === warehouseId && row.boxId === stockBoxId && row.palletId === stockPalletId && stockStatuses.includes(row.status) && row.quantity > 0)
    .sort((a, b) => stockStatuses.indexOf(a.status) - stockStatuses.indexOf(b.status))[0];
  if (balance) {
    const changed = await tx.stockBalance.updateMany({ where: { id: balance.id, quantity: balance.quantity, updatedAt: balance.updatedAt },
      data: { quantity: { decrement: 1 } } });
    if (changed.count !== 1) throw new ConflictException('Остаток изменился во время подтверждения отгрузки.');
    await tx.stockBalance.deleteMany({ where: { id: balance.id, quantity: 0 } });
  } else {
    // Unknown historical source: reconcile only the outgoing ledger, never create AVAILABLE.
    await tx.stockMovement.create({ data: { clientId: task.clientId, skuId: task.skuId, warehouseId,
      boxId: null, palletId: null, type: MovementType.INVENTORY_ADJUSTMENT, status: StockStatus.SHIPPING, quantity: 1,
      sourceDocument: task.requestId, idempotencyKey: `${key}:historical-source`,
      comment: `WB ${task.orderId}: подтверждена отгрузка КИЗ–ШК без найденного остатка; доступный остаток не увеличен.` } });
  }
  const movement = await tx.stockMovement.create({ data: { clientId: task.clientId, skuId: task.skuId, warehouseId,
    boxId: balance?.boxId ?? null, palletId: balance?.palletId ?? null,
    type: MovementType.SHIP, status: balance?.status ?? StockStatus.SHIPPING, quantity: -1,
    sourceDocument: task.requestId, idempotencyKey: key,
    comment: `Отгрузка по WB ${task.orderId}; КИЗ ${task.kiz}; ШК ${task.barcode}; источник: ${sourceBoxCode}.` } });
  if (mark) {
    const changed = await tx.productMark.updateMany({ where: { id: mark.id, updatedAt: mark.updatedAt, skuId: task.skuId, value: task.kiz! },
      data: { status: StockStatus.SHIPPING, boxId: null, stockMovementId: movement.id } });
    if (changed.count !== 1) throw new ConflictException('КИЗ изменился во время подтверждения отгрузки.');
  } else {
    await tx.productMark.create({ data: { clientId: task.clientId, skuId: task.skuId, value: task.kiz!,
      status: StockStatus.SHIPPING, boxId: null, stockMovementId: movement.id, sourceDocument: `WB shipment ${task.orderId}` } });
  }
  const request = await tx.clientRequest.findUnique({ where: { id: task.requestId }, include: { client: { select: { name: true } } } });
  if (!request || request.clientId !== task.clientId || request.warehouseId !== warehouseId) throw new ConflictException('Заявка изменилась.');
  await tx.shippedKizHistory.create({ data: { assemblyId: task.id, clientId: task.clientId, warehouseId,
    clientName: request.client.name, requestId: request.id, requestNumber: request.number, requestTitle: request.title,
    orderId: task.orderId, supplyId: task.supplyId, skuId: sku.id, internalSku: sku.internalSku, barcode: task.barcode,
    article: sku.article, productName: sku.name, color: sku.color, size: sku.size, kiz: task.kiz!,
    sourceBoxCode, arrivalAt: mark?.createdAt ?? null, shippedAt: checkedAt } });
  return { shipped: true, sourceBoxCode, sourceBoxId: source?.id ?? null, balanceDeducted: balance ? 1 : 0, alreadyShipped: false };
}
