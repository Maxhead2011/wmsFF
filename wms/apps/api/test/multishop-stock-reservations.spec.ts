import { describe, expect, it } from 'vitest';
import { calculateSharedShopAvailability as calculate, type SharedOrderDemand } from '../src/modules/marketplace-connections/multishop-stock-reservations';
const order: SharedOrderDemand = { marketplace: 'OZON', connectionId: 'ozon1', orderId: '123', skuId: 'size52', requestId: null, remaining: 1 };
const stock = new Map([['size52', 20], ['size54', 10]]);
describe('one physical reservation across marketplace shops', () => {
  // TEST: concurrent sales in different shops consume one shared budget, not separate stocks.
  it('reserves WB and Ozon sales against the same 20 units', () => {
    const result = calculate(stock, [], [order, { ...order, marketplace: 'WILDBERRIES', connectionId: 'wb1' }]);
    expect(result.get('size52')).toEqual({ available: 20, reserved: 2, free: 18 });
  });
  it('deduplicates order retries but not equal numbers in different shops', () => {
    expect(calculate(stock, [], [order, order]).get('size52')?.free).toBe(19);
    expect(calculate(stock, [], [order, { ...order, connectionId: 'ozon2' }]).get('size52')?.free).toBe(18);
  });
  it('counts an order and its WMS request once', () => {
    expect(calculate(stock, [{ requestId: 'request', skuId: 'size52', remaining: 1 }], [{ ...order, requestId: 'request' }]).get('size52')?.reserved).toBe(1);
  });
  it('combines several orders in one request and keeps unrelated FBO reservations', () => {
    expect(calculate(stock, [{ requestId: 'request', skuId: 'size52', remaining: 2 }, { requestId: 'fbo', skuId: 'size52', remaining: 3 }],
      [{ ...order, requestId: 'request' }, { ...order, orderId: '124', requestId: 'request' }]).get('size52')?.reserved).toBe(5);
  });
  it('retains conservative demand while a linked request catches up', () => {
    expect(calculate(stock, [{ requestId: 'request', skuId: 'size52', remaining: 1 }], [{ ...order, requestId: 'request', remaining: 3 }]).get('size52')?.reserved).toBe(3);
  });
  it('keeps the available quantity stable when a reserved unit is physically picked', () => {
    const before = calculate(stock, [], [order]).get('size52')?.free;
    const after = calculate(new Map([['size52', 19]]), [], [{ ...order, remaining: 0 }]).get('size52')?.free;
    expect(before).toBe(19); expect(after).toBe(19);
  });
  it('releases a cancelled unpicked order and keeps sizes separate', () => {
    expect(calculate(stock, [], [{ ...order, remaining: 0 }]).get('size52')?.free).toBe(20);
    expect(calculate(stock, [], [order]).get('size54')?.free).toBe(10);
  });
  it('rejects contradictory snapshots and unknown identities', () => {
    expect(() => calculate(stock, [], [order, { ...order, remaining: 2 }])).toThrow('версии');
    expect(() => calculate(stock, [], [{ ...order, skuId: '' }])).toThrow('соответствие');
  });
});
