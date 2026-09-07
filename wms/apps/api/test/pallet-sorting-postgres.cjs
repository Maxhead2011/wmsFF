// TEST: real SQL transactions on a dedicated empty database; no production data or WB calls.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(url.hostname, 'sorting-pr63-postgres-20260907');
assert.equal(url.pathname, '/sorting_pr63_test');
process.env.WMS_PALLET_SORTING_ENABLED = 'true';
process.env.WMS_PERMANENT_STORAGE_BOXES_ENABLED = 'true';
const { PrismaClient } = require('@prisma/client');
const { PalletSortingService } = require('../dist/modules/inventory/pallet-sorting.service');
const { StockOperationsService } = require('../dist/modules/stock/stock-operations.service');
const { StockBalancesService } = require('../dist/modules/stock/stock-balances.service');
const { ClientScopeService } = require('../dist/modules/auth/client-scope.service');
const { BoxCodePolicyService, DEFAULT_BOX_CODE_POLICY } = require('../dist/common/boxes/box-code-policy.service');
const { ArchivedEmptyBoxPalletDetachService } = require('../dist/common/boxes/archived-empty-box-pallet-detach.service');
const { MarketplaceConnectionsService } = require('../dist/modules/marketplace-connections/marketplace-connections.service');
const p = new PrismaClient();
const scopes = new ClientScopeService();
const policy = new BoxCodePolicyService({ get: async () => ({ ...DEFAULT_BOX_CODE_POLICY, storageBoxPrefix: 'FFL_QA_BIN_' }) });
const balances = new StockBalancesService(p, scopes);
const stock = new StockOperationsService(p, scopes, balances, undefined, undefined, undefined, policy);
const detach = new ArchivedEmptyBoxPalletDetachService(p, policy);
const service = db => new PalletSortingService(db, scopes, policy, stock, detach, new MarketplaceConnectionsService(p, scopes));
const json = value => JSON.parse(JSON.stringify(value));

