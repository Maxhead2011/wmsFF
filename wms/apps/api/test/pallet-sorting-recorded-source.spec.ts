import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Session } from 'node:inspector';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';

const identities = ['0104640684260411215HWPK7"wuWnMH', '0104640684260411215PS5pwv*"blO&'];
const user = { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' };
// TEST: native V8 coverage for the new reconciliation path, without adding dependencies.
if (process.env.SORTING_RECORDED_SOURCE_COVERAGE === 'true') {
  const profiler = new Session();
  const post = (method: string, params = {}) => new Promise<any>((resolve, reject) => profiler.post(method as any, params, (e, r) => e ? reject(e) : resolve(r)));
  beforeAll(async () => { profiler.connect(); await post('Profiler.enable'); await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true }); });
  afterAll(async () => {
    try {
      const data = await post('Profiler.takePreciseCoverage');
      const fn = data.result.flatMap((s: any) => s.functions).find((f: any) => f.functionName === 'moveFromRecordedSource');
      expect(fn).toBeDefined();
      const covered = fn.ranges.filter((r: any) => r.count > 0).length;
      console.log(JSON.stringify({ function: fn.functionName, covered, blocks: fn.ranges.length, percent: 100 * covered / fn.ranges.length }));
      expect(covered / fn.ranges.length).toBeGreaterThanOrEqual(0.8);
    } finally { await post('Profiler.stopPreciseCoverage'); profiler.disconnect(); }
  });
}
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const service: any = Object.create(PalletSortingService.prototype);
  service.boxCodes = { normalize: async (s: string) => s.trim().toUpperCase() };
  service.scopes = { requireClientAccess: vi.fn() };
  service.assertUnclaimed = vi.fn(); service.assertMovementAllowed = vi.fn(); service.resetAffectedRoutes = vi.fn(); service.audit = vi.fn();
  const physical: any = { id: 'physical', code: 'FFL_LKB2107_44', scanned: true, archived: false, placementId: 'pallet' };
  const recorded: any = { id: 'recorded', code: 'FFL_LKB2107_41', clientId: 'client', warehouseId: 'wh', status: 'active', storagePlacement: null };
  const physicalBox = { ...physical, clientId: 'client', warehouseId: 'wh', status: 'active', storagePlacement: { palletId: 'pallet' } };
  const marks: any[] = identities.map((value, i) => ({ id: `mark${i}`, value, status: 'AVAILABLE', boxId: 'recorded', skuId: 'sku', clientId: 'client' }));
  let quantity = 2;
  const tx: any = {
    box: { findUnique: vi.fn(async ({ where }: any) => where.id === 'recorded' ? recorded : where.id === 'physical' ? physicalBox : null) },
    productMark: { findMany: vi.fn(async ({ where }: any) => {
      if (where.value) return marks.filter(m => m.value === where.value.startsWith.replace(/\\([%_\\])/g, '$1'));
      return marks.filter(m => where.OR.some((p: any) => m.value.startsWith(p.value.startsWith.replace(/\\([%_\\])/g, '$1'))));
    }) },
    stockBalance: { findFirst: vi.fn(async () => ({ quantity })), findMany: vi.fn(async () => []) },
    sku: { findFirst: vi.fn(async () => ({ id: 'sku' })) },
  };
  for (const table of ['fbsTsdAssembly', 'shippedKizHistory', 'fbsWebKizStickerPrint', 'fbsAssemblyAttemptHistory', 'fbsPrintJob', 'kizCirculationItem']) tx[table] = { findFirst: vi.fn(async () => null) };
  const state: any = { id: 'session', version: 104, clientId: 'client', warehouseId: 'wh', sourcePalletId: 'pallet', stage: 'FORMING',
    sources: [physical], targets: [{ id: 'target', code: 'FFL_LKBS0709_07', quantity: 3, closed: false }], activeTargetId: 'target', moves: [], pendingRoutes: [] };
  service.stock = { recoverSortingUnit: vi.fn(), transferSortingUnit: vi.fn(async (_tx: any, input: any) => {
    expect(input.fromBoxCode).toBe(recorded.code);
    if (quantity < 1) throw new Error('NO_STOCK');
    quantity--; marks.find(m => m.value === input.kiz)!.boxId = 'target';
    return { skuId: 'sku' };
  }) };
  const dto = { barcode: '2052399249995', kiz: identities[0], sourceBoxCode: physical.code };
  return { service, tx, state, dto, recorded, physical, physicalBox, marks, quantity: () => quantity };
}
it('moves both existing KIZs from accounting box 41, recording physical box 44 without a new receipt', async () => {
  // TEST: exact incident; accounting source must not be added to the archive/write-off manifest.
  const f = fixture();
  for (const kiz of identities) await f.service.move(f.tx, f.state, { ...f.dto, kiz }, user);
  expect(f.quantity()).toBe(0); expect(f.state.targets[0].quantity).toBe(5);
  expect(f.service.stock.recoverSortingUnit).not.toHaveBeenCalled();
  expect(f.state.sources.map((b: any) => b.id)).toEqual(['physical']);
  expect(f.state.moves).toHaveLength(2);
  expect(f.state.moves[0]).toMatchObject({ sourceBoxId: 'recorded', targetBoxId: 'target',
    sourceCorrection: { physicalBoxId: 'physical', physicalBoxCode: 'FFL_LKB2107_44', recordedBoxCode: 'FFL_LKB2107_41' } });
  expect(f.service.audit).toHaveBeenCalledWith(f.tx, f.state, user, 'UNIT_MOVED_SOURCE_CORRECTED', expect.objectContaining({ recordedBoxId: 'recorded', physicalBoxId: 'physical' }));
  expect(f.service.assertUnclaimed).toHaveBeenCalled(); expect(f.service.assertMovementAllowed).toHaveBeenCalled();
});
it('a repeated KIZ does not debit either box twice', async () => {
  // TEST: same-session idempotency must survive the changed mark boxId.
  const f = fixture(); await f.service.move(f.tx, f.state, f.dto, user); await f.service.move(f.tx, f.state, f.dto, user);
  expect(f.quantity()).toBe(1); expect(f.service.stock.transferSortingUnit).toHaveBeenCalledTimes(1);
});
it.each(['unscanned', 'archived', 'preserved', 'no-physical-code', 'foreign-client', 'foreign-warehouse', 'inactive-recorded', 'target-recorded', 'packing-mark', 'zero-stock', 'wrong-barcode', 'physical-moved'])('rejects unsafe correction: %s', async kind => {
  // TEST: physical source confirmation never authorizes arbitrary stock or history replacement.
  const f = fixture();
  if (kind === 'unscanned') f.physical.scanned = false;
  if (kind === 'archived') f.physical.archived = true;
  if (kind === 'preserved') f.physical.preservedOnPallet = true;
  if (kind === 'no-physical-code') f.dto.sourceBoxCode = '';
  if (kind === 'foreign-client') f.recorded.clientId = 'other';
  if (kind === 'foreign-warehouse') f.recorded.warehouseId = 'other';
  if (kind === 'inactive-recorded') f.recorded.status = 'archived';
  if (kind === 'target-recorded') f.state.targets.push({ id: 'recorded', code: f.recorded.code });
  if (kind === 'packing-mark') f.marks[0].status = 'PACKING';
  if (kind === 'zero-stock') f.tx.stockBalance.findFirst.mockResolvedValue(null);
  if (kind === 'wrong-barcode') f.tx.sku.findFirst.mockResolvedValue(null);
  if (kind === 'physical-moved') f.physicalBox.storagePlacement.palletId = 'different';
  await expect(f.service.move(f.tx, f.state, f.dto, user)).rejects.toThrow();
  expect(f.service.stock.transferSortingUnit).not.toHaveBeenCalled(); expect(f.state.moves).toEqual([]);
});
it.each(['fbsTsdAssembly', 'shippedKizHistory', 'fbsWebKizStickerPrint', 'fbsAssemblyAttemptHistory', 'fbsPrintJob', 'kizCirculationItem'])('retains the KIZ own %s guard', async table => {
  // TEST: AVAILABLE alone does not prove absence of a shipment/print assignment.
  const f = fixture(); f.tx[table].findFirst.mockResolvedValue({ id: 'history' });
  await expect(f.service.move(f.tx, f.state, f.dto, user)).rejects.toThrow();
  expect(f.service.stock.transferSortingUnit).not.toHaveBeenCalled();
});
it.each(['assertUnclaimed', 'assertMovementAllowed'])('retains %s for the accounting source outside the manifest', async guard => {
  const f = fixture(); f.service[guard].mockRejectedValue(new Error('LOCKED'));
  await expect(f.service.move(f.tx, f.state, f.dto, user)).rejects.toThrow(); expect(f.service.stock.transferSortingUnit).not.toHaveBeenCalled();
});
it.each(['operator', 'disabled'])('correction is not accessible to %s', async kind => {
  const f = fixture(); if (kind === 'disabled') vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'false');
  await expect(f.service.move(f.tx, f.state, f.dto, { ...user, roleCodes: kind === 'operator' ? ['OPERATOR'] : ['ADMIN'] })).rejects.toThrow();
  expect(f.service.stock.transferSortingUnit).not.toHaveBeenCalled();
});
it.each(['missing-box-link', 'closed-source', 'duplicate', 'mark-moved', 'mark-status-changed', 'mark-sku-changed', 'scope-denied', 'recorded-missing', 'actual-missing'])('handles invalid or changed evidence: %s', async kind => {
  // TEST: re-read ownership after acquiring the extra source-box locks.
  const f = fixture();
  if (kind === 'missing-box-link') f.marks[0].boxId = null;
  if (kind === 'closed-source') f.state.sources.push({ id: 'recorded', code: f.recorded.code, archived: true });
  if (kind === 'scope-denied') f.service.scopes.requireClientAccess.mockImplementation(() => { throw new Error('DENIED'); });
  if (kind === 'recorded-missing' || kind === 'actual-missing') f.tx.box.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === (kind === 'recorded-missing' ? 'recorded' : 'physical') ? null : where.id === 'recorded' ? f.recorded : f.physicalBox);
  const original = f.tx.productMark.findMany.getMockImplementation();
  if (['duplicate', 'mark-moved', 'mark-status-changed', 'mark-sku-changed'].includes(kind)) f.tx.productMark.findMany.mockImplementation(async (input: any) => {
    const rows = await original(input);
    if (!input.where.OR) return rows;
    if (kind === 'duplicate') return [...rows, { ...rows[0], id: 'duplicate' }];
    const change = kind === 'mark-moved' ? { boxId: 'other' } : kind === 'mark-status-changed' ? { status: 'PACKING' } : { skuId: 'other' };
    return rows.map((r: any) => ({ ...r, ...change }));
  });
  await expect(f.service.move(f.tx, f.state, f.dto, user)).rejects.toThrow();
  expect(f.service.stock.transferSortingUnit).not.toHaveBeenCalled(); expect(f.state.moves).toEqual([]);
});
it('rejects the same KIZ aimed at a different target after successful correction', async () => {
  const f = fixture(); await f.service.move(f.tx, f.state, f.dto, user);
  f.state.targets.push({ id: 'target2', code: 'TARGET2', closed: false, quantity: 0 }); f.state.activeTargetId = 'target2';
  await expect(f.service.move(f.tx, f.state, f.dto, user)).rejects.toThrow('уже перемещён');
  expect(f.quantity()).toBe(1);
});
it('propagates a transfer race before writing the session result', async () => {
  // TEST: owning action transaction must roll back route updates if the stock service rejects.
  const f = fixture(); f.service.stock.transferSortingUnit.mockRejectedValue(new Error('CONCURRENT_STOCK_CHANGE'));
  await expect(f.service.move(f.tx, f.state, f.dto, user)).rejects.toThrow('CONCURRENT_STOCK_CHANGE');
  expect(f.state.moves).toEqual([]); expect(f.state.targets[0].quantity).toBe(3); expect(f.service.audit).not.toHaveBeenCalled();
});
