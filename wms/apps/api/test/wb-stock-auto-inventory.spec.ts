import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function setup() {
  const publication = { id: 'p', skuId: 's', warehouseId: 'w', enabled: true, saleLimit: null, lastSyncedAmount: 2, lastSyncedAt: new Date(), sku: { marketplaceProductId: '10:20' } };
  const db: any = { clientMarketplaceConnection: { findMany: vi.fn(async () => [{ id: 'conn', clientId: 'c', apiKey: 'test', fbsWarehouseId: 'w', fbsStockPublications: [publication] }]) },
    fbsStockPublication: { update: vi.fn(async () => ({})) }, $transaction: async (p: any[]) => Promise.all(p) };
  const service: any = new MarketplaceConnectionsService(db, {} as never);
  service.stockControl = { isEnabled: vi.fn(async () => true) };
  vi.spyOn(service, 'sampleWbAvailability').mockResolvedValue(undefined);
  vi.spyOn(service, 'resolveFbsExecutionWarehouseId').mockResolvedValue('msk');
  const plan = vi.spyOn(service, 'calculateFbsRelabelStockPlan').mockResolvedValue({ quantities: new Map([['s', { sellable: 10 }]]), meta: new Map(), reserve: { mode: 'UNITS', value: 3 } });
  vi.spyOn(service, 'fetchWildberriesStockAmounts').mockResolvedValue(new Map([[20, 2]]));
  const send = vi.spyOn(service, 'putWildberriesStocks').mockResolvedValue(undefined);
  return { service, plan, send };
}
// TEST: all committed inventory mechanisms feed the same fresh stock plan, in both directions.
it('automatically publishes increased and decreased free stock after inventory, retaining reserve', async () => {
  vi.stubEnv('WMS_WB_STOCK_FINE_SETTINGS', 'true');
  const { service, plan, send } = setup();
  await service.autoSyncFbsStocksForClient('c');
  expect(send).toHaveBeenLastCalledWith('c', 'test', 'w', [{ chrtId: 20, amount: 7 }]);
  plan.mockResolvedValue({ quantities: new Map([['s', { sellable: 1 }]]), meta: new Map(), reserve: { mode: 'UNITS', value: 3 } });
  await service.autoSyncFbsStocksForClient('c');
  expect(send).toHaveBeenLastCalledWith('c', 'test', 'w', [{ chrtId: 20, amount: 0 }]);
});
// TEST: no publication when the client switch is disabled; sold VM retains its old cap.
it('preserves disabled publication and the legacy downward-only mode', async () => {
  vi.stubEnv('WMS_WB_STOCK_FINE_SETTINGS', 'false');
  const { service, send } = setup();
  await service.autoSyncFbsStocksForClient('c');
  expect(send).not.toHaveBeenCalled();
  vi.stubEnv('WMS_WB_STOCK_FINE_SETTINGS', 'true');
  service.stockControl.isEnabled.mockResolvedValue(false);
  await service.autoSyncFbsStocksForClient('c');
  expect(send).not.toHaveBeenCalled();
});
