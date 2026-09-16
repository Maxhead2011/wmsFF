import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { BillingService } from '../src/modules/billing/billing.service';
import {
  completedWorkBillingEnabled, completedWorkPlan, otherProcessingOrderKeys,
  preserveBilledComposition, recoverCompletedWork, COMPLETED_WORK_POLICY,
} from '../src/modules/billing/completed-fbs-billing';

const clientId = 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9';
const work = (extra = {}) => ({ id: 'assembly', clientId, marketplace: 'WILDBERRIES', connectionId: 'account',
  orderId: '81701', requestId: 'request', itemCount: 1, completedAt: new Date('2026-09-04T10:00:00Z'),
  barcode: '2050000000001', boxCode: 'BOX', workerUserId: 'worker', deviceCode: 'TSD',
  status: 'RETURN_REQUIRED', relabelConfirmedAt: null, ...extra });
const config = { processingPrice: 37.1, primaryEnabled: true, relabelPrice: 10 / 0.94,
  serviceIds: { processing: 'fbs', primary: 'primary', additional: 'additional', relabel: 'relabel' } };
const context = (extra = {}) => ({ clientId, work: [work()], charges: [], requests: [{ id: 'request', warehouseId: 'warehouse' }],
  config, ...extra });
const charge = (extra: any = {}) => ({ id: 'charge', status: 'DRAFT', sourceKey: 'fbs-calculator:old',
  quantity: 1, serviceId: 'fbs', totalRub: 37.1, invoiceItems: [{ invoice: { status: 'PAID' } }],
  metadata: { kind: 'FBS', marketplace: 'WILDBERRIES', connectionId: 'account', orderIds: ['81701'] }, ...extra });

