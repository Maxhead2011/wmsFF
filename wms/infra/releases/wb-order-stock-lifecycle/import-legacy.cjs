// FIX: controlled historical backfill uses proof from the isolated rehearsal, never its bills or stocks.
const fs = require('node:fs');
const crypto = require('node:crypto');
const readline = require('node:readline');
const assert = require('node:assert/strict');
const { PrismaClient } = require('/app/apps/api/node_modules/@prisma/client');
const db = new PrismaClient();
(async () => {
  const [file, expectedHash, mode] = process.argv.slice(2);
  assert.equal(mode, '--apply-reviewed-legacy-facts');
  assert.match(expectedHash, /^[a-f0-9]{64}$/);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  assert.equal(hash.digest('hex'), expectedHash, 'Reviewed history artifact changed');
  const sql = fs.readFileSync(require('node:path').join(__dirname, 'import-legacy.sql'), 'utf8');
  let batch = [], inspected = 0, inserted = 0;
  async function flush() {
    if (!batch.length) return;
    inserted += await db.$executeRawUnsafe(sql, JSON.stringify(batch));
    inspected += batch.length; batch = [];
  }
  for await (const line of readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    assert.equal(row.fact?.source, 'LEGACY_WMS_SHIPMENT');
    assert.ok(row.history?.assemblyId);
    batch.push(row);
    if (batch.length === 100) await flush();
  }
  await flush();
  console.log(JSON.stringify({ inspected, inserted, unchangedOrSkipped: inspected - inserted }));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
