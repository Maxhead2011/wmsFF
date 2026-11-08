// TEST: execute patched runtime with synthetic storage; never connect to production DB.
const assert=require('node:assert/strict');
const {ClientRequestsService}=require('/candidate/modules/client-requests/client-requests.service.js');
(async()=>{let query;const row={id:'x',title:'Excel',comment:null,_count:{fbsOrderLinks:0}};
const svc=new ClientRequestsService({clientRequest:{findMany:async q=>{query=q;return [{...row,id:'y',yandexFbyShipment:{id:'y'}},row,{...row,id:'o',ozonShipment:{}},{...row,id:'l',lamodaAssembly:{}}]}}},{resolveClientFilter:()=>({in:['own']})},{});
const user={roleCodes:[],permissionCodes:['system:admin'],activeWarehouseId:'moscow'};
process.env.WMS_MARKETPLACE_WORKSPACES_ENABLED='true';assert.deepEqual(await svc.activeFboCounts(user),{wb:1,ozon:1,lamoda:1,yandex:1});assert.equal(query.where.warehouseId,'moscow');assert.deepEqual(query.where.clientId,{in:['own']});assert.deepEqual(query.where.status,{notIn:['DONE','CANCELLED','REJECTED']});assert.equal(query.where.yandexFbyShipment,undefined);
process.env.WMS_MARKETPLACE_WORKSPACES_ENABLED='false';await assert.rejects(()=>svc.activeFboCounts(user));console.log('6 runtime API checks passed');})().catch(e=>{console.error(e);process.exitCode=1});
