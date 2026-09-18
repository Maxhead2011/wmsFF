import { afterEach, expect, it, vi } from 'vitest';
import { validateFbsStockAudit } from '../src/modules/marketplace-connections/fbs-stock-audit';
import { confirmInventoryKizComposition } from '../src/modules/inventory/confirmed-kiz-composition';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { InventoryController } from '../src/modules/inventory/inventory.controller';

afterEach(() => vi.unstubAllEnvs());
const startedAt = new Date('2026-09-15T08:37:43.695Z');
const kiz = '0104680992593146215NLnuX2T+l\'zW\u001d91EE12\u001d92proof';
export function confirmedFixture() {
  const marks: any[] = [{ id: 'current', clientId: 'client', skuId: 'sku', boxId: 'box', status: 'AVAILABLE', value: kiz }];
  const balances: any[] = [{ id: 'available', clientId: 'client', warehouseId: 'warehouse', boxId: 'box', skuId: 'sku', status: 'AVAILABLE', quantity: 1 },
    { id: 'historical', clientId: 'client', warehouseId: 'warehouse', boxId: 'box', skuId: 'sku', status: 'PACKING', quantity: 2 }];
  const audit: any = { id: 'audit', boxId: 'box', clientId: 'client', status: 'RESOLVED', startedAt,
    lines: [{ id: 'line', skuId: 'sku', countedQuantity: 1, difference: 0, decision: 'KEEP_SYSTEM' }] };
  const session: any = { id: 'session', type: 'BOX_CHECK', clientId: 'client', warehouseId: 'warehouse', status: 'COMPLETED',
    createdByUserId: 'worker', comment: '[FBS_KIZ_STOCK_CHECK] task;', boxes: [audit] };
  audit.sessionId = session.id; audit.session = session;
  const evidence: any[] = [{ id: 'scan', payload: { roundStartedAt: startedAt.toISOString(), sessionId: 'session',
    boxId: 'box', clientId: 'client', skuId: 'sku', lineId: 'line', kiz } }];
  const approval: any = { id: `inventory-kiz-confirm:audit:${startedAt.toISOString()}`, action: 'INVENTORY_KIZ_COMPOSITION_CONFIRMED',
    payload: { auditBoxId: 'audit', boxId: 'box', clientId: 'client', warehouseId: 'warehouse', roundStartedAt: startedAt.toISOString(),
      nonPhysicalBalances: [{ id: 'historical', skuId: 'sku', status: 'PACKING', quantity: 2 }] } };
  const db: any = { inventorySession: { findUnique: vi.fn(async () => session) },
    box: { findUnique: vi.fn(async () => ({ id: 'box', clientId: 'client', warehouseId: 'warehouse', status: 'active' })) },
    clientRequest: { findUnique: vi.fn(async () => ({ warehouseId: 'warehouse' })) },
    productMark: { findMany: vi.fn(async () => marks) }, stockBalance: { findMany: vi.fn(async () => balances) },
    auditLog: { findMany: vi.fn(async () => evidence), findUnique: vi.fn(async () => approval) },
    sku: { findMany: vi.fn(async () => [{ id: 'sku', needsChestnyZnak: true, isUnmarked: false }]) } };
  const task: any = { id: 'task', clientId: 'client', requestId: 'request', status: 'RESERVED' };
  return { db, task, audit, session, marks, balances, evidence, approval, run: () => validateFbsStockAudit(db, task, 'session', 'worker') };
}
it('accepts the administrator-confirmed physical composition while retaining old packing accounting', async () => {
  // TEST: Marifat has already counted; two units from old picks must not force another count.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true'); const f = confirmedFixture();
  await expect(f.run()).resolves.toMatchObject({ ready: true });
  expect(f.balances[1].quantity).toBe(2);
});
it.each(['no-approval', 'old-round', 'foreign-box', 'new-packing', 'reserved', 'quantity-changed', 'flag-off'])('does not bypass validation: %s', async kind => {
  // TEST: only a scoped administrative decision permits historical packing rows.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', kind === 'flag-off' ? 'false' : 'true'); const f = confirmedFixture();
  if (kind === 'no-approval') f.db.auditLog.findUnique.mockResolvedValue(null);
  if (kind === 'old-round') f.approval.payload.roundStartedAt = 'old';
  if (kind === 'foreign-box') f.approval.payload.boxId = 'other';
  if (kind === 'new-packing') f.balances[1].quantity = 3;
  if (kind === 'reserved') f.balances[1].status = 'RESERVED';
  if (kind === 'quantity-changed') f.balances[0].quantity = 2;
  await expect(f.run()).rejects.toThrow();
});

