import { expect, it } from 'vitest';
import { isValidLowStockReserve } from './WbLowStockReserveFields';

// TEST: UI permits disabling/zero reserve but rejects invalid threshold or fractional amounts.
it('validates the optional low-stock input', () => {
  expect(isValidLowStockReserve(undefined)).toBe(true);
  expect(isValidLowStockReserve({ threshold: 5, reserveUnits: 0 })).toBe(true);
  for (const rule of [{ threshold: 0, reserveUnits: 1 }, { threshold: 5.5, reserveUnits: 1 }, { threshold: 5, reserveUnits: -1 }, { threshold: 5, reserveUnits: 0.5 }]) expect(isValidLowStockReserve(rule)).toBe(false);
});
