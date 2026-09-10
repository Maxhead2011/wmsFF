const assert = require('node:assert/strict');
const fs = require('node:fs');
const {parse, verify} = require('./pallet-sorting-artifacts.cjs');
const modules = ['tsd-receipt.service', 'tsd-sync.service', 'tsd-operation.types', 'dto/scan-operation.dto'];
function checkWeb(before, after, meta) {
  const apk = 'downloads/logoff-tsd-receipt-close-165.apk';
  assert(!before.has(apk), 'versioned APK must be new');
  verify(before, after, ['downloads/logoff-tsd.apk', 'downloads/logoff-tsd.json', apk]);
  assert.equal(meta.versionCode, 165);
  assert.equal(meta.versionName, '0.1.166-receipt-close');
  assert.equal(meta.apkUrl, 'https://wms.logoff.pro/' + apk);
  assert.match(meta.sha256, /^[a-f0-9]{64}$/);
  assert.equal(after.get(apk), meta.sha256);
  assert.equal(after.get('downloads/logoff-tsd.apk'), meta.sha256);
}
module.exports = {checkWeb, modules};
if (require.main === module) {
  const [root, release] = process.argv.slice(2);
  const read = n => fs.readFileSync(root + '/' + n, 'utf8');
  const manifests = (name, prefix) => ['before', 'after'].map(x => parse(read(name+'-'+x+'.sha256'), prefix));
  verify(...manifests('api', '/app/apps/api/'), modules.flatMap(x => ['src/modules/tsd/'+x+'.ts', 'dist/modules/tsd/'+x+'.js']));
  checkWeb(...manifests('web', '/usr/share/nginx/html/'), JSON.parse(fs.readFileSync(release+'/wms/apps/web/public/downloads/logoff-tsd.json')));
  for (const kind of ['api', 'web']) assert.deepEqual(JSON.parse(read(kind+'-config-before.json')), JSON.parse(read(kind+'-config-after.json')));
  console.log('ONLY_RECEIPT_CLOSE_AND_LOGOFF_165_CHANGED');
}
