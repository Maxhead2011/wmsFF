// TEST: run only against a disposable PostgreSQL database, never the operational WMS database.
const assert=require('node:assert/strict');
const {PrismaClient}=require('/app/apps/api/node_modules/@prisma/client');
const {proposePhysicalKizRelabel,applyPhysicalKizRelabel,readPhysicalKizRelabel}=require('/checks/fbs-physical-kiz-relabel.js');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'physical-kiz-test-pg');
const p=new PrismaClient();process.env.WMS_FBS_KIZ_RELABEL_ENABLED='true';
const user={id:'picker',deviceCode:'test-tsd',roleCodes:['TSD']};
const lease=t=>assert(t&&t.workerUserId===user.id&&t.deviceCode===user.deviceCode);
const old='0104680992590022215MywwfMmgS<1E\u001d91EE12\u001d92OLD';
const fresh='01046809925976562154wMCRGtr"7PG\u001d91EE12\u001d92NEW';
const trans=fn=>p.$transaction(fn,{isolationLevel:'Serializable',timeout:15000});
(async()=>{
 await p.user.create({data:{id:user.id,name:'Test picker',email:'picker@example.test',passwordHash:'TEST-NO-LOGIN'}});
 await p.client.create({data:{id:'client',code:'TEST',name:'Test client'}});
 await p.warehouse.create({data:{id:'warehouse',code:'TEST',name:'Test warehouse'}});
 await p.sku.create({data:{id:'sku',clientId:'client',internalSku:'TEST',name:'Test sku'}});
 await p.box.create({data:{id:'box',clientId:'client',warehouseId:'warehouse',code:'FFL_TEST'}});
 await p.clientRequest.create({data:{id:'request',clientId:'client',warehouseId:'warehouse',type:'OUTBOUND',status:'IN_WORK',title:'Test'}});
 await p.stockBalance.create({data:{balanceKey:'test',warehouseId:'warehouse',clientId:'client',skuId:'sku',boxId:'box',status:'AVAILABLE',quantity:1}});
 await p.productMark.create({data:{id:'old',clientId:'client',skuId:'sku',boxId:'box',value:old,status:'AVAILABLE',sourceDocument:'Original receipt'}});
 await p.fbsTsdAssembly.create({data:{id:'task',clientId:'client',connectionId:'test-connection',orderId:'123',requestId:'request',requestItemId:'test-item',skuId:'sku',
  productName:'Test sku',barcodes:['barcode'],storageBoxes:[],deviceCode:user.deviceCode,workerUserId:user.id,startedAt:new Date(),
  boxId:'box',boxCode:'FFL_TEST',barcode:'barcode',requiresKiz:true}});
 let task=await p.fbsTsdAssembly.findUniqueOrThrow({where:{id:'task'}});
 await trans(tx=>proposePhysicalKizRelabel(tx,task,old,user,lease));
 task=await p.fbsTsdAssembly.findUniqueOrThrow({where:{id:'task'}});
 const proposal=await readPhysicalKizRelabel(p,task,user);assert(proposal);
 // Real database rollback after both mark writes and the task update, before commit.
 await assert.rejects(trans(async tx=>{await applyPhysicalKizRelabel(tx,task,user,proposal.id,fresh,lease);throw Error('forced after-write failure');}),/forced/);
 assert.equal(await p.productMark.count(),1);
 assert.equal((await p.productMark.findUniqueOrThrow({where:{id:'old'}})).status,'AVAILABLE');
 assert.equal((await p.fbsTsdAssembly.findUniqueOrThrow({where:{id:'task'}})).kiz,null);
 assert.equal(await p.auditLog.count({where:{action:'FBS_PHYSICAL_KIZ_RELABEL'}}),1);
 // Same request racing itself: only one serializable transaction may apply the pair.
 const attempts=await Promise.allSettled([trans(tx=>applyPhysicalKizRelabel(tx,task,user,proposal.id,fresh,lease)),trans(tx=>applyPhysicalKizRelabel(tx,task,user,proposal.id,fresh,lease))]);
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 task=await p.fbsTsdAssembly.findUniqueOrThrow({where:{id:'task'}});
 await trans(tx=>applyPhysicalKizRelabel(tx,task,user,proposal.id,fresh,lease));
 const marks=await p.productMark.findMany();assert.equal(marks.length,2);
 assert.equal(marks.find(m=>m.id==='old').value,old);assert.equal(marks.find(m=>m.id==='old').status,'BLOCKED');
 assert.equal(marks.find(m=>m.value===fresh).status,'AVAILABLE');
 assert.equal((await p.stockBalance.findUniqueOrThrow({where:{balanceKey:'test'}})).quantity,1);
 assert.equal(await p.stockMovement.count(),0);
 assert.equal(await p.auditLog.count({where:{action:'FBS_PHYSICAL_KIZ_RELABEL',payload:{path:['stage'],equals:'APPLIED'}}}),1);
 console.log(JSON.stringify({passed:true,realPostgresRollback:true,concurrentSingleApplication:true,retryIdempotent:true,quantityUnchanged:true,oldKizPreserved:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());
