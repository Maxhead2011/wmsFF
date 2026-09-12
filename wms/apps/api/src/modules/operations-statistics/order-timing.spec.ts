import { describe, expect, it } from 'vitest';
import { bucketIndex, summarizeOrders, timingSnapshot } from './order-timing';

describe('order processing statistics // TEST', () => {
  it.each([[0, 0], [13.999, 0], [14, 1], [18, 2], [24, 3], [48, 4], [90, 4]])('classifies %s hours without overlapping boundaries', (hours, expected) => {
    expect(bucketIndex(hours * 3_600_000)).toBe(expected);
  });
  it('counts orders, not products; percentages use only timed shipped orders', () => {
    const result = summarizeOrders([
      { state: 'shipped', elapsedMs: 5 * 3_600_000 },
      { state: 'shipped', elapsedMs: 30 * 3_600_000 },
      { state: 'pending', elapsedMs: 50 * 3_600_000 },
      { state: 'cancelled', elapsedMs: null },
      { state: 'unknown', elapsedMs: null },
    ]);
    expect(result.total).toBe(5);
    expect(result.timedShipped).toBe(2);
    expect(result.buckets.map(b => b.percent)).toEqual([50, 0, 0, 50, 0]);
    expect(result.pending).toBe(1);
    expect(result.pendingOver24h).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(result.unknown).toBe(1);
  });
  it('does not manufacture dates from WMS import, planned shipment or label printing', () => {
    expect(timingSnapshot(undefined)).toEqual({});
    expect(timingSnapshot({ placedAt: 'invalid', handedOverAt: 'invalid' })).toEqual({});
  });
  it('persists verified source timestamps and keeps missing fields untouched', () => {
    expect(timingSnapshot({ placedAt: '2026-09-01T12:00:00Z', warehouseId: '42' })).toEqual({
      orderPlacedAt: new Date('2026-09-01T12:00:00Z'), sellerWarehouseId: '42',
    });
  });
  it('empty percentages are zero, never NaN', () => {
    expect(summarizeOrders([]).buckets.every(b => b.percent === 0)).toBe(true);
  });
});
