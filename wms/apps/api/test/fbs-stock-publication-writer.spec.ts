import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function fixture(enabled = true) {
  vi.stubEnv('WMS_FBS_ZERO_STOCK_HISTORY_ENABLED', String(enabled));
  const rows: any[] = [];
  const db = {
    clientMarketplaceConnection: { findFirst: vi.fn(async () => ({ id: 'conn' })) },
    auditLog: { create: vi.fn(async (row: any) => { rows.push(row.data); }) },
  };
  const svc: any = new MarketplaceConnectionsService(db as never, {} as never);
  svc.stockControl = { assertEnabled: vi.fn(async () => {}) };
  let sent = false;
  const fetch = vi.fn(async (_url: any, init: any) => {
    if (init.method === 'PUT') { sent = true; return new Response(null, { status: 204 }); }
    return new Response(JSON.stringify({ stocks: [{ chrtId: 123, amount: sent ? 0 : 1 }] }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  return { svc, db, rows, fetch, run: () => svc.putWildberriesStocks('client', 'private-test-token', '1954119', [{ chrtId: 123, amount: 0 }]) };
}
it('wires every central write to fresh reads and persisted history without credentials', async () => {
  // TEST: covers the actual service writer, not just the journal helper.
  const f = fixture(); await expect(f.run()).resolves.toEqual({});
  expect(f.fetch.mock.calls.map(c => c[1].method)).toEqual(['POST', 'PUT', 'POST']);
  expect(f.rows.map(r => r.payload.phase)).toEqual(['PLANNED', 'BEFORE', 'SENDING', 'ACKNOWLEDGED', 'CONFIRMED']);
  expect(f.rows.every(r => r.entityId === 'conn' && r.payload.warehouseId === '1954119')).toBe(true);
  expect(JSON.stringify(f.rows)).not.toContain('private-test-token');
});
it('preserves the unmodified sold-WMS write path with the flag disabled', async () => {
  // TEST: no new database delegate or verification is required by the legacy path.
  const f = fixture(false); await f.run();
  expect(f.fetch.mock.calls.map(c => c[1].method)).toEqual(['PUT']);
  expect(f.db.auditLog.create).not.toHaveBeenCalled();
  expect(f.db.clientMarketplaceConnection.findFirst).not.toHaveBeenCalled();
});
it('stops before WB when outgoing stock publication is disabled', async () => {
  // TEST: the journal must not bypass the global publication gate.
  const f = fixture(); f.svc.stockControl.assertEnabled.mockRejectedValue(new Error('Disabled'));
  await expect(f.run()).rejects.toThrow('Disabled'); expect(f.fetch).not.toHaveBeenCalled();
});
