// TEST: isolated schema and independent connections. No warehouse/client tables touched.
module.exports=async function testPostgres(PrismaClient,url,durable){
 const assert=require('node:assert/strict'),id=require('node:crypto').randomUUID().replaceAll('-','');
 const schema='auto_assembly_test_'+id,root=new PrismaClient({datasourceUrl:url});
 const scoped=new URL(url);scoped.searchParams.set('schema',schema);
 const a=new PrismaClient({datasourceUrl:scoped.toString()}),b=new PrismaClient({datasourceUrl:scoped.toString()});
 let passed=0;process.env.WMS_AUTO_ASSEMBLY_DURABLE_ENABLED='true';
 try{
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await a.$executeRawUnsafe('CREATE TABLE "SystemSetting" (key TEXT PRIMARY KEY,value JSONB NOT NULL,"updatedByUserId" TEXT,"createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),"updatedAt" TIMESTAMP NOT NULL)');
  await a.$executeRawUnsafe('CREATE TABLE "FakeRequest" (id TEXT PRIMARY KEY)');
  let entered,release;const started=new Promise(r=>entered=r),hold=new Promise(r=>release=r);let calls=0;
  const first=durable.withRun(a,id,async()=>{calls++;entered();await hold;});await started;
  await durable.withRun(b,id,async()=>{calls++;});assert.equal(calls,1);release();await first;
  await durable.withRun(b,id,async()=>{calls++;});assert.equal(calls,2);passed++;
  const orders=[{id:'1',connectionId:id,marketplace:'WILDBERRIES'}];
  await durable.withRun(a,id,async()=>{
   await assert.rejects(a.$transaction(async tx=>{
    await tx.$executeRawUnsafe('INSERT INTO "FakeRequest" VALUES (\'req\')');
    await durable.requestCreated(tx,{id:'req',number:2082},'test',orders,'actor');
    throw Error('simulated crash before commit');
   }),/simulated crash/);
  });
  assert.equal(await a.systemSetting.count(),0);assert.equal((await a.$queryRawUnsafe('SELECT * FROM "FakeRequest"')).length,0);passed++;
  await durable.withRun(a,id,async()=>{
   await a.$transaction(async tx=>{await tx.$executeRawUnsafe('INSERT INTO "FakeRequest" VALUES (\'req\')');await durable.requestCreated(tx,{id:'req',number:2082},'test',orders,'actor');});
   // Crash after commit, before beginSupply: durable request must be recoverable on another connection.
  });
  const saved=await b.systemSetting.findUnique({where:{key:`fbs.autoAssembly.operation.${id}.req`}});
  assert.equal(saved.value.stage,'REQUEST_CREATED');assert.equal(saved.value.requestNumber,2082);passed++;
  await assert.rejects(durable.withRun(a,id,async()=>{throw Error('process failure');}),/process failure/);
  let recovered=false;await durable.withRun(b,id,async()=>{recovered=true;});assert.ok(recovered);passed++;
  return {passed:true,tests:passed,independentConnections:true,isolatedSchema:true};
 }finally{await a.$disconnect();await b.$disconnect();await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await root.$disconnect();}
};
