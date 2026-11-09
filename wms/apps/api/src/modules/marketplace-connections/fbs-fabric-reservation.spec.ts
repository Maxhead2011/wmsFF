import { afterEach, expect, it, vi } from 'vitest';
import { fabricReservationOrders, untouchedFabricReservation, canIgnoreFabricDisplayReservation } from './fbs-fabric-reservation';
import { MarketplaceConnectionsService } from './marketplace-connections.service';
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true');
  const sku = { id: 'sku', clientId: 'client', name: 'Ткань', internalSku: 'white_3-0', needsChestnyZnak: false };
  const db = { systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: { enabled: true } }) }, sku: { findMany: vi.fn().mockResolvedValue([sku]) } };
  const order = { id: 'order', connectionId: 'shop', marketplace: 'WILDBERRIES', category: 'active', supplierStatus: 'confirm', product: sku };
  return { db, order, sku };
}
// TEST: an untouched legacy waiting task is fabric, not a missing pallet-sort box.
it('recognizes new and legacy waiting fabric orders without reserving or debiting anything', async () => {
  const f = fixture();
  for (const task of [undefined, { status: 'WAITING_STOCK', errorMessage: 'Нет короба' }]) {
    expect([...await fabricReservationOrders(f.db, 'client', [f.order], new Map([['shop:order', task]]))]).toEqual(['shop:order']);
  }
});
it('preserves marked, ordinary, cancelled, relabel and other marketplace paths', async () => {
  const f = fixture();
  for (const patch of [{ category: 'cancelled' }, { supplierStatus: 'complete' }, { marketplace: 'OZON' }, { requiredMeta: ['sgtin'] }, { relabeling: {} }])
    expect((await fabricReservationOrders(f.db, 'client', [{ ...f.order, ...patch }], new Map())).size).toBe(0);
  for (const patch of [{ clientId: 'other' }, { internalSku: 'unknown' }, { needsChestnyZnak: true }, { needsRelabel: true }]) {
    f.db.sku.findMany.mockResolvedValue([{ ...f.sku, ...patch }]);
    expect((await fabricReservationOrders(f.db, 'client', [f.order], new Map())).size).toBe(0);
  }
});
it('requires both client opt-ins and performs no lookup with deployment flag off', async () => {
  const f = fixture();
  f.db.systemSetting.findUnique.mockResolvedValueOnce({ value: { enabled: false } });
  expect((await fabricReservationOrders(f.db, 'client', [f.order], new Map())).size).toBe(0);
  vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'false');
  expect((await fabricReservationOrders(null, 'client', [f.order], new Map())).size).toBe(0);
});
it('never hides existing physical evidence or a reservation in a box', () => {
  for (const status of ['RESERVED', 'IN_PROGRESS', 'COMPLETED', 'RETURN_REQUIRED']) expect(untouchedFabricReservation({ status })).toBe(false);
  for (const field of ['reservedBoxId', 'reservedBoxCode', 'boxId', 'boxCode', 'barcode', 'sourceBarcode', 'kiz', 'relabelConfirmedAt', 'completedAt', 'marketplaceSubmittedAt'])
    expect(untouchedFabricReservation({ status: 'WAITING_STOCK', [field]: 'proof' })).toBe(false);
});
// TEST: exercise the real list reservation path, not only the eligibility helper.
it('does not search finished boxed stock or write waiting tasks for cut-on-demand orders', async () => {
  const f = fixture();
  const task = { id: 'task', connectionId: 'shop', orderId: 'order', status: 'WAITING_STOCK', errorMessage: 'Нет короба' };
  const stockRead = vi.fn(async () => { throw Error('Finished-box lookup must not run for fabric'); });
  const write = vi.fn();
  const service: any = Object.create(MarketplaceConnectionsService.prototype);
  service.prisma = { ...f.db, client: { findUnique: async () => ({ storesWithoutBoxes: false }) },
    fbsTsdAssembly: { findMany: async () => [task], create: write, updateMany: write }, stockBalance: { findMany: stockRead } };
  service.fbsTsdReservationRowsBySku = async () => new Map();
  const result = await service.syncFbsPalletSortReservations('client', [f.order]);
  expect(result.get('shop:order')).toMatchObject({ status: 'FABRIC_ON_DEMAND', withoutBox: true, boxCode: null });
  expect(stockRead).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  let reads = 0;
  service.prisma.fbsTsdAssembly.findMany = async () => [{ ...task, ...(reads++ ? { status: 'IN_PROGRESS', barcode: 'physical-proof' } : {}) }];
  const fresh = await service.syncFbsPalletSortReservations('client', [f.order]);
  expect(fresh.get('shop:order').status).toBe('IN_PROGRESS');
  expect(write).not.toHaveBeenCalled();
});

// TEST: the display-only cut mode must not block request creation or bypass real picking.
it('allows fresh verified fabric display rows into auto assembly without recycling tasks', async () => {
  const f = fixture(); const order = { ...f.order, reservation: { status: 'FABRIC_ON_DEMAND' } };
  const verified = await fabricReservationOrders(f.db, 'client', [order], new Map());
  expect(canIgnoreFabricDisplayReservation(order, undefined, verified)).toBe(true);
  for (const task of [{ status: 'PICKING' }, { status: 'WAITING_STOCK' }, { workerName: 'Worker' }, { scannedItemCount: 1 }])
    expect(canIgnoreFabricDisplayReservation(order, task, verified)).toBe(false);
  expect(canIgnoreFabricDisplayReservation(order, undefined, new Set())).toBe(false);
  expect(canIgnoreFabricDisplayReservation({ ...order, connectionId: 'other' }, undefined, verified)).toBe(false);
  expect(canIgnoreFabricDisplayReservation({ ...order, reservation: { status: 'RESERVED' } }, undefined, verified)).toBe(false);
  vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'false');
  expect(canIgnoreFabricDisplayReservation(order, undefined, await fabricReservationOrders(f.db, 'client', [order], new Map()))).toBe(false);
});
