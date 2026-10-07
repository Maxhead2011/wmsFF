import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildSettlements } from './billing-settlements.policy';
import { BillingSettlementsService, settlementDates } from './billing-settlements.service';
import { ClientScopeService } from '../auth/client-scope.service';

const client = { id: 'c1', code: 'CL1', name: 'Клиент' };
const charge = (extra: any = {}) => ({ id: 'ch1', clientId: client.id, client, requestId: 'r1',
  request: { id: 'r1', number: 1244, warehouseId: 'w1' }, status: 'APPROVED', description: 'Обработка',
  quantity: '2', unitPriceRub: '50', totalRub: '100', serviceDate: new Date('2026-10-01T10:00:00Z'),
  service: { code: 'FBS_PROCESSING' }, metadata: { kind: 'FBS', marketplace: 'WILDBERRIES', connectionId: 'cab1', orderIds: ['123'] },
  invoiceItems: [], ...extra });
const invoice = (extra: any = {}) => ({ id: 'i1', clientId: client.id, client, warehouseId: 'w1', number: 'СЧ1',
  status: 'ISSUED', totalRub: '100', paidRub: '25', dueDate: new Date('2026-09-30T00:00:00Z'),
  items: [{ chargeId: 'ch1', description: 'Обработка', quantity: '2', unitPriceRub: '50', totalRub: '100', serviceDate: new Date('2026-10-01T10:00:00Z') }], ...extra });
const work = (extra: any = {}) => ({ id: 'a1', clientId: 'c1', requestId: 'r1', marketplace: 'WILDBERRIES',
  connectionId: 'cab1', orderId: '123', itemCount: 2, completedAt: new Date('2026-10-01T10:00:00Z'), ...extra });
function report(extra: any = {}) { return buildSettlements({ warehouseId: 'w1', warehouseName: 'Москва',
  from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-31T23:59:59.999Z'), now: new Date('2026-10-02T00:00:00Z'),
  clients: [client], charges: [], invoices: [], advances: [], work: [], requests: [{ id: 'r1', number: 1244, warehouseId: 'w1' }], ...extra }); }

