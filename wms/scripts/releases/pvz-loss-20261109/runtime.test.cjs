// TEST: actual candidate modules, no database/marketplace or stock writes.
const assert=require('node:assert/strict');const dir=process.argv[2]||'/app/apps/api/dist';
process.env.WMS_FBS_PVZ_LOSS_SETTLEMENT_ENABLED='true';process.env.WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED='true';
const pvz=require(dir+'/modules/marketplace-connections/fbs-pvz-loss');
const {MarketplaceConnectionsService:C}=require(dir+'/modules/marketplace-connections/marketplace-connections.service');
const task={id:'new',requestItemId:'item',requestId:'request',clientId:'client',stockWarehouseId:'warehouse',connectionId:'wb',marketplace:'WILDBERRIES',orderId:'100',skuId:'sku',status:'IN_PROGRESS'};
const value={version:1,purpose:'PVZ_LOSS_SETTLEMENT',taskId:'new',requestId:'request',clientId:'client',warehouseId:'warehouse',connectionId:'wb',orderId:'100',skuId:'sku',shipmentId:'shipment',originalAttemptId:'old'};
const request={id:'request',number:999,title:'Довоз ПВЗ',status:'IN_WORK',fbsEmergencyAssemblyAt:new Date(),client:{id:'client',code:'CL',name:'Client'}};
const link={...task,id:'link',lastCategory:'cancelled',lastSupplierStatus:'complete',lastWbStatus:'canceled_by_client',lastSkuId:'sku',lastItemCount:1,syncStatus:'ACTIVE',request,createdAt:new Date(),lastSupplyId:'WB-GI-1'};
delete link.requestItemId;
const db={systemSetting:{findMany:async()=>[{key:pvz.pvzLossKey('request'),value}]},fbsOrderRequestLink:{findUnique:async()=>link,findMany:async()=>[link],update:async({data})=>{assert.equal(data.lastWbStatus,'canceled_by_client');return link}},fbsTsdAssembly:{findUnique:async()=>task,findFirst:async()=>null,findMany:async()=>[]},client:{findUnique:async()=>({id:'client',code:'CL',name:'Client'})},clientMarketplaceConnection:{findMany:async()=>[{id:'wb',marketplace:'WILDBERRIES',accountName:'WB'}]},sku:{findMany:async()=>[{id:'sku',name:'Suit',article:'exact',internalSku:'EXACT',barcodes:[{value:'4600'}],balances:[]}]} };
(async()=>{const service=Object.create(C.prototype);service.prisma=db;service.loadFbsDeliveryPlan=async()=>({});service.fbsTsdDeviceCode=()=> 'TSD';service.clientScopes={resolveClientFilter:()=> 'client',requireClientAccess:()=>{}};
await service.requireFbsOrderStillCollectable(task);await assert.rejects(()=>service.requireFbsOrderStillCollectable({...task,id:'other'}));
const orders=await service.loadFbsTsdRequestOrders('client','request');assert.equal(orders.orders.length,1);assert.equal(orders.orders[0].supplierStatus,'complete');assert.equal(orders.orders[0].wbStatus,'canceled_by_client');assert.equal(orders.orders[0].pvzLossSettlementVerified,true);
assert.equal(await pvz.syncPvzLossBatch(db,'request',[{id:'100',connectionId:'wb',category:'cancelled',supplierStatus:'complete',wbStatus:'canceled_by_client'}]),true);
// Previous ids/other order and disabled installation retain the ordinary terminal guard.
for(const change of [{id:'old'},{clientId:'other'},{stockWarehouseId:'other'},{requestId:'other'},{orderId:'other'},{skuId:'other'}])assert.equal(await pvz.isPvzLossTask(db,{...task,...change}),false);
process.env.WMS_FBS_PVZ_LOSS_SETTLEMENT_ENABLED='false';await assert.rejects(()=>service.requireFbsOrderStillCollectable(task));const disabled=await service.loadFbsTsdRequestOrders('client','request');assert.equal(disabled.orders.length,0);
console.log('PASS actual runtime12: queue, collector, sync, real WB status, exact scope, disabled isolation');})().catch(e=>{console.error(e);process.exitCode=1});
