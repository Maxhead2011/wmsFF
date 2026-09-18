import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import * as lifecycle from '../src/common/stock/wb-order-stock-lifecycle';

const clientId = 'client-a', connectionId = 'wb-a';
function setup() {
  const db = {
    clientMarketplaceConnection: { findFirst: vi.fn().mockResolvedValue({ id: connectionId, clientId }) },
    sku: { findMany: vi.fn().mockResolvedValue([{ id: 'sku-a', article: 'article', clientSku: null, internalSku: 'internal', barcodes: [{ value: 'barcode' }] }]) },
  };
  const service = new MarketplaceConnectionsService(db as never, {} as never) as any;
  const full = vi.spyOn(service, 'loadFbsOrders').mockRejectedValue(new Error('Full operational synchronization must not run'));
  const raw = vi.spyOn(service, 'fetchWildberriesFbsOrders').mockResolvedValue([
    { id: 1, connectionId, marketplace: 'WILDBERRIES', skus: ['barcode'], warehouseId: 7, itemCount: 1, createdAt: new Date().toISOString(), supplierStatus: 'new', wbStatus: 'waiting' },
    { id: 2, connectionId, marketplace: 'WILDBERRIES', article: 'ARTICLE', warehouseId: 7, itemCount: 2, createdAt: new Date().toISOString(), supplierStatus: 'complete', wbStatus: 'sold' },
    { id: 3, connectionId, marketplace: 'WILDBERRIES', warehouseId: 7, createdAt: new Date().toISOString(), supplierStatus: 'cancel', wbStatus: 'canceled' },
    { id: 4, connectionId, marketplace: 'WILDBERRIES', warehouseId: 8, createdAt: '2000-01-01', supplierStatus: 'new', wbStatus: 'waiting' },
  ]);
  return { service, db, raw, full };
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('allocation-only order loading', () => {
  // TEST: the legacy WB-order pass was discarded by unified reservations, yet blocked every cold stock calculation.
  it('keeps unified free stock unchanged without running the discarded legacy order calculation', async () => {
    vi.stubEnv('WMS_FBS_ALLOCATION_FAST_ENABLED', 'true');
    vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
    const reserve = vi.spyOn(lifecycle, 'wbReservationQuantities').mockResolvedValue(new Map([['sku-a', 4]]));
    const db = {
      sku: { findMany: vi.fn().mockResolvedValue([{ id: 'sku-a', marketplaceProductId: '100:200' }]) },
      stockBalance: { findMany: vi.fn().mockResolvedValue([{ skuId: 'sku-a', quantity: 10, box: { status: 'active' } }]) },
      clientRequestItem: { findMany: vi.fn().mockResolvedValue([{ skuId: 'sku-a', quantity: 9 }]) },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new MarketplaceConnectionsService(db as never, {} as never) as any;
    const full = vi.spyOn(service, 'loadFbsOrders').mockRejectedValue(new Error('Discarded full order calculation'));
    const fast = await service.calculateFbsStockQuantities(clientId, ['sku-a'], 'moscow', connectionId);
    expect(fast.get('sku-a')).toMatchObject({ available: 10, reserved: 4, sellable: 6 });
    expect(full).not.toHaveBeenCalled();
    expect(reserve).toHaveBeenCalledWith(db, clientId, ['sku-a'], 'moscow');
    vi.stubEnv('WMS_FBS_ALLOCATION_FAST_ENABLED', 'false');
    full.mockResolvedValue({ orders: [] });
    expect(await service.calculateFbsStockQuantities(clientId, ['sku-a'], 'moscow', connectionId)).toEqual(fast);
    expect(full).toHaveBeenCalledTimes(1);
  });
  // TEST: opening allocation previously ran full operational/billing synchronization on a cold cache.
  it('loads only the chosen WB account, preserves demand and never populates the operational cache', async () => {
    vi.stubEnv('WMS_FBS_ALLOCATION_FAST_ENABLED', 'true');
    const { service, db, raw, full } = setup();
    expect(await service.fbsStockAllocationDemand(clientId, connectionId, 30)).toEqual(new Map([['7', 3]]));
    expect(full).not.toHaveBeenCalled();
    expect(raw).toHaveBeenCalledTimes(1);
    expect(db.clientMarketplaceConnection.findFirst).toHaveBeenCalledWith({ where: { id: connectionId, clientId, marketplace: 'WILDBERRIES', isActive: true }, include: { client: true } });
    expect(service.fbsOrdersCache.size).toBe(0);
    const snapshot = await service.fbsAllocationOrders(clientId, connectionId);
    expect(snapshot.orders.slice(0, 2).map((o: any) => o.product?.id)).toEqual(['sku-a', 'sku-a']);
    expect(db.sku.findMany.mock.calls[0][0].where.clientId).toBe(clientId);
    expect(db.sku.findMany.mock.calls[0][0].select).not.toHaveProperty('balances');
  });
  // TEST: repeated users share one in-flight load, failures can be retried, expired data is refreshed.
  it('coalesces loads and retries failures without leaking data between clients/accounts', async () => {
    vi.stubEnv('WMS_FBS_ALLOCATION_FAST_ENABLED', 'true');
    const { service, raw } = setup();
    await Promise.all([service.fbsStockAllocationDemand(clientId, connectionId, 30), service.fbsStockAllocationDemand(clientId, connectionId, 30)]);
    expect(raw).toHaveBeenCalledTimes(1);
    await service.fbsStockAllocationDemand('client-b', 'wb-b', 30);
    expect(raw).toHaveBeenCalledTimes(2);
    service.fbsAllocationOrdersCache.clear();
    raw.mockRejectedValueOnce(new Error('WB unavailable'));
    await expect(service.fbsStockAllocationDemand(clientId, connectionId, 30)).rejects.toThrow('WB unavailable');
    await expect(service.fbsStockAllocationDemand(clientId, connectionId, 30)).resolves.toEqual(new Map([['7', 3]]));
    expect(raw).toHaveBeenCalledTimes(4);
    for (const row of service.fbsAllocationOrdersCache.values()) row.expiresAt = 0;
    await service.fbsStockAllocationDemand(clientId, connectionId, 30);
    expect(raw).toHaveBeenCalledTimes(5);
  });
  // TEST: sold installations retain the old code path unless explicitly enabled.
  it('retains legacy behavior with the flag off', async () => {
    vi.stubEnv('WMS_FBS_ALLOCATION_FAST_ENABLED', 'false');
    const { service, raw, full } = setup();
    full.mockResolvedValue({ orders: [] });
    expect(await service.fbsStockAllocationDemand(clientId, connectionId, 30)).toEqual(new Map());
    expect(full).toHaveBeenCalledTimes(1);
    expect(raw).not.toHaveBeenCalled();
  });
  // TEST: an inactive or foreign account must fail before contacting WB or reading products.
  it('rejects unavailable connections without an empty successful recommendation', async () => {
    vi.stubEnv('WMS_FBS_ALLOCATION_FAST_ENABLED', 'true');
    const { service, db, raw, full } = setup();
    db.clientMarketplaceConnection.findFirst.mockResolvedValue(null as never);
    await expect(service.fbsStockAllocationDemand(clientId, connectionId, 30)).rejects.toThrow('WB connection');
    expect(raw).not.toHaveBeenCalled();
    expect(full).not.toHaveBeenCalled();
    expect(db.sku.findMany).not.toHaveBeenCalled();
  });
  // TEST: stale operational data and invalid dates cannot inflate the new demand calculation.
  it('ignores stale operational data and excludes unknown or future order dates', async () => {
    vi.stubEnv('WMS_FBS_ALLOCATION_FAST_ENABLED', 'true');
    const { service, raw } = setup();
    service.fbsOrdersCache.set(clientId, { expiresAt: 0, value: { orders: [{ connectionId, marketplace: 'WILDBERRIES', category: 'active', warehouseId: '7', itemCount: 999 }] } });
    raw.mockResolvedValue([null, 'bad-date', new Date(Date.now() + 86400000).toISOString()].map(createdAt => ({ connectionId, marketplace: 'WILDBERRIES', warehouseId: 7, createdAt })));
    expect(await service.fbsStockAllocationDemand(clientId, connectionId, 30)).toEqual(new Map());
    expect(service.fbsOrdersCache.get(clientId).value.orders[0].itemCount).toBe(999);
  });
});
