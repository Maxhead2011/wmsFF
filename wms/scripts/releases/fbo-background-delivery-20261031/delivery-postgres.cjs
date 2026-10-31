// TEST: appended to the isolated completion fixture; no real marketplace HTTP.
process.env.WMS_FBO_DELIVERY_SYNC_ENABLED='true';
const {FboDeliverySyncService,claimDelivery,finishDelivery}=require(dir+'modules/client-requests/fbo-delivery-sync.service');
const leases=await Promise.all([claimDelivery(p,id),claimDelivery(p,id)]);assert.equal(leases.filter(Boolean).length,1);
await finishDelivery(p,id,leases.find(Boolean),'WAITING_MARKETPLACE');assert.equal(await claimDelivery(p,id),null);passed++;
// Existing runtime must actually invoke the guard before writing any stock or billing.
const beforeShip=await p.stockMovement.count();
await assert.rejects(()=>stock.shipClientRequest({requestId:id},user,async()=>{throw Error('GUARD_ROLLBACK')}),/GUARD_ROLLBACK/);
assert.equal(await p.stockMovement.count(),beforeShip);assert.equal((await p.clientRequest.findUnique({where:{id}})).status,'PACKED');passed++;
const conn=await p.clientMarketplaceConnection.create({data:{clientId:c.id,marketplace:'OZON',sellerId:'TEST',apiKey:'synthetic'}});
const integration={connectionId:conn.id,orderId:'123',supplies:[{id:'456'}],orders:[{orderId:'123',supplies:[{id:'456'}]}],mapping:{},operations:{}};
await p.ozonFboShipment.create({data:{requestId:id,importKey:randomUUID(),directions:[],integration}});
const answer=()=>({orders:[{order_id:123,state:'ACCEPTED_AT_SUPPLY_WAREHOUSE',supplies:[{supply_id:456,state:'ACCEPTED_AT_SUPPLY_WAREHOUSE'}]}]});
const delivery=new FboDeliverySyncService(p,{call:async()=>answer()},{},stock);
// Partial direction does not move stock.
const partial=new FboDeliverySyncService(p,{call:async()=>({orders:[{...answer().orders[0],supplies:[{supply_id:456,state:'READY_TO_SUPPLY'}]}]})},{},stock);
assert.equal(await partial.reconcile(id),'WAITING_MARKETPLACE');assert.equal(await p.stockMovement.count(),beforeShip);passed++;
// Change binding between remote read and the request-locked operation: atomic rejection.
const changed=new FboDeliverySyncService(p,{call:async()=>{await p.ozonFboShipment.update({where:{requestId:id},data:{integration:{...integration,orderId:'999'}}});return answer();}},{},stock);
await assert.rejects(()=>changed.reconcile(id));assert.equal(await p.stockMovement.count(),beforeShip);
await p.ozonFboShipment.update({where:{requestId:id},data:{integration}});passed++;
// Two concurrent responders cannot duplicate shipment or confirmation audit.
await Promise.all([delivery.reconcile(id),delivery.reconcile(id)]);
assert.equal((await p.clientRequest.findUnique({where:{id}})).status,'DONE');
assert.equal(await p.auditLog.count({where:{entityId:id,action:'FBO_DELIVERY_CONFIRMED'}}),1);
assert.equal((await p.stockMovement.aggregate({where:{sourceDocument:id,type:'SHIP'},_sum:{quantity:true}}))._sum.quantity,-1710);
const afterShip=await p.stockMovement.count();assert.equal(await delivery.reconcile(id),'SKIPPED');assert.equal(await p.stockMovement.count(),afterShip);passed++;
// WB retains dispatch and quantity checks and runs without a browser.
const wbConn=await p.clientMarketplaceConnection.create({data:{clientId:c.id,marketplace:'WILDBERRIES',apiKey:'synthetic'}});
const s2=await p.sku.create({data:{clientId:c.id,internalSku:'WB-ONE',name:'WB test'}}),b2=await p.box.create({data:{code:'FFL_WB_ONE',clientId:c.id,warehouseId:wh.id}});
const r2=await p.clientRequest.create({data:{clientId:c.id,warehouseId:wh.id,type:'OUTBOUND',status:'PACKED',title:'WB delivery',items:{create:{skuId:s2.id,quantity:1}}},include:{items:true}});
await p.fboAssembly.create({data:{requestId:r2.id,phase:'COMPLETED',compositionHash:'test'}});
await p.fboAssemblyBox.create({data:{requestId:r2.id,boxId:b2.id,boxCode:b2.code,closedAt:new Date(),confirmedAt:new Date()}});
await p.stockBalance.create({data:{balanceKey:randomUUID(),clientId:c.id,warehouseId:wh.id,skuId:s2.id,boxId:b2.id,status:'SHIPPING',quantity:1}});
await p.clientRequestPackage.create({data:{requestId:r2.id,clientId:c.id,packageCode:b2.code,packageType:'BOX',items:{create:{requestItemId:r2.items[0].id,skuId:s2.id,quantity:1}}}});
await p.clientRequestBoxSelection.create({data:{requestItemId:r2.items[0].id,skuId:s2.id,boxId:b2.id,quantity:1}});
await p.systemSetting.create({data:{key:'wb-fbo-tracking:v1:'+r2.id,value:{connectionId:wbConn.id,supplyId:'789'}}});
const wbDelivery=new FboDeliverySyncService(p,{}, {remote:async()=>({statusId:4,quantity:1})},stock);
assert.equal(await wbDelivery.reconcile(r2.id),'SKIPPED');
await p.systemSetting.create({data:{key:'wb-fbo-dispatch:v1:'+r2.id,value:{at:new Date().toISOString()}}});
assert.equal(await wbDelivery.reconcile(r2.id),'DONE');
assert.equal((await p.clientRequest.findUnique({where:{id:r2.id}})).status,'DONE');passed++;
assert.equal(passed,16);
