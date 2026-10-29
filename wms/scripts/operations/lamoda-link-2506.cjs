// FIX: one audited link to an already-created shipment; no marketplace mutation or stock write.
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const requestId='b385b63b-7ba7-435f-8b2e-2bf37dc41d7c',accountId='a3ba7af1-1831-4284-90f0-4d726f80527d',remoteId='MPG100007386';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function validateLink(payload,remote){
 assert.equal(remote.shipment.id,remoteId);assert.equal(remote.shipment.externalShipmentId,'1');
 assert(!['CANCELLED','REJECTED','CANCEL_PENDING'].includes(remote.shipment.status));
 for(const key of ['externalShipmentId','warehouseCode','plannedDate'])assert.equal(payload[key],remote.shipment[key]);
 const counts=(items,quantity)=>{const m=new Map();for(const i of items){assert.equal(typeof i.ean,'string');assert(Number.isSafeInteger(i[quantity])&&i[quantity]>0);assert.equal(i.price?.currency,'RUB');assert(Number.isSafeInteger(i.price.amount)&&i.price.amount>0);const k=JSON.stringify([i.ean,i.price.amount,i.price.currency]);m.set(k,(m.get(k)||0)+i[quantity]);}return [...m].sort();};
 assert.deepEqual(counts(payload.items,'quantity'),counts(remote.items,'quantityPlanned'));
 const total=payload.items.reduce((n,i)=>n+i.quantity,0);assert.equal(total,21);return total;
}
async function run(mode){
 assert(['--check','--rehearse','--apply'].includes(mode));
 const runtime=require('node:module').createRequire('/app/apps/api/package.json');runtime('reflect-metadata');
 const {PrismaClient}=runtime('@prisma/client'),p=new PrismaClient();
 const {LamodaClient,openSecret}=runtime('./dist/modules/lamoda/lamoda-client');
 const {LamodaSubmission}=runtime('./dist/modules/lamoda/lamoda-submission');
 const user={id:'authorized-maintenance',roleCodes:['OWNER'],permissionCodes:['system:admin']};
 let result;const rollback=new Error('REHEARSAL_ROLLBACK');
 try {
  assert.equal(process.env.WMS_LAMODA_FBO_SUBMISSION_ENABLED,'true');
  const account=await p.lamodaAccount.findUniqueOrThrow({where:{id:accountId}});assert(account.isActive&&account.fboEnabled);
  const credentials={sellerId:account.sellerId,oauthClientId:account.oauthClientId,secret:openSecret(account.encryptedSecret,JSON.stringify([account.clientId,account.sellerId,account.oauthClientId]))};
  const remote=new LamodaClient(),data=await remote.fboShipment(credentials,remoteId);
  try {await p.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "ClientRequest" WHERE "id"=${requestId} FOR UPDATE`;
   const b=await tx.lamodaFboAssembly.findUniqueOrThrow({where:{requestId},include:{plan:true,request:{include:{items:true}}}});
   assert.equal(b.request.number,2506);assert.equal(b.plan.accountId,accountId);assert.equal(b.request.clientId,account.clientId);
   const rows=await tx.$queryRaw`SELECT "submission" FROM "LamodaFboAssembly" WHERE "requestId"=${requestId}`;
   const receipt=rows[0].submission;
   if(receipt){assert.equal(receipt.remoteId,remoteId);assert.equal(b.plan.remoteShipmentId,remoteId);result={alreadyLinked:true,request:2506,remoteId,status:receipt.remoteStatus};return;}
   assert.equal(b.plan.remoteShipmentId,null);assert.equal(b.externalKey,null);
   const key=JSON.stringify([account.sellerId,remoteId]);
   assert.equal(await tx.lamodaFboAssembly.count({where:{externalKey:key}}),0);
   assert.equal(await tx.lamodaOperation.count({where:{accountId,operationKey:'FBO:1'}}),0);
   const cards=await tx.lamodaProduct.findMany({where:{accountId,isPresent:true,linkState:'CONFIRMED',skuId:{in:b.request.items.map(i=>i.skuId)}}});
   const prices=data.items.map(i=>{const matches=cards.filter(c=>c.barcode===i.ean&&c.remoteSku===i.sku);assert.equal(matches.length,1);assert.equal(i.price?.currency,'RUB');return {skuId:matches[0].skuId,priceMinor:i.price.amount};});
   const form={externalShipmentId:data.shipment.externalShipmentId,warehouseCode:data.shipment.warehouseCode,plannedDate:data.shipment.plannedDate,prices};
   // Reuse deployed validation inside the same row-locked transaction.
   const svc=new LamodaSubmission(p,remote),{payload}=await svc.build(tx,accountId,requestId,user,form);
   const total=validateLink(payload,data),physicalBefore=sha(await tx.fboAssembly.findUnique({where:{requestId},include:{units:{orderBy:{id:'asc'}},boxes:{orderBy:{id:'asc'}}}}));
   result={request:2506,remoteId,status:data.shipment.status,total,payloadHash:sha(payload),mode};
   if(mode==='--check')return;
   const next={state:'SUCCEEDED',source:'MANUAL_FILE',payload,remoteId,remoteStatus:data.shipment.status,updatedAt:new Date().toISOString()};
   await tx.lamodaOperation.create({data:{id:sha([accountId,payload.externalShipmentId]),accountId,operationKey:'FBO:1',payloadHash:sha(payload),status:'SUCCEEDED'}});
   await tx.lamodaPlan.update({where:{id:b.planId},data:{remoteShipmentId:remoteId}});
   await tx.lamodaFboAssembly.update({where:{requestId},data:{externalKey:key}});
   await tx.$executeRaw`UPDATE "LamodaFboAssembly" SET "submission"=${JSON.stringify(next)}::jsonb WHERE "requestId"=${requestId}`;
   await tx.auditLog.create({data:{action:'LAMODA_MANUAL_SHIPMENT_LINKED',entity:'ClientRequest',entityId:requestId,payload:{authorization:'Owner request in WMS chat, 2026-10-29',source:'lamoda-link-2506.cjs',before:{remoteShipmentId:null,externalKey:null,submission:null},after:{remoteId,externalShipmentId:payload.externalShipmentId,status:next.remoteStatus,total,payloadHash:sha(payload)},remoteMarkingCodesCompared:false}}});
   assert.equal(physicalBefore,sha(await tx.fboAssembly.findUnique({where:{requestId},include:{units:{orderBy:{id:'asc'}},boxes:{orderBy:{id:'asc'}}}})));
   assert.equal((await tx.clientRequest.findUniqueOrThrow({where:{id:requestId}})).status,b.request.status);
   if(mode==='--rehearse')throw rollback;
  },{isolationLevel:'Serializable',timeout:30000});}catch(e){if(e!==rollback)throw e;}
  if(mode==='--rehearse'){const rows=await p.$queryRaw`SELECT "submission" FROM "LamodaFboAssembly" WHERE "requestId"=${requestId}`;assert.equal(rows[0].submission,null);result.rolledBack=true;}
  if(mode==='--apply'){
   const updated=await new LamodaSubmission(p,remote).refresh(accountId,requestId,user,credentials);
   assert.equal(updated.remoteId,remoteId);result.status=updated.remoteStatus;result.refreshVerified=true;
  }
  console.log(JSON.stringify(result));
 }finally{await p.$disconnect();}
}
module.exports={validateLink};
if(require.main===module||process.argv[1]==='-')run(process.argv[2]||'--check').catch(e=>{console.error(e.message);process.exitCode=1;});
