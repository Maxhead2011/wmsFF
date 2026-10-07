import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDoneRequestsPlan, doneRequestDates } from './billing-done-requests.policy';
import { BillingPeriodService } from './billing-period.service';
import { ClientScopeService } from '../auth/client-scope.service';

// TEST: surrender dates are events in Moscow time, never request.updatedAt or serviceDate.
const client = { id: 'c', code: 'C', name: 'Клиент' };
const input = { periodFrom: '2026-10-01', periodTo: '2026-10-02' };
const request = (patch: any = {}) => ({ id: 'r', number: 1244, clientId: 'c', client, warehouseId: 'w', status: 'DONE',
  updatedAt: new Date('2026-10-10'), events: [{ id: 'event', createdAt: new Date('2026-09-30T21:00:00Z') }], ...patch });
const charge = (patch: any = {}) => ({ id: 'ch', requestId: 'r', clientId: 'c', client, status: 'APPROVED',
  quantity: '2', unitPriceRub: '50', totalRub: '100', description: 'Упаковка', unit: 'PIECE',
  serviceDate: new Date('2026-09-25'), updatedAt: new Date('2026-09-25'), invoiceItems: [], ...patch });
const invoice = (patch: any = {}) => ({ id: 'i', number: 'INV', clientId: 'c', client, warehouseId: 'w', requestId: 'r',
  periodFrom: new Date('2026-09-01'), periodTo: new Date('2026-09-30'), status: 'DRAFT', paidRub: '0', totalRub: '100',
  payments: [], updatedAt: new Date('2026-09-25'), items: [{ ...charge(), id: 'item', chargeId: 'ch' }], ...patch });
