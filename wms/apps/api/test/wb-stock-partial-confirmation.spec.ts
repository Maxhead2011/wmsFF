import { afterEach, describe, expect, it, vi } from 'vitest';
import { WbStockSyncWorker, urgentWbSkuIds } from '../src/modules/marketplace-connections/wb-stock-sync-queue';
import { publishWbStockPlan, selectKnownWbStockTargets } from '../src/modules/marketplace-connections/wb-stock-safe-publication';

afterEach(() => vi.unstubAllEnvs());
const target = (skuId: string, chrtId: number, amount = 0) => ({ skuId, chrtId, amount, warehouseId: 'moscow' });
function fixture() {
  vi.stubEnv('WMS_WB_URGENT_STOCK_SYNC', 'true');
  const db: any = {
    $queryRaw: vi.fn(async (sql: TemplateStringsArray) => sql.join('').includes('RETURNING')
      ? [{ clientId: 'client', attempts: 0 }]
      : [{ id: 1n, skuIds: ['known', 'unknown'], allSkus: false }]),
    $executeRaw: vi.fn(async () => 1),
    auditLog: { create: vi.fn(async () => ({})) },
    fbsStockAllocationPolicy: { updateMany: vi.fn(async () => ({})) },
  };
  db.$transaction = vi.fn((fn: any) => fn(db));
  return db;
}
const phases = (db: any) => db.auditLog.create.mock.calls.map((c: any) => c[0].data.payload.phase);

describe('partial WB stock confirmation', () => {
  // TEST: a successful known subset must not acknowledge an unknown size as confirmed.
  it('keeps only the unknown SKU pending after the known subset succeeds', async () => {
    const db = fixture();
    await new WbStockSyncWorker(db, async () => {
      const selection = await selectKnownWbStockTargets([target('known', 1), target('unknown', 2)],
        async () => new Map([[1, 0]]), async () => {});
      expect(selection.known.map(r => r.skuId)).toEqual(['known']);
    }, vi.fn()).tick();
    expect(phases(db)).toEqual(['STARTED', 'PARTIAL_RETRY_REQUIRED']);
    const retry = db.$executeRaw.mock.calls.find((c: any) => c[0].join('').includes('INSERT INTO "WbStockSyncEvent"'));
    expect(retry).toBeDefined();
    expect(retry.slice(1)).toContainEqual(['unknown']);
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  // TEST: an ordinary read outside a worker cannot leak its uncertainty into the next job.
  it('does not leak a manual preview into the next queue run', async () => {
    const db = fixture();
    await selectKnownWbStockTargets([target('unknown', 2)], async () => new Map(), async () => {});
    await new WbStockSyncWorker(db, async () => {}, vi.fn()).tick();
    expect(phases(db)).toEqual(['STARTED', 'PROCESSED']);
  });

  // TEST: missing local identity must retain broad work rather than silently drop a WB size.
  it('retains an all-SKU retry when a missing WB target has no local SKU identity', async () => {
    const db = fixture();
    await new WbStockSyncWorker(db, async () => {
      await selectKnownWbStockTargets([{ warehouseId: 'a', chrtId: 2158272518, amount: 0 }], async () => new Map(), async () => {});
    }, vi.fn()).tick();
    const audit = db.auditLog.create.mock.calls.at(-1)[0].data.payload;
    expect(audit).toMatchObject({ phase: 'PARTIAL_RETRY_REQUIRED', retryAll: true, retrySkuIds: [] });
  });

  // TEST: several warehouses and cabinets retry one SKU identity once, not one old payload per warehouse.
  it('coalesces repeated unknown observations from multiple warehouses', async () => {
    const db = fixture();
    await new WbStockSyncWorker(db, async () => {
      for (const warehouseId of ['a', 'b']) await selectKnownWbStockTargets([
        { ...target('unknown', 2), warehouseId },
      ], async () => new Map(), async () => {});
    }, vi.fn()).tick();
    expect(db.auditLog.create.mock.calls.at(-1)[0].data.payload.retrySkuIds).toEqual(['unknown']);
  });

  // TEST: re-reading WB after a lost response sends only the unconfirmed part of a batch.
  it('does not resend a confirmed SKU when another SKU in the batch mismatches', async () => {
    const amounts = new Map([[1, 3], [2, 3]]);
    const send = vi.fn(async (_warehouse, rows) => {
      for (const row of rows) if (row.chrtId === 1 || send.mock.calls.length > 1) amounts.set(row.chrtId, row.amount);
    });
    const io = { read: async () => new Map(amounts), send, record: async () => {} };
    const rows = [target('known', 1), target('unknown', 2)];
    await expect(publishWbStockPlan(rows, io)).rejects.toThrow();
    await publishWbStockPlan(rows, io);
    expect(send.mock.calls[1][1]).toEqual([{ chrtId: 2, amount: 0 }]);
  });

  // TEST: an external manual increase is removed from a fresh zero-stock plan.
  it('lowers a manual WB increase to the current WMS target', async () => {
    let amount = 8;
    const send = vi.fn(async (_w, rows) => { amount = rows[0].amount; });
    await publishWbStockPlan([target('known', 1)], { read: async () => new Map([[1, amount]]), send, record: async () => {} });
    expect(send).toHaveBeenCalledWith('moscow', [{ chrtId: 1, amount: 0 }]);
  });

  // TEST: failed requests retain the original work because later connections may not have run.
  it('retains all original events when transport fails', async () => {
    const db = fixture();
    await new WbStockSyncWorker(db, async () => { throw new Error('timeout'); }, vi.fn()).tick();
    expect(phases(db)).toEqual(['STARTED', 'RETRY_REQUIRED']);
    expect(db.$executeRaw.mock.calls.some((c: any) => c[0].join('').includes('SET "processedAt"'))).toBe(false);
  });

  // TEST: every retry gets the event's SKU identities, never a stored obsolete quantity.
  it('exposes identities for a fresh calculation', async () => {
    const db = fixture();
    await new WbStockSyncWorker(db, async () => { expect(urgentWbSkuIds()).toEqual(['known', 'unknown']); }, vi.fn()).tick();
  });
});
