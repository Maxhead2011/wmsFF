import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertFreshWbStockPlan, captureWbStockPlan, StaleWbStockPlan, withWbStockPlan, WbStockSyncWorker, wbStockRetryDelay, urgentWbStockScope } from '../src/modules/marketplace-connections/wb-stock-sync-queue';
import { allocateFbsStock } from '../src/modules/marketplace-connections/fbs-stock-allocation';

afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_WB_URGENT_STOCK_SYNC', 'true');
  let revision = 1n;
  const db = { $queryRaw: vi.fn(async (sql: TemplateStringsArray) => sql.join('').includes('RETURNING') ? [{ clientId: 'client', revision, attempts: 0 }] : [{ revision }]),
    $executeRaw: vi.fn(async () => 1), auditLog: { create: vi.fn(async () => ({})) }, fbsStockAllocationPolicy: { updateMany: vi.fn(async () => ({})) } };
  return { db: db as any, change: () => { revision++; } };
}
describe('WB stock urgent queue', () => {
  // TEST: a committed sale while waiting for the HTTP rate limiter invalidates a positive plan.
  it('rejects the old amount before the actual request and allows a newly calculated plan', async () => {
    const f = fixture();
    await withWbStockPlan('client', async () => {
      await captureWbStockPlan(f.db, 'client');
      await assertFreshWbStockPlan(f.db, 'client');
      f.change();
      await expect(assertFreshWbStockPlan(f.db, 'client')).rejects.toBeInstanceOf(StaleWbStockPlan);
      await expect(captureWbStockPlan(f.db, 'client')).rejects.toBeInstanceOf(StaleWbStockPlan);
    });
    await withWbStockPlan('client', async () => {
      await captureWbStockPlan(f.db, 'client');
      await assertFreshWbStockPlan(f.db, 'client');
    });
  });
  // TEST: sold installations never depend on the new table.
  it('does not query or block when disabled', async () => {
    const f = fixture(); vi.stubEnv('WMS_WB_URGENT_STOCK_SYNC', 'false');
    await captureWbStockPlan(f.db, 'client'); await assertFreshWbStockPlan(f.db, 'client');
    await new WbStockSyncWorker(f.db, vi.fn(), vi.fn()).tick();
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
  });
  // TEST: a change during an in-flight PUT remains dirty and gets a fresh calculation.
  it('does not acknowledge a newer revision after a successful older send', async () => {
    const f = fixture();
    await new WbStockSyncWorker(f.db, async () => { f.change(); }, vi.fn()).tick();
    expect(f.db.auditLog.create.mock.calls.map((c: any) => c[0].data.payload.phase)).toEqual(['STARTED', 'RECALCULATE']);
    expect(f.db.$executeRaw.mock.calls[0][0].join('')).not.toContain('"completedRevision" =');
  });
  // TEST: uncertainty retries the calculation, never replays a stored positive payload.
  it('retries after failure and records confirmation only after successful sync', async () => {
    const f = fixture(); const sync = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(undefined);
    const worker = new WbStockSyncWorker(f.db, sync, vi.fn());
    await worker.tick(); await worker.tick();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(f.db.fbsStockAllocationPolicy.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { lastError: expect.any(String) } }));
    expect(f.db.auditLog.create.mock.calls.map((c: any) => c[0].data.payload.phase)).toEqual(['STARTED', 'RETRY_REQUIRED', 'STARTED', 'PROCESSED']);
    expect(wbStockRetryDelay(1)).toBe(5000); expect(wbStockRetryDelay(20)).toBe(300000);
  });
  // TEST: an unversioned writer cannot silently bypass freshness protection.
  it('fails closed outside a captured calculation', async () => {
    const f = fixture(); await expect(assertFreshWbStockPlan(f.db, 'client')).rejects.toBeInstanceOf(StaleWbStockPlan);
  });
  // TEST: lowering the reserve must not multiply the newly released unit over warehouses.
  it('preserves the total budget at a low-stock reserve boundary', () => {
    const shares = [{ warehouseId: 'a', percent: 50, isPrimary: true }, { warehouseId: 'b', percent: 50 }];
    for (const [available, reserve] of [[10, 3], [5, 3], [4, 1], [3, 1], [2, 1], [1, 1]]) {
      const budget = Math.max(0, available - reserve);
      expect(allocateFbsStock(budget, 3, shares).reduce((s, x) => s + x.amount, 0)).toBe(budget);
    }
  });
  // TEST: a changed source updates all of its relabel targets without touching unrelated stock.
  it('expands an urgent event to its complete shared relabel pool', async () => {
    const f = fixture();
    f.db.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('RETURNING')
      ? [{ clientId: 'client', revision: 1n, attempts: 0, skuIds: ['target1'], allSkus: false }] : [{ revision: 1n }]);
    await new WbStockSyncWorker(f.db, async () => {
      expect(urgentWbStockScope(new Map([
        ['target2', { sources: [{ skuId: 'source' }] }],
        ['target1', { sources: [{ skuId: 'source' }] }],
        ['other', { sources: [{ skuId: 'unrelated' }] }],
      ]))).toEqual(new Set(['target1', 'source', 'target2']));
    }, vi.fn()).tick();
  });
});
