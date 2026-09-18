import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { WbStockObservations, wbStockCheckDto } from '../src/modules/marketplace-connections/wb-stock-observations';

// TEST: run against a disposable local schema with an isolated generated client, never production.
it.runIf(Boolean(process.env.WMS_TEST_STOCK_DB_URL))('migrates INT4 to BIGINT and preserves large IDs through real Prisma upsert/read', async () => {
  const url = new URL(process.env.WMS_TEST_STOCK_DB_URL!);
  if (url.hostname !== '127.0.0.1' || url.port !== '56439') throw new Error('Only isolated local test PostgreSQL is permitted.');
  const { PrismaClient } = createRequire(import.meta.url)(process.env.WMS_TEST_PRISMA_CLIENT!);
  const root = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const schema = 'wb_bigint_' + randomUUID().replaceAll('-', '');
  url.searchParams.set('schema', schema);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."WbStockPublicationCheck" ("id" TEXT PRIMARY KEY,"runId" TEXT NOT NULL,"clientId" TEXT NOT NULL,"connectionId" TEXT NOT NULL,"warehouseId" TEXT NOT NULL,"skuId" TEXT,"chrtId" INTEGER NOT NULL,"phase" TEXT NOT NULL,"calculatedAmount" INTEGER NOT NULL,"sentAmount" INTEGER,"observedAmount" INTEGER,"status" TEXT NOT NULL,"sentAt" TIMESTAMP,"checkedAt" TIMESTAMP,"error" TEXT,"createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),"updatedAt" TIMESTAMP NOT NULL,UNIQUE("connectionId","warehouseId","chrtId"))`);
    const obs = new WbStockObservations(db);
    const small = { warehouseId: 'w', chrtId: 20, amount: 1, status: 'PLANNED', phase: 'PLAN' };
    await obs.recorder('c', 'conn')(small);
    await expect(obs.recorder('c', 'conn')({ ...small, chrtId: 2331826459 })).rejects.toThrow();
    const sql = readFileSync(new URL('../prisma/migrations/20260918110000_wb_stock_chrt_bigint/migration.sql', import.meta.url), 'utf8').replace('"WbStockPublicationCheck"', `"${schema}"."WbStockPublicationCheck"`);
    await db.$executeRawUnsafe(sql);
    // Deployment restarts API after migration, replacing prepared statements with old INT4 metadata.
    await db.$disconnect();
    await obs.recorder('c', 'conn')({ ...small, chrtId: 2331826459 });
    await obs.recorder('c', 'conn')({ ...small, chrtId: 2331826459, status: 'UNCONFIRMED', phase: 'STOP', error: 'missing' });
    const rows = await db.wbStockPublicationCheck.findMany({ orderBy: { chrtId: 'asc' } });
    expect(rows.map((r: any) => r.chrtId)).toEqual([20n, 2331826459n]);
    expect(rows[1].error).toBe('missing');
    expect(JSON.parse(JSON.stringify(rows.map(wbStockCheckDto)))[1].chrtId).toBe(2331826459);
  } finally {
    await db.$disconnect();
    await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await root.$disconnect();
  }
}, 30000);
