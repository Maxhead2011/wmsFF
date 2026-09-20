import { describe, expect, it } from 'vitest';
import { planHistoricalPacking } from '../src/common/stock/historical-packing';

const cutoff = new Date('2026-09-20T00:00:00+03:00');
const balance = { id: 'balance', warehouseId: 'moscow', clientId: 'client', skuId: 'sku', boxId: null, palletId: null, quantity: 44 };
const request = (id: string, status = 'DONE') => ({ id, number: 1, status, type: 'OUTBOUND', warehouseId: 'moscow', clientId: 'client' });
const movement = (id: string, doc: string, quantity: number, date = '2026-09-10T10:00:00Z') => ({ id, sourceDocument: doc, quantity, createdAt: new Date(date), idempotencyKey: null });

// TEST: reproduction of the 44 legacy units; only PACKING is corrected once.
describe('historical packing plan', () => {
  it('corrects old DONE residue while protecting today, active and cancelled requests', () => {
    const m = [movement('old', 'done', 44), movement('new', 'today', 3, '2026-09-19T21:00:00Z'),
      movement('active', 'active', 2), movement('cancel', 'cancel', 1)];
    const r = [request('done'), request('today'), request('active', 'IN_WORK'), request('cancel', 'CANCELLED')];
    const plan = planHistoricalPacking({ ...balance, quantity: 50 }, m, r, [], cutoff);
    expect(plan.quantity).toBe(44);
    expect(plan.after).toBe(6);
    expect(plan.debits).toEqual([{ requestId: 'done', number: 1, quantity: 44 }]);
    expect(planHistoricalPacking({ ...balance, quantity: 6 }, [...m, movement('repair', 'done', -44, '2026-09-20')], r, [], cutoff).quantity).toBe(0);
  });
  it('absorbs all unassigned deductions from old DONE units before protecting live stock', () => {
    const m = [movement('a', 'done', 44), movement('b', 'unknown', -4), movement('c', 'active', 3)];
    const plan = planHistoricalPacking({ ...balance, quantity: 43 }, m, [request('done'), request('active', 'PACKED')], [], cutoff);
    expect(plan.quantity).toBe(40); expect(plan.after).toBe(3);
  });
  it('does not borrow active stock when corrections exceed old DONE stock', () => {
    expect(planHistoricalPacking({ ...balance, quantity: 1 }, [movement('a', 'done', 2), movement('b', 'unknown', -4), movement('c', 'active', 3)],
      [request('done'), request('active', 'PACKED')], [], cutoff).quantity).toBe(0);
  });
  it('protects a mixed-date request in its entirety', () => {
    expect(planHistoricalPacking({ ...balance, quantity: 2 }, [movement('a', 'done', 1), movement('b', 'done', 1, cutoff.toISOString())],
      [request('done')], [], cutoff).quantity).toBe(0);
  });
  it.each(['other', null])('rejects missing or transferred assembly ownership: %s', owner => {
    const m = [{ ...movement('a', 'done', 44), idempotencyKey: 'fbs-sticker-pick:task:in' }];
    expect(planHistoricalPacking(balance, m, [request('done')], owner ? [{ id: 'task', requestId: owner, updatedAt: cutoff }] : [], cutoff).quantity).toBe(0);
  });
  it('rejects mismatched ledger and protects a different warehouse', () => {
    expect(() => planHistoricalPacking(balance, [movement('a', 'done', 43)], [request('done')], [], cutoff)).toThrow('differs');
    expect(planHistoricalPacking(balance, [movement('a', 'done', 44)], [{ ...request('done'), warehouseId: 'other' }], [], cutoff).quantity).toBe(0);
  });
  it('invalidates a reviewed plan after a request status change', () => {
    const m = [movement('a', 'done', 44)];
    expect(planHistoricalPacking(balance, m, [request('done')], [], cutoff).fingerprint)
      .not.toBe(planHistoricalPacking(balance, m, [request('done', 'IN_WORK')], [], cutoff).fingerprint);
  });
  // TEST: historical tasks may be deleted; exact immutable shipment proof remains authoritative.
  it('repairs a deleted task only with matching old shipment evidence', () => {
    const m = [{ ...movement('a', 'done', 44), idempotencyKey: 'fbs-sticker-pick:task:in' }];
    const proof = { assemblyId: 'task', requestId: 'done', clientId: 'client', warehouseId: 'moscow', skuId: 'sku', quantity: 44, shippedAt: new Date('2026-09-12') };
    expect(planHistoricalPacking(balance, m, [request('done')], [], cutoff, [proof]).quantity).toBe(44);
    expect(planHistoricalPacking(balance, m, [request('done')], [], cutoff, [{ ...proof, skuId: 'other' }]).quantity).toBe(0);
    expect(planHistoricalPacking(balance, m, [request('done')], [], cutoff, [{ ...proof, shippedAt: cutoff }]).quantity).toBe(0);
    expect(planHistoricalPacking(balance, m, [request('done')], [], cutoff, [{ ...proof, quantity: 43 }]).quantity).toBe(0);
    expect(planHistoricalPacking(balance, m, [request('done')], [{ id: 'task', requestId: 'active', updatedAt: cutoff }], cutoff, [proof]).quantity).toBe(0);
  });
});
