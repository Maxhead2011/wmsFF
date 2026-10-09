import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { receiptBarcodeRisk } from './receipt-barcode-policy';

// FIX: legacy receipts already created stock. Quarantine with paired ledger entries,
// never replay the original receipt or silently delete its history.
export async function holdLegacyBarcode(tx: Prisma.TransactionClient, operationId: string, warehouseId: string, actorId: string) {
  await tx.$queryRaw`SELECT id FROM "TsdOperation" WHERE id=${operationId} FOR UPDATE`;
  const original = await tx.tsdOperation.findUniqueOrThrow({ where: { id: operationId } });
  const payload = original.payload as Prisma.JsonObject;
  const known = await tx.barcode.findFirst({ where: { value: String(payload.barcode || ''), sku: { clientId: String(payload.clientId || ''), isDraft: false } }, select: { id: true } });
  if (!receiptBarcodeRisk(String(payload.barcode || ''), !!known)) throw new BadRequestException('ШК не требует разбора.');
  const operationKey = `barcode-review-legacy:${original.operationKey}`;
  const existing = await tx.tsdOperation.findUnique({ where: { operationKey } });
  if (existing) return existing;
  if (original.operationType !== 'receipt_scan' || original.status !== 'ACCEPTED' || original.reviewedAt) throw new BadRequestException('Необычный приход уже изменён.');
  const movement = await tx.stockMovement.findUnique({ where: { idempotencyKey: original.operationKey } });
  if (!movement || movement.type !== 'RECEIPT' || movement.status !== 'AVAILABLE' || !movement.boxId || movement.warehouseId !== warehouseId
      || movement.quantity !== Number(payload.quantity) || movement.clientId !== payload.clientId) throw new BadRequestException('Исходный приход не соответствует обращению.');
  const later = await tx.stockMovement.count({ where: { boxId: movement.boxId, skuId: movement.skuId, id: { not: movement.id } } });
  const marks = await tx.productMark.count({ where: { boxId: movement.boxId, skuId: movement.skuId } });
  if (later || marks) throw new BadRequestException('Товар уже участвовал в движениях или имеет КИЗ. Нужна отдельная сверка.');
  const balances = await tx.stockBalance.findMany({ where: { boxId: movement.boxId, skuId: movement.skuId, quantity: { not: 0 } } });
  const balance = balances[0];
  if (balances.length !== 1 || balance.status !== 'AVAILABLE' || balance.quantity !== movement.quantity || balance.clientId !== movement.clientId) throw new BadRequestException('Остаток изменился. Карантин остановлен.');
  const changed = await tx.stockBalance.updateMany({ where: { id: balance.id, quantity: balance.quantity }, data: { quantity: 0 } });
  if (changed.count !== 1) throw new BadRequestException('Остаток изменился. Повторите сверку.');
  const coordinates = { clientId: balance.clientId, warehouseId, skuId: balance.skuId, boxId: balance.boxId, palletId: balance.palletId };
  const balanceKey = [balance.clientId, balance.skuId, balance.boxId, balance.palletId ?? 'no-pallet', 'BLOCKED'].join(':');
  const held = await tx.stockBalance.upsert({ where: { balanceKey }, update: { quantity: { increment: balance.quantity } },
    create: { ...coordinates, balanceKey, status: 'BLOCKED', quantity: balance.quantity } });
  for (const incoming of [false, true]) await tx.stockMovement.create({ data: { ...coordinates,
    type: 'MOVE', status: incoming ? 'BLOCKED' : 'AVAILABLE', quantity: (incoming ? 1 : -1) * balance.quantity,
    sourceDocument: movement.sourceDocument, idempotencyKey: `${operationKey}:${incoming ? 'in' : 'out'}`,
    comment: 'Подозрительный исторический ШК: ожидает проверки администратора',
  } });
  const issue = await tx.tsdOperation.create({ data: { operationKey, operationType: 'receipt_scan', deviceId: original.deviceId,
    status: 'NEEDS_REVIEW', reviewReason: 'VALIDATION_ERROR', serverMessage: 'Историческая позиция перемещена в недоступный остаток до проверки ШК.',
    payload: { ...payload, barcodeReview: 'PENDING', barcodeReviewReason: 'Подозрительный ШК ранее принятого товара',
      firstBarcodeScan: String(payload.barcode || ''), secondBarcodeScan: '', warehouseId,
      originalOperationId: original.id, originalScannedAt: original.createdAt.toISOString(), legacyHeldBalanceId: held.id,
    },
  } });
  await tx.auditLog.create({ data: { userId: actorId, action: 'RECEIPT_BARCODE_LEGACY_HELD', entity: 'TsdOperation', entityId: issue.id,
    payload: { originalOperationId: original.id, originalMovementId: movement.id, originalBalance: JSON.parse(JSON.stringify(balance)), heldBalanceId: held.id } } });
  return issue;
}

export async function consumeLegacyHold(tx: Prisma.TransactionClient, id: string, operationKey: string, clientId: string, warehouseId: string, quantity: number) {
  await tx.$queryRaw`SELECT id FROM "StockBalance" WHERE id=${id} FOR UPDATE`;
  const balance = await tx.stockBalance.findUniqueOrThrow({ where: { id } });
  if (balance.status !== 'BLOCKED' || balance.clientId !== clientId || balance.warehouseId !== warehouseId || balance.quantity < quantity) throw new BadRequestException('Карантинный остаток изменён. Решение остановлено.');
  await tx.stockBalance.update({ where: { id }, data: { quantity: { decrement: quantity } } });
  await tx.stockMovement.create({ data: { clientId, warehouseId, skuId: balance.skuId, boxId: balance.boxId, palletId: balance.palletId,
    status: 'BLOCKED', type: 'INVENTORY_ADJUSTMENT', quantity: -quantity, sourceDocument: operationKey,
    idempotencyKey: `${operationKey}:resolve-hold`, comment: 'Разбор исторического подозрительного ШК, решение в истории ТСД',
  } });
}
