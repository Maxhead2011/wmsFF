// TEST: exercise the compiled helper, including direct scans of closed requests.
const assert=require('node:assert/strict');
const {listPostPick,queuePostPick}=require('/app/apps/api/dist/modules/marketplace-connections/sos-post-pick');
process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='true';
(async()=>{
 let passed=0;
 for(const status of ['DONE','CANCELLED','REJECTED','PACKED','IN_WORK','SUBMITTED']) {
  const request={id:'r',clientId:'c',number:1,status},task={id:'a',requestId:'r',connectionId:'co',orderId:'o',marketplace:'WILDBERRIES',status:'COMPLETED',completedAt:new Date(),requiresKiz:false};
  const db={clientRequest:{findMany:async({where})=>where.status.notIn.includes(status)?[]:[request]},systemSetting:{findMany:async()=>[]},fbsTsdAssembly:{findMany:async()=>[task]},fbsOrderRequestLink:{findMany:async()=>[task]},fbsPrintJob:{findMany:async()=>[]}};
  const user={id:'u',activeWarehouseId:'wh'},clients={resolveClientFilter:()=> 'c'},active=['PACKED','IN_WORK','SUBMITTED'].includes(status);
  assert.equal((await listPostPick(db,clients,user)).requests.length,active?1:0);
  if(!active) await assert.rejects(queuePostPick(db,clients,user,{requestId:'r',barcode:'123',stationId:'s',operationId:'11111111-1111-4111-8111-111111111111'},async()=>{throw Error('Must not load label')}),/недоступна/);
  passed++;
 }
 console.log(JSON.stringify({passed,stockDelegatesAbsent:true}));
})().catch(e=>{console.error(e);process.exit(1)});
