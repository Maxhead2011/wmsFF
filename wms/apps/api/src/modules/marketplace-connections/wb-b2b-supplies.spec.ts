import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from './marketplace-connections.service';
import { wbLabelOrders } from './wb-label-orders';
vi.mock('./wb-label-orders', () => ({ wbLabelOrders: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
// TEST: exercise the real creation handler with WB rejecting mixed B2B batches.
function setup(flags: (boolean | null)[] = [false, true, false, false, false]) {
  vi.stubEnv('WMS_AUTO_ASSEMBLY_DURABLE_ENABLED', 'true');
  const orders = flags.map((_, i) => ({ id: String(100 + i), connectionId: 'cab', marketplace: 'WILDBERRIES', supplierStatus: 'new', itemCount: 1, warehouseId: 'warehouse', cargoType: '1', crossBorderType: '0' }));
  vi.mocked(wbLabelOrders).mockResolvedValue(orders.map((o, i) => ({ ...o, isB2b: flags[i] })) as any);
  const s: any = Object.create(MarketplaceConnectionsService.prototype);
  s.prisma = { fbsSupplyPlan: { upsert: vi.fn(async () => ({})) } };
  s.clientScopes = { requireClientAccess: vi.fn() };
  s.resolveSelectedFbsOrders = vi.fn(async () => ({ response: { client: { code: 'test' } }, orders }));
  s.loadFbsDeliveryPlan = vi.fn(async () => ({ destination: 'SORTING_CENTER' }));
  s.loadSelectedConnections = vi.fn(async () => [{ id: 'cab', apiKey: 'test' }]);
  s.refreshFbsOrdersCache = vi.fn(async () => ({})); s.preserveNewFbsSupplyAssignments = vi.fn(() => ({})); s.fbsOrdersCache = new Map();
  const batches: number[][] = []; let count = 0;
  const fetch = vi.fn(async (url: string, init: any) => {
    let body: any = {};
    if (init.method === 'POST' && url.endsWith('/supplies')) body = { id: `s${++count}` };
    if (init.method === 'PATCH') {
      const ids = JSON.parse(init.body).orders;
      if (new Set(ids.map((id: number) => flags[id - 100])).size > 1) return new Response('Mixed B2B', { status: 409 });
      batches.push(ids);
    }
    if (url.endsWith('/order-ids')) body = { orderIds: batches.at(-1) };
    return new Response(JSON.stringify(body), { status: 200 });
  }); vi.stubGlobal('fetch', fetch);
  return { s, orders, batches, fetch, run: () => s.moveFbsOrdersToSupply({ clientId: 'client', orders }, { id: 'user' }, 'assemble') };
}
it('creates two verified supplies for four ordinary orders and one B2B order', async () => {
  const x = setup(); const result = await x.run();
  expect(result.supplies.map((s: any) => s.orderIds.length)).toEqual([4, 1]);
  expect(x.batches).toEqual([[100, 102, 103, 104], [101]]);
  expect(x.s.prisma.fbsSupplyPlan.upsert).toHaveBeenCalledTimes(2);
});
it('blocks unknown B2B metadata before any supply write', async () => {
  const x = setup([false, null]); await expect(x.run()).rejects.toThrow('B2B'); expect(x.fetch).not.toHaveBeenCalled();
});
it('keeps homogeneous orders in one supply', async () => {
  const x = setup([true, true]); expect((await x.run()).supplies).toHaveLength(1);
});
it('preserves warehouse and cargo boundaries inside the same B2B class', async () => {
  const x = setup([true, true, true]); x.orders[1].warehouseId = 'other'; x.orders[2].cargoType = '2';
  expect((await x.run()).supplies.map((s: any) => s.orderIds.length)).toEqual([1, 1, 1]);
});
it('rejects a missing selected order before creating supplies', async () => {
  const x = setup(); vi.mocked(wbLabelOrders).mockResolvedValue([]);
  await expect(x.run()).rejects.toThrow('B2B'); expect(x.fetch).not.toHaveBeenCalled();
});
it('rejects an order that is no longer new before creating supplies', async () => {
  const x = setup([false]); vi.mocked(wbLabelOrders).mockResolvedValue([{ ...x.orders[0], isB2b: false, supplierStatus: 'cancel' }] as any);
  await expect(x.run()).rejects.toThrow('Статус'); expect(x.fetch).not.toHaveBeenCalled();
});
it('keeps the sold deployment path unchanged when the own flag is disabled', async () => {
  const x = setup([false, false]); vi.stubEnv('WMS_AUTO_ASSEMBLY_DURABLE_ENABLED', 'false'); await x.run(); expect(wbLabelOrders).not.toHaveBeenCalled();
});
