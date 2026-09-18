import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const url = process.env.FBO_TEST_DATABASE_URL;
if (url && !/^postgresql:\/\/codex_tests@127\.0\.0\.1:554(?:69|85)\/kiz_duplicate_tests(?:\?|$)/.test(url)) throw Error('Dedicated local test DB only');
const migration = resolve('prisma/migrations/20260918193000_inventory_audit_scan_index/migration.sql');
describe.skipIf(!url)('inventory scan history index', () => {
 const db = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
 afterAll(() => db.$disconnect());
 // TEST: execute the real dashboard lookup against 50,000 history rows; results stay identical and the plan uses the new index.
 it('avoids scanning unrelated audit history for each checked box', async () => {
  await db.$transaction(async tx => {
   await tx.$executeRawUnsafe('CREATE TEMP TABLE audit_scan_fixture (LIKE "AuditLog" INCLUDING DEFAULTS) ON COMMIT DROP');
   await tx.$executeRawUnsafe(`INSERT INTO audit_scan_fixture (id,action,entity,"entityId","createdAt") SELECT md5(g::text), 'INVENTORY_KIZ_SCAN', 'InventoryAuditBox', 'audit-'||g, timestamp '2026-09-18' FROM generate_series(1,50000) g`);
   await tx.$executeRawUnsafe('ANALYZE audit_scan_fixture');
   const query = `SELECT id FROM audit_scan_fixture WHERE action='INVENTORY_KIZ_SCAN' AND entity='InventoryAuditBox' AND "entityId"='audit-40000' AND "createdAt">=timestamp '2026-09-17' ORDER BY id LIMIT 1`;
   const before = await tx.$queryRawUnsafe(query);
   if (existsSync(migration)) {
    const sql = readFileSync(migration, 'utf8').replace(/--[^\n]*/g, '').replace(' CONCURRENTLY', '').replace('"AuditLog"', 'audit_scan_fixture');
    await tx.$executeRawUnsafe(sql);
   }
   expect(await tx.$queryRawUnsafe(query)).toEqual(before);
   expect(before).toHaveLength(1);
   const plan = JSON.stringify(await tx.$queryRawUnsafe('EXPLAIN (FORMAT JSON) '+query));
   expect(plan).toContain('AuditLog_entityId_action_createdAt_idx');
   expect(plan).not.toContain('Seq Scan');
  }, { timeout: 30000 });
 });
});
