// TEST: real creation transactions and canonical FBS demand on a disposable database only.
require('reflect-metadata');const assert=require('node:assert/strict');
assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL).hostname,'lamoda-stock-test-pg');
const {PrismaClient}=require('@prisma/client'),p=new PrismaClient();
const {LamodaService}=require('/app/apps/api/dist/modules/lamoda/lamoda.service');
const {ClientScopeService}=require('/app/apps/api/dist/modules/auth/client-scope.service');
const {lamodaStockAvailability}=require('/app/apps/api/dist/modules/lamoda/lamoda-stock-guard');
(async()=>{
 let passed=0;
 const w=await p.warehouse.create({data:{code:'TEST',name:'Test'}});
 const c=await p.client.create({data:{code:'TEST',name:'Test',stockBalanceMode:'BOXES'}});
 const u=await p.user.create({data:{email:'lamoda-stock@test.invalid',passwordHash:'disabled',name:'Test'}});
 await p.warehouseClient.create({data:{clientId:c.id,warehouseId:w.id,status:'ACTIVE'}});
 const sku=await p.sku.create({data:{clientId:c.id,internalSku:'TEST',name:'Test',barcodes:{create:{value:'12345678'}}}});
 const box=await p.box.create({data:{code:'TEST',clientId:c.id,warehouseId:w.id,status:'active'}});
 const balance=await p.stockBalance.create({data:{balanceKey:'test',clientId:c.id,warehouseId:w.id,skuId:sku.id,boxId:box.id,status:'AVAILABLE',quantity:10}});
 const user={id:u.id,roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[]};
 const service=new LamodaService(p,new ClientScopeService(),{});
 const account=await service.create({clientId:c.id,name:'Test',sellerId:'test',oauthClientId:'test',secret:'test-only',fboEnabled:true,fbsEnabled:false},user);
 await p.lamodaProduct.create({data:{accountId:account.id,name:'Test',remoteSku:'LM',externalSku:'TEST',barcode:'12345678',skuId:sku.id,isPresent:true,linkState:'CONFIRMED'}});
 let sequence=0;
 async function plan(quantity){return p.lamodaPlan.create({data:{accountId:account.id,warehouseId:w.id,title:'Test '+(++sequence),importHash:String(sequence),items:[{barcode:'12345678',quantity,article:'',destination:'Test'}]}})}
 async function create(q){const x=await plan(q);return service.createAssembly(account.id,x.id,user)}
 const fbs=await p.clientRequest.create({data:{clientId:c.id,warehouseId:w.id,type:'OUTBOUND',status:'SUBMITTED',title:'FBS',items:{create:{skuId:sku.id,barcode:'12345678',quantity:3}}},include:{items:true}});
 const task=await p.fbsTsdAssembly.create({data:{clientId:c.id,connectionId:'test',orderId:'test',requestId:fbs.id,requestItemId:fbs.items[0].id,skuId:sku.id,stockWarehouseId:w.id,productName:'Test',barcodes:['12345678'],storageBoxes:[],itemCount:3,status:'RESERVED',deviceCode:'TEST'}});
 await assert.rejects(()=>create(8),/доступно 7/);assert.equal(await p.lamodaFboAssembly.count(),0);assert.equal(await p.clientRequest.count(),1);passed++;
 const exactPlan=await plan(7),created=await service.createAssembly(account.id,exactPlan.id,user);
 assert.equal((await service.createAssembly(account.id,exactPlan.id,user)).id,created.id);assert.equal(await p.lamodaFboAssembly.count(),1);assert.equal((await p.stockBalance.findUniqueOrThrow({where:{id:balance.id}})).quantity,10);passed++;
 await assert.rejects(()=>create(1),/доступно 0/);passed++;
 await p.clientRequest.update({where:{id:created.id},data:{status:'CANCELLED'}});
 await p.stockBalance.update({where:{id:balance.id},data:{quantity:9}});
 await p.stockMovement.create({data:{clientId:c.id,warehouseId:w.id,skuId:sku.id,boxId:box.id,type:'PICK',status:'PACKING',quantity:1,sourceDocument:fbs.id,idempotencyKey:`fbs-sticker-pick:${task.id}:test`}});
 const available=await lamodaStockAvailability(p,c.id,w.id,[{skuId:sku.id,barcode:'12345678',quantity:7}]);
 assert.equal(available[0].reservedQuantity,2);assert.equal(available[0].availableQuantity,7);passed++;
 await p.fbsTsdAssembly.update({where:{id:task.id},data:{status:'CANCELLED'}});
 await p.clientRequest.update({where:{id:fbs.id},data:{status:'CANCELLED'}});
 await p.stockBalance.update({where:{id:balance.id},data:{quantity:0}});
 await assert.rejects(()=>create(1),/доступно 0/);passed++;
 await p.stockBalance.update({where:{id:balance.id},data:{quantity:10}});
 const first=await plan(7),second=await plan(7);
 // A barrier guarantees both serializable transactions have read the same initial free stock.
 let arrivals=0,release;const gate=new Promise(r=>release=r);
 const originalTransaction=p.$transaction.bind(p);
 const db=new Proxy(p,{get(target,key){if(key!=='$transaction')return target[key];return (callback,options)=>originalTransaction(async tx=>{
   const wrapped=new Proxy(tx,{get(target,key){if(key==='clientRequest')return new Proxy(target.clientRequest,{get(model,method){
     if(method==='create')return async args=>{if(++arrivals===2)release();await gate;return model.create(args)};
     return model[method];}});return target[key];}});
   return callback(wrapped);
 },options);}});
 const concurrent=new LamodaService(db,new ClientScopeService(),{});
 const outcomes=await Promise.allSettled([concurrent.createAssembly(account.id,first.id,user),concurrent.createAssembly(account.id,second.id,user)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(outcomes.map(o=>o.status==='rejected'?o.reason.message:o.value)));
 assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
 assert.equal((await p.clientRequestItem.aggregate({where:{request:{clientId:c.id,status:'SUBMITTED'}},_sum:{quantity:true}}))._sum.quantity,7);passed++;
 console.log(JSON.stringify({passed,isolated:true,concurrentRequests:2,concurrentAccepted:1}));
})().finally(()=>p.$disconnect()).catch(e=>{console.error(e.stack);process.exitCode=1});
