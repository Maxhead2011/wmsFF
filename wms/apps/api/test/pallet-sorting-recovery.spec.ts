import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Session } from 'node:inspector';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

const kiz = '010460000000000121ABCDEFGHIJKLM';
const user = { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' };
// TEST: optional native V8 block coverage without installing or changing dependencies.
if (process.env.SORTING_RECOVERY_COVERAGE === 'true') {
  const profiler = new Session();
  const post = (method: string, params = {}) => new Promise<any>((resolve, reject) => profiler.post(method as any, params, (error, result) => error ? reject(error) : resolve(result)));
  beforeAll(async () => { profiler.connect(); await post('Profiler.enable'); await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true }); });
  afterAll(async () => {
    try {
      const coverage = await post('Profiler.takePreciseCoverage');
      const wanted = ['recoverSortingUnit', 'recordProblemSource'];
      const functions = coverage.result.flatMap((script: any) => script.functions).filter((fn: any) => wanted.includes(fn.functionName));
      expect(functions.map((fn: any) => fn.functionName).sort()).toEqual(wanted.sort());
      for (const fn of functions) {
        const covered = fn.ranges.filter((range: any) => range.count > 0).length;
        console.log(JSON.stringify({ nativeV8Function: fn.functionName, blocks: fn.ranges.length, covered, percent: covered / fn.ranges.length * 100 }));
        expect(covered / fn.ranges.length).toBeGreaterThanOrEqual(0.8);
      }
    } finally { await post('Profiler.stopPreciseCoverage'); profiler.disconnect(); }
  });
}
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const service = Object.create(PalletSortingService.prototype) as any;
  service.boxCodes = { normalize: vi.fn(async (s: string) => s.trim().toUpperCase()), requireAllowed: vi.fn(async (s: string) => s.trim().toUpperCase()) };
  service.scopes = { requireClientAccess: vi.fn() };
  service.audit = vi.fn(); service.assertUnclaimed = vi.fn(); service.resetAffectedRoutes = vi.fn();
  service.assertMovementAllowed = vi.fn(); // TEST: source locks are now checked inside move, not only action.
  service.stock = { recoverSortingUnit: vi.fn().mockResolvedValue({ skuId: 'sku' }), transferSortingUnit: vi.fn().mockResolvedValue({ skuId: 'sku' }),
    // TEST: only the admin session delegates to the new physical-truth path; legacy helper tests below remain unchanged.
    reconcileAdminSortingUnit: vi.fn().mockResolvedValue({ skuId: 'sku', sourceBoxId: null, recovered: true, alreadyApplied: false }) };
  const tx: any = { $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([]),
    box: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    storagePallet: { findFirst: vi.fn().mockResolvedValue({ id: 'pallet', code: 'PAL', clientId: 'client', boxes: [{ boxId: null, boxCode: 'UNKNOWN' }] }) },
    productMark: { findMany: vi.fn().mockResolvedValue([]) }, stockBalance: { findMany: vi.fn().mockResolvedValue([]) } };
  service.prisma = { $transaction: vi.fn(async (fn: any) => fn(tx)) };
  const state: any = { id: 'session', clientId: 'client', warehouseId: 'wh', sourceCode: 'PAL', sourcePalletId: 'pallet', stage: 'CHECKING', version: 1,
    sources: [], problemSources: [], targets: [], moves: [], pendingRoutes: [] };
  return { service, tx, state };
}
it('starts a pallet containing an orphan placement without inventing a Box or stock', async () => {
  // TEST: a missing WMS box must be a visible problem, not a blocker at pallet scan.
  const f = fixture();
  const state = await f.service.start({ id: 'session', code: 'PAL' }, user);
  expect(state.sources).toEqual([]);
  expect(state.problemSources).toEqual([expect.objectContaining({ code: 'UNKNOWN', scanned: false, reason: 'BOX_NOT_FOUND' })]);
  expect(f.service.stock.recoverSortingUnit).not.toHaveBeenCalled();
});
it('records an unknown physical box once at initial scan and allows forming', async () => {
  // TEST: scan is not a receipt; subsequent SKU + KIZ is required.
  const f = fixture();
  await f.service.runAction(f.tx, f.state, { action: 'SCAN_SOURCE', code: 'unknown' }, user);
  await f.service.runAction(f.tx, f.state, { action: 'SCAN_SOURCE', code: 'UNKNOWN' }, user);
  expect(f.state.problemSources).toHaveLength(1);
  expect(f.state.problemSources[0]).toMatchObject({ code: 'UNKNOWN', scanned: true, reason: 'BOX_NOT_FOUND' });
  await f.service.runAction(f.tx, f.state, { action: 'BEGIN_FORMING' }, user);
  expect(f.state.stage).toBe('FORMING');
  expect(f.service.stock.recoverSortingUnit).not.toHaveBeenCalled();
});
it('records an existing foreign source as real, not missing', async () => {
  // TEST: ADMIN may confirm its location but must not invent an absent box.
  const f = fixture(); f.tx.box.findUnique.mockResolvedValue({ id: 'foreign', code: 'FOREIGN', clientId: 'other', warehouseId: 'other-wh', status: 'active' });
  await f.service.runAction(f.tx, f.state, { action: 'SCAN_SOURCE', code: 'FOREIGN' }, user);
  expect(f.state.sources).toEqual([expect.objectContaining({ id: 'foreign', scanned: true })]);
  expect(f.state.problemSources).toEqual([]);
});
function forming() {
  const f = fixture();
  Object.assign(f.state, { stage: 'FORMING', activeTargetId: 'target', targets: [{ id: 'target', code: 'TARGET', quantity: 0, closed: false }],
    problemSources: [{ code: 'UNKNOWN', scanned: true, reason: 'BOX_NOT_FOUND' }] });
  return f;
}
it('recovers an unknown KIZ in the target and distinguishes recovery from movement', async () => {
  // TEST: one scanned problem source can be used without forcing another menu.
  const f = forming(); const dto = { barcode: '4600000000001', kiz };
  await f.service.move(f.tx, f.state, dto, user);
  f.service.stock.reconcileAdminSortingUnit.mockResolvedValue({ skuId: 'sku', sourceBoxId: null, recovered: false, alreadyApplied: true });
  await f.service.move(f.tx, f.state, dto, user);
  expect(f.service.stock.reconcileAdminSortingUnit).toHaveBeenCalledWith(f.tx, expect.objectContaining({ sourceBoxCode: 'UNKNOWN', toBoxCode: 'TARGET', barcode: dto.barcode, kiz }), user);
  expect(f.state.moves).toEqual([expect.objectContaining({ sourceBoxId: null, sourceBoxCode: 'UNKNOWN', recovered: true })]);
  expect(f.state.targets[0].quantity).toBe(1);
  expect(f.service.stock.transferSortingUnit).not.toHaveBeenCalled();
});
it('uses a real available source when it is unambiguous and does not increase total stock', async () => {
  // TEST: recovery is a fallback, never an alternative to a known available unit.
  const f = forming(); f.state.sources = [{ id: 'a', code: 'A', scanned: true }];
  f.service.stock.reconcileAdminSortingUnit.mockResolvedValue({ skuId: 'sku', sourceBoxId: 'a', recovered: false, alreadyApplied: false });
  await f.service.move(f.tx, f.state, { barcode: '4600000000001', kiz }, user);
  expect(f.service.stock.reconcileAdminSortingUnit).toHaveBeenCalledWith(f.tx, expect.objectContaining({ sourceBoxIds: ['a'] }), user);
  expect(f.state.moves[0].sourceBoxId).toBe('a');
  expect(f.state.moves[0].recovered).not.toBe(true);
  expect(f.service.stock.recoverSortingUnit).not.toHaveBeenCalled();
});
it.each([false, true])('allows an ADMIN physical scan without a problem-source blocker (unscanned=%s)', async unscanned => {
  // TEST: SKU + KIZ is the fact; the helper resolves or receives the unit atomically.
  const f = forming(); f.state.problemSources = unscanned ? [{ code: 'UNKNOWN', scanned: false, reason: 'BOX_NOT_FOUND' }] : [];
  await f.service.move(f.tx, f.state, { barcode: '4600000000001', kiz }, user);
  expect(f.service.stock.reconcileAdminSortingUnit).toHaveBeenCalledTimes(1);
  expect(f.service.stock.recoverSortingUnit).not.toHaveBeenCalled();
});
it('also records an unknown source scanned in an already forming session', async () => {
  // TEST: existing sessions need not be abandoned to recover the physical unit.
  const f = forming(); f.state.problemSources = [];
  await f.service.move(f.tx, f.state, { barcode: '4600000000001', kiz, sourceBoxCode: 'UNKNOWN' }, user);
  expect(f.state.problemSources).toEqual([expect.objectContaining({ code: 'UNKNOWN', scanned: true })]);
  expect(f.service.stock.reconcileAdminSortingUnit).toHaveBeenCalledTimes(1);
});
it('delegates a registered or shipped KIZ without invoking the old history blocker', async () => {
  // TEST: history preservation and current physical reassignment coexist in the new helper.
  const f = forming(); f.tx.productMark.findMany.mockResolvedValue([{ id: 'mark', boxId: 'old', status: 'SHIPPING' }]);
  await f.service.move(f.tx, f.state, { barcode: '4600000000001', kiz }, user);
  expect(f.service.stock.reconcileAdminSortingUnit).toHaveBeenCalledTimes(1);
  expect(f.service.stock.recoverSortingUnit).not.toHaveBeenCalled();
});

