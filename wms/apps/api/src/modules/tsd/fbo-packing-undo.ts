import { ConflictException } from '@nestjs/common';
import { Prisma, FboAssemblyUnit } from '@prisma/client';

// FIX: keep an immutable receipt for the exact packed unit, not a barcode-based guess.
export async function rememberPackedUnit(tx: Prisma.TransactionClient, unit: FboAssemblyUnit, actorId: string, key: string) {
    if (process.env.WMS_FBO_PACK_UNDO_ENABLED !== 'true') return;
    await tx.auditLog.create({ data: { id: `fbo-pack:${key}`, userId: actorId, action: 'FBO_PACK_UNDO_RECEIPT', entity: 'FboAssemblyUnit', entityId: key,
        payload: { unitId: unit.id, requestId: unit.requestId, boxId: unit.targetBoxId, packedAt: unit.packedAt!.toISOString() } } });
}

// FIX: run inside the request's existing Serializable transaction and lock.
export async function packedUnitForUndo(tx: Prisma.TransactionClient, requestId: string, operationId: string | undefined, actorId: string) {
    if (process.env.WMS_FBO_PACK_UNDO_ENABLED !== 'true') throw new ConflictException('Отмена упаковки выключена.');
    if (!operationId) throw new ConflictException('Нет последней единицы для отмены.');
    const receipt = await tx.auditLog.findUnique({ where: { id: `fbo-pack:${requestId}:${operationId}` } });
    const p = receipt?.payload as { unitId?: string; requestId?: string; boxId?: string; packedAt?: string } | undefined;
    if (!p?.unitId || p.requestId !== requestId || receipt?.userId !== actorId) throw new ConflictException('Подтверждение этой упаковки не найдено.');
    const unit = await tx.fboAssemblyUnit.findUnique({ where: { id: p.unitId } });
    if (!unit || unit.requestId !== requestId || unit.state !== 'PACKED' || unit.wholeBox || unit.targetBoxId !== p.boxId ||
        unit.packedByUserId !== actorId || unit.packedAt?.toISOString() !== p.packedAt)
        throw new ConflictException('Единица уже отменена или её упаковка изменилась.');
    const box = await tx.fboAssemblyBox.findUnique({ where: { activeBoxId: unit.targetBoxId! } });
    if (!box || box.requestId !== requestId || box.closedAt || box.confirmedAt || box.wholeBox)
        throw new ConflictException('Отмена доступна только в открытом коробе.');
    // Indexed request/createdAt lookup; never scan the complete audit history.
    const later = await tx.fboAssemblyAction.findFirst({ where: { requestId, actorId, id: { not: `${requestId}:${operationId}` }, createdAt: { gte: receipt!.createdAt } } });
    if (later) throw new ConflictException('После упаковки выполнена другая операция. Можно отменить только последнюю единицу.');
    return unit;
}
