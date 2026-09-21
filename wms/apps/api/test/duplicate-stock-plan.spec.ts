import { describe, expect, it } from 'vitest';
import { calculateDuplicateStockPlan } from '../src/modules/marketplace-connections/duplicate-stock-plan';

const policy = { shares: [{ targetKey: 'original', percent: 50 }, { targetKey: 'sport', percent: 50 }] };
const variant = (sourceSkuId: string, size: string, available: number, budget = available) => ({
  sourceSkuId, size, available, marketplaceBudget: budget,
  targets: [{ targetKey: 'original', targetId: `${sourceSkuId}:original`, confirmed: true, requiresRelabel: false },
    { targetKey: 'sport', targetId: `${sourceSkuId}:sport`, confirmed: true, requiresRelabel: true }],
});

describe('shared stock distributed between duplicate cards', () => {
  // TEST: WB cards may divide only WB's allocation, not all physical stock again.
  it('splits the marketplace budget and keeps Ozon units outside the duplicate allocation', () => {
    const result = calculateDuplicateStockPlan(policy, [variant('korea-blue', 'M', 80, 48)]);
    expect(result.rows[0].targets.map(t => t.quantity)).toEqual([24, 24]);
    expect(result.rows[0].outsideMarketplace).toBe(32);
    expect(result.rows[0].relabelQuantity).toBe(24);
    expect(result.totalAllocated).toBe(48);
  });
  // TEST: two equal size labels may represent different colors; override by source SKU.
  it('supports per-variant exceptions without moving stock between sizes or colors', () => {
    const result = calculateDuplicateStockPlan({ ...policy, overrides: [{ sourceSkuId: 'blue', shares:
      [{ targetKey: 'original', percent: 100 }, { targetKey: 'sport', percent: 0 }] }] },
      [variant('blue', 'M', 6), variant('black', 'M', 6), variant('large', 'L', 0)]);
    expect(result.rows.map(r => r.targets.map(t => t.quantity))).toEqual([[6, 0], [3, 3], [0, 0]]);
    expect(result.totalRelabel).toBe(3);
  });
  // TEST: retries and a different order of selected cards must not alternate the odd unit.
  it('rounds deterministically and conserves every available unit', () => {
    for (let amount = 0; amount < 60; amount++) for (let percent = 0; percent <= 100; percent++) {
      const shares = [{ targetKey: 'original', percent }, { targetKey: 'sport', percent: 100 - percent }];
      const a = calculateDuplicateStockPlan({ shares }, [variant('sku', 'M', amount)]);
      const b = calculateDuplicateStockPlan({ shares: [...shares].reverse() }, [variant('sku', 'M', amount)]);
      expect(a.rows[0].targets).toEqual(b.rows[0].targets);
      expect(a.totalAllocated).toBe(amount);
    }
  });
  // TEST: false correspondence confirmation must never generate an actionable quantity.
  it('rejects unconfirmed cards, overlapping sources and reused destination cards', () => {
    const a = variant('a', 'M', 10), b = variant('b', 'L', 10);
    a.targets[1].confirmed = false;
    expect(() => calculateDuplicateStockPlan(policy, [a])).toThrow();
    a.targets[1].confirmed = true;
    expect(() => calculateDuplicateStockPlan(policy, [a, a])).toThrow();
    b.targets[1].targetId = a.targets[1].targetId;
    expect(() => calculateDuplicateStockPlan(policy, [a, b])).toThrow();
  });
  // TEST: malformed settings cannot publish more units than the physical pool or silently lose shares.
  it('rejects invalid sums, stale exceptions, ambiguous targets and unsafe quantities', () => {
    const v = variant('sku', 'M', 10);
    for (const shares of [[], [{ targetKey: 'original', percent: 60 }, { targetKey: 'sport', percent: 60 }],
      [{ targetKey: 'original', percent: 50 }, { targetKey: 'original', percent: 50 }]]) {
      expect(() => calculateDuplicateStockPlan({ shares }, [v])).toThrow();
    }
    expect(() => calculateDuplicateStockPlan({ ...policy, overrides: [{ sourceSkuId: 'missing', shares: policy.shares }] }, [v])).toThrow();
    expect(() => calculateDuplicateStockPlan(policy, [{ ...v, marketplaceBudget: 11 }])).toThrow();
    expect(() => calculateDuplicateStockPlan(policy, [{ ...v, available: -1 }])).toThrow();
    expect(() => calculateDuplicateStockPlan(policy, [{ ...v, available: 1.5 }])).toThrow();
    expect(() => calculateDuplicateStockPlan(policy, [{ ...v, targets: v.targets.slice(0, 1) }])).toThrow();
  });
  // TEST: multiplication must stay exact even when a valid quantity is near JS's integer limit.
  it('uses exact integer arithmetic for large balances', () => {
    const result = calculateDuplicateStockPlan(policy, [variant('sku', 'M', Number.MAX_SAFE_INTEGER)]);
    expect(result.totalAllocated).toBe(Number.MAX_SAFE_INTEGER);
  });
});
