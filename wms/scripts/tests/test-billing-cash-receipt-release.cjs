// TEST: the receipt overlay must reject a billing graph from another release.
const {test}=require('node:test'),assert=require('node:assert/strict'),{patch}=require('../billing-cash-receipt-release.cjs');
test('rejects live graph drift',()=>assert.throws(()=>patch('unreviewed','candidate'),/graph drift/));
