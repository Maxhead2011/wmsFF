// TEST: the previously deployed helper lacked pendingSizeKizRelabel and crashed every TSD scan.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyFbsPhysicalKizExports } = require('./fbs-runtime-export-check.cjs');

const names = [
  'physicalKizRelabelEnabled', 'pendingSizeKizRelabel', 'readPhysicalKizRelabel',
  'proposePhysicalKizRelabel', 'cancelPhysicalKizRelabel', 'applyPhysicalKizRelabel',
];
const complete = Object.fromEntries(names.map((name) => [name, () => undefined]));

test('rejects the runtime helper that caused the 1315 TSD 500', () => {
  const oldImageExports = { ...complete };
  delete oldImageExports.pendingSizeKizRelabel;
  assert.throws(() => verifyFbsPhysicalKizExports(oldImageExports), /pendingSizeKizRelabel/);
});

test('accepts the complete runtime helper', () => {
  assert.doesNotThrow(() => verifyFbsPhysicalKizExports(complete));
});
