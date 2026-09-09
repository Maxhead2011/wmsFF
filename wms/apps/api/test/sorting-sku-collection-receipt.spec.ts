import { afterAll, beforeAll, afterEach, expect, it, vi } from 'vitest';
import { Session } from 'node:inspector';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

const kiz = '0104680992598462215bSWUB,BlKri7';
const user: any = { id: 'admin', name: 'Admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' };
afterEach(() => vi.unstubAllEnvs());
// TEST: optional precise function-block coverage without downloading coverage dependencies.
if (process.env.SORTING_SKU_RECEIPT_COVERAGE === 'true') {
  const profiler = new Session();
  const post = (method: string, params = {}) => new Promise<any>((resolve, reject) => profiler.post(method as any, params, (e, r) => e ? reject(e) : resolve(r)));
  beforeAll(async () => { profiler.connect(); await post('Profiler.enable'); await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true }); });
  afterAll(async () => {
    try {
      const report = await post('Profiler.takePreciseCoverage');
      const script = report.result.find((s: any) => s.url.includes('/sorting-sku-collection-receipt.ts') && !s.url.includes('/test/'));
      const fn = script.functions.find((f: any) => f.functionName === 'receiveSkuCollectionSortingUnit');
      const covered = fn.ranges.filter((r: any) => r.count > 0).length;
      console.log(JSON.stringify({ function: fn.functionName, covered, blocks: fn.ranges.length, percent: covered / fn.ranges.length * 100 }));
      expect(covered / fn.ranges.length).toBeGreaterThanOrEqual(0.8);
    } finally { await post('Profiler.stopPreciseCoverage'); profiler.disconnect(); }
  });
}

it('receives a previously picked SKU into the sorting target instead of rejecting PACKING', async () => {
  // TEST: reproduces the existing move path for request 633, without pretending it is a write-off.
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const service: any = Object.create(PalletSortingService.prototype);
  service.audit = vi.fn();
  service.stock = { receiveSkuCollectionSortingUnit: vi.fn().mockResolvedValue({ skuId: 'sku', movementId: 'move', requestId: 'collection', scanId: 'scan' }) };
  const state: any = { id: 'session', clientId: 'client', warehouseId: 'wh', stage: 'FORMING', version: 1,
    sources: [], targets: [{ id: 'target', code: 'TARGET', quantity: 0, closed: false }], activeTargetId: 'target', moves: [] };
  const tx: any = { productMark: { findMany: vi.fn().mockResolvedValue([{ id: 'mark', status: 'PACKING', boxId: null }]) } };
  await service.move(tx, state, { barcode: '2051621250518', kiz }, user);
  expect(state.targets[0].quantity).toBe(1);
  expect(state.moves).toHaveLength(1);
  expect(state.moves[0].recovered).not.toBe(true);
  await service.move(tx, state, { barcode: '2051621250518', kiz }, user);
  expect(service.stock.receiveSkuCollectionSortingUnit).toHaveBeenCalledTimes(1);
});

function fixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const service: any = Object.create(StockOperationsService.prototype);
  service.clientScopes = { requireClientAccess: vi.fn() }; service.incrementTargetBalance = vi.fn();
  const at = new Date('2026-09-05T08:21:36Z');
  const mark: any = { id: 'mark', clientId: 'client', skuId: 'sku', value: kiz, status: 'PACKING', boxId: null, sourceDocument: 'collection', stockMovementId: 'pick', updatedAt: at };
  const request: any = { id: 'collection', number: 633, clientId: 'client', warehouseId: 'wh', type: 'SKU_COLLECTION', status: 'IN_WORK' };
  const source: any = { id: 'source', requestId: 'collection', clientId: 'client', warehouseId: 'wh', skuId: 'sku', sourceBoxId: 'old', pickedQuantity: 2, receivedQuantity: 0, updatedAt: at };
  const scan: any = { id: 'scan', requestId: 'collection', sourceId: 'source', skuId: 'sku', kiz, sourceBoxId: 'old', status: 'PICKED', receivedAt: null, targetBoxId: null, updatedAt: at, source };
  const pick: any = { id: 'pick', type: 'PICK', status: 'PACKING', quantity: 1, clientId: 'client', warehouseId: 'wh', skuId: 'sku', boxId: null, palletId: null, sourceDocument: 'collection' };
  const balance: any = { id: 'packing', clientId: 'client', warehouseId: 'wh', skuId: 'sku', status: 'PACKING', boxId: null, palletId: null, quantity: 24, updatedAt: at };
  const target: any = { id: 'target', code: 'TARGET', status: 'active', clientId: 'client', warehouseId: 'wh', palletId: null };
  const tx: any = { $executeRaw: vi.fn(), $queryRaw: vi.fn(),
    productMark: { findMany: vi.fn(async () => [mark]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    clientRequest: { findUnique: vi.fn(async () => request), update: vi.fn() },
    skuCollectionScan: { findMany: vi.fn(async () => [scan]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    skuCollectionSource: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), aggregate: vi.fn().mockResolvedValue({ _sum: { plannedQuantity: 5, pickedQuantity: 2, receivedQuantity: 1 } }) },
    box: { findUnique: vi.fn(async () => target) }, barcode: { findMany: vi.fn().mockResolvedValue([{ skuId: 'sku' }]) },
    stockBalance: { findMany: vi.fn(async () => [balance]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    stockMovement: { findUnique: vi.fn(async ({ where }: any) => where.id === 'pick' ? pick : null), create: vi.fn().mockResolvedValue({ id: 'received' }) },
    auditLog: { create: vi.fn() },
    ...Object.fromEntries(['fbsTsdAssembly','shippedKizHistory','fbsWebKizStickerPrint','fbsAssemblyAttemptHistory','fbsPrintJob','kizCirculationItem'].map(k => [k, { findFirst: vi.fn().mockResolvedValue(null) }])) };
  const input: any = { clientId: 'client', toBoxCode: 'TARGET', barcode: '2051621250518', kiz, sessionId: 'session', version: 1, idempotencyKey: 'sorting-key' };
  const run = (actor = user) => service.receiveSkuCollectionSortingUnit(tx, input, actor);
  return { service, tx, input, mark, request, scan, source, pick, balance, target, run };
}

it('moves exactly one PACKING unit and acknowledges receipt in the original collection', async () => {
  // TEST: both ledger legs, same identity, no stock creation or re-debit of the old box.
  const f = fixture(); await f.run();
  expect(f.tx.stockMovement.create.mock.calls.map((c: any) => c[0].data)).toEqual([
    expect.objectContaining({ type: 'MOVE', status: 'PACKING', boxId: null, quantity: -1, sourceDocument: 'collection' }),
    expect.objectContaining({ type: 'MOVE', status: 'AVAILABLE', boxId: 'target', quantity: 1, sourceDocument: 'collection' }),
  ]);
  expect(f.tx.stockBalance.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'packing', quantity: 24 }), data: { quantity: { decrement: 1 } } }));
  expect(f.service.incrementTargetBalance).toHaveBeenCalledTimes(1);
  expect(f.tx.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'AVAILABLE', boxId: 'target' }) }));
  expect(f.tx.skuCollectionScan.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RECEIVED', targetBoxId: 'target', receivedByUserId: 'admin' }) }));
  expect(f.tx.clientRequest.update).toHaveBeenCalledWith({ where: { id: 'collection' }, data: { status: 'IN_WORK' } });
});

