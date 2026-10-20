const assert=require('assert/strict');
const {WarehouseService}=require('/app/apps/api/dist/modules/warehouse/warehouse.service');
// TEST: exercise the actual image method; count formatter constructions and preserve boundary quantities.
(async()=>{
const rows=Array.from({length:1000},(_,i)=>({quantity:1,createdAt:new Date(i%2?'2025-12-31T21:01:00Z':'2025-12-31T20:59:00Z'),box:{code:i%2?'FFL_LKB0101_1':'FFL_LKB_invalid'},_count:{productMarks:1}}));
const original=Intl.DateTimeFormat;let count=0;Intl.DateTimeFormat=function(...args){count++;return new original(...args)};
try{
 const result=await WarehouseService.prototype.listReceiptBatches.call({prisma:{stockMovement:{findMany:async()=>rows}},clientScopes:{requireClientAccess(){}},resolveReadWarehouseId:()=> 'warehouse',boxCodes:{getPolicy:async()=>({receiptPrefix:'FFL_LKB'})}},{clientId:'client'},{});
 assert.deepEqual(result.map(r=>[r.date,r.quantity,r.kizCount]),[['2026-01-01',500,500],['2025-12-31',500,500]]);
 assert(count<=3);console.log(JSON.stringify({passed:true,formatterConstructions:count,rows:1000}));
}finally{Intl.DateTimeFormat=original}
})().catch(e=>{console.error(e);process.exitCode=1});
