import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { branchScopedFbsDateKey, loadFbsDateBillingBranches } from '../src/modules/marketplace-connections/fbs-billing-shipment-key';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const key = 'WILDBERRIES:account:date:2026-08-23';
const order = (id: string, warehouseId: string, extra = {}) => ({
  id, marketplace: 'WILDBERRIES', connectionId: 'account', supplyId: null,
  createdAt: '2026-08-23T10:00:00Z', deliveryDate: '2026-08-23T10:00:00Z', itemCount: 1,
  request: { id: `request-${warehouseId}`, warehouseId }, ...extra,
});
function fixture() {
  vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
  vi.stubEnv('WMS_FBS_DATE_BRANCH_BILLING_ENABLED', 'true');
  const invoices: any[] = [];
  const legacyCharges: any[] = [];
  const charges = ['1', '2', '3', '4'].map(id => ({ id: `charge-${id}`, clientId: 'client',
    description: 'FBS', unit: 'PIECE', quantity: 1, unitPriceRub: 45, totalRub: 45,
    serviceDate: new Date('2026-08-23') }));
  const db: any = {
    billingInvoice: {
      findMany: vi.fn(async () => invoices),
      findUnique: vi.fn(async ({ where }: any) => invoices.find(i => i.sourceKey === where.sourceKey) ?? null),
      count: vi.fn(async () => invoices.length),
      create: vi.fn(async ({ data }: any) => { const i = { id: `invoice-${invoices.length}`, ...data }; invoices.push(i); return i; }),
      findFirst: vi.fn(async ({ where }: any) => invoices.find(i => i.id === where.id)),
      update: vi.fn(async () => ({})),
    },
    billingCharge: { findMany: vi.fn(async ({ where }: any) => where.id
      ? charges.filter(c => where.id.in.includes(c.id)) : legacyCharges) },
    billingInvoiceItem: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(async (cb: any) => cb(db)),
  };
  const service: any = new MarketplaceConnectionsService(db, {} as never);
  service.fbsDisplayCache.stop();
  const billing = new Map(charges.map((c, index) => [`WILDBERRIES:account:${index + 1}`, { chargeId: c.id }]));
  const orders = [order('1', 'kazan'), order('2', 'kazan'), order('3', 'kazan'), order('4', 'moscow')];
  return { db, invoices, legacyCharges, service, billing, orders,
    run: (rows = orders) => service.ensureFbsShipmentInvoicesLocked('client', rows, billing) };
}

