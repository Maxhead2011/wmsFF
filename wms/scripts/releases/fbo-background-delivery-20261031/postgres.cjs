// TEST: published runtime plus exact two-module candidate, disposable PostgreSQL only.
require('reflect-metadata');const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'fbo-background-delivery-test-pg');
Object.assign(process.env,{WMS_FBO_TWO_STAGE_ENABLED:'true',WMS_KIZ_CLIENT_GUARD_ENABLED:'true',WMS_KIZ_SHIPMENT_PREFIX_ENABLED:'true',WMS_FBO_COMPLETION_RELIABILITY_ENABLED:process.env.TEST_LEGACY==='true'?'false':'true'});
const{PrismaClient}=require('@prisma/client'),p=new PrismaClient(),dir='/app/apps/api/dist/';
const{FboTwoStageService}=require(dir+'modules/tsd/fbo-two-stage.service'),{ClientScopeService}=require(dir+'modules/auth/client-scope.service'),{StockBalancesService}=require(dir+'modules/stock/stock-balances.service'),{StockOperationsService}=require(dir+'modules/stock/stock-operations.service'),{ClientRequestMarketplaceFilesService}=require(dir+'modules/client-requests/client-request-marketplace-files.service');
const guard=require(dir+'common/kiz-client-review'),registry=require(dir+'common/kiz-client-registry');
(async()=>{let passed=0;const wh=await p.warehouse.create({data:{code:'TEST',name:'Test'}}),c=await p.client.create({data:{code:'TEST',name:'Test'}}),actor=await p.user.create({data:{name:'Worker',email:'worker@test.invalid',passwordHash:'disabled'}});await p.warehouseClient.create({data:{warehouseId:wh.id,clientId:c.id,status:'ACTIVE'}});
const sku=await p.sku.create({data:{clientId:c.id,internalSku:'TEST',name:'Test',needsChestnyZnak:true,barcodes:{create:{value:'2050000000000'}}}});
const user={id:actor.id,name:actor.name,roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:wh.id};
const scopes=new ClientScopeService(),balances=new StockBalancesService(p,scopes),stock=new StockOperationsService(p,scopes,balances,undefined,undefined,undefined,new(require(dir+'common/boxes/box-code-policy.service').BoxCodePolicyService)(new(require(dir+'common/settings/system-settings.service').SystemSettingsService)(p))),files=new ClientRequestMarketplaceFilesService(p,scopes),svc=new FboTwoStageService(p,scopes,balances,stock,{assertStockMovementsAllowed:async()=>{}},files);
const id=randomUUID(),line=randomUUID(),units=[],boxes=[],marks=[];
for(let b=0;b<159;b++)boxes.push({id:randomUUID(),code:'FFL_TEST_'+b,clientId:c.id,warehouseId:wh.id});
await p.box.createMany({data:boxes});
await p.clientRequest.create({data:{id,clientId:c.id,warehouseId:wh.id,type:'OUTBOUND',status:'IN_WORK',title:'Test1710',items:{create:{id:line,skuId:sku.id,barcode:'2050000000000',quantity:1710}}}});
await p.fboAssembly.create({data:{requestId:id,phase:'CONTROL',compositionHash:createHash('sha256').update(JSON.stringify([[line,sku.id,'2050000000000',1710]])).digest('hex')}});
for(let n=0;n<1710;n++){const box=boxes[n%159],mark={id:randomUUID(),clientId:c.id,skuId:sku.id,boxId:box.id,status:'PACKING',value:'010460000000000121'+String(n).padStart(13,'A')};marks.push(mark);units.push({id:randomUUID(),requestId:id,requestItemId:line,skuId:sku.id,barcode:'2050000000000',markId:mark.id,activeMarkId:mark.id,kiz:mark.value,sourceBoxId:box.id,sourceBoxCode:box.code,targetBoxId:box.id,targetBoxCode:box.code,wholeBox:false,state:'PACKED',pickedByUserId:actor.id,packedByUserId:actor.id,packedAt:new Date()});}
await p.productMark.createMany({data:marks});await p.fboAssemblyUnit.createMany({data:units});
await p.stockBalance.createMany({data:boxes.map(b=>({balanceKey:randomUUID(),clientId:c.id,warehouseId:wh.id,skuId:sku.id,boxId:b.id,status:'PACKING',quantity:units.filter(u=>u.targetBoxId===b.id).length}))});
await p.fboAssemblyBox.createMany({data:boxes.map(b=>({requestId:id,boxId:b.id,activeBoxId:b.id,boxCode:b.code,closedAt:new Date(),confirmedAt:new Date(),confirmedByUserId:actor.id}))});
// TEST: regression fails on legacy FINISH, which writes one selection per carton.
let selectionCreates=0,selectionBatches=0;const transaction=p.$transaction.bind(p);
p.$transaction=(fn,options)=>transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k!=='clientRequestBoxSelection')return t[k];return new Proxy(t[k],{get(m,f){if(f==='create')return (...args)=>{selectionCreates++;return m.create(...args)};if(f==='createMany')return (...args)=>{selectionBatches++;return m.createMany(...args)};return m[f]}})}})),options);
const start=Date.now(),dto={action:'FINISH',operationId:randomUUID()};await svc.act(id,dto,user);const elapsedMs=Date.now()-start;
assert.equal((await p.fboAssembly.findUniqueOrThrow({where:{requestId:id}})).phase,'COMPLETED');assert.equal(await p.clientRequestPackage.count({where:{requestId:id}}),159);passed++;
assert.equal(selectionCreates,0);assert.equal(selectionBatches,1);
const movementCount=await p.stockMovement.count();await svc.act(id,dto,user);assert.equal(await p.stockMovement.count(),movementCount);passed++;
for(const kind of ['products','packages']){const file=await svc.wbFile(id,user,kind);const buffer=file.buffer??file.content??file.data;assert(buffer?.length>0);console.log(JSON.stringify({kind,bytes:buffer.length}));}passed++;
assert.equal(await p.productMark.count({where:{clientId:c.id,status:'SHIPPING'}}),1710);assert.equal(await p.kizReviewCase.count({where:{requestId:id}}),1710);
// TEST: appended to the isolated completion fixture; no real marketplace HTTP.
process.env.WMS_FBO_DELIVERY_SYNC_ENABLED='true';
stock.archivedEmptyBoxDetach=new(require(dir+'common/boxes/archived-empty-box-pallet-detach.service').ArchivedEmptyBoxPalletDetachService)(p,stock.boxCodes);
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
assert.equal(passed,9);

console.log(JSON.stringify({passed,elapsedMs,units:1710,boxes:159,complete:true,retrySafe:true}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());

