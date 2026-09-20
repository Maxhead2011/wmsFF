import { describe, expect, it } from 'vitest';
import { aggregateStockRows } from './clientCabinetStockExcelExport';

const row = (quantity: number, status: string, freeQuantity?: number): any => ({
  skuId: 'sku', quantity, status, freeQuantity, updatedAt: '2026-09-16T00:00:00Z',
  sku: { id: 'sku', name: 'Suit', internalSku: 'suit-xs', barcodes: [{ value: '123', isPrimary: true }] },
});
// TEST: Excel receives the unified free amount and must not add PACKING or subtract requests again.
describe('cabinet Excel lifecycle quantities', () => {
  it('exports available minus all WB demand exactly once', () => {
    const requests: any = [{ type: 'OUTBOUND', status: 'IN_WORK', items: [{ skuId: 'sku', quantity: 2 }] }];
    expect(aggregateStockRows([row(7, 'AVAILABLE', 5), row(2, 'PACKING', 0)], requests)[0].quantity).toBe(5);
  });
  it('does not export a product with only packing or fully reserved stock', () => {
    expect(aggregateStockRows([row(2, 'PACKING', 0), row(1, 'AVAILABLE', 0)], [])).toEqual([]);
  });
  it('keeps the sold WMS calculation when no lifecycle fields are supplied', () => {
    expect(aggregateStockRows([row(5, 'AVAILABLE')], [
      { type: 'OUTBOUND', status: 'IN_WORK', items: [{ skuId: 'sku', quantity: 2 }] } as any,
    ])[0].quantity).toBe(3);
  });
});

// TEST: client summary exposes variant attributes without changing free quantity.
it('preserves article, color, size and leading-zero barcode in the stock summary', () => {
  const a = row(5, 'AVAILABLE', 3);
  a.sku = { ...a.sku, article: 'Suit_blue', color: 'Blue', size: 'M', barcodes: [{ value: '0000123456789', isPrimary: true }] };
  const b = { ...a, quantity: 4, freeQuantity: 2 };
  expect(aggregateStockRows([a, b], [])[0]).toMatchObject({
    article: 'Suit_blue', color: 'Blue', size: 'M', barcode: '0000123456789', quantity: 5,
  });
});
