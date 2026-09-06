import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';

export const approvedEmptyBox = {
  id: 'd1f98454-1117-43de-9d7c-26d661e80e94', code: 'FFL_LKNOV1607_039',
  clientId: 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9', warehouseId: 'afb244a1-50ae-4ae6-9111-afe85949fa58',
  skuId: '3402780a-b7e5-49bc-adc4-4d79a47e692a',
  availableMarkId: '3d4f6b4f-cc1f-4184-be9d-a8eb0227cb05',
  balances: [
    { id: '07078ae5-f20e-4467-bd47-af2b7566162f', skuId: '3402780a-b7e5-49bc-adc4-4d79a47e692a', status: 'PACKING', quantity: 4 },
    { id: 'cd77547c-8922-4344-a441-6da796485eae', skuId: '463d0abb-7cbc-497f-96e1-c2db35caef3c', status: 'AVAILABLE', quantity: 1 },
    { id: '114c921a-e589-495a-81dd-01c13b92b2ed', skuId: '3402780a-b7e5-49bc-adc4-4d79a47e692a', status: 'AVAILABLE', quantity: 1 },
  ],
};
export function validateEmptyBoxSnapshot(snapshot: any): { available: number; packing: number } {
  // FIX: fail closed if anything differs from the explicitly approved physical count.
  for (const key of ['id', 'code', 'clientId', 'warehouseId'] as const) assert.equal(snapshot.box?.[key], approvedEmptyBox[key], `Box ${key} changed`);
  assert.equal(snapshot.box.status, 'active');
  assert.equal(snapshot.balances.length, 3, 'Balance set changed');
  for (const expected of approvedEmptyBox.balances) {
    const actual = snapshot.balances.find((b: any) => b.id === expected.id);
    assert.ok(actual, 'Approved balance missing');
    for (const key of ['id', 'skuId', 'status', 'quantity'] as const) assert.equal(actual[key], expected[key], `Balance ${key} changed`);
    for (const key of ['clientId', 'warehouseId'] as const) assert.equal(actual[key], approvedEmptyBox[key]);
    assert.equal(actual.boxId, approvedEmptyBox.id);
  }
  const activeMarks = snapshot.marks.filter((m: any) => m.status !== 'SHIPPING');
  assert.equal(activeMarks.length, 1, 'Active marks changed');
  assert.equal(activeMarks[0].id, approvedEmptyBox.availableMarkId);
  assert.equal(activeMarks[0].skuId, approvedEmptyBox.skuId);
  assert.equal(activeMarks[0].status, 'AVAILABLE');
  assert.equal(activeMarks[0].boxId, approvedEmptyBox.id);
  assert.equal(activeMarks[0].clientId, approvedEmptyBox.clientId);
  assert.equal(snapshot.activeTasks.length, 0, 'Active picking task exists');
  assert.equal(snapshot.counting, 0, 'Inventory counting in progress');
  assert.equal(snapshot.requests.length, 3);
  for (const number of [303, 334, 523]) assert.equal(snapshot.requests.find((r: any) => r.number === number)?.status, 'DONE', 'Request reopened');
  return { available: 2, packing: 4 };
}
export const emptyBoxRepairKey = 'manager-confirmed-empty:20260906:FFL_LKNOV1607_039';
const auditAction = 'MANAGER_CONFIRMED_EMPTY_BOX_RECONCILED';

