const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { config, web } = require('./pallet-sorting-enable-verify.cjs');
// TEST: this release upgrades LOGOFF only, not the sold flavor or its shared default.
test('release 159 or a newer sorting release is scoped to LOGOFF', () => {
  const text = readFileSync('apps/android-tsd/app/build.gradle.kts', 'utf8');
  const logoff = text.split('create("logoff")')[1].split('create("ffullhab")')[0];
  // TEST: later reviewed releases may advance the version without invalidating the original flavor isolation.
  assert(Number(logoff.match(/versionCode = (\d+)/)?.[1]) >= 159);
  assert.match(logoff, /versionName = "0\.1\.\d+-(?:pallet-sorting|sorting-recovery)"/);
  assert.match(text.split('flavorDimensions')[0], /versionCode = 153/);
  assert.doesNotMatch(text.split('create("ffullhab")')[1].split('create("platform")')[0], /versionCode\s*=/);
});
// TEST: only this flag can change; the global update channel stays untouched in the pilot artifact.
test('allows exactly the sorting flag', () => config({ Env: ['SAFE=true', 'WMS_PALLET_SORTING_ENABLED=false'] }, { Env: ['SAFE=true', 'WMS_PALLET_SORTING_ENABLED=true'] }));
test('rejects an unrelated runtime change', () => assert.throws(() => config({ Env: ['SAFE=true', 'WMS_PALLET_SORTING_ENABLED=false'] }, { Env: ['SAFE=false', 'WMS_PALLET_SORTING_ENABLED=true'] })));
const before = new Map([['index.html', 'a'], ['downloads/logoff-tsd.json', 'b'], ['assets/old.js', 'c']]);
const after = () => new Map([...before, ['index.html', 'd'], ['assets/new.js', 'e'], ['downloads/logoff-tsd-sorting-159.apk', '83497bfba3c025ac3be813ede3329c36da8154883fb1bacaffb2287ff20d30f8']]);
test('accepts the signed versioned artifact', () => web(before, after()));
test('rejects changing the global channel', () => { const n = after(); n.set('downloads/logoff-tsd.json', 'x'); assert.throws(() => web(before, n)); });
test('rejects a different APK', () => { const n = after(); n.set('downloads/logoff-tsd-sorting-159.apk', 'x'); assert.throws(() => web(before, n)); });
test('rejects deleting old lazy bundles', () => { const n = after(); n.delete('assets/old.js'); assert.throws(() => web(before, n)); });
