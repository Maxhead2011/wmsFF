// TEST: run against the actual candidate runtime, including admin approval and the next picker scan.
const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const root=process.env.KIZ_CANDIDATE;
const req=createRequire(path.join(root,'common/kiz-wb-reuse.js'));
const policy=req('./kiz-wb-reuse');
const oldEnv={...process.env};
afterEach(()=>{for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];Object.assign(process.env,oldEnv)});
function enable(){process.env.WMS_KIZ_CANCELLED_ADMIN_REUSE_ENABLED='true';process.env.WMS_KIZ_REUSE_EVIDENCE_ENABLED='true';process.env.WMS_KIZ_REVIEW_QUEUE_ENABLED='true'}
const order={orderId:'old-order',verified:true,supplierStatus:'cancel',wbStatus:'canceled',containsKiz:true,supplyAccepted:true};
test('cancelled accepted supply with unknown circulation requires admin, not relabel',()=>{enable();assert.equal(policy.decideKizReuse([order],null),'REVIEW')});
test('sold VM keeps legacy rule when flag off',()=>{delete process.env.WMS_KIZ_CANCELLED_ADMIN_REUSE_ENABLED;assert.equal(policy.decideKizReuse([order],null),'RELABEL')});
for(const status of ['RETIRED','WRITTEN_OFF'])test('circulation '+status+' still requires relabel',()=>{enable();assert.equal(policy.decideKizReuse([order],status),'RELABEL')});
test('confirmed sale still requires relabel',()=>{enable();assert.equal(policy.decideKizReuse([{...order,wbStatus:'sold'}],null),'RELABEL')});
test('defect is not covered by cancellation exception',()=>{enable();assert.equal(policy.decideKizReuse([{...order,wbStatus:'defect'}],null),'RELABEL')});

function fixture(change={}) {
 enable();process.env.WMS_KIZ_SOLD_PHYSICAL_REUSE_ENABLED='true';
 const identity='0104680992598899215IPHp;tXgzZMN', kiz=identity+'\x1d91EE12';
 const task={id:'current',clientId:'client',requestId:'request',status:'IN_PROGRESS',skuId:'sku',boxId:'box',kiz:null,marketplace:'WILDBERRIES'};
 const previous={id:'old',clientId:'client',requestId:'closed',orderId:'old-order',status:'COMPLETED',completedAt:new Date(1),updatedAt:new Date(2),kiz};
 const evidence={decision:'RELABEL',checkedAt:new Date().toISOString(),orders:[{...order,supplierStatus:'complete',wbStatus:'sold'}],history:[],circulation:null,...change.evidence};
 const calls=[];const mark={id:'mark',value:kiz,clientId:'client',skuId:'sku',boxId:change.wrongBox?'other':'box',status:'AVAILABLE',updatedAt:new Date(1),box:{clientId:'client',warehouseId:'warehouse',status:'active',code:'box'},sku:{name:'product'}};
 const row={id:'review',clientId:'client',warehouseId:'warehouse',taskId:task.id,kizIdentity:identity,kiz,status:'OPEN',context:''};
 const db={
  $queryRaw:async()=>[], $transaction:async fn=>fn(db),
  fbsTsdAssembly:{findUnique:async()=>task,findMany:async()=>[{...previous,...change.previous}],updateMany:async args=>{calls.push(['release',args]);return {count:change.race?0:1}}},
  clientRequest:{findUnique:async()=>({clientId:'client',warehouseId:'warehouse',status:'IN_PROGRESS'}),findMany:async()=>change.openRequest?[]:[{id:'closed',warehouseId:'warehouse'}]},
  box:{findUnique:async()=>({clientId:'client',warehouseId:'warehouse',status:'active'})},
  productMark:{findFirst:async()=>mark,findMany:async()=>[mark]},
  stockBalance:{aggregate:async()=>({_sum:{quantity:1}})},
  fboAssemblyUnit:{findMany:async()=>change.fbo?[{activeMarkId:'mark'}]:[]},
  shippedKizHistory:{findMany:async()=>change.noHistory?[]:[{kiz}]},
  kizReviewCase:{findMany:async()=>change.otherApproval?[{id:"other"}]:[],findFirst:async()=>row,findUnique:async()=>row,upsert:async args=>{calls.push(['upsert',args]);Object.assign(row,args.update);return row},update:async args=>{calls.push(['approve',args]);Object.assign(row,args.data);return row}},
  auditLog:{create:async args=>{calls.push(['audit',args]);return {}}},
 };
 const filename=path.join(root,'common/kiz-review-queue.js');
 const local=createRequire(filename),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{exports:module.exports,module,process,Buffer,console,Date,
  require:n=>n==='./kiz-wb-reuse'?{...policy,inspectKizReuse:async()=>evidence}:local(n)},{filename});
 const api=module.exports;row.context=api.reviewContext(task);
 const user={id:'owner',name:'Owner',roleCodes:change.worker?['WORKER']:['OWNER'],permissionCodes:['system:admin'],activeWarehouseId:'warehouse',isDemo:false};
 const service=new api.KizReviewQueue(db,{resolveClientFilter:()=> 'client',requireClientAccess:()=>{}});
 return {service,user,calls,row,api,evidence,db,kiz,mark,task};
}

