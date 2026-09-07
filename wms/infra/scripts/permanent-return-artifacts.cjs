// FIX: publication refuses any changed API source or JS outside the reviewed PR56 scope.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = '/opt/logoff-wms-backups/permanent-return-20260906';
const allowed = [
  'common/boxes/archived-empty-box-pallet-detach.service', 'common/boxes/box-code-policy.service',
  'common/shipment-history/shipped-kiz-history', 'modules/administration/administration-unpalleted-writeoff.service',
  'modules/inventory/sku-sorting.service', 'modules/marketplace-connections/dto/resolve-fbs-sync-conflict.dto',
  'modules/marketplace-connections/fbs-return-receipt', 'modules/marketplace-connections/marketplace-connections.service',
  'modules/stock/stock-operations.service', 'modules/tsd/tsd-assembly.service',
  'modules/warehouse/warehouse-box-integrity.service', 'scripts/reconcile-archived-empty-pallet-boxes',
];
function hashes(path) {
  return new Map(fs.readFileSync(path, 'utf8').trim().split('\n').map(line => {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/); assert(match, 'Invalid manifest');
    return [match[2], match[1]];
  }));
}
function verify(before, after, prefix, extension) {
  const a = hashes(root + '/' + before), b = hashes(root + '/' + after);
  const changed = [...new Set([...a.keys(), ...b.keys()])].filter(path => a.get(path) !== b.get(path));
  for (const path of changed) {
    assert(allowed.some(item => path === prefix + item + extension), `Unapproved artifact changed: ${path}`);
    assert(b.has(path), `Artifact removed: ${path}`);
  }
  assert(changed.some(path => path.endsWith('/fbs-return-receipt' + extension)));
  return changed;
}
console.log(JSON.stringify({ status: 'PASS',
  source: verify('api-before.sha256', 'api-candidate.sha256', '/app/apps/api/src/', '.ts'),
  compiled: verify('dist-before.sha256', 'dist-candidate.sha256', '/app/apps/api/dist/', '.js'),
}));