async function main() {
  assert.equal(await p.client.count(), 0, 'fresh synthetic database required');
  const client = await p.client.create({ data: { code: 'QA_SORTING', name: 'Synthetic sorting test' } });
  const warehouse = await p.warehouse.create({ data: { code: 'QA_SORTING', name: 'Synthetic warehouse' } });
  const actor = await p.user.create({ data: { email: 'sorting@example.invalid', passwordHash: 'NOT_A_LOGIN_HASH', name: 'Synthetic admin' } });
  const user = { id: actor.id, roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], activeWarehouseId: warehouse.id };
  const sku = await p.sku.create({ data: { clientId: client.id, internalSku: 'QA_SORTING', name: 'Synthetic SKU', needsChestnyZnak: true,
    barcodes: { create: { value: '4600000000001', isPrimary: true } } } });
  const pallet = await p.storagePallet.create({ data: { clientId: client.id, warehouseId: warehouse.id, code: 'PAL_QA_SORTING' } });
  const sources = [];
  for (const code of ['FFL_QA_BIN_1', 'FFL_QA_SOURCE_2', 'FFL_QA_MISSING_3']) {
    const box = await p.box.create({ data: { clientId: client.id, warehouseId: warehouse.id, code } });
    await p.storagePalletBox.create({ data: { boxId: box.id, boxCode: code, palletId: pallet.id } });
    const dims = { warehouseId: warehouse.id, clientId: client.id, skuId: sku.id, boxId: box.id, status: 'AVAILABLE' };
    await p.stockBalance.create({ data: { ...dims, balanceKey: balances.balanceKey(dims), quantity: 2 } });
    sources.push(box);
  }
  const kiz = '010460000000000121ABCDEFGHIJKLM';
  const mark = await p.productMark.create({ data: { clientId: client.id, skuId: sku.id, boxId: sources[0].id, value: kiz } });
  const taskData = { clientId: client.id, connectionId: 'QA_CONNECTION', requestId: 'AUTO:QA', requestItemId: 'QA_ITEM',
    skuId: sku.id, productName: 'Synthetic SKU', barcodes: ['4600000000001'], storageBoxes: [], deviceCode: 'QA_DEVICE', status: 'RESERVED' };
  const logical = await p.fbsTsdAssembly.create({ data: { ...taskData, orderId: 'QA_ORDER_LOGICAL', reservedBoxId: sources[0].id, reservedBoxCode: sources[0].code } });
  const picked = await p.fbsTsdAssembly.create({ data: { ...taskData, orderId: 'QA_ORDER_PICKED', requestId: 'AUTO:QA_PICKED',
    boxId: sources[1].id, barcode: '4600000000001', status: 'IN_PROGRESS' } });
  const s = service(p);
  let state = await s.start({ id: randomUUID(), code: pallet.code }, user);
  const initialId = state.id;
  async function action(type, data = {}) {
    state = await s.action(state.id, { action: type, operationId: randomUUID(), version: state.version, ...data }, user);
    return state;
  }
  await assert.rejects(s.get(state.id, { ...user, roleCodes: ['WORKER'] }), /администратору/);
  await assert.rejects(s.get(state.id, { ...user, activeWarehouseId: 'another-warehouse' }), /филиалу/);
  await action('SCAN_SOURCE', { code: sources[0].code });
  await action('SCAN_SOURCE', { code: sources[1].code });
  let preview = await s.preview(state.id, 'missing', user);
  assert.equal(preview.quantity, 2);
  await assert.rejects(action('ARCHIVE_MISSING', { fingerprint: preview.fingerprint }), /подтверждение/);
  await action('ARCHIVE_MISSING', { fingerprint: preview.fingerprint, confirmWriteOff: true });
  assert.equal((await p.box.findUniqueOrThrow({ where: { id: sources[2].id } })).status, 'archived');
  await action('BEGIN_FORMING');
  await action('OPEN_TARGET', { code: 'FFL_QA_TARGET_1', palletCode: pallet.code });
  const command = { action: 'MOVE', operationId: randomUUID(), version: state.version, barcode: '4600000000001', kiz };
  const before = json(await p.stockBalance.findMany({ orderBy: { id: 'asc' } }));
  const logs = await p.stockMovement.count();
  // TEST: inject failure after the real paired MOVE/KIZ update and session save.
  const failure = new Error('TEST_FINAL_COMMAND_AUDIT_FAILURE');
  const failing = new Proxy(p, { get(target, key) {
    if (key === '$transaction') return (callback, options) => p.$transaction(tx => callback(new Proxy(tx, { get(t, k) {
      if (k === 'auditLog') return new Proxy(t.auditLog, { get(a, method) {
        if (method === 'create') return args => args.data.action === 'PALLET_SORTING_COMMAND' ? Promise.reject(failure) : a.create(args);
        return Reflect.get(a, method);
      } });
      return Reflect.get(t, k);
    } })), options);
    return Reflect.get(target, key);
  } });
  await assert.rejects(service(failing).action(state.id, command, user), e => e === failure);
  assert.deepEqual(json(await p.stockBalance.findMany({ orderBy: { id: 'asc' } })), before);
  assert.equal(await p.stockMovement.count(), logs);
  assert.equal((await p.productMark.findUniqueOrThrow({ where: { id: mark.id } })).boxId, sources[0].id);
  assert.equal((await s.get(state.id, user)).version, state.version);
  console.log('PASS actual SQL rollback of balances, MOVE, KIZ and session');
  // TEST: competing identical commands may serialize or return a retryable serialization conflict.
  const results = await Promise.allSettled([s.action(state.id, command, user), s.action(state.id, command, user)]);
  assert(results.some(r => r.status === 'fulfilled'));
  for (const result of results.filter(r => r.status === 'rejected')) {
    // TEST: Prisma wraps SQL serialization failures in raw queries as P2010 + SQLSTATE 40001.
    assert(result.reason.code === 'P2034' || result.reason.code === 'P2010' && result.reason.meta?.code === '40001', JSON.stringify(result.reason));
  }
  state = await service(p).action(state.id, command, user);
  assert.equal(await p.stockMovement.count(), logs + 2);
  assert.equal(state.moves.length, 1);
  assert.equal((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: logical.id } })).reservedBoxId, null);
  assert.deepEqual(json(await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: picked.id } })), json(picked));
  assert.equal((await p.productMark.findUniqueOrThrow({ where: { id: mark.id } })).boxId, state.activeTargetId);
  assert.equal((await p.stockBalance.aggregate({ _sum: { quantity: true } }))._sum.quantity, 4);
  await assert.rejects(s.action(state.id, { ...command, barcode: 'different' }, user), /другими данными/);
  console.log('PASS concurrent command, exact retry, paired MOVE and KIZ reassignment');
  await action('CLOSE_TARGET');
  preview = await s.preview(state.id, 'remaining', user);
  assert.equal(preview.quantity, 3);
  const complete = { action: 'COMPLETE', operationId: randomUUID(), version: state.version, fingerprint: preview.fingerprint, confirmWriteOff: true };
  state = await s.action(state.id, complete, user);
  await service(p).action(state.id, complete, user);
  const permanent = await p.box.findUniqueOrThrow({ where: { id: sources[0].id }, include: { storagePlacement: true } });
  assert.equal(permanent.status, 'active'); assert(permanent.storagePlacement);
  const ordinary = await p.box.findUniqueOrThrow({ where: { id: sources[1].id }, include: { storagePlacement: true } });
  assert.equal(ordinary.status, 'archived'); assert.equal(ordinary.storagePlacement, null);
  assert.equal((await p.stockBalance.aggregate({ _sum: { quantity: true } }))._sum.quantity, 1);
  assert.equal(await p.stockMovement.count({ where: { type: 'INVENTORY_ADJUSTMENT' } }), 3);
  state = await s.rebuildRoutes(initialId, user);
  assert.equal(state.pendingRoutes.length, 0);
  assert.equal((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: logical.id } })).reservedBoxCode, 'FFL_QA_TARGET_1');
  assert.deepEqual(json(await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: picked.id } })), json(picked));
  assert.equal((await s.list(user)).length, 0);
  assert.equal((await service(p).get(initialId, user)).stage, 'COMPLETED');
  console.log('PASS confirmed shortage, permanent/ordinary lifecycle, actual AUTO FBS rerouting, picked-task preservation and persisted resume');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => p.$disconnect());
