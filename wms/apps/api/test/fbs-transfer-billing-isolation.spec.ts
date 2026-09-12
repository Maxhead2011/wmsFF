import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
// TEST: actual FBS loading must reach stock/status validation without a billing transaction.
function fixture() {
  const db = { client: { findUnique: vi.fn(async () => ({ id: 'client', code: 'c', name: 'Client' })) },
    clientMarketplaceConnection: { findMany: vi.fn(async () => [{ id: 'wb', marketplace: 'WILDBERRIES', accountName: 'WB' }]) },
    fbsSupplyPlan: { findMany: vi.fn(async () => []) }, fbsOrderRequestLink: { findMany: vi.fn(async () => []) } };
  const service: any = new MarketplaceConnectionsService(db as never, {} as never);
  service.loadFbsDeliveryPlan = vi.fn(async () => ({}));
  service.fetchWildberriesFbsOrders = vi.fn(async () => [{ id: '5675266516', connectionId: 'wb', marketplace: 'WILDBERRIES', supplierStatus: 'complete', wbStatus: 'waiting', supplyId: 'WB-GI-274299916' }]);
  service.applyFbsRelabelingStockSources = vi.fn(async (_id, orders) => orders);
  service.syncFbsRequestsFromMarketplace = vi.fn(async () => undefined);
  service.syncFbsPalletSortReservations = vi.fn(async () => new Map());
  service.ensureFbsProcessingCharges = vi.fn(async () => { throw new Error('Transaction already closed: 60000 ms'); });
  return { service, db };
}
afterEach(() => vi.unstubAllEnvs());
describe('transfer snapshot billing isolation', () => {
  it('does not run billing and preserves cached financial data while reading live WB statuses', async () => {
    const { service } = fixture(); const billing = { amountRub: 123, status: 'INVOICED' };
    const cached = { orders: [{ id: '5675266516', connectionId: 'wb', marketplace: 'WILDBERRIES', billing }] };
    service.fbsOrdersCache.set('client', { value: cached });
    const result = await service.refreshFbsOrdersCache('client', { historyMode: 'cache-only', invalidateHistory: false, billingMode: 'skip' });
    expect(result.orders[0]).toMatchObject({ id: '5675266516', supplierStatus: 'complete', wbStatus: 'waiting', billing });
    expect(service.ensureFbsProcessingCharges).not.toHaveBeenCalled(); expect(service.fetchWildberriesFbsOrders).toHaveBeenCalled();
    expect(service.fbsOrdersCache.get('client').value).toBe(cached);
  });
  it('leaves the default/sold read path unchanged and does not hide a billing error there', async () => {
    const { service } = fixture();
    await expect(service.refreshFbsOrdersCache('client', { historyMode: 'cache-only' })).rejects.toThrow('60000 ms');
    expect(service.ensureFbsProcessingCharges).toHaveBeenCalledTimes(1);
  });
  it('does not join a financial refresh already waiting on its transaction', async () => {
    const { service } = fixture(); let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    service.ensureFbsProcessingCharges.mockImplementation(async () => { await barrier; return new Map(); });
    const financial = service.loadFbsOrders('client', undefined, { historyMode: 'cache-only' });
    await vi.waitFor(() => expect(service.ensureFbsProcessingCharges).toHaveBeenCalledTimes(1));
    try {
      const operational = await Promise.race([service.loadFbsOrders('client', undefined, { historyMode: 'cache-only', billingMode: 'skip' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('joined billing refresh')), 300))]);
      expect(operational.orders[0].id).toBe('5675266516');
      expect(service.ensureFbsProcessingCharges).toHaveBeenCalledTimes(1);
    } finally { release(); await financial; }
  });
});
