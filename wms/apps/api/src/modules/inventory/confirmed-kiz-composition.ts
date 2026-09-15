import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';

export const confirmedKizCompositionId = (auditId: string, startedAt: Date) => `inventory-kiz-confirm:${auditId}:${startedAt.toISOString()}`;
const identity = (value: string) => /^(01\d{14}21[^\u0000-\u001f]{13})(?:\u001d|$)/
  .exec(value.trim().replace(/^\]d2/i, '').replace(/<GS>/gi, '\u001d'))?.[1] ?? '';

type CountedAudit = Prisma.InventoryAuditBoxGetPayload<{ include: { session: true; lines: true } }>;

// FIX: reuse a newer count only when it proves precisely the same physical units.
// This read-only check does not replace scans or approve either inventory session.
export async function matchingLatestKizAudit(tx: Prisma.TransactionClient, audit: CountedAudit) {
  const latest = await tx.inventoryAuditBox.findFirst({ where: { boxId: audit.boxId },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], include: { session: true, lines: true } });
  if (latest?.id === audit.id) return audit;
  if (!latest?.session || !latest.lines || latest.status === 'COUNTING' || latest.session.type !== 'BOX_CHECK' ||
      !['ACTIVE', 'REVIEW', 'COMPLETED'].includes(latest.session.status) || latest.clientId !== audit.clientId ||
      latest.session.clientId !== audit.session.clientId ||
      latest.session.warehouseId && audit.session.warehouseId && latest.session.warehouseId !== audit.session.warehouseId ||
      latest.lines.some(l => l.decision === 'PENDING' || l.difference !== 0 && l.decision !== 'APPLY_ACTUAL')) return null;
  const quantities = (a: CountedAudit) => JSON.stringify(a.lines.filter(l => l.countedQuantity !== 0)
    .map(l => [l.skuId, l.countedQuantity]).sort());
  if (quantities(audit) !== quantities(latest)) return null;
  const scans = async (a: CountedAudit) => {
    const rows = await tx.auditLog.findMany({ where: { action: 'INVENTORY_KIZ_SCAN', entity: 'InventoryAuditBox',
      entityId: a.id, createdAt: { gte: a.startedAt } }, select: { payload: true } });
    const values = rows.map(r => r.payload as Record<string, unknown> | null).filter(r => r &&
      r.roundStartedAt === a.startedAt.toISOString() && r.sessionId === a.sessionId && r.boxId === a.boxId &&
      r.clientId === a.clientId && a.lines.some(l => l.id === r.lineId && l.skuId === r.skuId));
    if (!values.length || values.some(r => typeof r!.kiz !== 'string' || !identity(r!.kiz as string))) return null;
    return values.map(r => `${r!.skuId}:${identity(r!.kiz as string)}`).sort();
  };
  const [oldScans, newScans] = await Promise.all([scans(audit), scans(latest)]);
  return oldScans && newScans && JSON.stringify(oldScans) === JSON.stringify(newScans) ? latest : null;
}