const plan = (rs = [request()], cs = [charge()], ins: any[] = []) => buildDoneRequestsPlan(input, rs, cs, ins, 'w');
// TEST: orchestration exercises real locking wrapper, current scopes and stale preview protection.
describe('surrendered request draft transaction', () => {
  beforeEach(() => vi.stubEnv('WMS_BILLING_DONE_REQUESTS_ENABLED', 'true'));
  afterEach(() => vi.unstubAllEnvs());
  const user: any = { id: 'u', roleCodes: ['ADMIN'], permissionCodes: ['billing:write'], clientScopeMode: 'ALL',
    clientIds: [], writableClientIds: [], activeWarehouseId: 'w', writableWarehouseIds: ['w'] };
  const dto: any = { ...input, doneRequests: true, categories: ['FBS', 'PROCESSING', 'PRR', 'STORAGE'], excludeLukin: false };
  const setup = () => {
    const tx: any = { $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: vi.fn().mockResolvedValue(0), clientRequest: { findMany: vi.fn().mockResolvedValue([request()]) },
      billingCharge: { findMany: vi.fn().mockResolvedValue([charge()]) }, billingInvoice: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) } };
    const prisma: any = { ...tx, $transaction: vi.fn((fn: any) => fn(tx)) };
    const billing: any = { writePeriodDraft: vi.fn().mockResolvedValue({ id: 'new', number: 'INV-NEW' }) };
    return { tx, prisma, billing, service: new BillingPeriodService(prisma, new ClientScopeService(), billing) };
  };
  it('writes one combined draft without stock or request mutation', async () => {
    const { service, billing } = setup();
    const preview = await service.previewPeriod(dto, user);
    await service.generatePeriod({ ...dto, previewHash: preview.previewHash }, user);
    expect(billing.writePeriodDraft).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      category: 'OTHER', requestNumbers: [1244], sourceKey: expect.stringMatching(/^billing-done-requests:/), charges: [charge()], invoices: [],
    }), user);
  });
  it('preview does not write and enforces rollout, permission and branch/client access', async () => {
    const { service, billing, prisma } = setup();
    await service.previewPeriod(dto, user);
    expect(billing.writePeriodDraft).not.toHaveBeenCalled();
    vi.stubEnv('WMS_BILLING_DONE_REQUESTS_ENABLED', 'false');
    await expect(service.previewPeriod(dto, user)).rejects.toThrow('не включено');
    vi.stubEnv('WMS_BILLING_DONE_REQUESTS_ENABLED', 'true');
    await expect(service.previewPeriod(dto, { ...user, permissionCodes: ['billing:read'] })).rejects.toThrow();
    await expect(service.previewPeriod(dto, { ...user, writableWarehouseIds: [] })).rejects.toThrow();
    await expect(service.previewPeriod({ ...dto, clientId: 'c' }, { ...user, clientScopeMode: 'LIMITED' })).rejects.toThrow();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('does not write after reopening or price change since preview', async () => {
    for (const change of ['request', 'tariff']) {
      const { service, billing, tx } = setup();
      const preview = await service.previewPeriod(dto, user);
      if (change === 'request') tx.clientRequest.findMany.mockResolvedValue([]);
      else tx.billingCharge.findMany.mockResolvedValue([charge({ totalRub: '101' })]);
      await expect(service.generatePeriod({ ...dto, previewHash: preview.previewHash }, user)).rejects.toThrow('изменились');
      expect(billing.writePeriodDraft).not.toHaveBeenCalled();
    }
  });
  it('replays exact confirmation with current invoice access', async () => {
    const { service, billing, tx } = setup();
    tx.auditLog.findFirst.mockResolvedValue({ payload: { invoices: [{ id: 'old', number: 'INV-OLD', disposition: 'CREATED' }] } });
    tx.billingInvoice.findMany.mockResolvedValue([invoice({ id: 'old' })]);
    expect((await service.generatePeriod({ ...dto, previewHash: 'a'.repeat(64) }, user)).replayed).toBe(true);
    expect(billing.writePeriodDraft).not.toHaveBeenCalled();
    tx.billingInvoice.findMany.mockResolvedValue([invoice({ id: 'old', warehouseId: 'other' })]);
    await expect(service.generatePeriod({ ...dto, previewHash: 'a'.repeat(64) }, user)).rejects.toThrow('филиалу');
  });
  it('rejects a truncated set instead of reporting incomplete money', async () => {
    const { service, tx } = setup();
    tx.clientRequest.findMany.mockResolvedValue(Array(10001).fill(request()));
    await expect(service.previewPeriod(dto, user)).rejects.toThrow('Слишком много');
  });
});
describe('drafts by surrendered requests', () => {
  it('uses inclusive Moscow surrender day and retains actual service dates', () => {
    expect(doneRequestDates(input).from.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    const result = plan();
    expect(result.groups[0].totalRub).toBe(100);
    expect(result.groups[0].lines[0].serviceDate).toBe('2026-09-25');
    expect(result.requests[0].number).toBe(1244);
  });
  it('excludes packed, other warehouses and surrender outside period', () => {
    for (const patch of [{ status: 'PACKED' }, { warehouseId: 'other' }, { events: [{ id: 'new', createdAt: new Date('2026-10-03') }] }])
      expect(plan([request(patch)]).groups).toHaveLength(0);
  });
  it('does not replace missing surrender event with edited timestamp', () => {
    const result = plan([request({ events: [] })]);
    expect(result.groups).toHaveLength(0);
    expect(result.issues[0].message).toContain('дата сдачи');
  });
  // TEST: surrender/reopening history and end-of-day boundaries cannot shift an invoice period.
  it('uses latest surrender and includes last Moscow millisecond only', () => {
    expect(plan([request({ events: [{ id: 'last', createdAt: new Date('2026-10-02T20:59:59.999Z') }] })]).groups).toHaveLength(1);
    expect(plan([request({ events: [{ id: 'last', createdAt: new Date('2026-10-02T21:00:00Z') }, ...request().events] })]).groups).toHaveLength(0);
  });
  it('leaves every existing draft untouched and excludes its already covered period', () => {
    const i = invoice({ periodFrom: new Date('2026-10-01'), periodTo: new Date('2026-10-02T23:59:59.999Z') });
    const result = plan([request()], [charge({ invoiceItems: [{ invoice: { id: 'i', status: 'DRAFT' } }] })], [i]);
    expect(result.groups).toHaveLength(0);
    expect(result.alreadyBilledCount).toBe(1);
    expect(result.issues[0].message).toContain('INV');
  });
  it('does not list missing or already billed requests as contributing to the created draft', () => {
    const result = plan([request(), request({ id: 'missing', number: 1245 })]);
    expect(result.groups[0].requestIds).toEqual(['r']);
    expect(result.issues.some(i => i.id === 'missing')).toBe(true);
  });
  it('combines all service categories in one client draft and splits clients', () => {
    const r2 = request({ id: 'r2', clientId: 'c2', client: { ...client, id: 'c2' } });
    const result = plan([request(), r2], [charge(), charge({ id: 'ch2', description: 'Хранение' }), charge({ id: 'ch3', requestId: 'r2', clientId: 'c2', client: r2.client })]);
    expect(result.groups.map(g => g.totalRub)).toEqual([200, 100]);
  });
  it('excludes every existing invoice even if its original service dates predate surrender', () => {
    const result = plan([request()], [charge({ invoiceItems: [{ invoice: { id: 'i', status: 'DRAFT' } }] })], [invoice()]);
    expect(result.groups).toHaveLength(0);
    expect(result.alreadyBilledCount).toBe(1);
  });
  // TEST: selecting a larger/overlapping period never recreates already invoiced work.
  it('blocks overlapping billed client periods including unlinked manual drafts', () => {
    for (const status of ['DRAFT', 'ISSUED', 'PAID']) {
      const i = invoice({ requestId: null, items: [], status, periodFrom: new Date('2026-10-02'), periodTo: new Date('2026-10-31') });
      expect(plan([request()], [charge()], [i]).groups).toHaveLength(0);
    }
  });
  it('does not block another client or warehouse or a cancelled invoice', () => {
    for (const patch of [{ clientId: 'other' }, { warehouseId: 'other', requestId: null, items: [] }, { status: 'CANCELLED' }])
      expect(plan([request()], [charge()], [invoice(patch)]).groups).toHaveLength(1);
  });
  it('never cancels an issued or paid invoice, nor splits a mixed request draft', () => {
    for (const patch of [{ status: 'ISSUED' }, { paidRub: '1' }, { payments: [{}] },
      { items: [invoice().items[0], { ...invoice().items[0], id: 'other', chargeId: 'outside' }] }]) {
      expect(plan([request()], [charge({ invoiceItems: [{ invoice: { id: 'i', status: 'DRAFT' } }] })], [invoice(patch)]).groups).toHaveLength(0);
    }
  });
  it('shows requests without calculations and does not create a zero or guessed invoice', () => {
    expect(plan([request()], []).issues[0].message).toContain('нет начислений');
    for (const patch of [{ status: 'DRAFT' }, { unitPriceRub: '0' }, { totalRub: '0' }, { metadata: { priceRequiresConfirmation: true } }]) {
      const result = plan([request()], [charge(patch)]);
      expect(result.groups).toHaveLength(0); expect(result.issues.length).toBeGreaterThan(0);
    }
  });
  it('fingerprints surrender evidence, original tariff and invoice state', () => {
    const hash = plan().previewHash;
    expect(plan([request({ events: [{ id: 'changed', createdAt: new Date('2026-10-01') }] })]).previewHash).not.toBe(hash);
    expect(plan([request()], [charge({ serviceDate: new Date('2026-09-26') })]).previewHash).not.toBe(hash);
  });
  it('does not guess prorating a stored total from a rounded gross unit price', () => {
    expect(plan([request()], [charge({ quantity: '14', unitPriceRub: '4787.23', totalRub: '67021.28' })]).groups[0].totalRub).toBe(67021.28);
  });
});
