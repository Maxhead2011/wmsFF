const fs = require('node:fs');
const assert = require('node:assert/strict');
const paths = [
  'apps/api/src/modules/stock/stock-operations.service.ts',
  'apps/api/src/modules/tsd/tsd-device.controller.ts',
  'apps/api/test/tsd-storage-box-transfer.spec.ts',
];
const registry = 'apps/api/src/modules/administration/administration-internal-api.service.ts';
function adapt(input) {
  const output = { ...input };
  const count = ['tsd-device', 'tsd-sync'].reduce((sum, name) => sum +
    (input[`apps/api/src/modules/tsd/${name}.controller.ts`].match(/@(Get|Post|Put|Patch|Delete)\(/g) || []).length, 0);
  assert.equal(count, 84, 'Unexpected live TSD handlers; review required');
  for (const path of paths) output[path] = input[path].replace(/\r\n/g, '\n');
  const old = 'routeCount: 75, // FIX: complete TSD history (list, detail, screenshot) plus screenshot upload.';
  assert.equal(input[registry].split(old).length, 2, 'Unexpected registry; review required');
  // FIX: align the display-only count with the 84 verified live handlers before the two-route patch.
  output[registry] = input[registry].replace(old,
    'routeCount: 84, // FIX: five opt-in sorting handlers, 69 existing device handlers and 10 sync handlers.');
  return output;
}
module.exports = { adapt };
if (require.main === module) {
  const root = '/opt/logoff-wms-releases/tsd-admin-recount-20260907/';
  const keys = [...paths, registry, 'apps/api/src/modules/tsd/tsd-sync.controller.ts'];
  const input = Object.fromEntries(keys.map(path => [path, fs.readFileSync(root + path, 'utf8')]));
  const output = adapt(input); // validate everything before writing any staged file
  for (const path of [...paths, registry]) fs.writeFileSync(root + path, output[path]);
  console.log('APPROVED_CONTEXT_ADAPTATION_OK');
}
