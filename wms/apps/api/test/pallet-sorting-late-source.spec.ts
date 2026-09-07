import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Session } from 'node:inspector';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';

afterEach(() => vi.unstubAllEnvs());
const user = { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' };
const code = 'FFL_LKB0207_49', barcode = '4600000000001', kiz = '010460000000000121ABCDEFGHIJKLM';
// TEST: native V8 coverage for the new helper, no additional dependency install.
if (process.env.SORTING_LATE_SOURCE_COVERAGE === 'true') {
  const profiler = new Session();
  const post = (method: string, params = {}) => new Promise<any>((resolve, reject) => profiler.post(method as any, params, (e, r) => e ? reject(e) : resolve(r)));
  beforeAll(async () => { profiler.connect(); await post('Profiler.enable'); await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true }); });
  afterAll(async () => {
    try {
      const data = await post('Profiler.takePreciseCoverage');
      const fn = data.result.flatMap((s: any) => s.functions).find((f: any) => f.functionName === 'includeScannedSource');
      expect(fn).toBeDefined();
      const covered = fn.ranges.filter((r: any) => r.count > 0).length;
      console.log(JSON.stringify({ function: fn.functionName, covered, blocks: fn.ranges.length, percent: 100 * covered / fn.ranges.length }));
      expect(covered / fn.ranges.length).toBeGreaterThanOrEqual(0.8);
    } finally { await post('Profiler.stopPreciseCoverage'); profiler.disconnect(); }
  });
}
function fixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const service: any = Object.create(PalletSortingService.prototype);
  service.boxCodes = { normalize: async (s: string) => s.trim().toUpperCase(), requireAllowed: async (s: string) => s.trim().toUpperCase() };
  service.audit = vi.fn(); service.assertUnclaimed = vi.fn(); service.assertMovementAllowed = vi.fn(); service.resetAffectedRoutes = vi.fn();
  service.stock = { transferSortingUnit: vi.fn().mockResolvedValue({ skuId: 'sku' }), recoverSortingUnit: vi.fn() };
  const box: any = { id: 'late', code, status: 'active', clientId: 'client', warehouseId: 'wh', storagePlacement: { palletId: 'pallet' } };
  const tx: any = { $executeRaw: vi.fn(), box: { findUnique: vi.fn(async () => box) }, productMark: { findMany: vi.fn(async () => []) },
    stockBalance: { findMany: vi.fn(async ({ where }: any) => where.boxId.in.includes('late') ? [{ boxId: 'late' }] : []) } };
  const state: any = { id: 'session', sourcePalletId: 'pallet', sourceCode: 'PALET_SORT_03', clientId: 'client', warehouseId: 'wh',
    stage: 'FORMING', version: 5, sources: [{ id: 'old', code: 'FFL_OLD', scanned: true, archived: false }],
    targets: [{ id: 'target', code: 'FFL_TARGET', quantity: 0, closed: false }], activeTargetId: 'target', moves: [], pendingRoutes: [] };
  const dto = { barcode, kiz, sourceBoxCode: code };
  return { service, box, tx, state, dto };
}
it('includes the physically scanned late box on the same pallet and transfers without surplus', async () => {
  // TEST: real incident — current pallet contains a box absent from the session snapshot.
  const f = fixture();
  await f.service.move(f.tx, f.state, f.dto, user);
  expect(f.state.sources).toContainEqual(expect.objectContaining({ id: 'late', scanned: true, placementId: 'pallet' }));
  expect(f.service.stock.transferSortingUnit).toHaveBeenCalledWith(f.tx, expect.objectContaining({ fromBoxCode: code, toBoxCode: 'FFL_TARGET' }), user);
  expect(f.service.stock.recoverSortingUnit).not.toHaveBeenCalled();
  expect(f.service.assertUnclaimed).toHaveBeenCalled(); expect(f.service.assertMovementAllowed).toHaveBeenCalled();
  await f.service.move(f.tx, f.state, f.dto, user);
  expect(f.service.stock.transferSortingUnit).toHaveBeenCalledTimes(1);
  expect(f.state.sources.filter((s: any) => s.id === 'late')).toHaveLength(1);
});
it('accepts the same late source at the initial physical box check', async () => {
  // TEST: no stock operation occurs merely because a source was scanned.
  const f = fixture(); f.state.stage = 'CHECKING';
  await f.service.runAction(f.tx, f.state, { action: 'SCAN_SOURCE', code }, user);
  expect(f.state.sources).toHaveLength(2);
  expect(f.service.stock.transferSortingUnit).not.toHaveBeenCalled();
});
it('accepts an AVAILABLE KIZ already attached to the late source', async () => {
  const f = fixture(); f.tx.productMark.findMany.mockResolvedValue([{ boxId: 'late', status: 'AVAILABLE', value: kiz }]);
  await f.service.move(f.tx, f.state, f.dto, user);
  expect(f.service.stock.transferSortingUnit).toHaveBeenCalledTimes(1);
});
it.each(['client', 'warehouse', 'pallet', 'detached', 'archived', 'single-box', 'target'])('rejects unsafe late source: %s', async kind => {
  // TEST: absence from snapshot never grants cross-pallet/client access or target consumption.
  const f = fixture();
  if (kind === 'client') f.box.clientId = 'other';
  if (kind === 'warehouse') f.box.warehouseId = 'other';
  if (kind === 'pallet') f.box.storagePlacement.palletId = 'other';
  if (kind === 'detached') f.box.storagePlacement = null;
  if (kind === 'archived') f.box.status = 'archived';
  if (kind === 'single-box') f.state.sourcePalletId = null;
  if (kind === 'target') f.box.id = 'target';
  await expect(f.service.move(f.tx, f.state, f.dto, user)).rejects.toThrow();
  expect(f.service.stock.transferSortingUnit).not.toHaveBeenCalled(); expect(f.service.stock.recoverSortingUnit).not.toHaveBeenCalled();
});
it.each(['assertUnclaimed', 'assertMovementAllowed'])('retains %s protection for the additional source', async guard => {
  const f = fixture(); f.service[guard].mockRejectedValue(new Error('BUSY_SOURCE'));
  await expect(f.service.move(f.tx, f.state, f.dto, user)).rejects.toThrow('BUSY_SOURCE');
  expect(f.state.sources).toHaveLength(1);
});
it('recovers a physically scanned unit absent from the selected known box using stock validation', async () => {
  // TEST: physical discrepancy must use the guarded recovery, not a fictitious transfer.
  const f = fixture(); f.tx.stockBalance.findMany.mockResolvedValue([]);
  f.service.stock.recoverSortingUnit.mockResolvedValue({ skuId: 'sku' });
  await f.service.move(f.tx, f.state, f.dto, user);
  await f.service.move(f.tx, f.state, f.dto, user);
  expect(f.service.stock.recoverSortingUnit).toHaveBeenCalledTimes(1);
  expect(f.service.stock.recoverSortingUnit).toHaveBeenCalledWith(f.tx, expect.objectContaining({
    sourceBoxCode: code, knownSource: { id: 'late', placementId: 'pallet' },
  }), user);
  expect(f.state.moves).toEqual([expect.objectContaining({ sourceBoxId: 'late', recovered: true, recoveryReason: 'SKU_STOCK_MISSING' })]);
  expect(f.service.audit).toHaveBeenCalledWith(f.tx, f.state, user, 'UNIT_RECOVERED', expect.objectContaining({ reason: 'SKU_STOCK_MISSING', sourceBoxId: 'late' }));
  expect(f.state.targets[0].quantity).toBe(1);
  expect(f.state.problemSources ?? []).toEqual([]); // Known box is not falsely labelled BOX_NOT_FOUND.
  expect(f.service.stock.transferSortingUnit).not.toHaveBeenCalled();
});
it('does not consume a KIZ belonging to another source than the explicit scan', async () => {
  const f = fixture(); f.tx.productMark.findMany.mockResolvedValue([{ boxId: 'old', status: 'AVAILABLE', value: kiz }]);
  await expect(f.service.move(f.tx, f.state, f.dto, user)).rejects.toThrow();
  expect(f.service.stock.transferSortingUnit).not.toHaveBeenCalled();
});
it.each(['unscanned', 'archived', 'preserved'])('does not recover from an ineligible manifest source: %s', async kind => {
  // TEST: the fallback does not reopen archived/preserved boxes or confirm them implicitly.
  const f = fixture(); f.tx.stockBalance.findMany.mockResolvedValue([]);
  f.state.sources.push({ id: 'late', code, scanned: kind !== 'unscanned', archived: kind === 'archived', preservedOnPallet: kind === 'preserved', placementId: 'pallet' });
  await expect(f.service.move(f.tx, f.state, f.dto, user)).rejects.toThrow('подтверждённый');
  expect(f.service.stock.recoverSortingUnit).not.toHaveBeenCalled();
});
it('does not guess a known zero-stock source without an explicit source scan', async () => {
  // TEST: physical origin must be supplied, even if the manifest has only one source.
  const f = fixture(); f.tx.stockBalance.findMany.mockResolvedValue([]);
  await expect(f.service.move(f.tx, f.state, { barcode, kiz }, user)).rejects.toThrow('исходный');
  expect(f.service.stock.recoverSortingUnit).not.toHaveBeenCalled();
});
