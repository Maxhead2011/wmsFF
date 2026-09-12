import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: exercise the actual stock query and routing boundary, not a mocked noStock flag.
function setup() {
  const order = { id: '101', connectionId: 'cabinet', marketplace: 'WILDBERRIES', supplierStatus: 'complete',
    wbStatus: 'waiting', product: { id: 'target-sku' }, itemCount: 1, relabeling: { sourceSkuId: 'physical-sku' } };
  const task = { id: 'task', requestId: 'request', orderId: '101', connectionId: 'cabinet', status: 'WAITING_STOCK', itemCount: 1 };
  const link = { requestId: 'request', orderId: '101', connectionId: 'cabinet', syncStatus: 'ACTIVE',
    request: { warehouseId: 'warehouse', status: 'SUBMITTED' } };
  const db = {
    fbsTsdAssembly: { findMany: vi.fn(async () => [task]) },
    fbsOrderRequestLink: { findMany: vi.fn(async () => [link]) },
    client: { findUniqueOrThrow: vi.fn(async () => ({ storesWithoutBoxes: false })) },
    stockBalance: { findMany: vi.fn(async () => [{ skuId: 'physical-sku', boxId: 'box', quantity: 1 }]) },
    clientRequest: { findMany: vi.fn(async () => [{ id: 'request' }]) },
  };
  const service: any = Object.create(MarketplaceConnectionsService.prototype);
  Object.assign(service, { prisma: db, clientScopes: { requireClientAccess: vi.fn() },
    refreshFbsOrdersCache: vi.fn(async () => ({ orders: [order] })),
    resolveSelectedFbsOrders: vi.fn(async () => ({ orders: [order] })),
    fbsTsdReservationRowsBySku: vi.fn(async () => new Map()) });
  const dto = { clientId: 'client', orders: [{ id: '101', connectionId: 'cabinet' }], sourceRequestId: 'request' };
  const user = { activeWarehouseId: 'warehouse', writableWarehouseIds: ['warehouse'] };
  return { service, db, dto, user, order, task, link };
}
describe('WB stock transfer gateway', () => {
  // TEST: transfer preparation must explicitly avoid the slow automatic billing transaction.
  it('requests fresh operational orders without automatic billing', async () => {
    const { service, dto, user } = setup();
    await service.prepareFbsStockTransfer(dto, user);
    expect(service.refreshFbsOrdersCache).toHaveBeenCalledWith('client', {
      invalidateHistory: false, historyMode: 'cache-only', billingMode: 'skip',
    });
  });
  it('uses the relabel source SKU and only usable balances in the active client and branch', async () => {
    const { service, db, dto, user } = setup();
    expect((await service.prepareFbsStockTransfer(dto, user)).orders[0].noStock).toBe(false);
    expect(db.stockBalance.findMany.mock.calls[0][0]).toMatchObject({ where: {
      clientId: 'client', warehouseId: 'warehouse', skuId: { in: ['physical-sku'] }, status: 'AVAILABLE',
      box: { clientId: 'client', warehouseId: 'warehouse', status: { notIn: ['deleted', 'archived', 'shipped'] },
        storagePlacement: { pallet: { clientId: 'client', warehouseId: 'warehouse' } } } } });
  });
  it('routes zero balances and stock fully reserved by another task to the shortage supply', async () => {
    const { service, db, dto, user } = setup();
    service.fbsTsdReservationRowsBySku.mockResolvedValue(new Map([['physical-sku', [{ taskId: 'other', boxId: 'box', itemCount: 1 }]]]));
    expect((await service.prepareFbsStockTransfer(dto, user)).orders[0].noStock).toBe(true);
    db.stockBalance.findMany.mockResolvedValue([]);
    expect((await service.prepareFbsStockTransfer(dto, user)).orders[0].noStock).toBe(true);
  });
  it('does not subtract a different branch unboxed reservation', async () => {
    const { service, db, dto, user } = setup();
    db.client.findUniqueOrThrow.mockResolvedValue({ storesWithoutBoxes: true });
    db.fbsTsdAssembly.findMany.mockResolvedValueOnce([{ id: 'task', requestId: 'request', orderId: '101', connectionId: 'cabinet', status: 'WAITING_STOCK', itemCount: 1 }]);
    service.fbsTsdReservationRowsBySku.mockResolvedValue(new Map([['physical-sku', [{ taskId: 'foreign-task', boxId: null, itemCount: 1 }]]]));
    expect((await service.prepareFbsStockTransfer(dto, user)).orders[0].noStock).toBe(false);
    expect(db.clientRequest.findMany).toHaveBeenCalledWith({ where: { clientId: 'client', warehouseId: 'warehouse' }, select: { id: true } });
  });
  it('refuses stale source requests, foreign branches and closed requests before stock routing', async () => {
    const { service, db, dto, user, link } = setup();
    await expect(service.prepareFbsStockTransfer({ ...dto, sourceRequestId: 'previous-request' }, user)).rejects.toThrow();
    await expect(service.prepareFbsStockTransfer(dto, { ...user, activeWarehouseId: 'foreign' })).rejects.toThrow();
    link.request.status = 'PACKED';
    await expect(service.prepareFbsStockTransfer(dto, user)).rejects.toThrow();
    expect(db.stockBalance.findMany).not.toHaveBeenCalled();
  });
  it('does not classify a missing product as zero stock or allow duplicate selections', async () => {
    const { service, db, dto, user, order } = setup();
    Object.assign(order, { product: null });
    await expect(service.prepareFbsStockTransfer(dto, user)).rejects.toThrow();
    await expect(service.prepareFbsStockTransfer({ ...dto, orders: [...dto.orders, ...dto.orders] }, user)).rejects.toThrow();
    expect(db.stockBalance.findMany).not.toHaveBeenCalled();
  });
});

