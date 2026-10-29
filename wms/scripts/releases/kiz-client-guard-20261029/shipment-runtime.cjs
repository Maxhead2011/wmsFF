// TEST: exercise exact downloaded/patched production JS, including manual close, SOS and replay.
const assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(process.argv[2]);let guards=0,queued=0,finishes=0;
const denied=()=>{guards++;throw Error('KIZ_REVIEW_REQUIRED');};
const hooks={assertClientRequestKizShipment:denied,assertClientKizUse:denied,
 finishClientRequestKizShipment:()=>finishes++,finishClientKizUse:()=>finishes++,
 withClientKizReview:async(_db,_user,action)=>{try{return await action();}catch(e){queued++;throw e;}}};
const original=Module._load;Module._load=function(name,parent,main){if(name.endsWith('/kiz-client-review'))return hooks;return original.call(this,name,parent,main);};
const {StockOperationsService}=require(path.join(root,'modules/stock/stock-operations.service.js'));
const {finalizeWbOrderShipment}=require(path.join(root,'common/stock/wb-order-stock-lifecycle.js'));
process.env.WMS_KIZ_CLIENT_GUARD_ENABLED='true';process.env.WMS_FBO_TWO_STAGE_ENABLED='false';process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED='false';
let passed=0;
function manual(status){
 const writes=[];const tx={stockMovement:{findFirst:async()=>null}};
 const p={$transaction:fn=>fn(tx)};const s=Object.create(StockOperationsService.prototype);
 Object.assign(s,{prisma:p,resolveWritableWarehouseId:()=> 'wh',loadOutboundRequest:async()=>({id:'r',clientId:'c',warehouseId:'wh',status,items:[]}),
  assertRequestWarehouse(){},ensureRequestFulfillmentBillingCharges(){},ensureRequestCanMove(){},
  ensurePackedStockIsInShipping(){writes.push('pack');throw Error('GUARD_BYPASSED');},
  ensureManualDonePackageInput(){writes.push('package');throw Error('GUARD_BYPASSED');},
  ensureRequestLogisticsBilling(){},ensureRequestExpenseConsumption(){}});return{s,writes};
}
function wb(existing=null,legacy=null){
 const writes=[];const task={id:'t',requestId:'r',clientId:'c',marketplace:'WILDBERRIES',stockWarehouseId:'wh',skuId:'s',boxId:'b',kiz:'kiz',itemCount:1};
 const db={$queryRaw:async()=>[],fbsTsdAssembly:{findUniqueOrThrow:async()=>task},
  wbOrderShipment:{findUnique:async()=>existing,findFirst:async()=>null,create:async()=>({id:'new-fact'})},
  clientRequest:{findUnique:async()=>({id:'r',warehouseId:'wh',status:'PACKED',items:[],client:{name:'Client'}})},
  shippedKizHistory:{findFirst:async()=>legacy,createMany:async()=>({count:0})},
  fbsAssemblyAttemptHistory:{findUnique:async()=>null},sku:{findUniqueOrThrow:async()=>({id:'s'})},
  productMark:{updateMany(){writes.push('mark');}},stockMovement:{findMany(){writes.push('allocation');throw Error('GUARD_BYPASSED');}},
  stockBalance:{updateMany(){writes.push('debit');throw Error('GUARD_BYPASSED');}}};return{db,writes};
}
(async()=>{
 for(const method of ['shipClientRequest','shipClientRequestFromCurrentStock']){
  guards=0;queued=0;const f=manual('PACKED');await assert.rejects(f.s[method]({requestId:'r'},{id:'u'}),/KIZ_REVIEW_REQUIRED/);
  assert.equal(guards,1);assert.equal(queued,1);assert.deepEqual(f.writes,[]);passed++;
  guards=0;finishes=0;const done=manual('DONE');assert.equal((await done.s[method]({requestId:'r'},{id:'u'})).status,'ALREADY_APPLIED');
  assert.equal(guards,0);assert.equal(finishes,0);assert.deepEqual(done.writes,[]);passed++;
 }
 guards=0;const fresh=wb();await assert.rejects(finalizeWbOrderShipment(fresh.db,'t','PRINT_CONFIRMED',{}),/KIZ_REVIEW_REQUIRED/);
 assert.equal(guards,1);assert.deepEqual(fresh.writes,[]);passed++;
 guards=0;finishes=0;const retry=wb({id:'existing'});assert.equal((await finalizeWbOrderShipment(retry.db,'t','PRINT_CONFIRMED',{})).id,'existing');
 assert.equal(guards,0);assert.equal(finishes,0);assert.deepEqual(retry.writes,[]);passed++;
 guards=0;finishes=0;const legacy=wb(null,{shippedAt:new Date()});assert.equal((await finalizeWbOrderShipment(legacy.db,'t','PRINT_CONFIRMED',{})).id,'new-fact');
 assert.equal(guards,0);assert.equal(finishes,0);assert.deepEqual(legacy.writes,[]);passed++;
 console.log(JSON.stringify({passed,syntheticOnly:true,runtime:root}));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
