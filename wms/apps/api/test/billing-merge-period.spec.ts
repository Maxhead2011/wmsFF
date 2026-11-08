import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillingService } from '../src/modules/billing/billing.service';
import { BillingController } from '../src/modules/billing/billing.controller';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { fetchFbsInvoiceMergePreview, mergeFbsInvoices, mergeBillingInvoices } from '../../web/src/lib/api';

const period = { periodFrom: '2026-11-01', periodTo: '2026-11-08' };
const user = {
  id: 'manager', roleCodes: ['ADMIN'], permissionCodes: ['billing:write'],
  clientScopeMode: 'ALL', clientIds: [], writableClientIds: [],
  activeWarehouseId: 'warehouse', warehouseIds: ['warehouse'], writableWarehouseIds: ['warehouse'],
} as unknown as AuthUser;

function invoice(id: string, from: string, to: string, count: number, merged = false) {
  const orderIds = Array.from({ length: count }, (_, index) => `${id}-${index}`);
  return {
    id, number: id, clientId: 'client', warehouseId: 'warehouse', status: 'DRAFT',
    paidRub: '0', payments: [], periodFrom: new Date(from), periodTo: new Date(to),
    sourceKey: merged ? `fbs-merged:client:${id}` : `fbs-invoice:client:${id}`,
    items: [{
      id: `${id}-item`, quantity: count, serviceDate: new Date(from),
      charge: {
        id: `${id}-charge`, totalRub: count * 35, serviceDate: new Date(from),
        metadata: { kind: 'FBS', orderIds, quantity: count },
      },
    }],
  };
}

function fixture() {
  const october = invoice('october', '2026-10-20', '2026-10-31T23:59:59.999Z', 307, true);
  const november = invoice('november', '2026-11-03', '2026-11-08T23:59:59.999Z', 122);
  const crossing = invoice('crossing', '2026-10-31', '2026-11-02', 1);
  const prisma = {
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'client', name: 'Client', code: 'CL' }) },
    clientFbsBillingSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    billingInvoice: { findMany: vi.fn().mockResolvedValue([october, november, crossing]), updateMany: vi.fn(), create: vi.fn() },
    fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue([]) },
    fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async operation => operation(prisma));
  const scopes = { requireClientAccess: vi.fn() };
  const service = new BillingService(prisma as never, scopes as never);
  return { service, prisma, october, november };
}

describe('invoice merge selected period', () => {
  afterEach(() => vi.unstubAllGlobals());
  // TEST: reproduces the 307 October + 122 November = 429 preview regression.
  it('excludes the old merged target and invoices crossing the selected dates', async () => {
    const { service, prisma } = fixture();
    const preview = await service.getFbsMergePreview('client', user, undefined, period);
    expect(preview.orders).toHaveLength(122);
    expect(preview.existingMergedInvoiceId).toBeNull();
    expect(preview.sourceInvoiceNumbers).toEqual(['november']);
    expect(prisma.billingInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        periodFrom: { gte: new Date('2026-11-01T00:00:00Z') },
        periodTo: { lte: new Date('2026-11-08T23:59:59.999Z') },
      }),
    }));
  });

  // TEST: direct API selection must not bypass the period restriction.
  it('rejects explicitly selected invoices crossing the period in preview and on submission', async () => {
    const { service, prisma } = fixture();
    await expect(service.getFbsMergePreview('client', user, ['crossing'], period)).rejects.toThrow();
    await expect(service.mergeFbsInvoices({
      clientId: 'client', invoiceIds: ['crossing'], logisticsDays: [], ...period,
    }, user)).rejects.toThrow();
    expect(prisma.billingInvoice.updateMany).not.toHaveBeenCalled();
    expect(prisma.billingInvoice.create).not.toHaveBeenCalled();
  });

  // TEST: the general merge entry point must enforce the same selection.
  it('rejects a general merge containing an invoice outside the selected period', async () => {
    const { service, prisma, october, november } = fixture();
    prisma.billingInvoice.findMany.mockResolvedValue([october, november]);
    await expect(service.mergeInvoices({
      invoiceIds: ['october', 'november'], ...period,
    }, user)).rejects.toThrow('период');
    expect(prisma.billingInvoice.updateMany).not.toHaveBeenCalled();
    expect(prisma.billingInvoice.create).not.toHaveBeenCalled();
  });

  // TEST: legacy callers without dates retain their existing selection.
  it('preserves API behavior when the period is omitted', async () => {
    const { service, october, november, prisma } = fixture();
    prisma.billingInvoice.findMany.mockResolvedValue([october, november]);
    const preview = await service.getFbsMergePreview('client', user);
    expect(preview.orders).toHaveLength(429);
    expect(preview.existingMergedInvoiceId).toBe('october');
  });

  // TEST: an existing merged target within the period remains reusable.
  it('retains a merged target fully within the selected dates', async () => {
    const { service, prisma, november } = fixture();
    const target = invoice('target', '2026-11-01', '2026-11-02', 2, true);
    prisma.billingInvoice.findMany.mockResolvedValue([target, november]);
    const preview = await service.getFbsMergePreview('client', user, undefined, period);
    expect(preview.orders).toHaveLength(124);
    expect(preview.existingMergedInvoiceId).toBe('target');
  });

  // TEST: dates survive both the controller and browser API entry points.
  it('passes preview query dates from the controller to the service', async () => {
    const billing = { getFbsMergePreview: vi.fn() };
    const controller = new BillingController(billing as never, undefined as never, undefined as never);
    controller.getFbsMergePreview('client', 'november', user, period.periodFrom, period.periodTo);
    expect(billing.getFbsMergePreview).toHaveBeenCalledWith('client', user, ['november'], period);
    controller.previewFbsMerge({ clientId: 'client', invoiceIds: ['november'], ...period }, user);
    expect(billing.getFbsMergePreview).toHaveBeenLastCalledWith('client', user, ['november'], expect.objectContaining(period));
  });

  it('sends the selected dates for preview and both merge submissions', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetch);
    await fetchFbsInvoiceMergePreview('token', 'client', ['november'], period);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject(period);
    await mergeFbsInvoices('token', { clientId: 'client', logisticsDays: [], ...period });
    await mergeBillingInvoices('token', { invoiceIds: ['one', 'two'], ...period });
    for (const [, options] of fetch.mock.calls.slice(1)) {
      expect(JSON.parse(options.body)).toMatchObject(period);
    }
  });

  // TEST: malformed, incomplete and reversed ranges fail before any selection.
  it.each([
    { periodFrom: '2026-11-01' },
    { periodTo: '2026-11-08' },
    { periodFrom: '2026-11-08', periodTo: '2026-11-01' },
    { periodFrom: '2026-02-30', periodTo: '2026-11-08' },
  ])('rejects invalid period %j', async (dates) => {
    const { service, prisma } = fixture();
    await expect(service.getFbsMergePreview('client', user, undefined, dates)).rejects.toThrow();
    expect(prisma.billingInvoice.findMany).not.toHaveBeenCalled();
  });
});
