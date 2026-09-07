const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reasons, applyOne, validateManifest } = require('./archive-reviewed-empty-boxes.cjs');
const base = () => ({ code: 'FFL_LKB_1', expectedPallet: 'PALET_SORT_01', warehouseId: 'msk',
  permanent: false, references: [], box: { id: 'box', code: 'FFL_LKB_1', warehouseId: 'msk', status: 'active',
    balances: [], productMarks: [], storagePlacement: { id: 'place', boxId: 'box', palletId: 'pallet',
      pallet: { code: 'PALET_SORT_01', warehouseId: 'msk', status: 'CLOSED' } } } });
// TEST: shipment history is retained, but is not active content.
test('allows an empty ordinary box with SHIPPING history', () => {
  const s = base(); s.box.productMarks = [{ status: 'SHIPPING' }]; assert.deepEqual(reasons(s), []);
});
// TEST: every safety condition independently blocks archival.
for (const [name, mutate] of Object.entries({
  permanent: s => s.permanent = true,
  positive: s => s.box.balances = [{ quantity: 1 }],
  negative: s => s.box.balances = [{ quantity: -1 }],
  mark: s => s.box.productMarks = [{ status: 'AVAILABLE' }],
  packingMark: s => s.box.productMarks = [{ status: 'PACKING' }],
  receiving: s => s.box.status = 'receiving',
  warehouse: s => s.box.warehouseId = 'ng',
  palletChanged: s => s.box.storagePlacement.pallet.code = 'OTHER',
  missing: s => s.box = null,
  detached: s => s.box.storagePlacement = null,
  assembly: s => s.references = ['FBS:active'],
  inventory: s => s.references = ['INVENTORY:active'],
  receipt: s => s.references = ['TSD_REVIEW:pending'],
})) test('blocks ' + name, () => { const s = base(); mutate(s); assert.ok(reasons(s).length); });
// TEST: the reported scope cannot silently widen or contain duplicate boxes.
test('validates the frozen 272-box scope', () => {
  assert.throws(() => validateManifest({ rows: [] }));
  const m = { runId: 'empty-pallet-boxes-20260907-1744', warehouseId: 'afb244a1-50ae-4ae6-9111-afe85949fa58',
    rows: Array.from({ length: 272 }, (_, i) => ({ code: 'FFL_TEST_' + i, pallet: 'PALET_SORT_01' })) };
  assert.doesNotThrow(() => validateManifest(m)); m.rows[1] = m.rows[0]; assert.throws(() => validateManifest(m));
});
// TEST: recheck precedes every write; an intervening receipt prevents mutation.
test('recheck skips stock added after preview', async () => {
  const s = base(); s.box.balances = [{ quantity: 1 }];
  const db = { auditLog: { findUnique: async () => null } };
  const result = await applyOne(db, base(), 'run', 'admin', async () => s, null);
  assert.equal(result.status, 'SKIPPED');
});
// TEST: archival writes only Box and audit; canonical detach handles placement.
test('archives and detaches without changing stock or marks', async () => {
  const calls = []; const s = base();
  const db = { box: { updateMany: async args => { calls.push(['box', args]); return { count: 1 }; } },
    auditLog: { findUnique: async () => null, create: async args => calls.push(['audit', args]) } };
  const detach = { detachIfArchivedAndEmpty: async (_, tx) => { assert.equal(tx, db); calls.push(['detach']); return { detached: true }; } };
  const result = await applyOne(db, s, 'run', 'admin', async () => s, detach);
  assert.equal(result.status, 'ARCHIVED'); assert.deepEqual(calls.map(x => x[0]), ['box', 'detach', 'audit']);
  assert.equal(calls[0][1].data.status, 'archived'); assert.ok(calls[2][1].data.payload.before);
});
// TEST: audit id makes a retry harmless after an uncertain connection result.
test('idempotent retry performs no second mutation', async () => {
  const r = await applyOne({ auditLog: { findUnique: async () => ({ id: 'done' }) } }, base(), 'run', 'admin',
    () => { throw Error('unexpected reread'); }, null); assert.equal(r.status, 'ALREADY_APPLIED');
});
// TEST: failure to detach must throw and roll back the caller transaction.
test('detach failure aborts the transaction', async () => {
  const db = { box: { updateMany: async () => ({ count: 1 }) }, auditLog: { findUnique: async () => null } };
  await assert.rejects(applyOne(db, base(), 'run', 'admin', async () => base(),
    { detachIfArchivedAndEmpty: async () => ({ detached: false }) }), /detach/i);
});
