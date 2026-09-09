import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Session } from 'node:inspector';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';
import { sortingSettledBoxTaskIds } from '../src/modules/stock/sorting-settled-box-tasks';

// TEST: native V8 block coverage for the new stock-proof helper, without new dependencies.
if (process.env.SORTING_SETTLED_COVERAGE === 'true') {
  const profiler = new Session();
  const post = (method: string, params = {}) => new Promise<any>((resolve, reject) => profiler.post(method as any, params, (e, r) => e ? reject(e) : resolve(r)));
  beforeAll(async () => { profiler.connect(); await post('Profiler.enable'); await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true }); });
  afterAll(async () => {
    try {
      const data = await post('Profiler.takePreciseCoverage');
      const fn = data.result.flatMap((s: any) => s.functions).find((f: any) => f.functionName === 'sortingSettledBoxTaskIds');
      expect(fn).toBeDefined();
      const covered = fn.ranges.filter((r: any) => r.count > 0).length;
      console.log(JSON.stringify({ function: fn.functionName, covered, blocks: fn.ranges.length, percent: 100 * covered / fn.ranges.length }));
      expect(covered / fn.ranges.length).toBeGreaterThanOrEqual(0.8);
    } finally { await post('Profiler.stopPreciseCoverage'); profiler.disconnect(); }
  });
}

