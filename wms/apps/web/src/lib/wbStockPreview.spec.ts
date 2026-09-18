import { describe, expect, it } from 'vitest';
import { filterWbStockPreviewRows, WB_STOCK_PREVIEW_LIMIT, wbStockPreview, wbReservePreviewAmount } from './wbStockPreview';

// TEST: administrative example must match publication on both sides of the strict threshold.
it('shows the replacement reserve below the threshold and the main reserve at it', () => {
  const rule = { mode: 'UNITS', value: 3, lowStock: { threshold: 5, reserveUnits: 1 } } as const;
  expect([0, 1, 4, 5, 6].map(n => wbReservePreviewAmount(n, rule))).toEqual([0, 0, 3, 2, 3]);
  expect(wbReservePreviewAmount(4, { ...rule, mode: 'PERCENT', value: 50 })).toBe(3);
  expect(wbReservePreviewAmount(5, { ...rule, mode: 'PERCENT', value: 50 })).toBe(2);
});

// TEST: zero stock must not occupy preview rows; a reserve is not missing stock.
it('filters zero stock before pagination while retaining reserved/blocked available goods', () => {
  const empty = Array.from({ length: 101 }, (_, i) => ({ name: 'Пустой', barcode: `${i}`, available: 0, publishable: 0 }));
  const present = { name: 'Реглан', barcode: '123', available: 3, publishable: 0 };
  const rows = [...empty, present];
  expect(filterWbStockPreviewRows(rows, '').slice(0, WB_STOCK_PREVIEW_LIMIT)).toEqual([present]);
  expect(filterWbStockPreviewRows(rows, 'РЕГ')).toEqual([present]);
  expect(filterWbStockPreviewRows(rows, '123')).toEqual([present]);
  expect(filterWbStockPreviewRows(rows, 'Пустой')).toEqual([]);
  expect(rows).toHaveLength(102);
});

// TEST: limiting output does not hide later products from barcode search.
it('shows 30 available positions and can find a position beyond the limit', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ name: `Товар ${i}`, barcode: `barcode-${i}`, available: 1 }));
  expect(filterWbStockPreviewRows(rows, '').slice(0, WB_STOCK_PREVIEW_LIMIT)).toEqual(rows.slice(0, 30));
  expect(filterWbStockPreviewRows(rows, 'barcode-44').slice(0, WB_STOCK_PREVIEW_LIMIT)).toEqual([rows[44]]);
});
describe('WB stock preview', () => {
  // TEST: sums are conserved, rounding is deterministic, invalid drafts are not publishable.
  const shares = [{ warehouseId: 'a', percent: 60, isPrimary: true }, { warehouseId: 'b', percent: 40, isPrimary: false }];
  it('splits seven units into four and three', () => expect(wbStockPreview(7, 0, shares)).toEqual([{ warehouseId: 'a', amount: 4 }, { warehouseId: 'b', amount: 3 }]));
  it('keeps low stock on the primary warehouse', () => expect(wbStockPreview(7, 10, shares)?.map(r => r.amount)).toEqual([7, 0]));
  it('rejects incomplete percentages', () => expect(wbStockPreview(7, 0, shares.slice(0, 1))).toBeNull());
  it('never loses or duplicates units', () => { for (let n = 0; n < 1000; n++) expect(wbStockPreview(n, 10, shares)?.reduce((s, r) => s + r.amount, 0)).toBe(n); });
});
