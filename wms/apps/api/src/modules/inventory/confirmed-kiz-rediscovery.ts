import { ConflictException } from '@nestjs/common';
import { Prisma, ProductMark } from '@prisma/client';
import { physicalKizIdentity } from '../../common/kiz-physical-identity';

// FIX: a receipt KIZ can be BLOCKED solely because a previous count did not find it.
// Call only after validating current physical scans and administrator scope, inside
// the same Serializable transaction. This proof does not credit stock or erase history.
export async function confirmedKizRediscovery(tx: Prisma.TransactionClient, input: {
  mark: ProductMark; clientId: string; warehouseId: string; skuId: string;
  identity: string; startedAt: Date;
}): Promise<{ markId: string; exclusionProofId: string } | null> {
  const { mark, clientId, warehouseId, skuId, identity, startedAt } = input;
  if (process.env.WMS_INVENTORY_FOUND_KIZ_RESTORE_ENABLED !== 'true' ||
      mark.status !== 'BLOCKED' || mark.boxId !== null || !(mark.updatedAt < startedAt) ||
      mark.clientId !== clientId || mark.skuId !== skuId || physicalKizIdentity(mark.value) !== identity) return null;
  const proof = await tx.auditLog.findFirst({ where: {
    action: 'INVENTORY_KIZ_COMPOSITION_CONFIRMED', entity: 'InventoryAuditBox',
    createdAt: { gte: mark.updatedAt, lt: startedAt },
    payload: { path: ['archivedMarkIds'], array_contains: [mark.id] },
  }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  select: { id: true, entityId: true, createdAt: true, payload: true } });
  const p = proof?.payload as Prisma.JsonObject | null;
  if (!proof || !p || p.auditBoxId !== proof.entityId || p.clientId !== clientId || p.warehouseId !== warehouseId ||
      p.archiveReason !== 'Не подтверждено при пересчёте' || !Array.isArray(p.archivedMarkIds) ||
      !p.archivedMarkIds.includes(mark.id) || !Array.isArray(p.retiredMarks) ||
      typeof p.roundStartedAt !== 'string' || !(new Date(p.roundStartedAt) < mark.updatedAt) ||
      !(mark.updatedAt <= proof.createdAt && proof.createdAt < startedAt)) return null;
  const previous = p.retiredMarks.filter((row): row is Prisma.JsonObject => Boolean(row) &&
    typeof row === 'object' && !Array.isArray(row) && (row as Prisma.JsonObject).id === mark.id);
  if (previous.length !== 1) return null;
  const old = previous[0];
  if (!['AVAILABLE', 'RESERVED'].includes(String(old.status)) || typeof old.boxId !== 'string' || old.boxId !== p.boxId ||
      old.clientId !== clientId || old.skuId !== skuId || typeof old.value !== 'string' ||
      physicalKizIdentity(old.value) !== identity || old.sourceDocument !== mark.sourceDocument ||
      old.stockMovementId !== mark.stockMovementId || typeof old.updatedAt !== 'string' ||
      !(new Date(old.updatedAt) < mark.updatedAt)) return null;

  const prefixes = [identity, ']d2' + identity, ']D2' + identity];
  const where = { OR: prefixes.map(prefix => ({ kiz: { startsWith: prefix } })) };
  const history = await Promise.all([
    tx.fbsTsdAssembly.findFirst({ where, select: { id: true } }),
    tx.shippedKizHistory.findFirst({ where, select: { id: true } }),
    tx.fbsWebKizStickerPrint.findFirst({ where, select: { id: true } }),
    tx.fbsAssemblyAttemptHistory.findFirst({ where, select: { id: true } }),
    tx.fbsPrintJob.findFirst({ where, select: { id: true } }),
    tx.kizCirculationItem.findFirst({ where: { OR: prefixes.map(prefix => ({ kizRaw: { startsWith: prefix } })) }, select: { id: true } }),
    tx.fboAssemblyUnit.findFirst({ where: { OR: [{ markId: mark.id }, { activeMarkId: mark.id }, ...where.OR] }, select: { id: true } }),
    tx.wbOrderShipment.findFirst({ where, select: { id: true } }),
  ]);
  if (history.some(Boolean)) throw new ConflictException('У найденного КИЗ есть история заказа или передачи. Нужна отдельная проверка возврата или переклейка КИЗ.');
  return { markId: mark.id, exclusionProofId: proof.id };
}
