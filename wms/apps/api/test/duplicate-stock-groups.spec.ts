import { describe, expect, it } from 'vitest';
import { calculateDuplicateStockPlan } from '../src/modules/marketplace-connections/duplicate-stock-plan';
import { validateDuplicateGroup, stockAfterSafetyReserve, assertNoDuplicateGroupOverlap, type DuplicateGroup } from '../src/modules/marketplace-connections/duplicate-stock-groups';
export function group(): DuplicateGroup {
  return { id: 'group', name: 'Корея', connectionId: 'wb', reserve: { mode: 'UNITS', value: 10 },
    shares: [{ targetKey: 'original', label: 'Исходный', percent: 75 }, { targetKey: 'duplicate', label: 'Дубль', percent: 25 }],
    variants: ['S', 'M'].map(size => ({ sourceSkuId: 'source-' + size, targets: [
      { targetKey: 'original', targetId: 'source-' + size, confirmed: true, requiresRelabel: false },
      { targetKey: 'duplicate', targetId: 'target-' + size, confirmed: true, requiresRelabel: true },
    ] })), overrides: [] };
}
describe('duplicate group policies', () => {
  // TEST: one global percentage applies independently to every size; only explicit overrides differ.
  it('inherits common shares and restores them when a size exception is removed', () => {
    const g = group(); g.overrides = [{ sourceSkuId: 'source-M', shares: [{ targetKey: 'original', percent: 50 }, { targetKey: 'duplicate', percent: 50 }] }];
    const variants = g.variants.map(v => ({ ...v, size: v.sourceSkuId, available: 80, marketplaceBudget: 80 }));
    const plan = calculateDuplicateStockPlan(validateDuplicateGroup(g), variants);
    expect(plan.rows.map(r => r.targets.find(t => t.targetKey === 'duplicate')!.quantity)).toEqual([20, 40]);
    g.overrides = [];
    expect(calculateDuplicateStockPlan(g, variants).rows.map(r => r.targets.find(t => t.targetKey === 'duplicate')!.quantity)).toEqual([20, 20]);
  });
  it('subtracts insurance once, rounds percentages up and clamps small stock', () => {
    expect(stockAfterSafetyReserve(80, { mode: 'UNITS', value: 10 })).toEqual({ safetyReserve: 10, distributable: 70 });
    expect(stockAfterSafetyReserve(11, { mode: 'PERCENT', value: 10 })).toEqual({ safetyReserve: 2, distributable: 9 });
    expect(stockAfterSafetyReserve(1, { mode: 'UNITS', value: 10 })).toEqual({ safetyReserve: 1, distributable: 0 });
  });
  it('keeps 100% on the duplicate and zero on the original without doubling', () => {
    const g = group(); g.shares[0].percent = 0; g.shares[1].percent = 100;
    const plan = calculateDuplicateStockPlan(validateDuplicateGroup(g), g.variants.map(v => ({ ...v, size: '', available: 7, marketplaceBudget: 7 })));
    expect(plan.totalAllocated).toBe(14); expect(plan.totalRelabel).toBe(14);
  });
  it('rejects overlapping groups, unconfirmed pairs and a second source used as a target', () => {
    const g = group(); expect(() => assertNoDuplicateGroupOverlap({ ...g, id: 'another' }, [g])).toThrow('другую группу');
    g.variants[0].targets[1].confirmed = false; expect(() => validateDuplicateGroup(g)).toThrow('Подтвердите');
    const cyclic = group(); cyclic.variants[0].targets[1].targetId = 'source-M'; expect(() => validateDuplicateGroup(cyclic)).toThrow();
  });
});
