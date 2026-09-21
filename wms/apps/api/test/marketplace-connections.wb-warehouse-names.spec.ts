import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: a failed/partial WB directory must not erase the saved warehouse labels.
describe('WB FBS warehouse names during directory outages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function setup(enabled: boolean, live: Array<{ id: string; name: string }> | Error) {
    vi.stubEnv('WMS_WB_WAREHOUSE_NAME_FALLBACK_ENABLED', String(enabled));
    const findMany = vi.fn().mockResolvedValue([
      { marketplaceWarehouseId: '1693195', marketplaceWarehouseName: 'Мой склад FBS Москва' },
      { marketplaceWarehouseId: '1935331', marketplaceWarehouseName: 'Мой склад Новосибирск' },
      { marketplaceWarehouseId: 'empty', marketplaceWarehouseName: '   ' },
    ]);
    const service = new MarketplaceConnectionsService({
      fbsWarehouseRoutingRule: { findMany },
    } as never, {} as never);
    const directory = vi.spyOn(service as any, 'fetchWildberriesStockWarehouses');
    if (live instanceof Error) directory.mockRejectedValue(live);
    else directory.mockResolvedValue(live);
    vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => url.endsWith('/orders/new')
        ? { orders: ['1693195', '1935331', 'unknown', 'empty'].map((warehouseId, index) => ({
            id: index + 1, warehouseId,
          })) }
        : { orders: [] },
    })));
    const load = (connectionId = 'lukin-wb') => (service as any).fetchWildberriesFbsOrders({
      id: connectionId, apiKey: 'test-key', accountName: 'WB',
      // This obsolete default must never override a route or label another warehouse.
      fbsWarehouseId: '1693195', fbsWarehouseName: 'Устаревшее имя',
    }, 'cache-only');
    return { load, findMany };
  }

  it('uses saved names after HTTP 504 and keeps unknown warehouses unnamed', async () => {
    const { load, findMany } = setup(true, new Error('Wildberries HTTP 504'));
    const orders = await load();
    expect(orders.map((order: any) => [order.warehouseId, order.warehouseName])).toEqual([
      ['1693195', 'Мой склад FBS Москва'], ['1935331', 'Мой склад Новосибирск'],
      ['unknown', null], ['empty', null],
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { connectionId: 'lukin-wb', marketplaceWarehouseId: { in: ['1693195', '1935331', 'unknown', 'empty'] } },
      select: { marketplaceWarehouseId: true, marketplaceWarehouseName: true },
    });
    expect(orders).toHaveLength(4);
  });

  it('prefers a live renamed warehouse and fills only missing directory entries', async () => {
    const { load, findMany } = setup(true, [{ id: '1693195', name: 'Москва — новое название' }]);
    const orders = await load();
    expect(orders[0].warehouseName).toBe('Москва — новое название');
    expect(orders[1].warehouseName).toBe('Мой склад Новосибирск');
    expect(findMany.mock.calls[0][0].where.marketplaceWarehouseId.in).not.toContain('1693195');
  });

  it('scopes every fallback lookup to its own WB connection', async () => {
    const { load, findMany } = setup(true, []);
    findMany.mockImplementation(async ({ where }: any) => [{
      marketplaceWarehouseId: '1693195', marketplaceWarehouseName: where.connectionId,
    }]);
    expect((await load('cabinet-a'))[0].warehouseName).toBe('cabinet-a');
    expect((await load('cabinet-b'))[0].warehouseName).toBe('cabinet-b');
  });

  it('does not query saved names when all warehouses have live names', async () => {
    const { load, findMany } = setup(true, ['1693195', '1935331', 'unknown', 'empty'].map(id => ({ id, name: id })));
    await load();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('preserves the sold VM behavior when the flag is disabled', async () => {
    const { load, findMany } = setup(false, new Error('Wildberries HTTP 504'));
    expect((await load()).every((order: any) => order.warehouseName === null)).toBe(true);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('keeps the fallback disabled by default', async () => {
    const { load, findMany } = setup(false, []);
    vi.stubEnv('WMS_WB_WAREHOUSE_NAME_FALLBACK_ENABLED', undefined);
    expect((await load())[0].warehouseName).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