function mutationFixture() {
  const f = confirmedFixture(); let approval: any = null;
  const user: any = { id: 'admin', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], clientScopeMode: 'ALL' };
  Object.assign(f.db, { $queryRaw: vi.fn(), $executeRaw: vi.fn(),
    inventoryAuditBox: { findUnique: vi.fn(async () => f.audit), findFirst: vi.fn(async () => ({ id: f.audit.id })) },
    stockMovement: { findFirst: vi.fn(async () => null) },
    fbsTsdAssembly: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) } });
  f.db.stockBalance.updateMany = vi.fn(async ({ where, data }: any) => {
    const row = f.balances.find(r => r.id === where.id); Object.assign(row, data); return { count: 1 };
  });
  f.db.stockMovement.create = vi.fn(async ({ data }: any) => data);
  f.db.auditLog.findUnique = vi.fn(async () => approval);
  f.db.auditLog.create = vi.fn(async ({ data }: any) => { approval = data; return data; });
  f.db.productMark.findMany = vi.fn(async ({ where }: any) => where.boxId ? f.marks.filter(m => m.boxId === where.boxId) : f.marks);
  f.db.productMark.updateMany = vi.fn(async ({ where, data }: any) => {
    const mark = f.marks.find(m => m.id === where.id); if (!mark) return { count: 0 };
    Object.assign(mark, data); return { count: 1 };
  });
  f.db.productMark.create = vi.fn(async ({ data }: any) => { const mark = { id: 'new-' + f.marks.length, ...data }; f.marks.push(mark); return mark; });
  return { ...f, user, confirm: () => confirmInventoryKizComposition(f.db, f.audit.id, user) };
}
it('retains the same physical mark when the legacy stored code has no GS separators', async () => {
  // TEST: box 181 must not block the legacy identity and create a second record.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true');
  vi.stubEnv('WMS_KIZ_IDENTITY_TRANSFER_ENABLED', 'true');
  const f = mutationFixture(); f.marks[0].value = kiz.replaceAll('\u001d', '');
  await f.confirm();
  expect(f.db.productMark.create).not.toHaveBeenCalled();
  expect(f.marks[0]).toMatchObject({ boxId: 'box', status: 'AVAILABLE' });
});
it('debits box 177 exactly once when its scanned KIZ is confirmed in box 181', async () => {
  // TEST: destination quantity was already counted; moving only the mark left phantom source stock.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true'); vi.stubEnv('WMS_KIZ_IDENTITY_TRANSFER_ENABLED', 'true');
  const f = mutationFixture(); const source = { id: 'source-stock', boxId: 'source', clientId: 'client', warehouseId: 'warehouse', skuId: 'sku', status: 'AVAILABLE', quantity: 1, updatedAt: startedAt };
  Object.assign(f.marks[0], { boxId: 'source', box: { warehouseId: 'warehouse' } });
  f.db.box.findUnique = vi.fn(async ({ where }: any) => ({ id: where.id, code: where.id, clientId: 'client', warehouseId: 'warehouse', status: 'active' }));
  f.db.stockBalance.findMany = vi.fn(async ({ where }: any) => where.boxId === 'source' ? [source] : f.balances);
  f.db.stockBalance.updateMany = vi.fn(async ({ data }: any) => { source.quantity -= data.quantity.decrement; return { count: 1 }; });
  f.db.stockMovement.create = vi.fn(async ({ data }: any) => ({ id: 'transfer-out', ...data }));
  f.db.inventoryAuditBox.findFirst = vi.fn(async ({ where }: any) => where.boxId === 'source' ? null : { id: f.audit.id });
  await f.confirm(); await f.confirm();
  expect(source.quantity).toBe(0);
  expect(f.balances[0].quantity).toBe(1);
  expect(f.marks[0].boxId).toBe('box');
  expect(f.db.stockMovement.create).toHaveBeenCalledTimes(1);
  expect(f.db.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ boxId: 'source', quantity: -1, type: 'MOVE' }) }));
});
it('rebuilds KIZ ownership from the confirmed physical scans without any stock write, then opens the gate', async () => {
  // TEST: old available/packing/shipping aliases are detached, histories and quantities remain intact.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true'); const f = mutationFixture();
  f.marks[0].value = kiz.replace('NLnuX2T+l\'zW', 'AAAAAAAAAAAA');
  f.marks.push({ ...f.marks[0], id: 'packed', status: 'PACKING' }, { ...f.marks[0], id: 'shipped', status: 'SHIPPING' });
  const beforeStock = structuredClone(f.balances);
  await f.confirm();
  expect(f.db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(f.db.$queryRaw.mock.invocationCallOrder[0]);
  expect(f.marks.filter(m => m.boxId === 'box')).toEqual([expect.objectContaining({ value: kiz, status: 'AVAILABLE' })]);
  expect(f.marks.find(m => m.id === 'current')).toMatchObject({ boxId: null, status: 'BLOCKED' });
  expect(f.marks.find(m => m.id === 'packed')).toMatchObject({ boxId: null, status: 'PACKING' });
  expect(f.marks.find(m => m.id === 'shipped')).toMatchObject({ boxId: null, status: 'SHIPPING' });
  expect(f.balances).toEqual(beforeStock);
  await expect(f.run()).resolves.toMatchObject({ ready: true });
  const writes = f.db.productMark.updateMany.mock.calls.length;
  await f.confirm();
  expect(f.db.productMark.updateMany).toHaveBeenCalledTimes(writes);
  expect(f.db.productMark.create).toHaveBeenCalledTimes(1);
});
it.each(['new-round', 'parallel-pick', 'duplicate-scan', 'missing-unit', 'foreign-client', 'foreign-warehouse', 'active-pick', 'shipped-scan'])('rejects unsafe administrative composition before binding writes: %s', async kind => {
  // TEST: authority does not authorize stealing an active/shipped unit or trusting a stale snapshot.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true'); const f = mutationFixture();
  if (kind === 'new-round') f.db.inventoryAuditBox.findFirst.mockResolvedValue({ id: 'new-audit' });
  if (kind === 'parallel-pick') f.db.stockMovement.findFirst.mockResolvedValue({ id: 'pick-after-count-start' });
  if (kind === 'duplicate-scan') f.evidence.push(f.evidence[0]);
  if (kind === 'missing-unit') f.balances[0].quantity = 0;
  if (kind === 'foreign-client') f.marks[0].clientId = 'sold';
  if (kind === 'foreign-warehouse') f.marks[0].box = { warehouseId: 'sold' };
  if (kind === 'active-pick') f.db.fbsTsdAssembly.findFirst.mockResolvedValue({ id: 'active' });
  if (kind === 'shipped-scan') f.marks[0].status = 'SHIPPING';
  await expect(f.confirm()).rejects.toThrow();
  expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
  expect(f.db.productMark.create).not.toHaveBeenCalled();
  expect(f.db.auditLog.create).not.toHaveBeenCalled();
});
it.each(['ADMIN', 'OWNER'])('accepts physical count, retires old reserve and archives absent marks for %s', async role => {
  // TEST: FFL_LKBS1009_26 retained a two-unit relabelling reserve after the actual count.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true'); const f = mutationFixture(); f.user.roleCodes = [role];
  f.balances.push({ ...f.balances[0], id: 'reserved', status: 'RESERVED', quantity: 2 });
  f.marks[0].status = 'RESERVED';
  f.marks.push({ ...f.marks[0], id: 'absent', value: kiz.replace('NLnuX2T+l\'zW', 'AAAAAAAAAAAA') });
  await f.confirm(); await f.confirm();
  expect(f.balances[0].quantity).toBe(1); // Count includes all physically present units; never add reserve again.
  expect(f.balances.find(r => r.id === 'reserved').quantity).toBe(0);
  expect(f.balances[1].quantity).toBe(2); // Shipment/packing ledger retained.
  expect(f.marks[0]).toMatchObject({ boxId: 'box', status: 'AVAILABLE' });
  expect(f.marks[1]).toMatchObject({ boxId: null, status: 'BLOCKED' });
  expect(f.db.stockMovement.create).toHaveBeenCalledTimes(1);
  expect(f.db.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RESERVED', quantity: -2 }) }));
  expect(f.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ archivedMarkIds: ['absent'], archiveReason: 'Не подтверждено при пересчёте' }) }) }));
  await expect(f.run()).resolves.toMatchObject({ ready: true });
});
it.each(['worker', 'flag-off', 'pending'])('leaves reserve and missing marks for administrator review: %s', async kind => {
  // TEST: counters cannot resolve their own discrepancies; pending web decisions do not mutate ownership.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', kind === 'flag-off' ? 'false' : 'true'); const f = mutationFixture();
  if (kind === 'worker') f.user.roleCodes = ['WAREHOUSE'];
  if (kind === 'pending') f.audit.lines[0].decision = 'PENDING';
  f.balances.push({ ...f.balances[0], id: 'reserved', status: 'RESERVED', quantity: 2 });
  await f.confirm(); expect(f.db.stockBalance.updateMany).not.toHaveBeenCalled(); expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
});
it('releases only unpicked FBS source hints while preserving picked history', async () => {
  // TEST: rerouting must not debit again or reset a task with physical pick evidence.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true'); const f = mutationFixture();
  f.db.fbsTsdAssembly.findMany.mockResolvedValue([{ id: 'unpicked', status: 'RESERVED', updatedAt: startedAt }, { id: 'picked', status: 'RESERVED', updatedAt: startedAt }]);
  f.db.stockMovement.findFirst.mockImplementation(async ({ where }: any) => where.idempotencyKey?.startsWith?.includes('picked:') && !where.idempotencyKey.startsWith.includes('unpicked:') ? { id: 'physical-pick' } : null);
  await f.confirm();
  expect(f.db.fbsTsdAssembly.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ completedAt: null, kiz: null, status: { in: ['RESERVED', 'WAITING_STOCK', 'RELEASED'] } }) }));
  expect(f.db.fbsTsdAssembly.updateMany).toHaveBeenCalledTimes(1);
  expect(f.db.fbsTsdAssembly.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'unpicked' }), data: expect.objectContaining({ status: 'WAITING_STOCK', reservedBoxId: null, boxId: null }) }));
});
it('does not release a reserve or archive anything when scans are incomplete', async () => {
  // TEST: failed proof validation happens before mutations; the enclosing transaction is not a partial approval.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true'); const f = mutationFixture();
  f.balances.push({ ...f.balances[0], id: 'reserved', status: 'RESERVED', quantity: 2 });
  f.evidence.push(f.evidence[0]); await expect(f.confirm()).rejects.toThrow();
  expect(f.db.stockBalance.updateMany).not.toHaveBeenCalled(); expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
});
it('confirms composition on the existing administrator completion/retry path', async () => {
  // TEST: wiring the helper into actual InventoryService completion is required, not just exporting it.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true'); const f = mutationFixture();
  f.db.inventoryAuditLine = { count: vi.fn(async () => 0) };
  f.db.box.updateMany = vi.fn(async () => ({ count: 0 }));
  const service: any = Object.create(InventoryService.prototype);
  service.prisma = { $transaction: vi.fn(async (fn: any) => fn(f.db)) };
  service.completeMandatoryFbsSessionIfReady = vi.fn();
  await service.resolveAuditBoxAndReactivateIfReady('audit', f.user);
  expect(f.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'INVENTORY_KIZ_COMPOSITION_CONFIRMED' }) }));
});
it.each(['flag-off', 'worker', 'demo', 'no-scans'])('does not rewrite ownership without physical admin confirmation: %s', async kind => {
  // TEST: sold VM, ordinary counters, demo users, and quantity-only counts retain the previous path.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', kind === 'flag-off' ? 'false' : 'true'); const f = mutationFixture();
  if (kind === 'worker') f.user.roleCodes = ['WAREHOUSE'];
  if (kind === 'demo') f.user.isDemo = true;
  if (kind === 'no-scans') f.evidence.length = 0;
  await f.confirm();
  expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
  expect(f.db.auditLog.create).not.toHaveBeenCalled();
});

