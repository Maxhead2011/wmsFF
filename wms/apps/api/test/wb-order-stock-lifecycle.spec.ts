import { describe, expect, it } from 'vitest';
import { calculateWbFreeStock } from '../src/common/stock/wb-order-stock-lifecycle';

// TEST: one demand survives the transition from incoming WB order to a WMS request.
describe('WB order stock lifecycle', () => {
  const task = { id: 't', requestId: 'r', skuId: 'sku', itemCount: 1, status: 'RESERVED', pickedQuantity: 0, shipped: false };
  it('reserves incoming orders without a WMS request', () => {
    expect(calculateWbFreeStock(5, [{ ...task, requestId: 'auto' }], [])).toBe(4);
  });
  it('does not reserve a linked WMS request twice', () => {
    expect(calculateWbFreeStock(5, [task], [{ id: 'r', quantity: 1 }])).toBe(4);
  });
  it('does not subtract a physically picked unit again', () => {
    expect(calculateWbFreeStock(4, [{ ...task, status: 'COMPLETED', pickedQuantity: 1 }], [{ id: 'r', quantity: 1 }])).toBe(4);
  });
  it('releases a cancellation and preserves independent request demand', () => {
    expect(calculateWbFreeStock(5, [{ ...task, status: 'RELEASED' }], [{ id: 'r', quantity: 1 }, { id: 'other', quantity: 2 }])).toBe(3);
  });
  it('never exposes negative free quantity or loses waiting demand', () => {
    expect(calculateWbFreeStock(0, [{ ...task, status: 'WAITING_STOCK' }], [])).toBe(0);
  });
  it('shipment remains final after cancellation, delivery, return, or retry', () => {
    for (const status of ['COMPLETED', 'RETURN_REQUIRED', 'RESERVED', 'RELEASED']) {
      expect(calculateWbFreeStock(5, [{ ...task, shipped: true, status }], [{ id: 'r', quantity: 1 }])).toBe(5);
    }
  });
});
