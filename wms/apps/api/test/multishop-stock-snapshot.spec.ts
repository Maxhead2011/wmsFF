import { describe, expect, it } from 'vitest';
import { normalizeSharedStockSnapshot, ozonReservationLines, StockOrderLine } from '../src/modules/marketplace-connections/multishop-stock-snapshot';
const order = (id: string, quantity: number): StockOrderLine => ({ marketplace: 'OZON', connectionId: 'shop', orderId: id, skuId: 'sku', requestId: 'request', quantity });
describe('shared stock snapshot normalization', () => {
  // TEST: two orders in one WMS request share one physical-pick deduction.
  it('deducts partial picking once across multiple linked orders', () => {
    const value = normalizeSharedStockSnapshot(new Map([['sku', 18]]), [{ requestId: 'request', skuId: 'sku', quantity: 5 }], [order('1', 3), order('2', 2)], [{ requestId: 'request', skuId: 'sku', quantity: 2 }]);
    expect(value.get('sku')).toEqual({ available: 18, reserved: 3, free: 15 });
  });
  it('does not treat an Ozon scan as physical stock deduction', () => {
    expect(normalizeSharedStockSnapshot(new Map([['sku', 20]]), [], [order('1', 2)], []).get('sku')?.free).toBe(18);
  });
  it('deduplicates retried orders before consuming physical picks', () => {
    expect(normalizeSharedStockSnapshot(new Map([['sku', 19]]), [], [order('1', 2), order('1', 2)], [{ requestId: 'request', skuId: 'sku', quantity: 1 }]).get('sku')?.reserved).toBe(1);
  });
  it('retains unrelated FBO demand', () => {
    const result = normalizeSharedStockSnapshot(new Map([['sku', 20]]), [{ requestId: 'fbo', skuId: 'sku', quantity: 4 }], [order('1', 2)], []);
    expect(result.get('sku')?.free).toBe(14);
  });
  it('rejects contradictory duplicates', () => {
    expect(() => normalizeSharedStockSnapshot(new Map(), [], [order('1', 2), order('1', 3)], [])).toThrow('Противоречивые');
  });
});
describe('complete Ozon reservation composition', () => {
  const links = ['a', 'b'].map(id => ({ connectionId: 'shop', skuId: id, marketplace: 'OZON', productId: id, offerId: id, status: 'LINKED' }));
  const posting = { posting_number: '123-1', products: [{ sku: 11, offer_id: 'a', quantity: 2 }, { sku: 12, offer_id: 'b', quantity: 3 }] };
  // TEST: the second product must not disappear behind the legacy first-product summary.
  it('keeps every product with its own canonical SKU and quantity', () => {
    expect(ozonReservationLines('shop', posting, links, null).map(l => [l.skuId, l.quantity])).toEqual([['a', 2], ['b', 3]]);
  });
  it('fails closed when any line is unlinked or belongs to another account', () => {
    expect(() => ozonReservationLines('shop', posting, links.slice(0, 1), null)).toThrow('соответствие');
    expect(() => ozonReservationLines('other', posting, links, null)).toThrow('соответствие');
  });
  it('rejects an incomplete response', () => {
    expect(() => ozonReservationLines('shop', { posting_number: '123-1' }, links, null)).toThrow('неполный');
  });
});
