import { describe, it, expect } from 'vitest';
import { FabricDemand, FabricLedger, reserveFabric, reservedFabricMm, confirmFabricCut, releaseUncutFabric } from './fabric-fbs-ledger';

// TEST: no finished-stock balance is required for the material reservation.
const demand: FabricDemand = { key: 'ozon:connection:order:line:1', warehouseId: 'w', material: 'SATIN', color: 'black', skuId: 'sku', lengthMm: 3000, units: 2 };
function ledger(mm = 100000): FabricLedger {
  return { rolls: [{ id: 'r', warehouseId: 'w', material: 'SATIN', color: 'black', remainingMm: mm, cutMm: 0, createdAt: '2026-10-30' }] };
}
describe('fabric FBS ledger', () => {
  // TEST: corrupt or duplicated persisted rows must never mint material capacity.
  it('rejects duplicate roll identifiers', () => {
    const s = ledger(3000); s.rolls.push({ ...s.rolls[0] });
    expect(() => reserveFabric(s, demand)).toThrow('Invalid fabric ledger');
  });
  it('rejects a lost allocated unit instead of confirming production without debit', () => {
    const s = reserveFabric(ledger(), demand); s.fbsReservations![0].rollIds.pop();
    expect(() => confirmFabricCut(s, demand.key, 2, 'op')).toThrow('Invalid fabric ledger');
  });
  it('rejects corrupt cut counter before debit', () => {
    const s = reserveFabric(ledger(), demand); s.rolls[0].cutMm = NaN;
    expect(() => confirmFabricCut(s, demand.key, 1, 'op')).toThrow('Invalid fabric ledger');
  });
  // TEST: a later correction must not let this cut consume another order's reserve.
  it('rejects cutting an overcommitted roll without altering either order', () => {
    let s = reserveFabric(ledger(12000), demand);
    s = reserveFabric(s, { ...demand, key: 'other-order' });
    s.rolls[0].remainingMm = 9000;
    const before = JSON.stringify(s);
    expect(() => confirmFabricCut(s, demand.key, 2, 'op')).toThrow('Reserved fabric unavailable');
    expect(JSON.stringify(s)).toBe(before);
  });
  it('reserves without changing physical material or input', () => {
    const input = ledger(); const result = reserveFabric(input, demand);
    expect(reservedFabricMm(result, 'r')).toBe(6000);
    expect(result.rolls[0].remainingMm).toBe(100000);
    expect(input.fbsReservations).toBeUndefined();
    expect(reserveFabric(result, demand)).toEqual(result);
  });
  it('shares capacity across different cut SKUs', () => {
    const s = reserveFabric(ledger(10000), demand);
    expect(() => reserveFabric(s, { ...demand, key: 'second', skuId: 'sku5', lengthMm: 5000, units: 1 })).toThrow('Insufficient');
  });
  it('does not join scraps into one continuous cut', () => {
    const s = ledger(3000); s.rolls.push({ ...s.rolls[0], id: 'other', remainingMm: 2000 });
    expect(() => reserveFabric(s, { ...demand, lengthMm: 5000, units: 1 })).toThrow('Insufficient');
  });
  it.each(['warehouseId', 'material', 'color'] as const)('isolates %s', field => {
    expect(() => reserveFabric(ledger(), { ...demand, [field]: 'other' })).toThrow('Insufficient');
  });
  it('debits only the confirmed delta and deduplicates retries', () => {
    const s = reserveFabric(ledger(), demand);
    const one = confirmFabricCut(s, demand.key, 1, 'op1');
    expect(one.cutMm).toBe(3000);
    expect(reservedFabricMm(one.state, 'r')).toBe(3000);
    expect(confirmFabricCut(one.state, demand.key, 1, 'op1').cutMm).toBe(0);
    expect(confirmFabricCut(one.state, demand.key, 1, 'other').cutMm).toBe(0);
    const two = confirmFabricCut(one.state, demand.key, 2, 'op2');
    expect(two.cutMm).toBe(3000);
    expect(two.state.rolls[0].remainingMm).toBe(94000);
    expect(s.rolls[0].remainingMm).toBe(100000);
    expect(() => confirmFabricCut(two.state, demand.key, 2, 'op1')).toThrow('payload');
  });
  it('cancellation releases uncut length without undoing production', () => {
    const s = confirmFabricCut(reserveFabric(ledger(), demand), demand.key, 1, 'op').state;
    const cancelled = releaseUncutFabric(s, demand.key);
    expect(reservedFabricMm(cancelled, 'r')).toBe(0);
    expect(cancelled.rolls[0].remainingMm).toBe(97000);
    expect(() => confirmFabricCut(cancelled, demand.key, 2, 'next')).toThrow('changed');
    expect(confirmFabricCut(cancelled, demand.key, 1, 'op').replay).toBe(true);
  });
  it('rejects changed order composition and excessive confirmation', () => {
    const s = reserveFabric(ledger(), demand);
    expect(() => reserveFabric(s, { ...demand, units: 3 })).toThrow('conflict');
    expect(() => confirmFabricCut(s, demand.key, 3, 'op')).toThrow('quantity');
  });
  it('does not mutate ledger when physical material is missing', () => {
    const s = reserveFabric(ledger(), demand); s.rolls[0].remainingMm = 4000;
    const before = JSON.stringify(s);
    expect(() => confirmFabricCut(s, demand.key, 2, 'op')).toThrow('unavailable');
    expect(JSON.stringify(s)).toBe(before);
  });
});
