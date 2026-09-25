import { describe, expect, it } from 'vitest';
import { orderAgeLabel } from './OrderAge';
// TEST: WB-like elapsed hours continue past 24; absent WB dates are never invented.
describe('online order age', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  it('shows total hours and minutes, including the day boundary', () => {
    expect(orderAgeLabel('2026-09-23T12:04:00Z', now)).toBe('47 ч 56 мин');
    expect(orderAgeLabel('2026-09-24T12:00:00Z', now)).toBe('24 ч 0 мин');
  });
  it('does not manufacture dates or negative age', () => {
    expect(orderAgeLabel(null, now)).toBeNull();
    expect(orderAgeLabel('bad-date', now)).toBeNull();
    expect(orderAgeLabel('2026-09-26T12:00:00Z', now)).toBe('0 ч 0 мин');
  });
});
