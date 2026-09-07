const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parse } = require('./pallet-sorting-artifacts.cjs');
// FIX: enabling cannot replace warehouse code, old downloads or unrelated runtime settings.
function config(before, after) {
  assert(before.Env.includes('WMS_PALLET_SORTING_ENABLED=false'));
  assert(after.Env.includes('WMS_PALLET_SORTING_ENABLED=true'));
  const normalized = c => ({ ...c, Env: c.Env.filter(e => !e.startsWith('WMS_PALLET_SORTING_ENABLED=')).sort() });
  assert.deepEqual(normalized(before), normalized(after));
}
function web(before, after) {
  for (const [p, h] of before) { assert(after.has(p), `removed ${p}`); if (p !== 'index.html') assert.equal(after.get(p), h, `changed ${p}`); }
  assert.notEqual(before.get('index.html'), after.get('index.html'));
  for (const p of after.keys()) if (!before.has(p)) assert(p.startsWith('assets/') || p === 'downloads/logoff-tsd-sorting-159.apk', `unexpected ${p}`);
  assert.equal(after.get('downloads/logoff-tsd-sorting-159.apk'), '83497bfba3c025ac3be813ede3329c36da8154883fb1bacaffb2287ff20d30f8');
}
module.exports = { config, web };
if (require.main === module) {
  const root = process.argv[2]; assert.equal(root, '/opt/logoff-wms-backups/admin-sorting-enable-20260907');
  const read = name => fs.readFileSync(`${root}/${name}`, 'utf8');
  assert.equal(read('api-before.sha256'), read('api-after.sha256'));
  config(JSON.parse(read('config-before.json')), JSON.parse(read('config-after.json')));
  web(parse(read('web-before.sha256'), '/usr/share/nginx/html/'), parse(read('web-after.sha256'), '/usr/share/nginx/html/'));
  console.log('ENABLE_ARTIFACTS_VERIFIED');
}
