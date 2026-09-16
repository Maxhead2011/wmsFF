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
