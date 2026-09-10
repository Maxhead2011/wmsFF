import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const order = (connectionId = 'connection-1', extra = {}) => ({
  id: '1', marketplace: 'WILDBERRIES', connectionId, supplyId: 'supply-1',
  shipmentPlan: { destination: 'VNUKOVO_SORTING_CENTER' }, ...extra,
});

// TEST: preserve the existing live local-only recovery contract without changing WB metadata policy.
describe('live SOS WB recovery compatibility', () => {
  function fixture(link: any) {
    const kiz = '010460000000000021TEST12345';
    const task = { id: 'task-1', clientId: 'client-1', requestId: 'request-1', connectionId: 'connection-1',
      orderId: '5600000001', skuId: 'sku-1', status: 'IN_PROGRESS', workerUserId: 'worker-1',
      deviceCode: 'SOS-WB:TSD-1', barcode: '4600000000012', barcodes: ['4600000000012'],
      boxId: null, boxCode: 'БЕЗ КОРОБА', productName: 'Товар', article: 'ART', kiz: null };
    const tx = {
      fbsTsdAssembly: { updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ ...task, kiz, status: 'COMPLETED' }) },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const db = {
      fbsTsdAssembly: { findUnique: vi.fn().mockResolvedValue(task), findFirst: vi.fn().mockResolvedValue(null) },
      productMark: { findFirst: vi.fn().mockResolvedValue(null) },
      fbsOrderRequestLink: { findUnique: vi.fn().mockResolvedValue(link) },
      clientMarketplaceConnection: { findFirst: vi.fn().mockResolvedValue({ apiKey: 'synthetic-key' }) },
      clientRequest: { findUnique: vi.fn().mockResolvedValue({ number: 1 }) },
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    };
    const service: any = new MarketplaceConnectionsService(db as never, { requireClientAccess: vi.fn() } as never);
    vi.spyOn(service, 'findPreviousWildberriesKizUsage').mockResolvedValue(null);
    const preflight = vi.spyOn(service, 'loadWildberriesFbsKizPreflight').mockResolvedValue({
      alreadyAttached: true, remoteKizValues: [kiz], supplierStatus: 'confirm',
    });
    const accepted = vi.spyOn(service, 'recordAcceptedFbsKizScan').mockResolvedValue(undefined);
    const fetch = vi.fn().mockRejectedValue(new Error('Unexpected WB network mutation'));
    vi.stubGlobal('fetch', fetch);
    return { db, tx, task, preflight, accepted, fetch, run: () => service.acceptSosWbKiz(task.id,
      { kiz, deviceCode: 'TSD-1' }, { id: 'worker-1', name: 'Сборщик' }) };
  }

  it.each([{ lastCategory: 'shipped', lastSupplierStatus: 'confirm' },
    { lastCategory: 'active', lastSupplierStatus: 'complete' }])('records shipped local recovery without a WB call: %j', async status => {
    const f = fixture({ requestId: 'request-1', syncStatus: 'ACTIVE', ...status });
    await expect(f.run()).resolves.toMatchObject({ completed: true, sourceBoxPending: true,
      message: expect.stringContaining('КИЗ принят локально в WMS') });
    expect(f.preflight).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.tx.fbsTsdAssembly.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workerUserId: 'worker-1', deviceCode: 'SOS-WB:TSD-1', kiz: null, completedAt: null }),
      data: expect.objectContaining({ wbMetaStatus: 'ACCEPTED', sourceBoxPending: true, status: 'COMPLETED' }),
    }));
    expect(f.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'SOS_WB_ORDER_COMPLETED', payload: expect.objectContaining({ wbMutationPerformed: false }) }),
    }));
    expect(f.accepted).toHaveBeenCalledTimes(1);
  });

  it.each([null, { requestId: 'other-request', syncStatus: 'ACTIVE', lastCategory: 'shipped' },
    { requestId: 'request-1', syncStatus: 'REMOVED', lastCategory: 'shipped' },
    { requestId: 'request-1', syncStatus: 'ACTIVE', lastCategory: 'active', lastSupplierStatus: 'confirm' },
  ])('does not infer local-only recovery from an absent or mismatched shipped link: %j', async link => {
    const f = fixture(link);
    await f.run();
    expect(f.preflight).toHaveBeenCalledTimes(1);
    expect(f.fetch).not.toHaveBeenCalled(); // The KIZ is already attached in this preflight fixture.
  });

  it('does not acknowledge completion after a concurrent owner change', async () => {
    const f = fixture({ requestId: 'request-1', syncStatus: 'ACTIVE', lastCategory: 'shipped' });
    f.tx.fbsTsdAssembly.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.run()).rejects.toMatchObject({ response: expect.objectContaining({ code: 'SOS_WB_TASK_STALE' }) });
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    expect(f.accepted).not.toHaveBeenCalled();
  });
});

