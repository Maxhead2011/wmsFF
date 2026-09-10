// TEST: opt-in PostgreSQL contract/concurrency checks with synthetic data only.
// No AppModule, WB calls, production URL fallback, installs, or existing WMS tables.
// NODE_ENV=test FBS_RESHIPMENT_TEST_DATABASE_URL=postgresql://...@localhost/wms_reshipment_test
// FBS_RESHIPMENT_TEST_ACK=isolated-test-only node test/fbs-reshipment-postgres.cjs
// --self-test validates safety guards only; it is NOT a PostgreSQL test result.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function validateTarget(env) {
  assert.equal(env.NODE_ENV, 'test', 'NODE_ENV must be test');
  assert.equal(env.FBS_RESHIPMENT_TEST_ACK, 'isolated-test-only', 'Explicit isolated test acknowledgement required');
  assert(env.FBS_RESHIPMENT_TEST_DATABASE_URL, 'Explicit test URL required; DATABASE_URL is never used');
  const url = new URL(env.FBS_RESHIPMENT_TEST_DATABASE_URL);
  assert(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL URL required');
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only local test PostgreSQL is permitted');
  const database = decodeURIComponent(url.pathname.slice(1));
  assert(/^wms_reshipment_test(?:_[a-z0-9]+)?$/.test(database), 'Dedicated wms_reshipment_test database required');
  // Reject alternate schema/host/socket parameters and proxy routing.
  for (const key of url.searchParams.keys()) assert(['sslmode', 'connection_limit', 'connect_timeout', 'pool_timeout'].includes(key), 'Unsupported URL option');
  url.searchParams.set('connection_limit', '4');
  url.searchParams.set('connect_timeout', '5');
  url.searchParams.set('pool_timeout', '5');
  return { url: url.toString(), database };
}

function schemaName() { return `reshipment_test_${randomUUID().replaceAll('-', '')}`; }
const sqlState = (error, expected) => error?.code === 'P2010' && error?.meta?.code === expected;
function quotedSchema(value) {
  assert(/^reshipment_test_[a-f0-9]{32}$/.test(value), 'Only a generated isolated test schema is permitted');
  return `"${value}"`;
}
function migrationStatements(schema) {
  const prefix = quotedSchema(schema);
  const file = path.join(__dirname, '../prisma/migrations/20260910144000_fbs_reshipment/migration.sql');
  const sql = fs.readFileSync(file, 'utf8').replace(/^--.*$/gm, '');
  return sql.split(';').map(part => part.trim()).filter(Boolean).map(statement => {
    assert(/^CREATE (TABLE|(?:UNIQUE )?INDEX) /.test(statement), 'Review test harness before adding other migration operations');
    return statement.replace(/"(FbsReshipmentRun|FbsReshipmentClaim)"/g, `${prefix}."$1"`);
  });
}

function selfTest() {
  const valid = { NODE_ENV: 'test', FBS_RESHIPMENT_TEST_ACK: 'isolated-test-only',
    FBS_RESHIPMENT_TEST_DATABASE_URL: 'postgresql://tester:unused@127.0.0.1:5432/wms_reshipment_test' };
  assert.equal(validateTarget(valid).database, 'wms_reshipment_test');
  for (const patch of [
    { NODE_ENV: 'production' }, { FBS_RESHIPMENT_TEST_ACK: '' },
    { FBS_RESHIPMENT_TEST_DATABASE_URL: '', DATABASE_URL: valid.FBS_RESHIPMENT_TEST_DATABASE_URL },
    { FBS_RESHIPMENT_TEST_DATABASE_URL: 'postgresql://tester@wms.logoff.pro/wms_reshipment_test' },
    { FBS_RESHIPMENT_TEST_DATABASE_URL: 'postgresql://tester@localhost/wms' },
    { FBS_RESHIPMENT_TEST_DATABASE_URL: `${valid.FBS_RESHIPMENT_TEST_DATABASE_URL}?host=production` },
    { FBS_RESHIPMENT_TEST_DATABASE_URL: `${valid.FBS_RESHIPMENT_TEST_DATABASE_URL}?schema=public` },
  ]) assert.throws(() => validateTarget({ ...valid, ...patch }));
  assert.throws(() => quotedSchema('public'));
  const statements = migrationStatements(schemaName());
  assert.equal(statements.filter(sql => sql.startsWith('CREATE TABLE')).length, 2);
  assert(statements.some(sql => sql.includes('"sourceRequestIds"')));
  assert(statements.some(sql => sql.includes('USING GIN')));
  console.log('PASS safety guards and migration routing only; PostgreSQL NOT executed');
}