// TEST: reproduce Bushkova 23 Aug: request 369 (Kazan) and 355 (Moscow), no real supply ID.
describe('FBS date groups respect execution branches', () => {
  it('creates separate invoices for three Kazan orders and one Moscow order', async () => {
    const f = fixture();
    await f.run();
    expect(f.invoices.map(i => [i.warehouseId, i.totalRub])).toEqual([['kazan', 135], ['moscow', 45]]);
    expect(new Set(f.invoices.map(i => i.sourceKey)).size).toBe(2);
    expect(f.invoices[0].items.create.map((i: any) => i.chargeId)).toEqual(['charge-1', 'charge-2', 'charge-3']);
  });

  it('retains branch keys when a later refresh contains only one branch', async () => {
    const f = fixture(); await f.run();
    await f.run([f.orders[3]]);
    expect(f.db.billingInvoice.create).toHaveBeenCalledTimes(2);
  });

  it('still rejects a real supply containing two branches before invoice creation', async () => {
    const f = fixture();
    await expect(f.run(f.orders.map(o => ({ ...o, supplyId: 'WB-GI-real', shipmentPlan: {} }))))
      .rejects.toThrow('заказы разных филиалов');
    expect(f.db.billingInvoice.create).not.toHaveBeenCalled();
  });

  it('leaves the sold/default policy unchanged when the rollout flag is off', async () => {
    const f = fixture(); vi.stubEnv('WMS_FBS_DATE_BRANCH_BILLING_ENABLED', 'false');
    await expect(f.run()).rejects.toThrow('заказы разных филиалов');
    expect(f.db.billingInvoice.findMany).not.toHaveBeenCalled();
  });

  // TEST: all old invoice states retain their source identity, including cancelled merge sources.
  it.each(['DRAFT', 'SENT', 'PAID', 'CANCELLED'])('preserves the legacy %s Kazan invoice, creates only the Moscow invoice', async status => {
    const f = fixture();
    f.invoices.push({ id: 'old', sourceKey: `fbs-invoice:client:${key}`, warehouseId: 'kazan',
      number: 'old-number', status, totalRub: 135 });
    await f.run();
    expect(f.db.billingInvoice.create).toHaveBeenCalledTimes(1);
    expect(f.db.billingInvoice.create.mock.calls[0][0].data.warehouseId).toBe('moscow');
    expect(f.invoices[0].sourceKey).toBe(`fbs-invoice:client:${key}`);
  });

  it('refuses to guess a branch for an orphan legacy charge', async () => {
    const f = fixture();
    f.legacyCharges.push({ sourceKey: `fbs-calculator:client:${key}`, request: null, invoiceItems: [] });
    await expect(f.run()).rejects.toThrow('филиал старого начисления');
    expect(f.db.billingInvoice.create).not.toHaveBeenCalled();
  });

  it('refuses conflicting legacy primary and FBS invoice branches before writes', async () => {
    const f = fixture();
    f.invoices.push({ sourceKey: `fbs-invoice:client:${key}`, warehouseId: 'kazan' },
      { sourceKey: `fbs-primary-invoice:client:${key}`, warehouseId: 'moscow' });
    await expect(f.run()).rejects.toThrow('филиал старого начисления');
    expect(f.db.billingInvoice.create).not.toHaveBeenCalled();
  });

  it('does not mistake scoped primary charges or another attempt for old date charges', async () => {
    const f = fixture();
    f.legacyCharges.push(...['warehouse:kazan:SERVICE:one', 'warehouse:moscow:WHITE', 'attempt:old:SERVICE:one']
      .map(suffix => ({ sourceKey: `fbs-primary:client:${key}:${suffix}`, request: null, invoiceItems: [] })));
    await f.run(); expect(f.invoices).toHaveLength(2);
  });

  it('uses the original primary invoice branch even when FBS has not been invoiced yet', async () => {
    const f = fixture();
    f.invoices.push({ sourceKey: `fbs-primary-invoice:client:${key}`, warehouseId: 'kazan' });
    await f.run();
    expect(f.db.billingInvoice.create.mock.calls.map(([args]: any) => args.data.sourceKey))
      .toEqual([`fbs-invoice:client:${key}`, `fbs-invoice:client:${key}:warehouse:moscow`]);
  });

  it('takes request branch before reservation, and reservation when the request branch is absent', () => {
    const branches = new Map<string, string>();
    expect(branchScopedFbsDateKey(key, order('1', 'kazan', { reservation: { warehouseId: 'moscow' } }), branches))
      .toBe(`${key}:warehouse:kazan`);
    expect(branchScopedFbsDateKey(key, order('1', '', { reservation: { warehouseId: 'moscow' } }), branches))
      .toBe(`${key}:warehouse:moscow`);
  });

  it('does not assign an unknown order to a known legacy invoice branch', () => {
    expect(() => branchScopedFbsDateKey(key, order('1', ''), new Map([[key, 'kazan']])))
      .toThrow('Не определён филиал');
  });

  it('requires lifecycle duplicate protection and performs no extra reads when it is off', async () => {
    const f = fixture(); vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'false');
    expect(await loadFbsDateBillingBranches(f.db, 'client', f.orders, () => key)).toBeUndefined();
    expect(f.db.billingInvoice.findMany).not.toHaveBeenCalled();
  });

  it('applies the same date rule to Ozon without altering real Ozon supply keys', () => {
    const ozonKey = 'OZON:seller:date:2026-08-23';
    expect(branchScopedFbsDateKey(ozonKey, order('1', 'moscow'), new Map())).toBe(`${ozonKey}:warehouse:moscow`);
    expect(branchScopedFbsDateKey('OZON:seller:supply:track', order('1', 'moscow', { supplyId: 'track' }), new Map()))
      .toBe('OZON:seller:supply:track');
  });

  // TEST: exercise the charge writer too: invoice grouping alone cannot prevent mixed source charges.
  it('creates branch-specific charges and does not duplicate them on repeat calculation', async () => {
    const f = fixture();
    const stored: any[] = [];
    f.db.billingCharge.findMany.mockImplementation(async ({ where }: any) =>
      where.sourceKey?.in ? stored.filter(c => where.sourceKey.in.includes(c.sourceKey)) : stored);
    f.db.billingCharge.findUnique = vi.fn(async ({ where }: any) => stored.find(c => c.sourceKey === where.sourceKey) ?? null);
    f.db.billingCharge.create = vi.fn(async ({ data }: any) => {
      const charge = { id: `new-${stored.length}`, ...data, request: { warehouseId: data.requestId.replace('request-', '') }, invoiceItems: [] };
      stored.push(charge); return charge;
    });
    f.db.billingCharge.update = vi.fn(() => { throw new Error('Existing financial snapshot must not be rewritten'); });
    vi.spyOn(f.service, 'ensureFbsBillingBase').mockResolvedValue({ fbsService: { id: 'service' },
      settings: { turnkeyEnabled: true, turnkeyUnitPriceRub: 45, primaryProcessingEnabled: false } });
    vi.spyOn(f.service, 'ensureFbsShipmentInvoices').mockResolvedValue(undefined);
    const first = await f.service.ensureFbsProcessingChargesLocked('client', f.orders);
    expect(stored.map(c => [c.requestId, c.totalRub, c.metadata.orderIds])).toEqual([
      ['request-kazan', 135, ['1', '2', '3']], ['request-moscow', 45, ['4']],
    ]);
    expect(first.get('WILDBERRIES:account:4').totalRub).toBe(45);
    await f.service.ensureFbsProcessingChargesLocked('client', [f.orders[3]]);
    expect(f.db.billingCharge.create).toHaveBeenCalledTimes(2);
    expect(f.db.billingCharge.update).not.toHaveBeenCalled();
  });
});
