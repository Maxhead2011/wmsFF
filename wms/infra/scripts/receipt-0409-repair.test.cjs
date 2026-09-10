const {test}=require('node:test'),assert=require('node:assert/strict');
const {eligible,sql}=require('./receipt-0409-repair.cjs');
const row={id:'0845af3d-c3bd-43bf-8ca2-3784faf5ffe2',code:'FFL_LKB0409_546',clientId:'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',warehouseId:'afb244a1-50ae-4ae6-9111-afe85949fa58',status:'receiving',balance:15,receipts:15,negative_balances:0,unmatched_receipts:0,missing_movements:0,failed_scans:0,last_open:'2026-09-08T13:27:59',last_receipt:'2026-09-08T13:29:51'};
// TEST: fail closed outside the exact user-authorized batch and proven receipt state.
test('allows received 0409 box 546',()=>assert(eligible(row)));
for(const change of [{code:'FFL_LKB0809_1'},{code:'FFL_LKB2107_2'},{status:'archived'},{balance:0},{failed_scans:1},{unmatched_receipts:1},{missing_movements:1},{negative_balances:1},{clientId:'other'},{warehouseId:'other'},{last_open:'2026-09-10T09:00:00'}]){
 test('skips '+JSON.stringify(change),()=>assert(!eligible({...row,...change})));
}
test('refuses an incomplete/stale reviewed set',()=>assert.throws(()=>sql([row])));