// TEST: money categories remain disjoint; a draft is not a receivable or a second unbilled charge.
describe('settlements accounting', () => {
  // TEST: signed notes preserve invoice details and actual receipts, exposing overpayment separately from advances.
  it('projects reductions, overpayment and new debt without changing the original invoice amount', () => {
    const note = { id: 'credit', invoiceId: 'i1', amountRub: '-90', reason: 'Ошибочная услуга', createdAt: new Date('2026-10-03') };
    const reduced = report({ invoices: [invoice()], corrections: [note] });
    expect(reduced.rows[0]).toMatchObject({ debtRub: 0, clientCreditRub: 15, clientAdvanceRub: 0 });
    expect(reduced.issues).toEqual([]);
    expect(reduced.rows[0].lines.find(l => l.kind === 'CORRECTION')?.totalRub).toBe(-90);
    const increased = report({ invoices: [invoice({ status: 'PAID', paidRub: 100 })], corrections: [{ ...note, amountRub: '20' }] });
    expect(increased.rows[0]).toMatchObject({ debtRub: 20, clientCreditRub: 0 });
  });
  // TEST: active and archived clients with only settled documents/advances must not inflate the register.
  it('omits settled and advance-only clients, including archived clients', () => {
    const archived = { ...client, id: 'archived', name: 'Архивный', status: 'ARCHIVED' };
    const payments = [{ id: 'paid', amountRub: 100, paidAt: new Date() }];
    const result = report({ clients: [client, archived], invoices: [invoice({ status: 'ISSUED', paidRub: 100, payments }),
      invoice({ id: 'archived-invoice', clientId: archived.id, client: archived, status: 'PAID', paidRub: 100, payments })],
      advances: [{ id: 'a', clientId: client.id, amountRub: 500, paidAt: new Date() }, { id: 'b', clientId: archived.id, amountRub: 500, paidAt: new Date() }] });
    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([]);
  });
  // TEST: zero issued debt does not hide unbilled services, drafts, missing work or unresolved calculations.
  it('retains unfinished calculations and archived debt without subtracting advances', () => {
    const archived = { ...client, status: 'ARCHIVED' };
    const cases = [
      { charges: [charge()] },
      { invoices: [invoice({ status: 'DRAFT', paidRub: 0 })] },
      { work: [work()] },
      { charges: [charge({ totalRub: 0, unitPriceRub: 0 })] },
      { clients: [archived], invoices: [invoice({ client: archived })], advances: [{ id: 'a', clientId: client.id, amountRub: 1000, paidAt: new Date() }] },
    ];
    for (const scenario of cases) expect(report(scenario).rows).toHaveLength(1);
    const debt = report(cases[4]).rows[0];
    expect(debt).toMatchObject({ debtRub: 75, overdueRub: 75, clientAdvanceRub: 1000 });
    expect(report().rows).toEqual([]);
  });
  it('excludes issued charges from unbilled and exposes remaining debt and overdue', () => {
    const r = report({ charges: [charge({ invoiceItems: [{ invoice: { id: 'i1', status: 'ISSUED' } }] })], invoices: [invoice()] });
    expect(r.rows[0]).toMatchObject({ unbilledRub: 0, draftRub: 0, debtRub: 75, overdueRub: 75 });
    expect(r.rows[0].lines[0].invoices[0].number).toBe('СЧ1');
  });
  it('counts a draft once and excludes cancelled invoices from coverage', () => {
    const r = report({ charges: [charge({ invoiceItems: [{ invoice: { id: 'i1', status: 'DRAFT' } }] })], invoices: [invoice({ status: 'DRAFT', paidRub: '0' })] });
    expect(r.rows[0]).toMatchObject({ unbilledRub: 0, draftRub: 100, debtRub: 0 });
    expect(report({ charges: [charge({ invoiceItems: [{ invoice: { id: 'i1', status: 'CANCELLED' } }] })] }).rows[0].unbilledRub).toBe(100);
  });
  it('keeps unknown branches out of Moscow amounts and ignores other branches', () => {
    const r = report({ charges: [charge({ request: null, metadata: {} }), charge({ id: 'other', request: { warehouseId: 'w2' } })] });
    expect(r.rows.find(x => x.warehouseId === 'w1')?.unbilledRub ?? 0).toBe(0);
    expect(r.issues.map(x => x.code)).toEqual(['UNKNOWN_BRANCH']);
  });
  it('reports zero tariff, manual arithmetic and duplicate invoice links', () => {
    const r = report({ charges: [charge({ unitPriceRub: 0 }), charge({ id: 'manual', totalRub: 120 }), charge({ id: 'dup', invoiceItems: [
      { invoice: { id: 'i1', status: 'ISSUED' } }, { invoice: { id: 'i2', status: 'DRAFT' } }] })] });
    expect(r.issues.map(x => x.code)).toEqual(expect.arrayContaining(['ZERO_TARIFF', 'AMOUNT_MISMATCH', 'DUPLICATE_INVOICE']));
    expect(r.rows[0].unbilledRub).toBe(0);
  });
  it('matches work by cabinet and attempt, retaining archived proof after reset', () => {
    const r = report({ charges: [charge()], work: [work(), work({ id: 'repeat', billingAttemptId: 'repeat1' }), work({ id: 'cab2', connectionId: 'cab2' })] });
    expect(r.issues.filter(x => x.code === 'WORK_WITHOUT_CHARGE')).toHaveLength(2);
    expect(r.rows[0].missingWorkCount).toBe(2);
    expect(r.rows[0].unbilledRub).toBe(100);
  });
  it('reports incomplete legacy identity as ambiguous, never as definitely unbilled', () => {
    const r = report({ charges: [charge({ metadata: { kind: 'FBS', orderIds: ['123'] } })], work: [work()] });
    expect(r.issues.map(x => x.code)).toContain('AMBIGUOUS_WORK_COVERAGE');
    expect(r.rows[0].missingWorkCount).toBe(0);
  });
  it('does not subtract client advance from a branch debt and uses integer cents', () => {
    const r = report({ invoices: [invoice()], advances: [{ clientId: 'c1', amountRub: '90', paidAt: new Date(), id: 'p1' }],
      charges: [charge({ id: 'small', quantity: 1, unitPriceRub: '0.10', totalRub: '0.10' }), charge({ id: 'small2', quantity: 1, unitPriceRub: '0.20', totalRub: '0.20' })] });
    expect(r.rows[0]).toMatchObject({ debtRub: 75, clientAdvanceRub: 90, unbilledRub: 0.3 });
  });
  it('preserves exact legacy shipment identity and paid invoice/payment details', () => {
    const r = report({ charges: [charge({ metadata: { kind: 'FBS', shipmentKey: 'WILDBERRIES:cab1:supply1', orderIds: ['123'] } })],
      invoices: [invoice({ status: 'PAID', paidRub: '100', payments: [{ id: 'p1', paidAt: new Date('2026-10-02'), amountRub: '100' }] })], work: [work()] });
    expect(r.issues.filter(i => i.code === 'WORK_WITHOUT_CHARGE')).toHaveLength(0);
    expect(r.rows[0].debtRub).toBe(0);
    expect(r.rows[0].lines.find(l => l.kind === 'INVOICE')?.payments?.[0].amountRub).toBe(100);
  });
  it('counts only selected service dates in a multi-month draft', () => {
    const r = report({ invoices: [invoice({ status: 'DRAFT', totalRub: 200, paidRub: 0, items: [invoice().items[0],
      { ...invoice().items[0], serviceDate: new Date('2026-09-01') }] })] });
    expect(r.rows[0].draftRub).toBe(100);
  });
  it('flags manual paid status without actual money records and inconsistent invoice lines', () => {
    const r = report({ invoices: [invoice({ status: 'PAID', paidRub: 100, totalRub: 120, payments: [] })] });
    expect(r.issues.map(i => i.code)).toEqual(expect.arrayContaining(['PAYMENT_MISMATCH', 'INVOICE_AMOUNT_MISMATCH']));
  });
});