afterEach(() => vi.unstubAllEnvs());
// TEST: completed work is billed independently of the current WB feed or shipment status.
describe('completed FBS work accounting', () => {
  it('is opt-in for LOGOFF client 0001 only', () => {
    expect(completedWorkBillingEnabled(clientId)).toBe(false);
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    expect(completedWorkBillingEnabled(clientId)).toBe(true);
    expect(completedWorkBillingEnabled('sold-client')).toBe(false);
  });
  it.each(['COMPLETED', 'RETURN_REQUIRED', 'CANCELLED', 'WB_ACCOUNTED'])('recovers physical work with status %s without logistics', status => {
    const plan = completedWorkPlan(context({ work: [work({ status })] }));
    expect(plan.lines.map(x => x.service)).toEqual(['processing', 'primary', 'additional']);
    expect(plan.lines.reduce((sum, x) => sum + x.totalRub, 0)).toBe(52);
    expect(plan.lines.every(x => x.metadata.processingOnly === true)).toBe(true);
    expect(plan.lines[0].metadata.orderIds).toEqual(['81701']);
  });
  it.each([{ completedAt: null }, { barcode: null }, { boxCode: null }, { workerUserId: null, deviceCode: null },
    { completedAt: new Date('2026-08-31T20:59:59Z') }, { itemCount: 0 }])('does not invent physical work: %j', extra => {
    expect(completedWorkPlan(context({ work: [work(extra)] })).lines).toEqual([]);
  });
  it('includes September 1 in Moscow and uses completion date, not WB order date', () => {
    const plan = completedWorkPlan(context({ work: [work({ completedAt: new Date('2026-08-31T21:00:00Z') })] }));
    expect(plan.lines[0].serviceDate.toISOString()).toBe('2026-08-31T21:00:00.000Z');
  });
  it('preserves paid/issued/merged processing; creates only missing services', () => {
    const plan = completedWorkPlan(context({ charges: [charge()] }));
    expect(plan.lines.map(x => x.service)).toEqual(['primary', 'additional']);
  });
  it('is idempotent across supply/request transfer and a second refresh', () => {
    const first = completedWorkPlan(context());
    const billed = first.lines.map(x => charge({ sourceKey: x.sourceKey, serviceId: x.serviceId, metadata: x.metadata }));
    expect(completedWorkPlan(context({ charges: billed, work: [work({ requestId: 'new-request', supplyId: 'new-supply' })],
      requests: [{ id: 'new-request', warehouseId: 'warehouse' }] })).lines).toEqual([]);
    expect(completedWorkPlan(context({ work: [work(), work()] })).lines).toHaveLength(3);
  });
  it('does not confuse identical order IDs in different accounts', () => {
    expect(completedWorkPlan(context({ charges: [charge({ metadata: { ...charge().metadata, connectionId: 'another' } })] })).lines).toHaveLength(3);
  });
  it('does not count zero-processing logistics charges as completed work', () => {
    expect(completedWorkPlan(context({ charges: [charge({ metadata: { ...charge().metadata, processingOrderIds: [] } })] })).lines).toHaveLength(3);
  });
  it('reports ambiguous legacy identity rather than duplicating an invoice', () => {
    const plan = completedWorkPlan(context({ charges: [charge({ metadata: { kind: 'FBS', orderIds: ['81701'] } })] }));
    expect(plan.lines.filter(x => x.service === 'processing')).toEqual([]);
    expect(plan.blocked.length).toBeGreaterThan(0);
  });
  it('reports existing uninvoiced charges; does not create a second one', () => {
    const plan = completedWorkPlan(context({ charges: [charge({ invoiceItems: [] })] }));
    expect(plan.lines.filter(x => x.service === 'processing')).toEqual([]);
    expect(plan.blocked.some(x => x.reason === 'CHARGE_WITHOUT_ACTIVE_INVOICE')).toBe(true);
  });
  it('does not revive manually cancelled recovery entries', () => {
    const line = completedWorkPlan(context()).lines[0];
    const plan = completedWorkPlan(context({ charges: [charge({ sourceKey: line.sourceKey, status: 'CANCELLED', metadata: line.metadata })] }));
    expect(plan.lines.some(x => x.service === 'processing')).toBe(false);
  });
  it('understands primary service coverage from the legacy shipment key', () => {
    const primary = charge({ serviceId: 'primary', metadata: { kind: 'FBS_PRIMARY_PROCESSING',
      shipmentKey: 'WILDBERRIES:account:supply:WB-1', orderIds: ['81701'], serviceCode: 'ITEM_PROCESSING' } });
    expect(completedWorkPlan(context({ charges: [primary] })).lines.map(x => x.service)).toEqual(['processing', 'additional']);
  });
  it('does not restore obsolete WHITE/GRAY fees as coverage or new services', () => {
    const obsolete = charge({ status: 'CANCELLED', metadata: { ...charge().metadata, kind: 'FBS_PRIMARY_PROCESSING', serviceCode: 'FBS_PRIMARY_WHITE' } });
    expect(completedWorkPlan(context({ charges: [obsolete] })).lines).toHaveLength(3);
  });
  it('fails closed for a missing service or ambiguous charge without order identifiers', () => {
    const plan = completedWorkPlan(context({ charges: [charge({ metadata: { kind: 'FBS' } })],
      config: { ...config, serviceIds: { ...config.serviceIds, primary: null } } }));
    expect(plan.lines.map(x => x.service)).toEqual(['additional']);
    expect(plan.blocked.map(x => x.reason)).toEqual(['AMBIGUOUS_BILLING_IDENTITY', 'SERVICE_TARIFF_MISSING']);
  });
  it('requires a warehouse owned by the work request', () => {
    const plan = completedWorkPlan(context({ requests: [] }));
    expect(plan.lines).toEqual([]);
    expect(plan.blocked[0].reason).toBe('REQUEST_WAREHOUSE_UNKNOWN');
  });
  it('charges relabeling only after confirmation, not a requirement flag', () => {
    expect(completedWorkPlan(context({ work: [work({ relabelRequired: true })] })).lines).toHaveLength(3);
    const plan = completedWorkPlan(context({ work: [work({ relabelConfirmedAt: new Date() })] }));
    expect(plan.lines[3]).toMatchObject({ service: 'relabel', totalRub: 10.64 });
  });
  it('leaves optional primary services disabled', () => {
    expect(completedWorkPlan(context({ config: { ...config, primaryEnabled: false } })).lines).toHaveLength(1);
  });
  it('protects prior 88 orders against a feed containing only 4, also equal-sized replacements', () => {
    expect(preserveBilledComposition({ orderIds: ['1', '2', '3'] }, ['1'])).toBe(true);
    expect(preserveBilledComposition({ orderIds: ['1', '2'] }, ['1', '3'])).toBe(true);
    expect(preserveBilledComposition({ orderIds: ['1'] }, ['1', '2'])).toBe(false);
  });
  it('excludes previous processing from a new shipment, not from its original source', () => {
    const original = charge();
    expect(otherProcessingOrderKeys([original], original.sourceKey).size).toBe(0);
    expect(otherProcessingOrderKeys([original], 'new-shipment').has('WILDBERRIES:account:81701')).toBe(true);
  });
});

