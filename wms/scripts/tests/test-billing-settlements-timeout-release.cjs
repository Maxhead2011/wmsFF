// TEST: a stale or unrelated service must never be overwritten by this narrow release.
const {test}=require('node:test'),assert=require('node:assert/strict'),{replacement}=require('../billing-settlements-timeout-release.cjs');
test('rejects unreviewed live module drift',()=>assert.throws(()=>replacement('unreviewed','candidate','billing-settlements.service'),/runtime drift/));
