import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WbStockSyncWorker, withWbStockPlan, captureWbStockPlan, assertFreshWbStockPlan, registerWbStockPlan } from '../src/modules/marketplace-connections/wb-stock-sync-queue';
const url = process.env.KIZ_DUPLICATE_TEST_DATABASE_URL;
if (url && !/^postgresql:\/\/codex_tests@127\.0\.0\.1:55485\/kiz_duplicate_tests(?:\?|$)/.test(url)) throw new Error('Dedicated local test database only');
describe.skipIf(!url).sequential('independent WB committed events', () => {
 const db = new PrismaClient({ datasources: { db: { url } } });
 const clientId=randomUUID(), skuId=randomUUID(), otherSku=randomUUID(), key='marketplace.wbUrgentSync.enabled';
 const events=()=>db.$queryRaw<any[]>`SELECT * FROM "WbStockSyncEvent" WHERE "clientId"=${clientId} AND "processedAt" IS NULL ORDER BY id`;
 const create=(tx:any,sku=skuId)=>{const id=randomUUID();return tx.stockBalance.create({data:{id,balanceKey:id,clientId,skuId:sku,status:'AVAILABLE',quantity:1}});};
 beforeAll(async()=>{
  for(const name of ['20260919180000_wb_stock_sync_queue','20260919190000_wb_stock_independent_events']) {
   const sql=readFileSync(resolve('prisma/migrations/'+name+'/migration.sql'),'utf8').replace(/--[^\n]*/g,'');
   const fn=sql.match(/CREATE OR REPLACE FUNCTION[\s\S]*?END \$\$;/)![0];const [a,b]=sql.split(fn);
   for(const s of a.split(';').filter(s=>s.trim()))await db.$executeRawUnsafe(s);
   await db.$executeRawUnsafe(fn);
   for(const s of b.split(';').filter(s=>s.trim()))await db.$executeRawUnsafe(s);
  }
  await db.client.create({data:{id:clientId,code:clientId,name:'queue test'}});
  for(const id of [skuId,otherSku])await db.sku.create({data:{id,clientId,internalSku:id,name:'test'}});
  await db.systemSetting.upsert({where:{key},create:{key,value:true},update:{value:true}});vi.stubEnv('WMS_WB_URGENT_STOCK_SYNC','true');
 });
 afterAll(async()=>{
  await db.systemSetting.deleteMany({where:{key}});await db.stockBalance.deleteMany({where:{clientId}});
  await db.auditLog.deleteMany({where:{entityId:clientId}});
  await db.$executeRaw`DELETE FROM "WbStockSyncEvent" WHERE "clientId"=${clientId}`;
  await db.$executeRaw`DELETE FROM "WbStockSyncQueue" WHERE "clientId"=${clientId}`;
  await db.sku.deleteMany({where:{clientId}});await db.client.delete({where:{id:clientId}});await db.$disconnect();vi.unstubAllEnvs();
 });
 // TEST: rolled-back warehouse operations do not schedule publication.
 it('records only committed events and ignores unchanged quantity',async()=>{
  await expect(db.$transaction(async t=>{await create(t);throw Error('rollback');})).rejects.toThrow('rollback');
  expect(await events()).toHaveLength(0);const b=await create(db);expect(await events()).toHaveLength(1);
  await db.stockBalance.update({where:{id:b.id},data:{quantity:1}});expect(await events()).toHaveLength(1);
 });
 // TEST: reproduces production hot-row contention using overlapping SERIALIZABLE scans.
 it('allows unrelated concurrent scans for one client without a shared row write',async()=>{
  let release!:()=>void,ready!:()=>void;const wait=new Promise<void>(r=>release=r),started=new Promise<void>(r=>ready=r);
  const first=db.$transaction(async t=>{await create(t);ready();await wait;},{isolationLevel:'Serializable',timeout:10000});
  await started;
  try {await db.$transaction(async t=>{await t.$executeRawUnsafe("SET LOCAL lock_timeout = '1s'");await create(t,otherSku);},{isolationLevel:'Serializable',timeout:5000});}
  finally{release();await first;}
 });
 // TEST: a transaction can allocate an earlier sequence and commit after the worker snapshot.
 it('detects late commits and preserves their events even below the processed sequence',async()=>{
  let release!:()=>void,ready!:()=>void;const wait=new Promise<void>(r=>release=r),started=new Promise<void>(r=>ready=r);
  const early=db.$transaction(async t=>{await create(t);ready();await wait;},{timeout:15000});await started;
  try {
   await create(db,otherSku);
   await withWbStockPlan(clientId,async()=>{
    await captureWbStockPlan(db as any,clientId);registerWbStockPlan(new Map([[skuId,{chrtId:1}]]),new Map());
    await new WbStockSyncWorker(db as any,async()=>{},vi.fn()).tick();
    release();await early;
    await expect(assertFreshWbStockPlan(db as any,clientId,[1])).rejects.toThrow();
    expect((await events()).length).toBeGreaterThan(0);
   });
  }finally{release();await early;}
 });
 // TEST: changed unrelated stock must not starve a valid send, but relabel source changes must.
 it('validates the complete relabel pool and ignores unrelated scans',async()=>{
  await withWbStockPlan(clientId,async()=>{
   await captureWbStockPlan(db as any,clientId);registerWbStockPlan(new Map([['target',{chrtId:10}]]),new Map([['target',{sources:[{skuId}]}]]));
   await create(db,otherSku);await assertFreshWbStockPlan(db as any,clientId,[10]);
   await create(db,skuId);await expect(assertFreshWbStockPlan(db as any,clientId,[10])).rejects.toThrow();
  });
 });
 // TEST: lease exclusion, crash recovery and retry preserve unprocessed committed work.
 it('leases once, recovers expiry and retries a failed send',async()=>{
  let release!:()=>void,ready!:()=>void;const wait=new Promise<void>(r=>release=r),started=new Promise<void>(r=>ready=r);
  const sync=vi.fn(async()=>{ready();await wait;});const first=new WbStockSyncWorker(db as any,sync,vi.fn()).tick();await started;
  await new WbStockSyncWorker(db as any,sync,vi.fn()).tick();expect(sync).toHaveBeenCalledTimes(1);release();await first;
  await create(db);await db.$executeRaw`UPDATE "WbStockSyncQueue" SET "leaseToken"='crashed',"leaseUntil"=now()-interval '1 second' WHERE "clientId"=${clientId}`;
  await new WbStockSyncWorker(db as any,async()=>{throw Error('timeout');},vi.fn()).tick();expect((await events()).length).toBeGreaterThan(0);
  await db.$executeRaw`UPDATE "WbStockSyncQueue" SET "nextAttemptAt"=now() WHERE "clientId"=${clientId}`;
  await new WbStockSyncWorker(db as any,async()=>{},vi.fn()).tick();expect(await events()).toHaveLength(0);
 });
});
