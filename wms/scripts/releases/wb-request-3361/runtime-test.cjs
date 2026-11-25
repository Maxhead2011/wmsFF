// TEST: real compiled controller/service, cold cache, scope forwarding, and opt-out.
const assert=require('node:assert/strict'),path=require('node:path');
const root=process.argv[2],dir=path.join(root,'modules/marketplace-connections');
require(require.resolve('reflect-metadata',{paths:[root]}));
const {MarketplaceConnectionsService:S}=require(path.join(dir,'marketplace-connections.service.js'));
const {MarketplaceConnectionsController:C}=require(path.join(dir,'marketplace-connections.controller.js'));
(async()=>{
 process.env.WMS_FBS_ACTION_STATUS_ENABLED='true';process.env.WMS_FBS_SAVED_ARCHIVE_ENABLED='true';
 const response={client:{id:'client'},connections:[{id:'cab'}],orders:[]},user={id:'user'},reads=[];
 const service=Object.create(S.prototype);
 service.clientScopes={requireClientAccess:(...args)=>assert.deepEqual(args,[user,'client','read'])};
 service.prisma={clientMarketplaceConnection:{findMany:async()=>[{id:'cab',marketplace:'WILDBERRIES'}]},
 fbsOrderRequestLink:{findMany:async q=>{reads.push(q);return [{clientId:'client',connectionId:'cab',marketplace:'WILDBERRIES',orderId:'order',syncStatus:'ACTIVE',lastCategory:'shipped',lastSupplierStatus:'complete',lastWbStatus:'waiting',orderPlacedAt:new Date('2026-07-01'),request:{id:'r',status:'PACKED',warehouseId:'branch'}}]}},
 sku:{findMany:async()=>[]},fbsSupplyPlan:{findMany:async()=>[]}};
 service.scopeFbsOrdersForUser=async(r,u,all,branch)=>{assert.equal(u,user);assert.equal(all,false);assert.equal(branch,'branch');return r};
 const restored=await service.restoreFbsAwaitingForDisplay('client',response,user,false,'branch');
 assert.equal(restored.orders.length,1);assert.equal(restored.orders[0].category,'shipped');assert.equal(response.orders.length,0);assert(!restored.archivePeriod);assert.equal(reads.length,1);
 process.env.WMS_FBS_ACTION_STATUS_ENABLED='false';assert.equal(await service.restoreFbsAwaitingForDisplay('client',response,user,false,'branch'),response);assert.equal(reads.length,1);
 process.env.WMS_FBS_ACTION_STATUS_ENABLED='true';
 const controller=Object.create(C.prototype),steps=[];
 controller.connections={listFbsOrdersForDisplay:async()=>{steps.push('snapshot');return response},restoreFbsAwaitingForDisplay:async(...a)=>{assert.deepEqual(a,['client',response,user,false,'branch']);steps.push('pending');return restored},decorateFbsFabricDisplay:async(c,r)=>{assert.equal(r,restored);steps.push('fabric');return r}};
 const args=String(C.prototype.listFbsOrders).match(/^[^(]+\(([^)]*)\)/)[1].split(',').map(x=>x.trim());
 const values={user,clientId:'client',view:'snapshot',allBranches:'0',displayWarehouseId:'branch'};
 assert.deepEqual(await controller.listFbsOrders(...args.map(n=>values[n])),restored);assert.deepEqual(steps,['snapshot','pending','fabric']);
 console.log('PASS compiled controller/service: cold pending restoration, branch/client scope, flag opt-out, no mutation methods');
})().catch(e=>{console.error(e);process.exitCode=1});
