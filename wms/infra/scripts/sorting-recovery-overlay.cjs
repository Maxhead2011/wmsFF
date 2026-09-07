const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parse, verify } = require('./pallet-sorting-artifacts.cjs');
const normalize = value => value.replace(/\r\n/g, '\n');
// FIX: only the already-live independent weight function may differ from the reviewed base.
function weightParts(value) {
  value = normalize(value);
  const start = value.indexOf('export function validateBoxWeight(');
  const end = value.indexOf('\nfunction isPalletPackage(', start);
  assert(start >= 0 && end > start, 'weight function boundaries not found');
  return [value.slice(0, start), value.slice(start, end), value.slice(end)];
}
function preserveWeight(live, baseline, desired) {
  const l = weightParts(live), b = weightParts(baseline), d = weightParts(desired);
  assert.equal(l[0], b[0], 'unreviewed live change before weight function');
  assert.equal(l[2], b[2], 'unreviewed live change after weight function');
  assert.equal(d[1], b[1], 'sorting must not change weight policy');
  assert(desired.includes('recoverSortingUnit'));
  return d[0] + l[1] + d[2];
}
function verifyApi(before, after, extension) {
  return verify(before, after, ['modules/inventory/pallet-sorting.service', 'modules/stock/stock-operations.service'].map(p => p + extension));
}
function verifyWeb(before, after, apkHash) {
  for (const [p, h] of before) { assert(after.has(p), `removed ${p}`); if (p !== 'index.html') assert.equal(after.get(p), h, `changed ${p}`); }
  assert.notEqual(before.get('index.html'), after.get('index.html'));
  for (const p of after.keys()) if (!before.has(p)) assert(p.startsWith('assets/') || p === 'downloads/logoff-tsd-sorting-recovery-160.apk', `unexpected ${p}`);
  assert.equal(after.get('downloads/logoff-tsd-sorting-recovery-160.apk'), apkHash);
}
module.exports = { preserveWeight, verifyApi, verifyWeb };
if (require.main === module) {
  const mode = process.argv[2], r = process.argv[3];
  if (mode === 'prepare') {
    assert.equal(r, '/tmp/sorting-recovery-release-20260907');
    const read = p => fs.readFileSync(`${r}/${p}`, 'utf8');
    assert.equal(normalize(read('pallet-sorting.live.ts')), normalize(read('base/wms/apps/api/src/modules/inventory/pallet-sorting.service.ts')));
    const stock = preserveWeight(read('stock-operations.live.ts'), read('base/wms/apps/api/src/modules/stock/stock-operations.service.ts'), read('desired/stock-operations.service.ts'));
    fs.mkdirSync(`${r}/candidate`, { recursive: true });
    fs.writeFileSync(`${r}/candidate/stock-operations.service.ts`, stock);
    fs.writeFileSync(`${r}/candidate/pallet-sorting.service.ts`, normalize(read('desired/pallet-sorting.service.ts')));
    console.log('SCOPED_SOURCE_OVERLAY_PREPARED');
  } else {
    assert.equal(mode, 'verify');
    assert.equal(r, '/opt/logoff-wms-backups/sorting-recovery-20260907');
    const read = name => fs.readFileSync(`${r}/${name}`, 'utf8');
    const result = {
      source: verifyApi(parse(read('src-before.sha256'), '/app/apps/api/src/'), parse(read('src-after.sha256'), '/app/apps/api/src/'), '.ts'),
      compiled: verifyApi(parse(read('dist-before.sha256'), '/app/apps/api/dist/'), parse(read('dist-after.sha256'), '/app/apps/api/dist/'), '.js'),
    };
    assert.deepEqual(JSON.parse(read('config-before.json')), JSON.parse(read('config-after.json')), 'runtime config changed');
    verifyWeb(parse(read('web-before.sha256'), '/usr/share/nginx/html/'), parse(read('web-after.sha256'), '/usr/share/nginx/html/'), read('apk.sha256').trim());
    console.log(JSON.stringify({ status: 'PASS', ...result }));
  }
}