async function main() {
  const target = validateTarget(process.env); // Validate BEFORE loading Prisma or opening any connection.
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient({ datasources: { db: { url: target.url } } });
  const schema = schemaName();
  const prefix = quotedSchema(schema);
  const runTable = `${prefix}."FbsReshipmentRun"`;
  const claimTable = `${prefix}."FbsReshipmentClaim"`;
  const statements = migrationStatements(schema);
  let created = false;
  const options = { timeout: 15_000, maxWait: 5_000 };
  async function insertRun(db, id, fingerprint = id, mode = 'SAME_ITEM') {
    return db.$executeRawUnsafe(`INSERT INTO ${runTable}
      ("id","fingerprint","previewToken","clientId","warehouseId","connectionId","mode","supplyName","snapshot","sourceRequestIds","createdByUserId","updatedAt")
      VALUES ($1,$2,'synthetic-preview','synthetic-client','synthetic-warehouse','synthetic-wb',$3,$1,'{}'::jsonb,ARRAY['synthetic-source'],'synthetic-admin',CURRENT_TIMESTAMP)`, id, fingerprint, mode);
  }
  async function insertClaim(db, id, runId, orderId, cycle = 'stable-attempt-cycle') {
    return db.$executeRawUnsafe(`INSERT INTO ${claimTable} ("id","runId","connectionId","orderId","cycle") VALUES ($1,$2,'synthetic-wb',$3,$4)`, id, runId, orderId, cycle);
  }
  async function claimRace(id, runId) {
    return p.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      return insertClaim(tx, id, runId, 'synthetic-order');
    }, options);
  }
  const acquire = token => p.$executeRawUnsafe(`UPDATE ${runTable} SET "leaseToken"=$1,"leaseUntil"=CURRENT_TIMESTAMP+INTERVAL '3 minutes'
    WHERE "id"='lease-run' AND "status"<>'CREATED' AND ("leaseUntil" IS NULL OR "leaseUntil"<CURRENT_TIMESTAMP)`, token);
  try {
    const identity = await p.$queryRawUnsafe('SELECT current_database() AS name');
    assert.equal(identity[0].name, target.database, 'Server database identity mismatch');
    assert.equal((await p.$queryRawUnsafe('SELECT 1 FROM pg_namespace WHERE nspname=$1', schema)).length, 0);
    const rollback = new Error('SYNTHETIC_ROLLBACK');
    // TEST: PostgreSQL applies every migration statement transactionally, then rolls back.
    await assert.rejects(p.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA ${prefix}`);
      for (const sql of statements) await tx.$executeRawUnsafe(sql);
      await insertRun(tx, 'rollback-migration');
      throw rollback;
    }, options), error => error === rollback);
    assert.equal((await p.$queryRawUnsafe('SELECT 1 FROM pg_namespace WHERE nspname=$1', schema)).length, 0);
    console.log('PASS migration rollback');
    await p.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA ${prefix}`);
      for (const sql of statements) await tx.$executeRawUnsafe(sql);
    }, options);
    created = true;
    const tables = await p.$queryRawUnsafe('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename', schema);
    assert.deepEqual(tables.map(row => row.tablename), ['FbsReshipmentClaim', 'FbsReshipmentRun']);
    await insertRun(p, 'claim-a'); await insertRun(p, 'claim-b', 'claim-b', 'NEW_ITEM');
    const metadata = await p.$queryRawUnsafe(`SELECT "sourceRequestIds","status","phase" FROM ${runTable} WHERE "id"='claim-a'`);
    assert.deepEqual(metadata[0], { sourceRequestIds: ['synthetic-source'], status: 'PENDING', phase: 'PLANNED' });
    const duplicate = await Promise.allSettled([insertRun(p, 'duplicate-a', 'shared-fingerprint'), insertRun(p, 'duplicate-b', 'shared-fingerprint')]);
    assert.equal(duplicate.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(duplicate.filter(row => row.status === 'rejected').length, 1);
    assert(sqlState(duplicate.find(row => row.status === 'rejected').reason, '23505'), 'Expected unique violation, not a timeout');
    console.log('PASS migration schema, sourceRequestIds and concurrent fingerprint uniqueness');
    const claims = await Promise.allSettled([claimRace('claim-row-a', 'claim-a'), claimRace('claim-row-b', 'claim-b')]);
    assert.equal(claims.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(claims.filter(row => row.status === 'rejected').length, 1);
    assert(sqlState(claims.find(row => row.status === 'rejected').reason, '23505'), 'Expected claim unique violation, not a timeout');
    assert.equal((await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM ${claimTable}`))[0].count, 1);
    // TEST: rollback also removes claims, so failed local finalization cannot strand a new run.
    await assert.rejects(p.$transaction(async tx => {
      await insertRun(tx, 'rollback-run'); await insertClaim(tx, 'rollback-claim', 'rollback-run', 'rollback-order');
      throw rollback;
    }, options), error => error === rollback);
    assert.equal((await p.$queryRawUnsafe(`SELECT "id" FROM ${runTable} WHERE "id"='rollback-run'`)).length, 0);
    assert.equal((await p.$queryRawUnsafe(`SELECT "id" FROM ${claimTable} WHERE "id"='rollback-claim'`)).length, 0);
    console.log('PASS overlapping different-mode claim exclusion and rollback');
    await insertRun(p, 'lease-run');
    const leases = await Promise.all([acquire('worker-a'), acquire('worker-b')]);
    assert.deepEqual(leases.sort(), [0, 1]);
    const old = (await p.$queryRawUnsafe(`SELECT "leaseToken" FROM ${runTable} WHERE "id"='lease-run'`))[0].leaseToken;
    await p.$executeRawUnsafe(`UPDATE ${runTable} SET "leaseUntil"=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE "id"='lease-run'`);
    assert.equal(await acquire('worker-new'), 1);
    assert.equal(await p.$executeRawUnsafe(`UPDATE ${runTable} SET "phase"='WB_VERIFIED' WHERE "id"='lease-run' AND "leaseToken"=$1`, old), 0);
    assert.equal(await p.$executeRawUnsafe(`UPDATE ${runTable} SET "status"='CREATED',"leaseUntil"=NULL WHERE "id"='lease-run' AND "leaseToken"='worker-new'`), 1);
    assert.equal(await acquire('worker-after-complete'), 0);
    console.log('PASS atomic lease acquisition, expiry takeover, stale worker fencing and terminal exclusion');
    await assert.rejects(insertRun(p, 'invalid-mode', 'invalid-mode', 'INVALID'), error => sqlState(error, '23514'));
    await assert.rejects(insertClaim(p, 'orphan', 'missing-run', 'orphan-order'), error => sqlState(error, '23503'));
    const owner = (await p.$queryRawUnsafe(`SELECT "runId" FROM ${claimTable} LIMIT 1`))[0].runId;
    await assert.rejects(p.$executeRawUnsafe(`DELETE FROM ${runTable} WHERE "id"=$1`, owner), error => sqlState(error, '23503'));
    console.log('PASS mode constraint and claim foreign-key restrict');
    console.log(JSON.stringify({ passed: true, layer: 'PostgreSQL migration/claims/leases only', applicationSagaTested: false,
      productionChanged: false, wbCalled: false, syntheticDataOnly: true }));
  } finally {
    try {
      // Only this exact cryptographically generated schema is recoverably disposable test data.
      if (created) {
        assert.equal((await p.$queryRawUnsafe('SELECT current_database() AS name'))[0].name, target.database);
        await p.$executeRawUnsafe(`DROP SCHEMA ${quotedSchema(schema)} CASCADE`);
        console.log('CLEANUP isolated synthetic schema removed; no pre-existing table touched');
      }
    } finally { await p.$disconnect(); }
  }
}
if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else main().catch(error => {
    // Avoid emitting connection URLs, passwords or driver diagnostic payloads.
    console.error(`FAIL PostgreSQL verification (${error.name || 'Error'}${error.code ? `/${error.code}` : ''}); inspect the isolated runner privately.`);
    process.exitCode = 1;
  });
}
module.exports = { validateTarget, migrationStatements };
