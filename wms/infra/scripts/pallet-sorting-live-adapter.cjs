const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, realpathSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');

function adapt(registry, inventory, sorting) {
  // FIX: only the confirmed stale display count is adapted; warehouse logic is untouched.
  const handlers = text => (text.match(/@(Get|Post|Patch|Put|Delete|Options|Head|All)\s*\(/g) || []).length;
  assert.equal(handlers(inventory), 16, 'inventory handlers changed');
  assert.equal(handlers(sorting), 7, 'sorting handlers changed');
  const block = /id: 'inventory',\r?\n    name: 'Инвентаризация',\r?\n    prefixes: \['\/inventory'\],\r?\n    routeCount: 14,/g;
  assert.equal([...registry.matchAll(block)].length, 1, 'unreviewed registry');
  return registry.replace(block, value => value.replace('routeCount: 14,', 'routeCount: 16, // FIX: include both SKU collection handlers.'));
}
function adaptWarehouse(registry, warehouse, locations) {
  // FIX: both live controllers already contain 42 handlers; only the displayed count is stale.
  const count = text => (text.match(/@(Get|Post|Patch|Put|Delete|Options|Head|All)\s*\(/g) || []).length;
  assert.equal(count(warehouse), 30, 'warehouse handlers changed');
  assert.equal(count(locations), 12, 'warehouse handlers changed');
  const block = /id: 'warehouse',\r?\n    name: 'Склад и размещение',\r?\n    prefixes: \['\/warehouse', '\/warehouse\/storage-locations'\],\r?\n    \/\/ FIX: account for DELETE \/warehouse\/storage-locations\/zones\/:id\.\r?\n    routeCount: 40,/g;
  assert.equal([...registry.matchAll(block)].length, 1, 'unreviewed warehouse registry');
  return registry.replace(block, value => value.replace('routeCount: 40,', 'routeCount: 42,'));
}
module.exports = { adapt, adaptWarehouse };

if (require.main === module) {
  const root = realpathSync(process.argv[2]);
  assert.match(root, /^\/tmp\/admin-sorting-pr63-check\.[A-Za-z0-9]+$/, 'isolated staging directory required');
  const registryPath = resolve(root, 'apps/api/src/modules/administration/administration-internal-api.service.ts');
  const registry = readFileSync(registryPath, 'utf8');
  const warehouseMode = process.argv[3] === '--warehouse';
  assert.equal(createHash('sha256').update(registry).digest('hex'), warehouseMode
    ? '5a780e19eac906977a2861ab7315ae6e1dfa6332fbdb4c9d214b930047a0b383'
    : '48721557a0598f153943db964a809eaf003261ec08a623bf0f4ddb3bf7de3b07', 'live registry changed');
  const result = warehouseMode
    ? adaptWarehouse(registry, readFileSync(resolve(root, 'apps/api/src/modules/warehouse/warehouse.controller.ts'), 'utf8'), readFileSync(resolve(root, 'apps/api/src/modules/warehouse/storage-locations.controller.ts'), 'utf8'))
    : adapt(registry, readFileSync(resolve(root, 'apps/api/src/modules/inventory/inventory.controller.ts'), 'utf8'), readFileSync(process.argv[3], 'utf8'));
  writeFileSync(registryPath, result);
  console.log('APPROVED_REGISTRY_CONTEXT_ADAPTED');
}