function wmsReviewFixture() {
  const f = mutationFixture();
  Object.assign(f.task, { status: 'IN_PROGRESS', boxId: 'box', orderId: '5765104936' });
  Object.assign(f.audit, { status: 'MATCHED', boxCode: 'FFL_G_LKB0707_045' });
  f.balances.splice(1);
  f.marks[0].value = kiz.replace('NLnuX2T+l\'zW', 'OLD123456789');
  f.db.inventorySession.findMany = vi.fn(async () => [f.session]);
  f.db.inventorySession.findFirst = vi.fn(async () => null);
  f.db.fbsTsdAssembly.findMany = vi.fn(async () => f.task.status === 'COMPLETED' ? [] : [f.task]);
  f.db.fbsTsdAssembly.findUnique = vi.fn(async () => f.task);
  f.db.inventoryAuditBox.update = vi.fn(async ({ data }: any) => Object.assign(f.audit, data));
  f.db.inventoryAuditLine = { count: vi.fn(async () => 0) };
  f.db.inventoryBoxRescanRequest = { findMany: vi.fn(async () => []) };
  f.db.box.updateMany = vi.fn(async () => ({ count: 0 }));
  f.db.$transaction = vi.fn(async (fn: any) => fn(f.db));
  const service: any = new InventoryService(f.db, { requireClientAccess: vi.fn() } as never, {} as never);
  return { ...f, service, review: () => service.pendingKizReviews(f.user, null) };
}

