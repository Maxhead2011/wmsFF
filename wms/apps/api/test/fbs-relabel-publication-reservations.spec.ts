import { afterEach, expect, it, vi } from 'vitest';
import { wbReservationQuantities } from '../src/common/stock/wb-order-stock-lifecycle';

afterEach(() => vi.unstubAllEnvs());
it.each([false, true])('reserves one shared physical pool across relabel, direct orders and WMS requests; fast=%s', async fast => {
  // TEST: three incoming orders must not become three new sellable units after linking or relabeling.
  vi.stubEnv('WMS_FBS_ALLOCATION_FAST_ENABLED', String(fast));
  const tasks = [
    { id: 'a', connectionId: 'c', orderId: '1', requestId: 'r', skuId: 'new', sourceSkuId: 'old', relabelConfirmedAt: null, itemCount: 1, status: 'RESERVED' },
    { id: 'b', connectionId: 'c', orderId: '2', requestId: 'r', skuId: 'new', sourceSkuId: 'old', relabelConfirmedAt: null, itemCount: 1, status: 'WAITING_STOCK' },
    { id: 'd', connectionId: 'c2', orderId: '3', requestId: 'r', skuId: 'old', sourceSkuId: null, relabelConfirmedAt: null, itemCount: 1, status: 'IN_PROGRESS' },
  ];
  const db: any = {
    sku: { findMany: async () => ['old', 'new'].map(id => ({ id, barcodes: [] })) },
    fbsTsdAssembly: { findMany: vi.fn(async () => tasks) },
    clientRequest: { findMany: async () => [{ id: 'r', items: [{ skuId: 'new', quantity: 2 }, { skuId: 'old', quantity: 1 }] }] },
    fbsOrderRequestLink: { findMany: async () => [] },
    stockMovement: { findMany: vi.fn(async () => [] as any[]), groupBy: async () => [] },
    wbOrderShipment: { findMany: async () => [] },
  };
  const read = () => wbReservationQuantities(db, 'client', ['old', 'new'], 'moscow');
  expect(await read()).toEqual(new Map([['old', 3], ['new', 0]]));
  // TEST: after relabeling, one unit changes SKU; total reservation stays three.
  tasks[0].relabelConfirmedAt = new Date() as any;
  expect(await read()).toEqual(new Map([['old', 2], ['new', 1]]));
  // TEST: physical debit removes the virtual reservation exactly once.
  db.stockMovement.findMany.mockResolvedValue([{ idempotencyKey: 'fbs-sticker-pick:a:in', quantity: 1 }]);
  expect(await read()).toEqual(new Map([['old', 2], ['new', 0]]));
  expect(db.fbsTsdAssembly.findMany.mock.calls[0][0].where).toMatchObject({ clientId: 'client', stockWarehouseId: 'moscow' });
});
