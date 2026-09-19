import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function fixture(enabled = true) {
  vi.stubEnv('WMS_FBS_ZERO_STOCK_HISTORY_ENABLED', String(enabled));
  const publications: any[] = [];
  const db = {
    clientMarketplaceConnection: { findFirst: vi.fn(async () => ({ id: 'conn', clientId: 'client', apiKey: 'secret' })) },
    fbsStockPublication: {
      findMany: vi.fn(async () => [...publications]),
      createMany: vi.fn(async ({ data }: any) => { publications.push(...data.map((p: any, i: number) => ({ ...p, id: String(i) }))); }),
      updateMany: vi.fn(), update: vi.fn(),
    },
    $transaction: vi.fn(async (rows: any[]) => Promise.all(rows)),
  };
  const svc: any = new MarketplaceConnectionsService(db as never, {} as never);
  svc.stockAllocation = { activePolicy: vi.fn(async () => ({ id: 'policy', primaryWarehouseId: '1', lowStockThreshold: 10,
    shares: [{ warehouseId: '1', percent: 100, isPrimary: true }], overrides: [] })), markSync: vi.fn() };
  svc.resolveFbsExecutionWarehouseId = vi.fn(async () => 'moscow');
  svc.calculateFbsRelabelStockPlan = vi.fn(async () => ({ quantities: new Map([
    ['zero', { skuId: 'zero', chrtId: 123, available: 0, reserved: 3, sellable: 0 }],
  ]), meta: new Map() }));
  svc.putWildberriesStocks = vi.fn(async () => ({}));
  return { svc, publications };
}
it('sends zero for a mapped card with no prior publication instead of silently skipping it', async () => {
  // TEST: request 1118 was sold from a WB card omitted from the zero-stock plan.
  const f = fixture();
  const result = await f.svc.syncAllocatedFbsStocksForConnection('client', 'conn');
  expect(f.svc.putWildberriesStocks).toHaveBeenCalledWith('client', 'secret', '1', [{ chrtId: 123, amount: 0 }]);
  expect(result.products).toBe(1);
  expect(f.publications[0]).toMatchObject({ skuId: 'zero', clientId: 'client', connectionId: 'conn' });
});
it('retains sold-WMS behavior when the rollout flag is disabled', async () => {
  // TEST: no automatic enrollment in other installations.
  const f = fixture(false);
  await f.svc.syncAllocatedFbsStocksForConnection('client', 'conn');
  expect(f.svc.putWildberriesStocks).not.toHaveBeenCalled();
  expect(f.publications).toHaveLength(0);
});
it('does not re-enable a card explicitly stopped on the primary warehouse', async () => {
  // TEST: broader zero coverage must preserve the explicit stop decision.
  const f = fixture();
  f.publications.push({ id: 'existing', clientId: 'client', connectionId: 'conn', warehouseId: '1', skuId: 'zero', enabled: false });
  f.svc.calculateFbsRelabelStockPlan.mockResolvedValue({ quantities: new Map([
    ['zero', { skuId: 'zero', chrtId: 123, available: 5, reserved: 0, sellable: 5 }],
  ]), meta: new Map() });
  await f.svc.syncAllocatedFbsStocksForConnection('client', 'conn');
  expect(f.svc.putWildberriesStocks).toHaveBeenCalledWith('client', 'secret', '1', [{ chrtId: 123, amount: 0 }]);
});
