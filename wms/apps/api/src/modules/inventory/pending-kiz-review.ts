import { Prisma } from '@prisma/client';

type ReviewBox = { id: string; boxId: string; startedAt: Date };
// FIX: check saved rounds in bounded batches instead of thousands of serial database calls.
export async function pendingScannedReviewIds(tx: Prisma.TransactionClient, boxes: ReviewBox[]): Promise<Set<string>> {
  const pending = new Set<string>();
  const byId = new Map(boxes.map(box => [box.id, box]));
  const boxIds = [...new Set(boxes.map(box => box.boxId))];
  for (let offset = 0; offset < boxIds.length; offset += 500) {
    const latest = await tx.inventoryAuditBox.findMany({
      where: { boxId: { in: boxIds.slice(offset, offset + 500) } },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], distinct: ['boxId'],
      select: { id: true, boxId: true, startedAt: true, status: true },
    });
    const candidates = latest.filter(box => box.status !== 'COUNTING' && byId.get(box.id)?.startedAt.getTime() === box.startedAt.getTime());
    if (!candidates.length) continue;
    const proofId = (box: ReviewBox) => `inventory-kiz-confirm:${box.id}:${box.startedAt.toISOString()}`;
    const proofs = await tx.auditLog.findMany({ where: { id: { in: candidates.map(proofId) } }, select: { id: true } });
    const confirmed = new Set(proofs.map(proof => proof.id));
    const unconfirmed = candidates.filter(box => !confirmed.has(proofId(box)));
    if (!unconfirmed.length) continue;
    const scans = await tx.auditLog.findMany({ where: {
      action: 'INVENTORY_KIZ_SCAN', entity: 'InventoryAuditBox',
      entityId: { in: unconfirmed.map(box => box.id) },
      createdAt: { gte: new Date(Math.min(...unconfirmed.map(box => box.startedAt.getTime()))) },
    }, select: { entityId: true, createdAt: true } });
    const starts = new Map(unconfirmed.map(box => [box.id, box.startedAt.getTime()]));
    for (const scan of scans) {
      const start = scan.entityId ? starts.get(scan.entityId) : undefined;
      if (scan.entityId && start !== undefined && scan.createdAt.getTime() >= start) pending.add(scan.entityId);
    }
  }
  return pending;
}
