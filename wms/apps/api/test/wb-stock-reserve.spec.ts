import { describe, expect, it } from 'vitest';
import { parseWbStockReserve, wbStockAfterReserve } from '../src/modules/marketplace-connections/wb-stock-reserve';

describe('WB publication reserve', () => {
  // TEST: one reserve is deducted before splitting, never once per warehouse.
  it('keeps three units and clamps small stock to zero', () => {
    expect([10, 4, 3, 0].map(n => wbStockAfterReserve(n, { mode: 'UNITS', value: 3 }))).toEqual([7, 1, 0, 0]);
  });
  it('rounds percentage reserve upward and preserves the default', () => {
    expect(wbStockAfterReserve(11, { mode: 'PERCENT', value: 10 })).toBe(9);
    expect(wbStockAfterReserve(11)).toBe(11);
    expect(wbStockAfterReserve(11, { mode: 'PERCENT', value: 100 })).toBe(0);
  });
  it.each([{ mode: 'PERCENT', value: 101 }, { mode: 'UNITS', value: -1 }, { mode: 'UNITS', value: 1.5 }, { mode: 'NONE', value: 2 }, null])('rejects malformed rule %j', rule => {
    expect(() => parseWbStockReserve(rule)).toThrow();
  });
});
