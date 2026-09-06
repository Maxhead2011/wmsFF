// TEST: native coverage of the compiled administrative guard and durable retry coordinator.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requireAdminRecount, validateRecountTask, loadAdminRecountContext, runAdminRecount } = require('../dist/modules/marketplace-connections/tsd-admin-recount-release');
const raw = '0104640569959669215abcdefghijkl\x1d91EE12\x1d92test';
const admin = { id:'admin',roleCodes:['ADMIN'],permissionCodes:[] };
function fixture() {
  const source={id:'box',code:'BOX',clientId:'c',warehouseId:'w',palletId:null,status:'active'};
  const task={id:'task',requestId:'r',clientId:'c',skuId:'sku',marketplace:'WILDBERRIES',itemCount:1,status:'IN_PROGRESS',boxId:'box',kiz:raw};
  const request={clientId:'c',warehouseId:'w',status:'IN_PROGRESS'};
  const link={requestId:'r',syncStatus:'ACTIVE',lastCategory:'active',lastSupplierStatus:'confirm'};
  const mark={id:'mark',clientId:'c',skuId:'sku',boxId:'box',status:'AVAILABLE',value:raw};
  const state={previous:[mark],marks:[mark],tasks:[task],audit:null,applied:0,repaired:0,holds:[],failWb:false,failApply:false,failRepair:false,claim:1};
  const db={productMark:{findMany:async({where})=>where.OR?state.marks:state.previous},fbsTsdAssembly:{findMany:async()=>state.tasks,
    updateMany:async({data})=>{state.holds.push(data);return{count:state.claim};}},
    clientRequest:{findUnique:async()=>request},fbsOrderRequestLink:{findUnique:async()=>link},stockBalance:{findMany:async()=>[]},
    auditLog:{findUnique:async()=>state.audit,create:async({data})=>(state.audit=structuredClone(data)),update:async({data})=>Object.assign(state.audit,structuredClone(data))}};
  for(const key of ['shippedKizHistory','fbsAssemblyAttemptHistory','kizCirculationItem','fbsWebKizStickerPrint','fbsPrintJob'])db[key]={findFirst:async()=>null};
  db.$transaction=async fn=>{const before=structuredClone(state.audit);try{return await fn(db);}catch(e){state.audit=before;throw e;}};
  const input={source,skuId:'sku',scans:[{raw,gtin:'04640569959669',serial:'5abcdefghijkl',key:'0104640569959669215abcdefghijkl'}]};
  const load=()=>loadAdminRecountContext(db,input);
  const opts={db,user:admin,id:'audit',fingerprint:'fp',snapshot:'snap',load:async()=>({tasks:[task],requestIds:['r','r'],snapshot:'snap'}),
    releaseWb:async()=>{if(state.failWb)throw Error('WB');},apply:async()=>{if(state.failApply)throw Error('apply');state.applied++;},
    repair:async()=>{if(state.failRepair)throw Error('repair');state.repaired++;}};
  return {source,task,request,link,mark,state,db,input,load,opts};
}
test('administrator and task boundaries',()=>{
  requireAdminRecount(admin,true);requireAdminRecount({...admin,roleCodes:['OWNER']},true);requireAdminRecount({...admin,roleCodes:[],permissionCodes:['system:admin']},true);
  for(const [who,enabled] of [[admin,false],[{...admin,isDemo:true},true],[{...admin,roleCodes:['CLIENT']},true],[{...admin,roleCodes:[]},true]])assert.throws(()=>requireAdminRecount(who,enabled));
  const f=fixture();validateRecountTask(f.task,f.source,'sku',[raw],f.request,f.link);
  for(const change of [{clientId:'other'},{skuId:'other'},{sourceSkuId:'other'},{marketplace:'OZON'},{itemCount:2},{completedAt:1},{cargoPackingId:'p'},{cargoPackedAt:1},{status:'COMPLETED'},{boxId:'other'},{kiz:'other'}])assert.throws(()=>validateRecountTask({...f.task,...change},f.source,'sku',[raw],f.request,f.link));
  for(const req of [null,{...f.request,clientId:'other'},{...f.request,warehouseId:'other'},{...f.request,status:'DONE'}])assert.throws(()=>validateRecountTask(f.task,f.source,'sku',[raw],req,f.link));
  for(const link of [null,...['requestId','syncStatus','lastCategory','lastSupplierStatus'].map(key=>({...f.link,[key]:'other'}))])assert.throws(()=>validateRecountTask(f.task,f.source,'sku',[raw],f.request,link));
  validateRecountTask({...f.task,kiz:null,boxId:null},f.source,'sku',[],f.request,f.link);
});
test('preflight validates all old/new marks and histories',async()=>{
  const ok=fixture();assert.equal((await ok.load()).tasks.length,1);ok.mark.status='PACKING';ok.mark.boxId=null;await ok.load();
  for(const mutate of [f=>f.source.warehouseId=null,f=>f.source.status='deleted',f=>f.state.previous=Array(201).fill(f.mark),
    f=>f.mark.value='bad',f=>f.state.marks=Array(401).fill(f.mark),f=>f.state.tasks=[],f=>f.state.tasks=Array(21).fill(f.task),
    f=>f.state.marks.push({...f.mark,id:'duplicate'}),f=>f.state.previous=[],
    ...['clientId','skuId','boxId','status'].map(key=>f=>f.state.marks=[{...f.mark,[key]:'other'}])]) {
    const f=fixture();mutate(f);if(f.state.previous.length===0){await f.load();continue;}await assert.rejects(f.load);
  }
  for(const key of ['shippedKizHistory','fbsAssemblyAttemptHistory','kizCirculationItem','fbsWebKizStickerPrint','fbsPrintJob']){
    const f=fixture();f.db[key].findFirst=async()=>({id:'history'});await assert.rejects(f.load);
  }
  const malformed=fixture();malformed.state.marks=[{...malformed.mark,value:'bad'}];await assert.rejects(malformed.load);
  const unmatched=fixture();unmatched.state.marks=[{...unmatched.mark,value:raw.replace('5abcdefghijkl','5bcdefghijklm')}];await assert.rejects(unmatched.load);
});
test('coordinator retries, cancels and protects applied data',async()=>{
  const f=fixture();await runAdminRecount(f.opts);await runAdminRecount(f.opts);assert.equal(f.state.applied,1);assert.equal(f.state.repaired,1);
  await assert.rejects(()=>runAdminRecount({...f.opts,fingerprint:'other'}));
  const stale=fixture();await assert.rejects(()=>runAdminRecount({...stale.opts,snapshot:'old'}));
  const claim=fixture();claim.state.claim=0;await assert.rejects(()=>runAdminRecount(claim.opts));
  for(const key of ['failWb','failApply','failRepair']){
    const item=fixture();item.state[key]=true;await assert.rejects(()=>runAdminRecount(item.opts));item.state[key]=false;
    await runAdminRecount(item.opts);assert.equal(item.state.applied,1);assert.equal(item.state.audit.payload.phase,'DONE');
  }
  const cancel=fixture();cancel.state.failWb=true;await assert.rejects(()=>runAdminRecount(cancel.opts));
  assert.equal((await runAdminRecount({...cancel.opts,abort:true})).state,'RECOUNT_CANCELLED');assert.equal(cancel.state.applied,0);
  assert.equal((await runAdminRecount(cancel.opts)).state,'RECOUNT_CANCELLED');
  const first=fixture();await runAdminRecount({...first.opts,abort:true});assert.equal(first.state.audit.payload.phase,'ABORTED');
  const late=fixture();late.state.failRepair=true;await assert.rejects(()=>runAdminRecount(late.opts));late.state.failRepair=false;
  await runAdminRecount({...late.opts,abort:true});assert.equal(late.state.applied,1);
});
