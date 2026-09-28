import { describe, expect, it } from 'vitest';
import { receiptBoxCodePrefixForDate, receiptDateFromBoxCode } from '../src/common/receipt-batches';

describe('receipt batch dates', () => {
  // TEST: an FBO-prefixed physical receipt belongs to its encoded date only in the opted-in read path.
  it('groups LKBFBO receipts with 2409 without changing default operational parsing', () => {
    const at = new Date('2026-09-25T12:07:30Z');
    expect(receiptDateFromBoxCode('FFL_LKBFBO2409_250', at, 'FFL_LKB', true)).toBe('2026-09-24');
    expect(receiptDateFromBoxCode('FFL_LKBFBO2409_250', at)).toBe('2026-09-25');
    expect(receiptDateFromBoxCode('FFL_LKBFBO3102_250', at, 'FFL_LKB', true)).toBe('2026-09-25');
    expect(receiptDateFromBoxCode('FFL_LKBFBO2409_250', at, 'CUSTOM_', true)).toBe('2026-09-25');
  });
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