const kiz = '0104640569951908215bxBcifeXxp4X';
const oldKiz = '0104640569951908215))DjkgBed&TS';
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const service: any = Object.create(StockOperationsService.prototype);
  const source = { id: 'source', code: 'FFL_LKB0104_215', clientId: 'client', warehouseId: 'wh' };
  const product = { sku: { id: 'sku' }, availableQuantity: 7 };
  const task: any = { id: 'old-task', clientId: 'client', skuId: 'sku', sourceSkuId: null, boxId: 'source', reservedBoxId: 'source',
    status: 'RETURN_REQUIRED', kiz: oldKiz, completedAt: new Date(), marketplace: 'WILDBERRIES' };
  const prefix = 'fbs-sticker-pick:old-task:';
  const movements: any[] = [
    { idempotencyKey: prefix + 'balance:out', type: 'PICK', status: 'AVAILABLE', quantity: -1 },
    { idempotencyKey: prefix + 'in', type: 'PICK', status: 'PACKING', quantity: 1 },
    { idempotencyKey: prefix + 'marketplace-complete:wh:source:no-pallet', type: 'SHIP', status: 'PACKING', quantity: -1 },
  ].map(row => ({ ...row, clientId: 'client', warehouseId: 'wh', skuId: 'sku', boxId: 'source' }));
  const tx: any = {
    productMark: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
    fbsTsdAssembly: { findMany: vi.fn(async () => [task]), findFirst: vi.fn(async ({ where }: any) => where.AND && !where.id?.notIn?.includes(task.id) ? { id: task.id } : null) },
    shippedKizHistory: { findFirst: vi.fn().mockResolvedValue(null) }, fbsWebKizStickerPrint: { findFirst: vi.fn().mockResolvedValue(null) },
    fbsPrintJob: { findFirst: vi.fn().mockResolvedValue(null) }, kizCirculationItem: { findFirst: vi.fn().mockResolvedValue(null) },
    fbsAssemblyAttemptHistory: { findFirst: vi.fn().mockResolvedValue(null) }, stockMovement: { findMany: vi.fn(async () => movements) },
  };
  const run = (sorting = true) => service.resolveUnregisteredStorageBoxTransferMark(tx, source, product, kiz, undefined, sorting);
  return { service, source, product, task, movements, tx, run };
}
it('admin sorting ignores a DIFFERENT fully deducted old order, preserving its history', async () => {
  // TEST: incident 5621225407 must not block a new KIZ in the same box/SKU.
  const f = fixture();
  const item = await f.run();
  expect(item.registerMissingMark).toBe(true);
  expect(item.sortingSettledTaskIds).toEqual(['old-task']);
  expect(f.task.boxId).toBe('source'); expect(f.task.status).toBe('RETURN_REQUIRED');
});
it('ordinary transfers retain the original box task guard', async () => {
  // TEST: sorting permission must not leak to ordinary TSD transfers.
  const f = fixture(); await expect(f.run(false)).rejects.toThrow('связан');
  expect(f.tx.stockMovement.findMany).not.toHaveBeenCalled();
});
it.each(['no-identity', 'no-warehouse', 'too-many', 'no-tasks', 'unknown-old-kiz', 'wrong-task-client', 'wrong-task-sku', 'wrong-task-box'])('fails closed or has no exclusions: %s', async kind => {
  // TEST: malformed or unbounded context cannot authorize an exception.
  const f = fixture();
  if (kind === 'no-warehouse') f.source.warehouseId = '';
  if (kind === 'too-many') f.tx.fbsTsdAssembly.findMany.mockResolvedValue(Array(101).fill(f.task));
  if (kind === 'no-tasks') f.tx.fbsTsdAssembly.findMany.mockResolvedValue([]);
  if (kind === 'unknown-old-kiz') f.task.kiz = null;
  if (kind === 'wrong-task-client') f.task.clientId = 'other';
  if (kind === 'wrong-task-sku') f.task.sourceSkuId = 'other';
  if (kind === 'wrong-task-box') { f.task.boxId = null; f.task.reservedBoxId = 'other'; }
  const parse = (value: string) => value ? { gtin: 'gtin', serial: value } : null;
  expect(await sortingSettledBoxTaskIds(f.tx, f.source, 'sku', kind === 'no-identity' ? '' : kiz, parse)).toEqual([]);
});
it('the real sorting resolver chain transfers one existing unit, with an audit-ready historical-task list', async () => {
  // TEST: exercise public entry + real item/mark/history resolution, not just the proof helper.
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const f = fixture();
  f.service.loadTsdTransferSourceBox = vi.fn(async () => f.source);
  f.service.resolveStorageTransferBarcode = vi.fn(async () => ({ ...f.product, scanType: 'BARCODE', requiresKizRegistration: true }));
  f.tx.box = { findUnique: vi.fn(async () => ({ id: 'target', clientId: 'client', warehouseId: 'wh', status: 'active', code: 'TARGET' })) };
  f.tx.stockMovement.findUnique = vi.fn(async () => ({ id: 'movement-in' }));
  f.tx.productMark.create = vi.fn();
  let sourceQuantity = 7, targetQuantity = 0;
  f.service.applyTransferBetweenBoxes = vi.fn(async (_tx: any, input: any) => { sourceQuantity -= input.quantity; targetQuantity += input.quantity; });
  const result = await f.service.transferSortingUnit(f.tx, { fromBoxCode: f.source.code, toBoxCode: 'TARGET', barcode: '2047945565575', kiz, sessionId: 'session', idempotencyKey: 'op' },
    { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' });
  expect([sourceQuantity, targetQuantity]).toEqual([6, 1]);
  expect(result.sortingSettledTaskIds).toEqual(['old-task']);
  expect(f.tx.productMark.create).toHaveBeenCalledWith({ data: expect.objectContaining({ value: kiz, boxId: 'target', status: 'AVAILABLE' }) });
  expect(f.task.kiz).toBe(oldKiz);
});
it.each(['operator', 'disabled'])('rejects sorting exception at the public stock entry: %s', async kind => {
  // TEST: sold/default-off installation and non-admin callers cannot reach the new path.
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', kind === 'disabled' ? 'false' : 'true');
  const f = fixture();
  await expect(f.service.transferSortingUnit(f.tx, {}, { roleCodes: kind === 'operator' ? ['OPERATOR'] : ['ADMIN'], activeWarehouseId: 'wh' })).rejects.toThrow('администратору');
  expect(f.tx.fbsTsdAssembly.findMany).not.toHaveBeenCalled();
});
it.each(['own-kiz', 'not-completed', 'in-progress', 'no-ship', 'packing-left', 'returned', 'foreign-client', 'foreign-warehouse', 'foreign-sku', 'foreign-box'])('does not exclude an unsafe task: %s', async kind => {
  // TEST: zero packing alone is not proof of a completed physical stock deduction.
  const f = fixture();
  if (kind === 'own-kiz') f.task.kiz = kiz;
  if (kind === 'not-completed') f.task.completedAt = null;
  if (kind === 'in-progress') f.task.status = 'IN_PROGRESS';
  if (kind === 'no-ship') f.movements.pop();
  if (kind === 'packing-left') f.movements[1].quantity = 2;
  if (kind === 'returned') f.movements.push({ ...f.movements[0], type: 'RETURN', quantity: 1 });
  const field = { 'foreign-client': 'clientId', 'foreign-warehouse': 'warehouseId', 'foreign-sku': 'skuId', 'foreign-box': 'boxId' }[kind];
  if (field) f.movements[2][field] = 'other';
  await expect(f.run()).rejects.toThrow('связан');
});
it.each(['fbsTsdAssembly', 'shippedKizHistory', 'fbsWebKizStickerPrint', 'fbsAssemblyAttemptHistory', 'fbsPrintJob', 'kizCirculationItem'])('keeps the scanned KIZ own %s history blocking', async table => {
  // TEST: old-task exclusion never overrides identity-level ownership.
  const f = fixture(); f.tx[table].findFirst.mockResolvedValue({ id: 'own-history' });
  await expect(f.run()).rejects.toThrow('связан');
});
it('invalidates logical routes at the physical source scan without changing stock', async () => {
  // TEST: previously this happened only after a successful MOVE.
  const service: any = Object.create(PalletSortingService.prototype);
  service.boxCodes = { normalize: async (s: string) => s }; service.resetAffectedRoutes = vi.fn();
  const state: any = { stage: 'CHECKING', clientId: 'client', warehouseId: 'wh', sources: [{ id: 'source', code: 'SOURCE' }] };
  const tx = {}, user = { id: 'admin' };
  await service.runAction(tx, state, { action: 'SCAN_SOURCE', code: 'SOURCE' }, user);
  expect(service.resetAffectedRoutes).toHaveBeenCalledWith(tx, state, ['source'], user, undefined, { clientId: 'client', warehouseId: 'wh' });
});
it('invalidates the reconciled source within the same administrative transaction', async () => {
  // TEST: old FORMING sessions delegate accounting then invalidate the proven source, before commit.
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const service: any = Object.create(PalletSortingService.prototype);
  service.boxCodes = { normalize: async (s: string) => s, requireAllowed: async (s: string) => s }; service.audit = vi.fn();
  service.assertUnclaimed = vi.fn(); service.assertMovementAllowed = vi.fn(); // TEST: move owns its source checks.
  const events: string[] = [];
  service.resetAffectedRoutes = vi.fn(async () => events.push('reset'));
  service.stock = { reconcileAdminSortingUnit: vi.fn(async () => { events.push('move'); return { skuId: 'sku', sourceBoxId: 'source', sourceClientId: 'client', sourceWarehouseId: 'wh', recovered: false, alreadyApplied: false }; }) };
  const state: any = { stage: 'FORMING', id: 'session', clientId: 'client', warehouseId: 'wh', sources: [{ id: 'source', code: 'SOURCE', scanned: true }],
    activeTargetId: 'target', targets: [{ id: 'target', code: 'TARGET', quantity: 0 }], moves: [] };
  const tx = { productMark: { findMany: async () => [] }, stockBalance: { findMany: async () => [{ boxId: 'source' }] },
    box: { findUnique: async () => ({ id: 'source', code: 'SOURCE', status: 'active', clientId: 'client', warehouseId: 'wh', storagePlacement: null }) } };
  await service.move(tx, state, { barcode: 'barcode', kiz, sourceBoxCode: 'SOURCE' }, { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' });
  expect(events).toEqual(['move', 'reset']);
});

it.each(['logical', 'picked', 'physical-scan', 'return-required', 'foreign-branch', 'race'])('real route invalidation preserves stock and handles %s', async kind => {
  // TEST: only unpicked logical reservations can be detached; CAS protects concurrent scans.
  const service: any = Object.create(PalletSortingService.prototype); service.audit = vi.fn();
  const task: any = { id: 'task', orderId: 'order', requestId: 'request', status: 'IN_PROGRESS', boxId: 'source', reservedBoxId: 'source',
    barcode: null, kiz: null, sourceBarcode: null, relabelConfirmedAt: null, updatedAt: new Date() };
  if (kind === 'physical-scan') task.barcode = 'barcode';
  if (kind === 'return-required') task.status = 'RETURN_REQUIRED';
  const tx: any = { fbsTsdAssembly: { findMany: vi.fn(async () => [task]), updateMany: vi.fn(async () => ({ count: kind === 'race' ? 0 : 1 })) },
    stockMovement: { findFirst: vi.fn(async () => kind === 'picked' ? { id: 'pick' } : null) },
    clientRequest: { findUnique: vi.fn(async () => ({ warehouseId: kind === 'foreign-branch' ? 'other' : 'wh', clientId: 'client' })) } };
  const state: any = { id: 'session', clientId: 'client', warehouseId: 'wh', version: 4, pendingRoutes: [] };
  const run = () => service.resetAffectedRoutes(tx, state, ['source'], { id: 'admin' });
  if (kind === 'race') { await expect(run()).rejects.toThrow(); expect(state.pendingRoutes).toEqual([]); return; }
  await run();
  if (kind === 'logical') {
    expect(tx.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ updatedAt: task.updatedAt, barcode: null, kiz: null }),
      data: expect.objectContaining({ boxId: null, reservedBoxId: null, storageBoxes: [], status: 'IN_PROGRESS' }) });
    expect(state.pendingRoutes).toEqual([{ requestId: 'request', taskIds: ['task'], revision: 5, clientId: 'client', warehouseId: 'wh' }]);
    expect(service.audit).toHaveBeenCalledWith(tx, state, { id: 'admin' }, 'FBS_ROUTE_INVALIDATED', expect.objectContaining({ taskId: 'task' }));
  } else {
    expect(tx.fbsTsdAssembly.updateMany).not.toHaveBeenCalled(); expect(state.pendingRoutes).toEqual([]);
    if (kind === 'foreign-branch') {
      // TEST: inconsistent request provenance is audited, not guessed or allowed to block the physical unit.
      expect(service.audit).toHaveBeenCalledWith(tx, state, { id: 'admin' }, 'FBS_ROUTE_SCOPE_CONFLICT', expect.objectContaining({ taskId: 'task' }));
    }
  }
});
