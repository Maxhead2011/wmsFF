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
    fbsTsdAssembly: { findFirst: vi.fn(async () => null) } });
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
it.each(['new-round', 'parallel-pick', 'duplicate-scan', 'missing-unit', 'foreign-client', 'foreign-warehouse', 'active-pick', 'shipped-scan', 'reserve'])('rejects unsafe administrative composition before binding writes: %s', async kind => {
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
  if (kind === 'reserve') f.balances[1].status = 'RESERVED';
  await expect(f.confirm()).rejects.toThrow();
  expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
  expect(f.db.productMark.create).not.toHaveBeenCalled();
  expect(f.db.auditLog.create).not.toHaveBeenCalled();
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
