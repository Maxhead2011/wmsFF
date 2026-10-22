// TEST: isolated PostgreSQL only; no AppModule, scheduler or external WB calls.
const assert=require('assert/strict');assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL).hostname,'original-sticker-test-pg');
process.env.WMS_FBS_REPEAT_ASSEMBLY_ENABLED='true';process.env.WMS_FBS_ORIGINAL_STICKER_ENABLED='true';
const {PrismaClient}=require('@prisma/client'),p=new PrismaClient();
const {FbsRepeatAssemblyService}=require('/app/apps/api/dist/modules/marketplace-connections/fbs-repeat-assembly.service');
const {MarketplaceConnectionsService}=require('/app/apps/api/dist/modules/marketplace-connections/marketplace-connections.service');
const {ClientScopeService}=require('/app/apps/api/dist/modules/auth/client-scope.service');
(async()=>{
const tables=await p.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public'");await p.$executeRawUnsafe('TRUNCATE '+tables.map(t=>'"'+t.tablename.replaceAll('"','""')+'"').join(',')+' CASCADE');
const w=await p.warehouse.create({data:{code:'ORIGINAL_TEST',name:'Test'}}),c=await p.client.create({data:{code:'ORIGINAL_TEST',name:'Test'}}),u=await p.user.create({data:{email:'original@test.invalid',passwordHash:'disabled',name:'Test'}});
const s=await p.sku.create({data:{clientId:c.id,internalSku:'TEST',name:'Test',barcodes:{create:{value:'2000000000001'}}}}),b=await p.box.create({data:{clientId:c.id,warehouseId:w.id,code:'ORIGINAL_TEST_BOX'}});
const pallet=await p.storagePallet.create({data:{clientId:c.id,warehouseId:w.id,code:'ORIGINAL_TEST_PALLET'}});await p.storagePalletBox.create({data:{palletId:pallet.id,boxCode:b.code}});
await p.stockBalance.create({data:{clientId:c.id,warehouseId:w.id,skuId:s.id,boxId:b.id,balanceKey:'test',status:'AVAILABLE',quantity:2}});
const conn=await p.clientMarketplaceConnection.create({data:{clientId:c.id,marketplace:'WILDBERRIES',apiKey:'TEST-NOT-REAL'}});
const r=await p.clientRequest.create({data:{clientId:c.id,warehouseId:w.id,type:'OUTBOUND',status:'DONE',title:'Old',items:{create:{skuId:s.id,name:'Test',quantity:1}}},include:{items:true}});
const label={partA:'5908010',partB:'9672',barcode:'*DcFy7mhD',imageBase64:'iVBORw0KGgoAAA=='};
const old=await p.fbsTsdAssembly.create({data:{clientId:c.id,connectionId:conn.id,orderId:'6049802274',requestId:r.id,requestItemId:r.items[0].id,skuId:s.id,productName:'Test',barcodes:['2000000000001'],storageBoxes:[],requiresKiz:true,kiz:'OLD-KIZ',wbMetaStatus:'ACCEPTED',barcode:'2000000000001',status:'COMPLETED',deviceCode:'test',completedAt:new Date(),stickerPartA:label.partA,stickerPartB:label.partB,stickerBarcode:label.barcode}});
await p.fbsOrderRequestLink.create({data:{clientId:c.id,connectionId:conn.id,orderId:old.orderId,marketplace:'WILDBERRIES',requestId:r.id}});
const user={id:u.id,name:u.name,email:u.email,roleCodes:['ADMIN'],permissionCodes:['clients:write'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:w.id,writableWarehouseIds:[w.id]};
const scope=new ClientScopeService(),connections=new MarketplaceConnectionsService(p,scope,undefined,undefined,new (require('/app/apps/api/dist/common/boxes/box-code-policy.service').BoxCodePolicyService)(new (require('/app/apps/api/dist/common/settings/system-settings.service').SystemSettingsService)(p)));
connections.readRepeatAssemblyWbStatuses=async()=>new Map([[old.orderId,{supplierStatus:'complete',wbStatus:'waiting'}]]);connections.readOriginalRepeatSticker=async()=>label;
const service=new FbsRepeatAssemblyService(p,scope,connections),preview=await service.lookupOriginal({clientId:c.id,orderId:old.orderId},user),dto={...preview.selection,previewToken:preview.previewToken,confirmAdditionalStockConsumption:true};
const [a,z]=await Promise.all([service.create(dto,user),service.create(dto,user)]);assert.equal(a.request.id,z.request.id);assert.equal(a.request.priority,'HIGH');assert.equal(await p.fbsRepeatAssemblyRun.count(),1);
const task=await p.fbsTsdAssembly.findFirstOrThrow({where:{requestId:a.request.id}});assert.notEqual(task.id,old.id);assert.equal(task.kiz,null);assert.equal(task.barcode,null);assert.equal(task.stickerBarcode,null);
assert.equal((await p.stockBalance.aggregate({where:{status:'AVAILABLE'},_sum:{quantity:true}}))._sum.quantity,2);assert.equal((await p.fbsAssemblyAttemptHistory.findUniqueOrThrow({where:{id:old.id}})).kiz,'OLD-KIZ');
const printed=await connections.loadFbsTsdOrderSticker(task);assert.equal(printed.barcode,label.barcode);assert.equal(printed.imageBase64,label.imageBase64);
await p.productMark.create({data:{clientId:c.id,skuId:s.id,boxId:b.id,value:'NEW-KIZ'}});
const picked={...task,boxId:b.id,boxCode:b.code,barcode:'2000000000001',kiz:'NEW-KIZ'};
await p.$transaction(tx=>connections.reserveCompletedWildberriesStock(tx,picked,w.id));await p.$transaction(tx=>connections.reserveCompletedWildberriesStock(tx,picked,w.id));
assert.equal((await p.stockBalance.aggregate({where:{status:'AVAILABLE'},_sum:{quantity:true}}))._sum.quantity,1);assert.equal((await p.productMark.findFirstOrThrow({where:{value:'NEW-KIZ'}})).status,'PACKING');
assert.equal((await p.fbsAssemblyAttemptHistory.findUniqueOrThrow({where:{id:old.id}})).kiz,'OLD-KIZ');
assert.equal(service.capabilities({...user,roleCodes:['WORKER']}).originalStickerEnabled,false);
console.log(JSON.stringify({passed:8,concurrentCreate:true,originalLabel:true,newKiz:true,stockConsumedOnce:true,productionChanged:false}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());

