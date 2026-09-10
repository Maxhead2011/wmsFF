const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {checkWeb} = require('./tsd-receipt-close-artifacts.cjs');
const hash = 'a'.repeat(64), old = 'b'.repeat(64);
const before = new Map([['index.html',old],['downloads/ff-tsd.apk',old],['downloads/logoff-tsd.apk',old],['downloads/logoff-tsd.json',old]]);
const after = new Map([...before, ['downloads/logoff-tsd.apk',hash], ['downloads/logoff-tsd.json',hash], ['downloads/logoff-tsd-receipt-close-165.apk',hash]]);
const meta = {versionCode:165, versionName:'0.1.166-receipt-close', apkUrl:'https://wms.logoff.pro/downloads/logoff-tsd-receipt-close-165.apk', sha256:hash};
// TEST: unrelated assets and sold APK must never be replaced by this release.
test('allows only the intended download channel', () => checkWeb(before, after, meta));
for (const file of ['index.html', 'downloads/ff-tsd.apk']) test('rejects mutation of '+file, () => {
  assert.throws(() => checkWeb(before, new Map([...after,[file,hash]]), meta));
});
test('rejects a wrong APK hash or version', () => {
  assert.throws(() => checkWeb(before, after, {...meta, sha256:old}));
  assert.throws(() => checkWeb(before, after, {...meta, versionCode:164}));
});
test('bump belongs only to LOGOFF', () => {
  const code=fs.readFileSync(path.join(__dirname,'../../apps/android-tsd/app/build.gradle.kts'),'utf8');
  assert.match(code,/create\("logoff"\)[\s\S]*?versionCode = 165/);
  assert.match(code,/defaultConfig[\s\S]*?versionCode = 153/);
});
// TEST: the live host uses Docker's legacy builder (without BuildKit).
test('Dockerfile can be built without BuildKit', () => {
  const code=fs.readFileSync(path.join(__dirname,'../tsd-receipt-close.Dockerfile'),'utf8');
  assert(!/^COPY --chmod/m.test(code));
  assert.match(code,/RUN chmod 644/);
});
