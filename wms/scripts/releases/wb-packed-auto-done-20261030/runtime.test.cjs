// TEST: actual candidate service exits before touching any task/stock API.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('path');
process.env.NODE_PATH=[process.env.NODE_PATH,path.resolve('apps/api/node_modules'),path.resolve('node_modules')].filter(Boolean).join(path.delimiter);require('module').Module._initPaths();require('reflect-metadata');
const root=process.env.CANDIDATE_API_DIR;assert(root);
const {MarketplaceConnectionsService}=require(path.join(root,'modules/marketplace-connections/marketplace-connections.service'));
test('candidate transaction locks and closes exactly once, with no stock access',async()=>{
 process.env.WMS_WB_PACKED_AUTO_DONE_ENABLED='true';let events=0,writes=0,locks=0;
 const r={id:'r',clientId:'c',type:'OUTBOUND',status:'PACKED',updatedAt:new Date(),fbsEmergencyAssemblyAt:null,
 fbsOrderLinks:[{marketplace:'WILDBERRIES',connectionId:'conn',orderId:'1',syncStatus:'ACTIVE'}]};
 const tx={$queryRaw:async()=>{locks++},client:{findUnique:async()=>({isDemo:false})},clientRequest:{findUnique:async()=>r,updateMany:async args=>{assert.deepEqual(args.data,{status:'DONE'});writes++;r.status='DONE';return{count:1}}},clientRequestEvent:{create:async()=>{events++}},fbsRepeatAssemblyRun:{findUnique:async()=>null},fbsReshipmentRun:{findUnique:async()=>null}};
 const svc=Object.create(MarketplaceConnectionsService.prototype);svc.prisma={$transaction:fn=>fn(tx)};
 const orders=new Map([['conn:1',{id:'1',connectionId:'conn',marketplace:'WILDBERRIES',supplierStatus:'complete',wbStatus:'sorted'}]]);
 assert.equal((await svc.syncOneFbsRequest('c','r',orders,[])).changed,true);
 assert.equal((await svc.syncOneFbsRequest('c','r',orders,[])).changed,false);
 assert.equal(writes,1);assert.equal(events,1);assert.equal(locks,2);
});
