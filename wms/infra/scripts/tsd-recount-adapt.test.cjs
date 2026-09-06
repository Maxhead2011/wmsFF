const { test } = require('node:test');
const assert = require('node:assert/strict');
const { adapt } = require('./tsd-recount-adapt.cjs');
const stock = 'apps/api/src/modules/stock/stock-operations.service.ts';
const device = 'apps/api/src/modules/tsd/tsd-device.controller.ts';
const registry = 'apps/api/src/modules/administration/administration-internal-api.service.ts';
function fixture() { return {
  [stock]: 'keepStockGuard();\r\nkeepHistory();\n',
  [device]: "@Get('x')\r\n".repeat(74),
  'apps/api/src/modules/tsd/tsd-sync.controller.ts': "@Post('x')\n".repeat(10),
  'apps/api/test/tsd-storage-box-transfer.spec.ts': 'assertStock();\r\n',
  [registry]: 'routeCount: 75, // FIX: complete TSD history (list, detail, screenshot) plus screenshot upload.',
}; }
// TEST: only line endings and the approved display count change; inputs remain immutable.
test('preserves stock logic while adapting approved live context', () => {
  const input = fixture(); const out = adapt(input);
  assert.equal(out[stock], 'keepStockGuard();\nkeepHistory();\n');
  assert.equal(input[stock], 'keepStockGuard();\r\nkeepHistory();\n');
  assert.match(out[registry], /^routeCount: 84,/);
});
// TEST: any unexpected handlers or registry changes must stop the release.
test('refuses changed route surface', () => { const f=fixture(); f[device]+="@Post('new')"; assert.throws(()=>adapt(f), /handlers/); });
test('refuses an unreviewed registry', () => { const f=fixture(); f[registry]='routeCount: 99'; assert.throws(()=>adapt(f), /registry/); });
