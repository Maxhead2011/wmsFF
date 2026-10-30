// TEST: exercise adapted production JavaScript, including both existing FBS read paths.
require('reflect-metadata');const assert=require('node:assert/strict');const base='/app/apps/api/dist/';
const {MarketplaceConnectionsController}=require(base+'modules/marketplace-connections/marketplace-connections.controller');
const {ClientStoresService}=require(base+'modules/clients/client-stores.service');
const {TsdPayloadParser}=require(base+'modules/tsd/tsd-payload.parser');
const {assertStoreReceipt}=require(base+'modules/clients/client-store-receipt');
const {requestStoreContexts}=require(base+'modules/clients/request-store-context');
(async()=>{
 let passed=0;const check=(a,b)=>{assert.deepEqual(a,b);passed++;};const calls=[],user={id:'u',roleCodes:['OWNER'],isDemo:false};
 const response={connections:[{id:'mw'}],orders:[{id:'order',connectionId:'mw',quantity:1}],deliveryPlan:{requiresCargoPlaces:true}};
 const connections={listFbsOrdersForDisplay:async(...args)=>{calls.push(['snapshot',...args]);return response},listFbsOrders:async(...args)=>{calls.push(['strict',...args]);return response}};
 const directory=[{id:'monlarti',name:'Монларти',connectionIds:['mw','mo']},{id:'braibo',name:'Брайбо',connectionIds:['bw']}];
 const db={client:{findFirst:async()=>({id:'client'})},systemSetting:{findUnique:async()=>({value:directory})},clientMarketplaceConnection:{findMany:async()=>['mw','mo','bw'].map(id=>({id}))}};
 const stores=new ClientStoresService(db,{requireClientAccess:()=>{}}),controller=new MarketplaceConnectionsController(connections,null,null,null,null,null,stores);
 process.env.WMS_CLIENT_STORES_ENABLED='true';
 const snap=await controller.listFbsOrders(user,'client','1','snapshot','1','warehouse');check(calls[0],['snapshot','client',user,true,true,'warehouse']);check(snap.orders[0].storeId,'monlarti');check(snap.stores[0].connectionIds,['mw']);check(response.orders[0].storeId,undefined);check(snap.deliveryPlan,response.deliveryPlan);
 await controller.listFbsOrders(user,'client','0',undefined,'0','warehouse');check(calls[1],['strict','client',user,false,false,'warehouse']);
 process.env.WMS_CLIENT_STORES_ENABLED='false';check(await stores.decorateOrders('client',response,user),response);
 check(await requestStoreContexts({},[{id:'r',clientId:'c'}]),new Map());
 process.env.WMS_CLIENT_STORES_ENABLED='true';process.env.WMS_CLIENT_STORE_RECEIPTS_ENABLED='false';check(await assertStoreReceipt({}, {clientId:'client',skuId:'sku'}),null);
 const parser=new TsdPayloadParser();check(parser.parseReceiptPayload({clientId:'client',barcode:'2050000000001',quantity:1,storeId:'monlarti'}).storeId,'monlarti');check(parser.parseMovePayload({clientId:'client',barcode:'2050000000001',quantity:1,fromBoxCode:'FFL_A',toBoxCode:'FFL_B',storeId:'monlarti'}).storeId,undefined);
 check(Reflect.getMetadata('design:paramtypes',MarketplaceConnectionsController).at(-1),ClientStoresService);
 console.log(JSON.stringify({passed,actualRuntime:true}));
})().catch(e=>{console.error(e);process.exit(1)});
