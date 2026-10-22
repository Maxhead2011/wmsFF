const assert=require('assert/strict');require('reflect-metadata');const {TurnoverService}=require('/app/apps/api/dist/modules/turnover/turnover.service');const {ClientScopeService}=require('/app/apps/api/dist/modules/auth/client-scope.service');
(async()=>{let reads=0;const prisma={client:{findUnique:async()=>{reads++;return{id:'own',code:'C',name:'Own'}}},stockBalance:{findMany:async()=>[]},productMark:{groupBy:async()=>[]}};const service=new TurnoverService(prisma,new ClientScopeService());const user={id:'client',roleCodes:['CLIENT'],permissionCodes:['stock:read'],clientScopeMode:'LIMITED',clientIds:['own'],writableClientIds:[]};
await assert.rejects(service.getStockXlsx({clientId:'foreign'},user),e=>e.getStatus()===403);assert.equal(reads,0);
const file=await service.getStockXlsx({clientId:'own'},user);assert(file.content.length>0);assert(file.fileName.endsWith('.xlsx'));
assert.throws(()=>service.requireInternalStatisticsAccess(user),e=>e.getStatus()===403);
console.log(JSON.stringify({passed:3,clientIsolation:true,ownExport:true,statisticsBlocked:true}));})().catch(e=>{console.error(e);process.exit(1)});
