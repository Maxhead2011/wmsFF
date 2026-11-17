// TEST: verify the published service on existing data in a read-only SQL transaction.
const assert=require('node:assert/strict');
require('/app/apps/api/node_modules/reflect-metadata');
const {PrismaClient}=require('/app/apps/api/node_modules/@prisma/client');
const {SkusService}=require('/app/apps/api/dist/modules/skus/skus.service');
const p=new PrismaClient();
(async()=>{
 assert.equal(process.env.WMS_BULK_VOLUME_SEARCH_ENABLED,'true');
 const proof=await p.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const sku=await tx.sku.findFirst({where:{barcodes:{some:{}}},select:{id:true,clientId:true,article:true,barcodes:{take:1,select:{value:true}}}});
  assert.ok(sku);const service=new SkusService(tx,{requireClientAccess(){}},{});
  const result=await service.listBulkVolume({clientId:sku.clientId,search:sku.barcodes[0].value},{});
  assert.ok(result.items.some(x=>x.id===sku.id));
  const wrong=await service.listBulkVolume({clientId:sku.clientId,search:'__codex_volume_no_match_20261117__'},{});
  assert.equal(wrong.items.length,0);
  return {barcodeMatches:result.items.length,emptySearchVerified:true,transactionReadOnly:true};
 },{timeout:20000});
 console.log(JSON.stringify({passed:true,...proof}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());
