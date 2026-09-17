// TEST: both production snapshot reads and active-client counters retain branch parameters.
const assert=require('node:assert/strict');
const {MarketplaceConnectionsService}=require('/app/apps/api/dist/modules/marketplace-connections/marketplace-connections.service');
const {MarketplaceConnectionsController}=require('/app/apps/api/dist/modules/marketplace-connections/marketplace-connections.controller');
(async()=>{
  const user={id:'test'},calls=[];
  const stub={listFbsOrdersForDisplay:async(...args)=>{calls.push(['snapshot',...args]);return{}},listFbsOrders:async(...args)=>{calls.push(['live',...args]);return{}},listFbsActiveClients:(...args)=>{calls.push(['clients',...args]);return[]}};
  const controller=new MarketplaceConnectionsController(stub);
  await controller.listFbsOrders(user,'client','1','snapshot','1','ng');
  await controller.listFbsOrders(user,'client','0',undefined,'0','msk');
  controller.listFbsActiveClients(user,'WILDBERRIES','snapshot','1','ng');
  assert.deepEqual(calls,[['snapshot','client',user,true,true,'ng'],['live','client',user,false,false,'msk'],['clients',user,'WILDBERRIES',true,true,'ng']]);
  const value={fetchedAt:new Date().toISOString(),orders:[],counts:{active:0},connected:true};
  const service=new MarketplaceConnectionsService({clientMarketplaceConnection:{findMany:async()=>[{client:{id:'client'}}]}},{requireClientAccess:()=>{},resolveClientFilter:()=>undefined});
  service.fbsOrdersCache.set('client',{value,expiresAt:Date.now()+60000});
  service.mergeSyncedFbsTsdRequestOrders=async()=>value;
  const scopes=[];service.scopeFbsOrdersForUser=async(...args)=>{scopes.push(args.slice(1));return value};
  await service.listFbsOrdersForDisplay('client',user,false,false,'ng');
  await service.listFbsActiveClients(user,'WILDBERRIES',true,true,undefined);
  assert.deepEqual(scopes,[[user,false,'ng'],[user,true,undefined]]);
  console.log('SNAPSHOT_BRANCH_CHECK_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