it('exposes a saved quantity-matched worker count in the WMS review queue without writing', async () => {
  // TEST: the menu must include KIZ-only mismatches even when quantity is 7 of 7.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true'); const f = wmsReviewFixture();
  await expect(f.review()).resolves.toEqual([expect.objectContaining({ id: 'session', boxes: [expect.objectContaining({
    id: 'audit', status: 'MATCHED', kizReview: expect.objectContaining({ required: true, orderId: '5765104936' }),
  })] })]);
  expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
  expect(f.db.auditLog.create).not.toHaveBeenCalled();
});

it('approves the original worker round through the WMS controller, then permits FBS without a new count', async () => {
  // TEST: exercise the real web endpoint and subsequent TSD gate, not a second administrator scan.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true'); const f = wmsReviewFixture();
  const controller = new InventoryController(f.service, {} as never);
  const originalScans = structuredClone(f.evidence), stock = structuredClone(f.balances);
  await controller.resolveBox('audit', { action: 'APPLY_ACTUAL' } as never, f.user);
  expect(f.audit.status).toBe('RESOLVED');
  expect(f.marks.find(m => m.id === 'current')).toMatchObject({ boxId: null, status: 'BLOCKED' });
  expect(f.marks.find(m => m.boxId === 'box')).toMatchObject({ value: kiz, status: 'AVAILABLE' });
  expect(f.evidence).toEqual(originalScans);
  expect(f.balances).toEqual(stock);
  await expect(f.run()).resolves.toMatchObject({ ready: true });
  await expect(f.review()).resolves.toEqual([]);
  await controller.resolveBox('audit', { action: 'APPLY_ACTUAL' } as never, f.user);
  expect(f.db.productMark.create).toHaveBeenCalledTimes(1);
});

