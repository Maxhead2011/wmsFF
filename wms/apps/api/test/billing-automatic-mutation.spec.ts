import { describe, expect, it, vi } from 'vitest';
import { RequestBillingAutomationService } from '../src/modules/billing/request-billing-automation.service';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: every automatic invoice writer must join the same database lock as manual billing.
describe('automatic invoice mutation isolation', () => {
  function database() {
    const events: string[] = [];
    const db: any = {
      $queryRaw: vi.fn(async () => { events.push('lock'); return []; }),
      clientRequest: { findUnique: vi.fn(async () => { events.push('read'); return null; }) },
      billingInvoice: {
        findUnique: vi.fn(async () => { events.push('read'); return { id: 'paid', status: 'PAID' }; }),
        findMany: vi.fn(async () => { events.push('read'); return []; }),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      billingCharge: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    db.$transaction = vi.fn(async (callback: any) => callback(db));
    return { db, events };
  }

  it('locks request auto-generation before selecting uninvoiced charges', async () => {
    const { db, events } = database();
    await new RequestBillingAutomationService(db).generateForDoneRequest('request', {} as never);
    expect(events).toEqual(['lock', 'read']);
  });

  it('locks primary generation before reading invoice status', async () => {
    const { db, events } = database();
    await (new MarketplaceConnectionsService(db, {} as never) as any)
      .ensureFbsPrimaryProcessingInvoice({ clientId: 'client', shipmentKey: 'supply' });
    expect(events).toEqual(['lock', 'read']);
  });

  // TEST: regeneration cannot resurrect a merged source even if its old charges are absent.
  it.each([
    { status: 'CANCELLED', comment: 'Объединено в счёт INV-202608-0001.' },
    { status: 'DRAFT', paidRub: 10, _count: { payments: 1 } },
  ])('leaves merged or paid primary source unchanged: %j', async (state) => {
    const { db } = database();
    db.billingInvoice.findUnique.mockResolvedValue({ id: 'protected', number: 'P-1', ...state });
    db.billingCharge.findMany = vi.fn().mockRejectedValue(new Error('must not recalculate protected invoice'));
    await expect((new MarketplaceConnectionsService(db, {} as never) as any)
      .ensureFbsPrimaryProcessingInvoice({ clientId: 'client', shipmentKey: 'supply' }))
      .resolves.toMatchObject({ id: 'protected' });
    expect(db.billingCharge.findMany).not.toHaveBeenCalled();
  });

  it('locks shipment invoice generation even when the selected set is empty', async () => {
    const { db, events } = database();
    await (new MarketplaceConnectionsService(db, {} as never) as any)
      .ensureFbsShipmentInvoices('client', [], new Map());
    expect(events).toEqual(['lock']);
  });

  // TEST: period consolidation must display the actual active invoice, never another client's invoice.
  it.each([
    ['Объединено в счёт', 'client', 'INV-202608-0001', 'ISSUED'],
    ['Объединено в FBS-счёт', 'client', 'INV-202608-0001', 'ISSUED'],
    ['Объединено в счёт', 'other-client', 'FBS-OLD', 'CANCELLED'],
    ['Объединено в FBS-счёт', 'other-client', 'FBS-OLD', 'CANCELLED'],
  ])('resolves merged shipment display for %s and %s', async (prefix, owner, expectedNumber, expectedStatus) => {
    const { db } = database();
    db.billingInvoice.findUnique.mockImplementation(async ({ where }: any) => where.sourceKey
      ? { id: 'source', number: 'FBS-OLD', status: 'CANCELLED', comment: `${prefix} INV-202608-0001.` }
      : { id: 'monthly', clientId: owner, number: 'INV-202608-0001', status: 'ISSUED' });
    const service = new MarketplaceConnectionsService(db, {} as never) as any;
    const orders = [{ id: '1', marketplace: 'WILDBERRIES', connectionId: 'connection', supplyId: 'supply',
      shipmentPlan: { destination: 'VNUKOVO_SORTING_CENTER' }, request: { id: 'request', warehouseId: 'warehouse' } }];
    const billing = new Map([['WILDBERRIES:connection:1', { chargeId: 'charge', totalRub: 100, invoiceNumber: null, invoiceStatus: null }]]);
    await service.ensureFbsShipmentInvoices('client', orders, billing);
    expect(billing.get('WILDBERRIES:connection:1')).toMatchObject({ totalRub: 100, invoiceNumber: expectedNumber, invoiceStatus: expectedStatus });
    expect(db.billingInvoice.findUnique).toHaveBeenCalledWith({
      where: { number: 'INV-202608-0001' }, select: { id: true, clientId: true, number: true, status: true },
    });
  });

  it('locks automatic charge calculation before it can change period sources', async () => {
    const { db, events } = database();
    await (new MarketplaceConnectionsService(db, {} as never) as any)
      .ensureFbsProcessingCharges('client', []);
    expect(events).toEqual(['lock']);
  });

  it('does not cancel paid drafts or charges already captured by another invoice', async () => {
    const { db, events } = database();
    await new MarketplaceConnectionsService(db, {} as never).cancelFbsPrimaryDraftBilling('client');
    expect(events[0]).toBe('lock');
    expect(db.billingInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ paidRub: 0, payments: { none: {} } }),
    }));
    expect(db.billingCharge.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ invoiceItems: { none: { invoice: { status: { not: 'CANCELLED' } } } } }),
    }));
  });
});
