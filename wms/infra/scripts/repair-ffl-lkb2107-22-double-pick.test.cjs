const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEvidence } = require('./repair-ffl-lkb2107-22-double-pick.cjs');
const fixture = () => ({
  box: { id: 'c5d24770-f536-406d-8e8e-9f5d731f4225', code: 'FFL_LKB2107_22', status: 'receiving', clientId: 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9', warehouseId: 'afb244a1-50ae-4ae6-9111-afe85949fa58' },
  balances: [{ id: 'balance', quantity: 6, status: 'AVAILABLE', skuId: '47254ddb-5fff-463a-be8b-83a905d4909e' }],
  ledgerAvailable: 6, markCount: 7, matchedScans: 7, uniqueScans: 7, protectedHistoryCount: 0, batchLedgerRows: 0,
  request: { number: 576, status: 'DONE' },
  tasks: [{ id: '0e7acd50-9c0e-4dac-9640-d3a9ab5b8c63', orderId: '5653603723', itemCount: 1, status: 'COMPLETED' }],
  deductions: [
    { id: '330eb3fc-f0e1-48b9-ae31-96d98aa66d87', type: 'PICK', status: 'AVAILABLE', quantity: -1, sourceDocument: 'c08ee426-a793-4bb8-837e-dd7ca9a82f1a' },
    { id: '31120d9e-df14-4b52-8415-43950f67ad1f', type: 'PICK', status: 'AVAILABLE', quantity: -1, sourceDocument: 'c08ee426-a793-4bb8-837e-dd7ca9a82f1a' },
  ],
});
// TEST: only the independently verified incident can yield a one-unit correction.
test('verified double deduction plans +1, not a new receipt of seven units', () => assert.equal(validateEvidence(fixture()), 1));
for (const [name, mutate] of [
  ['changed quantity', e => e.balances[0].quantity = 5],
  ['already corrected', e => e.balances[0].quantity = 7],
  ['other warehouse', e => e.box.warehouseId = 'other'],
  ['other client', e => e.box.clientId = 'other'],
  ['archived box', e => e.box.status = 'archived'],
  ['ledger mismatch', e => e.ledgerAvailable = 7],
  ['missing mark', e => e.matchedScans = 6],
  ['duplicate scan', e => e.uniqueScans = 6],
  ['KIZ history', e => e.protectedHistoryCount = 1],
  ['already moved', e => e.batchLedgerRows = 2],
  ['another order', e => e.tasks.push({ id: 'other' })],
  ['missing original deduction', e => e.deductions.pop()],
  ['wrong deduction', e => e.deductions[1].quantity = -2],
  ['other status stock', e => e.balances.push({ status: 'PACKING', quantity: 1 })],
]) test('refuses ' + name, () => { const e = fixture(); mutate(e); assert.throws(() => validateEvidence(e)); });
