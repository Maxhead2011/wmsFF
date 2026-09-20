import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WbStockSyncWorker, urgentWbSkuIds } from '../src/modules/marketplace-connections/wb-stock-sync-queue';
import { selectKnownWbStockTargets } from '../src/modules/marketplace-connections/wb-stock-safe-publication';

const url = process.env.WB_URGENT_RETRY_TEST_DATABASE_URL;
if (url && url !== 'postgresql://codex_tests@127.0.0.1:55469/wb_urgent_retry_tests') throw Error('Dedicated test database required');

// TEST: real commits, rollback and worker restart; this database contains no warehouse data.
describe.skipIf(!url).sequential('partial confirmation PostgreSQL', () => {
  const db = new PrismaClient(url ? { datasources: { db: { url } } } : {});
  const clientId = 'retry-test';
  beforeAll(async () => {
    vi.stubEnv('WMS_WB_URGENT_STOCK_SYNC', 'true');
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS "WbStockSyncQueue" ("clientId" text PRIMARY KEY, attempts int NOT NULL DEFAULT 0, "nextAttemptAt" timestamptz NOT NULL DEFAULT now(), "requestedAt" timestamptz NOT NULL DEFAULT now(), "leaseToken" text, "leaseUntil" timestamptz, "lastError" text)`,
      `CREATE TABLE IF NOT EXISTS "WbStockSyncEvent" (id bigserial PRIMARY KEY, "clientId" text NOT NULL, "skuIds" text[] NOT NULL, "allSkus" boolean NOT NULL, txid bigint NOT NULL DEFAULT txid_current(), "createdAt" timestamptz NOT NULL DEFAULT now(), "processedAt" timestamptz)`,
      `CREATE TABLE IF NOT EXISTS "AuditLog" (id text PRIMARY KEY, "userId" text, action text NOT NULL, entity text NOT NULL, "entityId" text, payload jsonb, "createdAt" timestamp NOT NULL DEFAULT now())`,
      `CREATE TABLE IF NOT EXISTS "FbsStockAllocationPolicy" (id text PRIMARY KEY, "clientId" text NOT NULL, enabled boolean NOT NULL DEFAULT true, "lastError" text, "updatedAt" timestamp NOT NULL DEFAULT now())`,
    ]) await db.$executeRawUnsafe(sql);
  });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "WbStockSyncEvent", "WbStockSyncQueue", "AuditLog", "FbsStockAllocationPolicy"');
    await db.$executeRaw`INSERT INTO "FbsStockAllocationPolicy" (id,"clientId") VALUES ('policy',${clientId})`;
  });
  afterAll(async () => { vi.unstubAllEnvs(); await db.$disconnect(); });
  const enqueue = (skuIds: string[]) => db.$executeRaw`INSERT INTO "WbStockSyncEvent" ("clientId","skuIds","allSkus") VALUES (${clientId},${skuIds}::text[],false)`;
  const pending = () => db.$queryRaw<Array<{ skuIds: string[] }>>`SELECT "skuIds" FROM "WbStockSyncEvent" WHERE "processedAt" IS NULL ORDER BY id`;
  const unknown = () => selectKnownWbStockTargets([{ skuId: 'unknown', chrtId: 2, amount: 0, warehouseId: 'a' }], async () => new Map(), async () => {});

  it('persists the narrowed retry over restart and preserves a new concurrent reservation', async () => {
    await enqueue(['known', 'unknown']);
    await new WbStockSyncWorker(db as any, async () => {
      await unknown();
      await enqueue(['new-reservation']);
    }, vi.fn()).tick();
    expect(await pending()).toEqual([{ skuIds: ['new-reservation'] }, { skuIds: ['unknown'] }]);
    const warnings = await db.$queryRaw<any[]>`SELECT "lastError", attempts FROM "WbStockSyncQueue"`;
    expect(warnings[0]).toMatchObject({ attempts: 1, lastError: expect.any(String) });
    await db.$executeRaw`UPDATE "WbStockSyncQueue" SET "nextAttemptAt"=now()`;
    await new WbStockSyncWorker(db as any, async () => {
      expect(new Set(urgentWbSkuIds()!)).toEqual(new Set(['new-reservation', 'unknown']));
    }, vi.fn()).tick();
    expect(await pending()).toEqual([]);
  });

  it('rolls back acknowledgement when saving the partial retry fails', async () => {
    await enqueue(['known', 'unknown']);
    await db.$executeRawUnsafe(`ALTER TABLE "WbStockSyncEvent" ADD CONSTRAINT reject_narrowed_retry CHECK (cardinality("skuIds") <> 1)`);
    try {
      await new WbStockSyncWorker(db as any, unknown as any, vi.fn()).tick();
      expect(await pending()).toEqual([{ skuIds: ['known', 'unknown'] }]);
    } finally { await db.$executeRawUnsafe('ALTER TABLE "WbStockSyncEvent" DROP CONSTRAINT reject_narrowed_retry'); }
  });

  it('does not acknowledge or replace work after losing its lease', async () => {
    await enqueue(['known', 'unknown']);
    await new WbStockSyncWorker(db as any, async () => {
      await unknown();
      await db.$executeRaw`UPDATE "WbStockSyncQueue" SET "leaseToken"='replacement',"leaseUntil"=now()+interval '1 minute'`;
    }, vi.fn()).tick();
    expect(await pending()).toEqual([{ skuIds: ['known', 'unknown'] }]);
    const rows = await db.$queryRaw<any[]>`SELECT "leaseToken" FROM "WbStockSyncQueue"`;
    expect(rows[0].leaseToken).toBe('replacement');
  });
});
