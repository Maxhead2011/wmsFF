// TEST: invoke the actual published runAutoAssembly in preview; no WB mutations or requests.
const assert=require('node:assert/strict'),fs=require('fs');
const {MarketplaceConnectionsService:S}=require(process.argv[2]+'/modules/marketplace-connections/marketplace-connections.service');
(async()=>{
 process.env.WMS_FBS_FABRIC_CUT_ENABLED='true';
 const sku={id:'sku',clientId:'client',name:'Ткань',internalSku:'white_1-0',needsChestnyZnak:false};
 const order={id:'42',connectionId:'cab',marketplace:'WILDBERRIES',category:'active',supplierStatus:'new',warehouseId:'wb',product:sku,reservation:{status:'FABRIC_ON_DEMAND'}};
 let tasks=[],enabled=true;
 const db={clientMarketplaceConnection:{findUniqueOrThrow:async()=>({id:'cab',clientId:'client',marketplace:'WILDBERRIES',isActive:true,fbsAutoRouteNewWarehouses:true,fbsExecutionWarehouseId:'wh'})},fbsWarehouseRoutingRule:{findMany:async()=>[]},fbsTsdAssembly:{findMany:async()=>tasks},fbsOrderRequestLink:{findMany:async()=>[]},systemSetting:{findUnique:async()=>({value:{enabled}})},sku:{findMany:async()=>[sku]}};
 const s=Object.create(S.prototype);s.prisma=db;s.clientScopes={requireClientAccess:()=>{}};s.fbsOrdersCache=new Map();s.loadFbsOrdersUncached=async()=>({orders:[order],connectionErrors:[]});
 const run=()=>s.runAutoAssembly('cab',{allWarehouses:true,warehouseIds:[]},{},true);
 assert.equal((await run()).groups[0]?.count,1);
 tasks=[{connectionId:'cab',orderId:'42',status:'PICKING',workerName:'Worker'}];assert.equal((await run()).skipReasons.existingPickingWork,1);
 tasks=[];enabled=false;assert.equal((await run()).skipReasons.existingPickingWork,1);
 enabled=true;order.reservation.status='RESERVED';assert.equal((await run()).skipReasons.existingPickingWork,1);
 order.reservation.status='FABRIC_ON_DEMAND';order.request={id:'already'};assert.equal((await run()).skipReasons.alreadyInRequest,1);
 console.log(JSON.stringify({passed:5,previewOnly:true,realService:true}));
})().catch(e=>{console.error(e);process.exitCode=1});

