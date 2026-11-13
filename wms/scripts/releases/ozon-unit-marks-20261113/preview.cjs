// TEST: read-only pre/post publication verification; no inventory writes.
const assert=require('node:assert/strict'),{PrismaClient}=require('@prisma/client');
const {ozonMarkedUnits}=require('./dist/common/ozon-unit-marks');
const {readOzonPickState}=require('./dist/modules/marketplace-connections/ozon-fbs-pick-lines');
const db=new PrismaClient();
(async()=>{
 const proof=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const task=await tx.fbsTsdAssembly.findUnique({where:{id:'37613e69-743b-48ca-b24a-a629bd899770'}});
  assert(task&&task.marketplace==='OZON'&&task.orderId==='44403509-0121-1'&&task.itemCount===2);
  const request=await tx.clientRequest.findUnique({where:{id:task.requestId}});assert.equal(request.status,'DONE');
  const state=await readOzonPickState(tx,task.id);
  if(state)assert.equal(ozonMarkedUnits(task,state).length,2);
  return {readOnly:true,units:task.itemCount,requestStatus:request.status,recovered:!!state?.recovery};
 },{timeout:30000});console.log(JSON.stringify(proof));
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exit(1)});
