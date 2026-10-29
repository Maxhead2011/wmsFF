// TEST: isolated real PostgreSQL, actual candidate service and durable no-replay behavior.
require('reflect-metadata');const assert=require('node:assert/strict');
assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL).hostname,'lamoda-actual-test-pg');
const {PrismaClient}=require('@prisma/client'),p=new PrismaClient();
const {LamodaSubmission}=require('/app/apps/api/dist/modules/lamoda/lamoda-submission');
(async()=>{let passed=0,calls=0;
 const wh=await p.warehouse.create({data:{code:'TEST',name:'Test'}}),client=await p.client.create({data:{code:'TEST',name:'Test'}}),actor=await p.user.create({data:{name:'Test',email:'test@example.invalid',passwordHash:'disabled'}});
 const sku=await p.sku.create({data:{clientId:client.id,internalSku:'sku',name:'Test',isUnmarked:true}});
 const account=await p.lamodaAccount.create({data:{clientId:client.id,name:'Test',sellerId:'TEST',oauthClientId:'test',encryptedSecret:'unused'}});
 await p.lamodaProduct.create({data:{accountId:account.id,remoteSku:'MP1',externalSku:'SELLER1',barcode:'4600000000001',skuId:sku.id,linkState:'CONFIRMED',name:'Test'}});
 async function assembly(hash){
  const plan=await p.lamodaPlan.create({data:{accountId:account.id,warehouseId:wh.id,title:'Test',importHash:hash,items:[{barcode:'4600000000001',quantity:1}]}});
  const req=await p.clientRequest.create({data:{clientId:client.id,warehouseId:wh.id,type:'OUTBOUND',status:'PACKED',title:'Test',items:{create:{skuId:sku.id,quantity:1}}},include:{items:true}});
  await p.lamodaFboAssembly.create({data:{requestId:req.id,planId:plan.id,directions:[]}});
  await p.fboAssembly.create({data:{requestId:req.id,phase:'COMPLETED',compositionHash:'test',units:{create:{requestItemId:req.items[0].id,skuId:sku.id,barcode:'4600000000001',sourceBoxId:'source',sourceBoxCode:'SOURCE',pickedByUserId:actor.id,state:'PACKED',targetBoxId:'box',targetBoxCode:'BOX'}},boxes:{create:{boxId:'box',boxCode:'BOX',closedAt:new Date(),confirmedAt:new Date()}}}});return req;
 }
 const req=await assembly('one'),user={id:actor.id,roleCodes:['OWNER'],permissionCodes:['system:admin']};
 const remote={execute:async()=>{calls++;return {id:'MPG1',externalShipmentId:'UPD1',plannedDate:'2026-11-01'}},fboShipment:async()=>({shipment:{externalShipmentId:'UPD1',status:'VALIDATION'},items:[]})};
 const svc=new LamodaSubmission(p,remote),form={externalShipmentId:'UPD1',warehouseCode:'BYKOVO',plannedDate:'2026-11-01',prices:[{skuId:sku.id,priceMinor:10000}]};
 const preview=await svc.preview(account.id,req.id,user,form);assert.equal(preview.payload.items[0].externalSku,'SELLER1');passed++;
 const results=await Promise.allSettled([svc.send(account.id,req.id,user,form,{}),svc.send(account.id,req.id,user,form,{})]);assert(results.some(r=>r.status==='fulfilled'));assert.equal(calls,1);passed++;
 await svc.send(account.id,req.id,user,form,{});assert.equal(calls,1);passed++;
 assert.equal((await svc.refresh(account.id,req.id,user,{})).remoteStatus,'VALIDATION');passed++;
 const second=await assembly('two');await assert.rejects(()=>svc.send(account.id,second.id,user,form,{}));assert.equal(calls,1);passed++;
 await assert.rejects(()=>svc.view('foreign',req.id,user));passed++;
 await assert.rejects(()=>svc.resetRejected(account.id,req.id,user));passed++;
 const row=await p.$queryRaw`SELECT "submission" FROM "LamodaFboAssembly" WHERE "requestId"=${req.id}`;assert.equal(row[0].submission.remoteId,'MPG1');passed++;
 assert.equal(await p.stockMovement.count(),0);passed++;
 console.log(JSON.stringify({passed,isolated:true}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());