// TEST: regression through the actual published manager handler and subsequent scan.
test('physical sold unit: explicit approval, audit, next scan remains allowed',async()=>{
 const f=fixture();await f.service.decide('review','REUSE','Physically checked, earlier binding disputed',true,f.user);
 assert.equal(f.row.status,'APPROVED');assert.equal(f.row.resolution,'REUSE');
 assert.equal(f.calls.filter(c=>c[0]==='release').length,1);
 assert(f.calls.some(c=>c[0]==='audit'&&c[1].data.action==='KIZ_PHYSICAL_SALE_BINDING_ARCHIVED'));
 assert.equal(await f.api.queueKizReview(f.db,'client',f.kiz,'current',f.evidence),'ALLOW');
 assert.equal(await f.api.queueKizReview(f.db,'client',f.kiz,'current',f.evidence),'ALLOW');
 assert.equal(f.row.resolution,'REUSE');
});
for(const [name,change] of Object.entries({worker:{worker:true},active:{previous:{status:'IN_PROGRESS'}},open:{openRequest:true},fbo:{fbo:true},otherApproval:{otherApproval:true},wrongBox:{wrongBox:true},race:{race:true},stale:{evidence:{checkedAt:new Date(0).toISOString()}},retired:{evidence:{circulation:'RETIRED'}},writtenOff:{evidence:{circulation:'WRITTEN_OFF'}},unknown:{evidence:{orders:[{...order,verified:false}]}},foreign:{previous:{clientId:'foreign'}}}))
 test('physical override rejects '+name,async()=>{const f=fixture(change);await assert.rejects(()=>f.service.decide('review','REUSE','Physically confirmed',true,f.user));assert(!f.calls.some(c=>c[0]==='approve'));});
test('physical override requires explicit confirmation and reason',async()=>{const f=fixture();await assert.rejects(()=>f.service.decide('review','REUSE','Physically confirmed',false,f.user));await assert.rejects(()=>f.service.decide('review','REUSE','',true,f.user));});
test('flag disabled preserves sold VM behavior',async()=>{const f=fixture();delete process.env.WMS_KIZ_SOLD_PHYSICAL_REUSE_ENABLED;await assert.rejects(()=>f.service.decide('review','REUSE','Physically confirmed',true,f.user));});
for(const changed of ['mark','evidence','flag'])test('scan revokes stale physical permission: '+changed,async()=>{const f=fixture();await f.service.decide('review','REUSE','Physically confirmed',true,f.user);if(changed==='mark')f.mark.updatedAt=new Date(99);if(changed==='evidence')f.evidence.circulation='RETIRED';if(changed==='flag')delete process.env.WMS_KIZ_SOLD_PHYSICAL_REUSE_ENABLED;assert.equal(await f.api.queueKizReview(f.db,'client',f.kiz,'current',f.evidence),'REVIEW');});
