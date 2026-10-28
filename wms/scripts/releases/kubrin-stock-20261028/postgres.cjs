// TEST: isolated PostgreSQL only; exact candidate modules, no marketplace calls.
require('reflect-metadata');const assert=require('node:assert/strict');
assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL).hostname,'kubrin-stock-test-pg');
const {PrismaClient}=require('@prisma/client'),p=new PrismaClient();
const {reconcileTerminalAutoReservations:reconcile}=require('/app/apps/api/dist/modules/marketplace-connections/wb-terminal-auto-reservations');
const {monitorProductIdentities,monitorIdentityKey}=require('/app/apps/api/dist/modules/marketplace-connections/fbs-monitor-product-identity');
const {FbsStockMonitoringService}=require('/app/apps/api/dist/modules/marketplace-connections/fbs-stock-monitoring.service');
const {wbReservationQuantities}=require('/app/apps/api/dist/common/stock/wb-order-stock-lifecycle');
(async()=>{let passed=0;
 const c=await p.client.create({data:{code:'TEST',name:'Synthetic'}});
 const sku=await p.sku.create({data:{clientId:c.id,internalSku:'TEST',name:'Test',marketplaceProductId:'123456'}});
 const conn=await p.clientMarketplaceConnection.create({data:{clientId:c.id,marketplace:'WILDBERRIES',apiKey:'unused'}});
 const wh=await p.warehouse.create({data:{code:'TEST',name:'Test'}});
 await p.clientMarketplaceConnection.update({where:{id:conn.id},data:{fbsWarehouseId:'wb',fbsExecutionWarehouseId:wh.id,fbsAutoRouteNewWarehouses:true}});
 process.env.WMS_FBS_MONITOR_ROUTING_ENABLED='true';
 await p.stockBalance.create({data:{balanceKey:'TEST',clientId:c.id,warehouseId:wh.id,skuId:sku.id,status:'AVAILABLE',quantity:13}});
 process.env.WMS_WB_TERMINAL_AUTO_RESERVATIONS_ENABLED='true';process.env.WMS_WB_TERMINAL_AUTO_RESERVATION_CLIENTS=c.id;
 const create=(orderId,extra={})=>p.fbsTsdAssembly.create({data:{clientId:c.id,connectionId:conn.id,marketplace:'WILDBERRIES',orderId,
  requestId:`AUTO:WILDBERRIES:${conn.id}:${orderId}`,requestItemId:'AUTO:'+orderId,skuId:sku.id,stockWarehouseId:wh.id,
  productName:'Test',barcodes:[],storageBoxes:[],itemCount:1,status:'WAITING_STOCK',deviceCode:'AUTO',updatedAt:new Date(0),...extra}});
 const sold=async(_key,ids)=>new Map(ids.map(id=>[id,{supplierStatus:'complete',wbStatus:'sold'}]));
 const first=await create('1'),before=JSON.stringify(await p.stockBalance.findMany());
 assert.equal((await wbReservationQuantities(p,c.id,[sku.id],wh.id)).get(sku.id),1);
 assert.equal((await reconcile(p,c.id,sold)).released,1);
 assert.equal((await wbReservationQuantities(p,c.id,[sku.id],wh.id)).get(sku.id)||0,0);
 assert.equal(JSON.stringify(await p.stockBalance.findMany()),before);assert.equal(await p.stockMovement.count(),0);assert.equal(await p.wbOrderShipment.count(),0);passed++;
 assert.equal((await reconcile(p,c.id,sold)).released,0);assert.equal(await p.auditLog.count({where:{entityId:first.id}}),1);passed++;
 const active=await create('2');assert.equal((await reconcile(p,c.id,async()=>new Map([['2',{supplierStatus:'confirm',wbStatus:'waiting'}]]))).released,0);passed++;
 await p.fbsTsdAssembly.update({where:{id:active.id},data:{status:'RELEASED'}});
 await create('3',{barcode:'scanned'});assert.equal((await reconcile(p,c.id,sold)).released,0);passed++;
 const raced=await create('4');assert.equal((await reconcile(p,c.id,async(key,ids)=>{
  await p.fbsTsdAssembly.update({where:{id:raced.id},data:{startedAt:new Date(),status:'IN_PROGRESS'}});return sold(key,ids);
 })).released,0);passed++;
 const rollback=await create('5');
 const failing=new Proxy(p,{get(target,key){if(key==='$transaction')return (fn,opts)=>p.$transaction(tx=>fn(new Proxy(tx,{get(t,k){return k==='auditLog'?{create:async()=>{throw Error('audit failed')}}:t[k]}})),opts);return target[key]}});
 await assert.rejects(()=>reconcile(failing,c.id,sold),/audit failed/);
 assert.equal((await p.fbsTsdAssembly.findUniqueOrThrow({where:{id:rollback.id}})).status,'WAITING_STOCK');passed++;
 process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED='true';process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS=c.id;
 await p.marketplaceProductLink.create({data:{clientId:c.id,connectionId:conn.id,skuId:sku.id,marketplace:'WILDBERRIES',productId:'555:5000000000',offerId:'TEST',barcodes:[],status:'LINKED',payload:{}}});
 const event=await p.fbsStockMonitorEvent.create({data:{eventKey:'TEST',clientId:c.id,connectionId:conn.id,marketplaceWarehouseId:'wb',executionWarehouseId:wh.id,orderId:'5',skuId:sku.id,productName:'Test',saleAt:new Date(),deadlineAt:new Date(0),wbStatus:'UNAVAILABLE',wmsStatus:'ERROR'}});
 const monitor=new FbsStockMonitoringService(p,{}, {get:()=>undefined},{});
 monitor.registerProbe(async rows=>rows.map(row=>{assert.equal(row.chrtId,5000000000);return {eventId:row.eventId,wbCurrentAmount:1,wbOrderMatched:true,wmsCurrentAmount:13,wmsSellableAmount:12,wmsReservedAmount:1,wmsReservationMatched:true,wmsReservationRequired:true}}));
 await monitor.runChecks({force:true,where:{id:event.id}});
 const checked=await p.fbsStockMonitorEvent.findUniqueOrThrow({where:{id:event.id}});assert.equal(checked.chrtId,5000000000n);assert.equal(checked.wmsStatus,'SUCCESS');passed++;
 const row={clientId:c.id,connectionId:'other',skuId:sku.id,marketplaceProductId:'444:999'};
 assert.equal((await monitorProductIdentities(p,[row])).get(monitorIdentityKey(row)),null);
 assert.equal(JSON.stringify(await p.stockBalance.findMany()),before);assert.equal(await p.stockMovement.count(),0);passed++;
 console.log(JSON.stringify({passed,physicalStockUnchanged:true,auditAtomic:true}));
})().finally(()=>p.$disconnect()).catch(e=>{console.error(e);process.exitCode=1});
