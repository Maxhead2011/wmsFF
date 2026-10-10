// TEST: actual list/controller against production in a read-only transaction, no stock changes.
require('reflect-metadata');
const assert=require('node:assert/strict'),{PrismaClient}=require('@prisma/client');
const {TsdAssemblyService:S}=require('/app/apps/api/dist/modules/tsd/tsd-assembly.service');
const {TsdDeviceController:C}=require('/app/apps/api/dist/modules/tsd/tsd-device.controller');
const db=new PrismaClient();
(async()=>{
 const proof=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const user={id:'release-read-only',roleCodes:['ADMIN'],permissionCodes:['system:admin']};
  const s=new S(tx,{resolveClientFilter:()=>undefined},{},{});const counts={};
  for(const workflow of ['fbo-pick','fbo-pack']) for(const marketplace of ['WB','OZON']){
   const rows=await C.prototype.listAssemblyRequests.call({assembly:s},user,workflow,marketplace);
   const ids=rows.map(r=>r.id);const ozon=await tx.ozonFboShipment.findMany({where:{requestId:{in:ids}},select:{requestId:true}});
   assert.equal(ozon.length,marketplace==='OZON'?rows.length:0);
   counts[workflow+':'+marketplace]=rows.length;
  }
  return {passed:true,readOnly:true,counts};
 },{timeout:60000});console.log(JSON.stringify(proof));
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1});
