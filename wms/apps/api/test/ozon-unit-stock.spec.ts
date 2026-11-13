import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertOzonUnitStock } from '../src/modules/marketplace-connections/ozon-unit-stock';
import { wbReservationQuantities } from '../src/common/stock/wb-order-stock-lifecycle';
vi.mock('../src/common/stock/wb-order-stock-lifecycle', () => ({ wbReservationQuantities: vi.fn() }));
vi.mock('../src/modules/warehouse/receipt-channel-policy', () => ({ assertReceiptFbsBox: vi.fn() }));

// TEST: reject unavailable units even when the scanned KIZ is still AVAILABLE.
describe('Ozon unit source stock', () => {
  const task = { id: 'task', clientId: 'client', requestId: 'request' };
  const state: any = { source: { boxId: 'box', boxCode: 'BOX' }, lines: [{ skuId: 'sku', quantity: 2, picks: [] }] };
  function fixture(quantity = 2) {
    const service = { resolveFbsTsdExpectedWarehouseId: async () => 'wh', fbsTsdReservationRowsBySku: async () => new Map() };
    const tx = { $queryRaw: vi.fn(async () => [{ id: 'box', clientId: 'client', warehouseId: 'wh', status: 'active' }]),
      stockBalance: { findMany: async () => [{ boxId: 'box', quantity }] },
      clientRequestItem: { findMany: async () => [{ quantity: 2 }] },
      stockMovement: { aggregate: async () => ({ _sum: { quantity: 0 } }) } };
    return { service, tx };
  }
  beforeEach(() => vi.mocked(wbReservationQuantities).mockResolvedValue(new Map()));
  it('rejects an empty source and stock reserved by another request', async () => {
    let f = fixture(0);
    await expect(assertOzonUnitStock(f.service, f.tx, task, state)).rejects.toThrow('источнике');
    f = fixture();
    vi.mocked(wbReservationQuantities).mockResolvedValue(new Map([['sku', 1]]));
    await expect(assertOzonUnitStock(f.service, f.tx, task, state)).rejects.toThrow('зарезервирован');
  });
  it('rejects a source moved to another warehouse', async () => {
    const f = fixture();
    f.tx.$queryRaw.mockResolvedValue([{ id: 'box', clientId: 'client', warehouseId: 'other', status: 'active' }]);
    await expect(assertOzonUnitStock(f.service, f.tx, task, state)).rejects.toThrow('другому складу');
  });
  // TEST: a source reserved before the other picker scans it must remain unavailable.
  it('counts a preliminary box reservation when boxId is not set yet', async () => {
    const f = fixture(2);
    f.service.fbsTsdReservationRowsBySku = async () => new Map([['sku', [
      { boxId: null, reservedBoxId: 'box', itemCount: 2 },
    ]]]);
    await expect(assertOzonUnitStock(f.service, f.tx, task, state)).rejects.toThrow('источнике');
  });
  it('subtracts prior physical debits from this request demand, not twice from AVAILABLE', async () => {
    const f = fixture(1);
    f.tx.stockMovement.aggregate = async () => ({ _sum: { quantity: -1 } });
    await expect(assertOzonUnitStock(f.service, f.tx, task, state)).resolves.toBeUndefined();
  });
});
