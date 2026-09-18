import { afterEach, expect, it, vi } from 'vitest';
import { wbReservationQuantities } from '../src/common/stock/wb-order-stock-lifecycle';

afterEach(() => vi.unstubAllEnvs());
// TEST: hundreds of prefix batches repeatedly scanned the same client's movement history.
it('reads pick evidence once and preserves reservations, exact task identity and scope', async () => {
  const tasks = Array.from({ length: 501 }, (_, i) => ({ id: `task-${i}`, orderId: `order-${i}`, connectionId: 'wb', requestId: `request-${i}`, skuId: 'sku', itemCount: 2, status: 'RESERVED' }));
  const movements = [
    { idempotencyKey: 'fbs-sticker-pick:task-0:scan-1', quantity: 1 },
    { idempotencyKey: 'fbs-sticker-pick:task-0:scan-2', quantity: 1 },
    { idempotencyKey: 'fbs-sticker-pick:task-1:scan-1', quantity: 1 },
    { idempotencyKey: 'fbs-sticker-pick:task-1-extra:scan-1', quantity: 999 },
    { idempotencyKey: 'fbs-sticker-pick:unrelated:scan-1', quantity: 999 },
  ];
  const findMany = vi.fn(async ({ where }: any) => movements.filter(m =>
    where.OR ? where.OR.some((x: any) => m.idempotencyKey.startsWith(x.idempotencyKey.startsWith))
      : m.idempotencyKey.startsWith(where.idempotencyKey.startsWith)));
  const db = {
    sku: { findMany: vi.fn().mockResolvedValue([{ id: 'sku', barcodes: [] }]) },
    fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue(tasks) },
    clientRequest: { findMany: vi.fn().mockResolvedValue([]) },
    fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue([]) },
    stockMovement: { findMany },
    wbOrderShipment: { findMany: vi.fn().mockResolvedValue([]) },
  };
  vi.stubEnv('WMS_FBS_ALLOCATION_FAST_ENABLED', 'false');
  const old = await wbReservationQuantities(db as never, 'client', ['sku'], 'moscow');
  expect(findMany).toHaveBeenCalledTimes(6);
  findMany.mockClear();
  vi.stubEnv('WMS_FBS_ALLOCATION_FAST_ENABLED', 'true');
  const fast = await wbReservationQuantities(db as never, 'client', ['sku'], 'moscow');
  expect(fast).toEqual(old);
  expect(fast.get('sku')).toBe(999);
  // TEST: reservation reads must not load sticker files, events and other assembly payloads.
  expect(db.fbsTsdAssembly.findMany.mock.calls.at(-1)?.[0]).toHaveProperty('select', {
    id: true, orderId: true, connectionId: true, requestId: true, skuId: true,
    sourceSkuId: true, relabelConfirmedAt: true, itemCount: true, status: true,
  });
  expect(findMany).toHaveBeenCalledTimes(1);
  expect(findMany.mock.calls[0][0].where).toEqual({ clientId: 'client', warehouseId: 'moscow', status: 'PACKING', idempotencyKey: { startsWith: 'fbs-sticker-pick:' } });
  findMany.mockClear();
  db.fbsTsdAssembly.findMany.mockResolvedValue([]);
  expect(await wbReservationQuantities(db as never, 'client', ['sku'])).toEqual(new Map([['sku', 0]]));
  expect(findMany).not.toHaveBeenCalled();
});
