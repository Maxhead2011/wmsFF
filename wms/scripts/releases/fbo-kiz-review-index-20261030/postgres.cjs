// TEST: real serializable conflict on the same KizReviewCase schema, isolated database only.
const assert=require('node:assert/strict'),{PrismaClient}=require('@prisma/client');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'fbo-review-index-test-pg');
const p=new PrismaClient();
(async()=>{
await p.$executeRawUnsafe(`INSERT INTO "KizReviewCase" (id,"clientId","warehouseId","taskId","requestId","kizIdentity",kiz,context,status,decision,snapshot,evidence,"updatedAt") SELECT 't-'||n,'test-client','w','task-'||n,'r',lpad(n::text,8,'0'),lpad(n::text,8,'0'),'test','OPEN','REVIEW','{}','{}',now() FROM generate_series(1,30000) n`);
await p.$executeRawUnsafe('ANALYZE "KizReviewCase"');
async function race(){let release,arrived=0;const gate=new Promise(r=>release=r);return Promise.allSettled([100,29000].map(n=>p.$transaction(async tx=>{const key=String(n).padStart(8,'0');await tx.kizReviewCase.findMany({where:{clientId:'test-client',kizIdentity:key}});if(++arrived===2)release();await gate;await tx.kizReviewCase.update({where:{id:'t-'+n},data:{attempts:{increment:1}}});},{isolationLevel:'Serializable',timeout:20000})));}
const red=await race();assert(red.some(r=>r.status==='rejected'&&r.reason.code==='P2034'),'RED: expected the original table scan to conflict');
await p.$executeRawUnsafe('CREATE INDEX "KizReviewCase_client_identity_idx" ON "KizReviewCase" ("clientId","kizIdentity")');
const plan=await p.$queryRawUnsafe('EXPLAIN (FORMAT JSON) SELECT * FROM "KizReviewCase" WHERE "clientId"=$1 AND "kizIdentity"=$2','test-client','00000100');assert(JSON.stringify(plan).includes('KizReviewCase_client_identity_idx'));
for(let i=0;i<5;i++){const green=await race();assert(green.every(r=>r.status==='fulfilled'),JSON.stringify(green));}
assert.equal(await p.kizReviewCase.count(),30000);assert.equal(await p.kizReviewCase.count({where:{status:'OPEN'}}),30000);
console.log(JSON.stringify({redReproduced:true,greenConcurrentRuns:5,reviewRowsPreserved:30000,indexPlan:true}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());
