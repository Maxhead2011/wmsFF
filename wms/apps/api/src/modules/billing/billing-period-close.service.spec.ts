import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BillingPeriodCloseService } from './billing-period-close.service';
import { ClientScopeService } from '../auth/client-scope.service';
const user: any = { id: 'u', permissionCodes: ['billing:read', 'billing:write'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [], activeWarehouseId: 'w', warehouseIds: ['w'], writableWarehouseIds: ['w'] };
const query = { clientId: 'c', periodFrom: '2026-09-01', periodTo: '2026-09-30' };
function setup() {
  const invoice: any = { id: 'i', number: 'INV-TEST', clientId: 'c', warehouseId: 'w', request: null, client: { id: 'c', name: 'Клиент', code: 'CL', isDemo: false },
    status: 'ISSUED', totalRub: '100', paidRub: '45', issuedAt: new Date('2026-09-20'), paidAt: null, payments: [{ amountRub: '45', paidAt: new Date('2026-09-25') }],
    periodFrom: new Date('2026-09-01'), periodTo: new Date('2026-09-30'), items: [{ id: 'l', chargeId: null, description: 'Услуга', unit: 'SERVICE', quantity: '1', unitPriceRub: '100', totalRub: '100', serviceDate: new Date('2026-09-20') }] };
  const closes: any[] = [], corrections: any[] = [];
  const db: any = { $executeRaw: vi.fn().mockResolvedValue(0), client: { findUnique: vi.fn().mockResolvedValue({ isDemo: false }) }, billingCharge: { findMany: vi.fn().mockResolvedValue([]) },
    billingInvoice: { findMany: vi.fn(async () => [invoice]), findUnique: vi.fn(async () => invoice), update: vi.fn(async ({ data }: any) => Object.assign(invoice, data)) },
    auditLog: { create: vi.fn() }, $queryRaw: vi.fn(async (q: any, ...parameters: any[]) => {
      const text = q.text ?? [...q].join('?');
      const values = Array.isArray(q) ? parameters : q.values;
      if (text.includes('INSERT INTO "BillingPeriodClose"')) { const v = q.values; const row = { id: v[0], clientId: v[1], warehouseId: v[2], periodFrom: v[3], periodTo: v[4], previewHash: v.at(-3) }; closes.push(row); return [row]; }
      if (text.includes('FROM "BillingPeriodClose"')) return closes;
      if (text.includes('INSERT INTO "BillingInvoiceCorrection"')) { const v = q.values, row = { id: v[0], invoiceId: v[1], amountRub: v[2], kind: v[3], reason: v[4], operationKey: v[5], createdAt: new Date(), createdByUserId: v[6] }; corrections.push(row); return [row]; }
      if (text.includes('FROM "BillingInvoiceCorrection"')) return text.includes('operationKey') ? corrections.filter(c => c.operationKey === values[0]) : corrections;
      return [];
    }) };
  db.$transaction = vi.fn((fn: any) => fn(db));
  const settlements: any = { list: vi.fn().mockResolvedValue({ enabled: true, rows: [], issues: [] }) };
  return { db, invoice, closes, corrections, settlements, service: new BillingPeriodCloseService(db, new ClientScopeService(), settlements) };
}
// TEST: monetary amendments and closure have current-scope checks, stale-preview protection and durable retry identities.
describe('period close and correction transactions', () => {
  beforeEach(() => { vi.stubEnv('WMS_BILLING_PERIOD_CLOSE_ENABLED', 'true'); vi.stubEnv('WMS_BILLING_SETTLEMENTS_ENABLED', 'true'); });
  afterEach(() => vi.unstubAllEnvs());
  it('closes an unpaid period once and replays without changing payments or original totals', async () => {
    const s = setup(), plan = await s.service.preview(query, user);
    expect(plan.canClose).toBe(true);
    const dto = { ...query, reason: 'Услуги проверены', previewHash: plan.previewHash };
    await s.service.close(dto, user);expect((await s.service.close(dto, user)).replayed).toBe(true);
    expect(s.closes).toHaveLength(1);expect(s.db.billingInvoice.update).not.toHaveBeenCalled();expect(s.invoice.paidRub).toBe('45');
  });
  it('rejects stale close and unresolved work without writing a close record', async () => {
    const s = setup();await expect(s.service.close({ ...query, reason: 'Проверено', previewHash: '0'.repeat(64) }, user)).rejects.toThrow(/изменился/);
    s.settlements.list.mockResolvedValue({ enabled: true, rows: [], issues: [{ clientId: 'c', warehouseId: 'w', line: { id: 'work' }, code: 'WORK_WITHOUT_CHARGE', reason: 'Нет начисления' }] });
    expect((await s.service.preview(query, user)).canClose).toBe(false);expect(s.closes).toHaveLength(0);
  });
  it('reduces a partly paid invoice, shows overpayment and replays exactly once', async () => {
    const s = setup(), dto = { invoiceId: 'i', amountRub: '-75', reason: 'Исправление ошибочной услуги' }, plan = await s.service.previewCorrection(dto, user);
    expect(plan.after).toMatchObject({ effectiveTotalRub: 25, remainingRub: 0, overpaymentRub: 20 });
    const create = { ...dto, previewHash: plan.previewHash, operationKey: 'op' };
    await s.service.createCorrection(create, user);expect((await s.service.createCorrection(create, user)).replayed).toBe(true);
    expect(s.corrections).toHaveLength(1);expect(s.invoice).toMatchObject({ totalRub: '100', paidRub: '45', status: 'PAID' });
    await expect(s.service.createCorrection({ ...create, amountRub: '-70' }, user)).rejects.toThrow(/Ключ/);
  });
  it('rejects changed payments and cross-branch attempts before monetary writes', async () => {
    const s = setup(), dto = { invoiceId: 'i', amountRub: '25', reason: 'Дополнительная услуга' }, plan = await s.service.previewCorrection(dto, user);
    s.invoice.paidRub = '50';s.invoice.payments[0].amountRub = '50';
    await expect(s.service.createCorrection({ ...dto, previewHash: plan.previewHash, operationKey: 'op' }, user)).rejects.toThrow(/изменились/);
    s.invoice.warehouseId = 'other';await expect(s.service.previewCorrection(dto, user)).rejects.toThrow(/филиале/);
    expect(s.corrections).toHaveLength(0);expect(s.db.billingInvoice.update).not.toHaveBeenCalled();
  });
  it('has no read or mutation side effects when the rollout is disabled', async () => {
    const s = setup();vi.stubEnv('WMS_BILLING_PERIOD_CLOSE_ENABLED', 'false');
    await expect(s.service.preview(query, user)).rejects.toThrow(/не включено/);expect(s.db.$transaction).not.toHaveBeenCalled();
  });
  // TEST: a surcharge reopens only the remaining debt, never the original amount or recorded receipts.
  it('adds debt to a paid invoice and denies retry after write permission is revoked', async () => {
    const s = setup();s.invoice.status = 'PAID';s.invoice.paidRub = '100';s.invoice.payments[0].amountRub = '100';
    const dto = { invoiceId: 'i', amountRub: '25.50', reason: 'Дополнительная обработка' };
    const plan = await s.service.previewCorrection(dto, user);
    expect(plan.after).toMatchObject({ effectiveTotalRub: 125.5, remainingRub: 25.5, overpaymentRub: 0 });
    const create = { ...dto, previewHash: plan.previewHash, operationKey: 'increase' };
    await s.service.createCorrection(create, user);
    expect(s.invoice).toMatchObject({ totalRub: '100', paidRub: '100', status: 'ISSUED' });
    await expect(s.service.createCorrection(create, { ...user, permissionCodes: ['billing:read'] })).rejects.toThrow();
    expect(s.corrections).toHaveLength(1);
  });
  // TEST: legacy issued documents without issuedAt retain their original metadata after amendment.
  it('preserves a missing legacy issue timestamp and issues late work with a separate reason', async () => {
    const s = setup();s.invoice.issuedAt = null;
    const dto = { invoiceId: 'i', amountRub: '1', reason: 'Дополнительная услуга' };
    const plan = await s.service.previewCorrection(dto, user);
    await s.service.createCorrection({ ...dto, previewHash: plan.previewHash, operationKey: 'legacy' }, user);
    expect(s.invoice.issuedAt).toBeNull();
    const late = setup();late.invoice.status = 'DRAFT';late.invoice.issuedAt = null;late.invoice.paidRub = '0';late.invoice.payments = [];
    late.closes.push({ invoiceIds: ['original'] });
    const input = { invoiceId: 'i', amountRub: '0', reason: 'Поздно подтверждённая обработка', kind: 'LATE_WORK' as const };
    const preview = await late.service.previewCorrection(input, user);
    const create = { ...input, previewHash: preview.previewHash, operationKey: 'late' };
    await late.service.createCorrection(create, user);
    expect((await late.service.createCorrection(create, user)).replayed).toBe(true);
    expect(late.invoice).toMatchObject({ status: 'ISSUED', totalRub: '100', paidRub: '0', issuedAt: expect.any(Date) });
    expect(late.corrections).toHaveLength(1);expect(late.corrections[0]).toMatchObject({ kind: 'LATE_WORK', amountRub: '0', reason: input.reason });
  });
});
