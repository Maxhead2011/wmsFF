// TEST: isolated PostgreSQL schema, independent connections, no production records.
const assert=require('node:assert/strict');
module.exports=async function testQueue(PrismaClient,url,sql,queue){
 const schema='queue_test_'+require('node:crypto').randomUUID().replaceAll('-','');
 const root=new PrismaClient({datasourceUrl:url});
 const scoped=new URL(url);scoped.searchParams.set('schema',schema);
 const a=new PrismaClient({datasourceUrl:scoped.toString()}),b=new PrismaClient({datasourceUrl:scoped.toString()});
 let passed=0;
 try{
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  for(const statement of sql.replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()))await a.$executeRawUnsafe(statement);
  let calls=0,release,entered;
  const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
  const job={clientId:'test',requestId:'request',warehouseId:null,entityId:'order',cause:'PRINT_CONFIRMED',label:'test',evidence:{v:1},run:async()=>{calls++;entered();await wait;}};
  const first=queue.runReconciliationJobs(a,[job]);await started;
  assert.equal((await queue.runReconciliationJobs(b,[job])).attempted,0);
  assert.equal((await queue.runReconciliationJobs(b,[{...job,evidence:{v:2}}])).attempted,0);
  release();await first;assert.equal(calls,1);passed++;
  assert.equal((await queue.runReconciliationJobs(b,[job])).attempted,0);passed++;
  const fail={...job,evidence:{v:2},run:async()=>{throw new Error('sensitive internal error');}};
  assert.equal((await queue.runReconciliationJobs(b,[fail])).failed,1);
  assert.equal((await queue.runReconciliationJobs(a,[fail])).attempted,0);
  const rows=await a.$queryRawUnsafe('SELECT * FROM "WmsReconciliationCase"');
  assert.equal(rows[0].reasonCode,'REVIEW_REQUIRED');assert.equal(rows[0].attempts,1);passed++;
  assert.equal((await queue.runReconciliationJobs(a,[{...job,evidence:{v:3},run:async()=>{calls++;}}])).attempted,1);passed++;
  // Simulated crash after claim: lease prevents replay until expiry.
  await a.$executeRawUnsafe(`UPDATE "WmsReconciliationCase" SET "leaseToken"='crashed',"leaseUntil"=NOW()+INTERVAL '5 minutes',"nextAttemptAt"=NOW()-INTERVAL '1 minute'`);
  const resumed={...job,evidence:{v:3},run:async()=>{calls++;}};
  assert.equal((await queue.runReconciliationJobs(b,[resumed])).attempted,0);
  await a.$executeRawUnsafe(`UPDATE "WmsReconciliationCase" SET "leaseUntil"=NOW()-INTERVAL '1 second'`);
  assert.equal((await queue.runReconciliationJobs(b,[resumed])).attempted,1);passed++;
  // Distinct tenants never share a case; per-cycle budget is enforced.
  const jobs=Array.from({length:3},(_,i)=>({...resumed,clientId:'tenant'+i}));
  assert.equal((await queue.runReconciliationJobs(a,jobs,2)).attempted,2);
  assert.equal((await queue.runReconciliationJobs(b,jobs,2)).attempted,1);passed++;
  return {passed,parallelConnections:true,isolatedSchema:true};
 }finally{await a.$disconnect();await b.$disconnect();await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await root.$disconnect();}
};
