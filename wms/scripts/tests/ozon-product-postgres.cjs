// TEST: real candidate transactions, locks, stock movements, replay and rollback.
// Prepare current Prisma schema only on this isolated localhost database.
require('reflect-metadata');
const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),path=require('node:path');
const {PrismaClient}=require('../../apps/api/node_modules/@prisma/client');
const root=path.resolve(process.argv[2]);
const {FboTwoStageService:S}=require(path.join(root,'modules/tsd/fbo-two-stage.service'));
const {StockBalancesService:B}=require(path.join(root,'modules/stock/stock-balances.service'));
const db=new PrismaClient({datasources:{db:{url:'postgresql://codex_tests@127.0.0.1:55478/postgres?schema=ozon_product_test'}}});
for(const flag of ['WMS_FBO_TWO_STAGE_ENABLED','WMS_OZON_FBO_IMPORT_ENABLED','WMS_FBO_PARALLEL_PACKING_ENABLED','WMS_OZON_PACK_BY_PRODUCT_ENABLED'])process.env[flag]='true';
const testUndo=process.argv.includes('--undo');
if(testUndo)process.env.WMS_FBO_PACK_UNDO_ENABLED='true';
(async()=>{
 const [c,w,u,s,r,i,h]=Array.from({length:7},()=>randomUUID());
 const code='FFL_TEST_'+randomUUID().replaceAll('-','');
 const user={id:u,name:'TEST'};
 const service=(client=db)=>{
  const svc=new S(client,{},new B(client),{},{assertStockMovementsAllowed:async()=>{}},{});
  // Access context is a fixture; transaction, locks, quota and physical mutations are real.
  svc.load=(tx,id)=>tx.clientRequest.findUniqueOrThrow({where:{id},include:{items:{include:{sku:true}},client:true}});
  svc.requireFbo=()=>{};
  return svc;
 };
 try{
  await db.client.create({data:{id:c,code:c,name:'TEST'}});
  await db.warehouse.create({data:{id:w,code:w,name:'TEST'}});
  await db.user.create({data:{id:u,name:'TEST',email:u+'@invalid',passwordHash:'test'}});
  await db.sku.create({data:{id:s,clientId:c,internalSku:s,name:'TEST'}});
  await db.clientRequest.create({data:{id:r,clientId:c,warehouseId:w,type:'OUTBOUND',status:'IN_WORK',title:'TEST',items:{create:{id:i,skuId:s,barcode:'123',quantity:3}}}});
  await db.box.create({data:{id:h,code:'FBO-PICK-'+r,clientId:c,warehouseId:w}});
  await db.fboAssembly.create({data:{requestId:r,phase:'PICKING',compositionHash:createHash('sha256').update(JSON.stringify([[i,s,'123',3]])).digest('hex')}});
  await db.ozonFboShipment.create({data:{requestId:r,importKey:r,directions:[{name:'Краснодар',items:[{skuId:s,barcode:'123',quantity:1}]},{name:'Москва',items:[{skuId:s,barcode:'123',quantity:2}]}]}});
  await db.fboAssemblyUnit.createMany({data:[1,2,3].map(()=>({requestId:r,requestItemId:i,skuId:s,barcode:'123',sourceBoxId:h,sourceBoxCode:'FBO-PICK-'+r,pickedByUserId:u}))});
  const dims={clientId:c,warehouseId:w,skuId:s,boxId:h,status:'PACKING'};
  await db.stockBalance.create({data:{...dims,balanceKey:new B(db).balanceKey(dims),quantity:3}});
  const svc=service(),dto=(op,direction,targetBoxCode)=>({action:'PACK_PRODUCT',operationId:op,barcode:'123',direction,targetBoxCode});
  const a=dto('one','Краснодар',code+'1'),b=dto('two','Краснодар',code+'2');
  const results=await Promise.allSettled([svc.executeAction(r,a,user),svc.executeAction(r,b,user)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1,JSON.stringify(results));
  assert.match(results.find(x=>x.status==='rejected').reason.message,/направлен|количеств|лимит|Обновите/);
  assert.equal(await db.fboAssemblyUnit.count({where:{requestId:r,state:'PACKED'}}),1);
  assert.equal(await db.fboAssemblyBox.count({where:{requestId:r}}),1);
  assert.equal(await db.stockMovement.count({where:{clientId:c}}),2);
  const winner=results[0].status==='fulfilled'?a:b;
  await svc.executeAction(r,winner,user);
  assert.equal(await db.stockMovement.count({where:{clientId:c}}),2);
  const failing=new Proxy(db,{get(target,key){
   if(key==='$transaction')return (fn,options)=>db.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return new Proxy(t[k],{get(a,m){if(m==='create')return async()=>{throw Error('TEST audit failure');};return a[m];}});return t[k];}})),options);
   return target[key];
  }});
  await assert.rejects(()=>service(failing).executeAction(r,dto('rollback','Москва',code+'3'),user),/TEST audit failure/);
  assert.equal(await db.box.count({where:{code:code+'3'}}),0);
  assert.equal(await db.fboAssemblyAction.count({where:{requestId:r}}),1);
  assert.equal(await db.stockMovement.count({where:{clientId:c}}),2);
  assert.equal((await db.stockBalance.aggregate({where:{boxId:h},_sum:{quantity:true}}))._sum.quantity,2);
  await svc.executeAction(r,dto('three','Москва',code+'3'),user);
  assert.equal(await db.fboAssemblyUnit.count({where:{requestId:r,state:'PACKED'}}),2);
  assert.equal(await db.stockMovement.count({where:{clientId:c}}),4);
  // TEST: undo, replay and concurrent requests operate on the exact receipt in real PostgreSQL.
  if(testUndo){
   const undo={action:'UNDO_PACK_UNIT',operationId:'undo-three',undoOperationId:'three'};
   await assert.rejects(()=>service(failing).executeAction(r,undo,user),/TEST audit failure/);
   assert.equal(await db.fboAssemblyUnit.count({where:{requestId:r,state:'PACKED'}}),2);
   assert.equal(await db.stockMovement.count({where:{clientId:c}}),4);
   const undone=await Promise.allSettled([svc.executeAction(r,undo,user),svc.executeAction(r,{...undo,operationId:'competing-undo'},user)]);
   assert.equal(undone.filter(x=>x.status==='fulfilled').length,1);
   const successful=undone[0].status==='fulfilled'?undo:{...undo,operationId:'competing-undo'};
   await svc.executeAction(r,successful,user);
   await assert.rejects(()=>svc.executeAction(r,{...successful,undoOperationId:winner.operationId},user),/Номер операции/);
   assert.equal(await db.stockMovement.count({where:{clientId:c}}),6);
   assert.equal(await db.fboAssemblyUnit.count({where:{requestId:r,state:'PACKED'}}),1);
   assert.equal((await db.stockBalance.aggregate({where:{boxId:h},_sum:{quantity:true}}))._sum.quantity,2);
   await assert.rejects(()=>svc.executeAction(r,{...undo,operationId:'older',undoOperationId:winner.operationId},user),/последнюю/);
   await svc.executeAction(r,dto('repacked','Москва',code+'3'),user);
   await assert.rejects(()=>svc.executeAction(r,{...undo,operationId:'stale'},user),/изменилась/);
   // TEST: marked-unit return updates its physical KIZ and rolls back on mark-location mismatch.
   const parcel=await db.fboAssemblyBox.findUnique({where:{requestId_boxCode:{requestId:r,boxCode:code+'3'}}});
   await db.fboAssemblyBox.update({where:{id:parcel.id},data:{closedAt:null}});
   const marked=await db.fboAssemblyUnit.findFirst({where:{requestId:r,targetBoxId:parcel.boxId,state:'PACKED'}});
   const mark=await db.productMark.create({data:{clientId:c,skuId:s,value:'TEST-'+randomUUID(),status:'PACKING',boxId:h}});
   await db.fboAssemblyUnit.update({where:{id:marked.id},data:{markId:mark.id,activeMarkId:mark.id}});
   const count=await db.stockMovement.count({where:{clientId:c}});
   await assert.rejects(()=>svc.executeAction(r,{...undo,operationId:'wrong-mark',undoOperationId:'repacked'},user),/КИЗ перемещён/);
   assert.equal(await db.stockMovement.count({where:{clientId:c}}),count);
   await db.productMark.update({where:{id:mark.id},data:{boxId:parcel.boxId}});
   await svc.executeAction(r,{...undo,operationId:'marked-undo',undoOperationId:'repacked'},user);
   assert.equal((await db.productMark.findUnique({where:{id:mark.id}})).boxId,h);
   await svc.executeAction(r,dto('final-pack','Москва',code+'3'),user);
   await svc.executeAction(r,{action:'CLOSE_BOX',operationId:'close',targetBoxCode:code+'3'},user);
   await assert.rejects(()=>svc.executeAction(r,{...undo,operationId:'closed',undoOperationId:'final-pack'},user),/открытом/);
   console.log(JSON.stringify({undoPassed:true,concurrentUndo:true,replay:true,rollback:true,closedAndOlderRejected:true,markReturn:true}));
  }
  console.log(JSON.stringify({passed:true,postgresConcurrency:true,idempotency:true,atomicRollback:true,realStockMovements:true,accessContextFixture:true}));
 }finally{
  await db.auditLog.deleteMany({where:{userId:u}});
  for(const model of ['fboAssemblyAction','fboAssemblyUnit','fboAssemblyBox','fboAssembly','ozonFboShipment'])await db[model].deleteMany({where:{requestId:r}});
  await db.clientRequestItem.deleteMany({where:{requestId:r}});await db.clientRequest.deleteMany({where:{id:r}});
  for(const model of ['productMark','stockBalance','stockMovement','box','sku'])await db[model].deleteMany({where:{clientId:c}});
  await db.user.deleteMany({where:{id:u}});await db.warehouse.deleteMany({where:{id:w}});await db.client.deleteMany({where:{id:c}});await db.$disconnect();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
