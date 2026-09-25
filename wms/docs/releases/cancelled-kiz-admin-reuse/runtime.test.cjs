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
 enable();
 const identity='0104680992598899215IPHp;tXgzZMN', kiz=identity+'\x1d91EE12';
 const task={id:'current',clientId:'client',requestId:'request',status:'IN_PROGRESS',skuId:'sku',boxId:'box',kiz:null,marketplace:'WILDBERRIES'};
 const previous={id:'old',clientId:'client',requestId:'closed',orderId:'old-order',status:'COMPLETED',completedAt:new Date(1),updatedAt:new Date(2),kiz};
 const evidence={decision:'REVIEW',checkedAt:new Date().toISOString(),orders:[order],history:[],circulation:null,...change.evidence};
 const calls=[];const mark={id:'mark',value:kiz,clientId:'client',skuId:'sku',boxId:change.wrongBox?'other':'box',status:'AVAILABLE',updatedAt:new Date(1),box:{clientId:'client',warehouseId:'warehouse',status:'active',code:'box'},sku:{name:'product'}};
 const row={id:'review',clientId:'client',warehouseId:'warehouse',taskId:task.id,kizIdentity:identity,kiz,status:'OPEN',context:''};
 const db={
  $queryRaw:async()=>[], $transaction:async fn=>fn(db),
  fbsTsdAssembly:{findUnique:async()=>task,findMany:async()=>[{...previous,...change.previous}],updateMany:async args=>{calls.push(['release',args]);return {count:change.race?0:1}}},
  clientRequest:{findUnique:async()=>({clientId:'client',warehouseId:'warehouse',status:'IN_PROGRESS'}),findMany:async()=>change.openRequest?[]:[{id:'closed'}]},
  box:{findUnique:async()=>({clientId:'client',warehouseId:'warehouse',status:'active'})},
  productMark:{findFirst:async()=>mark,findMany:async()=>[mark]},
  stockBalance:{aggregate:async()=>({_sum:{quantity:1}})},
  shippedKizHistory:{findMany:async()=>change.noHistory?[]:[{kiz}]},
  kizReviewCase:{findFirst:async()=>row,findUnique:async()=>row,upsert:async args=>{calls.push(['upsert',args]);Object.assign(row,args.update);return row},update:async args=>{calls.push(['approve',args]);Object.assign(row,args.data);return row}},
  auditLog:{create:async args=>{calls.push(['audit',args]);return {}}},
 };
 const filename=path.join(root,'common/kiz-review-queue.js');
 const local=createRequire(filename),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{exports:module.exports,module,process,Buffer,console,Date,
  require:n=>n==='./kiz-wb-reuse'?{...policy,inspectKizReuse:async()=>evidence}:local(n)},{filename});
 const api=module.exports;row.context=api.reviewContext(task);
 const user={id:'owner',name:'Owner',roleCodes:change.worker?['WORKER']:['OWNER'],permissionCodes:['system:admin'],activeWarehouseId:'warehouse',isDemo:false};
 const service=new api.KizReviewQueue(db,{resolveClientFilter:()=> 'client',requireClientAccess:()=>{}});
 return {service,user,calls,row,api,evidence,db,kiz};
}
test('admin approves returned unit, audits and archives old live binding; next scan permission is ALLOW',async()=>{
 const f=fixture();await f.service.decide('review','REUSE','Confirmed physical return',true,f.user);
 assert.equal(f.row.status,'APPROVED');assert.equal(f.row.resolution,'REUSE');
 assert.equal(f.api.permittedReviewAction(f.row,f.row.context,'REVIEW'),'ALLOW');
 assert.equal(f.api.permittedReviewAction(f.row,f.row.context,'RELABEL'),null);
 assert.equal(f.calls.filter(c=>c[0]==='release').length,1);
 assert(f.calls.some(c=>c[0]==='audit'&&c[1].data.action==='KIZ_CANCELLED_BINDING_ARCHIVED'));
});
for(const [name,change] of Object.entries({worker:{worker:true},activeBinding:{previous:{status:'IN_PROGRESS'}},openRequest:{openRequest:true},missingArchive:{noHistory:true},foreignBox:{wrongBox:true},concurrentChange:{race:true},staleProof:{evidence:{checkedAt:new Date(0).toISOString()}},sold:{evidence:{decision:'RELABEL'}},unverified:{evidence:{orders:[{...order,verified:false}]}}}))
 test('reject '+name,async()=>{const f=fixture(change);await assert.rejects(()=>f.service.decide('review','REUSE','Confirmed physical return',true,f.user));assert(!f.calls.some(c=>c[0]==='approve'))});

test('independent TSD admin permission archives closed binding and approves same unit',async()=>{const f=fixture();const r=await f.service.decide('unit:mark','REUSE','Confirmed physical return',true,f.user);assert.equal(r.status,'APPROVED');assert.equal(r.resolution,'REUSE');assert(f.calls.some(c=>c[0]==='release'));});
test('picker scan requires approval and consumes fresh decision without relabel',async()=>{const f=fixture();assert.equal(await f.api.queueKizReview(f.db,'client',f.kiz,'current',f.evidence),'REVIEW');await f.service.decide('review','REUSE','Confirmed physical return',true,f.user);assert.equal(await f.api.queueKizReview(f.db,'client',f.kiz,'current',f.evidence),'ALLOW');});
