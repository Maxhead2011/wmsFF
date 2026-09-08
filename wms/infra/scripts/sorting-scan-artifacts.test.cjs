const { test } = require('node:test'), assert = require('node:assert/strict');
const { verifyRelease } = require('./sorting-scan-artifacts.cjs');
function fixture() {
  const api = new Map([['src/modules/inventory/pallet-sorting.service.ts', 'old'], ['dist/modules/inventory/pallet-sorting.service.js', 'old'], ['src/sos.ts', 'keep']]);
  const web = new Map([['index.html', 'keep'], ['downloads/logoff-tsd.apk', 'old'], ['downloads/logoff-tsd.json', 'old'], ['downloads/ff-tsd.apk', 'sold']]);
  const nextApi = new Map(api); for (const k of nextApi.keys()) if (k.includes('pallet-sorting')) nextApi.set(k, 'new');
  const nextWeb = new Map(web); nextWeb.set('downloads/logoff-tsd.apk', 'a'.repeat(64)); nextWeb.set('downloads/logoff-tsd.json', 'new'); nextWeb.set('downloads/logoff-tsd-sorting-scan-161.apk', 'a'.repeat(64));
  const meta = { versionCode: 161, versionName: '0.1.162-sorting-scan', apkUrl: 'https://wms.logoff.pro/downloads/logoff-tsd-sorting-scan-161.apk', sha256: 'a'.repeat(64) };
  return { api, web, nextApi, nextWeb, meta, run() { verifyRelease(api, nextApi, web, nextWeb, meta); } };
}
test('accepts exactly the service, default channel and immutable LOGOFF APK', () => { fixture().run(); });
for (const kind of ['sold', 'sos', 'deleted', 'extra', 'checksum', 'version', 'immutable']) test('rejects ' + kind + ' release drift', () => {
  // TEST: an unrelated release cannot be hidden inside this rollout.
  const f = fixture();
  if (kind === 'sold') f.nextWeb.set('downloads/ff-tsd.apk', 'changed');
  if (kind === 'sos') f.nextApi.set('src/sos.ts', 'changed');
  if (kind === 'deleted') f.nextWeb.delete('index.html');
  if (kind === 'extra') f.nextWeb.set('extra.js', 'new');
  if (kind === 'checksum') f.nextWeb.set('downloads/logoff-tsd.apk', 'wrong');
  if (kind === 'version') f.meta.versionCode = 160;
  if (kind === 'immutable') f.web.set('downloads/logoff-tsd-sorting-scan-161.apk', 'old');
  assert.throws(() => f.run());
});
test('actual release CLI verifies manifests and rejects runtime configuration drift', () => {
  // TEST: exercise the same command used by stage/publish, including configuration equality.
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const { execFileSync } = require('node:child_process'), { createHash } = require('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sorting-scan-release-'));
  const files = [];
  const write = (name, value) => { const p = path.join(dir, name); fs.writeFileSync(p, value); files.push(p); return p; };
  try {
    const f = fixture();
    for (const [name, map, prefix] of [['api-before', f.api, '/app/apps/api/'], ['api-after', f.nextApi, '/app/apps/api/'], ['web-before', f.web, '/usr/share/nginx/html/'], ['web-after', f.nextWeb, '/usr/share/nginx/html/']]) {
      write(name + '.sha256', [...map].map(([p, hash]) => (hash.length === 64 ? hash : createHash('sha256').update(hash).digest('hex')) + '  ' + prefix + p).join('\n') + '\n');
    }
    for (const kind of ['api', 'web']) for (const phase of ['before', 'after']) write(kind + '-config-' + phase + '.json', '{"Cmd":["run"],"Env":[]}');
    const meta = write('meta.json', JSON.stringify(f.meta));
    const run = () => execFileSync(process.execPath, [path.join(__dirname, 'sorting-scan-artifacts.cjs'), dir, meta], { encoding: 'utf8', stdio: 'pipe' });
    assert.match(run(), /ONLY_SORTING_SERVICE_AND_LOGOFF_CHANNEL_CHANGED/);
    fs.writeFileSync(path.join(dir, 'api-config-after.json'), '{"Cmd":["unexpected"],"Env":[]}');
    assert.throws(run);
  } finally { for (const file of files) fs.unlinkSync(file); fs.rmdirSync(dir); }
});
