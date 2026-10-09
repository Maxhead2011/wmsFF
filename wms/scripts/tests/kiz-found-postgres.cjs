// TEST: actual candidate runtime, isolated local PostgreSQL, real locks and rollback.
const assert=require('assert/strict'),{randomUUID}=require('crypto'),path=require('path');
const root=process.argv[2];const {PrismaClient}=require(path.join(root,'client'));
const {KizFoundReview}=require(path.join(root,'api/modules/inventory/kiz-found-review'));
const url='postgresql://codex_tests@127.0.0.1:55469/kiz_duplicate_tests?schema=kiz_found_review';
const db=new PrismaClient({datasources:{db:{url}}});process.env.WMS_KIZ_FOUND_REVIEW_ENABLED='true';
(async()=>{
 const [c,w,u,s,b,m]=Array.from({length:6},()=>randomUUID());const serial='01'+'04640569959539'+'21'+'5'+randomUUID().replaceAll('-','').slice(0,12);
 const user={id:u,name:'Test',roleCodes:['ADMIN'],permissionCodes:[],activeWarehouseId:w,warehouseIds:[w],writableWarehouseIds:[w]};
 const clients={resolveClientFilter:()=>c,requireClientAccess(){}};const evidence={decision:'REVIEW',orders:[],history:[],checkedAt:new Date().toISOString()};
 const service=new KizFoundReview(db,clients,async()=>evidence);let row;
 try{
  await db.client.create({data:{id:c,code:c,name:'TEST found'}});await db.warehouse.create({data:{id:w,code:w,name:'TEST'}});await db.user.create({data:{id:u,name:'Test',email:u+'@invalid',passwordHash:'test'}});
  await db.sku.create({data:{id:s,clientId:c,internalSku:s,name:'Test'}});await db.box.create({data:{id:b,code:b,clientId:c,warehouseId:w}});
  const receipt=await db.stockMovement.create({data:{clientId:c,warehouseId:w,skuId:s,type:'RECEIPT',status:'AVAILABLE',quantity:1}});
  await db.productMark.create({data:{id:m,clientId:c,skuId:s,value:serial,status:'SHIPPING',stockMovementId:receipt.id}});
  await db.shippedKizHistory.create({data:{assemblyId:m,clientId:c,warehouseId:w,clientName:'Test',requestId:m,requestNumber:1,requestTitle:'Test',skuId:s,internalSku:s,productName:'Test',kiz:serial,shippedAt:new Date()}});
  const act=(action,extra={})=>service.act({action,markId:m,id:row?.id,reason:'Physically found',confirmed:true,...extra},user);
  const opened=await Promise.all([act('OPEN'),act('OPEN')]);assert.equal(opened[0].id,opened[1].id);row=opened[0];
  await act('REUSE');assert.equal(await db.stockBalance.count({where:{clientId:c}}),0);assert.equal((await db.productMark.findUnique({where:{id:m}})).status,'SHIPPING');
  await assert.rejects(act('RETURN',{boxCode:'missing'}));assert.equal(await db.stockBalance.count({where:{clientId:c}}),0);
  const failingDb=new Proxy(db,{get(target,prop){if(prop==='$transaction')return fn=>db.$transaction(tx=>fn(new Proxy(tx,{get(t,p){if(p==='auditLog')return {create:()=>{throw Error('TEST audit unavailable');}};return t[p];}})));return target[prop];}});
  await assert.rejects(new KizFoundReview(failingDb,clients,async()=>evidence).act({action:'RETURN',id:row.id,reason:'Rollback test',confirmed:true,boxCode:b},user));
  assert.equal(await db.stockBalance.count({where:{clientId:c}}),0);assert.equal(await db.stockMovement.count({where:{clientId:c,type:'RETURN'}}),0);assert.equal((await db.productMark.findUnique({where:{id:m}})).status,'SHIPPING');
  const returned=await Promise.all([act('RETURN',{boxCode:b}),act('RETURN',{boxCode:b})]);assert.equal(returned[0].id,returned[1].id);
  assert.equal((await db.stockBalance.aggregate({where:{clientId:c},_sum:{quantity:true}}))._sum.quantity,1);
  assert.equal(await db.stockMovement.count({where:{clientId:c,type:'RETURN'}}),1);
  const permission=await db.kizReviewCase.findFirst({where:{taskId:'UNIT:'+m}});assert.equal(permission.status,'APPROVED');assert.equal(permission.resolution,'REUSE');
  process.env.WMS_KIZ_REUSE_EVIDENCE_ENABLED='true';process.env.WMS_KIZ_REVIEW_QUEUE_ENABLED='true';
  const {reusePermissionForProposal,finishKizReview}=require(path.join(root,'api/common/kiz-review-queue'));
  const task={id:'test-task-'+m,clientId:c,skuId:s,boxId:b};assert.equal(await reusePermissionForProposal(db,task,serial),true);
  await db.kizReviewCase.update({where:{id:permission.id},data:{status:'CLAIMED',snapshot:{...permission.snapshot,claimedTaskId:task.id}}});
  await finishKizReview(db,task,serial,'REUSE');assert.equal(await reusePermissionForProposal(db,task,serial),false);assert.equal((await db.kizReviewCase.findUnique({where:{id:permission.id}})).status,'USED');
  await assert.rejects(act('RETURN',{boxCode:'another'}));assert.equal(await db.stockMovement.count({where:{clientId:c,type:'RETURN'}}),1);
  console.log(JSON.stringify({passed:true,concurrentOpen:true,concurrentReturn:true,returnMovements:1,permission:'one UNIT'}));
 }finally{
  await db.auditLog.deleteMany({where:{userId:u}});await db.kizReviewCase.deleteMany({where:{clientId:c}});await db.shippedKizHistory.deleteMany({where:{clientId:c}});await db.productMark.deleteMany({where:{clientId:c}});await db.stockBalance.deleteMany({where:{clientId:c}});await db.stockMovement.deleteMany({where:{clientId:c}});await db.box.deleteMany({where:{clientId:c}});await db.sku.deleteMany({where:{clientId:c}});await db.user.deleteMany({where:{id:u}});await db.warehouse.deleteMany({where:{id:w}});await db.client.deleteMany({where:{id:c}});await db.$disconnect();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
