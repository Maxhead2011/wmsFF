const assert = require('node:assert/strict');
const fs = require('node:fs');
const BOX = 'c5d24770-f536-406d-8e8e-9f5d731f4225';
const SKU = '47254ddb-5fff-463a-be8b-83a905d4909e';
const CLIENT = 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9';
const WH = 'afb244a1-50ae-4ae6-9111-afe85949fa58';
const REQUEST = 'c08ee426-a793-4bb8-837e-dd7ca9a82f1a';
const KEY = 'repair:ffl-lkb2107-22:duplicate-pick:31120d9e-df14-4b52-8415-43950f67ad1f';

// FIX: never derive an adjustment solely from physical scans; require the exact double-deduction evidence.
function validateEvidence(e) {
  assert.equal(e.box.id, BOX); assert.equal(e.box.code, 'FFL_LKB2107_22');
  assert.equal(e.box.clientId, CLIENT); assert.equal(e.box.warehouseId, WH);
  assert(['active', 'receiving'].includes(e.box.status));
  assert.equal(e.balances.length, 1); assert.equal(e.balances[0].skuId, SKU);
  assert.equal(e.balances[0].status, 'AVAILABLE'); assert.equal(e.balances[0].quantity, 6);
  assert.equal(e.ledgerAvailable, 6); assert.equal(e.markCount, 7); assert.equal(e.matchedScans, 7);
  assert.equal(e.uniqueScans, 7); assert.equal(e.protectedHistoryCount, 0); assert.equal(e.batchLedgerRows, 0);
  assert.equal(e.request.number, 576); assert.equal(e.request.status, 'DONE');
  assert.deepEqual(e.tasks, [{ id: '0e7acd50-9c0e-4dac-9640-d3a9ab5b8c63', orderId: '5653603723', itemCount: 1, status: 'COMPLETED' }]);
  assert.deepEqual(e.deductions.map(m => m.id).sort(), ['330eb3fc-f0e1-48b9-ae31-96d98aa66d87', '31120d9e-df14-4b52-8415-43950f67ad1f'].sort());
  for (const m of e.deductions) {
    assert.equal(m.type, 'PICK'); assert.equal(m.status, 'AVAILABLE'); assert.equal(m.quantity, -1); assert.equal(m.sourceDocument, REQUEST);
  }
  return 1;
}

async function evidence(tx) {
  const box = await tx.box.findUniqueOrThrow({ where: { id: BOX }, select: { id: true, code: true, status: true, clientId: true, warehouseId: true } });
  const balances = await tx.stockBalance.findMany({ where: { boxId: BOX, quantity: { not: 0 } }, select: { id: true, skuId: true, status: true, quantity: true }, orderBy: { id: 'asc' } });
  const ledger = await tx.stockMovement.aggregate({ where: { boxId: BOX, skuId: SKU, status: 'AVAILABLE' }, _sum: { quantity: true } });
  const op = await tx.tsdOperation.findUniqueOrThrow({ where: { id: '793a4807-136c-4755-b192-19a44364cbd5' }, select: { payload: true, status: true } });
  assert.equal(op.status, 'REJECTED');
  const body = op.payload.request.body;
  assert.equal(body.fromBoxCode, box.code); assert.equal(body.toBoxCode, 'FFL_LKBS0709_07');
  const identities = body.scanCodes.map(s => s.slice(0, 31));
  const marks = await tx.productMark.findMany({ where: { boxId: BOX, skuId: SKU, status: 'AVAILABLE' }, select: { id: true, value: true }, orderBy: { id: 'asc' } });
  const prefixes = identities.flatMap(id => [id, ']d2' + id, '(01)' + id.slice(2,16) + '(21)' + id.slice(18)]).map(v => v.replace(/[\\%_]/g, '\\$&'));
  let protectedHistoryCount = 0;
  for (const model of ['fbsTsdAssembly', 'shippedKizHistory', 'fbsWebKizStickerPrint', 'fbsAssemblyAttemptHistory', 'fbsPrintJob']) {
    protectedHistoryCount += await tx[model].count({ where: { OR: prefixes.map(v => ({ kiz: { startsWith: v } })) } });
  }
  protectedHistoryCount += await tx.kizCirculationItem.count({ where: { OR: prefixes.map(v => ({ kizRaw: { startsWith: v } })) } });
  const request = await tx.clientRequest.findUniqueOrThrow({ where: { id: REQUEST }, select: { number: true, status: true } });
  const tasks = await tx.fbsTsdAssembly.findMany({ where: { requestId: REQUEST, OR: [{ boxId: BOX }, { reservedBoxId: BOX }] },
    select: { id: true, orderId: true, itemCount: true, status: true }, orderBy: { id: 'asc' } });
  const deductions = await tx.stockMovement.findMany({ where: { boxId: BOX, skuId: SKU, sourceDocument: REQUEST, status: 'AVAILABLE', quantity: { lt: 0 } },
    select: { id: true, type: true, status: true, quantity: true, sourceDocument: true }, orderBy: { id: 'asc' } });
  const batchLedgerRows = await tx.stockMovement.count({ where: { idempotencyKey: { startsWith: body.idempotencyKey + ':' } } });
  return { box, balances, ledgerAvailable: ledger._sum.quantity ?? 0, markCount: marks.length,
    matchedScans: identities.filter(id => marks.filter(m => m.value.startsWith(id)).length === 1).length,
    uniqueScans: new Set(identities).size, protectedHistoryCount, batchLedgerRows, request, tasks, deductions,
    markIds: marks.map(m => m.id) };
}

