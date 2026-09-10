import { describe, expect, it } from 'vitest';
import { buildPeriodPlan, classifyBillingCharge, classifyBillingInvoice, parseBillingPeriod } from './billing-period-policy';
import { BillingPeriodService } from './billing-period.service';
import { ClientScopeService } from '../auth/client-scope.service';
import { vi } from 'vitest';
import { BillingService } from './billing.service';

// TEST: period registry never guesses tariffs, branches or categories.
const client = { id: 'c1', code: 'CL-TEST', name: 'Клиент', legalName: null };
const charge = (patch: any = {}) => ({
  id: 'ch1', clientId: 'c1', client, status: 'APPROVED', source: 'MANUAL',
  quantity: '2', unitPriceRub: '50', totalRub: '100', description: 'FBS', unit: 'PIECE',
  serviceDate: new Date('2026-08-10T09:00:00Z'), updatedAt: new Date('2026-09-10T09:00:00Z'),
  metadata: { kind: 'FBS' }, request: { warehouseId: 'w1' }, service: null, invoiceItems: [], ...patch,
});

// TEST: creation revalidates the preview and never writes on stale state or denied scope.
describe('billing period transaction', () => {
  const user: any = { id: 'u1', roleCodes: ['ADMIN'], permissionCodes: ['billing:write'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [], activeWarehouseId: 'w1', writableWarehouseIds: ['w1'] };
  function setup() {
    const tx: any = { $queryRaw: vi.fn().mockResolvedValue([]), billingCharge: { findMany: vi.fn().mockResolvedValue([charge()]) },
      billingInvoice: { findMany: vi.fn().mockResolvedValue([]) }, auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) } };
    const prisma: any = { ...tx, $transaction: vi.fn((fn: any) => fn(tx)) };
    const billing: any = { writePeriodDraft: vi.fn().mockResolvedValue({ id: 'new', number: 'INV-NEW' }) };
    return { service: new BillingPeriodService(prisma, new ClientScopeService(), billing), tx, billing, prisma };
  }
  it('writes only after matching current confirmation hash', async () => {
    const { service, billing } = setup();
    const preview = await service.previewPeriod(input as any, user);
    const result = await service.generatePeriod({ ...input, previewHash: preview.previewHash } as any, user);
    expect(result.invoices[0].id).toBe('new');
    expect(billing.writePeriodDraft).toHaveBeenCalledTimes(1);
  });
  it('rejects changed data instead of applying a new amount without consent', async () => {
    const { service, tx, billing } = setup();
    const preview = await service.previewPeriod(input as any, user);
    tx.billingCharge.findMany.mockResolvedValue([charge({ totalRub: 120 })]);
    await expect(service.generatePeriod({ ...input, previewHash: preview.previewHash } as any, user)).rejects.toThrow('изменились');
    expect(billing.writePeriodDraft).not.toHaveBeenCalled();
  });
  it('replays the saved result without a second invoice', async () => {
    const { service, tx, billing } = setup();
    tx.auditLog.findFirst.mockResolvedValue({ payload: { invoices: [{ id: 'old', number: 'INV-OLD' }] } });
    tx.billingInvoice.findMany.mockResolvedValue([invoice({ id: 'old', number: 'INV-OLD' })]);
    expect((await service.generatePeriod({ ...input, previewHash: 'a'.repeat(64) } as any, user)).replayed).toBe(true);
    expect(billing.writePeriodDraft).not.toHaveBeenCalled();
  });
  // TEST: a saved operation is not an authorization snapshot after access revocation.
  it('rechecks current client and branch access before returning a replay', async () => {
    const { service, tx, billing } = setup();
    tx.auditLog.findFirst.mockResolvedValue({ payload: { invoices: [{ id: 'old', number: 'INV-OLD' }] } });
    tx.billingInvoice.findMany.mockResolvedValue([invoice({ id: 'old' })]);
    await expect(service.generatePeriod({ ...input, previewHash: 'a'.repeat(64) } as any, { ...user, clientScopeMode: 'LIMITED', clientIds: ['c1'], writableClientIds: [] })).rejects.toThrow();
    tx.billingInvoice.findMany.mockResolvedValue([invoice({ id: 'old', warehouseId: 'w2' })]);
    await expect(service.generatePeriod({ ...input, previewHash: 'a'.repeat(64) } as any, user)).rejects.toThrow();
    expect(billing.writePeriodDraft).not.toHaveBeenCalled();
  });
  it('requires write permission, a selected accessible branch and writable client', async () => {
    const { service, prisma } = setup();
    await expect(service.previewPeriod(input as any, { ...user, permissionCodes: [] })).rejects.toThrow();
    await expect(service.previewPeriod(input as any, { ...user, activeWarehouseId: null })).rejects.toThrow();
    await expect(service.previewPeriod(input as any, { ...user, writableWarehouseIds: ['w2'] })).rejects.toThrow();
    await expect(service.previewPeriod({ ...input, clientId: 'c1' } as any, { ...user, clientScopeMode: 'LIMITED' })).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// TEST: the existing billing writer remains the single source of invoice snapshots.
describe('period invoice writer and registry', () => {
  it('opens the current period including spanning invoices, and filters stable categories', async () => {
    const db: any = { billingInvoice: { findMany: vi.fn().mockResolvedValue([invoice(), invoice({ id: 'primary', items: [{ ...invoice().items[0], charge: charge({ metadata: { kind: 'FBS_PRIMARY_PROCESSING' } }) }] })]) } };
    const service = new BillingService(db, new ClientScopeService());
    const rows = await service.listInvoices({ periodFrom: '2026-08-01', periodTo: '2026-08-31', serviceCategory: 'FBS' } as any,
      { permissionCodes: ['system:admin'], roleCodes: ['ADMIN'], clientScopeMode: 'ALL', activeWarehouseId: 'w1' } as any);
    expect(rows.map(r => r.id)).toEqual(['i1']);
    expect(db.billingInvoice.findMany.mock.calls[0][0].where.periodFrom.lte.toISOString()).toBe('2026-08-31T23:59:59.999Z');
  });
  it('copies prices without recalculation and cancels only the merged draft sources', async () => {
    const tx: any = { billingInvoice: { count: vi.fn().mockResolvedValue(1), create: vi.fn().mockResolvedValue({ id: 'new', number: 'new' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      billingInvoiceItem: { count: vi.fn().mockResolvedValue(0) }, auditLog: { create: vi.fn() } };
    const service = new BillingService(tx, new ClientScopeService());
    await (service as any).writePeriodDraft(tx, { clientId: 'c1', warehouseId: 'w1', category: 'FBS', periodFrom: '2026-08-01', periodTo: '2026-08-31', sourceKey: 'operation', charges: [charge({ id: 'ch2' })], invoices: [invoice()] }, { id: 'u1', permissionCodes: ['billing:write'], clientScopeMode: 'ALL', activeWarehouseId: 'w1', writableWarehouseIds: ['w1'] });
    const data = tx.billingInvoice.create.mock.calls[0][0].data;
    expect(data.totalRub).toBe(200);
    expect(data.items.create).toHaveLength(2);
    expect(data.items.create.map((r: any) => Number(r.unitPriceRub))).toEqual([50, 50]);
    expect(tx.billingInvoice.updateMany.mock.calls[0][0].where).toMatchObject({ id: { in: ['i1'] }, status: 'DRAFT' });
  });
});
const invoice = (patch: any = {}) => ({
  id: 'i1', number: 'INV1', clientId: 'c1', client, warehouseId: 'w1', request: null,
  periodFrom: new Date('2026-08-01T00:00:00Z'), periodTo: new Date('2026-08-31T00:00:00Z'),
  status: 'DRAFT', paidRub: '0', totalRub: '100', payments: [], updatedAt: new Date('2026-09-10T09:00:00Z'),
  items: [{ ...charge(), id: 'item1', chargeId: 'ch1', charge: charge() }], ...patch,
});
const input = { periodFrom: '2026-08-01', periodTo: '2026-08-31', categories: ['FBS', 'PROCESSING', 'PRR', 'STORAGE'], excludeLukin: true };
const plan = (charges: any[] = [], invoices: any[] = [], patch: any = {}) => buildPeriodPlan({ ...input, ...patch } as any, charges, invoices, 'w1');

describe('billing period policy', () => {
  it('preserves existing UTC-encoded billing calendar dates and rejects invalid/reversed dates', () => {
    const dates = parseBillingPeriod('2026-08-01', '2026-08-31');
    expect(dates.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(dates.to.toISOString()).toBe('2026-08-31T23:59:59.999Z');
    expect(() => parseBillingPeriod('2026-02-30', '2026-03-01')).toThrow();
    expect(() => parseBillingPeriod('2026-08-31', '2026-08-01')).toThrow();
  });
  // TEST: historical end-of-day values must not vanish from August generation.
  it('includes historical month-end invoices and storage charges with visible source prices', () => {
    const storage = charge({ id: 'storage', source: 'STORAGE', metadata: { periodFrom: '2026-08-01', periodTo: '2026-08-31' }, serviceDate: new Date('2026-08-31T23:59:59.999Z') });
    const fullMonth = invoice({ periodTo: new Date('2026-08-31T23:59:59.999Z') });
    const result = plan([storage], [fullMonth]);
    expect(result.groups).toHaveLength(2);
    const existing = result.groups.find(group => group.category === 'FBS')!;
    expect(existing.action).toBe('EXISTING');
    expect(existing.existingInvoiceId).toBe('i1');
    expect(existing.lines[0]).toMatchObject({ sourceType: 'INVOICE', sourceId: 'i1', sourceNumber: 'INV1', description: 'FBS', quantity: '2', unitPriceRub: '50', totalRub: '100' });
    expect(result.groups.find(group => group.category === 'STORAGE')?.lines[0].sourceType).toBe('CHARGE');
  });
  it('distinguishes a daily source that must become a new monthly document', () => {
    const result = plan([], [invoice({ periodFrom: new Date('2026-08-10'), periodTo: new Date('2026-08-10T23:59:59.999Z') })]);
    expect(result.groups[0].action).toBe('CREATE');
    expect(result.groups[0].existingInvoiceId).toBeUndefined();
  });
  it('classifies source metadata before generic FBS code; never uses description guesses', () => {
    expect(classifyBillingCharge(charge({ metadata: { kind: 'FBS_PRIMARY_PROCESSING' }, service: { code: 'FBS_PROCESSING' } }))).toBe('PROCESSING');
    expect(classifyBillingCharge(charge({ metadata: null, service: { code: 'PPR_BOXES' } }))).toBe('PRR');
    expect(classifyBillingCharge(charge({ source: 'STORAGE' }))).toBe('STORAGE');
    expect(classifyBillingCharge(charge({ metadata: null, description: 'Обработка FBS первичная' }))).toBe('OTHER');
  });
  it('separates service categories and hides only genuine zero rows', () => {
    const result = plan([charge(), charge({ id: 'ch2', metadata: { kind: 'FBS_PRIMARY_PROCESSING' } }), charge({ id: 'z', quantity: 0, totalRub: 0 })]);
    expect(result.groups.map(g => g.category).sort()).toEqual(['FBS', 'PROCESSING']);
    expect(result.zeroCount).toBe(1);
  });
  it('blocks unapproved or unresolved positive-quantity zero-price charges', () => {
    const result = plan([charge({ status: 'DRAFT' }), charge({ id: 'zero', unitPriceRub: 0, totalRub: 0 })]);
    expect(result.groups).toHaveLength(0);
    expect(result.issues).toHaveLength(2);
  });
  // TEST: a positive invoice total must not conceal a line with an unresolved tariff.
  it.each([[0, 0], [0, 100], [-5, 100], [50, 0]])('blocks draft lines with quantity but unresolved price/total (%s, %s)', (unitPriceRub, totalRub) => {
    const unresolved = { ...invoice().items[0], id: 'unpriced-item', chargeId: 'unpriced-charge', description: 'Неуточнённая услуга', quantity: 2, unitPriceRub, totalRub };
    const result = plan([], [invoice({ totalRub: 100 + totalRub, items: [...invoice().items, unresolved] })]);
    expect(result.groups).toHaveLength(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toContain('нулевого тарифа');
    expect(result.issues[0].message).toContain('Неуточнённая услуга');
  });
  it('never duplicates already billed charges and preserves issued invoices', () => {
    const result = plan([charge({ invoiceItems: [{ invoice: { id: 'i1', status: 'ISSUED' } }] })], [invoice({ status: 'ISSUED' })]);
    expect(result.groups).toHaveLength(0);
    expect(result.alreadyBilledCount).toBe(1);
  });
  it('can combine an eligible draft with new approved charges using unchanged totals', () => {
    const result = plan([charge({ id: 'ch2' })], [invoice()]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ invoiceIds: ['i1'], chargeIds: ['ch2'], totalRub: 200 });
  });
  it('blocks mixed, paid, cross-period and duplicate-source drafts', () => {
    const mixed = invoice({ items: [...invoice().items, { ...invoice().items[0], id: 'it2', chargeId: 'ch2', charge: charge({ metadata: { kind: 'FBS_PRIMARY_PROCESSING' } }) }] });
    expect(classifyBillingInvoice(mixed)).toBe('OTHER');
    expect(plan([], [mixed]).groups).toHaveLength(0);
    expect(plan([], [invoice({ paidRub: 1 })]).groups).toHaveLength(0);
    expect(plan([], [invoice({ periodFrom: new Date('2026-07-01') })]).groups).toHaveLength(0);
    expect(plan([], [invoice(), invoice({ id: 'i2' })]).groups).toHaveLength(0);
  });
  it('never assigns branchless charges to the currently selected branch', () => {
    expect(plan([charge({ request: null })]).issues[0].message).toContain('филиал');
    expect(plan([charge({ request: { warehouseId: 'w2' } })]).groups).toHaveLength(0);
  });
  it('excludes Lukin only on explicit generation option and applies client filter', () => {
    const lukin = charge({ client: { ...client, name: 'ИП Лукин Илья Ильич' } });
    expect(plan([lukin]).groups).toHaveLength(0);
    expect(plan([lukin], [], { excludeLukin: false }).groups).toHaveLength(1);
    expect(plan([charge()], [], { clientId: 'c2' }).groups).toHaveLength(0);
  });
  it('fingerprint is stable, and changes when the approved amount or source state changes', () => {
    expect(plan([charge()]).previewHash).toBe(plan([charge()]).previewHash);
    expect(plan([charge()]).previewHash).not.toBe(plan([charge({ totalRub: 120 })]).previewHash);
    expect(plan([], [invoice()]).previewHash).not.toBe(plan([], [invoice({ status: 'ISSUED' })]).previewHash);
  });
  it('rejects partial storage ranges instead of billing the full month for one week', () => {
    const result = plan([charge({ source: 'STORAGE', metadata: { periodFrom: '2026-07-01', periodTo: '2026-08-31' } })]);
    expect(result.groups).toHaveLength(0);
    expect(result.issues[0].message).toContain('период');
  });
});
