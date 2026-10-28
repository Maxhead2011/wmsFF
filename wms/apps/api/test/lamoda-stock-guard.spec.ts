import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lamodaStockAvailability, assertLamodaStockAvailable, adjustLamodaComposition } from '../src/modules/lamoda/lamoda-stock-guard';
import { wbReservationQuantities } from '../src/common/stock/wb-order-stock-lifecycle';
import { receiptRules } from '../src/modules/warehouse/receipt-channel-policy';
vi.mock('../src/common/stock/wb-order-stock-lifecycle', () => ({ wbReservationQuantities: vi.fn() }));
vi.mock('../src/modules/warehouse/receipt-channel-policy', async original => ({ ...await original<any>(), receiptRules: vi.fn() }));
let tx: any;
beforeEach(() => {
  vi.mocked(wbReservationQuantities).mockResolvedValue(new Map([['sku', 3]]));
  vi.mocked(receiptRules).mockResolvedValue(new Map());
  tx = { client: { findUniqueOrThrow: vi.fn(async () => ({ storesWithoutBoxes: false })) },
    stockBalance: { findMany: vi.fn(async () => [{ skuId: 'sku', boxId: 'box', quantity: 10 }]) } };
});
afterEach(() => vi.clearAllMocks());
const demand = (quantity: number) => [{ skuId: 'sku', barcode: '12345678', quantity }];

// TEST: corrections are explicit reductions, including removal, without rewriting the source plan.
describe('Lamoda composition correction', () => {
  const plan = () => ({ items: [...demand(6), {skuId:'absent',barcode:'87654321',quantity:2}], directions: [
    {name:'A',items:demand(4)}, {name:'B',items:[...demand(2),{skuId:'absent',barcode:'87654321',quantity:2}]},
  ] });
  it('reduces direction quantities consistently and removes empty directions', () => {
    const source=plan();const before=JSON.stringify(source);
    const result=adjustLamodaComposition(source,[{skuId:'sku',quantity:3},{skuId:'absent',quantity:0}]);
    expect(result.items).toEqual(demand(3));expect(result.directions).toEqual([{name:'A',items:demand(3)}]);
    expect(JSON.stringify(source)).toBe(before);
  });
  it.each([
    [{skuId:'sku',quantity:7},{skuId:'absent',quantity:0}],
    [{skuId:'sku',quantity:-1},{skuId:'absent',quantity:1}],
    [{skuId:'sku',quantity:1.5},{skuId:'absent',quantity:0}],
    [{skuId:'sku',quantity:1}],
    [{skuId:'sku',quantity:1},{skuId:'sku',quantity:1}],
    [{skuId:'sku',quantity:1},{skuId:'foreign',quantity:0}],
    [{skuId:'sku',quantity:0},{skuId:'absent',quantity:0}],
  ])('rejects invalid/empty corrections %#', (...quantities) => {
    expect(()=>adjustLamodaComposition(plan(),quantities)).toThrow();
  });
});

// TEST: only remaining demand is subtracted, once, from approved physical stock.
describe('Lamoda transaction stock guard', () => {
  it('allows exactly the remaining stock; rejects one extra with actionable quantities', async () => {
    await expect(assertLamodaStockAvailable(tx, 'client', 'warehouse', demand(7))).resolves.toBeUndefined();
    await expect(assertLamodaStockAvailable(tx, 'client', 'warehouse', demand(8))).rejects.toThrow('нужно 8, доступно 7, дефицит 1');
  });
  it('aggregates repeated SKU demand across destination/barcode aliases', async () => {
    const rows = await lamodaStockAvailability(tx, 'client', 'warehouse', [...demand(4), { ...demand(4)[0], barcode: 'alias' }]);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ quantity: 8, shortageQuantity: 1 });
  });
  it('does not count an unapproved receipt even when FBO is enabled', async () => {
    vi.mocked(receiptRules).mockResolvedValue(new Map([['box', { fbo: true, stockAvailable: false } as any]]));
    expect((await lamodaStockAvailability(tx, 'client', 'warehouse', demand(1)))[0].stockQuantity).toBe(0);
  });
  it('includes approved boxes without requiring a pallet-sort', async () => {
    await assertLamodaStockAvailable(tx, 'client', 'warehouse', demand(7));
    expect(tx.stockBalance.findMany.mock.calls[0][0].where).toEqual({ clientId: 'client', warehouseId: 'warehouse',
      skuId: { in: ['sku'] }, status: 'AVAILABLE', quantity: { gt: 0 },
      box: { clientId: 'client', warehouseId: 'warehouse', status: 'active' } });
  });
  it('uses only unboxed stock for a client configured without boxes', async () => {
    tx.client.findUniqueOrThrow.mockResolvedValue({ storesWithoutBoxes: true });
    tx.stockBalance.findMany.mockResolvedValue([{ skuId: 'sku', boxId: null, quantity: 10 }]);
    await assertLamodaStockAvailable(tx, 'client', 'warehouse', demand(7));
    expect(tx.stockBalance.findMany.mock.calls[0][0].where).toMatchObject({ boxId: null, palletId: null });
    expect(receiptRules).not.toHaveBeenCalled();
  });
  it('excludes the current request only for an explicitly requested adjustment read', async () => {
    await lamodaStockAvailability(tx, 'client', 'warehouse', demand(7), 'current');
    expect(wbReservationQuantities).toHaveBeenCalledWith(tx, 'client', ['sku'], 'warehouse', 'current');
  });
});