// TEST: production writer must lock reads and atomically create only supplementary drafts.
describe('completed work writer', () => {
  function database() {
    const events: string[] = [];
    const rows: any[] = [];
    const invoices: any[] = [];
    const db: any = {
      $queryRaw: vi.fn(async () => { events.push('lock'); }),
      clientFbsBillingSettings: { findUnique: vi.fn(async () => ({ fixedPlusLogisticsEnabled: true, turnkeyEnabled: false,
        fixedPlusLogisticsUnitPriceRub: 37.1, primaryProcessingEnabled: true })) },
      clientBillingService: { findMany: vi.fn(async () => [{ serviceId: 'relabel', priceRub: 10, taxMode: 'ADD_6_PERCENT',
        service: { code: 'NOM_ПЕРЕМАРКИРОВКА' } }]) },
      billingService: { findMany: vi.fn(async () => Object.entries({ fbs: 'FBS_PROCESSING', primary: 'ITEM_PROCESSING',
        additional: 'NOM_ДОПОЛНИТЕЛЬНЫЕ_УСЛУГИ_ПО_УПАКОВКЕ', relabel: 'NOM_ПЕРЕМАРКИРОВКА' }).map(([id, code]) => ({ id, code }))) },
      fbsTsdAssembly: { findMany: vi.fn(async () => { events.push('read'); return [work()]; }) },
      clientRequest: { findMany: vi.fn(async () => [{ id: 'request', warehouseId: 'warehouse' }]) },
      billingCharge: { findMany: vi.fn(async () => rows), createMany: vi.fn(async ({ data }: any) => { rows.push(...data.map((x: any) => ({ ...x, invoiceItems: [{ invoice: { status: 'DRAFT' } }] }))); }) },
      billingInvoice: { createMany: vi.fn(async ({ data }: any) => { invoices.push(...data); }) },
      billingInvoiceItem: { createMany: vi.fn(async ({ data }: any) => {
        for (const item of data) { const row = rows.find(x => x.id === item.chargeId); if (row) row.invoiceItems = [{ invoice: { status: 'DRAFT' } }]; }
      }) }, auditLog: { create: vi.fn(async () => {}) },
    };
    db.$transaction = vi.fn(async (callback: any) => callback(db));
    return { db, rows, invoices, events };
  }
  it('supports read-only preview and creates no invoice in disabled environments', async () => {
    const { db } = database();
    await recoverCompletedWork(db, clientId);
    expect(db.$transaction).not.toHaveBeenCalled();
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const plan = await recoverCompletedWork(db, clientId, { preview: true });
    expect(plan.lines).toHaveLength(3);
    expect(db.billingInvoice.createMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it('creates a 52-ruble processing-only supplement once, under the shared lock', async () => {
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { db, rows, invoices, events } = database();
    await recoverCompletedWork(db, clientId);
    await recoverCompletedWork(db, clientId);
    expect(events[0]).toBe('lock');
    expect(rows).toHaveLength(3);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ totalRub: 52, status: 'DRAFT', warehouseId: 'warehouse' });
    expect(invoices[0].sourceKey.startsWith(`fbs-invoice:${clientId}:completed-work:`)).toBe(true);
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(rows.every(x => x.metadata.billingPolicy === COMPLETED_WORK_POLICY)).toBe(true);
  });
  // TEST: under the new lifecycle picking alone cannot bill; shipment survives deletion/reset of the live task.
  it('bills immutable shipment evidence once instead of mutable completed tasks', async () => {
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
    const { db, rows, invoices } = database();
    const facts: any[] = [];
    db.wbOrderShipment = { findMany: vi.fn(async () => facts) };
    await recoverCompletedWork(db, clientId);
    expect(rows).toHaveLength(0);
    const shippedAt = new Date('2026-09-16T10:00:00Z');
    facts.push({ ...work(), assemblyId: 'assembly', quantity: 1, shippedAt, assemblySnapshot: work() });
    await recoverCompletedWork(db, clientId);
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.serviceDate.toISOString() === shippedAt.toISOString())).toBe(true);
    db.fbsTsdAssembly.findMany.mockResolvedValue([]);
    await recoverCompletedWork(db, clientId);
    expect(rows).toHaveLength(3);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].totalRub).toBe(52);
    // TEST: user-requested repeat is separate completed work even for the same WB order/request/day.
    facts.push({ ...work(), assemblyId: 'repeat', quantity: 1, shippedAt,
      assemblySnapshot: { ...work(), id: 'repeat', billingAttemptId: 'repeat' } });
    await recoverCompletedWork(db, clientId);
    await recoverCompletedWork(db, clientId);
    expect(rows).toHaveLength(6);
    expect(invoices).toHaveLength(2);
    expect(invoices.map(row => row.totalRub)).toEqual([52, 52]);
    expect(rows.filter(row => row.metadata.billingAttemptId === 'repeat')).toHaveLength(3);
  });
  it('attaches an existing uninvoiced charge without recreating or repricing it', async () => {
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { db, rows, invoices } = database();
    rows.push(charge({ requestId: 'request', serviceDate: new Date('2026-09-04T10:00:00Z'),
      description: 'Ранее начисленная обработка', unitPriceRub: 35, totalRub: 35, invoiceItems: [] }));
    const plan = await recoverCompletedWork(db, clientId);
    expect(rows).toHaveLength(3); // existing processing + only two missing services
    expect(plan.blocked).toEqual([]);
    expect(invoices.reduce((sum, i) => sum + i.totalRub, 0)).toBe(49.9);
    const writtenItems = db.billingInvoiceItem.createMany.mock.calls.flatMap(([arg]: any[]) => arg.data);
    expect(writtenItems.find((i: any) => i.chargeId === 'charge')).toMatchObject({ totalRub: 35 });
    expect(plan.lines.some(x => x.existingChargeId === 'charge')).toBe(true);
    await recoverCompletedWork(db, clientId);
    expect(invoices).toHaveLength(1);
  });
  it('does not reattach a charge whose invoice was explicitly cancelled', async () => {
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { db, rows } = database();
    rows.push(charge({ requestId: 'request', serviceDate: new Date(), invoiceItems: [{ invoice: { status: 'CANCELLED' } }] }));
    const plan = await recoverCompletedWork(db, clientId, { preview: true });
    expect(plan.blocked.some(x => x.reason === 'CHARGE_WITHOUT_ACTIVE_INVOICE')).toBe(true);
    expect(plan.lines.every(x => !x.existingChargeId)).toBe(true);
  });
  it('requires every linked order of an orphan to resolve to one branch', async () => {
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { db, rows } = database();
    rows.push(charge({ requestId: null, unitPriceRub: 37.1, serviceDate: new Date(), metadata: { ...charge().metadata, orderIds: ['81701', 'other'] }, invoiceItems: [] }));
    db.fbsOrderRequestLink = { findMany: vi.fn(async () => [{ ...work(), requestId: 'request' }, { ...work(), orderId: 'other', requestId: 'request2' }]) };
    db.clientRequest.findMany.mockResolvedValue([{ id: 'request', warehouseId: 'warehouse' }, { id: 'request2', warehouseId: 'warehouse2' }]);
    const plan = await recoverCompletedWork(db, clientId, { preview: true });
    expect(plan.lines.some(x => x.existingChargeId)).toBe(false);
    expect(plan.blocked.some(x => x.reason === 'CHARGE_WITHOUT_ACTIVE_INVOICE')).toBe(true);
  });
  it('accounts immutable successful attempts after the live task was reset', async () => {
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { db } = database();
    db.fbsTsdAssembly.findMany.mockResolvedValue([]);
    db.fbsAssemblyAttemptHistory = { findMany: vi.fn(async () => [{ ...work(), taskSnapshot: work() }]) };
    expect((await recoverCompletedWork(db, clientId, { preview: true })).lines).toHaveLength(3);
  });
  it('uses bulk writes and different invoices for different warehouses', async () => {
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { db, invoices, rows } = database();
    db.fbsTsdAssembly.findMany.mockResolvedValue(Array.from({ length: 600 }, (_, i) => work({ id: `a${i}`, orderId: `${i}`, requestId: i % 2 ? 'request' : 'request2' })));
    db.clientRequest.findMany.mockResolvedValue([{ id: 'request', warehouseId: 'warehouse' }, { id: 'request2', warehouseId: 'warehouse2' }]);
    await recoverCompletedWork(db, clientId);
    expect(rows).toHaveLength(1800);
    expect(invoices).toHaveLength(2);
    expect(db.billingCharge.createMany).toHaveBeenCalledTimes(4);
    expect(db.billingInvoiceItem.createMany).toHaveBeenCalledTimes(4);
  });
  it('does not create invoices if charge insertion fails', async () => {
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { db } = database();
    db.billingCharge.createMany.mockRejectedValue(new Error('database write failure'));
    await expect(recoverCompletedWork(db, clientId)).rejects.toThrow('database write failure');
    expect(db.billingInvoice.createMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it('does not require WB availability when explicitly recalculating local work', async () => {
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { db } = database();
    const service = new MarketplaceConnectionsService(db, {} as never) as any;
    vi.spyOn(service, 'refreshFbsOrdersCache').mockRejectedValue(new Error('WB unavailable'));
    expect(await service.recalculateFbsDraftBilling(clientId)).toMatchObject({ recalculatedCharges: 3, recalculatedInvoices: 1 });
    expect(service.refreshFbsOrdersCache).not.toHaveBeenCalled();
  });
  it('reports the actual number of invoice groups using Moscow dates', async () => {
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { db, invoices } = database();
    db.fbsTsdAssembly.findMany.mockResolvedValue([work({ completedAt: new Date('2026-09-03T22:00:00Z') }),
      work({ id: 'a2', orderId: 'other', completedAt: new Date('2026-09-04T10:00:00Z') })]);
    const service = new MarketplaceConnectionsService(db, {} as never);
    const result = await service.recalculateFbsDraftBilling(clientId);
    expect(invoices).toHaveLength(1);
    expect(result.recalculatedInvoices).toBe(1);
  });
  it('does not continue recovery after an incompatible tariff change', async () => {
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { db } = database();
    db.clientFbsBillingSettings.findUnique.mockResolvedValue({ turnkeyEnabled: true });
    await expect(recoverCompletedWork(db, clientId)).rejects.toThrow('фиксированного тарифа');
    expect(db.billingInvoice.createMany).not.toHaveBeenCalled();
  });
});

// TEST: reproduce the actual production overwrite, not only the standalone planner.
describe('legacy shipment writer with completed-work accounting', () => {
  const order = { id: '81701', marketplace: 'WILDBERRIES', connectionId: 'account', category: 'shipped',
    itemCount: 1, createdAt: '2026-09-04T10:00:00Z', deliveryDate: '2026-09-04T10:00:00Z', supplyId: 'WB-1' };
  const ownKey = `fbs-calculator:${clientId}:WILDBERRIES:account:supply:WB-1`;
  function setup(existing: any, others: any[] = []) {
    vi.stubEnv('WMS_FBS_COMPLETED_WORK_BILLING_ENABLED', 'true');
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const db: any = { billingCharge: { findUnique: vi.fn(async () => existing), findMany: vi.fn(async () => others),
      update: vi.fn(async ({ data }: any) => ({ id: 'charge', ...data, invoiceItems: [] })),
      create: vi.fn(async ({ data }: any) => ({ id: 'new', ...data, invoiceItems: [] })) },
      billingInvoice: { findUnique: vi.fn(async () => null) } };
    const service = new MarketplaceConnectionsService(db, {} as never) as any;
    vi.spyOn(service, 'ensureFbsBillingBase').mockResolvedValue({ fbsService: { id: 'fbs' }, settings: {
      fixedPlusLogisticsEnabled: true, fixedPlusLogisticsUnitPriceRub: 37.1, primaryProcessingEnabled: false } });
    vi.spyOn(service, 'ensureFbsShipmentInvoices').mockResolvedValue(undefined);
    return { db, service };
  }
  it('does not replace 88 invoiced orders by the single order remaining in WB', async () => {
    const existing = charge({ sourceKey: ownKey, quantity: 88, totalRub: 3264.8,
      metadata: { ...charge().metadata, orderIds: ['81701', ...Array.from({ length: 87 }, (_, i) => `missing-${i}`)] },
      invoiceItems: [{ invoice: { sourceKey: `fbs-invoice:${clientId}:WILDBERRIES:account:supply:WB-1`,
        status: 'DRAFT', number: 'FBS-817', paidRub: 0, _count: { payments: 0 } } }] });
    const { db, service } = setup(existing);
    const result = await service.ensureFbsProcessingChargesLocked(clientId, [order]);
    expect(db.billingCharge.update).not.toHaveBeenCalled();
    expect(result.get('WILDBERRIES:account:81701').totalRub).toBe(37.1);
    expect(service.ensureFbsShipmentInvoices).toHaveBeenCalledWith(clientId, [], result);
  });
  it('does not charge processing twice when a recovered order appears in a new supply', async () => {
    const { db, service } = setup(null, [charge()]);
    await service.ensureFbsProcessingChargesLocked(clientId, [order]);
    expect(db.billingCharge.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      metadata: expect.objectContaining({ processingOrderIds: [], logisticsTrip: expect.objectContaining({ totalWithoutLogisticsRub: 0 }) }) }) }));
  });
  it('allocates processing only to newly billable orders in a mixed shipment', async () => {
    const { db, service } = setup(null, [charge()]);
    const result = await service.ensureFbsProcessingChargesLocked(clientId, [order, { ...order, id: 'new-order' }]);
    expect(result.get('WILDBERRIES:account:81701').breakdown.fbsProcessingRub).toBe(0);
    expect(result.get('WILDBERRIES:account:new-order').breakdown.fbsProcessingRub).toBe(37.1);
    expect(db.billingCharge.create.mock.calls[0][0].data.metadata.processingOrderIds).toEqual(['new-order']);
  });
  it('does not attribute a preserved old invoice to an order absent from its snapshot', async () => {
    const existing = charge({ sourceKey: ownKey, metadata: { ...charge().metadata, orderIds: ['81701', 'missing'] } });
    const { service } = setup(existing);
    const result = await service.ensureFbsProcessingChargesLocked(clientId, [order, { ...order, id: 'new-order' }]);
    expect(result.has('WILDBERRIES:account:new-order')).toBe(false);
  });
});