it('includes pending KIZ checks outside the ordinary last-100 history page and keeps them in work-only views', async () => {
  // TEST: a busy warehouse must not lose an older blocked worker's review behind newer sessions.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true'); const f = wmsReviewFixture();
  f.db.inventorySession.findMany.mockImplementation(async ({ where }: any) => where.comment ? [f.session] : []);
  f.audit.status = 'RESOLVED';
  const result = await f.service.dashboard(f.user, true);
  expect(result.historySessions[0].boxes[0].kizReview.required).toBe(true);
  expect(result.reviewSessions[0].boxes[0].id).toBe('audit');
  expect(result.canConfirmKiz).toBe(true);
  expect(result.historySessions[0].progress.mismatchBoxes).toBe(1);
});

it.each(['flag-off', 'demo', 'worker', 'hidden-client', 'other-client', 'completed-task', 'newer-count', 'matching-kiz', 'quantity-changed'])('does not offer the KIZ-only approval for %s', async kind => {
  // TEST: limit the additional queue to this deployment, authorized scope and the current blocked round.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', kind === 'flag-off' ? 'false' : 'true'); const f = wmsReviewFixture();
  if (kind === 'demo') f.user.isDemo = true;
  if (kind === 'worker') { f.user.roleCodes = ['TSD']; f.user.permissionCodes = []; }
  if (kind === 'hidden-client') f.user.hiddenClientIds = ['client'];
  if (kind === 'other-client') { f.user.clientScopeMode = 'LIMITED'; f.user.clientIds = ['other']; f.user.permissionCodes = []; }
  if (kind === 'completed-task') f.task.status = 'COMPLETED';
  if (kind === 'newer-count') f.db.inventoryAuditBox.findFirst.mockResolvedValue({ id: 'newer' });
  if (kind === 'matching-kiz') f.marks[0].value = kiz;
  if (kind === 'quantity-changed') f.balances[0].quantity = 0;
  await expect(f.review()).resolves.toEqual([]);
  expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
});

it('propagates a failed database read instead of showing no pending problems', async () => {
  // TEST: a broken query is not evidence that the physical composition is correct.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true'); const f = wmsReviewFixture();
  f.db.stockBalance.findMany.mockRejectedValue(new Error('database unavailable'));
  await expect(f.review()).rejects.toThrow('database unavailable');
});

