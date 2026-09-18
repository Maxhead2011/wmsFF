import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// TEST: the real additive migration preserves nullable/legacy IDs and accepts new WB IDs.
it.runIf(Boolean(process.env.WMS_TEST_STOCK_DB_URL))('widens monitor IDs without losing existing events', async () => {
  const url = new URL(process.env.WMS_TEST_STOCK_DB_URL!);
  if (url.hostname !== '127.0.0.1' || url.port !== '56439') throw new Error('Local test database required');
  const { PrismaClient } = createRequire(import.meta.url)(process.env.WMS_TEST_PRISMA_CLIENT!);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const schema = 'monitor_' + randomUUID().replaceAll('-', '');
  const table = `"${schema}"."FbsStockMonitorEvent"`;
  try {
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await db.$executeRawUnsafe(`CREATE TABLE ${table} ("chrtId" INTEGER)`);
    await db.$executeRawUnsafe(`INSERT INTO ${table} VALUES (NULL),(20)`);
    await expect(db.$executeRawUnsafe(`INSERT INTO ${table} VALUES (2158257494)`)).rejects.toThrow();
    const sql = readFileSync(new URL('../prisma/migrations/20260918120000_fbs_monitor_chrt_bigint/migration.sql', import.meta.url), 'utf8').replace('"FbsStockMonitorEvent"', table);
    await db.$executeRawUnsafe(sql);
    await db.$executeRawUnsafe(`INSERT INTO ${table} VALUES (2158257494)`);
    expect(await db.$queryRawUnsafe(`SELECT "chrtId" FROM ${table} ORDER BY "chrtId" NULLS FIRST`)).toEqual([{ chrtId: null }, { chrtId: 20n }, { chrtId: 2158257494n }]);
  } finally {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
  }
});
