const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, verify, verifyWeb, verifyConfig, web } = require('./pallet-sorting-artifacts.cjs');
const old = new Map([['index.html', 'a'], ['assets/old.js', 'b'], ['downloads/logoff-tsd.json', 'c']]);
const next = () => new Map([...old, ['index.html', 'd'], ['assets/new.js', 'e']]);
// TEST: latest TSD history correction cannot disappear behind a valid sorting build.
test('rejects reverting current TSD history source', () => assert.throws(() => verify(
  new Map([['components/tsd/tsdOperationHistory.ts', 'new']]),
  new Map([['components/tsd/tsdOperationHistory.ts', 'old']]), web), /unapproved change/));
test('allows only reviewed sorting source', () => assert.deepEqual(verify(new Map([['App.tsx', 'a']]), new Map([['App.tsx', 'b']]), web), ['App.tsx']));
test('rejects removed source', () => assert.throws(() => verify(new Map([['App.tsx', 'a']]), new Map(), web), /removed/));
test('rejects no-op candidate', () => assert.throws(() => verify(old, old, web), /no feature/));
test('retains APK channel and lazy bundles', () => verifyWeb(old, next()));
test('rejects changing APK update channel', () => { const n = next(); n.set('downloads/logoff-tsd.json', 'x'); assert.throws(() => verifyWeb(old, n), /changed/); });
test('rejects removed lazy bundle', () => { const n = next(); n.delete('assets/old.js'); assert.throws(() => verifyWeb(old, n), /removed/); });
test('rejects new download artifact', () => { const n = next(); n.set('downloads/new.apk', 'x'); assert.throws(() => verifyWeb(old, n), /unapproved new/); });
test('rejects unchanged index', () => assert.throws(() => verifyWeb(old, old), /unchanged/));
test('parses exact prefixed hashes', () => assert.equal(parse('a'.repeat(64) + '  src/App.tsx', 'src/').size, 1));
test('rejects malformed and duplicate manifest paths', () => {
  for (const value of ['bad', 'a'.repeat(64) + '  elsewhere/App.tsx', 'a'.repeat(64) + '  src/../secret',
    ['a'.repeat(64) + '  src/App.tsx', 'a'.repeat(64) + '  src/App.tsx'].join('\n')]) assert.throws(() => parse(value, 'src/'));
});
// TEST: an image overlay cannot silently toggle existing warehouse safeguards.
test('allows only the disabled sorting flag', () => verifyConfig({ Env: ['GUARD=true'], Cmd: ['start'] }, { Env: ['GUARD=true', 'WMS_PALLET_SORTING_ENABLED=false'], Cmd: ['start'] }));
test('rejects changed existing flag or command', () => {
  assert.throws(() => verifyConfig({ Env: ['GUARD=true'] }, { Env: ['GUARD=false', 'WMS_PALLET_SORTING_ENABLED=false'] }));
  assert.throws(() => verifyConfig({ Env: [], Cmd: ['start'] }, { Env: ['WMS_PALLET_SORTING_ENABLED=false'], Cmd: ['repair'] }));
});
test('rejects enabling the new regime', () => assert.throws(() => verifyConfig({ Env: [] }, { Env: ['WMS_PALLET_SORTING_ENABLED=true'] }), /disabled/));
