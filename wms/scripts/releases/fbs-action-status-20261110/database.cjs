// TEST: real PostgreSQL leases and the scheduler selection query on synthetic data only.
const assert=require('node:assert/strict');require('reflect-metadata');
const {PrismaClient}=require('@prisma/client'),db=new PrismaClient();
const {claimMarketSlot,finishMarketSlot}=require('/app/apps/api/dist/modules/client-requests/market-status-schedule');
const {RequestMarketStatusScheduler}=require('/app/apps/api/dist/modules/client-requests/request-market-status-scheduler.service');
(async()=>{
 const slot='2026-11-10T08:00+03:00';
 const claims=await Promise.all([claimMarketSlot(db,'synthetic',slot),claimMarketSlot(db,'synthetic',slot)]);
 assert.equal(claims.filter(Boolean).length,1);
 await finishMarketSlot(db,'synthetic',claims.find(Boolean),true,'PACKED');
 assert.equal(await claimMarketSlot(db,'synthetic',slot),null);
 assert.ok(await claimMarketSlot(db,'synthetic','2026-11-10T12:00+03:00'));
 const scheduler=new RequestMarketStatusScheduler(db,{check(){throw Error('No real orders expected')}});
 let failed=false;scheduler.log={warn(){failed=true},log(){}};
 await scheduler.tick();scheduler.onModuleDestroy();assert.equal(failed,false);
 console.log('PASS PostgreSQL lease serialization, completed slot, next slot and scheduler query');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