async function run(p, mode, snapshotPath) {
  if (mode === 'snapshot') return p.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const e = await evidence(tx); validateEvidence(e); return e;
  }, { isolationLevel: 'RepeatableRead', timeout: 15000 });
  assert.equal(mode, 'apply');
  const before = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')); validateEvidence(before);
  return p.$transaction(async tx => {
    // FIX: serialize with inventory startup and operations locking this exact source box.
    await tx.$executeRawUnsafe('LOCK TABLE "InventorySession" IN SHARE MODE');
    await tx.$queryRawUnsafe('SELECT "id" FROM "Box" WHERE "id" = $1 FOR UPDATE', BOX);
    assert.equal(await tx.inventorySession.count({ where: { type: 'FULL', status: { in: ['ACTIVE', 'REVIEW'] } } }), 0, 'Full inventory is active');
    assert.equal(await tx.inventoryAuditBox.count({ where: { boxId: BOX, status: { in: ['COUNTING', 'MISMATCH'] } } }), 0, 'Source box is being recounted');
    const existing = await tx.stockMovement.findUnique({ where: { idempotencyKey: KEY } });
    if (existing) {
      assert.equal(existing.boxId, BOX); assert.equal(existing.skuId, SKU); assert.equal(existing.quantity, 1);
      return { status: 'ALREADY_APPLIED', movementId: existing.id };
    }
    const current = await evidence(tx); validateEvidence(current);
    assert.deepEqual(current, before, 'Data changed after backup; stop');
    const movement = await tx.stockMovement.create({ data: { clientId: CLIENT, warehouseId: WH, boxId: BOX, skuId: SKU,
      type: 'INVENTORY_ADJUSTMENT', status: 'AVAILABLE', quantity: 1, idempotencyKey: KEY,
      sourceDocument: REQUEST, comment: 'Коррекция повторного списания при закрытии заявки 576: PICK 31120d9e после уже выполненного PICK 330eb3fc. Подтверждено Константином 08.09.2026. Не новая приёмка.' } });
    const changed = await tx.stockBalance.updateMany({ where: { id: current.balances[0].id, boxId: BOX, skuId: SKU, clientId: CLIENT,
      warehouseId: WH, status: 'AVAILABLE', quantity: 6 }, data: { quantity: { increment: 1 } } });
    assert.equal(changed.count, 1);
    // TEST: ledger and materialized stock must agree; all marks remain in the original box.
    const after = await evidence(tx);
    assert.equal(after.ledgerAvailable, 7); assert.equal(after.balances[0].quantity, 7);
    assert.deepEqual(after.markIds, before.markIds); assert.equal(after.batchLedgerRows, 0);
    assert.deepEqual(after.deductions, before.deductions);
    await tx.auditLog.create({ data: { action: 'STOCK_DUPLICATE_PICK_CORRECTED', entity: 'Box', entityId: BOX,
      payload: { operator: 'Codex maintenance via SSH', authorizedBy: 'Константин, explicit confirmation',
        requestNumber: 576, orderId: '5653603723', beforeQuantity: 6, afterQuantity: 7,
        correctionMovementId: movement.id, originalMovementIds: before.deductions.map(m => m.id), kizRecordsUnchanged: true } } });
    return { status: 'APPLIED', box: current.box.code, before: 6, after: 7, correction: 1, movementId: movement.id, marksUnchanged: true };
  }, { isolationLevel: 'Serializable', timeout: 20000 });
}
module.exports = { validateEvidence, run };
if (require.main === module) {
  const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient();
  run(p, process.argv[2], process.argv[3]).then(r => console.log(JSON.stringify(r)))
    .catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => p.$disconnect());
}
