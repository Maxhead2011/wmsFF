import { describe, expect, it } from 'vitest';
import { allocateShopStock, validateShopGroups, planShopTransition } from '../src/modules/marketplace-connections/multishop-stock-plan';

// TEST: one physical SKU has one budget across all shops, including exclusive pairs.
const members = [
  { connectionId: 'wb1', percent: 50, priority: 0 },
  { connectionId: 'ozon1', percent: 50, priority: 1 },
];
const group = { id: 'pair1', warehouseId: 'warehouse', name: 'Первая пара', lowStockThreshold: 2, members };
describe('multi-shop physical stock plan', () => {
  it('conserves every unit and never includes another pair', () => {
    for (let amount = 0; amount < 1000; amount++) {
      const rows = allocateShopStock(amount, group);
      expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(amount);
      expect(rows.map(row => row.connectionId)).toEqual(['wb1', 'ozon1']);
    }
  });
  it('uses low-stock priority, excluding zero-percent shops', () => {
    expect(allocateShopStock(2, group).map(row => row.amount)).toEqual([2, 0]);
    expect(allocateShopStock(2, { ...group, members: [{ ...members[0], percent: 0 }, { ...members[1], percent: 100 }] }).map(row => row.amount)).toEqual([0, 2]);
  });
  it('uses exact arithmetic at the safe-integer boundary', () => {
    const rows = allocateShopStock(Number.MAX_SAFE_INTEGER, group);
    expect(rows.reduce((sum, row) => BigInt(row.amount) + sum, 0n)).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });
  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid stock %s', value => {
    expect(() => allocateShopStock(value, group)).toThrow();
  });
  it('rejects overlapping SKU assignment, foreign shops and mixed warehouses', () => {
    const connections = members.map(m => ({ id: m.connectionId, warehouseId: 'warehouse' }));
    expect(() => validateShopGroups([group], [{ skuId: 'sku', groupId: group.id }], connections)).not.toThrow();
    expect(() => validateShopGroups([group], [{ skuId: 'sku', groupId: group.id }, { skuId: 'sku', groupId: group.id }], connections)).toThrow();
    expect(() => validateShopGroups([group], [], connections.slice(1))).toThrow();
    expect(() => validateShopGroups([group], [], connections.map(c => ({ ...c, warehouseId: 'other' })))).toThrow();
  });
  it('rejects duplicate shops and invalid shares even when stock is zero', () => {
    expect(() => allocateShopStock(0, { ...group, members: [members[0], members[0]] })).toThrow();
    expect(() => allocateShopStock(0, { ...group, members: [{ ...members[0], percent: 99 }] })).toThrow();
  });
  it('reduces old shops before increasing a new pair', () => {
    expect(planShopTransition(10, { wb1: 5, ozon1: 5, wb2: 0, ozon2: 0 }, { wb2: 5, ozon2: 5 })).toEqual({
      phase: 'DECREASE', writes: [{ destination: 'ozon1', amount: 0 }, { destination: 'wb1', amount: 0 }],
    });
    expect(planShopTransition(10, { wb1: 0, ozon1: 0, wb2: 0, ozon2: 0 }, { wb2: 5, ozon2: 5 }).phase).toBe('INCREASE');
  });
  it('blocks increases with missing or unknown observations, including removed shops', () => {
    expect(planShopTransition(10, { wb1: null, wb2: 0 }, { wb2: 10 }).phase).toBe('VERIFY');
    expect(planShopTransition(10, { wb1: 0 }, { wb2: 10 }).phase).toBe('VERIFY');
  });
  it('rejects over-allocation and reaches a stable done state', () => {
    expect(() => planShopTransition(9, { wb1: 0 }, { wb1: 10 })).toThrow();
    expect(planShopTransition(10, { wb1: 10 }, { wb1: 10 })).toEqual({ phase: 'DONE', writes: [] });
  });
});
