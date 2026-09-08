const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parse, verify } = require('./pallet-sorting-artifacts.cjs');
// FIX: fail closed on drift outside the reviewed service and the LOGOFF download channel.
function verifyRelease(beforeApi, afterApi, beforeWeb, afterWeb, metadata) {
  assert.deepEqual(verify(beforeApi, afterApi, ['src/modules/inventory/pallet-sorting.service.ts', 'dist/modules/inventory/pallet-sorting.service.js']).sort(),
    ['dist/modules/inventory/pallet-sorting.service.js', 'src/modules/inventory/pallet-sorting.service.ts']);
  const apk = 'downloads/logoff-tsd.apk', json = 'downloads/logoff-tsd.json', versioned = 'downloads/logoff-tsd-sorting-scan-161.apk';
  assert(!beforeWeb.has(versioned), 'immutable APK already exists');
  assert.equal(afterWeb.size, beforeWeb.size + 1);
  assert.deepEqual(verify(beforeWeb, afterWeb, [apk, json, versioned]).sort(), [apk, json, versioned].sort());
  assert.equal(metadata.versionCode, 161);
  assert.equal(metadata.versionName, '0.1.162-sorting-scan');
  assert.equal(metadata.apkUrl, 'https://wms.logoff.pro/' + versioned);
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
  assert.equal(afterWeb.get(apk), metadata.sha256);
  assert.equal(afterWeb.get(versioned), metadata.sha256);
}
module.exports = { verifyRelease };
if (require.main === module) {
  const root = process.argv[2], metadata = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const read = (name, prefix) => parse(fs.readFileSync(root + '/' + name + '.sha256', 'utf8'), prefix);
  verifyRelease(read('api-before', '/app/apps/api/'), read('api-after', '/app/apps/api/'), read('web-before', '/usr/share/nginx/html/'), read('web-after', '/usr/share/nginx/html/'), metadata);
  for (const kind of ['api', 'web']) assert.deepEqual(JSON.parse(fs.readFileSync(root + '/' + kind + '-config-before.json')), JSON.parse(fs.readFileSync(root + '/' + kind + '-config-after.json')));
  console.log('ONLY_SORTING_SERVICE_AND_LOGOFF_CHANNEL_CHANGED');
}
