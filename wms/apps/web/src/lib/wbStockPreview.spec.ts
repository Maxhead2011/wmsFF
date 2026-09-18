import { describe, expect, it } from 'vitest';
import { wbStockPreview } from './wbStockPreview';
describe('WB stock preview', () => {
  // TEST: sums are conserved, rounding is deterministic, invalid drafts are not publishable.
  const shares = [{ warehouseId: 'a', percent: 60, isPrimary: true }, { warehouseId: 'b', percent: 40, isPrimary: false }];
  it('splits seven units into four and three', () => expect(wbStockPreview(7, 0, shares)).toEqual([{ warehouseId: 'a', amount: 4 }, { warehouseId: 'b', amount: 3 }]));
  it('keeps low stock on the primary warehouse', () => expect(wbStockPreview(7, 10, shares)?.map(r => r.amount)).toEqual([7, 0]));
  it('rejects incomplete percentages', () => expect(wbStockPreview(7, 0, shares.slice(0, 1))).toBeNull());
  it('never loses or duplicates units', () => { for (let n = 0; n < 1000; n++) expect(wbStockPreview(n, 10, shares)?.reduce((s, r) => s + r.amount, 0)).toBe(n); });
});
