// TEST: native coverage of the compiled recount safety policy; no coverage dependency installation.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRecountScans, planKizRecount, requireRecountSnapshot } = require('../dist/modules/stock/tsd-transfer-kiz-recount');
const parse = raw => { const match = /^01(\d{14})21([^\x1d]+)(?:\x1d|$)/.exec(raw); return match ? { gtin: match[1], serial: match[2] } : null; };
const value = serial => `010464056995966921${serial}\x1d91EE12`;
const payload = values => ({ allUnitsScanned:true,kizCodes:values });
function fixture() {
  const source = { id:'b',code:'BOX',clientId:'c',warehouseId:'w',palletId:null,status:'active' };
  const balance = { id:'bal',clientId:'c',warehouseId:'w',skuId:'s',boxId:'b',status:'AVAILABLE',quantity:1 };
  const old = { id:'old',clientId:'c',warehouseId:'w',skuId:'s',boxId:'b',status:'AVAILABLE',value:value('OLD') };
  const state = { balances:[balance], previous:[old], rows:[old] };
  const db = { stockBalance:{ findMany:async()=>state.balances },productMark:{findMany:async({where})=>where.OR?state.rows:state.previous},
    ...Object.fromEntries(['fbsTsdAssembly','shippedKizHistory','fbsWebKizStickerPrint','fbsPrintJob','fbsAssemblyAttemptHistory','kizCirculationItem'].map(key=>[key,{findFirst:async()=>null}])) };
  const scans = parseRecountScans(payload([value('NEW')]),parse);
  return { source,balance,old,state,db,scans,run:()=>planKizRecount(db,source,'s',scans,parse) };
}
test('complete-count input is bounded and identity-unique',()=>{
  assert.equal(parseRecountScans(payload([value('B'),value('A')]),parse)[0].serial,'A');
  for(const input of [{},payload([]),payload(Array(201).fill(value('A'))),payload(['bad']),payload([7]),payload(['x'.repeat(1025)]),payload([value('A'),value('A')])]) assert.throws(()=>parseRecountScans(input,parse));
});
test('equal total replaces only absent marks and preserves scanned marks',async()=>{
  const f=fixture();const p=await f.run();assert.equal(p.retired.length,1);assert.equal(p.registered.length,1);
  assert.doesNotThrow(()=>requireRecountSnapshot(p.snapshot,p.snapshot));
  assert.throws(()=>requireRecountSnapshot(p.snapshot,null));assert.throws(()=>requireRecountSnapshot(p.snapshot,'stale'));
  f.scans.splice(0,1,...parseRecountScans(payload([f.old.value]),parse));
  const same=await f.run();assert.equal(same.retired.length,0);assert.equal(same.registered.length,0);
  f.state.rows.push({...f.old,id:'other',value:value('B')}); await f.run().then(()=>assert.fail(),()=>{});
});
test('untrusted source, negative/reserved and inconsistent ownership are reviewed',async()=>{
  for(const change of [f=>f.source.warehouseId=null,f=>f.source.status='archived',f=>f.balance.clientId='other',f=>f.balance.warehouseId='other',
    f=>f.balance.quantity=-1,f=>f.balance.status='PACKING',f=>f.balance.quantity=2]) {const f=fixture();change(f);await assert.rejects(f.run);}
  const f=fixture();f.state.balances.push({...f.balance,id:'zero',status:'PACKING',quantity:0});await f.run();
});
test('old identities must be complete, available and bounded',async()=>{
  for(const change of [f=>f.state.previous=Array(201).fill(f.old),f=>f.old.clientId='other',f=>f.old.status='PACKING',f=>f.old.value='malformed']) {const f=fixture();change(f);await assert.rejects(f.run);}
});
test('global marks cannot be duplicated, reassigned or matched by a loose prefix',async()=>{
  for(const change of [f=>f.state.rows=Array(401).fill(f.old),f=>f.state.rows.push({...f.old}),f=>f.state.rows=[{...f.old,value:'bad'}],
    f=>f.state.rows=[{...f.old,value:value('LOOKALIKE')}], ...['clientId','skuId','boxId','status'].map(key=>f=>f.state.rows=[{...f.old,[key]:'other'}])]) {
    const f=fixture();change(f);await assert.rejects(f.run);
  }
  const f=fixture();f.state.previous=[];f.state.rows=[];assert.equal((await f.run()).registered.length,1);
});
test('every history remains blocking',async()=>{
  for(const key of ['fbsTsdAssembly','shippedKizHistory','fbsWebKizStickerPrint','fbsPrintJob','fbsAssemblyAttemptHistory','kizCirculationItem']) {
    const f=fixture();f.db[key].findFirst=async()=>({id:'protected'});await assert.rejects(f.run);
  }
});
test('snapshot order is stable and includes all exact persisted marks',async()=>{
  const f=fixture();const second={...f.old,id:'second',value:value('SECOND')};f.balance.quantity=2;
  f.state.rows.push(second);f.state.previous.push(second);f.scans.push(...parseRecountScans(payload([second.value]),parse));
  const first=await f.run();f.state.rows.reverse();assert.equal((await f.run()).snapshot,first.snapshot);
});

test('admin count may restore archived stock; print exceptions are transaction-scoped only',async()=>{
  const f=fixture();f.source.status='archived';f.balance.quantity=0;
  let where;f.db.fbsWebKizStickerPrint.findFirst=async args=>{where=args.where;return null;};
  const p=await planKizRecount(f.db,f.source,'s',f.scans,parse,true,['released']);
  assert.equal(p.delta,1);assert.deepEqual(where.assemblyId,{notIn:['released']});
  f.db.shippedKizHistory.findFirst=async()=>({id:'shipped'});
  await assert.rejects(()=>planKizRecount(f.db,f.source,'s',f.scans,parse,true,['released']));
});
