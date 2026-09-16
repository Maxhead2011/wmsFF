import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { kizIdentityTransferEnabled, physicalKizIdentity } from '../../common/kiz-physical-identity';

// FIX: acquire sorting-compatible identity/box locks before a count changes balances.
export async function lockInventoryKizTransferSources(tx: Prisma.TransactionClient, auditId: string) {
  if (!kizIdentityTransferEnabled()) return;
  const audit = await tx.inventoryAuditBox.findUniqueOrThrow({ where: { id: auditId } });
  const evidence = await tx.auditLog.findMany({ where: { action: 'INVENTORY_KIZ_SCAN', entityId: auditId,
    createdAt: { gte: audit.startedAt } }, select: { payload: true } });
  const keys = [...new Set(evidence.flatMap(row => {
    const v = row.payload as Prisma.JsonObject | null;
    return v?.boxId === audit.boxId && v.clientId === audit.clientId && v.roundStartedAt === audit.startedAt.toISOString() && typeof v.kiz === 'string'
      ? [physicalKizIdentity(v.kiz)].filter(Boolean) : [];
  }))].sort();
  for (const key of keys) await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`sorting-kiz:${key}`}))`);
  const marks = keys.length ? await tx.productMark.findMany({ where: {
    OR: keys.flatMap(key => [key, ']d2' + key, ']D2' + key]).map(prefix => ({ value: { startsWith: prefix } })),
  }, select: { boxId: true } }) : [];
  const boxes = [...new Set([audit.boxId, ...marks.map(m => m.boxId).filter((id): id is string => Boolean(id))])].sort();
  for (const boxId of boxes) await tx.$queryRaw(Prisma.sql`SELECT id FROM "Box" WHERE id = ${boxId} FOR UPDATE`);
}

// FIX: read-only preview for the existing administrator confirmation screen.
export async function inventoryKizTransferWarnings(tx: Prisma.TransactionClient, audit: {
  id: string; boxId: string; boxCode: string; clientId: string; startedAt: Date;
}) {
  if (!kizIdentityTransferEnabled()) return [];
  const evidence = await tx.auditLog.findMany({ where: { action: 'INVENTORY_KIZ_SCAN', entityId: audit.id,
    createdAt: { gte: audit.startedAt } }, select: { payload: true } });
  const identities = [...new Set(evidence.flatMap(row => {
    const payload = row.payload as Prisma.JsonObject | null;
    return payload?.boxId === audit.boxId && payload.clientId === audit.clientId && payload.roundStartedAt === audit.startedAt.toISOString() &&
      typeof payload.kiz === 'string' ? [physicalKizIdentity(payload.kiz)].filter(Boolean) : [];
  }))];
  if (!identities.length) return [];
  const marks = await tx.productMark.findMany({ where: { clientId: audit.clientId, boxId: { not: audit.boxId },
    OR: identities.flatMap(value => [value, ']d2' + value, ']D2' + value]).map(prefix => ({ value: { startsWith: prefix } })) },
    include: { box: { select: { code: true } } } });
  return marks.filter(mark => mark.box && identities.includes(physicalKizIdentity(mark.value))).map(mark =>
    `КИЗ ${physicalKizIdentity(mark.value)} числится в ${mark.box!.code}, отсканирован в ${audit.boxCode}. Подтверждение перенесёт КИЗ и спишет 1 шт. из исходного короба; в целевом коробе единица уже включена в пересчёт.`);
}

// FIX: the destination has already been counted. Debit only the previous physical
// box, in the SAME serializable transaction as mark ownership and audit proof.
export async function debitConfirmedKizSource(tx: Prisma.TransactionClient, input: {
  mark: { id: string; clientId: string; skuId: string; boxId: string | null; status: string };
  destination: { id: string; clientId: string; warehouseId: string | null };
  auditId: string; startedAt: Date; userId: string;
}) {
  const { mark, destination, auditId, startedAt } = input;
  if (!kizIdentityTransferEnabled() || !mark.boxId || mark.boxId === destination.id) return null;
  const stop = (detail: string): never => { throw new ConflictException(`Перенос КИЗ остановлен: ${detail}`); };
  const source = await tx.box.findUnique({ where: { id: mark.boxId } });
  if (!source || source.clientId !== destination.clientId || source.warehouseId !== destination.warehouseId ||
      !['active', 'receiving'].includes(source.status) || mark.status !== 'AVAILABLE') stop('изменился исходный короб или статус товара.');
  const [reserved, count, movement, balances] = await Promise.all([
    tx.fbsTsdAssembly.findFirst({ where: { clientId: mark.clientId,
      status: { in: ['RESERVED', 'RESCAN_REQUIRED', 'IN_PROGRESS', 'RETURN_REQUIRED'] },
      AND: [{ OR: [{ boxId: mark.boxId }, { reservedBoxId: mark.boxId }] },
        { OR: [{ skuId: mark.skuId }, { sourceSkuId: mark.skuId }] }] }, select: { id: true } }),
    tx.inventoryAuditBox.findFirst({ where: { boxId: mark.boxId, status: 'COUNTING' }, select: { id: true } }),
    tx.stockMovement.findFirst({ where: { boxId: mark.boxId, skuId: mark.skuId, status: 'AVAILABLE',
      createdAt: { gt: startedAt }, NOT: { sourceDocument: `inventory-kiz-transfer:${auditId}` } }, select: { id: true } }),
    tx.stockBalance.findMany({ where: { boxId: mark.boxId, skuId: mark.skuId }, orderBy: { id: 'asc' } }),
  ]);
  if (reserved) stop('товар исходного короба используется активной сборкой.');
  if (count || movement) stop('исходный короб пересчитывается или его остаток изменился после начала проверки.');
  if (balances.some(row => row.clientId !== destination.clientId || row.warehouseId !== destination.warehouseId ||
      row.quantity < 0 || row.quantity > 0 && row.status !== 'AVAILABLE')) stop('в исходном коробе есть резерв или недоступный остаток.');
  const balance = balances.find(row => row.status === 'AVAILABLE' && row.quantity > 0)
    ?? stop('в исходном коробе нет доступной единицы; нужна проверка истории списания.');
  const changed = await tx.stockBalance.updateMany({ where: { id: balance.id, updatedAt: balance.updatedAt, quantity: balance.quantity },
    data: { quantity: { decrement: 1 } } });
  if (changed.count !== 1) stop('остаток исходного короба изменился параллельно.');
  const out = await tx.stockMovement.create({ data: { clientId: mark.clientId, warehouseId: source!.warehouseId,
    skuId: mark.skuId, boxId: source!.id, palletId: balance.palletId, status: 'AVAILABLE', type: 'MOVE', quantity: -1,
    sourceDocument: `inventory-kiz-transfer:${auditId}`, idempotencyKey: `inventory-kiz-transfer:${auditId}:${mark.id}:out`,
    comment: `Подтверждённый перенос КИЗ из ${source!.code} в короб ${destination.id}. Целевая единица уже учтена пересчётом; повторного прихода нет. Администратор: ${input.userId}.` } });
  return { markId: mark.id, sourceBoxId: source!.id, sourceBoxCode: source!.code, destinationBoxId: destination.id,
    movementId: out.id, quantity: 1, sourceBalanceBefore: balance, destinationAlreadyCounted: true };
}
