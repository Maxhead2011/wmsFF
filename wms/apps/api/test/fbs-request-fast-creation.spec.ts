import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const selection = [{ connectionId: 'wb', id: '123' }];
const connection = { id: 'wb', clientId: 'client', marketplace: 'WILDBERRIES', accountName: 'WB', apiKey: 'test' };

// TEST: creation must not wait for the full history/financial refresh, even on a cold cache.
it('routes creation to an isolated read-only selected-order load', async () => {
  vi.stubEnv('WMS_FBS_FAST_REQUEST_CREATION_ENABLED', 'true');
  const service = new MarketplaceConnectionsService({} as never, { requireClientAccess: vi.fn() } as never);
  const full = vi.spyOn(service as any, 'loadFbsOrders').mockRejectedValue(new Error('full refresh blocked'));
  const selected = vi.spyOn(service as any, 'loadFbsOrdersUncached').mockResolvedValue({ orders: [] });
  await expect(service.createFbsRequest({ clientId: 'client', orders: selection }, {} as never)).rejects.toThrow('Заказы не найдены');
  expect(full).not.toHaveBeenCalled();
  expect(selected).toHaveBeenCalledWith('client', undefined, {
    historyMode: 'cache-only', billingMode: 'skip', readOnly: true, selections: selection,
  });
});

// TEST: existing deployments keep the original path until the LOGOFF flag is enabled.
it('retains the legacy loader with the flag disabled', async () => {
  vi.stubEnv('WMS_FBS_FAST_REQUEST_CREATION_ENABLED', 'false');
  const service = new MarketplaceConnectionsService({} as never, { requireClientAccess: vi.fn() } as never);
  const full = vi.spyOn(service as any, 'loadFbsOrders').mockResolvedValue({ orders: [] });
  await expect(service.createFbsRequest({ clientId: 'client', orders: selection }, {} as never)).rejects.toThrow('Заказы не найдены');
  expect(full).toHaveBeenCalledOnce();
});

it('loads only selected WB statuses and never history, reshipments or another cabinet', async () => {
  const service = new MarketplaceConnectionsService({} as never, {} as never);
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/orders/new')) return { ok: true, status: 200, json: async () => ({ orders: [
      { id: 123, skus: ['barcode'], warehouseId: 7 }, { id: 456, skus: ['other'] },
    ] }) };
    if (url.endsWith('/orders/status')) {
      expect(JSON.parse(String(init.body))).toEqual({ orders: [123] });
      return { ok: true, status: 200, json: async () => ({ orders: [{ id: 123, supplierStatus: 'new', wbStatus: 'waiting' }] }) };
    }
    throw new Error('Unexpected full catalogue request: ' + url);
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await (service as any).fetchSelectedWildberriesFbsOrders(connection, new Set(['123']));
  expect(result).toEqual([expect.objectContaining({ id: 123, connectionId: 'wb', supplierStatus: 'new' })]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('fails closed when WB omits the selected status instead of treating it as new', async () => {
  const service = new MarketplaceConnectionsService({} as never, {} as never);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200,
    json: async () => ({ orders: url.endsWith('/orders/new') ? [{ id: 123 }] : [] }),
  })));
  await expect((service as any).fetchSelectedWildberriesFbsOrders(connection, new Set(['123'])))
    .rejects.toThrow('статус');
});

// TEST: exercise the actual selected loader, mapping and creation transaction together.
function creationFixture(status = 'new', linked = false) {
  vi.stubEnv('WMS_FBS_FAST_REQUEST_CREATION_ENABLED', 'true');
  vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'false');
  const tx = { clientRequest: { create: vi.fn().mockResolvedValue({ id: 'request', number: 1118 }) },
    clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
    fbsOrderRequestLink: { create: vi.fn().mockResolvedValue({}) } };
  const db = {
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'client', code: '0001', name: 'Лукин' }) },
    clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue([connection]) },
    sku: { findMany: vi.fn().mockResolvedValue([{ id: 'sku', name: 'Костюм', internalSku: 'SKU',
      barcodes: [{ value: 'barcode' }], balances: [] }]) },
    fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue(linked ? [{ orderId: '123', syncStatus: 'ACTIVE', request: { number: 1117, status: 'SUBMITTED' } }] : []) },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  const scopes = { requireClientAccess: vi.fn() };
  const service = new MarketplaceConnectionsService(db as never, scopes as never);
  vi.spyOn(service as any, 'loadFbsDeliveryPlan').mockResolvedValue({});
  vi.spyOn(service as any, 'applyFbsRelabelingStockSources').mockImplementation(async (_id, orders) => orders);
  vi.spyOn(service as any, 'applyLocalWbShipments').mockImplementation(async (_id, orders) => orders);
  vi.spyOn(service as any, 'loadActiveFbsOrderRequestLinks').mockResolvedValue([]);
  const reservations = vi.spyOn(service as any, 'syncFbsPalletSortReservations').mockResolvedValue(new Map());
  const sync = vi.spyOn(service as any, 'syncFbsRequestsFromMarketplace').mockRejectedValue(new Error('must not synchronize'));
  const billing = vi.spyOn(service as any, 'ensureFbsProcessingCharges').mockRejectedValue(new Error('must not bill'));
  const routing = vi.spyOn(service as any, 'resolveFbsRequestWarehouseId').mockResolvedValue('moscow');
  const full = vi.spyOn(service as any, 'loadFbsOrders').mockRejectedValue(new Error('must not load full history'));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => ({ orders:
    url.endsWith('/orders/new') ? [{ id: 123, skus: ['barcode'], warehouseId: 7 }] :
      [{ id: 123, supplierStatus: status, wbStatus: status === 'cancel' ? 'canceled' : 'waiting' }],
  }) })));
  return { service, db, tx, sync, billing, full, routing, reservations, scopes,
    create: () => service.createFbsRequest({ clientId: 'client', orders: selection }, { id: 'admin' } as never) };
}

