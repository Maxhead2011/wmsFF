// TEST: published candidate worker list/direct selection preserve the ordinary fixed five.
const assert=require('node:assert/strict'),root=process.argv[2]||'/app/apps/api/dist';
process.env.WMS_FBS_PVZ_LOSS_SETTLEMENT_ENABLED='true';process.env.WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED='true';
const {MarketplaceConnectionsService:C}=require(root+'/modules/marketplace-connections/marketplace-connections.service');
const clientId='c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',client={id:clientId,code:'CL',name:'Client'};
const make=n=>({requestId:'request-'+n,clientId,connectionId:'wb',orderId:'order-'+n,marketplace:'WILDBERRIES',lastCategory:'active',lastSupplierStatus:'confirm',lastWbStatus:'waiting',lastSkuId:'sku-'+n,lastSupplyId:null,request:{id:'request-'+n,clientId,number:n,title:'FBS',status:'IN_WORK',fbsEmergencyAssemblyAt:null,client}});
const links=[1,2,3,4,5,6].map(make),urgent=make(100);urgent.lastCategory='cancelled';urgent.lastWbStatus='canceled_by_client';urgent.request.fbsEmergencyAssemblyAt=new Date();links.push(urgent);
const task={id:'new',requestItemId:'item',clientId,requestId:urgent.requestId,skuId:urgent.lastSkuId,marketplace:'WILDBERRIES',connectionId:'wb',orderId:urgent.orderId};
const value={...task,taskId:task.id,version:1,purpose:'PVZ_LOSS_SETTLEMENT',warehouseId:'warehouse',shipmentId:'proof',originalAttemptId:'old'};
const setting={value:{requestIds:[1,2,3,4,5].map(n=>'request-'+n)}};
const db={fbsTsdAssembly:{findFirst:async()=>null,findMany:async()=>[],findUnique:async()=>task},fbsOrderRequestLink:{findMany:async()=>links},fbsSupplyPlan:{findMany:async()=>[]},stockBalance:{findMany:async()=>links.map(l=>({skuId:l.lastSkuId,clientId,boxId:'box'}))},client:{findMany:async()=>[]},sku:{findMany:async()=>[]},systemSetting:{findUnique:async()=>setting,findMany:async()=>[{key:'fbs.pvzLossSettlement.'+task.requestId,value}],upsert:async()=>{throw Error('fixed window was modified')}},$executeRaw:async()=>1,clientRequest:{findUnique:async()=>urgent.request},clientMarketplaceConnection:{findMany:async()=>{throw Error('PAST_PVZ_GUARD')}}};db.$transaction=async callback=>callback(db);
(async()=>{const service=new C(db,{resolveClientFilter:()=>clientId,requireClientAccess:()=>{}});service.fbsTsdDeviceCode=()=> 'TSD';const worker={id:'worker',name:'Worker',roleCodes:['WORKER']};
const result=await service.listFbsTsdRequests('TSD',worker);assert.deepEqual(result.requests.map(r=>r.requestNumber),[100,5,4,3,2,1]);assert.deepEqual(setting.value.requestIds,[1,2,3,4,5].map(n=>'request-'+n));
await assert.rejects(()=>service.getNextFbsTsdAssemblyUnlocked('TSD',worker,task.requestId),/PAST_PVZ_GUARD/);
process.env.WMS_FBS_PVZ_LOSS_SETTLEMENT_ENABLED='false';await assert.rejects(()=>service.getNextFbsTsdAssemblyUnlocked('TSD',worker,task.requestId),/пять/);
console.log('PASS actual worker priority4: visible, direct open, fixed five retained, disabled blocked');})().catch(e=>{console.error(e);process.exitCode=1});
