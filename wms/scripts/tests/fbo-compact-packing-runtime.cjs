// TEST: execute the deployed acknowledgement methods, not a full stale source build.
const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {FboTwoStageService}=require((process.env.RUNTIME_ROOT||'/app/apps/api/dist')+'/modules/tsd/fbo-two-stage.service');
function fixture(){
 process.env.WMS_FBO_COMPACT_PACKING_ENABLED='true';let committed=false,writes=0;
 const svc=Object.create(FboTwoStageService.prototype),dto={action:'OPEN_BOX',operationId:'operation',targetBoxCode:'FFL_BOX'},user={id:'u'};
 const request={id:'r',items:[{id:'l',skuId:'s',barcode:'123',quantity:2,sku:{}}]};
 const tx={$queryRaw:async()=>[{phase:'PACKING',compositionHash:createHash('sha256').update(JSON.stringify([['l','s','123',2]])).digest('hex')}],
 fboAssemblyUnit:{groupBy:async({by})=>by.includes('requestItemId')?[{requestItemId:'l',state:'PICKED',wholeBox:false,_count:{_all:2}}]:[]},
 fboAssemblyBox:{findMany:async()=>[{boxId:'b',boxCode:'FFL_BOX',wholeBox:false,closedAt:null,confirmedAt:null}]}};
 svc.prisma={fboAssemblyAction:{findUnique:async()=>committed?{actorId:'u',payloadHash:svc.actionHash(dto)}:null},$transaction:async fn=>fn(tx)};
 svc.load=async()=>request;svc.requireFastAcknowledgement=()=>{};svc.logger={log:()=>{}};
 svc.executeAction=async()=>{committed=true;writes++;};
 return {svc,dto,user,writes:()=>writes};
}
test('fresh and repeated committed receipts carry absolute packing state without a second mutation',async()=>{
 const f=fixture();const ack=await f.svc.actAcknowledged('r',f.dto,f.user);assert.equal(ack.packing.picked,2);
 const retry=await f.svc.actAcknowledged('r',f.dto,f.user);assert.deepEqual(retry,ack);assert.equal(f.writes(),1);
 const status=await f.svc.operationStatus('r',f.dto,f.user);assert.deepEqual(status,ack);
});
test('disabled rollout preserves legacy receipt',async()=>{const f=fixture();process.env.WMS_FBO_COMPACT_PACKING_ENABLED='false';const ack=await f.svc.actAcknowledged('r',f.dto,f.user);assert.equal(ack.accepted,true);assert.equal(ack.packing,undefined);});