// TEST: flag, client/warehouse scope and hard limits fail before returning misleading data.
describe('settlements access', () => {
  afterEach(() => { delete process.env.WMS_BILLING_SETTLEMENTS_ENABLED; });
  const user: any = { id: 'u', permissionCodes: ['billing:read'], clientScopeMode: 'LIMITED', clientIds: ['c1'], writableClientIds: [], activeWarehouseId: 'w1', warehouseIds: ['w1'] };
  it('does no database work when disabled, including the sold deployment', async () => {
    const db: any = { $transaction: vi.fn() };
    expect(await new BillingSettlementsService(db, new ClientScopeService()).list({ periodFrom: '2026-10-01', periodTo: '2026-10-02' }, user)).toEqual({ enabled: false });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects wrong branch and forbidden client before querying', async () => {
    process.env.WMS_BILLING_SETTLEMENTS_ENABLED = 'true';
    const db: any = { $transaction: vi.fn() };
    const s = new BillingSettlementsService(db, new ClientScopeService());
    await expect(s.list({ periodFrom: '2026-10-01', periodTo: '2026-10-02', clientId: 'c2' }, user)).rejects.toThrow();
    await expect(s.list({ periodFrom: '2026-10-01', periodTo: '2026-10-02' }, { ...user, activeWarehouseId: 'w2' })).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('validates calendar dates instead of normalizing invalid days', () => {
    expect(() => settlementDates('2026-02-30', '2026-03-02')).toThrow();
    expect(() => settlementDates('2026-10-03', '2026-10-02')).toThrow();
  });
  function setup() {
    const tx: any = { $executeRaw: vi.fn().mockResolvedValue(0),
      client: { findMany: vi.fn().mockResolvedValue([client]) }, warehouse: { findUnique: vi.fn().mockResolvedValue({ name: 'Москва' }) },
      billingCharge: { findMany: vi.fn().mockResolvedValue([charge()]) }, billingInvoice: { findMany: vi.fn().mockResolvedValue([]) },
      billingPayment: { findMany: vi.fn().mockResolvedValue([]) }, wbOrderShipment: { findMany: vi.fn().mockResolvedValue([]) },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) }, fbsAssemblyAttemptHistory: { findMany: vi.fn().mockResolvedValue([]) },
      clientRequest: { findMany: vi.fn().mockResolvedValue([{ id: 'r1', number: 1244, warehouseId: 'w1' }]) } };
    const db: any = { $transaction: vi.fn((fn: any) => fn(tx)) };
    return { tx, db, s: new BillingSettlementsService(db, new ClientScopeService()) };
  }
  // TEST: reading historical financial relations expires the transaction; lightweight coverage must still suppress false missing work.
  it('reads period financial details separately from historical FBS coverage without losing debt or advances', async () => {
    process.env.WMS_BILLING_SETTLEMENTS_ENABLED = 'true';
    const { tx, s } = setup();
    tx.billingCharge.findMany.mockImplementation(async (query: any) => {
      if (query.select.invoiceItems && !query.where.serviceDate) throw new Error('Historical financial query exceeded transaction timeout');
      if (query.select.invoiceItems) return [charge({ service: { code: 'PACKING' }, metadata: {} })];
      return [charge({ serviceDate: new Date('2026-09-01') })];
    });
    tx.billingInvoice.findMany.mockResolvedValue([invoice({ items: [{ ...invoice().items[0], serviceDate: new Date('2026-09-01') }] })]);
    tx.billingPayment.findMany.mockResolvedValue([{ id: 'advance', clientId: 'c1', amountRub: '90', paidAt: new Date() }]);
    tx.wbOrderShipment.findMany.mockResolvedValue([{ ...work(), assemblyId: 'a1', quantity: 2, shippedAt: work().completedAt, assemblySnapshot: {} }]);
    const result = await s.list({ periodFrom: '2026-10-01', periodTo: '2026-10-02' }, user);
    if (!result.enabled) throw new Error('Expected enabled register');
    expect(result.rows[0]).toMatchObject({ unbilledRub: 100, debtRub: 75, overdueRub: 75, clientAdvanceRub: 90, missingWorkCount: 0 });
    expect(result.issues.filter(i => i.code === 'WORK_WITHOUT_CHARGE')).toHaveLength(0);
    const queries = tx.billingCharge.findMany.mock.calls.map((call: any[]) => call[0]);
    const historical = queries.find((q: any) => !q.where.serviceDate);
    expect(historical.select.request).toBeUndefined();
    expect(historical.select.invoiceItems).toBeUndefined();
    expect(historical.where.OR).toEqual([{ metadata: { path: ['kind'], equals: 'FBS' } }, { service: { code: 'FBS_PROCESSING' } }]);
  });
  it('uses repeatable-read, read-only SQL and authorized client scope for every source', async () => {
    process.env.WMS_BILLING_SETTLEMENTS_ENABLED = 'true';
    const { tx, db, s } = setup();
    const result = await s.list({ periodFrom: '2026-10-01', periodTo: '2026-10-02' }, user);
    expect(result.enabled).toBe(true);
    expect(tx.$executeRaw.mock.calls[0][0].join('')).toBe('SET TRANSACTION READ ONLY');
    expect(db.$transaction.mock.calls[0][1].isolationLevel).toBe('RepeatableRead');
    expect(tx.client.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['c1'] }, isDemo: false });
    for (const name of ['billingCharge', 'billingInvoice', 'billingPayment', 'wbOrderShipment', 'fbsTsdAssembly', 'fbsAssemblyAttemptHistory', 'clientRequest'])
      expect(tx[name].findMany.mock.calls[0][0].where.clientId).toEqual({ in: ['c1'] });
    expect(tx.wbOrderShipment.findMany.mock.calls[0][0].where.warehouseId).toBe('w1');
  });
  it('refuses a truncated ledger rather than displaying incorrect totals', async () => {
    process.env.WMS_BILLING_SETTLEMENTS_ENABLED = 'true'; const { tx, s } = setup();
    tx.billingCharge.findMany.mockResolvedValue(Array(100001).fill(charge()));
    await expect(s.list({ periodFrom: '2026-10-01', periodTo: '2026-10-02' }, user)).rejects.toThrow('неполные суммы');
  });
  // TEST: production has 42,144 charges; the previous 20,000 cap blocked the default register.
  it('returns the complete register above the former 20000 historical charge cap', async () => {
    process.env.WMS_BILLING_SETTLEMENTS_ENABLED = 'true'; const { tx, s } = setup();
    tx.billingCharge.findMany.mockResolvedValue(Array.from({ length: 42144 }, (_, i) => charge({ id: `charge-${i}` })));
    const result = await s.list({ periodFrom: '2026-10-01', periodTo: '2026-10-02' }, user);
    expect(result.enabled).toBe(true);
    if (result.enabled) expect(result.rows[0].unbilledRub).toBe(4214400);
    expect(tx.billingCharge.findMany.mock.calls[0][0].take).toBe(100001);
  });
});
