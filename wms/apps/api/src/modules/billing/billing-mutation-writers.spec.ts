import { describe, expect, it, vi } from 'vitest';
import { BillingService } from './billing.service';
import { ClientScopeService } from '../auth/client-scope.service';

const user: any = { id: 'u', permissionCodes: ['billing:write'], roleCodes: ['MANAGER'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [], activeWarehouseId: 'w1', writableWarehouseIds: ['w1'] };
function setup(patch: any = {}) {
  const invoice: any = { id: 'i1', number: 'INV-1', clientId: 'c1', warehouseId: 'w1', request: null,
    status: 'DRAFT', paidRub: 0, totalRub: 100, issuedAt: null, paidAt: null, comment: '', payments: [], ...patch };
  const payments: any[] = [];
  let tail = Promise.resolve();
  const db: any = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    billingInvoice: {
      findUnique: vi.fn(async () => ({ ...invoice, payments: [...payments] })),
      findMany: vi.fn(async () => [{ ...invoice, payments: [...payments] }]),
      update: vi.fn(async ({ data }: any) => { Object.assign(invoice, data); return { ...invoice, payments: [...payments] }; }),
    },
    billingPayment: { create: vi.fn(async ({ data }: any) => { payments.push(data); return data; }) },
    client: { findUnique: vi.fn(async () => ({ id: 'c1', name: 'Клиент', code: '001' })) },
    clientNotificationPreference: { findUnique: vi.fn(async () => ({ isEnabled: false })) },
    auditLog: { create: vi.fn() },
  };
  db.$transaction = vi.fn((fn: any) => {
    const next = tail.then(() => fn(db));
    tail = next.then(() => undefined, () => undefined);
    return next;
  });
  return { db, invoice, payments, service: new BillingService(db, new ClientScopeService()) };
}