// TEST: the real merge preview counts recovered orders without offering fictitious shipment days.
it('includes completed-work supplements in the merge with zero logistics days', async () => {
  const lines = completedWorkPlan(context()).lines;
  const invoice = { id: 'supplement', clientId, warehouseId: 'warehouse', sourceKey: `fbs-invoice:${clientId}:completed-work:test`,
    number: 'FBS-WORK-1', status: 'DRAFT', periodFrom: lines[0].serviceDate, periodTo: lines[0].serviceDate,
    items: lines.map((line, i) => ({ ...line, charge: { ...line, id: `charge-${i}` } })) };
  const db: any = { client: { findUnique: vi.fn(async () => ({ id: clientId, code: 'CL-000001', name: 'Лукин' })) },
    billingInvoice: { findMany: vi.fn(async () => [invoice]) },
    clientFbsBillingSettings: { findUnique: vi.fn(async () => ({ primaryProcessingEnabled: true })) },
    fbsOrderRequestLink: { findMany: vi.fn(async () => []) }, fbsTsdAssembly: { findMany: vi.fn(async () => [work()]) } };
  const service = new BillingService(db, { requireClientAccess: vi.fn() } as never);
  const preview = await service.getFbsMergePreview(clientId, { role: 'OWNER', warehouseId: 'warehouse' } as never);
  expect(preview.orders).toEqual([{ orderId: '81701', itemCount: 1, date: '2026-09-04' }]);
  expect(preview.processingTotalRub).toBe(37.1);
  expect(preview.primaryProcessing.totalRub).toBe(14.9);
  expect(preview.primaryProcessing.shipments).toBe(0);
  expect(preview.logisticsDays).toEqual([]);
});
