import { describe, expect, it } from 'vitest';
import { receiptBoxCodePrefixForDate, receiptDateFromBoxCode } from '../src/common/receipt-batches';

describe('receipt batch dates', () => {
  it('uses the date from a box code instead of the movement creation date', () => {
    expect(receiptDateFromBoxCode('FFL_LKB1807_251', new Date('2026-07-21T07:21:07.500Z'))).toBe('2026-07-18');
  });

  it('respects an explicit two-digit year in a box code', () => {
    expect(receiptDateFromBoxCode('FFL_LKB180725_001', new Date('2026-07-21T07:21:07.500Z'))).toBe('2025-07-18');
  });

  it('builds the search prefix only for a valid batch date', () => {
    expect(receiptBoxCodePrefixForDate('2026-07-18')).toBe('FFL_LKB1807');
    expect(receiptBoxCodePrefixForDate('2026-02-31')).toBeNull();
  });
});
