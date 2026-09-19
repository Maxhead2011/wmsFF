import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { captureWbStockPlan, withWbStockPlan } from '../src/modules/marketplace-connections/wb-stock-sync-queue';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
// TEST: the real HTTP writer must reject a positive amount when a new sale commits during its pre-read.
it('does not send a stale positive stock after a new order arrives', async () => {
  vi.stubEnv('WMS_WB_URGENT_STOCK_SYNC', 'true');
  vi.stubEnv('WMS_FBS_ZERO_STOCK_HISTORY_ENABLED', 'true');
  let revision = 1n;
  const db: any = { $queryRaw: vi.fn(async (sql: TemplateStringsArray) => sql.join('').includes('txid_current_snapshot') ? [{ snapshot: '1:10:' }] : [{ stale: revision > 1n }]),
    clientMarketplaceConnection: { findFirst: async () => ({ id: 'conn' }) }, auditLog: { create: vi.fn(async () => ({})) } };
  const svc: any = new MarketplaceConnectionsService(db, {} as never);
  svc.stockControl = { assertEnabled: vi.fn(async () => {}) };
  const fetch = vi.fn(async (_url: any, init: any) => {
    if (init.method === 'POST') { revision++; return new Response(JSON.stringify({ stocks: [{ chrtId: 123, amount: 0 }] }), { status: 200 }); }
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetch);
  await withWbStockPlan('client', async () => {
    await captureWbStockPlan(db, 'client');
    await expect(svc.putWildberriesStocks('client', 'test-private', '1954119', [{ chrtId: 123, amount: 1 }])).rejects.toThrow();
  });
  expect(fetch.mock.calls.filter(c => c[1].method === 'PUT')).toHaveLength(0);
  expect(db.auditLog.create.mock.calls.some((c: any) => c[0].data.payload.phase === 'CONFIRMED')).toBe(false);
});