// TEST: a shared TSD can park closed work without deleting physical scan evidence.
describe('closed FBS assignment parking', () => {
  function fixture(status: string | null = 'DONE', changed = 1) {
    const task = { id: 'task-1', requestId: 'request-1', status: 'IN_PROGRESS', deviceCode: 'TSD-1',
      workerUserId: 'worker-1', updatedAt: new Date('2026-09-09'), boxId: 'box-1', barcode: 'barcode', kiz: 'kiz' };
    const updateMany = vi.fn().mockResolvedValue({ count: changed });
    const service: any = new MarketplaceConnectionsService({
      clientRequest: { findUnique: vi.fn().mockResolvedValue(status ? { id: 'request-1', status } : null) },
      fbsTsdAssembly: { updateMany },
    } as never, {} as never);
    return { task, updateMany, run: () => service.parkFbsTsdAssignmentFromClosedRequest(task) };
  }

  it.each(['DONE', 'CANCELLED', null])('parks %s work with an exact ownership and version predicate', async status => {
    const f = fixture(status);
    await expect(f.run()).resolves.toBe(true);
    expect(f.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-1', status: 'IN_PROGRESS', deviceCode: 'TSD-1', workerUserId: 'worker-1', updatedAt: f.task.updatedAt },
      data: expect.objectContaining({ status: 'RETURN_REQUIRED', workerUserId: null }),
    }));
    for (const field of ['barcode', 'kiz', 'boxId', 'sourceBarcode', 'completedAt'])
      expect(f.updateMany.mock.calls[0][0].data).not.toHaveProperty(field);
  });

  it('leaves an open request assigned', async () => {
    const f = fixture('IN_WORK');
    await expect(f.run()).resolves.toBe(false);
    expect(f.updateMany).not.toHaveBeenCalled();
  });

  it('rejects the stale assignment after losing the conditional parking race', async () => {
    const f = fixture('DONE', 0);
    await expect(f.run()).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FBS_TASK_STALE' }) });
  });

  // TEST: the public queue must not format or return the stale task after the failed CAS.
  it('does not return stale work from public getNext after a concurrent owner change during parking', async () => {
    const task = { id: 'task-1', requestId: 'closed-request', clientId: 'client-1', status: 'IN_PROGRESS',
      deviceCode: 'TSD-1', workerUserId: 'worker-1', updatedAt: new Date('2026-09-09'),
      boxId: 'box-1', barcode: 'barcode', kiz: 'kiz' };
    const db = {
      fbsTsdAssembly: { findFirst: vi.fn().mockResolvedValue(task), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      clientRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'closed-request', status: 'DONE' }) },
    };
    const service: any = new MarketplaceConnectionsService(db as never, { requireClientAccess: vi.fn() } as never);
    const format = vi.spyOn(service, 'formatFbsTsdAssembly');
    await expect(service.getNextFbsTsdAssembly('TSD-1', { id: 'worker-1', name: 'Сборщик' }, 'closed-request'))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'FBS_TASK_STALE' }) });
    expect(format).not.toHaveBeenCalled();
    expect(db.fbsTsdAssembly.findFirst).toHaveBeenCalledTimes(1);
    expect(db.fbsTsdAssembly.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: task.id, workerUserId: task.workerUserId, updatedAt: task.updatedAt }),
    }));
  });
});

