import { afterEach, expect, it, vi } from 'vitest';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';

const user = { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' };
const kiz = '010460000000000121ABCDEFGHIJKLM';
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const service: any = Object.create(PalletSortingService.prototype);
  service.boxCodes = { normalize: async (s: string) => s.trim().toUpperCase(), requireAllowed: async (s: string) => s.trim().toUpperCase() };
  service.audit = vi.fn(); service.resetAffectedRoutes = vi.fn(); service.assertUnclaimed = vi.fn();
  service.stock = { reconcileAdminSortingUnit: vi.fn().mockResolvedValue({ skuId: 'sku', sourceBoxId: 'recorded', sourceClientId: 'other-client', sourceWarehouseId: 'other-wh', targetClientId: 'target-client', targetWarehouseId: 'target-wh', recovered: false, alreadyApplied: false }) };
  const tx: any = { $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([]),
    box: { findUnique: vi.fn().mockResolvedValue(null) },
    productMark: { findMany: vi.fn().mockResolvedValue([{ id: 'mark', value: kiz, boxId: 'recorded', status: 'PACKING', clientId: 'other-client', skuId: 'old-sku' }]) },
    inventorySession: { findFirst: vi.fn().mockResolvedValue({ id: 'inventory' }) },
    inventoryAuditBox: { findFirst: vi.fn().mockResolvedValue({ id: 'recount' }) },
    clientRequestBoxSelection: { findFirst: vi.fn().mockResolvedValue({ id: 'outbound' }) },
  };
  const state: any = { id: 'session', sourcePalletId: 'pallet', clientId: 'client', warehouseId: 'wh', stage: 'FORMING', version: 7,
    sources: [{ id: 'source', code: 'SOURCE', scanned: true, archived: false }], targets: [{ id: 'target', code: 'TARGET', quantity: 0, closed: false }], activeTargetId: 'target', moves: [], pendingRoutes: [] };
  return { service, tx, state, dto: { barcode: '4600000000001', kiz, sourceBoxCode: 'SOURCE' } };
}
it('delegates ADMIN physical truth, not AVAILABLE/history guards, and scopes source route repair from actual origin', async () => {
  // TEST: source ownership may differ from both session and destination; no guessed receipt.
  const f = fixture();
  await f.service.move(f.tx, f.state, f.dto, user);
  expect(f.service.stock.reconcileAdminSortingUnit).toHaveBeenCalledWith(f.tx, expect.objectContaining({ toBoxCode: 'TARGET', sourceBoxCode: 'SOURCE', barcode: f.dto.barcode, kiz }), user);
  expect(f.service.resetAffectedRoutes).toHaveBeenCalledWith(f.tx, f.state, ['recorded'], user, undefined, { clientId: 'other-client', warehouseId: 'other-wh' });
  expect(f.state.moves).toHaveLength(1); expect(f.state.targets[0].quantity).toBe(1);
  expect(f.state.sources).toHaveLength(1);
});
it('replaying the same KIZ in its current destination does not increment session quantity twice', async () => {
  // TEST: scanner replay is a no-op, distinct from deliberate relocation to another target.
  const f = fixture();
  await f.service.move(f.tx, f.state, f.dto, user);
  f.service.stock.reconcileAdminSortingUnit.mockResolvedValue({ alreadyApplied: true });
  await f.service.move(f.tx, f.state, f.dto, user);
  expect(f.service.stock.reconcileAdminSortingUnit).toHaveBeenCalledTimes(2);
  expect(f.state.targets[0].quantity).toBe(1);
});
it('administrative movement retains locks and audits inventory/request overlaps without rejecting them', async () => {
  // TEST: active warehouse work is recorded as an override, not a manager permission gate.
  const f = fixture();
  await f.service.assertMovementAllowed(f.tx, ['source'], f.state, user);
  expect(f.tx.$queryRaw).toHaveBeenCalled();
  expect(f.service.audit).toHaveBeenCalledWith(f.tx, f.state, user, 'LOCKS_OVERRIDDEN', expect.objectContaining({ boxIds: ['source'] }));
});
it('accepts a physically scanned archived source with stale ownership and placement', async () => {
  // TEST: scan adds only that box; no bulk import of the other pallet.
  const f = fixture();
  f.tx.box.findUnique.mockResolvedValue({ id: 'late', code: 'LATE', status: 'archived', clientId: 'old-client', warehouseId: 'old-wh', storagePlacement: { palletId: 'old-pallet' } });
  await f.service.includeScannedSource(f.tx, f.state, 'LATE', user);
  expect(f.state.sources).toContainEqual(expect.objectContaining({ id: 'late', scanned: true, placementId: 'old-pallet' }));
  expect(f.service.stock.reconcileAdminSortingUnit).not.toHaveBeenCalled();
});
it('opens a nonempty archived target using that box client/branch and revives only the target', async () => {
  // TEST: target ownership is authoritative, without moving unrelated boxes or guessing placement.
  const f = fixture();
  f.state.activeTargetId = null; f.state.targets = [];
  const box = { id: 'target', code: 'TARGET', clientId: 'target-client', warehouseId: 'target-wh', status: 'archived', storagePlacement: { palletId: 'target-pallet' } };
  f.tx.box.findUnique.mockResolvedValue(box); f.tx.box.update = vi.fn().mockResolvedValue({ ...box, status: 'active' });
  f.tx.storagePallet = { findFirst: vi.fn().mockResolvedValue({ id: 'target-pallet', code: 'PALLET-TARGET', clientId: 'target-client', warehouseId: 'target-wh' }) };
  await f.service.openTarget(f.tx, f.state, { code: 'TARGET', palletCode: 'PALLET-TARGET' }, user);
  expect(f.tx.storagePallet.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: 'target-client', warehouseId: 'target-wh' }) }));
  expect(f.tx.box.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { status: 'active' } });
  expect(f.state.activeTargetId).toBe('target');
});
it('does not load a visible-client session that references a hidden-client destination', async () => {
  // TEST: session owner alone cannot authorize disclosure of imported cross-client contents.
  const f = fixture();
  f.tx.$queryRaw.mockResolvedValue([{ state: f.state, warehouseId: 'wh', clientId: 'client' }]);
  f.tx.box.findMany = vi.fn().mockResolvedValue([{ id: 'target', clientId: 'hidden' }]);
  await expect(f.service.load(f.tx, 'session', { ...user, hiddenClientIds: ['hidden'] })).rejects.toThrow('недоступен');
});
it('fills a missing target warehouse only from the explicitly scanned target pallet', async () => {
  // TEST: an old box lacking branch metadata remains usable without inventing a location.
  const f = fixture(); f.state.activeTargetId = null; f.state.targets = [];
  const box = { id: 'target', code: 'TARGET', clientId: 'client', warehouseId: null, status: 'active', storagePlacement: null };
  f.tx.box.findUnique.mockResolvedValue(box); f.tx.box.update = vi.fn();
  f.tx.storagePallet = { findFirst: vi.fn().mockResolvedValue({ id: 'pallet', code: 'PALLET', clientId: 'client', warehouseId: 'wh' }) };
  f.tx.storagePalletBox = { create: vi.fn() };
  await f.service.openTarget(f.tx, f.state, { code: 'TARGET', palletCode: 'PALLET' }, user);
  expect(f.tx.box.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { warehouseId: 'wh' } });
});
