// TEST: exercise the production transaction boundary, not a replacement implementation.
const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.join(process.env.INVENTORY_RUNTIME,'modules/inventory/inventory.service.js'));
const {InventoryService}=req('./inventory.service');
const {Prisma}=req('@prisma/client');
const flag='WMS_INVENTORY_DECISION_TIMEOUT_ENABLED';const previous=process.env[flag];
afterEach(()=>{if(previous===undefined)delete process.env[flag];else process.env[flag]=previous});
const error=(code,message)=>new Prisma.PrismaClientKnownRequestError(message,{code,clientVersion:'6.19.3'});
function fixture(elapsed=6000){
 const state={committed:0,calls:0,options:null};const tx={staged:0};
 const svc=Object.create(InventoryService.prototype);
 svc.prisma={$transaction:async(fn,options)=>{state.calls++;state.options=options;const result=await fn(tx);
  if(elapsed>(options.timeout??5000))throw error('P2028','Transaction already closed: expired transaction');
  state.committed=tx.staged;return result;}};
 return {svc,state,tx};
}
test('box confirmation exceeding five seconds commits once with bounded 30s budget',async()=>{
 process.env[flag]='true';const f=fixture();assert.equal(await f.svc.runSerializableInventoryDecision(async tx=>{tx.staged=2;return 'resolved'}),'resolved');
 assert.equal(f.state.committed,2);assert.equal(f.state.options.timeout,30000);assert.equal(f.state.options.maxWait,5000);assert.equal(f.state.options.isolationLevel,'Serializable');assert.equal(f.state.calls,1);
});
test('expired transaction is a clear retryable response, with no partial commit',async()=>{
 process.env[flag]='true';const f=fixture(31000);await assert.rejects(()=>f.svc.runSerializableInventoryDecision(async tx=>{tx.staged=2}),e=>e.getStatus?.()===503&&/сканы/i.test(e.message));assert.equal(f.state.committed,0);assert.equal(f.state.calls,1);
});
test('sold VM defaults unchanged',async()=>{
 delete process.env[flag];const f=fixture();await assert.rejects(()=>f.svc.runSerializableInventoryDecision(async()=>{}),e=>e.code==='P2028');assert.equal(f.state.options.timeout,undefined);assert.equal(f.state.options.maxWait,undefined);
});
test('nested line and KIZ resolution reuse the same outer transaction',async()=>{
 process.env[flag]='true';const f=fixture();const result=await f.svc.atomicKizDecision(async scoped=>{assert.equal(scoped.prisma,f.tx);return scoped.runSerializableInventoryDecision(async tx=>{assert.equal(tx,f.tx);tx.staged=2;return 7})});assert.equal(result,7);assert.equal(f.state.calls,1);assert.equal(f.svc.inventoryDecisionTx,undefined);
});
test('line failure rolls back complete decision',async()=>{
 process.env[flag]='true';const f=fixture(0);const original=Error('KIZ unavailable');await assert.rejects(()=>f.svc.runSerializableInventoryDecision(async tx=>{tx.staged=1;throw original}),e=>e===original);assert.equal(f.state.committed,0);
});
test('write conflict keeps existing 409 response and does not retry side effects',async()=>{
 process.env[flag]='true';const f=fixture(0);await assert.rejects(()=>f.svc.runSerializableInventoryDecision(async()=>{throw error('P2034','write conflict')}),e=>e.getStatus?.()===409);assert.equal(f.state.calls,1);
});
