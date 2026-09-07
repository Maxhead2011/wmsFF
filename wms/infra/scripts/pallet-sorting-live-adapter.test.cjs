const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { adapt, adaptWarehouse } = require('./pallet-sorting-live-adapter.cjs');
const root = resolve(__dirname, '../..');
const inventory = readFileSync(resolve(root, 'apps/api/src/modules/inventory/inventory.controller.ts'), 'utf8');
const sorting = readFileSync(resolve(root, 'apps/api/src/modules/inventory/pallet-sorting.controller.ts'), 'utf8');
const registry = "before\n    id: 'inventory',\n    name: 'Инвентаризация',\n    prefixes: ['/inventory'],\n    routeCount: 14,\n    description: 'keep',\nafter\n";

// TEST: runtime already has 16 handlers; adapt only the stale catalogue count.
test('changes only the approved stale count before applying the ordinary PR patch', () => {
  assert.equal(adapt(registry, inventory, sorting), registry.replace('routeCount: 14,', 'routeCount: 16, // FIX: include both SKU collection handlers.'));
});
// TEST: an unreviewed route surface cannot silently change the release.
test('rejects an extra inventory route', () => assert.throws(() => adapt(registry, inventory + '\n@Get("extra")\n', sorting), /inventory handlers/));
test('rejects an extra sorting route', () => assert.throws(() => adapt(registry, inventory, sorting + '\n@Post("extra")\n'), /sorting handlers/));
test('rejects unexpected catalogue content', () => assert.throws(() => adapt(registry.replace('routeCount: 14,', 'routeCount: 99,'), inventory, sorting), /registry/));
test('rejects duplicate catalogue entries', () => assert.throws(() => adapt(registry + registry, inventory, sorting), /registry/));

const warehouse = readFileSync(resolve(root, 'apps/api/src/modules/warehouse/warehouse.controller.ts'), 'utf8');
const locations = readFileSync(resolve(root, 'apps/api/src/modules/warehouse/storage-locations.controller.ts'), 'utf8');
const warehouseRegistry = "before\n    id: 'warehouse',\n    name: 'Склад и размещение',\n    prefixes: ['/warehouse', '/warehouse/storage-locations'],\n    // FIX: account for DELETE /warehouse/storage-locations/zones/:id.\n    routeCount: 40,\nafter";
// TEST: keep real controller-count assertions; correct the stale catalogue rather than expected tests.
test('adapts the approved warehouse count to its actual 42 handlers', () => assert.equal(adaptWarehouse(warehouseRegistry, warehouse, locations), warehouseRegistry.replace('routeCount: 40,', 'routeCount: 42,')));
test('rejects unreviewed warehouse route counts', () => assert.throws(() => adaptWarehouse(warehouseRegistry, warehouse + '\n@Post("extra")', locations), /warehouse handlers/));
test('rejects unreviewed warehouse registry', () => assert.throws(() => adaptWarehouse(warehouseRegistry.replace('40,', '41,'), warehouse, locations), /registry/));
// TEST: unreadable/empty controller content must never be interpreted as the approved surface.
test('rejects an empty inventory controller', () => assert.throws(() => adapt(registry, '', sorting), /inventory handlers/));
test('rejects an empty sorting controller', () => assert.throws(() => adapt(registry, inventory, ''), /sorting handlers/));
test('rejects an empty warehouse controller', () => assert.throws(() => adaptWarehouse(warehouseRegistry, '', locations), /warehouse handlers/));
test('rejects an empty storage-locations controller', () => assert.throws(() => adaptWarehouse(warehouseRegistry, warehouse, ''), /warehouse handlers/));