// FIX: a replay must never clear a box that has since been refilled.
export function classifyEmptyBoxRepair(movements: any[], audit: any) {
  if (!movements.length && !audit) return false;
  assert.equal(movements.length, 3, 'Partial correction exists');
  assert.ok(audit, 'Correction audit missing');
  for (const expected of approvedEmptyBox.balances) {
    const m = movements.find(row => row.idempotencyKey === `${emptyBoxRepairKey}:${expected.id}`);
    assert.ok(m, 'Correction movement missing');
    assert.equal(m.boxId, approvedEmptyBox.id); assert.equal(m.clientId, approvedEmptyBox.clientId);
    assert.equal(m.warehouseId, approvedEmptyBox.warehouseId); assert.equal(m.skuId, expected.skuId);
    assert.equal(m.quantity, -expected.quantity); assert.equal(m.status, expected.status);
    assert.equal(m.type, 'INVENTORY_ADJUSTMENT');
  }
  return true;
}
export async function applyEmptyBoxSnapshot(tx: Prisma.TransactionClient, snapshot: any) {
  const totals = validateEmptyBoxSnapshot(snapshot);
  const movementIds: string[] = [];
  for (const approved of approvedEmptyBox.balances) {
    const before = snapshot.balances.find((b: any) => b.id === approved.id);
    // FIX: record an explicit inventory correction, NOT another shipment or a return.
    const movement = await tx.stockMovement.create({ data: {
      boxId: approvedEmptyBox.id, warehouseId: approvedEmptyBox.warehouseId, clientId: approvedEmptyBox.clientId,
      skuId: before.skuId, palletId: before.palletId, status: before.status, type: 'INVENTORY_ADJUSTMENT', quantity: -before.quantity,
      idempotencyKey: `${emptyBoxRepairKey}:${before.id}`, sourceDocument: emptyBoxRepairKey,
      comment: before.status === 'PACKING'
        ? 'Константин подтвердил пустой короб. Устранён зависший резерв после закрытия заявок 334/303 без короба и последующего списания заявки 523. Повторная отгрузка не выполнялась.'
        : 'Константин подтвердил: последний товар перенесён в FFL_LKBBOX_012, исходный короб пуст. Доступный остаток скорректирован до 0.',
    } });
    movementIds.push(movement.id);
    const removed = await tx.stockBalance.deleteMany({ where: { id: before.id, boxId: approvedEmptyBox.id,
      warehouseId: approvedEmptyBox.warehouseId, clientId: approvedEmptyBox.clientId, skuId: before.skuId,
      status: before.status, quantity: before.quantity, updatedAt: before.updatedAt } });
    assert.equal(removed.count, 1, 'Balance changed concurrently');
  }
  const mark = snapshot.marks.find((m: any) => m.id === approvedEmptyBox.availableMarkId);
  // FIX: preserve the missing mark for history/reconciliation; do not claim it was shipped.
  const detached = await tx.productMark.updateMany({ where: { id: mark.id, clientId: approvedEmptyBox.clientId,
    boxId: approvedEmptyBox.id, skuId: approvedEmptyBox.skuId, status: 'AVAILABLE', updatedAt: mark.updatedAt },
    data: { boxId: null, status: 'BLOCKED' } });
  assert.equal(detached.count, 1, 'KIZ changed concurrently');
  await tx.auditLog.create({ data: { userId: null, action: auditAction, entity: 'Box', entityId: approvedEmptyBox.id,
    payload: JSON.parse(JSON.stringify({ idempotencyKey: emptyBoxRepairKey, approvedByName: 'Константин',
      approval: 'да: только FFL_LKNOV1607_039, фактически 0; убрать 2 AVAILABLE и 4 зависших PACKING, без архивирования',
      physicalQuantity: 0, totals, movementIds, detachedMarkId: mark.id, detachedMarkStatus: 'BLOCKED',
      before: snapshot, unchangedTarget: 'FFL_LKBBOX_012', ordersAndHistoryUnchanged: true })) } });
  return { status: 'APPLIED', boxCode: approvedEmptyBox.code, before: totals, after: 0, movementIds, archived: false };
}

async function loadSnapshot(tx: Prisma.TransactionClient) {
  const box = await tx.box.findUniqueOrThrow({ where: { id: approvedEmptyBox.id }, include: { storagePlacement: true } });
  const balances = await tx.stockBalance.findMany({ where: { boxId: box.id }, orderBy: { id: 'asc' } });
  const marks = await tx.productMark.findMany({ where: { boxId: box.id }, orderBy: { id: 'asc' } });
  const requests = await tx.clientRequest.findMany({ where: { number: { in: [303, 334, 523] } },
    select: { id: true, number: true, status: true, clientId: true, updatedAt: true }, orderBy: { number: 'asc' } });
  for (const r of requests) assert.equal(r.clientId, approvedEmptyBox.clientId);
  const activeTasks = await tx.fbsTsdAssembly.findMany({ where: {
    OR: [{ boxId: box.id }, { reservedBoxId: box.id }, { kiz: { in: marks.filter(m => m.status === 'AVAILABLE').map(m => m.value) } }],
    completedAt: null, status: { notIn: ['COMPLETED', 'CANCELLED'] },
  }, select: { id: true } });
  const counting = await tx.inventoryAuditBox.count({ where: { boxId: box.id, status: 'COUNTING' } });
  const target = await tx.box.findUniqueOrThrow({ where: { code: 'FFL_LKBBOX_012' }, include: { storagePlacement: true } });
  assert.equal(target.clientId, approvedEmptyBox.clientId); assert.equal(target.warehouseId, approvedEmptyBox.warehouseId);
  const targetBalances = await tx.stockBalance.findMany({ where: { boxId: target.id }, orderBy: { id: 'asc' } });
  const targetMarks = await tx.productMark.findMany({ where: { boxId: target.id }, orderBy: { id: 'asc' } });
  const tasks = await tx.fbsTsdAssembly.findMany({ where: { OR: [{ boxId: box.id }, { requestId: { in: requests.map(r => r.id) } }] },
    select: { id: true, requestId: true, orderId: true, status: true, boxId: true, completedAt: true, updatedAt: true }, orderBy: { id: 'asc' } });
  const sourceMoves = await tx.stockMovement.findMany({ where: { boxId: box.id }, orderBy: { id: 'asc' } });
  return { box, balances, marks, requests, activeTasks, counting, sourceMoves,
    protected: { target, targetBalances, targetMarks, tasks } };
}
export const emptyBoxSnapshotDigest = (snapshot: unknown) => createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

