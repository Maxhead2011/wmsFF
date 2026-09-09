import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';

// FIX: physical reconciliation owns stock movements; this adapter only settles the original
// SKU collection checklist, so its normal receipt cannot receive the same unit again.
export async function settleAdminSortingSkuReceipt(tx: Prisma.TransactionClient,
  mark: { id: string; boxId: string | null; status: string; clientId: string; skuId: string; sourceDocument: string | null } | undefined,
  target: { id: string; code: string }, identity: { gtin: string; serial: string },
  parseIdentity: (value: string) => { gtin: string; serial: string } | null, user: AuthUser) {
  if (!mark || mark.boxId || mark.status !== 'PACKING' || !mark.sourceDocument) return;
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ClientRequest" WHERE "id" = ${mark.sourceDocument} FOR UPDATE`);
  const request = await tx.clientRequest.findUnique({ where: { id: mark.sourceDocument } });
  if (!request || request.type !== 'SKU_COLLECTION' || request.clientId !== mark.clientId) return;
  const candidates = await tx.skuCollectionScan.findMany({ where: { requestId: request.id, skuId: mark.skuId, status: 'PICKED', receivedAt: null }, include: { source: true } });
  const scans = candidates.filter(scan => {
    const parsed = parseIdentity(scan.kiz ?? '');
    return parsed?.gtin === identity.gtin && parsed.serial === identity.serial;
  });
  if (!scans.length) return;
  if (scans.length !== 1) throw new ConflictException('В сборке по SKU несколько незавершённых записей одного КИЗа. Перемещение не выполнено.');
  const scan = scans[0], source = scan.source;
  if (source.requestId !== request.id || source.skuId !== mark.skuId || source.clientId !== mark.clientId)
    throw new ConflictException('Изменился состав сборки по SKU. Повторите проверку.');
  const received = await tx.skuCollectionScan.updateMany({ where: { id: scan.id, status: 'PICKED', receivedAt: null, updatedAt: scan.updatedAt },
    data: { status: 'RECEIVED', targetBoxId: target.id, targetBoxCode: target.code, receivedAt: new Date(), receivedByUserId: user.id, receivedByName: user.name } });
  if (received.count !== 1) throw new ConflictException('Приёмка по SKU изменилась параллельно. Повторите скан.');
  const counted = await tx.skuCollectionSource.updateMany({ where: { id: source.id, receivedQuantity: source.receivedQuantity, updatedAt: source.updatedAt },
    data: { receivedQuantity: { increment: 1 } } });
  if (counted.count !== 1) throw new ConflictException('Счётчик сборки по SKU изменился параллельно. Повторите скан.');
  // FIX: preserve terminal cancellation/archival decisions; only refresh active collection progress.
  if (['APPROVED', 'IN_WORK', 'PACKED'].includes(request.status)) {
    const totals = (await tx.skuCollectionSource.aggregate({ where: { requestId: request.id }, _sum: { plannedQuantity: true, pickedQuantity: true, receivedQuantity: true } }))._sum;
    const status = (totals.receivedQuantity ?? 0) >= (totals.plannedQuantity ?? 0) ? 'DONE'
      : (totals.pickedQuantity ?? 0) >= (totals.plannedQuantity ?? 0) ? 'PACKED' : 'IN_WORK';
    await tx.clientRequest.update({ where: { id: request.id }, data: { status } });
  }
  await tx.auditLog.create({ data: { userId: user.id, action: 'PALLET_SORTING_SKU_COLLECTION_RECEIVED', entity: 'ProductMark', entityId: mark.id,
    payload: { requestId: request.id, scanId: scan.id, targetBoxId: target.id, previousReceivedQuantity: source.receivedQuantity, quantity: 1, physicalTruth: true } } });
}
