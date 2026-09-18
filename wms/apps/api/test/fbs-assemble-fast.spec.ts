import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const selection = [{ connectionId: 'wb', id: '123' }];
function fixture(status = 'new', pickup = false) {
  vi.stubEnv('WMS_FBS_FAST_ASSEMBLY_ENABLED', 'true');
  const connection = { id: 'wb', clientId: 'client', marketplace: 'WILDBERRIES', apiKey: 'test', isActive: true };
  const db = { clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue([connection]) },
    fbsSupplyPlan: { upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) } };
  const scopes = { requireClientAccess: vi.fn() };
  const service = new MarketplaceConnectionsService(db as never, scopes as never);
  const order = { id: '123', connectionId: 'wb', marketplace: 'WILDBERRIES', supplierStatus: status,
    wbStatus: status === 'cancel' ? 'canceled' : 'waiting', category: status === 'cancel' ? 'cancelled' : 'active',
    warehouseId: '7', cargoType: 1, itemCount: 1, pickupPointShipmentAllowed: true, createdAt: '2026-09-18T00:00:00Z' };
  const deliveryPlan = { destination: pickup ? 'PICKUP_POINT' : 'VNUKOVO_SORTING_CENTER', requiresCargoPlaces: pickup };
  const response = { client: { id: 'client', code: '0001' }, orders: [order], deliveryPlan };
  const selected = vi.spyOn(service as any, 'loadFbsOrdersUncached').mockResolvedValue(response);
  const full = vi.spyOn(service as any, 'loadFbsOrders').mockRejectedValue(new Error('full history blocked'));
  const refresh = vi.spyOn(service as any, 'refreshFbsOrdersCache').mockReturnValue(new Promise(() => {}));
  vi.spyOn(service as any, 'loadFbsDeliveryPlan').mockResolvedValue(deliveryPlan);
  const fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () =>
    url.endsWith('/api/v3/supplies') ? { id: 'WB-GI-test' } : url.endsWith('/order-ids') ? { orderIds: [123] }
    : url.endsWith('/trbx') ? { trbxIds: ['cargo'] } : {},
  }));
  vi.stubGlobal('fetch', fetchMock);
  return { service, db, scopes, selected, full, refresh, fetchMock, response,
    assemble: () => service.assembleFbsOrders({ clientId: 'client', orders: selection } as never, { id: 'admin' } as never) };
}

// TEST: actual assemble endpoint must complete without entering any full catalogue refresh.
it('validates the selection once and returns verified supply before the full refresh', async () => {
  const f = fixture();
  const result = await f.assemble();
  expect(result).toMatchObject({ assembled: 1, ordersPartial: true, supplies: [{ id: 'WB-GI-test' }],
    orders: { orders: [{ id: '123', supplyId: 'WB-GI-test', supplierStatus: 'confirm' }] } });
  expect(f.selected).toHaveBeenCalledOnce();
  expect(f.selected).toHaveBeenCalledWith('client', undefined,
    { historyMode: 'cache-only', billingMode: 'skip', readOnly: true, selections: selection });
  expect(f.full).not.toHaveBeenCalled(); expect(f.refresh).not.toHaveBeenCalled();
  expect(f.fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'https://marketplace-api.wildberries.ru/api/v3/supplies',
    'https://marketplace-api.wildberries.ru/api/marketplace/v3/supplies/WB-GI-test/orders',
    'https://marketplace-api.wildberries.ru/api/marketplace/v3/supplies/WB-GI-test/order-ids',
  ]);
  expect((f.service as any).fbsOrdersCache.has('client')).toBe(false);
});

it('does not overwrite the shared full snapshot with selected orders', async () => {
  const f = fixture();
  const cached = { expiresAt: 7, value: { orders: [{ id: 'other', connectionId: 'wb', billing: { amount: 35 } }] } };
  (f.service as any).fbsOrdersCache.set('client', cached);
  await f.assemble();
  expect((f.service as any).fbsOrdersCache.get('client')).toBe(cached);
  expect(cached.value.orders[0].billing.amount).toBe(35);
});

it('checks client access before loading the selection', async () => {
  const f = fixture(); f.scopes.requireClientAccess.mockImplementation(() => { throw new Error('denied'); });
  await expect(f.assemble()).rejects.toThrow('denied');
  expect(f.selected).not.toHaveBeenCalled(); expect(f.full).not.toHaveBeenCalled(); expect(f.fetchMock).not.toHaveBeenCalled();
});

it('rejects a freshly cancelled order before creating a WB supply', async () => {
  const f = fixture('cancel');
  await expect(f.assemble()).rejects.toThrow('только новые');
  expect(f.fetchMock).not.toHaveBeenCalled(); expect(f.db.fbsSupplyPlan.upsert).not.toHaveBeenCalled();
});

it('does not report success if WB cannot confirm the exact supply contents', async () => {
  const f = fixture();
  f.fetchMock.mockImplementation(async (url) => ({ ok: true, status: 200, json: async () =>
    url.endsWith('/api/v3/supplies') ? { id: 'WB-GI-test' } : { orderIds: [999] } }));
  await expect(f.assemble()).rejects.toThrow('контроль состава');
  expect(f.db.fbsSupplyPlan.upsert).not.toHaveBeenCalled(); expect(f.refresh).not.toHaveBeenCalled();
}, 12000);

it('keeps pickup-point cargo creation and saves it before returning', async () => {
  const f = fixture('new', true);
  expect(await f.assemble()).toMatchObject({ supplies: [{ cargoPlaceCount: 1, cargoPlaceIds: ['cargo'] }] });
  expect(f.db.fbsSupplyPlan.update).toHaveBeenCalledWith(expect.objectContaining({ data: { cargoPlaceCount: 1, cargoPlaceIds: ['cargo'] } }));
});

it('keeps the original path when the fast assembly flag is disabled', async () => {
  const f = fixture(); vi.stubEnv('WMS_FBS_FAST_ASSEMBLY_ENABLED', 'false');
  f.full.mockResolvedValue(f.response); f.refresh.mockResolvedValue(f.response);
  const result = await f.assemble();
  expect(result).not.toHaveProperty('ordersPartial', true);
  expect(f.selected).not.toHaveBeenCalled(); expect(f.full).toHaveBeenCalledTimes(2); expect(f.refresh).toHaveBeenCalledOnce();
});

// TEST: selected new payload remains metadata for a subsequent fresh check after WB removes it from /new.
it('retains selected metadata without pretending to have fetched the full history', async () => {
  const service = new MarketplaceConnectionsService({} as never, {} as never);
  const connection = { id: 'wb', apiKey: 'test', marketplace: 'WILDBERRIES' };
  let transferred = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => ({ orders:
    url.endsWith('/orders/new') ? (transferred ? [] : [{ id: 123, skus: ['barcode'] }])
    : [{ id: 123, supplierStatus: transferred ? 'confirm' : 'new', wbStatus: 'waiting' }],
  }) })));
  await (service as any).fetchSelectedWildberriesFbsOrders(connection, new Set(['123']));
  transferred = true;
  const next = await (service as any).fetchSelectedWildberriesFbsOrders(connection, new Set(['123']));
  expect(next[0]).toMatchObject({ id: 123, skus: ['barcode'], supplierStatus: 'confirm' });
  expect((service as any).wildberriesFbsHistoryCache.get('wb').expiresAt).toBe(0);
});
