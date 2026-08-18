import { describe, expect, it } from 'vitest';
import {
  allocateFbsStock,
  recommendFbsStockPercentages,
  validateFbsStockAllocationShares,
} from '../src/modules/marketplace-connections/fbs-stock-allocation';

describe('FBS stock allocation', () => {
  const shares = [
    { warehouseId: 'moscow', percent: 50, isPrimary: true },
    { warehouseId: 'south', percent: 30 },
    { warehouseId: 'east', percent: 20 },
  ];

  // TEST: Ten units or fewer must remain on the primary Moscow warehouse.
  it('keeps low stock on the primary warehouse', () => {
    expect(allocateFbsStock(10, 10, shares)).toEqual([
      { warehouseId: 'moscow', amount: 10 },
      { warehouseId: 'south', amount: 0 },
      { warehouseId: 'east', amount: 0 },
    ]);
  });

  // TEST: The first amount above the threshold is distributed and never duplicated.
  it('distributes stock above the threshold without exceeding WMS stock', () => {
    const result = allocateFbsStock(11, 10, shares);
    expect(result).toEqual([
      { warehouseId: 'moscow', amount: 6 },
      { warehouseId: 'south', amount: 3 },
      { warehouseId: 'east', amount: 2 },
    ]);
    expect(result.reduce((sum, row) => sum + row.amount, 0)).toBe(11);
  });

  // TEST: Manual configuration cannot be saved with an incomplete percentage total.
  it('requires exactly 100 percent and one primary warehouse', () => {
    expect(() => validateFbsStockAllocationShares(shares)).not.toThrow();
    expect(() => validateFbsStockAllocationShares(shares.slice(0, 2))).toThrow('100%');
    expect(() => validateFbsStockAllocationShares(shares.map((row) => ({ ...row, isPrimary: false })))).toThrow(
      'ровно один',
    );
  });

  // TEST: Recommendation is deterministic and is not itself a saved configuration.
  it('recommends demand-weighted percentages with an equal fallback', () => {
    expect(
      recommendFbsStockPercentages(
        ['moscow', 'south', 'east'],
        new Map([
          ['moscow', 6],
          ['south', 3],
          ['east', 1],
        ]),
      ),
    ).toEqual([
      { warehouseId: 'moscow', percent: 60 },
      { warehouseId: 'south', percent: 30 },
      { warehouseId: 'east', percent: 10 },
    ]);
    expect(recommendFbsStockPercentages(['a', 'b', 'c'], new Map())).toEqual([
      { warehouseId: 'a', percent: 34 },
      { warehouseId: 'b', percent: 33 },
      { warehouseId: 'c', percent: 33 },
    ]);
  });
});
