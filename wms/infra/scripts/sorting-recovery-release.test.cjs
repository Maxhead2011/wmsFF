const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
// TEST: LOGOFF advances; global/sold flavor defaults must remain unchanged.
test('sorting recovery is a new LOGOFF version only', () => {
  const code = fs.readFileSync('apps/android-tsd/app/build.gradle.kts', 'utf8');
  const logoff = code.split('create("logoff")')[1].split('create("ffullhab")')[0];
  assert.match(logoff, /versionCode = 160\b/);
  assert.match(logoff, /versionName = "0.1.161-sorting-recovery"/);
  assert.match(code.split('flavorDimensions')[0], /versionCode = 153\b/);
  assert.doesNotMatch(code.split('create("ffullhab")')[1].split('create("platform")')[0], /versionCode\s*=/);
});
test('overlay retains the independently published weight fix', () => {
  // TEST: adding recovery must never restore the old >25kg calculated-weight blocker.
  const { preserveWeight } = require('./sorting-recovery-overlay.cjs');
  const old = 'head\nexport function validateBoxWeight(OLD) {}\nfunction isPalletPackage() {}';
  const live = old.replace('OLD', 'LIVE_WARNING_ONLY');
  const desired = old.replace('head', 'head\nrecoverSortingUnit');
  assert.equal(preserveWeight(live, old, desired), desired.replace('OLD', 'LIVE_WARNING_ONLY'));
  assert.throws(() => preserveWeight(live.replace('head', 'unreviewed'), old, desired));
});
test('artifact verifier rejects channel changes and unrelated API changes', () => {
  // TEST: no shared APK/channel update, config change or file deletion is allowed.
  const { verifyApi, verifyWeb } = require('./sorting-recovery-overlay.cjs');
  const before = new Map([['modules/inventory/pallet-sorting.service.ts', 'a'], ['other.ts', 'b']]);
  verifyApi(before, new Map([...before, ['modules/inventory/pallet-sorting.service.ts', 'c']]), '.ts');
  assert.throws(() => verifyApi(before, new Map([...before, ['other.ts', 'c']]), '.ts'));
  const web = new Map([['index.html', 'a'], ['downloads/logoff-tsd.json', 'b'], ['assets/old.js', 'c']]);
  const next = new Map([...web, ['index.html', 'new'], ['downloads/logoff-tsd-sorting-recovery-160.apk', 'signed'], ['assets/new.js', 'd']]);
  verifyWeb(web, next, 'signed');
  assert.throws(() => verifyWeb(web, new Map([...next, ['downloads/logoff-tsd.json', 'changed']]), 'signed'));
  next.delete('assets/old.js'); assert.throws(() => verifyWeb(web, next, 'signed'));
});
