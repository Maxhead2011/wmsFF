import { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { FabricProductionProof } from './fabric-fbs-confirmation';

// FIX: only the confirmation transaction calls this writer. Produced pieces are
// already owned by an order; they must never appear as freely available goods.
export async function writeFabricProduction(tx: Prisma.TransactionClient, proof: FabricProductionProof): Promise<void> {
  if (!Number.isSafeInteger(proof.units) || proof.units <= 0 || !Number.isSafeInteger(proof.mm) || proof.mm <= 0 ||
      ![proof.key, proof.taskId, proof.clientId, proof.requestId, proof.skuId, proof.warehouseId, proof.userId, proof.deviceCode,
        proof.marketplace, proof.connectionId, proof.orderId, proof.lineId, proof.material, proof.color].every(v => typeof v === 'string' && !!v.trim()) ||
      !Number.isFinite(Date.parse(proof.at))) throw new ConflictException('Некорректное подтверждение производства.');
  const movementKey = `fbs-sticker-pick:${proof.taskId}:fabric:${proof.key}`;
  // A duplicate proof here indicates inconsistent ledger state, not a new cut.
  // Let the surrounding transaction roll back instead of debiting raw material.
  if (await tx.stockMovement.findUnique({ where: { idempotencyKey: movementKey }, select: { id: true } })) {
    throw new ConflictException('Нарезка уже записана. Обновите задание и проверьте учёт рулонов.');
  }
  await tx.stockMovement.create({ data: {
    warehouseId: proof.warehouseId, clientId: proof.clientId, skuId: proof.skuId,
    boxId: null, palletId: null, status: 'PACKING', type: 'INVENTORY_ADJUSTMENT', quantity: proof.units,
    sourceDocument: proof.requestId, idempotencyKey: movementKey,
    comment: `Нарезка под заказ ${proof.marketplace} ${proof.orderId}: ${proof.units} шт., ${proof.mm / 1000} м.`,
  } });
  const balanceKey = [proof.clientId, proof.skuId, 'no-box', 'no-pallet', 'PACKING', 'warehouse', proof.warehouseId].join(':');
  await tx.stockBalance.upsert({ where: { balanceKey },
    create: { balanceKey, warehouseId: proof.warehouseId, clientId: proof.clientId, skuId: proof.skuId,
      boxId: null, palletId: null, status: 'PACKING', quantity: proof.units },
    update: { quantity: { increment: proof.units } },
  });
  // A distinct action keeps the old generic CUT-credit allocator from consuming
  // this order-bound production on behalf of an unrelated historical shipment.
  await tx.auditLog.create({ data: { userId: proof.userId, action: 'FABRIC_FBS_CUT', entity: 'FabricRolls',
    entityId: proof.clientId, payload: { ...proof, movementKey, version: 1,
      storageRollEquivalentDelta: -proof.mm / 100000, volumeLiters: 24.740, lengthCm: 140, diameterCm: 15 } } });
  await tx.clientRequestEvent.create({ data: { requestId: proof.requestId, clientId: proof.clientId,
    eventType: 'COMMENT', createdByUserId: proof.userId, title: 'Подтверждена нарезка ткани для ФБС',
    body: JSON.stringify({ ...proof, movementKey }),
  } });
}
