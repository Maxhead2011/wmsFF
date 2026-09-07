// TEST: synthetic SQL database only, guarded before Prisma construction.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(url.hostname, 'sorting-pr63-postgres-20260907');
assert.equal(url.pathname, '/sorting_recovery_test');
process.env.WMS_PALLET_SORTING_ENABLED = 'true';
const { PrismaClient } = require('@prisma/client');
const { PalletSortingService } = require('../dist/modules/inventory/pallet-sorting.service');
const { StockOperationsService } = require('../dist/modules/stock/stock-operations.service');
const { StockBalancesService } = require('../dist/modules/stock/stock-balances.service');
const { ClientScopeService } = require('../dist/modules/auth/client-scope.service');
const { BoxCodePolicyService, DEFAULT_BOX_CODE_POLICY } = require('../dist/common/boxes/box-code-policy.service');
const p = new PrismaClient(), scopes = new ClientScopeService();
const policy = new BoxCodePolicyService({ get: async () => DEFAULT_BOX_CODE_POLICY });
const balances = new StockBalancesService(p, scopes);
const stock = new StockOperationsService(p, scopes, balances, undefined, undefined, undefined, policy);
const service = db => new PalletSortingService(db, scopes, policy, stock, {}, {});
async function main() {
  assert.equal(await p.client.count(), 0, 'fresh synthetic database required');
  const c = await p.client.create({ data: { code: 'QA_LATE', name: 'Synthetic' } });
  const w = await p.warehouse.create({ data: { code: 'QA_LATE', name: 'Synthetic' } });
  const u = await p.user.create({ data: { email: 'late@example.invalid', name: 'Synthetic admin', passwordHash: 'NOT_A_LOGIN_HASH' } });
  const user = { id: u.id, roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], activeWarehouseId: w.id };
  const sku = await p.sku.create({ data: { clientId: c.id, internalSku: 'QA', name: 'Synthetic SKU', needsChestnyZnak: true,
    barcodes: { create: { value: '4600000000001', isPrimary: true } } } });
  const pallet = await p.storagePallet.create({ data: { clientId: c.id, warehouseId: w.id, code: 'PAL_QA_LATE' } });
  const s = service(p);
  let state = await s.start({ id: randomUUID(), code: pallet.code }, user);
  const action = async (action, extra = {}) => state = await s.action(state.id, { action, operationId: randomUUID(), version: state.version, ...extra }, user);
  await action('BEGIN_FORMING');
  await action('OPEN_TARGET', { code: 'FFL_QA_TARGET', palletCode: pallet.code });
  const target = state.activeTargetId;
  // TEST: ten real units, but the source is placed after the snapshot was created.
  const source = await p.box.create({ data: { clientId: c.id, warehouseId: w.id, code: 'FFL_QA_LATE' } });
  await p.storagePalletBox.create({ data: { boxId: source.id, boxCode: source.code, palletId: pallet.id } });
  const dims = { clientId: c.id, warehouseId: w.id, skuId: sku.id, boxId: source.id, status: 'AVAILABLE' };
  await p.stockBalance.create({ data: { ...dims, balanceKey: balances.balanceKey(dims), quantity: 10 } });
  const command = { action: 'MOVE', version: state.version, operationId: randomUUID(), sourceBoxCode: source.code,
    barcode: '4600000000001', kiz: '010460000000000121ABCDEFGHIJKLM' };
  // TEST: invalid barcode cannot persist source addition, audit, mark or movement.
  await assert.rejects(s.action(state.id, { ...command, barcode: 'UNKNOWN', operationId: randomUUID() }, user), /ШК товара не найден/);
  assert.equal((await s.get(state.id, user)).sources.length, 0);
  assert.equal(await p.auditLog.count({ where: { action: 'PALLET_SORTING_LATE_SOURCE_SCANNED' } }), 0);
  assert.equal(await p.stockMovement.count(), 0);
  const outcomes = await Promise.allSettled([s.action(state.id, command, user), s.action(state.id, command, user)]);
  assert(outcomes.some(r => r.status === 'fulfilled'));
  state = await s.action(state.id, command, user);
  assert.equal(state.sources.length, 1);
  assert.equal(state.moves.length, 1);
  assert.equal(state.moves[0].recovered, undefined);
  assert.equal(await p.stockMovement.count(), 2);
  assert.equal((await p.stockBalance.aggregate({ where: { boxId: source.id }, _sum: { quantity: true } }))._sum.quantity, 9);
  assert.equal((await p.stockBalance.aggregate({ where: { boxId: target }, _sum: { quantity: true } }))._sum.quantity, 1);
  assert.equal((await p.stockBalance.aggregate({ _sum: { quantity: true } }))._sum.quantity, 10);
  assert.equal((await p.productMark.findFirstOrThrow()).boxId, target);
  assert.equal(await p.auditLog.count({ where: { action: 'PALLET_SORTING_LATE_SOURCE_SCANNED' } }), 1);
  const preview = await s.preview(state.id, 'remaining', user);
  assert.equal(preview.quantity, 9); // Existing separate shortage confirmation still sees leftovers.
  console.log(JSON.stringify({ result: 'PASS', source: 9, target: 1, total: 10, ledger: 2, retry: 'PASS', invalidBarcodeRollback: 'PASS', remainingPreview: 9 }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => p.$disconnect());
