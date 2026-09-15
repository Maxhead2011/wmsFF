import { describe, expect, it, vi } from 'vitest';
import { BillingService } from '../src/modules/billing/billing.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { classifyBillingInvoice } from '../src/modules/billing/billing-period-policy';

const clientId = 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9';
const user: any = { roleCodes: ['OWNER'], permissionCodes: ['system:admin'], clientScopeMode: 'ALL', activeWarehouseId: 'moscow' };
function item(kind: string, price: number, marked = true) {
  const metadata = { kind, orderIds: ['recovered-order'], shipmentKey: 'WILDBERRIES:account:recovered-order:completed-work',
    ...(marked ? { billingPolicy: 'FBS_COMPLETED_WORK_V1', processingOnly: true } : {}) };
  return { id: kind + price, quantity: 1, unitPriceRub: price, totalRub: price, serviceDate: new Date('2026-09-04'),
    charge: { id: kind + price, source: 'MANUAL', quantity: 1, totalRub: price, serviceDate: new Date('2026-09-04'), metadata } };
}
function recovered(patch: any = {}) {
  return { id: 'recovery', clientId, client: { id: clientId, code: 'CL-000001', name: 'Лукин' }, warehouseId: 'moscow',
    sourceKey: `fbs-invoice:${clientId}:completed-work:fingerprint`, number: 'FBS-WORK-1', status: 'DRAFT', paidRub: 0, payments: [],
    periodFrom: new Date('2026-09-04'), periodTo: new Date('2026-09-04'), totalRub: 52,
    items: [item('FBS', 37.1), item('FBS_PRIMARY_PROCESSING', 10.64), item('FBS_PRIMARY_PROCESSING', 4.26)], ...patch };
}
function setup(rows: any[]) {
  const db: any = { billingInvoice: { findMany: vi.fn(async () => rows), update: vi.fn(), create: vi.fn() },
    client: { findUnique: vi.fn(async () => recovered().client) },
    clientFbsBillingSettings: { findUnique: vi.fn(async () => ({ primaryProcessingEnabled: true })) },
    fbsOrderRequestLink: { findMany: vi.fn(async () => []) }, fbsTsdAssembly: { findMany: vi.fn(async () => []) } };
  return { db, service: new BillingService(db, new ClientScopeService()) };
}

// TEST: reproduce the actual listInvoices(FBS) -> selected IDs -> getFbsMergePreview path.
describe('recovered FBS invoices in the registry', () => {
  it('keeps the mixed recovery in the FBS filter and merge without recalculating money', async () => {
    const row = recovered(), before = JSON.stringify(row);
    const { service, db } = setup([row]);
    const listed = await service.listInvoices({ clientId, serviceCategory: 'FBS' }, user);
    expect(listed.map(x => x.id)).toEqual(['recovery']);
    const preview = await service.getFbsMergePreview(clientId, user, listed.map(x => x.id));
    expect(preview.draftInvoices).toBe(1);
    expect(preview.orders.map(x => x.orderId)).toEqual(['recovered-order']);
    expect(preview.processingTotalRub).toBe(37.1);
    expect(preview.primaryProcessing.totalRub).toBe(14.9);
    expect(preview.logisticsDays).toEqual([]);
    expect(JSON.stringify(row)).toBe(before);
    expect(db.billingInvoice.update).not.toHaveBeenCalled();
    expect(db.billingInvoice.create).not.toHaveBeenCalled();
  });
  it('is FBS in the unfiltered registry and no longer OTHER', async () => {
    const { service } = setup([recovered()]);
    expect((await service.listInvoices({ clientId }, user))[0].serviceCategory).toBe('FBS');
    expect(await service.listInvoices({ clientId, serviceCategory: 'OTHER' }, user)).toEqual([]);
  });
  it('keeps attached old processing with newly recovered primary services in FBS', async () => {
    const { service } = setup([recovered({ items: [item('FBS', 35, false), item('FBS_PRIMARY_PROCESSING', 10.64)] })]);
    expect((await service.listInvoices({ clientId, serviceCategory: 'FBS' }, user)).length).toBe(1);
  });
  it.each([
    { clientId: 'sold-client', sourceKey: 'fbs-invoice:sold-client:completed-work:fingerprint' },
    { sourceKey: `fbs-invoice:${clientId}:ordinary-supply` },
    { sourceKey: null },
    { items: [item('FBS', 37.1, false), item('FBS_PRIMARY_PROCESSING', 10.64, false)] },
    { items: [item('FBS', 37.1), item('STORAGE', 10)] },
    { items: [item('FBS', 37.1), { ...item('FBS_PRIMARY_PROCESSING', 10), charge: null }] },
    { items: [item('FBS', 37.1), { charge: { source: 'STORAGE', metadata: { kind: 'FBS_PRIMARY_PROCESSING' } } }] },
    { items: [item('FBS', 37.1, false), { charge: { metadata: { kind: 'FBS_PRIMARY_PROCESSING', billingPolicy: 'FBS_COMPLETED_WORK_V1', processingOnly: false } } }] },
    { items: [item('FBS', 37.1, false), { charge: { metadata: { kind: 'FBS_PRIMARY_PROCESSING', billingPolicy: 'UNKNOWN', processingOnly: true } } }] },
    { items: [] },
  ])('does not relabel unrelated, unproven or incomplete mixed invoices: %j', async patch => {
    const { service } = setup([recovered(patch)]);
    expect((await service.listInvoices({}, user))[0].serviceCategory).toBe('OTHER');
  });
  it('keeps primary-only recoveries in PROCESSING', async () => {
    const { service } = setup([recovered({ sourceKey: `fbs-primary-invoice:${clientId}:completed-work:fingerprint`, items: [item('FBS_PRIMARY_PROCESSING', 10.64)] })]);
    expect((await service.listInvoices({}, user))[0].serviceCategory).toBe('PROCESSING');
  });
  it('does not relax the strict classification used by period generation', () => {
    expect(classifyBillingInvoice(recovered())).toBe('OTHER');
  });
});