it.each([0, 2])('uses an explicit source outside the pallet checklist with %s available units', async quantity => {
  // TEST: forming may use another pallet without silently appending its boxes to the final write-off.
  const f = forming();
  f.service.assertUnclaimed = vi.fn(); f.service.assertMovementAllowed = vi.fn(); f.service.resetAffectedRoutes = vi.fn();
  const box = { id: 'external', code: 'EXTERNAL', clientId: 'client', warehouseId: 'wh', status: 'active', storagePlacement: { palletId: 'other-pallet' } };
  f.tx.box.findUnique.mockResolvedValue(box);
  f.service.stock.reconcileAdminSortingUnit.mockResolvedValue({ skuId: 'sku', sourceBoxId: 'external', recovered: !quantity, alreadyApplied: false });
  await f.service.move(f.tx, f.state, { barcode: '4600000000001', kiz, sourceBoxCode: 'EXTERNAL' }, user);
  expect(f.state.sources).toEqual([]);
  expect(f.service.stock.reconcileAdminSortingUnit).toHaveBeenCalledWith(f.tx, expect.objectContaining({ sourceBoxCode: 'EXTERNAL' }), user);
  expect(Boolean(f.state.moves[0].recovered)).toBe(!quantity);
  expect(f.service.stock.recoverSortingUnit).not.toHaveBeenCalled();
});

function stockFixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const service = Object.create(StockOperationsService.prototype) as any;
  service.clientScopes = { requireClientAccess: vi.fn() };
  service.incrementTargetBalance = vi.fn();
  const target = { id: 'target', code: 'TARGET', clientId: 'client', warehouseId: 'wh', status: 'active', palletId: null };
  const tx: any = { $executeRaw: vi.fn(), box: { findUnique: vi.fn(async ({ where }: any) => where.code === 'TARGET' ? target : null) },
    barcode: { findMany: vi.fn().mockResolvedValue([{ sku: { id: 'sku', clientId: 'client' } }]) },
    stockMovement: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'receipt' }) },
    productMark: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    fbsTsdAssembly: { findFirst: vi.fn().mockResolvedValue(null) }, shippedKizHistory: { findFirst: vi.fn().mockResolvedValue(null) },
    fbsWebKizStickerPrint: { findFirst: vi.fn().mockResolvedValue(null) }, fbsAssemblyAttemptHistory: { findFirst: vi.fn().mockResolvedValue(null) },
    fbsPrintJob: { findFirst: vi.fn().mockResolvedValue(null) }, kizCirculationItem: { findFirst: vi.fn().mockResolvedValue(null) } };
  const input = { clientId: 'client', sourceBoxCode: 'UNKNOWN', toBoxCode: 'TARGET', barcode: '4600000000001', kiz, sessionId: 'session', idempotencyKey: 'recover-key' };
  return { service, tx, input };
}
function knownStockFixture() {
  const f = stockFixture();
  const source = { id: 'source', code: 'SOURCE', clientId: 'client', warehouseId: 'wh', status: 'active', storagePlacement: { palletId: 'pallet' } };
  const findBox = f.tx.box.findUnique.getMockImplementation();
  f.tx.box.findUnique.mockImplementation((query: any) => query.where.code === 'SOURCE' ? source : findBox(query));
  f.tx.stockBalance = { findFirst: vi.fn().mockResolvedValue(null) };
  return { ...f, source, input: { ...f.input, sourceBoxCode: 'SOURCE', knownSource: { id: 'source', placementId: 'pallet' as string | null } } };
}
it('accounts for a new physical KIZ from an exhausted known source without debiting other boxes', async () => {
  // TEST: the incident's known box has zero WMS stock for the scanned SKU, not a missing Box.
  const f = knownStockFixture();
  await f.service.recoverSortingUnit(f.tx, f.input, user);
  expect(f.tx.stockBalance.findFirst).toHaveBeenCalledWith({ where: { boxId: 'source', skuId: 'sku', quantity: { not: 0 } }, select: { id: true } });
  expect(f.service.incrementTargetBalance).toHaveBeenCalledTimes(1);
  expect(f.tx.stockMovement.create.mock.calls[0][0].data).toMatchObject({ quantity: 1, type: 'INVENTORY_ADJUSTMENT', boxId: 'target' });
  expect(f.tx.stockMovement.create.mock.calls[0][0].data.comment).toContain('расхождение');
  expect(f.tx.stockMovement.create.mock.calls[0][0].data.comment).not.toContain('отсутствует в WMS');
});
it.each(['client', 'warehouse', 'archived', 'placement', 'id', 'self'])('rejects invalid known-source evidence: %s', async kind => {
  // TEST: explicit scan is not permission to use another client, pallet, archived or target box.
  const f = knownStockFixture();
  if (kind === 'client') f.source.clientId = 'other';
  if (kind === 'warehouse') f.source.warehouseId = 'other';
  if (kind === 'archived') f.source.status = 'archived';
  if (kind === 'placement') f.source.storagePlacement.palletId = 'other';
  if (kind === 'id') f.source.id = 'other';
  if (kind === 'self') { f.source.id = 'target'; f.input.knownSource.id = 'target'; }
  await expect(f.service.recoverSortingUnit(f.tx, f.input, user)).rejects.toThrow();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it('rejects a known source that disappeared, instead of treating it as unknown', async () => {
  const f = knownStockFixture(); f.tx.box.findUnique.mockResolvedValue(null);
  await expect(f.service.recoverSortingUnit(f.tx, f.input, user)).rejects.toThrow();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it.each(['AVAILABLE', 'RESERVED', 'SHIPPING', 'NEGATIVE'])('does not recover over any nonzero source SKU balance: %s', async status => {
  // TEST: status-independent query prevents converting a reservation or negative balance to a surplus.
  const f = knownStockFixture(); f.tx.stockBalance.findFirst.mockResolvedValue({ id: 'balance', status });
  await expect(f.service.recoverSortingUnit(f.tx, f.input, user)).rejects.toThrow();
  expect(f.tx.stockBalance.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { boxId: 'source', skuId: 'sku', quantity: { not: 0 } } }));
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it.each(['productMark', 'fbsTsdAssembly', 'shippedKizHistory', 'fbsWebKizStickerPrint', 'fbsAssemblyAttemptHistory', 'fbsPrintJob', 'kizCirculationItem'])('preserves %s history protection for known-source recovery', async delegate => {
  const f = knownStockFixture(); f.tx[delegate].findFirst.mockResolvedValue({ id: 'known' });
  await expect(f.service.recoverSortingUnit(f.tx, f.input, user)).rejects.toThrow('КИЗ');
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it('replays a known-source receipt without checking or changing later balances', async () => {
  // TEST: replay returns the completed operation even if source stock was received afterwards.
  const f = knownStockFixture();
  f.tx.stockMovement.findUnique.mockResolvedValue({ id: 'receipt', clientId: 'client', warehouseId: 'wh', boxId: 'target', skuId: 'sku', sourceDocument: 'PALLET_SORTING:session', type: 'INVENTORY_ADJUSTMENT', quantity: 1 });
  f.tx.productMark.findFirst.mockResolvedValue({ id: 'mark' });
  expect(await f.service.recoverSortingUnit(f.tx, f.input, user)).toEqual({ skuId: 'sku', movementId: 'receipt' });
  expect(f.tx.stockBalance.findFirst).not.toHaveBeenCalled();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it('creates an audited +1 adjustment and one mark in the target, never a fictitious debit', async () => {
  // TEST: recovered physical stock has honest ledger provenance and existing balance-key rules.
  const f = stockFixture();
  await f.service.recoverSortingUnit(f.tx, f.input, user);
  expect(f.service.incrementTargetBalance).toHaveBeenCalledWith(f.tx, expect.objectContaining({ boxId: 'target', clientId: 'client', quantity: 1, status: 'AVAILABLE' }));
  expect(f.tx.stockMovement.create).toHaveBeenCalledTimes(1);
  expect(f.tx.stockMovement.create.mock.calls[0][0].data).toMatchObject({ type: 'INVENTORY_ADJUSTMENT', quantity: 1, boxId: 'target', sourceDocument: 'PALLET_SORTING:session' });
  expect(f.tx.productMark.create.mock.calls[0][0].data).toMatchObject({ value: kiz, skuId: 'sku', boxId: 'target', stockMovementId: 'receipt' });
});
it.each(['productMark', 'fbsTsdAssembly', 'shippedKizHistory', 'fbsWebKizStickerPrint', 'fbsAssemblyAttemptHistory', 'fbsPrintJob', 'kizCirculationItem'])('rejects existing ownership in %s before any write', async delegate => {
  // TEST: all clients, crypto tails and historical assembly attempts remain protected.
  const f = stockFixture(); f.tx[delegate].findFirst.mockResolvedValue({ id: 'known' });
  await expect(f.service.recoverSortingUnit(f.tx, f.input, user)).rejects.toThrow('КИЗ');
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
  const where = f.tx[delegate].findFirst.mock.calls[0][0].where;
  expect(where.clientId).toBeUndefined();
  expect(where.OR.length).toBeGreaterThan(1);
});
it('rejects a source that appeared since its problem scan', async () => {
  // TEST: recoverability is rechecked in the same owning transaction.
  const f = stockFixture(); f.tx.box.findUnique.mockResolvedValue({ id: 'recreated' });
  await expect(f.service.recoverSortingUnit(f.tx, f.input, user)).rejects.toThrow();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it.each([{ roleCodes: ['OPERATOR'] }, { activeWarehouseId: 'foreign' }])('does not bypass role or branch scope: %j', async override => {
  // TEST: the new stock entry point is independently administrator-only.
  const f = stockFixture();
  await expect(f.service.recoverSortingUnit(f.tx, f.input, { ...user, ...override })).rejects.toThrow();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it('is disabled when the sold installation does not enable sorting', async () => {
  // TEST: no new write behavior in the sold WMS.
  const f = stockFixture(); vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'false');
  await expect(f.service.recoverSortingUnit(f.tx, f.input, user)).rejects.toThrow();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it.each([null, { id: 'target', status: 'archived' }, { id: 'target', status: 'active', clientId: 'foreign', warehouseId: 'wh' }])('rejects unavailable targets: %j', async target => {
  // TEST: no new target may be created implicitly by the recovery operation.
  const f = stockFixture(); f.tx.box.findUnique.mockImplementation(async ({ where }: any) => where.code === 'TARGET' ? target : null);
  await expect(f.service.recoverSortingUnit(f.tx, f.input, user)).rejects.toThrow();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it.each([{ products: [] }, { products: [{ sku: { id: 'a' } }, { sku: { id: 'b' } }] }])('rejects an absent or ambiguous SKU: %j', async ({ products }) => {
  // TEST: recovery is not permission to invent or guess a client's product card.
  const f = stockFixture(); f.tx.barcode.findMany.mockResolvedValue(products);
  await expect(f.service.recoverSortingUnit(f.tx, f.input, user)).rejects.toThrow('ШК');
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it('replays only the matching prior ledger and KIZ without a second increment', async () => {
  // TEST: input reuse must match box, SKU, client, warehouse, session, movement and mark.
  const f = stockFixture();
  const prior = { id: 'receipt', clientId: 'client', warehouseId: 'wh', boxId: 'target', skuId: 'sku', sourceDocument: 'PALLET_SORTING:session', type: 'INVENTORY_ADJUSTMENT', quantity: 1 };
  f.tx.stockMovement.findUnique.mockResolvedValue(prior);
  f.tx.productMark.findFirst.mockResolvedValue({ id: 'mark' });
  expect(await f.service.recoverSortingUnit(f.tx, f.input, user)).toEqual({ skuId: 'sku', movementId: 'receipt' });
  f.tx.productMark.findFirst.mockResolvedValue(null);
  await expect(f.service.recoverSortingUnit(f.tx, f.input, user)).rejects.toThrow('КИЗ');
  f.tx.stockMovement.findUnique.mockResolvedValue({ ...prior, boxId: 'other' });
  await expect(f.service.recoverSortingUnit(f.tx, f.input, user)).rejects.toThrow('другими');
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});
it('retains problems and recovery counts in the final shortage preview', async () => {
  // TEST: unknown boxes are never treated as zero-quantity ordinary archive candidates.
  const f = forming(); f.state.moves = [{ recovered: true }];
  f.tx.fbsTsdAssembly = { findMany: vi.fn().mockResolvedValue([]) };
  const preview = await f.service.previewInTx(f.tx, f.state, 'remaining');
  expect(preview).toMatchObject({ quantity: 0, recoveredQuantity: 1, problemSources: f.state.problemSources, boxes: [] });
});
it('does not turn a problem source into its own target box', async () => {
  // TEST: preserving the problematic old code prevents self-transfer provenance loss.
  const f = forming(); f.state.activeTargetId = null;
  await expect(f.service.openTarget(f.tx, f.state, { code: 'UNKNOWN', palletCode: 'PAL' }, user)).rejects.toThrow('новый');
});
it('does not guess between multiple scanned unknown boxes', async () => {
  // TEST: accept the physical unit without inventing which missing box contained it.
  const f = forming(); f.state.problemSources.push({ code: 'UNKNOWN_2', scanned: true, reason: 'BOX_NOT_FOUND' });
  await f.service.move(f.tx, f.state, { barcode: '4600000000001', kiz }, user);
  expect(f.service.stock.recoverSortingUnit).not.toHaveBeenCalled();
  expect(f.service.stock.reconcileAdminSortingUnit).toHaveBeenCalledWith(f.tx, expect.objectContaining({ sourceBoxCode: undefined }), user);
  expect(f.state.moves[0].sourceBoxCode).toBeUndefined();
});
it('resolves an orphan pallet placement by its existing box code without inventing stock', async () => {
  // TEST: stale placement.boxId is metadata, not an ADMIN business blocker.
  const f = fixture();
  const box = { id: 'real-box', code: 'UNKNOWN', clientId: 'client', warehouseId: 'wh', status: 'archived', storagePlacement: null };
  f.tx.box.findUnique.mockResolvedValue(box);
  f.tx.box.findMany.mockResolvedValue([box]);
  const result = await f.service.start({ id: 'session', code: 'PAL' }, user);
  expect(result.sources).toEqual([expect.objectContaining({ id: 'real-box', scanned: false })]);
  expect(result.problemSources).toEqual([]);
  expect(f.service.stock.reconcileAdminSortingUnit).not.toHaveBeenCalled();
});
