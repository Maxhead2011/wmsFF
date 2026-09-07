const {test}=require('node:test'); const assert=require('node:assert/strict');
const {validate,applyData,IDS}=require('./repair-confirmed-empty-1807.cjs');
function fixture(){return {states:IDS.boxes.map((b,i)=>({code:b.code,expectedPallet:b.pallet,permanent:false,references:[],box:{id:b.id,code:b.code,clientId:IDS.client,warehouseId:IDS.warehouse,status:'active',storagePlacement:{id:'place'+i,pallet:{code:b.pallet,warehouseId:IDS.warehouse}},balances:b.lines.map((l,j)=>({id:'bal'+i+j,boxId:b.id,skuId:l.sku,quantity:l.quantity,status:'AVAILABLE',clientId:IDS.client,warehouseId:IDS.warehouse})),productMarks:Array.from({length:b.total},(_,j)=>({id:'mark'+i+j,boxId:b.id,clientId:IDS.client,status:'AVAILABLE',skuId:b.lines[j<b.lines[0].quantity?0:1].sku}))}})),conflicts:[],task:{id:IDS.task,orderId:IDS.order,requestId:IDS.request,clientId:IDS.client,skuId:IDS.skuS,status:'IN_PROGRESS',reservedBoxId:IDS.boxes[1].id,boxId:null,barcode:null,kiz:null},request:{number:725,status:'SUBMITTED',warehouseId:IDS.warehouse,clientId:IDS.client}};}
// TEST: only the exact user-confirmed 14+5 counts are authorized.
test('accepts exact 19 units and untouched reservation',()=>assert.doesNotThrow(()=>validate(fixture())));
for(const [name,change] of Object.entries({quantity:s=>s.states[0].box.balances[0].quantity--,
  scanned:s=>s.task.barcode='scan',kiz:s=>s.task.kiz='scan',completed:s=>s.task.completedAt='now',
  moved:s=>s.states[0].box.warehouseId='other',marks:s=>s.states[0].box.productMarks.pop(),
  shipped:s=>s.states[0].box.productMarks[0].status='SHIPPING',history:s=>s.conflicts.push('shipment'),
  dependency:s=>s.states[0].references.push('INVENTORY:pending'),permanent:s=>s.states[0].permanent=true,
  closed:s=>s.request.status='DONE'})) test('blocks '+name,()=>assert.throws(()=>{const s=fixture();change(s);validate(s);}));
// TEST: an existing audit makes retry read-only.
test('retry never subtracts twice',async()=>{const r=await applyData({auditLog:{findUnique:async()=>({id:'done'})}},fixture(),()=>{throw Error('must not read');},null);assert.equal(r,'ALREADY_APPLIED');});
// TEST: movement ledger records exactly -19; marks retire, boxes archive, task ownership stays.
test('exact scope and ledger with no order deletion',async()=>{
 const calls=[];const s=fixture();const db={auditLog:{findUnique:async()=>null,create:async()=>calls.push(['audit'])},
 stockBalance:{updateMany:async x=>(calls.push(['balance',x]),{count:1})},stockMovement:{create:async x=>calls.push(['movement',x])},
 productMark:{updateMany:async x=>(calls.push(['mark',x]),{count:1})},box:{updateMany:async x=>(calls.push(['box',x]),{count:1})},
 fbsTsdAssembly:{updateMany:async x=>(calls.push(['task',x]),{count:1})}};
 const result=await applyData(db,s,async()=>s,{detachIfArchivedAndEmpty:async()=>({detached:true})});
 assert.equal(result,'APPLIED');assert.equal(calls.filter(c=>c[0]==='movement').reduce((n,c)=>n+c[1].data.quantity,0),-19);
 assert.equal(calls.filter(c=>c[0]==='mark').length,19);assert.equal(calls.filter(c=>c[0]==='box').length,2);
 const task=calls.find(c=>c[0]==='task')[1];assert.equal(task.data.reservedBoxId,null);assert.equal(task.data.workerUserId,undefined);assert.equal(task.data.kiz,undefined);
});
