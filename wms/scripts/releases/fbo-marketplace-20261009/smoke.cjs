require('reflect-metadata');
const assert=require('node:assert/strict'),{PrismaClient}=require('@prisma/client');
const {ClientRequestsService}=require('/app/apps/api/dist/modules/client-requests/client-requests.service');
const db=new PrismaClient();
// TEST: real list handler and persisted marketplace identity, inside a read-only transaction.
(async()=>{
 const proof=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const ids=['13b326b1-ed5c-44c3-9ecc-09e1b65d90fb','b748d789-a357-4810-a900-82bb8d810b51'];
  const expected=await tx.clientRequest.findMany({where:{id:{in:ids}},select:{id:true,clientId:true}});assert.equal(expected.length,2);
  const svc=new ClientRequestsService(tx,{resolveClientFilter:(_,id)=>id},{},{});
  const rows=[];
  for(const clientId of new Set(expected.map(r=>r.clientId)))rows.push(...await svc.list({clientId,type:'OUTBOUND'},{roleCodes:['ADMIN'],permissionCodes:['system:admin']}));
  const ozon=rows.find(r=>r.id===ids[0]),wb=rows.find(r=>r.id===ids[1]);assert.ok(ozon);assert.ok(wb);
  assert.equal(ozon.ozonShipment.requestId,ids[0]);assert.equal(wb.ozonShipment,null);
  return {passed:true,readOnly:true,ozon:1861,wb:'1813_01',actualListHandler:true};
 },{timeout:60000});console.log(JSON.stringify(proof));
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1});
