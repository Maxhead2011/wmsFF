import { afterEach, expect, it, vi } from 'vitest';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';

const kiz = '0104640684260411215HWPK7"wuWnMH';
const user = { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' };
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const service: any = Object.create(PalletSortingService.prototype);
  service.boxCodes = { normalize: async (s: string) => s.trim().toUpperCase() };
  service.assertUnclaimed = vi.fn(); service.assertMovementAllowed = vi.fn(); service.resetAffectedRoutes = vi.fn(); service.audit = vi.fn();
  const result = { skuId: 'sku', sourceBoxId: 'recorded', sourceClientId: 'client', sourceWarehouseId: 'wh', targetClientId: 'client', targetWarehouseId: 'wh', recovered: false, alreadyApplied: false };
  service.stock = { reconcileAdminSortingUnit: vi.fn().mockResolvedValue(result) };
  const tx: any = { box: { findUnique: vi.fn().mockResolvedValue({ id: 'physical' }) } };
  const state: any = { id: 'session', version: 1, clientId: 'client', warehouseId: 'wh', stage: 'FORMING',
    sources: [{ id: 'physical', code: 'FFL_LKB2107_44', scanned: true, archived: false }],
    targets: [{ id: 'target', code: 'FFL_LKBS0709_07', quantity: 3, closed: false }], activeTargetId: 'target', moves: [], pendingRoutes: [] };
  const dto = { operationId: 'op1', barcode: '2052399249995', kiz, sourceBoxCode: 'FFL_LKB2107_44' };
  return { service, tx, state, dto, result };

}
it('preserves the physical source hint while the accounting helper chooses the actual source', async () => {
  // TEST: the old accounting box is not silently included in final archive/write-off.
  const f = fixture(); await f.service.move(f.tx, f.state, f.dto, user);
  expect(f.service.stock.reconcileAdminSortingUnit).toHaveBeenCalledWith(f.tx, expect.objectContaining({ sourceBoxCode: 'FFL_LKB2107_44', toBoxCode: 'FFL_LKBS0709_07', kiz }), user);
  expect(f.state.sources.map((s: any) => s.id)).toEqual(['physical']);
  expect(f.state.moves[0]).toMatchObject({ sourceBoxId: 'recorded', sourceBoxCode: 'FFL_LKB2107_44', targetBoxId: 'target' });
  expect(f.state.targets[0].quantity).toBe(4);
});
it.each(['PACKING', 'SHIPPING', 'BLOCKED', 'other-client', 'other-branch', 'archived', 'no-source-stock', 'old-print-history'])('delegates %s reconciliation without adding the former service gate', async condition => {
  // TEST: actual stock/status arithmetic is covered by helper unit + PostgreSQL tests.
  const f = fixture();
  if (condition === 'other-client') f.result.sourceClientId = 'other';
  if (condition === 'other-branch') f.result.sourceWarehouseId = 'other';
  await f.service.move(f.tx, f.state, f.dto, user);
  expect(f.service.stock.reconcileAdminSortingUnit).toHaveBeenCalledTimes(1);
  expect(f.state.moves).toHaveLength(1);
});
it('always rechecks current KIZ location even if this session had scanned it earlier', async () => {
  // TEST: a different session may have moved the unit since the old response.
  const f = fixture(); await f.service.move(f.tx, f.state, f.dto, user);
  f.result.alreadyApplied = true;
  await f.service.move(f.tx, f.state, { ...f.dto, operationId: 'op2' }, user);
  expect(f.service.stock.reconcileAdminSortingUnit).toHaveBeenCalledTimes(2);
  expect(f.state.targets[0].quantity).toBe(4); expect(f.state.moves).toHaveLength(1);
});
it('allows relocating a previously sorted unit to another target and moves the displayed count', async () => {
  // TEST: no second unit is manufactured in the session UI.
  const f = fixture(); await f.service.move(f.tx, f.state, f.dto, user);
  f.state.targets.push({ id: 'target2', code: 'TARGET2', quantity: 0, closed: false }); f.state.activeTargetId = 'target2';
  await f.service.move(f.tx, f.state, { ...f.dto, operationId: 'op2' }, user);
  expect(f.state.targets.map((t: any) => t.quantity)).toEqual([3, 1]);
});
it('propagates a transaction failure before writing the session move or count', async () => {
  // TEST: helper write failures must abort the surrounding session transaction.
  const f = fixture(); f.service.stock.reconcileAdminSortingUnit.mockRejectedValue(new Error('CONCURRENT_STOCK_CHANGE'));
  await expect(f.service.move(f.tx, f.state, f.dto, user)).rejects.toThrow('CONCURRENT_STOCK_CHANGE');
  expect(f.state.moves).toEqual([]); expect(f.state.targets[0].quantity).toBe(3);
});
it.each(['no-code', 'unscanned', 'archived-snapshot', 'preserved-snapshot'])('does not let a stale manifest reject a scanned KIZ: %s', async condition => {
  // TEST: the manifest controls final shortage consent, not barcode/KIZ ownership.

  const f = fixture();
  if (condition === 'no-code') f.dto.sourceBoxCode = '';
  if (condition === 'unscanned') f.state.sources[0].scanned = false;
  if (condition === 'archived-snapshot') f.state.sources[0].archived = true;
  if (condition === 'preserved-snapshot') f.state.sources[0].preservedOnPallet = true;
  const before = structuredClone(f.state.sources); await f.service.move(f.tx, f.state, f.dto, user);
  expect(f.state.sources).toEqual(before); expect(f.state.moves).toHaveLength(1);
});
it.each(['assertUnclaimed', 'assertMovementAllowed'])('retains atomic concurrency protection: %s', async guard => {
  const f = fixture(); f.service[guard].mockRejectedValue(new Error('BUSY'));
  await expect(f.service.move(f.tx, f.state, f.dto, user)).rejects.toThrow('BUSY');
  expect(f.state.moves).toEqual([]);
});
it.each(['', 'invalid'])('rejects a malformed KIZ before mutation: %s', async value => {
  const f = fixture(); await expect(f.service.move(f.tx, f.state, { ...f.dto, kiz: value }, user)).rejects.toThrow();
  expect(f.service.stock.reconcileAdminSortingUnit).not.toHaveBeenCalled();
});
