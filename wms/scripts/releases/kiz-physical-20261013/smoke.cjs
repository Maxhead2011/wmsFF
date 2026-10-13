const assert=require('node:assert/strict');
const {PrismaClient}=require('/app/apps/api/node_modules/@prisma/client');
const {KizReviewQueue,queueKizReview}=require('/app/apps/api/dist/common/kiz-review-queue');
const {inspectKizReuse}=require('/app/apps/api/dist/common/kiz-wb-reuse');
const {ClientScopeService}=require('/app/apps/api/dist/modules/auth/client-scope.service');
process.env.WMS_KIZ_SOLD_PHYSICAL_REUSE_ENABLED='true';
(async()=>{const p=new PrismaClient();let proof;
try{
 const id='d0530f60-3c30-47f9-8bca-1c5441d826aa',before=await p.kizReviewCase.findUnique({where:{id}});assert(before);
 const actor=await p.user.findUnique({where:{id:'b045e060-dfd7-48af-bb88-12c191ee8eae'},include:{roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}}}});
 const user={id:actor.id,name:actor.name,isDemo:actor.isDemo,roleCodes:actor.roles.map(r=>r.role.code),permissionCodes:actor.roles.flatMap(r=>r.role.permissions.map(v=>v.permission.code)),activeWarehouseId:before.warehouseId};assert.equal(actor.status,'ACTIVE');assert(user.permissionCodes.includes('system:admin'));
 const e=await inspectKizReuse(p,before.clientId,before.kiz,before.taskId);
 let rolled=false;
 const db=new Proxy(p,{get(target,key){if(key==='$transaction')return async f=>p.$transaction(async tx=>{const result=await f(tx);const row=await tx.kizReviewCase.findUnique({where:{id}});assert(row.snapshot.physicalReuse);const scan=await queueKizReview(new Proxy(tx,{get(t,k){return k==='$transaction'?async g=>g(tx):t[k]}}),before.clientId,before.kiz,before.taskId,e);assert.equal(scan,'ALLOW');proof={result,scan,archived:row.snapshot.physicalReuse.previousTaskIds.length};throw Error('EXPECTED_KIZ_ROLLBACK');},{timeout:15000});return target[key];}});
 try{await new KizReviewQueue(db,new ClientScopeService()).decide(id,'REUSE','Проверка выпуска: физическая единица подтверждена, только откат',true,user);}catch(err){if(err.message!=='EXPECTED_KIZ_ROLLBACK')throw err;rolled=true;}
 assert(rolled);assert.deepEqual(await p.kizReviewCase.findUnique({where:{id}}),before);
 console.log(JSON.stringify({passed:true,rolledBack:true,businessWrites:false,proof}));
}finally{await p.$disconnect();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
