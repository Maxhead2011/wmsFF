import { afterEach, expect, it, vi } from 'vitest';
import { validateFbsStockAudit } from '../src/modules/marketplace-connections/fbs-stock-audit';
import { confirmInventoryKizComposition } from '../src/modules/inventory/confirmed-kiz-composition';
import { InventoryService } from '../src/modules/inventory/inventory.service';

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
