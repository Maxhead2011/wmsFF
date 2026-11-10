// TEST: actual endpoint after cold start, same branch/store boundaries, no external mutations.
const a=require('node:assert/strict'),mod='/app/apps/api/dist/modules/marketplace-connections';
const {MarketplaceConnectionsController}=require(mod+'/marketplace-connections.controller');
const {MarketplaceConnectionsService}=require(mod+'/marketplace-connections.service');
async function scenario(options={}){
 process.env.WMS_FBS_SAVED_ARCHIVE_ENABLED=options.off?'false':'true';
 const clientId='c',connection={id:'cab',marketplace:'WILDBERRIES'},response={client:{id:clientId},connections:[connection],orders:[],counts:{all:0}};
 const rows=['one','other-branch'].map((id,i)=>({id,orderId:id,clientId,connectionId:'cab',marketplace:'WILDBERRIES',syncStatus:'ACTIVE',lastCategory:'shipped',lastSupplierStatus:'complete',lastWbStatus:'sorted',lastSkuId:null,handedOverAt:new Date(),request:{status:'DONE',warehouseId:i?'other':'wh'}}));
 const db={clientMarketplaceConnection:{findMany:async()=>[connection]},fbsOrderRequestLink:{findMany:async()=>rows},sku:{findMany:async()=>[]},fbsSupplyPlan:{findMany:async()=>[]}};
 const service=new MarketplaceConnectionsService(db,{requireClientAccess(_u,id){a.equal(id,clientId)}});let scoped=0;
 service.listFbsOrdersForDisplay=async()=>structuredClone(response);service.listFbsOrders=service.listFbsOrdersForDisplay;
 service.scopeFbsOrdersForUser=async(r,_u,all,wh)=>{scoped++;a.equal(all,false);a.equal(wh,'wh');return {...r,orders:r.orders.filter(o=>o.request.warehouseId==='wh')}};
 const host={connections:service,stores:{decorateOrders:async(_id,r)=>{a(!r.orders.some(o=>o.request.warehouseId==='other'));return r}}};
 const result=await MarketplaceConnectionsController.prototype.listFbsOrders.call(host,{},clientId,'false',options.active?'snapshot':'archive','0','wh');
 return {result,scoped};
}
(async()=>{
 for(let i=0;i<2;i++){const x=await scenario();a.equal(x.result.orders.length,1,'cold archive must restore saved shipment');a.equal(x.result.orders[0].id,'one');a.equal(x.scoped,1)}
 const active=await scenario({active:true});a.equal(active.result.orders.length,0);a.equal(active.scoped,0);const x=await scenario({off:true});a.equal(x.result.orders.length,0);a.equal(x.scoped,0);
 console.log('PASS runtime3: repeated cold endpoint, branch/store scope, sold flag-off; no mutation adapters');
})().catch(e=>{console.error(e);process.exitCode=1});
