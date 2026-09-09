import { afterEach, expect, it, vi } from 'vitest';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';
const user = { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' };
const code = 'FFL_LKB0207_49', barcode = '4600000000001', kiz = '010460000000000121ABCDEFGHIJKLM';
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const service: any = Object.create(PalletSortingService.prototype);
  service.boxCodes = { normalize: async (s: string) => s.trim().toUpperCase(), requireAllowed: async (s: string) => s.trim().toUpperCase() };
  service.audit = vi.fn(); service.assertUnclaimed = vi.fn(); service.assertMovementAllowed = vi.fn(); service.resetAffectedRoutes = vi.fn();
  service.stock = { reconcileAdminSortingUnit: vi.fn().mockResolvedValue({ skuId: 'sku', sourceBoxId: 'late', sourceClientId: 'client', sourceWarehouseId: 'wh', recovered: false }) };
  const box: any = { id: 'late', code, status: 'active', clientId: 'client', warehouseId: 'wh', storagePlacement: { palletId: 'pallet' } };
  const tx: any = { $executeRaw: vi.fn(), box: { findUnique: vi.fn(async () => box) } };
  const state: any = { id: 'session', sourcePalletId: 'pallet', sourceCode: 'PALET_SORT_03', clientId: 'client', warehouseId: 'wh',
    stage: 'FORMING', version: 5, sources: [{ id: 'old', code: 'FFL_OLD', scanned: true, archived: false }],
    targets: [{ id: 'target', code: 'FFL_TARGET', quantity: 0, closed: false }], activeTargetId: 'target', moves: [], pendingRoutes: [] };
  return { service, box, tx, state, dto: { barcode, kiz, sourceBoxCode: code } };
}
it('moves from a late physical source without silently extending the final archive manifest', async () => {
  // TEST: per-unit source hint is not whole-box shortage authorization.
  const f = fixture(); await f.service.move(f.tx, f.state, f.dto, user);
  expect(f.state.sources).toHaveLength(1);
  expect(f.service.stock.reconcileAdminSortingUnit).toHaveBeenCalledWith(f.tx, expect.objectContaining({ sourceBoxCode: code, toBoxCode: 'FFL_TARGET' }), user);
  expect(f.state.moves[0]).toMatchObject({ sourceBoxId: 'late', sourceBoxCode: code });
});
it.each(['normal', 'other-client', 'other-warehouse', 'archived', 'other-pallet', 'detached', 'single-box'])('records only the physically scanned source at initial check: %s', async condition => {
  // TEST: stale WMS flags do not overrule the ADMIN's source-box scan.
  const f = fixture(); f.state.stage = 'CHECKING';
  if (condition === 'other-client') f.box.clientId = 'other';
  if (condition === 'other-warehouse') f.box.warehouseId = 'other';
  if (condition === 'archived') f.box.status = 'archived';
  if (condition === 'other-pallet') f.box.storagePlacement.palletId = 'other';
  if (condition === 'detached') f.box.storagePlacement = null;
  if (condition === 'single-box') f.state.sourcePalletId = null;
  await f.service.runAction(f.tx, f.state, { action: 'SCAN_SOURCE', code }, user);
  expect(f.state.sources).toHaveLength(2);
  expect(f.state.sources[1]).toMatchObject({ id: 'late', scanned: true, clientId: f.box.clientId, warehouseId: f.box.warehouseId, placementId: f.box.storagePlacement?.palletId ?? null });
  expect(f.service.stock.reconcileAdminSortingUnit).not.toHaveBeenCalled();
});
it('does not admit the current target into the final source archive checklist', async () => {
  // TEST: source/destination roles cannot overlap during one final write-off.
  const f = fixture(); f.box.id = 'target';
  await expect(f.service.includeScannedSource(f.tx, f.state, code, user)).rejects.toThrow('состав');
  expect(f.state.sources).toHaveLength(1);
});
it('keeps other-session ownership protection for an additional source', async () => {
  const f = fixture(); f.service.assertUnclaimed.mockRejectedValue(new Error('BUSY_SOURCE'));
  await expect(f.service.includeScannedSource(f.tx, f.state, code, user)).rejects.toThrow('BUSY_SOURCE');
  expect(f.state.sources).toHaveLength(1);
});
it('records an unknown source as a problem without creating stock at source-scan time', async () => {
  const f = fixture(); f.tx.box.findUnique.mockResolvedValue(null);
  await f.service.includeScannedSource(f.tx, f.state, code, user);
  expect(f.state.problemSources).toEqual([{ code, scanned: true, reason: 'BOX_NOT_FOUND' }]);
  expect(f.service.stock.reconcileAdminSortingUnit).not.toHaveBeenCalled();
});
it('does not disclose or import an explicitly hidden client box', async () => {
  const f = fixture();
  await expect(f.service.includeScannedSource(f.tx, f.state, code, { ...user, hiddenClientIds: ['client'] })).rejects.toThrow('недоступен');
  expect(f.state.sources).toHaveLength(1);
});
it('marks a missing-stock helper result as recovered and counts it once', async () => {
  const f = fixture(); f.service.stock.reconcileAdminSortingUnit.mockResolvedValue({ skuId: 'sku', sourceBoxId: 'late', recovered: true });
  await f.service.move(f.tx, f.state, f.dto, user);
  f.service.stock.reconcileAdminSortingUnit.mockResolvedValue({ alreadyApplied: true });
  await f.service.move(f.tx, f.state, f.dto, user);
  expect(f.state.moves).toHaveLength(1); expect(f.state.moves[0].recovered).toBe(true);
  expect(f.state.targets[0].quantity).toBe(1);
});
