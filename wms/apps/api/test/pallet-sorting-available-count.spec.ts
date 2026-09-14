import { afterEach, expect, it, vi } from 'vitest';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';

afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const service: any = Object.create(PalletSortingService.prototype);
  service.boxCodes = { requireAllowed: vi.fn(async (code: string) => code) };
  for (const method of ['assertUnclaimed', 'assertMovementAllowed', 'assertVisibleClient', 'assertStateVisible', 'audit']) service[method] = vi.fn();
  const rows = [
    { boxId: 'box', status: 'AVAILABLE', quantity: 5 },
    { boxId: 'box', status: 'PACKING', quantity: 2 },
    { boxId: 'box', status: 'SHIPPING', quantity: 3 },
    { boxId: 'box', status: 'RESERVED', quantity: 4 },
    { boxId: 'box', status: 'DEFECT', quantity: 1 },
  ];
  const state: any = { id: 'session', warehouseId: 'wh', clientId: 'client', stage: 'FORMING',
    version: 1, sources: [], targets: [{ id: 'box', code: 'BOX_01', closed: true, quantity: 7, palletCode: 'PALLET' }], moves: [], pendingRoutes: [] };
  const select = (where: any) => rows.filter(row => (!where.status || row.status === where.status)
    && (!where.boxId || (typeof where.boxId === 'string' ? row.boxId === where.boxId : where.boxId.in.includes(row.boxId))));
  const db: any = {
    $executeRaw: vi.fn(), $queryRaw: vi.fn(async () => [{ state: structuredClone(state), warehouseId: 'wh', clientId: 'client' }]),
    box: { findUnique: vi.fn(async () => ({ id: 'box', code: 'BOX_01', status: 'active', clientId: 'client', warehouseId: 'wh', storagePlacement: { palletId: 'pallet' } })) },
    storagePallet: { findFirst: vi.fn(async () => ({ id: 'pallet', code: 'PALLET' })) },
    stockBalance: {
      aggregate: vi.fn(async ({ where }: any) => ({ _sum: { quantity: select(where).reduce((sum, row) => sum + row.quantity, 0) }, _min: { quantity: Math.min(...select(where).map(row => row.quantity)) } })),
      groupBy: vi.fn(async ({ where }: any) => select(where).length ? [{ boxId: 'box', _sum: { quantity: select(where).reduce((sum, row) => sum + row.quantity, 0) } }] : []),
      update: vi.fn(),
    },
  };
  service.prisma = db;
  return { service, db, state, rows, user: { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' },
    dto: { action: 'OPEN_TARGET', code: 'BOX_01', palletCode: 'PALLET' } };
}

it.each([false, true])('counts only available units when opening a target (reopen: %s)', async reopen => {
  // TEST: outbound and held stock must not become physical box contents.
  const f = fixture();
  if (!reopen) f.state.targets = [];
  await f.service.runAction(f.db, f.state, f.dto, f.user);
  expect(f.state.targets).toEqual([expect.objectContaining({ id: 'box', quantity: 5, closed: false })]);
  expect(f.db.stockBalance.update).not.toHaveBeenCalled();
});

it.each(['get', 'list'])('refreshes the saved seven-unit counter to five via %s', async method => {
  // TEST: an already open sorting must not retain the old PACKING-inclusive snapshot.
  const f = fixture();
  const result = method === 'get' ? await f.service.get('session', f.user) : (await f.service.list(f.user))[0];
  expect(result.targets[0].quantity).toBe(5);
  expect(result.version).toBe(1);
  expect(f.db.$executeRaw).not.toHaveBeenCalled();
  expect(f.db.stockBalance.update).not.toHaveBeenCalled();
});

it('shows zero when only picked stock remains in an active target', async () => {
  // TEST: absence of AVAILABLE rows must clear, rather than preserve, the stale count.
  const f = fixture(); f.rows.splice(0, 1);
  expect((await f.service.get('session', f.user)).targets[0].quantity).toBe(0);
});

it('keeps the completed sorting snapshot as history', async () => {
  // TEST: later picking must not rewrite a completed sorting's historical result.
  const f = fixture(); f.state.stage = 'COMPLETED';
  expect((await f.service.get('session', f.user)).targets[0].quantity).toBe(7);
  expect(f.db.stockBalance.groupBy).not.toHaveBeenCalled();
});

it('does not query stock when sorting is disabled for the sold installation', async () => {
  // TEST: the existing feature gate continues to isolate this workflow.
  const f = fixture(); vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'false');
  await expect(f.service.get('session', f.user)).rejects.toThrow();
  expect(f.db.stockBalance.groupBy).not.toHaveBeenCalled();
});
