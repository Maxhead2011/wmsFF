// TEST: synthetic database only. Never connect this test to a production database.
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
const { ArchivedEmptyBoxPalletDetachService } = require('../dist/common/boxes/archived-empty-box-pallet-detach.service');
const p = new PrismaClient();
const scopes = new ClientScopeService();
const policy = new BoxCodePolicyService({ get: async () => DEFAULT_BOX_CODE_POLICY });
const balances = new StockBalancesService(p, scopes);
const stock = new StockOperationsService(p, scopes, balances, undefined, undefined, undefined, policy);
const service = db => new PalletSortingService(db, scopes, policy, stock, new ArchivedEmptyBoxPalletDetachService(p, policy), {});
const canonical = serial => `010460000000000121${serial}`;
async function main() {
  assert.equal(await p.client.count(), 0, 'fresh dedicated synthetic database required');
  const c = await p.client.create({ data: { code: 'QA_RECORDED', name: 'Synthetic' } });
  const w = await p.warehouse.create({ data: { code: 'QA_RECORDED', name: 'Synthetic' } });
  const u = await p.user.create({ data: { email: 'recorded@example.invalid', name: 'Synthetic admin', passwordHash: 'NOT_A_LOGIN_HASH' } });
  const user = { id: u.id, roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], activeWarehouseId: w.id };
  const sku = await p.sku.create({ data: { clientId: c.id, internalSku: 'QA', name: 'Synthetic SKU', needsChestnyZnak: true,
    barcodes: { create: { value: '2052399249995', isPrimary: true } } } });
  const spare = await p.sku.create({ data: { clientId: c.id, internalSku: 'SPARE', name: 'Untouched other size' } });
  const pallet = await p.storagePallet.create({ data: { clientId: c.id, warehouseId: w.id, code: 'PAL_QA_RECORDED' } });
  const recorded = await p.box.create({ data: { clientId: c.id, warehouseId: w.id, code: 'FFL_QA_RECORDED_41' } });
  const physical = await p.box.create({ data: { clientId: c.id, warehouseId: w.id, code: 'FFL_QA_PHYSICAL_44' } });
  await p.storagePalletBox.create({ data: { boxId: physical.id, boxCode: physical.code, palletId: pallet.id } });
  for (const [skuId, quantity] of [[sku.id, 2], [spare.id, 4]]) {
    const dims = { clientId: c.id, warehouseId: w.id, skuId, boxId: recorded.id, status: 'AVAILABLE' };
    await p.stockBalance.create({ data: { ...dims, balanceKey: balances.balanceKey(dims), quantity } });
  }
  const identities = ['0104640684260411215HWPK7"wuWnMH', '0104640684260411215PS5pwv*"blO&'];
  for (const value of identities) await p.productMark.create({ data: { clientId: c.id, skuId: sku.id, boxId: recorded.id, status: 'AVAILABLE', value } });
  const s = service(p);
  let state = await s.start({ id: randomUUID(), code: pallet.code }, user);
  const action = async (action, extra = {}) => state = await s.action(state.id, { action, operationId: randomUUID(), version: state.version, ...extra }, user);
  await action('SCAN_SOURCE', { code: physical.code });
  await action('BEGIN_FORMING');
  await action('OPEN_TARGET', { code: 'FFL_QA_RECORDED_TARGET', palletCode: pallet.code });
  const target = state.activeTargetId;
  // TEST: neither a missing source scan nor an obsolete physical hint gates an existing KIZ.
  for (const [index, kiz] of identities.entries()) {
    const scan = { barcode: '2052399249995', kiz, ...(index ? { sourceBoxCode: 'FFL_QA_UNKNOWN_SOURCE' } : {}) };
    const command = { action: 'MOVE', operationId: randomUUID(), version: state.version, ...scan };
    if (!index) {
      const results = await Promise.allSettled([s.action(state.id, command, user), s.action(state.id, command, user)]);
      assert(results.some(r => r.status === 'fulfilled'), results.map(r => r.reason?.message).join('; '));
      for (const result of results.filter(r => r.status === 'rejected')) assert(result.reason.code === 'P2034' || result.reason.code === 'P2010' && result.reason.meta?.code === '40001');
      state = await s.action(state.id, command, user);
    } else await action('MOVE', scan);
    await action('MOVE', scan);
  }
  assert.equal(state.moves.length, 2);
  assert.equal(state.moves[0].sourceBoxId, recorded.id);
  assert.equal(state.moves[0].sourceCorrection.physicalBoxId, null);
  assert.equal(state.moves[1].sourceCorrection.physicalBoxCode, 'FFL_QA_UNKNOWN_SOURCE');
  assert(!state.sources.some(b => b.id === recorded.id));
  assert.equal(await p.stockMovement.count(), 4);
  assert.equal(await p.stockMovement.count({ where: { boxId: physical.id } }), 0);
  assert.equal((await p.stockBalance.aggregate({ where: { boxId: recorded.id, skuId: spare.id }, _sum: { quantity: true } }))._sum.quantity, 4);
  assert.equal((await p.stockBalance.aggregate({ where: { boxId: target }, _sum: { quantity: true } }))._sum.quantity, 2);
  assert.equal((await p.stockBalance.aggregate({ _sum: { quantity: true } }))._sum.quantity, 6);
  assert.equal(await p.productMark.count({ where: { boxId: target } }), 2);
  assert.equal(await p.productMark.count(), 2);
  assert.equal(await p.auditLog.count({ where: { action: 'PALLET_SORTING_UNIT_MOVED_SOURCE_CORRECTED' } }), 2);
  await action('CLOSE_TARGET');
  const preview = await s.preview(state.id, 'remaining', user);
  assert.equal(preview.quantity, 0, 'recorded box spare units must not enter shortage/archive preview');
  await action('COMPLETE', { fingerprint: preview.fingerprint });
  assert.equal(state.stage, 'COMPLETED');
  assert.equal((await p.box.findUniqueOrThrow({ where: { id: recorded.id } })).status, 'active');
  assert.equal((await p.stockBalance.aggregate({ where: { boxId: recorded.id, skuId: spare.id }, _sum: { quantity: true } }))._sum.quantity, 4);
  console.log(JSON.stringify({ result: 'PASS', moved: 2, target: 2, untouchedSpare: 4, total: 6, ledger: 4, newReceipts: 0, duplicateScan: 'PASS', completion: 'PASS' }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => p.$disconnect());
