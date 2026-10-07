// TEST: reject stale/unreviewed production input before building any replacement.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {patch}=require('../billing-invoice-status-release.cjs');
test('runtime patch rejects an unrelated billing graph',()=>assert.throws(()=>patch('unreviewed'),/graph drift/));
