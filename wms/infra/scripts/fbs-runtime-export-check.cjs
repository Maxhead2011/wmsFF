// FIX: run this against the assembled API image before switching production.
const assert = require('node:assert/strict');

const REQUIRED = [
  'physicalKizRelabelEnabled',
  'pendingSizeKizRelabel',
  'readPhysicalKizRelabel',
  'proposePhysicalKizRelabel',
  'cancelPhysicalKizRelabel',
  'applyPhysicalKizRelabel',
];

function verifyFbsPhysicalKizExports(moduleExports) {
  for (const name of REQUIRED) {
    assert.equal(typeof moduleExports[name], 'function', `Missing FBS runtime export: ${name}`);
  }
}

if (require.main === module) {
  const modulePath = process.argv[2] ||
    '/app/apps/api/dist/modules/marketplace-connections/fbs-physical-kiz-relabel.js';
  verifyFbsPhysicalKizExports(require(modulePath));
  process.stdout.write('FBS runtime exports: OK\n');
}

module.exports = { verifyFbsPhysicalKizExports };
