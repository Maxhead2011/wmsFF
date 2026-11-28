// TEST: synthetic records and agent polling against disposable PostgreSQL only.
require('reflect-metadata');const assert=require('node:assert/strict'),{randomUUID}=require('crypto'),fs=require('fs');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'kiz-box-print-test-pg');
const {PrismaClient}=require('@prisma/client'),p=new PrismaClient(),d='/app/apps/api/dist/';
const {TsdKizBoxPrintService}=require(d+'modules/tsd/tsd-kiz-box-print.service'),{ClientScopeService}=require(d+'modules/auth/client-scope.service'),{MarketplaceConnectionsService}=require(d+'modules/marketplace-connections/marketplace-connections.service');
(async()=>{
const w=await p.warehouse.create({data:{code:'PRINT',name:'Test'}}),c=await p.client.create({data:{code:'PRINT',name:'Test'}}),u=await p.user.create({data:{name:'Worker',email:'print@test.invalid',passwordHash:'disabled'}});
const user={id:u.id,name:u.name,roleCodes:['WORKER'],permissionCodes:[],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],warehouseIds:[w.id],activeWarehouseId:w.id};
const sku=await p.sku.create({data:{clientId:c.id,internalSku:'PRINT',name:'Test'}}),box=await p.box.create({data:{code:'FFL_LKB2710_173',clientId:c.id,warehouseId:w.id}});
const pallet=await p.storagePallet.create({data:{code:'VP_PALET_SORT_086',clientId:c.id,warehouseId:w.id,boxes:{create:{boxId:box.id,boxCode:box.code}}}});
const kiz='0104640684266352215pwnNt7VfBWyc',mark=await p.productMark.create({data:{value:kiz,clientId:c.id,skuId:sku.id,boxId:box.id}});
await p.stockBalance.create({data:{balanceKey:'test',clientId:c.id,warehouseId:w.id,skuId:sku.id,boxId:box.id,status:'AVAILABLE',quantity:1}});
const station=await p.fbsPrintStation.create({data:{name:'Synthetic printer',printerName:'NONE',printerModel:'TEST',agentKey:randomUUID(),lastSeenAt:new Date()}});
const service=new TsdKizBoxPrintService(p,new ClientScopeService()),agent=Object.create(MarketplaceConnectionsService.prototype);agent.prisma=p;
const before=JSON.stringify({mark:await p.productMark.findMany(),stock:await p.stockBalance.findMany(),movements:await p.stockMovement.count(),charges:await p.billingCharge.count()});
const body={kiz,stationId:station.id,printId:randomUUID()};
await Promise.all([service.create(body,user),service.create(body,user)]);assert.equal(await p.fbsPrintJob.count(),1);
const results=await Promise.all([agent.claimFbsPrintJob(station.id,user),agent.claimFbsPrintJob(station.id,user)]);assert.equal(results.filter(Boolean).length,1);
const job=results.find(Boolean);assert.equal(job.sortingLabel.templateVersion,'tsd-kiz-box-v1');assert.notEqual(job.stickerBase64,job.sortingLabel.imageBase64);
fs.writeFileSync('/release/box.png',Buffer.from(job.stickerBase64,'base64'));fs.writeFileSync('/release/pallet.png',Buffer.from(job.sortingLabel.imageBase64,'base64'));
await p.fbsPrintJob.update({where:{id:job.id},data:{claimedAt:new Date(0)}});assert.equal(await agent.claimFbsPrintJob(station.id,user),null,'uncertain print must not be claimed again');
await agent.finishFbsPrintJob(job.id,true,null,user);await agent.finishFbsPrintJob(job.id,false,'late failure',user);assert.equal((await service.status(body.printId,user)).status,'PRINTED');
assert.equal(await p.fboAssemblyUnit.count(),0);assert.equal(await p.clientRequest.count(),0);
assert.equal(JSON.stringify({mark:await p.productMark.findMany(),stock:await p.stockBalance.findMany(),movements:await p.stockMovement.count(),charges:await p.billingCharge.count()}),before);
await assert.rejects(service.status(body.printId,{...user,id:randomUUID()}));await assert.rejects(service.lookup(kiz,{...user,clientScopeMode:'LIMITED',clientIds:[]}));
process.env.WMS_TSD_KIZ_BOX_PRINT_ENABLED='false';await assert.rejects(service.lookup(kiz,user));
console.log(JSON.stringify({passed:true,concurrentRetry:true,exclusiveClaim:true,noAutoReclaim:true,lateAck:true,stockUnchanged:true,labels:2,physicalPrinting:false}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());