// TEST: preserve the live branch fallback and the billing transaction in one real service call.
describe('live FBS warehouse fallback with billing serialization', () => {
  function fixture(connections: any[] = [{ id: 'connection-1', fbsExecutionWarehouseId: 'warehouse-1' }]) {
    const events: string[] = [];
    const tx: any = {
      $queryRaw: vi.fn(async () => { events.push('lock'); return []; }),
      clientMarketplaceConnection: { findMany: vi.fn(async ({ where }: any) => {
        events.push('connections');
        return connections.filter(connection => where.id.in.includes(connection.id));
      }) },
      warehouseClient: { findMany: vi.fn(async () => { events.push('warehouse-links'); return []; }) },
      billingInvoice: {
        findUnique: vi.fn(async () => { events.push('invoice-read'); return null; }),
        create: vi.fn(async ({ data }: any) => { events.push('invoice-create'); return { id: 'invoice-1', ...data }; }),
        count: vi.fn(async () => 0),
        findFirst: vi.fn(async () => null),
      },
      billingCharge: { findMany: vi.fn(async () => { events.push('charge-read'); return [{
        id: 'charge-1', clientId: 'client-1', description: 'FBS', unit: 'PIECE', quantity: 1,
        unitPriceRub: 100, totalRub: 100, serviceDate: new Date('2026-09-09T00:00:00Z'),
      }]; }) },
    };
    // Only the transaction client exposes model delegates: accidental root DB use must fail.
    const db = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    const billing = new Map([['WILDBERRIES:connection-1:1', {
      chargeId: 'charge-1', totalRub: 100, invoiceNumber: null, invoiceStatus: null,
    }]]);
    return { service, db, tx, events, billing,
      // Mixed source IDs are validated directly: invoicing groups each connection separately.
      resolve: (orders: any[]) => (new MarketplaceConnectionsService(tx, {} as never) as any)
        .resolveFbsShipmentWarehouseId('client-1', orders),
      run: (orders = [order()]) => service.ensureFbsShipmentInvoices('client-1', orders, billing) };
  }

  it('creates the invoice in the configured connection branch after acquiring the financial lock', async () => {
    const f = fixture();
    await f.run();
    expect(f.events[0]).toBe('lock');
    expect(f.events.indexOf('connections')).toBeLessThan(f.events.indexOf('invoice-create'));
    expect(f.tx.billingInvoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clientId: 'client-1', warehouseId: 'warehouse-1', totalRub: 100 }),
    }));
    expect(f.tx.clientMarketplaceConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['connection-1'] }, clientId: 'client-1', isActive: true },
    }));
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.tx.warehouseClient.findMany).not.toHaveBeenCalled();
  });

  it.each(['request', 'reservation'])('keeps the already known %s branch ahead of connection fallback', async source => {
    const f = fixture();
    await f.run([order('connection-1', { [source]: { warehouseId: 'known-warehouse' } })]);
    expect(f.tx.billingInvoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ warehouseId: 'known-warehouse' }),
    }));
    expect(f.tx.clientMarketplaceConnection.findMany).not.toHaveBeenCalled();
  });

  it('rejects conflicting configured branches before writing a financial record', async () => {
    const f = fixture([{ id: 'connection-1', fbsExecutionWarehouseId: 'warehouse-1' },
      { id: 'connection-2', fbsExecutionWarehouseId: 'warehouse-2' }]);
    await expect(f.resolve([order(), order('connection-2')])).rejects.toThrow('подключения разных филиалов');
    expect(f.tx.billingInvoice.create).not.toHaveBeenCalled();
  });

  it.each([
    { connections: [] },
    { connections: [{ id: 'connection-1', fbsExecutionWarehouseId: 'warehouse-1' }] },
    { connections: [{ id: 'connection-1', fbsExecutionWarehouseId: 'warehouse-1' }, { id: 'connection-2', fbsExecutionWarehouseId: null }] },
  ])('does not choose a branch from unresolved or partially configured connections: %j', async ({ connections }) => {
    const f = fixture(connections);
    await expect(f.resolve([order(), order('connection-2')])).rejects.toThrow('филиал');
    expect(f.tx.billingInvoice.create).not.toHaveBeenCalled();
  });

  it('retains the single active client branch fallback when no connection branch is configured', async () => {
    const f = fixture([{ id: 'connection-1', fbsExecutionWarehouseId: null }]);
    f.tx.warehouseClient.findMany.mockResolvedValue([{ warehouseId: 'only-warehouse' }]);
    await f.run();
    expect(f.tx.billingInvoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ warehouseId: 'only-warehouse' }),
    }));
    expect(f.tx.warehouseClient.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clientId: 'client-1', status: 'ACTIVE', warehouse: { isActive: true } },
    }));
  });

  // TEST: this pre-existing fallback is intentionally retained even when the active connection lookup is empty.
  it('retains the legacy single active client branch for an unknown or disabled connection', async () => {
    const f = fixture([]);
    f.tx.warehouseClient.findMany.mockResolvedValue([{ warehouseId: 'legacy-only-warehouse' }]);
    await f.run();
    expect(f.tx.billingInvoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ warehouseId: 'legacy-only-warehouse' }),
    }));
    expect(f.events[0]).toBe('lock');
    expect(f.tx.clientMarketplaceConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isActive: true, clientId: 'client-1' }),
    }));
  });

  it('does not rewrite an issued invoice while resolving its live connection branch', async () => {
    const f = fixture();
    f.tx.billingInvoice.findUnique.mockResolvedValue({ id: 'issued', number: 'INV-1', status: 'ISSUED' });
    await f.run();
    expect(f.events[0]).toBe('lock');
    expect(f.tx.billingInvoice.create).not.toHaveBeenCalled();
    expect(f.tx.billingCharge.findMany).not.toHaveBeenCalled();
    expect(f.billing.get('WILDBERRIES:connection-1:1')).toMatchObject({ invoiceNumber: 'INV-1', invoiceStatus: 'ISSUED' });
  });
});

