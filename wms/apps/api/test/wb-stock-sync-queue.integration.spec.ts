import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WbStockSyncWorker } from '../src/modules/marketplace-connections/wb-stock-sync-queue';

const url = process.env.KIZ_DUPLICATE_TEST_DATABASE_URL;
if (url && !/^postgresql:\/\/codex_tests@127\.0\.0\.1:55485\/kiz_duplicate_tests(?:\?|$)/.test(url)) throw new Error('Dedicated local test database only');
describe.skipIf(!url).sequential('durable WB urgent stock changes', () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const clientId = randomUUID(), skuId = randomUUID(), balanceId = randomUUID();
  const key = 'marketplace.wbUrgentSync.enabled';
  beforeAll(async () => {
    const sql = readFileSync(resolve('prisma/migrations/20260919180000_wb_stock_sync_queue/migration.sql'), 'utf8').replace(/--[^\n]*/g, '');
    const fn = sql.match(/CREATE OR REPLACE FUNCTION[\s\S]*?END \$\$;/)![0];
    const [before, after] = sql.split(fn);
    for (const statement of before.split(';').filter(s => s.trim())) await db.$executeRawUnsafe(statement);
    await db.$executeRawUnsafe(fn);
    for (const statement of after.split(';').filter(s => s.trim())) await db.$executeRawUnsafe(statement);
    await db.client.create({ data: { id: clientId, code: clientId, name: 'WB queue test' } });
    await db.sku.create({ data: { id: skuId, clientId, internalSku: skuId, name: 'test' } });
    await db.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
    vi.stubEnv('WMS_WB_URGENT_STOCK_SYNC', 'true');
  });
  afterAll(async () => {
    await db.systemSetting.deleteMany({ where: { key } });
    await db.stockBalance.deleteMany({ where: { clientId } });
    await db.auditLog.deleteMany({ where: { entityId: clientId } });
    await db.$executeRaw`DELETE FROM "WbStockSyncQueue" WHERE "clientId" = ${clientId}`;
    await db.sku.deleteMany({ where: { clientId } }); await db.client.deleteMany({ where: { id: clientId } });
    await db.$disconnect(); vi.unstubAllEnvs();
  });
  const job = async () => (await db.$queryRaw<any[]>`SELECT * FROM "WbStockSyncQueue" WHERE "clientId" = ${clientId}`)[0];
  // TEST: trigger and stock update commit or roll back together, without an HTTP handler dependency.
  it('creates a durable targeted event only for committed changes', async () => {
    await expect(db.$transaction(async tx => {
      await tx.stockBalance.create({ data: { id: balanceId, balanceKey: balanceId, clientId, skuId, status: 'AVAILABLE', quantity: 10 } });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await job()).toBeUndefined();
    await db.stockBalance.create({ data: { id: balanceId, balanceKey: balanceId, clientId, skuId, status: 'AVAILABLE', quantity: 10 } });
    expect(await job()).toMatchObject({ revision: 1n, completedRevision: 0n, skuIds: [skuId], allSkus: false });
    await db.stockBalance.update({ where: { id: balanceId }, data: { quantity: 3 } });
    expect((await job()).revision).toBe(2n);
    await db.stockBalance.update({ where: { id: balanceId }, data: { quantity: 3 } });
    expect((await job()).revision).toBe(2n);
  });
  // TEST: two workers cannot publish the same lease, and a new change is not lost by completion.
  it('leases once and preserves changes during an in-flight synchronization', async () => {
    const sync = vi.fn(async () => { await db.stockBalance.update({ where: { id: balanceId }, data: { quantity: 2 } }); });
    await Promise.all([new WbStockSyncWorker(db as any, sync, vi.fn()).tick(), new WbStockSyncWorker(db as any, sync, vi.fn()).tick()]);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(await job()).toMatchObject({ revision: 3n, completedRevision: 0n, leaseToken: null });
    await db.$executeRaw`UPDATE "WbStockSyncQueue" SET "nextAttemptAt" = now() WHERE "clientId" = ${clientId}`;
    await new WbStockSyncWorker(db as any, async () => {}, vi.fn()).tick();
    expect(await job()).toMatchObject({ revision: 3n, completedRevision: 3n, skuIds: [], lastError: null });
  });
  // TEST: a crashed worker is recoverable after its lease expires; no in-memory event is needed.
  it('recovers an expired lease and retains a visible error until verified', async () => {
    await db.stockBalance.update({ where: { id: balanceId }, data: { quantity: 1 } });
    await db.$executeRaw`UPDATE "WbStockSyncQueue" SET "leaseToken" = 'crashed', "leaseUntil" = now() - interval '1 second' WHERE "clientId" = ${clientId}`;
    await new WbStockSyncWorker(db as any, async () => { throw new Error('WB unavailable'); }, vi.fn()).tick();
    expect(await job()).toMatchObject({ revision: 4n, completedRevision: 3n, leaseToken: null, attempts: 1 });
    expect((await job()).lastError).toBeTruthy();
  });
});