// FIX: caller supplies the inventory decision's Serializable transaction. Counted stock
// is already adjusted; changing its KIZ composition must never debit or receive it again.
export async function confirmInventoryKizComposition(tx: Prisma.TransactionClient, auditId: string, user: AuthUser) {
  if (process.env.WMS_FBS_KIZ_MANDATORY_AUDIT !== 'true' || user.isDemo ||
      !user.roleCodes.some(code => ['ADMIN', 'OWNER'].includes(code))) return;
  const stop = (message: string): never => { throw new ConflictException(message); };
  const audit = await tx.inventoryAuditBox.findUnique({ where: { id: auditId }, include: { session: true, lines: true } });
  if (!audit || audit.session.type !== 'BOX_CHECK' || audit.status === 'COUNTING') return;
  const id = confirmedKizCompositionId(audit.id, audit.startedAt);
  if (await tx.auditLog.findUnique({ where: { id } })) return;
  if (audit.lines.some(line => line.decision === 'PENDING' || line.difference !== 0 && line.decision !== 'APPLY_ACTUAL')) return;
  const box = await tx.box.findUnique({ where: { id: audit.boxId } });
  if (!box || box.clientId !== audit.clientId || !box.warehouseId || !['active', 'receiving'].includes(box.status) ||
      audit.session.warehouseId && audit.session.warehouseId !== box.warehouseId) stop('Короб изменил принадлежность после пересчёта.');
  if (user.hiddenClientIds?.includes(box!.clientId) || user.clientScopeMode !== 'ALL' &&
      !user.permissionCodes.includes('system:admin') && !user.writableClientIds?.includes(box!.clientId)) stop('Нет доступа к клиенту короба.');
  if (!user.permissionCodes.includes('system:admin') && !user.writableWarehouseIds?.includes(box!.warehouseId!)) stop('Нет доступа к филиалу короба.');
  const latest = await matchingLatestKizAudit(tx, audit);
  if (!latest) stop('В коробе уже начат более новый пересчёт с другим или неподтверждённым составом. Старые привязки не изменены.');
  if (latest!.id !== audit.id) {
    // FIX: confirm the latest physical snapshot, then link the identical older worker
    // round to that decision. Both proofs and statuses belong to one transaction.
    const moved = await tx.stockMovement.findFirst({ where: { boxId: box!.id, status: 'AVAILABLE',
      createdAt: { gt: latest!.startedAt }, OR: [{ idempotencyKey: null },
        { idempotencyKey: { notIn: latest!.lines.map(line => `web-inventory:${line.id}`) } }] }, select: { id: true } });
    if (moved) stop('После последнего пересчёта товар перемещался. Старая проверка не завершена.');
    await confirmInventoryKizComposition(tx, latest!.id, user);
    const proof = await tx.auditLog.findUnique({ where: { id: confirmedKizCompositionId(latest!.id, latest!.startedAt) } });
    const scope = proof?.payload as Prisma.JsonObject | null;
    if (!proof || proof.action !== 'INVENTORY_KIZ_COMPOSITION_CONFIRMED' || scope?.auditBoxId !== latest!.id ||
        scope.roundStartedAt !== latest!.startedAt.toISOString() || scope.boxId !== box!.id ||
        scope.clientId !== box!.clientId || scope.warehouseId !== box!.warehouseId) stop('Состав последнего пересчёта ещё не подтверждён.');
    await tx.inventoryAuditBox.update({ where: { id: latest!.id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedByName: user.name } });
    await tx.auditLog.create({ data: { id, userId: user.id, action: 'INVENTORY_KIZ_COMPOSITION_CONFIRMED',
      entity: 'InventoryAuditBox', entityId: audit.id, payload: { ...(proof!.payload as Prisma.JsonObject),
        auditBoxId: audit.id, roundStartedAt: audit.startedAt.toISOString(), confirmedFromAuditId: latest!.id,
        confirmedFromProofId: proof!.id, quantityChanged: 0 } } });
    return;
  }
  // FIX: equal totals can hide a concurrent pick/receipt; only this audit's own corrections are allowed.
  const intervening = await tx.stockMovement.findFirst({ where: { boxId: box!.id, status: 'AVAILABLE',
    createdAt: { gt: audit.startedAt }, OR: [{ idempotencyKey: null },
      { idempotencyKey: { notIn: audit.lines.map(line => `web-inventory:${line.id}`) } }] }, select: { id: true } });
  if (intervening) stop('После начала пересчёта доступный товар перемещался или отбирался. Старые привязки не изменены.');
  const balances = await tx.stockBalance.findMany({ where: { boxId: box!.id }, orderBy: { id: 'asc' } });
  if (balances.some(row => row.clientId !== box!.clientId || row.warehouseId !== box!.warehouseId || row.quantity < 0 ||
      row.quantity !== 0 && !['AVAILABLE', 'PACKING', 'SHIPPING'].includes(row.status))) stop('Нужно отдельно разобрать резерв или принадлежность остатка.');
  const evidence = await tx.auditLog.findMany({ where: { action: 'INVENTORY_KIZ_SCAN', entity: 'InventoryAuditBox', entityId: audit.id,
    createdAt: { gte: audit.startedAt } }, select: { id: true, payload: true } });
  const existing = await tx.productMark.findMany({ where: { boxId: box!.id }, orderBy: { id: 'asc' } });
  if (existing.some(mark => mark.clientId !== box!.clientId)) stop('В коробе есть КИЗ другого клиента.');
  const skuIds = [...new Set([...audit.lines.map(line => line.skuId), ...balances.map(row => row.skuId), ...existing.map(mark => mark.skuId)])];
  const skus = await tx.sku.findMany({ where: { id: { in: skuIds } }, select: { id: true, needsChestnyZnak: true, isUnmarked: true } });
  if (skus.length !== skuIds.length) stop('Не все товары пересчёта найдены.');
  const scans: Array<{ identity: string; value: string; skuId: string }> = [];
  for (const sku of skus) {
    const line = audit.lines.find(line => line.skuId === sku.id);
    const quantity = balances.filter(row => row.skuId === sku.id && row.status === 'AVAILABLE').reduce((n, row) => n + row.quantity, 0);
    if (quantity !== (line?.countedQuantity ?? 0)) stop('Остаток изменился после пересчёта. Привязки не изменены.');
    if (!sku.needsChestnyZnak || sku.isUnmarked) continue;
    const captured = evidence.map(row => row.payload as Record<string, unknown> | null).filter(row => row?.skuId === sku.id &&
      row.lineId === line?.id && row.roundStartedAt === audit.startedAt.toISOString() && row.boxId === box!.id &&
      row.clientId === box!.clientId && row.sessionId === audit.sessionId && typeof row.kiz === 'string');
    const values = captured.map(row => ({ identity: identity(row!.kiz as string), value: (row!.kiz as string).trim().replace(/^\]d2/i, '').replace(/<GS>/gi, '\u001d'), skuId: sku.id }));
    // Quantity-only checks remain unchanged; they cannot identify which KIZ to retire.
    if (quantity > 0 && !values.length) return;
    if (values.some(row => !row.identity) || new Set(values.map(row => row.identity)).size !== quantity || values.length !== quantity)
      stop('Для подтверждения состава нужен один уникальный скан КИЗ на каждую единицу.');
    scans.push(...values);
  }
  if (new Set(scans.map(scan => scan.identity)).size !== scans.length) stop('Один КИЗ указан у нескольких товаров.');
  // FIX: match administrative sorting's KIZ-before-box lock order to avoid a cross-workflow deadlock.
  for (const key of scans.map(scan => scan.identity).sort()) await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`sorting-kiz:${key}`}))`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Box" WHERE id = ${box!.id} FOR UPDATE`);
  const variants = scans.flatMap(scan => [scan.identity, ']d2' + scan.identity]);
  const related = variants.length ? await tx.productMark.findMany({ where: { OR: variants.map(prefix => ({ value: { startsWith: prefix } })) },
    include: { box: { select: { warehouseId: true } } } }) : [];
  for (const scan of scans) {
    const matches = related.filter(mark => identity(mark.value) === scan.identity);
    if (matches.length > 1 || matches.some(mark => mark.clientId !== box!.clientId || mark.skuId !== scan.skuId))
      stop('Отсканированный КИЗ имеет другую принадлежность или дубль.');
    if (matches.some(mark => mark.box?.warehouseId && mark.box.warehouseId !== box!.warehouseId)) stop('КИЗ числится в другом филиале. Нужна проверка перемещения.');
    for (const mark of matches.filter(mark => mark.status !== 'AVAILABLE')) {
      // FIX: legacy administrative exclusions are recoverable only from physical
      // scans, with no surviving box ownership or evidence of any order/dispatch.
      if (mark.status !== 'BLOCKED' || mark.boxId || !(mark.updatedAt < audit.startedAt) ||
          !mark.sourceDocument?.startsWith('admin-unpalleted-physical-snapshot-')) {
        stop('Отсканированный КИЗ заблокирован, отобран или отгружен. Нужна проверка возврата или переклейка КИЗ.');
      }
      const prefixes = [scan.identity, ']d2' + scan.identity];
      const where = { OR: prefixes.map(prefix => ({ kiz: { startsWith: prefix } })) };
      const history = await Promise.all([
        tx.fbsTsdAssembly.findFirst({ where, select: { id: true } }),
        tx.shippedKizHistory.findFirst({ where, select: { id: true } }),
        tx.fbsWebKizStickerPrint.findFirst({ where, select: { id: true } }),
        tx.fbsAssemblyAttemptHistory.findFirst({ where, select: { id: true } }),
        tx.fbsPrintJob.findFirst({ where, select: { id: true } }),
        tx.kizCirculationItem.findFirst({ where: { OR: prefixes.map(prefix => ({ kizRaw: { startsWith: prefix } })) }, select: { id: true } }),
      ]);
      if (history.some(Boolean)) stop('У заблокированного КИЗ есть история заказа или передачи. Нужна проверка возврата или переклейка КИЗ.');
    }
  }
  const active = variants.length ? await tx.fbsTsdAssembly.findFirst({ where: { status: { in: ['IN_PROGRESS', 'RETURN_REQUIRED'] },
    OR: variants.map(prefix => ({ kiz: { startsWith: prefix } })) }, select: { id: true } }) : null;
  if (active) stop('Отсканированный КИЗ сейчас используется в сборке. Привязки не изменены.');
  const wanted = new Set(scans.map(scan => scan.identity));
  const retired = existing.filter(mark => !wanted.has(identity(mark.value)));
  // FIX: retain shipment/packing status and every historical task; detach only current box ownership.
  for (const mark of retired) {
    const changed = await tx.productMark.updateMany({ where: { id: mark.id, boxId: box!.id, updatedAt: mark.updatedAt },
      data: { boxId: null, ...(mark.status === 'AVAILABLE' ? { status: 'BLOCKED' as const } : {}) } });
    if (changed.count !== 1) stop('КИЗ изменился параллельно с подтверждением.');
  }
  const attached: string[] = [];
  for (const scan of scans) {
    const mark = related.find(mark => identity(mark.value) === scan.identity);
    if (mark) {
      if (mark.boxId !== box!.id) {
        const changed = await tx.productMark.updateMany({ where: { id: mark.id, boxId: mark.boxId, updatedAt: mark.updatedAt, status: mark.status }, data: { boxId: box!.id, stockMovementId: null, status: 'AVAILABLE' } });
        if (changed.count !== 1) stop('КИЗ перемещён параллельно с подтверждением.');
      }
      attached.push(mark.id);
    } else attached.push((await tx.productMark.create({ data: { clientId: box!.clientId, skuId: scan.skuId, boxId: box!.id,
      status: 'AVAILABLE', value: scan.value, sourceDocument: `Подтверждённый пересчёт ${audit.id}` } })).id);
  }
  const nonPhysicalBalances = balances.filter(row => ['PACKING', 'SHIPPING'].includes(row.status) && row.quantity > 0)
    .map(({ id, skuId, status, quantity }) => ({ id, skuId, status, quantity }));
  await tx.auditLog.create({ data: { id, userId: user.id, action: 'INVENTORY_KIZ_COMPOSITION_CONFIRMED', entity: 'InventoryAuditBox', entityId: audit.id,
    payload: JSON.parse(JSON.stringify({ auditBoxId: audit.id, roundStartedAt: audit.startedAt.toISOString(), boxId: box!.id,
      clientId: box!.clientId, warehouseId: box!.warehouseId, nonPhysicalBalances, retiredMarks: retired, previousScannedMarks: related,
      attachedMarkIds: attached, scans, evidenceIds: evidence.map(row => row.id), quantityChanged: 0 })) } });
}