// TEST: live policy permits changing a box-only route; product/KIZ scans protect physical work.
describe('live competing box route release', () => {
  function fixture(scanned: Record<string, unknown> = {}, race = false) {
    const task: any = { id: 'other-task', itemCount: 1, status: 'IN_PROGRESS', deviceCode: 'other-device',
      boxId: 'box-1', sourceBarcode: null, barcode: null, kiz: null, relabelConfirmedAt: null, ...scanned };
    const updateMany = vi.fn(async ({ where }: any) => {
      if (race) task.barcode = '4600000000012';
      return { count: ['sourceBarcode', 'barcode', 'kiz', 'relabelConfirmedAt'].every(k => task[k] === where[k]) ? 1 : 0 };
    });
    const findMany = vi.fn(async ({ where }: any) =>
      ['sourceBarcode', 'barcode', 'kiz', 'relabelConfirmedAt'].every(k => task[k] === where[k]) &&
      (where.boxId === undefined || where.boxId === task.boxId) ? [task] : []);
    const service: any = new MarketplaceConnectionsService({ fbsTsdAssembly: { findMany, updateMany } } as never, {} as never);
    vi.spyOn(service, 'fbsTsdReservationRows').mockResolvedValue([{ itemCount: 1 }]);
    return { findMany, updateMany, run: () => service.releaseUntouchedFbsReservationsForScannedBox({
      clientId: 'client-1', requestId: 'request-1', taskId: 'mine', skuId: 'sku-1',
      boxId: 'box-1', boxCode: 'FFL_BOX_1', requiredQuantity: 1, availableQuantity: 1,
    }) };
  }

  it('releases a competing box hint while keeping its employee and active task', async () => {
    const f = fixture();
    await expect(f.run()).resolves.toBe(1);
    expect(f.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'IN_PROGRESS', sourceBarcode: null, barcode: null, kiz: null }),
      data: expect.objectContaining({ boxId: null, boxCode: null, reservedBoxId: null }),
    }));
    expect(f.updateMany.mock.calls[0][0].data).not.toHaveProperty('workerUserId');
  });

  it.each(['sourceBarcode', 'barcode', 'kiz', 'relabelConfirmedAt'])('never releases after a %s scan', async field => {
    const f = fixture({ [field]: field === 'relabelConfirmedAt' ? new Date() : 'scanned' });
    await expect(f.run()).resolves.toBe(0);
    expect(f.updateMany).not.toHaveBeenCalled();
  });

  it('loses the conditional release safely when the other employee scans a barcode concurrently', async () => {
    const f = fixture({}, true);
    await expect(f.run()).resolves.toBe(0);
    expect(f.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sourceBarcode: null, barcode: null, kiz: null, relabelConfirmedAt: null }),
    }));
  });
});