it('creates and links the selected order without financial or request synchronization', async () => {
  const f = creationFixture();
  expect(await f.create()).toMatchObject({ request: { number: 1118 }, linkedOrders: 1 });
  expect(f.db.clientMarketplaceConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ clientId: 'client', isActive: true, id: { in: ['wb'] } }),
  }));
  expect(f.tx.clientRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ warehouseId: 'moscow' }) }));
  expect(f.tx.fbsOrderRequestLink.create).toHaveBeenCalledOnce();
  expect(f.full).not.toHaveBeenCalled(); expect(f.sync).not.toHaveBeenCalled(); expect(f.billing).not.toHaveBeenCalled();
  expect(f.reservations).toHaveBeenCalledWith('client', expect.any(Array), true);
});

it('rejects a fresh cancellation even when the new-order payload is stale', async () => {
  const f = creationFixture('cancel');
  await expect(f.create()).rejects.toThrow('активных');
  expect(f.db.$transaction).not.toHaveBeenCalled();
});

it('keeps duplicate-order and branch routing protections', async () => {
  const f = creationFixture('new', true);
  await expect(f.create()).rejects.toThrow('уже включены');
  expect(f.db.$transaction).not.toHaveBeenCalled();
});

it('rejects an excluded warehouse before saving', async () => {
  const f = creationFixture();
  f.routing.mockRejectedValue(new Error('Склад WB исключён'));
  await expect(f.create()).rejects.toThrow('Склад WB исключён');
  expect(f.db.$transaction).not.toHaveBeenCalled();
});

it('checks client write access before contacting WB', async () => {
  const f = creationFixture();
  f.scopes.requireClientAccess.mockImplementation(() => { throw new Error('Нет доступа'); });
  await expect(f.create()).rejects.toThrow('Нет доступа');
  expect(fetch).not.toHaveBeenCalled(); expect(f.db.$transaction).not.toHaveBeenCalled();
});

it('does not resolve an order through a foreign or disabled connection', async () => {
  const f = creationFixture(); f.db.clientMarketplaceConnection.findMany.mockResolvedValue([]);
  await expect(f.create()).rejects.toThrow('Заказы не найдены');
  expect(fetch).not.toHaveBeenCalled(); expect(f.db.$transaction).not.toHaveBeenCalled();
});

it('does not write a partial request if a selected order has disappeared', async () => {
  const f = creationFixture();
  await expect(f.service.createFbsRequest({ clientId: 'client', orders: [...selection, { connectionId: 'wb', id: '456' }] }, {} as never))
    .rejects.toThrow('не найден');
  expect(f.db.$transaction).not.toHaveBeenCalled();
});

// TEST: a large historical cache never expands the selected-status batch.
it('ignores 20000 unrelated cached orders and refreshes a cached terminal status', async () => {
  const service = new MarketplaceConnectionsService({} as never, {} as never);
  (service as any).wildberriesFbsHistoryCache.set('wb', { expiresAt: 0, orders: [
    { id: 123, skus: ['barcode'] }, ...Array.from({ length: 20000 }, (_, i) => ({ id: i + 1000 })),
  ] });
  (service as any).wildberriesFbsStatusCache.set('wb', { expiresAt: Date.now() + 60000,
    statuses: new Map([['123', { supplierStatus: 'cancel', wbStatus: 'canceled' }]]) });
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/orders/new')) return { ok: true, status: 200, json: async () => ({ orders: [] }) };
    expect(JSON.parse(String(init.body))).toEqual({ orders: [123] });
    return { ok: true, status: 200, json: async () => ({ orders: [{ id: 123, supplierStatus: 'confirm', wbStatus: 'waiting' }] }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await (service as any).fetchSelectedWildberriesFbsOrders(connection, new Set(['123']));
  expect(result).toHaveLength(1); expect(result[0].supplierStatus).toBe('confirm');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('batches 1001 selected statuses without exceeding the WB batch size', async () => {
  const service = new MarketplaceConnectionsService({} as never, {} as never);
  const ids = Array.from({ length: 1001 }, (_, i) => String(i + 1));
  const sizes: number[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const batch = url.endsWith('/orders/new') ? ids.map(Number) : JSON.parse(String(init.body)).orders;
    if (url.endsWith('/orders/status')) sizes.push(batch.length);
    return { ok: true, status: 200, json: async () => ({ orders: batch.map((id: number) => ({ id, supplierStatus: 'new', wbStatus: 'waiting' })) }) };
  }));
  expect(await (service as any).fetchSelectedWildberriesFbsOrders(connection, new Set(ids))).toHaveLength(1001);
  expect(sizes).toEqual([1000, 1]);
});
