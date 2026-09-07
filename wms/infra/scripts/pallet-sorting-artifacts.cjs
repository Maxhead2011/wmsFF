const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
// FIX: staged deployment must retain every file outside the reviewed sorting scope.
const api = ['modules/administration/administration-internal-api.service', 'modules/inventory/dto/pallet-sorting.dto',
  'modules/inventory/inventory.module', 'modules/inventory/pallet-sorting-policy', 'modules/inventory/pallet-sorting.controller',
  'modules/inventory/pallet-sorting.service', 'modules/marketplace-connections/marketplace-connections.service', 'modules/stock/stock-operations.service'];
const web = ['App.tsx', 'lib/workspaces.ts', 'lib/pallet-sorting-api.ts', 'components/inventory/PalletSortingPanel.tsx',
  'components/inventory/PalletSortingPanel.spec.tsx', 'components/inventory/pallet-sorting.css'];
function parse(text, prefix) {
  const result = new Map();
  for (const line of text.trim().split('\n')) {
    const m = line.match(/^([a-f0-9]{64})\s+(.+)$/);
    assert(m && m[2].startsWith(prefix), 'invalid manifest path');
    const path = m[2].slice(prefix.length);
    assert(path && !path.split('/').includes('..') && !result.has(path), 'invalid or duplicate path');
    result.set(path, m[1]);
  }
  return result;
}
function verify(before, after, allowed) {
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(p => before.get(p) !== after.get(p));
  assert(changed.length, 'no feature changes');
  for (const path of changed) {
    assert(after.has(path), `file removed: ${path}`);
    assert(allowed.includes(path), `unapproved change: ${path}`);
  }
  return changed;
}
function verifyWeb(before, after) {
  // FIX: APKs, channel manifests and old lazy-loaded bundles must remain byte-identical.
  for (const [path, hash] of before) {
    assert(after.has(path), `web file removed: ${path}`);
    if (path !== 'index.html') assert.equal(after.get(path), hash, `web file changed: ${path}`);
  }
  assert(before.get('index.html') !== after.get('index.html'), 'web index unchanged');
  for (const path of after.keys()) if (!before.has(path)) assert(path.startsWith('assets/'), `unapproved new web file: ${path}`);
}
function verifyConfig(before, after) {
  const trim = value => ({ ...value, Env: (value.Env || []).filter(e => !e.startsWith('WMS_PALLET_SORTING_ENABLED=')).sort() });
  assert((after.Env || []).includes('WMS_PALLET_SORTING_ENABLED=false'), 'sorting must remain disabled');
  assert(!(before.Env || []).includes('WMS_PALLET_SORTING_ENABLED=true'), 'unexpected enabled baseline');
  assert.deepEqual(trim(after), trim(before), 'unapproved runtime configuration change');
}
module.exports = { api, web, parse, verify, verifyWeb, verifyConfig };
if (require.main === module) {
  const root = process.argv[2];
  assert.equal(root, '/opt/logoff-wms-backups/admin-sorting-staged-20260907');
  const load = (name, prefix) => parse(readFileSync(`${root}/${name}.sha256`, 'utf8'), prefix);
  const source = verify(load('api-before', '/app/apps/api/src/'), load('api-candidate', '/app/apps/api/src/'), api.map(p => p + '.ts'));
  const compiled = verify(load('dist-before', '/app/apps/api/dist/'), load('dist-candidate', '/app/apps/api/dist/'), api.map(p => p + '.js'));
  const webSource = verify(load('web-src-before', 'src/'), load('web-src-candidate', 'src/'), web);
  verifyWeb(load('web-before', '/usr/share/nginx/html/'), load('web-candidate', '/usr/share/nginx/html/'));
  verifyConfig(JSON.parse(readFileSync(`${root}/api-config-before.json`)), JSON.parse(readFileSync(`${root}/api-config-candidate.json`)));
  console.log(JSON.stringify({ status: 'PASS', source, compiled, webSource }));
}
