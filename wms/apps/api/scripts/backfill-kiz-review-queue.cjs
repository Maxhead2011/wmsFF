// FIX: one-off import of already recorded scanner problems; dry run unless --apply is supplied.
const {PrismaClient}=require('@prisma/client');
const {queueKizReview,kizReviewEnabled}=require('../dist/common/kiz-review-queue');
const {inspectKizReuse}=require('../dist/common/kiz-wb-reuse');
const db=new PrismaClient();
(async()=>{
 if(!kizReviewEnabled())throw Error('Enable our KIZ review queue after its migration first');
 const args=process.argv.slice(2),position=args.indexOf('--since');
 if(position<0||!args[position+1])throw Error('Provide --since with an ISO timestamp; --apply enables case creation');
 const since=new Date(args[position+1]);if(!Number.isFinite(+since))throw Error('Invalid --since');
 const rows=await db.auditLog.findMany({where:{action:'KIZ_REUSE_CHECK',entity:'FbsTsdAssembly',createdAt:{gte:since}},
   orderBy:[{createdAt:'desc'},{id:'desc'}],take:1001});
 if(rows.length>1000)throw Error('More than 1000 events: use a narrower --since window');
 const seen=new Set();let eligible=0,queued=0,skipped=0;
 for(const row of rows){const v=row.payload||{},key=row.entityId+':'+v.kizIdentity;
   if(seen.has(key))continue;seen.add(key);
   if(!['REVIEW','RELABEL'].includes(v.decision)||typeof v.kizIdentity!=='string'||!row.entityId){skipped++;continue;}
   const task=await db.fbsTsdAssembly.findUnique({where:{id:row.entityId}});
   if(!task||task.status!=='IN_PROGRESS'||task.kiz||task.clientId!==v.clientId){skipped++;continue;}
   const request=await db.clientRequest.findUnique({where:{id:task.requestId}});
   if(!request?.warehouseId||['DONE','CANCELLED','REJECTED'].includes(request.status)){skipped++;continue;}
   eligible++;
   if(args.includes('--apply')){
     const evidence=await inspectKizReuse(db,task.clientId,v.kizIdentity,task.id);
     await queueKizReview(db,task.clientId,v.kizIdentity,task.id,evidence);queued++;
   }
 }
 console.log(JSON.stringify({dryRun:!args.includes('--apply'),eligible,queued,skipped}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());
