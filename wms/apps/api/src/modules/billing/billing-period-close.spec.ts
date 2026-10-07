import { describe, expect, it } from 'vitest';
import { buildPeriodClosePlan } from './billing-period-close.policy';
const input = { clientId: 'c', warehouseId: 'w', periodFrom: '2026-09-01', periodTo: '2026-09-30' };
const client = { id: 'c', code: 'CL-TEST', name: 'Клиент' }, date = new Date('2026-09-10');
const item = { id: 'line', chargeId: 'ch', description: 'Услуга', unit: 'PIECE', quantity: '1', unitPriceRub: '100', totalRub: '100', serviceDate: date };
const invoice = { id: 'i', number: 'INV-TEST', clientId: 'c', client, warehouseId: 'w', periodFrom: date, periodTo: date,
  status: 'ISSUED', paidRub: '0', totalRub: '100', payments: [], updatedAt: date, items: [item] };
const charge = { id: 'ch', clientId: 'c', client, status: 'APPROVED', description: 'Услуга', unit: 'PIECE', quantity: '1', unitPriceRub: '100', totalRub: '100', serviceDate: date,
  updatedAt: date, metadata: { warehouseId: 'w' }, invoiceItems: [{ invoice: { id: 'i', status: 'ISSUED' } }] };
// TEST: closing completed calculations must preserve receivables, scope and a stable financial snapshot.
describe('period close readiness', () => {
  it('allows unpaid issued debt and keeps the snapshot stable after a partial or full payment', () => {
    const plan = buildPeriodClosePlan(input, [charge], [invoice]);expect(plan.canClose).toBe(true);
    expect(buildPeriodClosePlan(input, [charge], [{ ...invoice, paidRub: '45' }]).previewHash).toBe(plan.previewHash);
    expect(buildPeriodClosePlan(input, [charge], [{ ...invoice, paidRub: '100', status: 'PAID' }]).previewHash).toBe(plan.previewHash);
    expect(plan.snapshots[0].totalRub).toBe('100');
  });
  it('blocks drafts, unbilled services and work without accrual, even when all amounts are zero', () => {
    expect(buildPeriodClosePlan(input, [charge], [{ ...invoice, status: 'DRAFT' }]).canClose).toBe(false);
    expect(buildPeriodClosePlan(input, [{ ...charge, invoiceItems: [] }], []).canClose).toBe(false);
    expect(buildPeriodClosePlan(input, [], [], [{ sourceId: 'work', code: 'WORK_WITHOUT_CHARGE', reason: 'Нет начисления.' }]).canClose).toBe(false);
  });
  it('never trusts a charge link without the actual invoice and detects snapshot changes', () => {
    expect(buildPeriodClosePlan(input, [charge], []).canClose).toBe(false);
    expect(buildPeriodClosePlan(input, [charge], [{ ...invoice, items: [{ ...item, description: 'Другая услуга' }] }]).previewHash)
      .not.toBe(buildPeriodClosePlan(input, [charge], [invoice]).previewHash);
    expect(buildPeriodClosePlan(input, [], [{ ...invoice, totalRub: '101' }]).canClose).toBe(false);
  });
  it('keeps other clients and known branches outside the closure and rejects unknown branches', () => {
    expect(buildPeriodClosePlan(input, [{ ...charge, clientId: 'other' }], [{ ...invoice, clientId: 'other' }]).snapshots).toEqual([]);
    expect(buildPeriodClosePlan(input, [], [{ ...invoice, warehouseId: 'other' }]).snapshots).toEqual([]);
    expect(buildPeriodClosePlan(input, [], [{ ...invoice, warehouseId: null }]).canClose).toBe(false);
  });
  // TEST: totals alone cannot hide duplicate source lines or missing tariffs.
  it('blocks duplicated accruals and invalid tariff lines', () => {
    expect(buildPeriodClosePlan(input, [], [invoice, { ...invoice, id: 'duplicate', number: 'INV-DUPLICATE' }]).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATE_CHARGE' })]));
    expect(buildPeriodClosePlan(input, [], [{ ...invoice, items: [{ ...item, unitPriceRub: '0' }] }]).canClose).toBe(false);
    expect(() => buildPeriodClosePlan({ ...input, periodFrom: '2026-02-30' }, [], [])).toThrow(/даты/);
  });
});