describe('legacy invoice mutation safety', () => {
  // TEST: the eligibility read must happen after the common financial transaction lock.
  it('serializes concurrent payments and rechecks the actual remaining balance', async () => {
    const { service, payments, invoice } = setup();
    const results = await Promise.allSettled([
      service.createPayment({ invoiceId: 'i1', amountRub: 60 } as any, user),
      service.createPayment({ invoiceId: 'i1', amountRub: 60 } as any, user),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(payments).toHaveLength(1);
    expect(invoice.paidRub).toBe(60);
  });
  // TEST: known IDs do not bypass the selected branch, even for admins.
  it.each([user, { ...user, permissionCodes: ['system:admin'] }])('blocks cross-branch direct payment', async actor => {
    const { service, db } = setup({ warehouseId: 'w2' });
    await expect(service.createPayment({ invoiceId: 'i1', amountRub: 10 } as any, actor)).rejects.toThrow(/филиал/);
    expect(db.billingPayment.create).not.toHaveBeenCalled();
  });
  it('resolves legacy invoice branch from its linked request without guessing', async () => {
    const { service, payments } = setup({ warehouseId: null, request: { warehouseId: 'w1' } });
    await service.createPayment({ invoiceId: 'i1', amountRub: 10 } as any, user);
    expect(payments).toHaveLength(1);
    const unknown = setup({ warehouseId: null });
    await expect(unknown.service.createPayment({ invoiceId: 'i1', amountRub: 10 } as any, user)).rejects.toThrow(/филиал/);
  });
  // TEST: a previously merged source cannot be paid or reactivated even if its status was corrupt.
  it('refuses payment and reactivation of merged source invoices', async () => {
    const { service, db } = setup({ comment: 'Объединено в счёт INV-2.', status: 'ISSUED' });
    await expect(service.createPayment({ invoiceId: 'i1', amountRub: 10 } as any, user)).rejects.toThrow(/объедин/);
    await expect(service.updateInvoiceStatus('i1', { status: 'DRAFT' } as any, user)).rejects.toThrow(/объедин/);
    expect(db.billingInvoice.update).not.toHaveBeenCalled();
  });
  it('checks branch scope for incoming payment allocations', async () => {
    const { service, db } = setup({ warehouseId: 'w2' });
    await expect(service.createIncomingPayment({ clientId: 'c1', totalRub: 10, allocations: [{ invoiceId: 'i1', amountRub: 10 }] } as any, user)).rejects.toThrow(/филиал/);
    expect(db.billingPayment.create).not.toHaveBeenCalled();
  });
  // TEST: all direct invoice mutators use the same branch boundary, not only payment.
  it('rejects cross-branch editing, account changes and status changes', async () => {
    const { service, db } = setup({ warehouseId: 'w2' });
    await expect(service.updateManualInvoice('i1', { clientId: 'c1', rows: [{ description: 'Услуга', quantity: 1, unitPriceRub: 100 }] } as any, user)).rejects.toThrow(/филиал/);
    await expect(service.updateInvoicePaymentAccount('i1', {} as any, user)).rejects.toThrow(/филиал/);
    await expect(service.updateInvoiceStatus('i1', { status: 'ISSUED' } as any, user)).rejects.toThrow(/филиал/);
    expect(db.billingInvoice.update).not.toHaveBeenCalled();
  });
  it('checks writable client scope before writing', async () => {
    const { service, payments } = setup();
    await expect(service.createPayment({ invoiceId: 'i1', amountRub: 10 } as any,
      { ...user, clientScopeMode: 'LIMITED', clientIds: ['c1'], writableClientIds: [] })).rejects.toThrow(/доступ/);
    expect(payments).toHaveLength(0);
  });
  // TEST: direct charge-based creation cannot race another legacy create for the same source.
  it('creates one invoice when two requests concurrently select the same charge', async () => {
    const { db } = setup();
    let invoiced = false;
    db.billingCharge = { findMany: vi.fn(async () => invoiced ? [] : [{ id: 'ch1', clientId: 'c1', metadata: { warehouseId: 'w1' },
      description: 'Услуга', unit: 'PIECE', quantity: 1, unitPriceRub: 100, totalRub: 100, serviceDate: new Date('2026-08-10') }]) };
    db.billingInvoice.count = vi.fn(async () => 0);
    db.billingInvoice.create = vi.fn(async () => { invoiced = true; return { id: 'new', number: 'NEW' }; });
    const service = new BillingService(db, new ClientScopeService());
    const dto = { clientId: 'c1', chargeIds: ['ch1'], periodFrom: '2026-08-01', periodTo: '2026-08-31' };
    const results = await Promise.allSettled([service.createInvoice(dto, user), service.createInvoice(dto, user)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(db.billingInvoice.create).toHaveBeenCalledTimes(1);
    expect(db.billingCharge.findMany.mock.calls[0][0].where.OR).toEqual([
      { request: { warehouseId: 'w1' } }, { requestId: null, metadata: { path: ['warehouseId'], equals: 'w1' } },
    ]);
  });
  // TEST: sending a notification cannot run before the outer financial commit succeeds.
  it('delivers payment notification only after the outer transaction commits', async () => {
    const { db } = setup();
    let committed = false;
    const original = db.$transaction;
    db.$transaction = async (callback: any) => { const result = await original(callback); committed = true; return result; };
    const telegram = { notifyClient: vi.fn(async () => { expect(committed).toBe(true); }) };
    const service = new BillingService(db, new ClientScopeService(), telegram as any);
    await service.createPayment({ invoiceId: 'i1', amountRub: 10 } as any, user);
    expect(telegram.notifyClient).toHaveBeenCalledTimes(1);
  });
  // TEST: changing the visible period must create an actual period document, not relabel a day invoice.
  it('creates a monthly snapshot from a singleton daily draft instead of returning it unchanged', async () => {
    const source: any = { id: 'day', number: 'DAY', clientId: 'c1', warehouseId: 'w1', status: 'DRAFT', paidRub: 0, payments: [],
      periodFrom: new Date('2026-08-10'), periodTo: new Date('2026-08-10T23:59:59.999Z'),
      items: [{ chargeId: 'ch1', description: 'FBS', unit: 'PIECE', quantity: 1, unitPriceRub: 100, totalRub: 100, serviceDate: new Date('2026-08-10') }] };
    const db: any = { billingInvoiceItem: { count: vi.fn(async () => 0) }, billingInvoice: {
      count: vi.fn(async () => 1), create: vi.fn(async () => ({ id: 'month', number: 'MONTH' })), updateMany: vi.fn(async () => ({ count: 1 })),
    }, auditLog: { create: vi.fn() } };
    const service = new BillingService(db, new ClientScopeService());
    const result = await service.writePeriodDraft(db, { clientId: 'c1', warehouseId: 'w1', category: 'FBS', periodFrom: '2026-08-01', periodTo: '2026-08-31', sourceKey: 'period', charges: [], invoices: [source] }, user);
    expect(result.id).toBe('month');
    expect(db.billingInvoice.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('storage charge proven branch attribution', () => {
  const dto = { clientId: 'c1', periodFrom: '2026-08-01', periodTo: '2026-08-03', unitPriceRub: 0.5, approve: true };
  function storage(warehouses: Array<string | null>, mode: 'ledger' | 'snapshot' = 'ledger', existing = false) {
    const { db } = setup();
    db.client.findUnique.mockResolvedValue({ storageAccountingEnabled: true, storagePriceRubPerLiterDay: 0.5 });
    db.billingService = { upsert: vi.fn(async () => ({ id: 'storage', defaultPriceRub: 0.5 })) };
    db.billingCharge = { findFirst: vi.fn(async () => existing ? { id: 'charge', invoiceItems: [] } : null),
      create: vi.fn(async ({ data }: any) => data), update: vi.fn(async ({ data }: any) => data) };
    const rows = warehouses.map((warehouseId, index) => ({ warehouseId, skuId: `sku-${index}`, type: 'RECEIPT', status: 'AVAILABLE', quantity: 2,
      createdAt: new Date('2026-07-31T12:00:00Z'), sku: { id: `sku-${index}`, internalSku: `SKU-${index}`, name: 'Товар', volumeLiters: 1.5 } }));
    db.stockMovement = { findMany: vi.fn(async () => mode === 'ledger' ? rows : []) };
    db.stockBalance = { findMany: vi.fn(async () => rows) };
    return { db, service: new BillingService(db, new ClientScopeService()) };
  }
  // TEST: newly generated storage charges are invoiceable only with source-proven attribution.
  it.each(['ledger', 'snapshot'] as const)('stores a proven single branch from %s without changing the storage formula', async mode => {
    const { service, db } = storage(['w1'], mode);
    const result: any = await service.generateStorageCharge(dto, user);
    expect(result.metadata.warehouseId).toBe('w1');
    expect(result.quantity).toBe(9);
    expect(result.totalRub).toBe(4.5);
    if (mode === 'ledger') expect(db.stockMovement.findMany.mock.calls[0][0].select.warehouseId).toBe(true);
  });
  it('adds proven attribution when recalculating an uninvoiced charge', async () => {
    const { service, db } = storage(['w1'], 'ledger', true);
    await service.generateStorageCharge(dto, user);
    expect(db.billingCharge.update.mock.calls[0][0].data.metadata.warehouseId).toBe('w1');
    expect(db.billingCharge.create).not.toHaveBeenCalled();
  });
  it.each([['w1', 'w2'], ['w1', null], [null], ['w2']])('refuses ambiguous or inaccessible branch %j before any billing write', async (...warehouseValues) => {
    const { service, db } = storage(warehouseValues as Array<string | null>);
    await expect(service.generateStorageCharge(dto, user)).rejects.toThrow(/филиал/);
    expect(db.billingCharge.create).not.toHaveBeenCalled();
    expect(db.billingCharge.update).not.toHaveBeenCalled();
    expect(db.billingService.upsert).not.toHaveBeenCalled();
  });
});
