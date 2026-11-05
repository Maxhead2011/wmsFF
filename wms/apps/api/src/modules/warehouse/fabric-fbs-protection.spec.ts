import { describe, it, expect } from 'vitest';
import { reserveFabric, FabricLedger } from './fabric-fbs-ledger';
import { freeFabricMm, assertFabricMutationPreservesReservations, fabricCreditMatches } from './fabric-fbs-protection';

function reserved(): FabricLedger {
  return reserveFabric({ rolls: [{ id: 'r', warehouseId: 'w', material: 'SATIN', color: 'white', remainingMm: 10000, cutMm: 0, createdAt: '2026-11-05' }] },
    { key: 'k', skuId: 's', warehouseId: 'w', material: 'SATIN', color: 'white', lengthMm: 3000, units: 2 });
}
describe('fabric commitments against other writers', () => {
  // TEST: manual cuts, adjustments and automatic shipment may spend only free metres.
  it('reports only unreserved material with the assignment flag off too', () => {
    expect(freeFabricMm(reserved(), 'r')).toBe(4000);
  });
  it.each([0, 5000])('rejects another writer leaving %s millimetres', mm => {
    const before = reserved(), after = structuredClone(before); after.rolls[0].remainingMm = mm;
    expect(() => assertFabricMutationPreservesReservations(before, after)).toThrow('зарезервированы');
  });
  it('allows spending all free length', () => {
    const before = reserved(), after = structuredClone(before); after.rolls[0].remainingMm = 6000;
    expect(() => assertFabricMutationPreservesReservations(before, after)).not.toThrow();
  });
  it('does not let a manual writer erase reservations', () => {
    const before = reserved(), after = structuredClone(before); after.fbsReservations = [];
    expect(() => assertFabricMutationPreservesReservations(before, after)).toThrow('вне операции');
  });
  it('protects a roll from write-off even if remaining length was left unchanged', () => {
    const before = reserved(), after = structuredClone(before); after.rolls[0].writtenOffAt = 'now';
    expect(() => assertFabricMutationPreservesReservations(before, after)).toThrow('зарезервированы');
  });
  const credit = { key: 'cut', skuId: 's', warehouseId: 'w', mm: 6000, marketplace: 'OZON', connectionId: 'c', orderId: 'o', taskId: 'task', requestId: 'request' };
  it('accepts production only for its own shipment', () => expect(fabricCreditMatches(credit, credit)).toBe(true));
  it.each(['skuId', 'warehouseId', 'marketplace', 'connectionId', 'orderId', 'taskId', 'requestId'])('rejects another %s', field => {
    expect(fabricCreditMatches(credit, { ...credit, [field]: 'other' })).toBe(false);
  });
});
