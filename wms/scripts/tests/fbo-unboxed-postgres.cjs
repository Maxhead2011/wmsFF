// TEST: isolated PostgreSQL, actual candidate transactions, reserves, replay and destination packing.
require('reflect-metadata');const assert=require('assert/strict'),{randomUUID}=require('crypto'),path=require('path');
const {PrismaClient}=require('../../apps/api/node_modules/@prisma/client');
const Module=require('module'),load=Module._load,prismaRuntime=require('../../apps/api/node_modules/@prisma/client');
Module._load=function(n,...args){return n==='@prisma/client'?prismaRuntime:load.call(this,n,...args);};
const root=path.resolve(process.argv[2]),{FboTwoStageService:S}=require(root+'/modules/tsd/fbo-two-stage.service'),{StockBalancesService:B}=require(root+'/modules/stock/stock-balances.service');
const db=new PrismaClient({datasources:{db:{url:'postgresql://codex_tests@127.0.0.1:55478/postgres?schema=ozon_product_test'}}});
for(const f of ['WMS_FBO_TWO_STAGE_ENABLED','WMS_FBO_UNBOXED_PICK_ENABLED','WMS_OZON_FBO_IMPORT_ENABLED','WMS_OZON_PACK_BY_PRODUCT_ENABLED','WMS_FBO_PARALLEL_PACKING_ENABLED'])process.env[f]='true';
(async()=>{const[c,w,u,s,r,other,i]=Array.from({length:7},()=>randomUUID()),code='FFL_TEST_'+randomUUID().replaceAll('-','');
 const user={id:u,name:'TEST',permissionCodes:['system:admin'],roleCodes:['OWNER'],activeWarehouseId:w};
 const svc=new S(db,{requireClientAccess(){}},new B(db),{},{assertStockMovementsAllowed:async()=>{}},{});
 // Local fixture omits unrelated production split-request relations; stock and transactions are real.
 svc.load=async(tx,id)=>({...await tx.clientRequest.findUniqueOrThrow({where:{id},include:{items:{include:{sku:{include:{barcodes:true}}}},client:true,_count:{select:{fbsOrderLinks:true,packages:true}},pickWaveRequests:{include:{wave:true}}}}),parentRequest:null,childRequests:[]});
 try{
  await db.client.create({data:{id:c,code:c,name:'TEST',storesWithoutBoxes:true}});await db.warehouse.create({data:{id:w,code:w,name:'TEST'}});await db.user.create({data:{id:u,email:u+'@invalid',name:'TEST',passwordHash:'test'}});
  await db.sku.create({data:{id:s,clientId:c,internalSku:s,name:'TEST',barcodes:{create:{value:'12345678'}}}});
  for(const id of [r,other])await db.clientRequest.create({data:{id,clientId:c,warehouseId:w,type:'OUTBOUND',status:'SUBMITTED',title:'TEST',items:{create:{...(id===r?{id:i}:{}),skuId:s,barcode:'12345678',quantity:id===r?2:1}}}});
  await db.ozonFboShipment.create({data:{requestId:r,importKey:r,directions:[{name:'Москва',items:[{skuId:s,barcode:'12345678',quantity:2}]}]}});
  const dims={clientId:c,warehouseId:w,skuId:s,boxId:null,palletId:null,status:'AVAILABLE'};await db.stockBalance.create({data:{...dims,balanceKey:new B(db).balanceKey(dims),quantity:2}});
  const before=await svc.plan(r,user);assert.equal(before.unboxedPickingSupported,true);assert.equal(before.shortage,1);assert.deepEqual(before.route,[]);
  await svc.executeAction(r,{action:'START',operationId:'start'},user);
  const pick={action:'PICK_UNIT',operationId:'one',barcode:'12345678'};
  const concurrent=await Promise.allSettled([svc.executeAction(r,pick,user),svc.executeAction(r,{...pick,operationId:'two'},user)]);
  assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1,JSON.stringify(concurrent));
  const winner=concurrent[0].status==='fulfilled'?pick:{...pick,operationId:'two'};await svc.executeAction(r,winner,user);
  assert.equal(await db.fboAssemblyUnit.count({where:{requestId:r}}),1);assert.equal((await db.stockBalance.findFirst({where:{clientId:c,boxId:null,status:'AVAILABLE'}})).quantity,1);
  await db.clientRequest.update({where:{id:other},data:{status:'CANCELLED'}});await svc.executeAction(r,{...pick,operationId:'last'},user);
  await svc.executeAction(r,{action:'FINISH_PICK',operationId:'finish'},user);
  await assert.rejects(()=>svc.executeAction(r,{action:'PACK_PRODUCT',operationId:'wrong',targetBoxCode:code,direction:'Уфа',barcode:'12345678'},user),/направлен/);
  assert.equal(await db.box.count({where:{code}}),0);
  for(const n of [1,2])await svc.executeAction(r,{action:'PACK_PRODUCT',operationId:'pack'+n,targetBoxCode:code,direction:'Москва',barcode:'12345678'},user);
  await svc.executeAction(r,{action:'CLOSE_BOX',operationId:'close',targetBoxCode:code},user);
  const result=await svc.plan(r,user);assert.equal(result.picked,2);assert.equal(result.packed,2);assert.equal(result.boxes[0].closed,true);
  assert.ok((await db.fboAssemblyUnit.findMany({where:{requestId:r}})).every(x=>x.sourceBoxId===''&&x.sourceBoxCode===''));
  console.log(JSON.stringify({passed:true,concurrentReserveGuard:true,replay:true,noSourceBox:true,packing:true,wrongDirectionRollback:true}));
 }finally{
  await db.auditLog.deleteMany({where:{userId:u}});for(const m of ['fboAssemblyAction','fboAssemblyUnit','fboAssemblyBox','fboAssembly','ozonFboShipment'])await db[m].deleteMany({where:{requestId:r}});
  await db.clientRequestItem.deleteMany({where:{requestId:{in:[r,other]}}});await db.clientRequest.deleteMany({where:{id:{in:[r,other]}}});
  for(const m of ['productMark','stockBalance','stockMovement','box'])await db[m].deleteMany({where:{clientId:c}});await db.barcode.deleteMany({where:{skuId:s}});await db.sku.deleteMany({where:{clientId:c}});
  await db.user.deleteMany({where:{id:u}});await db.warehouse.deleteMany({where:{id:w}});await db.client.deleteMany({where:{id:c}});await db.$disconnect();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