it.each(['no-mark','duplicate-mark','foreign-mark','boxed-mark','wrong-status','no-request','fbs-request','foreign-request','other-warehouse','cancelled-request','no-scan','duplicate-scan','received-scan','wrong-scan-sku','wrong-source','source-count','wrong-barcode','no-target','foreign-target','archived-target','no-pick','wrong-pick','no-balance','duplicate-balance','negative-balance','foreign-balance','shipment','already-moved'])('does not receive inconsistent data: %s', async kind => {
  // TEST: consent/ADMIN never invents collection or shipment evidence.
  const f = fixture();
  if (kind === 'no-mark') f.tx.productMark.findMany.mockResolvedValue([]);
  if (kind === 'duplicate-mark') f.tx.productMark.findMany.mockResolvedValue([f.mark, f.mark]);
  if (kind === 'foreign-mark') f.mark.clientId = 'other';
  if (kind === 'boxed-mark') f.mark.boxId = 'old';
  if (kind === 'wrong-status') f.mark.status = 'SHIPPING';
  if (kind === 'no-request') f.tx.clientRequest.findUnique.mockResolvedValue(null);
  if (kind === 'fbs-request') f.request.type = 'FBS';
  if (kind === 'foreign-request') f.request.clientId = 'other';
  if (kind === 'other-warehouse') f.request.warehouseId = 'other';
  if (kind === 'cancelled-request') f.request.status = 'CANCELLED';
  if (kind === 'no-scan') f.tx.skuCollectionScan.findMany.mockResolvedValue([]);
  if (kind === 'duplicate-scan') f.tx.skuCollectionScan.findMany.mockResolvedValue([f.scan, f.scan]);
  if (kind === 'received-scan') f.scan.status = 'RECEIVED';
  if (kind === 'wrong-scan-sku') f.scan.skuId = 'other';
  if (kind === 'wrong-source') f.source.sourceBoxId = 'other';
  if (kind === 'source-count') f.source.receivedQuantity = 2;
  if (kind === 'wrong-barcode') f.tx.barcode.findMany.mockResolvedValue([{ skuId: 'other' }]);
  if (kind === 'no-target') f.tx.box.findUnique.mockResolvedValue(null);
  if (kind === 'foreign-target') f.target.clientId = 'other';
  if (kind === 'archived-target') f.target.status = 'archived';
  if (kind === 'no-pick') f.tx.stockMovement.findUnique.mockResolvedValue(null);
  if (kind === 'wrong-pick') f.pick.skuId = 'other';
  if (kind === 'no-balance') f.tx.stockBalance.findMany.mockResolvedValue([]);
  if (kind === 'duplicate-balance') f.tx.stockBalance.findMany.mockResolvedValue([f.balance, f.balance]);
  if (kind === 'negative-balance') f.balance.quantity = -1;
  if (kind === 'foreign-balance') f.balance.warehouseId = 'other';
  if (kind === 'shipment') f.tx.shippedKizHistory.findFirst.mockResolvedValue({ id: 'shipment' });
  if (kind === 'already-moved') f.tx.stockMovement.findUnique.mockImplementation(async ({ where }: any) => where.id ? f.pick : { id: 'replay' });
  await expect(f.run()).rejects.toThrow();
  expect(f.tx.stockMovement.create).not.toHaveBeenCalled();
  expect(f.service.incrementTargetBalance).not.toHaveBeenCalled();
});

it.each(['stockBalance','productMark','skuCollectionScan','skuCollectionSource'])('rejects concurrent change of %s so the outer transaction rolls back', async table => {
  // TEST: checked update counts, not unconditional overwrites.
  const f = fixture(); f.tx[table].updateMany.mockResolvedValue({ count: 0 });
  await expect(f.run()).rejects.toThrow();
});
it.each(['off','employee','client-scope'])('enforces access: %s', async mode => {
  const f = fixture();
  if (mode === 'off') vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'false');
  if (mode === 'client-scope') f.service.clientScopes.requireClientAccess.mockImplementation(() => { throw Error('client forbidden'); });
  await expect(f.run(mode === 'employee' ? { ...user, roleCodes: ['PICKER'] } : user)).rejects.toThrow();
  expect(f.tx.stockMovement.create).not.toHaveBeenCalled();
});
it.each([[5, 5, 1, 'PACKED'], [5, 5, 5, 'DONE']])('refreshes collection progress without re-picking (%s/%s/%s)', async (planned, picked, received, status) => {
  const f = fixture(); f.tx.skuCollectionSource.aggregate.mockResolvedValue({ _sum: { plannedQuantity: planned, pickedQuantity: picked, receivedQuantity: received } });
  await f.run(); expect(f.tx.clientRequest.update).toHaveBeenCalledWith({ where: { id: 'collection' }, data: { status } });
});
