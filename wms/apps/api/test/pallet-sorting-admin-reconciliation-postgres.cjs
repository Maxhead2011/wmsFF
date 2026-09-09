// TEST: run only against a disposable local database; never reads DATABASE_URL.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const supplied = process.env.ADMIN_SORTING_TEST_DATABASE_URL;
if (!supplied) {
  console.error('NOT RUN: set ADMIN_SORTING_TEST_DATABASE_URL to the isolated local test database.');
  process.exit(2);
}
const url = new URL(supplied);
assert.equal(process.env.NODE_ENV, 'test');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'local synthetic database only');
assert.equal(url.port, '55439');
assert.equal(url.pathname, '/wms_admin_sorting_test');
process.env.WMS_PALLET_SORTING_ENABLED = 'true';
const { PrismaClient } = require('@prisma/client');
const { StockOperationsService } = require('../dist/modules/stock/stock-operations.service');
const { StockBalancesService } = require('../dist/modules/stock/stock-balances.service');
const { ClientScopeService } = require('../dist/modules/auth/client-scope.service');
const p = new PrismaClient({ datasources: { db: { url: supplied } } });
const scopes = new ClientScopeService();
const balances = new StockBalancesService(p, scopes);
const stock = new StockOperationsService(p, scopes, balances);
const json = value => JSON.parse(JSON.stringify(value));
async function main() {
  assert.equal(await p.client.count(), 0, 'fresh empty synthetic database required');
  const clients = [], warehouses = [], skus = [], boxes = [];
  for (let i = 0; i < 2; i++) {
    clients.push(await p.client.create({ data: { code: `QA_ADMIN_${i}`, name: 'Synthetic administrative sorting' } }));
    warehouses.push(await p.warehouse.create({ data: { code: `QA_ADMIN_${i}`, name: 'Synthetic branch' } }));
    skus.push(await p.sku.create({ data: { clientId: clients[i].id, internalSku: `QA_ADMIN_${i}`, name: 'Synthetic SKU',
      barcodes: { create: { value: '4600000000001', isPrimary: true } } } }));
    boxes.push(await p.box.create({ data: { clientId: clients[i].id, warehouseId: warehouses[i].id,
      code: `FFL_QA_ADMIN_${i}`, status: i === 0 ? 'archived' : 'active' } }));
  }
  const actor = await p.user.create({ data: { email: 'admin-sorting@example.invalid', passwordHash: 'NOT_A_LOGIN_HASH', name: 'Synthetic admin' } });
  const user = { id: actor.id, roleCodes: ['ADMIN'], permissionCodes: [], activeWarehouseId: warehouses[1].id };
  let serial = 0;
  const newKiz = () => `010460000000000121${String(++serial).padStart(13, '0')}`;
  const run = input => p.$transaction(tx => stock.reconcileAdminSortingUnit(tx, input, user), { isolationLevel: 'Serializable', timeout: 30000 });
  const command = kiz => ({ toBoxCode: boxes[1].code, sourceBoxCode: boxes[0].code, barcode: '4600000000001', kiz,
    sessionId: 'QA_ADMIN_SORTING', idempotencyKey: `qa-admin:${randomUUID()}` });
  const total = async () => (await p.stockBalance.aggregate({ _sum: { quantity: true } }))._sum.quantity || 0;
  async function seed(status, quantity = 1) {
    const dims = { clientId: clients[0].id, warehouseId: warehouses[0].id, skuId: skus[0].id, boxId: boxes[0].id, status };
    await p.stockBalance.upsert({ where: { balanceKey: balances.balanceKey(dims) }, create: { ...dims, balanceKey: balances.balanceKey(dims), quantity }, update: { quantity: { increment: quantity } } });
    return p.productMark.create({ data: { clientId: clients[0].id, skuId: skus[0].id, boxId: boxes[0].id, status, value: newKiz() } });
  }
  for (const status of ['AVAILABLE', 'RESERVED', 'PACKING', 'SHIPPING', 'BLOCKED']) {
    // TEST: cross-client/branch movement conserves quantity for every historical status.
    const mark = await seed(status);
    const before = await total();
    const history = await p.shippedKizHistory.create({ data: { assemblyId: randomUUID(), clientId: clients[0].id,
      clientName: clients[0].name, requestId: 'QA_REQUEST', requestNumber: 1, requestTitle: 'Synthetic request',
      skuId: skus[0].id, internalSku: skus[0].internalSku, productName: 'Synthetic SKU', kiz: mark.value, shippedAt: new Date() } });
    const input = command(mark.value);
    const result = await run(input);
    assert.equal(result.recovered, false);
    assert.equal(await total(), before);
    const moved = await p.productMark.findUniqueOrThrow({ where: { id: mark.id } });
    assert.equal(moved.boxId, boxes[1].id);
    assert.equal(moved.clientId, clients[1].id);
    assert.equal(moved.skuId, skus[1].id);
    assert.equal(moved.status, 'AVAILABLE');
    assert.deepEqual(json(await p.shippedKizHistory.findUnique({ where: { id: history.id } })), json(history));
    const movements = await p.stockMovement.count();
    await run(input);
    await run({ ...input, idempotencyKey: `qa-admin:${randomUUID()}` });
    assert.equal(await total(), before);
    assert.equal(await p.stockMovement.count(), movements);
  }
  // TEST: a known boxless unit must not consume an unrelated physical source with the same barcode.
  const looseDims = { clientId: clients[0].id, warehouseId: warehouses[0].id, skuId: skus[0].id, boxId: null, status: 'AVAILABLE' };
  const looseMovement = await p.stockMovement.create({ data: { ...looseDims, type: 'INVENTORY_ADJUSTMENT', quantity: 1, sourceDocument: 'QA_BOXLESS' } });
  const looseBalance = await p.stockBalance.create({ data: { ...looseDims, balanceKey: balances.balanceKey(looseDims), quantity: 1 } });
  const looseMark = await p.productMark.create({ data: { clientId: clients[0].id, skuId: skus[0].id, boxId: null,
    value: newKiz(), status: 'AVAILABLE', stockMovementId: looseMovement.id } });
  const physicalMark = await seed('AVAILABLE');
  const boxlessTotal = await total();
  const boxlessResult = await run({ ...command(looseMark.value), sourceBoxIds: [boxes[0].id] });
  assert.equal(boxlessResult.sourceBoxId, null);
  assert.equal(boxlessResult.recovered, false);
  assert.equal(await total(), boxlessTotal);
  assert.equal((await p.stockBalance.findUnique({ where: { id: looseBalance.id } }))?.quantity || 0, 0);
  assert.equal((await p.productMark.findUniqueOrThrow({ where: { id: physicalMark.id } })).boxId, boxes[0].id);
  await run(command(physicalMark.value));
  // TEST: similar longer serial is a different item and must not be rebound or blocked.
  const shortKiz = newKiz();
  const longerMark = await p.productMark.create({ data: { clientId: clients[0].id, skuId: skus[0].id, boxId: boxes[0].id,
    value: `${shortKiz}N`, status: 'AVAILABLE' } });
  await run(command(shortKiz));
  assert.deepEqual(json(await p.productMark.findUniqueOrThrow({ where: { id: longerMark.id } })), json(longerMark));
  // TEST: missing accounting quantity is received once, with immutable audit evidence.
  const found = command(newKiz());
  const beforeFound = await total();
  assert.equal((await run(found)).recovered, true);
  assert.equal(await total(), beforeFound + 1);
  // TEST: failure after accounting updates rolls back stock, mark, ledger and audit together.
  const rollback = command(newKiz());
  const beforeRollback = { total: await total(), marks: await p.productMark.count(), movements: await p.stockMovement.count(), audits: await p.auditLog.count() };
  await assert.rejects(p.$transaction(async tx => {
    await stock.reconcileAdminSortingUnit(tx, rollback, user);
    throw new Error('QA_FORCED_ROLLBACK');
  }, { isolationLevel: 'Serializable', timeout: 30000 }), /QA_FORCED_ROLLBACK/);
  assert.deepEqual({ total: await total(), marks: await p.productMark.count(), movements: await p.stockMovement.count(), audits: await p.auditLog.count() }, beforeRollback);
  // TEST: independent concurrent scans of one identity cannot create duplicate stock.
  const concurrent = command(newKiz());
  const beforeConcurrent = await total();
  const results = await Promise.allSettled([run(concurrent), run({ ...concurrent, idempotencyKey: `qa-admin:${randomUUID()}` })]);
  assert.ok(results.some(r => r.status === 'fulfilled'));
  for (const result of results.filter(r => r.status === 'rejected')) assert.equal(result.reason.code, 'P2034', 'only a serializable conflict may be retried');
  await run({ ...concurrent, idempotencyKey: `qa-admin:${randomUUID()}` });
  assert.equal(await total(), beforeConcurrent + 1);
  assert.equal(await p.productMark.count({ where: { value: concurrent.kiz } }), 1);
  console.log('PASS: status/ownership transfer, immutable history, replay, receipt, rollback, concurrency.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => p.$disconnect());
