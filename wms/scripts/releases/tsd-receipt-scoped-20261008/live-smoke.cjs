const assert=require('node:assert/strict'),{PrismaClient}=require('@prisma/client');
const db=new PrismaClient(),current=require('/app/apps/api/dist/modules/warehouse/receipt-channel-policy'),candidate=require(process.env.CANDIDATE_MODULE||'/release/api/modules/warehouse/receipt-channel-policy');
(async()=>{
 const clientId='c76b78f9-1b83-4e9b-bee3-bc28336ee1c9';
 const tasks=await db.fbsTsdAssembly.findMany({where:{clientId,boxId:{not:null}},orderBy:{updatedAt:'desc'},take:3,select:{id:true,clientId:true,boxId:true,connectionId:true,orderId:true,marketplace:true}});
 assert(tasks.length);const report=[];
 for(const task of tasks){
  const box=await db.box.findUnique({where:{id:task.boxId},select:{code:true,warehouseId:true}});assert(box);
  const start=Date.now();let decision;
  await db.$transaction(async tx=>{try{await candidate.assertReceiptFbsBox(tx,task);decision='allowed';}catch(e){if(e.getStatus?.()!==409)throw e;decision='blocked';}},{timeout:5000,maxWait:5000});
  report.push({box:box.code,durationMs:Date.now()-start,decision});
 }
 // One complete reference read checks that scope narrowing preserves the current decision.
 const start=Date.now(),all=await current.receiptRules(db,clientId);
 for(let i=0;i<tasks.length;i++)assert.equal(report[i].decision,current.receiptAllows(all.get(tasks[i].boxId),'fbs',tasks[i])?'allowed':'blocked');
 console.log(JSON.stringify({passed:true,readOnly:true,scoped:report,referenceMs:Date.now()-start}));
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1});
