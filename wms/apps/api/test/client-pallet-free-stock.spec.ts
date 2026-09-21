import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockBalancesService } from '../src/modules/stock/stock-balances.service';

vi.mock('../src/common/stock/wb-order-stock-lifecycle', async importOriginal => ({
  ...await importOriginal<object>(), wbReservationQuantities: vi.fn(async () => new Map([['sku', 2]])),
}));
const original = { flag: process.env.WMS_CLIENT_PALLET_SORT_FREE_STOCK_ENABLED, lifecycle: process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED };
afterEach(() => {
  vi.unstubAllEnvs();
  for (const [key, value] of [['WMS_CLIENT_PALLET_SORT_FREE_STOCK_ENABLED', original.flag], ['WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', original.lifecycle]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});
function fixture() {
  const row = (id: string, status: string, quantity: number, placement: object | null) => ({ id, clientId: 'client', skuId: 'sku', warehouseId: 'moscow', status, quantity,
    box: { warehouseId: 'moscow', storagePlacement: placement } });
  const placed = { pallet: { clientId: 'client', warehouseId: 'moscow' } };
  const rows = [row('unplaced', 'AVAILABLE', 50, null), row('packing', 'PACKING', 44, placed),
    row('wrong-client', 'AVAILABLE', 10, { pallet: { clientId: 'other', warehouseId: 'moscow' } }),
    row('wrong-warehouse', 'AVAILABLE', 10, { pallet: { clientId: 'client', warehouseId: 'other' } }),
    row('available', 'AVAILABLE', 5, placed)];
  const db = { client: { findMany: vi.fn(async () => [{ id: 'client', storesWithoutBoxes: false, stockBalanceMode: 'PALLET_SORT' }]) },
    stockBalance: { findMany: vi.fn(async () => rows) } };
  return { rows, service: new StockBalancesService(db as never, { resolveClientFilter: () => 'client' } as never) };
}
// TEST: only 3 located free units reach client JSON/Excel, not 44 PACKING or unlocated stock.
describe('client pallet-sort free stock', () => {
  // TEST: Noginsk uses BOXES; a pallet is not required, but reservations still apply.
  it.each([['noginsk', 'noginsk', 1], ['moscow', 'noginsk', 0], ['noginsk', '', 0]])('branch %s with allowlist %s returns %s rows', async (warehouseId, allowed, expected) => {
    process.env.WMS_CLIENT_PALLET_SORT_FREE_STOCK_ENABLED = 'true';
    vi.stubEnv('WMS_CLIENT_BOX_STOCK_WAREHOUSE_IDS', allowed);
    const db = {
      client: { findMany: vi.fn(async () => [{ id: 'client', storesWithoutBoxes: false, stockBalanceMode: 'BOXES' }]) },
      stockBalance: { findMany: vi.fn(async () => [
        { id: 'a', clientId: 'client', skuId: 'sku', warehouseId, status: 'AVAILABLE', quantity: 5,
          box: { warehouseId, storagePlacement: null } },
        { id: 'b', clientId: 'client', skuId: 'sku', warehouseId: 'noginsk', status: 'PACKING', quantity: 7, box: null },
      ]) },
    };
    const service = new StockBalancesService(db as never, { resolveClientFilter: () => 'client' } as never);
    expect(await service.list({}, { roleCodes: ['CLIENT'], permissionCodes: [] } as never))
      .toEqual(expected ? [expect.objectContaining({ id: 'a', quantity: 3, freeQuantity: 3 })] : []);
  });
  it('excludes nonavailable/unlocated/mismatched stock and deducts reservations once', async () => {
    process.env.WMS_CLIENT_PALLET_SORT_FREE_STOCK_ENABLED = 'true';
    process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED = 'true';
    const { service } = fixture();
    const rows = await service.list({}, { roleCodes: ['CLIENT'], permissionCodes: [] } as never);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'available', quantity: 3, freeQuantity: 3, status: 'AVAILABLE' });
  });
  it('keeps physical quantities for internal staff while giving export a safe freeQuantity', async () => {
    process.env.WMS_CLIENT_PALLET_SORT_FREE_STOCK_ENABLED = 'true';
    const { service } = fixture();
    const rows = await service.list({}, { roleCodes: ['MANAGER'], permissionCodes: [] } as never);
    expect(rows.find(r => r.id === 'packing')).toMatchObject({ quantity: 44, freeQuantity: 0 });
    expect(rows.find(r => r.id === 'available')).toMatchObject({ quantity: 5, freeQuantity: 3 });
  });
  it('leaves the sold installation unchanged when both opt-in flags are off', async () => {
    process.env.WMS_CLIENT_PALLET_SORT_FREE_STOCK_ENABLED = 'false';
    process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED = 'false';
    const { service, rows } = fixture();
    expect(await service.list({}, { roleCodes: ['CLIENT'], permissionCodes: [] } as never)).toEqual(rows);
  });
});