it('does not report a successful WMS approval when a mandatory check has no saved KIZ scans', async () => {
  // TEST: a quantity-only no-op must not tell the administrator that FBS is unblocked.
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true'); const f = wmsReviewFixture();
  f.evidence.length = 0;
  const controller = new InventoryController(f.service, {} as never);
  await expect(controller.resolveBox('audit', { action: 'APPLY_ACTUAL' } as never, f.user)).rejects.toThrow('состав КИЗ не подтверждён');
  expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
  expect(f.db.productMark.create).not.toHaveBeenCalled();
});

// TEST: a physical unit excluded by an old administrative snapshot is not a shipped KIZ.
function blockedSnapshotFixture() {
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'true');
  const f = wmsReviewFixture();
  Object.assign(f.marks[0], { value: kiz, boxId: null, status: 'BLOCKED',
    sourceDocument: 'admin-unpalleted-physical-snapshot-20260827', updatedAt: new Date('2026-08-27') });
  for (const model of ['shippedKizHistory', 'fbsWebKizStickerPrint', 'fbsAssemblyAttemptHistory', 'fbsPrintJob', 'kizCirculationItem']) {
    f.db[model] = { findFirst: vi.fn(async () => null) };
  }
  return f;
}
it('restores Sonya administrative writeoff marks exactly once after physical confirmation', async () => {
  // TEST: box 2506_86 contains physically scanned units excluded by admin-unpalleted-writeoff.
  const f = blockedSnapshotFixture(), stock = structuredClone(f.balances);
  f.marks[0].sourceDocument = 'admin-unpalleted-writeoff';
  await f.service.resolveBox('audit', { action: 'APPLY_ACTUAL' }, f.user);
  expect(f.marks[0]).toMatchObject({ id: 'current', status: 'AVAILABLE', boxId: 'box', value: kiz });
  expect(f.balances).toEqual(stock);
  expect(f.db.productMark.create).not.toHaveBeenCalled();
  expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  await expect(f.run()).resolves.toMatchObject({ ready: true });
  const writes = f.db.productMark.updateMany.mock.calls.length;
  await f.service.resolveBox('audit', { action: 'APPLY_ACTUAL' }, f.user);
  expect(f.db.productMark.updateMany).toHaveBeenCalledTimes(writes);
});
it.each(['assembly', 'shipped', 'printed', 'attempt', 'print-job', 'circulation', 'wrong-sku', 'wrong-client', 'still-bound', 'new-block', 'shipping', 'similar-source', 'flag-off'])('preserves writeoff recovery safeguards: %s', async kind => {
  // TEST: the new administrative reason must not bypass ownership, history or sold-VM isolation.
  const f = blockedSnapshotFixture();
  f.marks[0].sourceDocument = 'admin-unpalleted-writeoff';
  const model: Record<string, string> = { assembly: 'fbsTsdAssembly', shipped: 'shippedKizHistory', printed: 'fbsWebKizStickerPrint', attempt: 'fbsAssemblyAttemptHistory', 'print-job': 'fbsPrintJob', circulation: 'kizCirculationItem' };
  if (model[kind]) f.db[model[kind]].findFirst.mockResolvedValue({ id: 'history' });
  if (kind === 'wrong-sku') f.marks[0].skuId = 'another';
  if (kind === 'wrong-client') f.marks[0].clientId = 'another';
  if (kind === 'still-bound') f.marks[0].boxId = 'another';
  if (kind === 'new-block') f.marks[0].updatedAt = startedAt;
  if (kind === 'shipping') f.marks[0].status = 'SHIPPING';
  if (kind === 'similar-source') f.marks[0].sourceDocument += '-unverified';
  if (kind === 'flag-off') {
    vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT', 'false');
    await f.confirm();
  } else await expect(f.confirm()).rejects.toThrow();
  expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
  expect(f.db.productMark.create).not.toHaveBeenCalled();
  expect(f.db.auditLog.create).not.toHaveBeenCalled();
});
it('restores a scanned blocked snapshot mark on admin confirmation, without a second receipt', async () => {
  const f = blockedSnapshotFixture(), stock = structuredClone(f.balances);
  await f.service.resolveBox('audit', { action: 'APPLY_ACTUAL' }, f.user);
  expect(f.marks[0]).toMatchObject({id:'current',status:'AVAILABLE',boxId:'box',value:kiz});
  expect(f.balances).toEqual(stock);expect(f.db.productMark.create).not.toHaveBeenCalled();
  await expect(f.run()).resolves.toMatchObject({ready:true});
  const calls=f.db.productMark.updateMany.mock.calls.length;
  await f.service.resolveBox('audit',{action:'APPLY_ACTUAL'},f.user);
  expect(f.db.productMark.updateMany).toHaveBeenCalledTimes(calls);
});
it.each(['unexplained-block','still-bound','new-block','assembly','shipped','printed','attempt','print-job','circulation','wrong-client','wrong-sku','db-failure'])('does not restore a blocked mark with unsafe evidence: %s',async kind=>{
  const f=blockedSnapshotFixture();
  if(kind==='unexplained-block')f.marks[0].sourceDocument='Manual quarantine';
  if(kind==='still-bound')f.marks[0].boxId='another-box';
  if(kind==='new-block')f.marks[0].updatedAt=new Date('2026-09-16');
  if(kind==='wrong-client')f.marks[0].clientId='another';
  if(kind==='wrong-sku')f.marks[0].skuId='another';
  const model:any={assembly:'fbsTsdAssembly',shipped:'shippedKizHistory',printed:'fbsWebKizStickerPrint',attempt:'fbsAssemblyAttemptHistory','print-job':'fbsPrintJob',circulation:'kizCirculationItem'};
  if(model[kind])f.db[model[kind]].findFirst.mockResolvedValue({id:'history'});
  if(kind==='db-failure')f.db.shippedKizHistory.findFirst.mockRejectedValue(Error('database failed'));
  await expect(f.confirm()).rejects.toThrow();
  expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
});
function newerMatchingSnapshotFixture() {
  const f=blockedSnapshotFixture();
  f.audit.status='MISMATCH';f.session.status='ACTIVE';
  const newer:any={...f.audit,id:'newer',status:'MISMATCH',sessionId:'admin-session',startedAt:new Date(+startedAt+60000),
    lines:f.audit.lines.map((l:any)=>({...l,id:'new-'+l.id})),session:{...f.session,id:'admin-session',status:'COMPLETED',createdByUserId:'admin',warehouseId:null,comment:null}};
  const scans=f.evidence.map((e:any)=>({...e,id:'new-'+e.id,payload:{...e.payload,lineId:'new-'+e.payload.lineId,
    sessionId:'admin-session',roundStartedAt:newer.startedAt.toISOString()}}));
  const approvals=new Map();
  f.db.inventoryAuditBox.findFirst.mockResolvedValue(newer);
  f.db.inventoryAuditBox.findUnique.mockImplementation(async({where}:any)=>where.id==='newer'?newer:f.audit);
  f.db.inventoryAuditBox.update.mockImplementation(async({where,data}:any)=>Object.assign(where.id==='newer'?newer:f.audit,data));
  f.db.auditLog.findMany.mockImplementation(async({where}:any)=>where.entityId==='newer'?scans:f.evidence);
  f.db.auditLog.findUnique.mockImplementation(async({where}:any)=>approvals.get(where.id)??null);
  f.db.auditLog.create.mockImplementation(async({data}:any)=>{approvals.set(data.id,data);return data;});
  f.service.completeMandatoryFbsSessionIfReady=vi.fn(async()=>{f.session.status='COMPLETED';});
  return {...f,newer,scans,approvals};
}
it('shows a decided but unfinished worker check and confirms it using the same newer physical scan set',async()=>{
  // TEST: Gulruh's 338 check was hidden after Sonya saved another identical count.
  const f=newerMatchingSnapshotFixture();const original=structuredClone(f.evidence),stock=structuredClone(f.balances);
  await expect(f.review()).resolves.toEqual([expect.objectContaining({boxes:[expect.objectContaining({kizReview:expect.objectContaining({required:true})})]})]);
  await f.service.resolveBox('audit',{action:'APPLY_ACTUAL'},f.user);
  expect(f.audit.status).toBe('RESOLVED');expect(f.newer.status).toBe('RESOLVED');
  expect(f.evidence).toEqual(original);expect(f.balances).toEqual(stock);
  await expect(f.run()).resolves.toMatchObject({ready:true});
  expect([...f.approvals.values()].find((a:any)=>a.entityId==='audit').payload.confirmedFromAuditId).toBe('newer');
});
it.each(['different-scan','different-count','new-count-in-progress','pending-decision','missing-scans','wrong-warehouse','wrong-client'])('never substitutes a newer incompatible count: %s',async kind=>{
  const f=newerMatchingSnapshotFixture();
  if(kind==='different-scan')f.scans[0].payload.kiz=kiz.replace('NLnuX2T','ABCDEFG');
  if(kind==='different-count')f.newer.lines[0].countedQuantity=2;
  if(kind==='new-count-in-progress')f.newer.status='COUNTING';
  if(kind==='pending-decision'){f.newer.lines[0].decision='PENDING';f.newer.lines[0].difference=1;}
  if(kind==='missing-scans')f.scans.length=0;
  if(kind==='wrong-warehouse')f.newer.session.warehouseId='other';
  if(kind==='wrong-client')f.newer.clientId='other';
  await expect(f.confirm()).rejects.toThrow();
  expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
  expect(f.db.auditLog.create).not.toHaveBeenCalled();
});
it('refuses to complete an old check after movement following the newer count',async()=>{
  // TEST: equal counts do not authorize using a snapshot across later warehouse movements.
  const f=newerMatchingSnapshotFixture();f.db.stockMovement.findFirst.mockResolvedValue({id:'later-pick'});
  await expect(f.confirm()).rejects.toThrow('перемещался');
  expect(f.db.productMark.updateMany).not.toHaveBeenCalled();expect(f.db.auditLog.create).not.toHaveBeenCalled();
});
it('keeps a partially decided mismatch out of the KIZ-only confirmation queue',async()=>{
  const f=newerMatchingSnapshotFixture();f.audit.lines[0].decision='PENDING';f.audit.lines[0].difference=1;
  await expect(f.review()).resolves.toEqual([]);expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
});
it.each(['off','demo','worker'])('does not restore blocked snapshots outside enabled administrator confirmation: %s',async kind=>{
  const f=blockedSnapshotFixture();
  if(kind==='off')vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT','false');
  if(kind==='demo')f.user.isDemo=true;
  if(kind==='worker')f.user.roleCodes=['TSD'];
  await f.confirm();expect(f.marks[0].status).toBe('BLOCKED');expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
});
it('replays box 338: two blocked units, one missing registration, two stale bindings and historical packing',async()=>{
  // TEST: multi-SKU physical snapshot from Gulruh/Sonya, including all three units.
  const f=newerMatchingSnapshotFixture();
  const second=kiz.replace('NLnuX2T','ABCDEFG'),third=kiz.replace('NLnuX2T','HIJKLMN');
  f.audit.lines=[{id:'line',skuId:'sku',countedQuantity:2,difference:2,decision:'APPLY_ACTUAL'},
    {id:'line-b',skuId:'sku-b',countedQuantity:1,difference:0,decision:'KEEP_SYSTEM'}];
  f.newer.lines=f.audit.lines.map((l:any)=>({...l,id:'new-'+l.id}));
  const original=f.evidence[0];
  f.evidence.splice(0,f.evidence.length,...[kiz,second,third].map((value,i)=>({id:'scan-'+i,payload:{...original.payload,
    kiz:value,skuId:i===2?'sku-b':'sku',lineId:i===2?'line-b':'line'}})));
  f.scans.splice(0,f.scans.length,...f.evidence.map((e:any)=>({id:'new-'+e.id,payload:{...e.payload,
    lineId:'new-'+e.payload.lineId,sessionId:'admin-session',roundStartedAt:f.newer.startedAt.toISOString()}})));
  f.marks.push({...f.marks[0],id:'blocked-2',value:second},
    {...f.marks[0],id:'stale-a',boxId:'box',status:'AVAILABLE',value:kiz.replace('NLnuX2T','OLDMARK')},
    {...f.marks[0],id:'stale-b',boxId:'box',skuId:'sku-c',status:'AVAILABLE',value:kiz.replace('NLnuX2T','STALEXX')});
  f.balances[0].quantity=2;
  f.balances.push({...f.balances[0],id:'available-b',skuId:'sku-b',quantity:1},
    {...f.balances[0],id:'old-packing',skuId:'sku-c',status:'PACKING',quantity:1});
  f.db.sku.findMany.mockResolvedValue(['sku','sku-b','sku-c'].map(id=>({id,needsChestnyZnak:true,isUnmarked:false})));
  const stock=structuredClone(f.balances),scans=structuredClone(f.evidence);
  await f.service.resolveBox('audit',{action:'APPLY_ACTUAL'},f.user);
  expect(f.marks.filter(m=>m.boxId==='box')).toHaveLength(3);
  expect(f.marks.filter(m=>m.id.startsWith('stale')).every(m=>m.boxId===null&&m.status==='BLOCKED')).toBe(true);
  expect(f.db.productMark.create).toHaveBeenCalledOnce();expect(f.balances).toEqual(stock);expect(f.evidence).toEqual(scans);
  await expect(f.run()).resolves.toMatchObject({ready:true});
});