// TEST: exercise the real order loader with a failing billing writer, including cache isolation.
describe('transfer loading independent of billing', () => {
  function loader() {
    const db = {
      client: { findUnique: vi.fn(async () => ({ id: 'client', code: 'CLIENT', name: 'Client' })) },
      clientMarketplaceConnection: { findMany: vi.fn(async () => [{ id: 'cabinet', marketplace: 'WILDBERRIES' }]) },
    };
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    service.loadFbsDeliveryPlan = vi.fn(async () => ({}));
    service.fetchWildberriesFbsOrders = vi.fn(async () => [{ id: '5737342163', connectionId: 'cabinet',
      marketplace: 'WILDBERRIES', supplierStatus: 'complete', wbStatus: 'waiting' }]);
    service.applyFbsRelabelingStockSources = vi.fn(async (_client, rows) => rows);
    service.syncFbsRequestsFromMarketplace = vi.fn(async () => undefined);
    service.loadActiveFbsOrderRequestLinks = vi.fn(async () => []);
    service.syncFbsPalletSortReservations = vi.fn(async () => new Map());
    service.ensureFbsProcessingCharges = vi.fn(async () => { throw new Error('Transaction already closed: 60000 ms'); });
    return service;
  }

  it('loads live shipped orders despite an unavailable billing writer', async () => {
    const service = loader();
    const result = await service.loadFbsOrders('client', undefined, { historyMode: 'cache-only', billingMode: 'skip' });
    expect(result.orders).toMatchObject([{ id: '5737342163', supplierStatus: 'complete', wbStatus: 'waiting' }]);
    expect(service.fetchWildberriesFbsOrders).toHaveBeenCalled();
    expect(service.ensureFbsProcessingCharges).not.toHaveBeenCalled();
  });

  it('keeps default billing enabled', async () => {
    const service = loader();
    await expect(service.loadFbsOrders('client')).rejects.toThrow('Transaction already closed');
    expect(service.ensureFbsProcessingCharges).toHaveBeenCalledWith('client', expect.arrayContaining([
      expect.objectContaining({ id: '5737342163', category: 'shipped' }),
    ]));
  });

  it('does not join an in-flight billing load', async () => {
    const service = loader();
    const billing = service.loadFbsOrders('client', undefined, { historyMode: 'cache-only' });
    const checkedBilling = expect(billing).rejects.toThrow('Transaction already closed');
    const operational = service.loadFbsOrders('client', undefined, { historyMode: 'cache-only', billingMode: 'skip' });
    await expect(operational).resolves.toMatchObject({ orders: [{ id: '5737342163' }] });
    await checkedBilling;
  });

  it('does not replace the shared billed cache with an operational response', async () => {
    const service = loader();
    const cached = { expiresAt: Date.now() + 60000, value: { orders: [{ id: 'old', billing: { totalRub: 100 } }] } };
    service.fbsOrdersCache.set('client', cached);
    await service.refreshFbsOrdersCache('client', { invalidateHistory: false, historyMode: 'cache-only', billingMode: 'skip' });
    expect(service.fbsOrdersCache.get('client')).toBe(cached);
  });

  it('finishes reconciliation with no cached orders even when billing fails', async () => {
    const service = loader();
    service.syncOneFbsRequest = vi.fn(async () => ({ changed: true, summary: '' }));
    await service.finishStockTransferRequests('client', 'cabinet', 'target', [{ id: '5737342163', requestId: 'source' }]);
    expect(service.syncOneFbsRequest).toHaveBeenCalledWith('client', 'source', expect.any(Map), []);
    expect(service.ensureFbsProcessingCharges).not.toHaveBeenCalled();
  });
});


