const {test}=require('node:test'), assert=require('node:assert/strict');
const {planAdminOldBoxes}=require('../dist/modules/stock/tsd-admin-box-recount');
const source={id:'current',code:'CURRENT',clientId:'c',warehouseId:'w'};
const scans=[{key:'0104640569959669215abcdefghijkl',raw:'0104640569959669215abcdefghijkl',gtin:'04640569959669',serial:'5abcdefghijkl'}];
function setup(){
 const mark={id:'m',boxId:'old',skuId:'sku',clientId:'c',status:'AVAILABLE',value:scans[0].key};
 const box={id:'old',code:'OLD',clientId:'c',warehouseId:'w',palletId:null,status:'active'};
 const balance={id:'b',boxId:'old',clientId:'c',warehouseId:'w',status:'AVAILABLE',quantity:5};
 const data={foreign:[mark],box,balance,oldMarks:[mark,{...mark,id:'remaining'}],active:null};
 const db={productMark:{findMany:async a=>a.where.boxId?data.oldMarks:data.foreign},box:{findUnique:async()=>data.box},stockBalance:{findMany:async()=>[data.balance]},fbsTsdAssembly:{findFirst:async()=>data.active}};
 return {data,run:counts=>planAdminOldBoxes(db,source,'sku',scans,counts)};
}
// TEST: full numeric/count branch coverage without database writes or external calls.
test('snapshot does not depend on database mark ordering',async()=>{
 const f=setup(); f.data.foreign.push({...f.data.foreign[0],id:'second',value:scans[0].key+'2'});
 const first=await f.run([{boxCode:'OLD',quantity:0}]); f.data.foreign.reverse();
 assert.equal((await f.run([{boxCode:'OLD',quantity:0}])).snapshot,first.snapshot);
});
test('preview, explicit zero, positive count, no old box and scanner variants',async()=>{
 const f=setup();assert.equal((await f.run()).needsCounts,true);
 const p=await f.run([{boxCode:'OLD',quantity:0}]);assert.equal(p.boxes[0].retired.length,1);assert.equal(p.boxes[0].previousQuantity,5);
 assert.equal((await f.run([{boxCode:'OLD',quantity:4}])).boxes[0].retired.length,0);
 f.data.foreign=[];assert.equal(await f.run(),null);assert.equal(await f.run([]),null);
 await assert.rejects(()=>f.run({}));await assert.rejects(()=>f.run([{boxCode:'OLD',quantity:0}]));
});
test('invalid count payloads',async()=>{
 for(const value of [null,{},[],[{boxCode:'OLD',quantity:-1}],[{boxCode:'OLD',quantity:1.5}],[{boxCode:'OLD',quantity:10001}],[{boxCode:'OLD',quantity:'0'}],[{quantity:0}],[null],[{boxCode:'OTHER',quantity:0}]])await assert.rejects(()=>setup().run(value));
 const f=setup();f.data.foreign.push({...f.data.foreign[0],id:'second',boxId:'second'});
 await assert.rejects(()=>f.run([{boxCode:'OLD',quantity:0},{boxCode:'OLD',quantity:0}]));
});
test('ownership, status and size guards',async()=>{
 for(const change of [{clientId:'other'},{skuId:'other'},{status:'SHIPPING'}]){const f=setup();Object.assign(f.data.foreign[0],change);await assert.rejects(()=>f.run());}
 for(const change of [null,{clientId:'other'},{warehouseId:'other'},{status:'deleted'}]){const f=setup();f.data.box=change===null?null:{...f.data.box,...change};await assert.rejects(()=>f.run());}
 const f=setup();f.data.foreign=Array.from({length:11},(_,i)=>({...f.data.foreign[0],id:'m'+i,boxId:'b'+i}));await assert.rejects(()=>f.run());
});
test('balance, active-task and remaining-mark guards',async()=>{
 for(const change of [{clientId:'other'},{warehouseId:'other'},{quantity:-1},{status:'RESERVED'}]){const f=setup();Object.assign(f.data.balance,change);await assert.rejects(()=>f.run());}
 let f=setup();f.data.active={id:'active'};await assert.rejects(()=>f.run());
 f=setup();f.data.oldMarks=Array.from({length:201},()=>f.data.foreign[0]);await assert.rejects(()=>f.run());
 f=setup();f.data.oldMarks=[{...f.data.foreign[0],clientId:'other'}];await assert.rejects(()=>f.run());
 f=setup();f.data.oldMarks.push({...f.data.oldMarks[1],id:'third'});await assert.rejects(()=>f.run([{boxCode:'OLD',quantity:1}]));
 f=setup();f.data.balance.status='SHIPPING';f.data.balance.quantity=0;assert.equal((await f.run([{boxCode:'OLD',quantity:0}])).boxes[0].previousQuantity,0);
});
