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
  assert.equal(await p.client.count(), 0, 'empty dedicated test database required');
  const client = await p.client.create({ data: { code: 'QA_RECOVERY', name: 'Synthetic recovery' } });
  const warehouse = await p.warehouse.create({ data: { code: 'QA_RECOVERY', name: 'Synthetic' } });
  const actor = await p.user.create({ data: { email: 'recovery@example.invalid', passwordHash: 'NOT_A_LOGIN_HASH', name: 'Synthetic admin' } });
  const user = { id: actor.id, roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], activeWarehouseId: warehouse.id };
  const sku = await p.sku.create({ data: { clientId: client.id, internalSku: 'QA', name: 'Synthetic SKU', needsChestnyZnak: true,
    barcodes: { create: { value: '4600000000001', isPrimary: true } } } });
  const pallet = await p.storagePallet.create({ data: { clientId: client.id, warehouseId: warehouse.id, code: 'PAL_QA_RECOVERY' } });
  await p.storagePalletBox.create({ data: { palletId: pallet.id, boxCode: 'FFL_QA_UNKNOWN' } });
  const s = service(p);
  let state = await s.start({ id: randomUUID(), code: pallet.code }, user);
  assert.equal(state.problemSources[0].reason, 'BOX_NOT_FOUND');
  async function action(action, extra = {}) {
    state = await s.action(state.id, { operationId: randomUUID(), version: state.version, action, ...extra }, user);
    return state;
  }
  await action('SCAN_SOURCE', { code: 'FFL_QA_UNKNOWN' });
  await action('SCAN_SOURCE', { code: 'FFL_QA_UNKNOWN' });
  assert.equal(state.problemSources.length, 1);
  assert.equal(await p.box.count(), 0);
  assert.equal(await p.stockMovement.count(), 0);
  await action('BEGIN_FORMING');
  await action('OPEN_TARGET', { code: 'FFL_QA_RECOVERED', palletCode: pallet.code });
  const targetId = state.activeTargetId;
  const scan = { barcode: '4600000000001', kiz: canonical('ABCDEFGHIJKLM') };
  await action('MOVE', scan);
  await action('MOVE', { ...scan, kiz: scan.kiz + '<GS>91EE12' });
  assert.equal(state.moves.length, 1);
  assert.equal(state.moves[0].recovered, true);
  assert.equal(await p.stockMovement.count(), 1);
  assert.equal((await p.stockBalance.aggregate({ _sum: { quantity: true } }))._sum.quantity, 1);
  assert.equal((await p.productMark.findFirstOrThrow()).boxId, targetId);

  // TEST: final command-audit failure must roll back mark, balance, movement and session.
  const faulty = new Proxy(p, { get(target, key) {
    if (key === '$transaction') return (callback, options) => p.$transaction(tx => callback(new Proxy(tx, { get(t, k) {
      if (k === 'auditLog') return new Proxy(t.auditLog, { get(a, method) {
        if (method === 'create') return args => args.data.action === 'PALLET_SORTING_COMMAND' ? Promise.reject(new Error('TEST_ROLLBACK')) : a.create(args);
        return Reflect.get(a, method);
      } });
      return Reflect.get(t, k);
    } })), options);
    return Reflect.get(target, key);
  } });
  const rolledBack = canonical('ROLLBACK00001');
  await assert.rejects(service(faulty).action(state.id, { action: 'MOVE', version: state.version, operationId: randomUUID(), barcode: scan.barcode, kiz: rolledBack }, user), /TEST_ROLLBACK/);
  assert.equal(await p.productMark.count({ where: { value: rolledBack } }), 0);
  assert.equal(await p.stockMovement.count(), 1);
  assert.equal((await p.stockBalance.aggregate({ _sum: { quantity: true } }))._sum.quantity, 1);
  assert.equal((await s.get(state.id, user)).version, state.version);

  // TEST: simultaneous delivery/retry of the same operation applies exactly once.
  const concurrent = { action: 'MOVE', version: state.version, operationId: randomUUID(), barcode: scan.barcode, kiz: canonical('CONCURRENT001') };
  const results = await Promise.allSettled([s.action(state.id, concurrent, user), s.action(state.id, concurrent, user)]);
  assert.ok(results.some(r => r.status === 'fulfilled'));
  state = await s.action(state.id, concurrent, user);
  assert.equal(state.moves.length, 2);
  assert.equal(await p.stockMovement.count(), 2);

  // TEST: literal SQL LIKE metacharacters and alternative scanner representations.
  const literal = canonical('ABC%_EFGHIJKL');
  await p.productMark.create({ data: { clientId: client.id, skuId: sku.id, value: `]d2${literal}\u001d91OLD`, status: 'SHIPPING' } });
  await assert.rejects(action('MOVE', { barcode: scan.barcode, kiz: `${literal}<GS>91NEW` }), /КИЗ/);
  assert.equal(await p.stockMovement.count(), 2);
  const available = canonical('DIFFERENT0001');
  await action('MOVE', { barcode: scan.barcode, kiz: available });
  assert.equal(await p.stockMovement.count(), 3);
  const beforeComplete = await s.preview(state.id, 'remaining', user);
  assert.equal(beforeComplete.quantity, 0);
  assert.equal(beforeComplete.recoveredQuantity, 3);
  assert.equal(beforeComplete.problemSources[0].code, 'FFL_QA_UNKNOWN');
  await action('CLOSE_TARGET');
  const preview = await s.preview(state.id, 'remaining', user);
  await action('COMPLETE', { fingerprint: preview.fingerprint });
  assert.equal(state.stage, 'COMPLETED');
  assert.equal((await p.box.findUniqueOrThrow({ where: { id: targetId } })).status, 'active');
  assert.equal((await p.stockBalance.aggregate({ where: { boxId: targetId }, _sum: { quantity: true } }))._sum.quantity, 3);
  assert.equal(await p.auditLog.count({ where: { action: 'PALLET_SORTING_UNIT_RECOVERED' } }), 3);
  assert.equal(await p.box.count({ where: { code: 'FFL_QA_UNKNOWN' } }), 0);
  console.log(JSON.stringify({ result: 'PASS', recovered: 3, ledger: 3, rollback: 'PASS', concurrentRetry: 'PASS', alternativeKizAndLiteralLike: 'PASS', completion: 'PASS' }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => p.$disconnect());
