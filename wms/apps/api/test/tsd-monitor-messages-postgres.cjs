// TEST: synthetic-only PostgreSQL check, refuses any other host/database.
const assert=require('node:assert/strict');
const url=new URL(process.env.DATABASE_URL||'');
assert.equal(url.hostname,'sorting-pr63-postgres-20260907');assert.equal(url.pathname,'/tsd_messages_test');
const {PrismaClient}=require('@prisma/client');
const {TsdMonitorMessages}=require('../dist/modules/tsd/tsd-monitor-messages');
(async()=>{
 let db=new PrismaClient();
 try{
  const user=await db.user.create({data:{email:'synthetic-messages@example.invalid',name:'Тестовый сборщик',passwordHash:'synthetic-not-a-login'}});
  const worker={id:user.id,deviceCode:'TSD-INSTALL-SYNTHETIC'};
  const code=worker.deviceCode+'@'+worker.id.slice(0,8).toUpperCase();
  const admin={id:'synthetic-dispatcher',name:'Тестовый диспетчер',administrationEnabled:true,permissionCodes:['system:admin'],roleCodes:['ADMIN']};
  await db.tsdOperation.create({data:{deviceId:code,operationKey:'monitor-heartbeat:'+code,operationType:'monitor_heartbeat',payload:{workerUserId:worker.id,monitorMessages:true}}});
  let service=new TsdMonitorMessages(db);
  const body={text:'Подойдите к упаковке',requestId:'12345678-1234-4123-8123-123456789012'};
  const [a,b]=await Promise.all([service.send(worker.deviceCode,body,admin),service.send(worker.deviceCode,body,admin)]);
  assert.equal(a.id,b.id);assert.equal(await db.tsdOperation.count({where:{operationType:'monitor_message'}}),1);
  assert.equal((await service.next(code,worker)).readAt,null);
  await db.$disconnect();db=new PrismaClient();service=new TsdMonitorMessages(db);
  assert.equal((await service.next(code,worker)).id,a.id);
  assert.equal(await service.next(code,{...worker,id:'another-user'}),null);
  await assert.rejects(service.ack(a.id,{...worker,id:'another-user'}));
  await assert.rejects(service.ack(a.id,{...worker,deviceCode:'TSD-INSTALL-OTHER'}));
  await Promise.all([service.ack(a.id,worker),service.ack(a.id,worker)]);
  const firstRead=(await service.list(worker.deviceCode,admin)).messages[0].readAt;
  assert.ok(firstRead);await service.ack(a.id,worker);
  assert.equal((await service.list(worker.deviceCode,admin)).messages[0].readAt,firstRead);
  assert.equal(await service.next(code,worker),null);
  assert.equal(await db.stockMovement.count(),0);assert.equal(await db.stockBalance.count(),0);
  console.log(JSON.stringify({result:'PASS',concurrentSendRows:1,explicitRead:true,reconnectPreserved:true,foreignAckRejected:true,stockWrites:0}));
 }finally{await db.$disconnect();}
})().catch(error=>{console.error(error.message);process.exitCode=1});
