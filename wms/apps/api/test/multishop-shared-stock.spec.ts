import { describe, expect, it } from 'vitest';
import { allocateShopStock, planShopTransition, validateShopGroups, type ShopGroup } from '../src/modules/marketplace-connections/multishop-stock-plan';

const group: ShopGroup = { id: 'pair', name: 'Pair', warehouseId: 'msk', lowStockThreshold: 2,
  mode: 'SHARED', safetyReserve: 0,
  members: [{ connectionId: 'wb', percent: 50, priority: 0 }, { connectionId: 'ozon', percent: 50, priority: 1 }] };
describe('shared shop stock mode', () => {
  // TEST: the same physical budget is shown in every selected cabinet, never added together.
  it('publishes 20 in both shops and 19 after one common reservation', () => {
    expect(allocateShopStock(20, group).map(r => r.amount)).toEqual([20, 20]);
    expect(allocateShopStock(19, group).map(r => r.amount)).toEqual([19, 19]);
  });
  it('applies the safety reserve once before mirroring', () => {
    expect(allocateShopStock(20, { ...group, safetyReserve: 3 }).map(r => r.amount)).toEqual([17, 17]);
    expect(allocateShopStock(2, { ...group, safetyReserve: 3 }).map(r => r.amount)).toEqual([0, 0]);
  });
  it('protects the last units in the priority shop', () => {
    expect(allocateShopStock(4, { ...group, safetyReserve: 2 }).map(r => r.amount)).toEqual([2, 0]);
    expect(allocateShopStock(1, { ...group, members: [{ ...group.members[0], priority: 2 }, group.members[1]] }).map(r => r.amount)).toEqual([0, 1]);
  });
  it('ignores percentage values in shared mode, but validates them for allocated mode', () => {
    const shared = { ...group, members: group.members.map(m => ({ ...m, percent: 0 })) };
    expect(allocateShopStock(10, shared).map(r => r.amount)).toEqual([10, 10]);
    expect(() => allocateShopStock(10, { ...shared, mode: 'ALLOCATED' })).toThrow();
  });
  it('keeps legacy groups allocated with no reserve', () => {
    const { mode, safetyReserve, ...legacy } = group;
    expect(allocateShopStock(20, legacy).map(r => r.amount)).toEqual([10, 10]);
  });
  it('rejects unknown modes and malformed reserves', () => {
    for (const patch of [{ mode: 'OTHER' }, { safetyReserve: -1 }, { safetyReserve: 1.5 }, { mode: null }, { safetyReserve: null }]) {
      expect(() => allocateShopStock(20, { ...group, ...patch } as ShopGroup)).toThrow();
    }
  });
  it('keeps the one-group-per-SKU invariant for shared mode', () => {
    expect(() => validateShopGroups([group], [{ skuId: 'sku', groupId: 'pair' }, { skuId: 'sku', groupId: 'pair' }], group.members.map(m => ({ id: m.connectionId, warehouseId: 'msk' })))).toThrow();
  });
  it('permits mirroring only with an explicit shared policy', () => {
    expect(planShopTransition(20, { wb: 0, ozon: 0 }, { wb: 20, ozon: 20 }, 'SHARED').phase).toBe('INCREASE');
    expect(() => planShopTransition(20, { wb: 0, ozon: 0 }, { wb: 20, ozon: 20 })).toThrow();
    expect(() => planShopTransition(20, { wb: 0, ozon: 0 }, { wb: 21, ozon: 20 }, 'SHARED')).toThrow();
  });
  it('decreases both shops after a reservation and zeros removed shops before increasing', () => {
    expect(planShopTransition(19, { wb: 20, ozon: 20 }, { wb: 19, ozon: 19 }, 'SHARED')).toEqual({ phase: 'DECREASE', writes: [{ destination: 'ozon', amount: 19 }, { destination: 'wb', amount: 19 }] });
    expect(planShopTransition(19, { old: 20, wb: 0 }, { wb: 19 }, 'SHARED')).toEqual({ phase: 'DECREASE', writes: [{ destination: 'old', amount: 0 }] });
  });
});