// TEST: a confirmed move must survive the next real WB refresh, including a source-sync retry.
describe('confirmed stock transfer history', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([false, true])('keeps the target supply on refresh when source sync fails: %s', async (failSourceSync) => {
    const service: any = new MarketplaceConnectionsService({} as never, {} as never);
    const connection = { id: 'cabinet', apiKey: 'test-key', accountName: 'WB' };
    const moved = { id: 101, supplyId: 'old-supply', supplyID: 'old-supply', article: 'MOVED' };
    const untouched = { id: 102, supplyId: 'old-supply', article: 'UNTOUCHED' };
    const foreignHistory = { expiresAt: Date.now() + 60_000, orders: [{ ...moved }] };
    service.wildberriesFbsHistoryCache.set('cabinet', { expiresAt: Date.now() + 60_000, orders: [moved, untouched] });
    service.wildberriesFbsHistoryCache.set('other-cabinet', foreignHistory);
    service.fbsOrdersCache.set('client', { expiresAt: Date.now() + 60_000, value: {
      orders: [moved, untouched].map(order => ({ ...order, id: String(order.id), connectionId: 'cabinet' })),
    } });
    service.syncOneFbsRequest = failSourceSync
      ? vi.fn(async () => { throw new Error('source sync unavailable'); })
      : vi.fn(async () => ({ changed: true, summary: '' }));
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      let payload: unknown;
      if (url.endsWith('/orders/status')) {
        payload = { orders: JSON.parse(String(init?.body)).orders.map((id: number) => ({ id, supplierStatus: 'confirm', wbStatus: 'waiting' })) };
      } else if (url.endsWith('/orders/new') || url.endsWith('/supplies/orders/reshipment')) {
        payload = { orders: [] };
      } else if (url.endsWith('/api/v3/warehouses')) {
        payload = [];
      } else {
        throw new Error(`Unexpected WB endpoint: ${url}`);
      }
      return { ok: true, status: 200, json: async () => payload } as Response;
    }));

    const finish = service.finishStockTransferRequests('client', 'cabinet', 'new-supply', [{ id: '101', requestId: 'source-request' }]);
    if (failSourceSync) await expect(finish).rejects.toThrow('source sync unavailable');
    else await finish;
    const refreshed = await service.fetchWildberriesFbsOrders(connection, 'cache-only');
    expect(refreshed.find((order: any) => String(order.id) === '101')).toMatchObject({ supplyId: 'new-supply', supplyID: 'new-supply' });
    expect(refreshed.find((order: any) => String(order.id) === '102')).toMatchObject({ supplyId: 'old-supply', article: 'UNTOUCHED' });
    expect(service.wildberriesFbsHistoryCache.get('other-cabinet')).toEqual(foreignHistory);
  });
});
