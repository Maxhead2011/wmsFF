// TEST: never run against production. All rows below are synthetic in a fresh isolated database.
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
const s = new PalletSortingService(p, scopes, policy, stock, {}, {});
const kiz = n => '010460000000000121' + String(n).padStart(13, '0');
async function main() {
  assert.equal(await p.client.count(), 0, 'fresh synthetic database required');
  const c = await p.client.create({ data: { code: 'QA_DIFF', name: 'Synthetic' } });
  const w = await p.warehouse.create({ data: { code: 'QA_DIFF', name: 'Synthetic' } });
  const u = await p.user.create({ data: { email: 'diff@example.invalid', name: 'Synthetic admin', passwordHash: 'NOT_A_LOGIN_HASH' } });
  const user = { id: u.id, roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], activeWarehouseId: w.id };
  const createSku = (name, barcode) => p.sku.create({ data: { clientId: c.id, internalSku: name, name, needsChestnyZnak: true,
    barcodes: { create: { value: barcode, isPrimary: true } } } });
  const oldSku = await createSku('Recorded grey', '4600000000001');
  const foundSku = await createSku('Physical brown', '2044970217769');
  const pallet = await p.storagePallet.create({ data: { clientId: c.id, warehouseId: w.id, code: 'PAL_QA_DIFF' } });
  const source = await p.box.create({ data: { clientId: c.id, warehouseId: w.id, code: 'FFL_QA_SOURCE' } });
  const other = await p.box.create({ data: { clientId: c.id, warehouseId: w.id, code: 'FFL_QA_UNRELATED' } });
  await p.storagePalletBox.create({ data: { boxId: source.id, boxCode: source.code, palletId: pallet.id } });
  const add = async (boxId, skuId, quantity, status = 'AVAILABLE') => {
    const dims = { clientId: c.id, warehouseId: w.id, boxId, skuId, status };
    return p.stockBalance.create({ data: { ...dims, quantity, balanceKey: balances.balanceKey(dims) } });
  };
  const sum = async where => (await p.stockBalance.aggregate({ where, _sum: { quantity: true } }))._sum.quantity ?? 0;
  await add(source.id, oldSku.id, 10);
  await add(other.id, foundSku.id, 7);
  let state = await s.start({ id: randomUUID(), code: pallet.code }, user);
  const action = async (action, extra = {}) => state = await s.action(state.id, { action, operationId: randomUUID(), version: state.version, ...extra }, user);
  await action('SCAN_SOURCE', { code: source.code });
  await action('BEGIN_FORMING');
  await action('OPEN_TARGET', { code: 'FFL_QA_TARGET', palletCode: pallet.code });
  const target = state.activeTargetId;
  // TEST: normal paired moves consume all ten recorded units without a surplus.
  for (let n = 1; n <= 10; n++) await action('MOVE', { sourceBoxCode: source.code, barcode: '4600000000001', kiz: kiz(n) });
  assert.equal(await sum({ boxId: source.id }), 0);
  assert.equal(await sum({ boxId: target }), 10);
  assert.equal(await p.stockMovement.count(), 20);
  const command = { action: 'MOVE', operationId: randomUUID(), version: state.version, sourceBoxCode: source.code, barcode: '2044970217769', kiz: kiz(100) };
  // TEST: same incident — another actual SKU is found in the exhausted source box.
  state = await s.action(state.id, command, user);
  assert.equal(state.moves.filter(m => m.recovered).length, 1);
  assert.equal(state.moves.at(-1).recoveryReason, 'SKU_STOCK_MISSING');
  assert.equal(state.moves.at(-1).sourceBoxId, source.id);
  assert.equal(await sum({ boxId: source.id }), 0);
  assert.equal(await sum({ boxId: target, skuId: foundSku.id }), 1);
  assert.equal(await sum({ boxId: other.id }), 7);
  const receipt = await p.stockMovement.findFirstOrThrow({ where: { type: 'INVENTORY_ADJUSTMENT' } });
  assert.equal(receipt.quantity, 1); assert.equal(receipt.boxId, target);
  assert.match(receipt.comment, /расхождение/);
  assert.equal(await p.auditLog.count({ where: { action: 'PALLET_SORTING_UNIT_RECOVERED' } }), 1);
  // TEST: same command, another operation ID and crypto-tail retries do not add again.
  state = await s.action(state.id, command, user);
  await action('MOVE', { ...command, operationId: randomUUID(), version: state.version, kiz: kiz(100) + '<GS>91EE12' });
  assert.equal(await p.stockMovement.count(), 21);
  // TEST: concurrent identical scans add exactly one unit, regardless of retry outcome.
  const concurrent = { ...command, version: state.version, operationId: randomUUID(), kiz: kiz(101) };
  const results = await Promise.allSettled([s.action(state.id, concurrent, user), s.action(state.id, concurrent, user)]);
  assert(results.some(r => r.status === 'fulfilled'));
  state = await s.action(state.id, concurrent, user);
  assert.equal(await sum({ boxId: target, skuId: foundSku.id }), 2);
  assert.equal(await p.stockMovement.count(), 22);
  // TEST: a failed audit rolls back balance, KIZ, ledger and session version together.
  const originalAudit = s.audit;
  s.audit = async (...args) => { if (args[3] === 'UNIT_RECOVERED') throw new Error('SYNTHETIC_AUDIT_FAILURE'); return originalAudit.apply(s, args); };
  await assert.rejects(action('MOVE', { sourceBoxCode: source.code, barcode: '2044970217769', kiz: kiz(102) }), /SYNTHETIC_AUDIT_FAILURE/);
  s.audit = originalAudit;
  assert.equal(await p.stockMovement.count(), 22);
  assert.equal(await p.productMark.count({ where: { value: kiz(102) } }), 0);
  assert.equal((await s.get(state.id, user)).version, state.version);
  // TEST: reserved source quantity is not a physical surplus; no hidden reservation bypass.
  const reserved = await add(source.id, foundSku.id, 1, 'RESERVED');
  await assert.rejects(action('MOVE', { sourceBoxCode: source.code, barcode: '2044970217769', kiz: kiz(103) }), /резерв/);
  await p.stockBalance.delete({ where: { id: reserved.id } }); // Only this synthetic test row.
  // TEST: historical mark cannot be resurrected by explicit physical source scan.
  await p.productMark.create({ data: { clientId: c.id, skuId: foundSku.id, boxId: source.id, status: 'SHIPPING', value: kiz(104) } });
  await assert.rejects(action('MOVE', { sourceBoxCode: source.code, barcode: '2044970217769', kiz: kiz(104) }), /КИЗ/);
  assert.equal(await p.stockMovement.count(), 22);
  assert.equal(await sum({ boxId: other.id }), 7);
  // TEST: missing original items still require separate shortage confirmation.
  await add(source.id, oldSku.id, 3);
  const preview = await s.preview(state.id, 'remaining', user);
  assert.equal(preview.quantity, 3); assert.equal(preview.recoveredQuantity, 2);
  assert.equal(await sum({ boxId: source.id }), 3);
  console.log(JSON.stringify({ result: 'PASS', normalMoves: 10, recovered: 2, unrelatedQuantity: 7, ledger: 22,
    idempotency: 'PASS', concurrent: 'PASS', auditRollback: 'PASS', reservation: 'PASS', historicalKiz: 'PASS', shortagePreview: 3 }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => p.$disconnect());