export async function repairConfirmedEmptyBox(db: PrismaClient, options: { mode: 'preview' | 'apply' | 'rollback-test'; digest?: string; backup?: string }) {
  let rollbackResult: unknown;
  const rollbackSentinel = new Error('EXPECTED_VERIFICATION_ROLLBACK');
  try {
    return await db.$transaction(async tx => {
      if (options.mode === 'preview') await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      else {
        // FIX: parent/row locks also prevent concurrent inserts into this source through its FK.
        await tx.$queryRaw`SELECT "id" FROM "Box" WHERE "id"=${approvedEmptyBox.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "StockBalance" WHERE "boxId"=${approvedEmptyBox.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "ProductMark" WHERE "boxId"=${approvedEmptyBox.id} FOR UPDATE`;
      }
      const existing = await tx.stockMovement.findMany({ where: { idempotencyKey: { in: approvedEmptyBox.balances.map(b => `${emptyBoxRepairKey}:${b.id}`) } } });
      const audit = await tx.auditLog.findFirst({ where: { action: auditAction, entityId: approvedEmptyBox.id,
        payload: { path: ['idempotencyKey'], equals: emptyBoxRepairKey } } });
      if (classifyEmptyBoxRepair(existing, audit)) return { status: 'ALREADY_APPLIED', boxCode: approvedEmptyBox.code };
      const snapshot = await loadSnapshot(tx); const totals = validateEmptyBoxSnapshot(snapshot);
      const digest = emptyBoxSnapshotDigest(snapshot);
      if (options.mode === 'preview') {
        // FIX: save/export the read-only snapshot before any production correction is attempted.
        if (options.backup) {
          assert.ok(/^\/opt\/logoff-wms-backups\/lknov039-empty-20260906\/[a-z0-9-]+\.json$/.test(options.backup));
          writeFileSync(options.backup, JSON.stringify({ digest, snapshot }, null, 2), { mode: 0o600, flag: 'wx' });
        }
        return { status: 'PREFLIGHT_OK', boxCode: approvedEmptyBox.code, totals, physical: 0, digest };
      }
      assert.equal(options.digest, digest, 'Snapshot changed after preflight');
      assert.ok(options.backup && /^\/opt\/logoff-wms-backups\/lknov039-empty-20260906\/[a-z0-9-]+\.json$/.test(options.backup), 'Protected backup path required');
      writeFileSync(options.backup, JSON.stringify({ digest, snapshot }, null, 2), { mode: 0o600, flag: 'wx' });
      const result = await applyEmptyBoxSnapshot(tx, snapshot);
      const after = await loadSnapshot(tx);
      // TEST: fail before commit if a target, task, historical mark or location changed.
      assert.deepEqual(after.box, snapshot.box, 'Box or placement changed');
      assert.equal(after.balances.length, 0, 'Source not empty');
      assert.deepEqual(after.marks, snapshot.marks.filter(m => m.id !== approvedEmptyBox.availableMarkId), 'Historical marks changed');
      assert.deepEqual(after.protected, snapshot.protected, 'Destination or tasks changed');
      assert.deepEqual(after.requests, snapshot.requests, 'Request changed');
      const previousIds = new Set(snapshot.sourceMoves.map(m => m.id));
      assert.deepEqual(after.sourceMoves.filter(m => previousIds.has(m.id)), snapshot.sourceMoves, 'Movement history changed');
      assert.equal(after.sourceMoves.length, snapshot.sourceMoves.length + 3);
      if (options.mode === 'rollback-test') { rollbackResult = { ...result, status: 'ROLLBACK_TEST_PASSED', digest }; throw rollbackSentinel; }
      return { ...result, digest, protectedStateUnchanged: true };
    }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 });
  } catch (e) { if (e === rollbackSentinel) return rollbackResult; throw e; }
}
if (require.main === module) {
  const args = process.argv.slice(2); const value = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const mode = value('mode') ?? 'preview'; assert.ok(['preview', 'apply', 'rollback-test'].includes(mode));
  const db = new PrismaClient();
  repairConfirmedEmptyBox(db, { mode: mode as 'preview' | 'apply' | 'rollback-test', digest: value('digest'), backup: value('backup') })
    .then(result => console.log(JSON.stringify(result))).catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
}
