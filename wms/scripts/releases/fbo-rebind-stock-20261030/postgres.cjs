// TEST: published runtime plus exact two-module candidate, disposable PostgreSQL only.
require('reflect-metadata');const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'fbo-rebind-stock-test-pg');
Object.assign(process.env,{WMS_FBO_TWO_STAGE_ENABLED:'true',WMS_KIZ_CLIENT_GUARD_ENABLED:'true'});
const{PrismaClient}=require('@prisma/client'),p=new PrismaClient(),dir='/app/apps/api/dist/';
const{FboTwoStageService}=require(dir+'modules/tsd/fbo-two-stage.service'),{ClientScopeService}=require(dir+'modules/auth/client-scope.service'),{StockBalancesService}=require(dir+'modules/stock/stock-balances.service'),{StockOperationsService}=require(dir+'modules/stock/stock-operations.service'),{ClientRequestMarketplaceFilesService}=require(dir+'modules/client-requests/client-request-marketplace-files.service');
const guard=require(dir+'common/kiz-client-review'),registry=require(dir+'common/kiz-client-registry');
(async()=>{let passed=0;const wh=await p.warehouse.create({data:{code:'TEST',name:'Test'}}),c=await p.client.create({data:{code:'TEST',name:'Test'}}),actor=await p.user.create({data:{name:'Worker',email:'worker@test.invalid',passwordHash:'disabled'}});await p.warehouseClient.create({data:{warehouseId:wh.id,clientId:c.id,status:'ACTIVE'}});
const sku=await p.sku.create({data:{clientId:c.id,internalSku:'TEST',name:'Test',needsChestnyZnak:true,barcodes:{create:{value:'2050000000000'}}}});
const user={id:actor.id,name:actor.name,roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:wh.id};
const scopes=new ClientScopeService(),balances=new StockBalancesService(p,scopes),stock=new StockOperationsService(p,scopes,balances,undefined,undefined,undefined,new(require(dir+'common/boxes/box-code-policy.service').BoxCodePolicyService)(new(require(dir+'common/settings/system-settings.service').SystemSettingsService)(p))),files=new ClientRequestMarketplaceFilesService(p,scopes),svc=new FboTwoStageService(p,scopes,balances,stock,{assertStockMovementsAllowed:async()=>{}},files);
const id=randomUUID(),line=randomUUID(),units=[],boxes=[],marks=[];
for(let b=0;b<57;b++)boxes.push({id:randomUUID(),code:'FFL_TEST_'+b,clientId:c.id,warehouseId:wh.id});
await p.box.createMany({data:boxes});
await p.clientRequest.create({data:{id,clientId:c.id,warehouseId:wh.id,type:'OUTBOUND',status:'IN_WORK',title:'Test578',items:{create:{id:line,skuId:sku.id,barcode:'2050000000000',quantity:578}}}});
await p.fboAssembly.create({data:{requestId:id,phase:'CONTROL',compositionHash:createHash('sha256').update(JSON.stringify([[line,sku.id,'2050000000000',578]])).digest('hex')}});
for(let n=0;n<578;n++){const box=boxes[n%57],mark={id:randomUUID(),clientId:c.id,skuId:sku.id,boxId:box.id,status:'PACKING',value:'010460000000000121'+String(n).padStart(13,'A')};marks.push(mark);units.push({id:randomUUID(),requestId:id,requestItemId:line,skuId:sku.id,barcode:'2050000000000',markId:mark.id,activeMarkId:mark.id,kiz:mark.value,sourceBoxId:box.id,sourceBoxCode:box.code,targetBoxId:box.id,targetBoxCode:box.code,wholeBox:false,state:'PACKED',pickedByUserId:actor.id,packedByUserId:actor.id,packedAt:new Date()});}
await p.productMark.createMany({data:marks});await p.fboAssemblyUnit.createMany({data:units});
await p.stockBalance.createMany({data:boxes.map(b=>({balanceKey:randomUUID(),clientId:c.id,warehouseId:wh.id,skuId:sku.id,boxId:b.id,status:'PACKING',quantity:units.filter(u=>u.targetBoxId===b.id).length}))});
await p.fboAssemblyBox.createMany({data:boxes.map(b=>({requestId:id,boxId:b.id,activeBoxId:b.id,boxCode:b.code,closedAt:new Date(),confirmedAt:new Date(),confirmedByUserId:actor.id}))});
const r=await p.clientRequest.findUniqueOrThrow({where:{id}}),check=()=>p.$transaction(tx=>guard.assertClientRequestKizShipment(tx,r,user),{timeout:60000,isolationLevel:'Serializable'});
// Duplicate mark in the same client must abort all claims.
const dup=await p.productMark.create({data:{...marks[0],id:randomUUID(),value:']d2'+marks[0].value}});await assert.rejects(check,/ОТЛОЖИТЕ/);assert.equal(await p.kizReviewCase.count(),0);await p.productMark.delete({where:{id:dup.id}});passed++;
const input={scope:'FBO',clientId:c.id,warehouseId:wh.id,requestId:id,kiz:marks[0].value,skuId:sku.id,boxId:boxes[0].id};
const review=await p.kizReviewCase.create({data:{clientId:c.id,warehouseId:wh.id,requestId:id,taskId:guard.clientUseTaskKey(input),kiz:input.kiz,kizIdentity:registry.clientKizIdentity(input.kiz),context:guard.clientUseContext(input),status:'OPEN',decision:'REVIEW',snapshot:{},evidence:{}}});await assert.rejects(check,/ОТЛОЖИТЕ/);await p.kizReviewCase.delete({where:{id:review.id}});passed++;
const h=await p.shippedKizHistory.create({data:{assemblyId:randomUUID(),clientId:c.id,clientName:'Test',requestId:'previous',requestNumber:1,requestTitle:'Previous',orderId:'WB-OLD',warehouseId:wh.id,skuId:sku.id,internalSku:'TEST',productName:'Test',kiz:marks[0].value,shippedAt:new Date('2026-10-01')}});await assert.rejects(check,/WB-OLD/);await p.shippedKizHistory.delete({where:{id:h.id}});passed++;
const fbs=await p.fbsTsdAssembly.create({data:{clientId:c.id,connectionId:randomUUID(),orderId:'OTHER',requestId:id,requestItemId:line,skuId:sku.id,productName:'Test',barcodes:[],storageBoxes:[],deviceCode:'TSD',status:'IN_PROGRESS',boxId:boxes[0].id,kiz:marks[0].value}});await assert.rejects(check,/другой сборкой/);await p.fbsTsdAssembly.delete({where:{id:fbs.id}});passed++;
// The lock is identical to the single receipt/use lock and lives until transaction end.
let unlock,locked;const barrier=new Promise(resolve=>locked=resolve);const hold=p.$transaction(async tx=>{await registry.lockClientKiz(tx,c.id,registry.clientKizIdentity(marks[0].value));locked();await new Promise(resolve=>unlock=resolve)},{timeout:60000});await barrier;
let completed=false;const waiting=check().then(()=>completed=true);await new Promise(resolve=>setTimeout(resolve,150));assert.equal(completed,false);unlock();await hold;await waiting;assert.equal(completed,true);passed++;
assert.equal(await p.kizReviewCase.count({where:{requestId:id,status:'CLAIMED'}}),578);passed++;
// TEST: real persisted stock exists without target KIZ links.
const reuse=require(dir+'modules/tsd/fbo-rebind-stock').reuseCountedFboStock;
await p.productMark.updateMany({where:{boxId:boxes[0].id},data:{status:'AVAILABLE'}});
await p.stockBalance.updateMany({where:{boxId:boxes[0].id},data:{status:'AVAILABLE'}});
assert.equal(await reuse(p,r,sku.id,boxes[0].id,{boxId:'other',status:'AVAILABLE'},{quantity:11}),false);
await p.stockBalance.updateMany({where:{boxId:boxes[0].id},data:{quantity:{increment:1}}});
assert.equal(await reuse(p,r,sku.id,boxes[0].id,{boxId:'other',status:'AVAILABLE'},{quantity:12}),true);
await p.stockBalance.updateMany({where:{boxId:boxes[0].id},data:{quantity:{decrement:1}}});
await p.productMark.updateMany({where:{boxId:boxes[0].id},data:{status:'PACKING'}});
await p.stockBalance.updateMany({where:{boxId:boxes[0].id},data:{status:'PACKING'}});
const start=Date.now(),dto={action:'FINISH',operationId:randomUUID()};await svc.act(id,dto,user);const elapsedMs=Date.now()-start;
assert.equal((await p.fboAssembly.findUniqueOrThrow({where:{requestId:id}})).phase,'COMPLETED');assert.equal(await p.clientRequestPackage.count({where:{requestId:id}}),57);passed++;
const movementCount=await p.stockMovement.count();await svc.act(id,dto,user);assert.equal(await p.stockMovement.count(),movementCount);passed++;
for(const kind of ['products','packages']){const file=await svc.wbFile(id,user,kind);const buffer=file.buffer??file.content??file.data;assert(buffer?.length>0);console.log(JSON.stringify({kind,bytes:buffer.length}));}passed++;
assert.equal(await p.productMark.count({where:{clientId:c.id,status:'SHIPPING'}}),578);assert.equal(await p.kizReviewCase.count({where:{requestId:id}}),578);
console.log(JSON.stringify({passed,elapsedMs,units:578,boxes:57,complete:true,retrySafe:true}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());
