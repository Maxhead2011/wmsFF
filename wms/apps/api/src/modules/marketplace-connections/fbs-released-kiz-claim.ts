import { ConflictException } from '@nestjs/common';
import { Prisma, FbsTsdAssembly } from '@prisma/client';

// FIX: enabled only for our WMS; released history must not occupy the live unique KIZ slot.
export async function claimReleasedFbsKiz(
  tx: Prisma.TransactionClient, task: FbsTsdAssembly, kiz: string, userId: string,
): Promise<FbsTsdAssembly> {
  const old = await tx.fbsTsdAssembly.findFirst({ where: { clientId: task.clientId, kiz, id: { not: task.id } } });
  if (!old) return task;
  const conflict = () => new ConflictException('КИЗ связан с другой сборкой. Обновите задание и передайте товар менеджеру.');
  if (old.status !== 'RELEASED' || old.skuId !== task.skuId || old.completedAt || old.cargoPackedAt ||
      old.marketplaceSubmittedAt || !['REJECTED', 'PENDING', 'NOT_REQUIRED'].includes(old.wbMetaStatus)) throw conflict();
  const [mark, printed, shipped] = await Promise.all([
    tx.productMark.findFirst({ where: { value: kiz, clientId: task.clientId, skuId: task.skuId, boxId: task.boxId, status: 'AVAILABLE' } }),
    tx.fbsWebKizStickerPrint.findFirst({ where: { OR: [{ assemblyId: old.id }, { kiz }] }, select: { id: true } }),
    tx.wbOrderShipment.findFirst({ where: { OR: [{ assemblyId: old.id }, { clientId: task.clientId, kiz }] }, select: { id: true } }),
  ]);
  if (!mark || printed || shipped) throw conflict();
  const released = await tx.fbsTsdAssembly.updateMany({
    where: { id: old.id, updatedAt: old.updatedAt, status: 'RELEASED', kiz }, data: { kiz: null },
  });
  if (released.count !== 1) throw conflict();
  const claimed = await tx.fbsTsdAssembly.updateMany({
    where: { id: task.id, updatedAt: task.updatedAt, status: 'IN_PROGRESS', workerUserId: userId, deviceCode: task.deviceCode, kiz: task.kiz },
    data: { kiz, wbMetaStatus: 'PENDING', errorMessage: null },
  });
  if (claimed.count !== 1) throw conflict();
  await tx.auditLog.create({ data: { userId, action: 'FBS_RELEASED_KIZ_RECLAIMED', entity: 'FbsTsdAssembly', entityId: task.id,
    payload: { kiz, previousTaskId: old.id, previousOrderId: old.orderId, previousRequestId: old.requestId,
      previousWbMetaStatus: old.wbMetaStatus, orderId: task.orderId, requestId: task.requestId, boxCode: task.boxCode } } });
  return tx.fbsTsdAssembly.findUniqueOrThrow({ where: { id: task.id } });
}
