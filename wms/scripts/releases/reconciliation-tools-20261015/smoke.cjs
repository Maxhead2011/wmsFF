// TEST: actual candidate modules; read-only real handlers and temporary queue table.
const assert=require('assert/strict');const {PrismaClient}=require('@prisma/client');
const {OperationsToolsService}=require('/app/apps/api/dist/modules/operations-tools/operations-tools.service');
const {ClientScopeService}=require('/app/apps/api/dist/modules/auth/client-scope.service');
const {OperationsToolsController}=require('/app/apps/api/dist/modules/operations-tools/operations-tools.module');
const {PrismaService}=require('/app/apps/api/dist/common/prisma/prisma.service');
const db=new PrismaClient();
(async()=>{let passed=0;assert.deepEqual(Reflect.getMetadata('design:paramtypes',OperationsToolsService),[PrismaService,ClientScopeService]);passed++;
const scopes=new ClientScopeService(),user={id:'test-readonly',permissionCodes:['system:admin'],roleCodes:[]},svc=new OperationsToolsService(db,scopes);
const r=await svc.requests('2058',user);assert(r.rows.length<=20);if(r.rows.length){const ready=await svc.readiness(r.rows[0].id,user);assert.equal(ready.steps.length,6);assert.equal(ready.steps.find(s=>s.key==='documents').state,'unknown');}passed++;
await svc.search('NO_SUCH_BOX_RECONCILIATION_TEST',user);passed++;
const b=await db.box.findFirst({where:{warehouseId:{not:null}},select:{id:true}});if(b)await svc.box(b.id,user);passed++;
const rollback=new Error('ROLLBACK');try{await db.$transaction(async tx=>{await tx.$executeRawUnsafe('CREATE TEMP TABLE "WmsReconciliationCase" ("key" text,"clientId" text,"requestId" text,cause text,label text,"reasonCode" text,attempts int,"lastAttemptAt" timestamp,"nextAttemptAt" timestamp,"updatedAt" timestamp,"assignedToId" text,"resolvedAt" timestamp,"createdAt" timestamp) ON COMMIT DROP');assert.deepEqual(await new OperationsToolsService(tx,scopes).attention(user),[]);throw rollback;});}catch(e){if(e!==rollback)throw e;}passed++;
delete process.env.WMS_OPERATIONS_TOOLS_ENABLED;assert.throws(()=>svc.enabled());passed++;
assert(OperationsToolsController);console.log(JSON.stringify({passed,readOnly:true,temporaryTableRolledBack:true}));})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
