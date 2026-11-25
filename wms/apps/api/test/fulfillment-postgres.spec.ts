import 'reflect-metadata';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {FulfillmentAnalyticsService} from '../src/modules/analytics/fulfillment.service';
import {ClientScopeService} from '../src/modules/auth/client-scope.service';
import type {AuthUser} from '../src/modules/auth/auth.types';
const url=process.env.FULFILLMENT_TEST_DATABASE_URL;
if(url&&url!=='postgresql://codex_tests@127.0.0.1:55488/fulfillment_tests')throw Error('Dedicated local fixture database only');
// TEST: real PostgreSQL executes the exact production SQL, including repeat DONE events and cross-client rows.
describe.skipIf(!url).sequential('fulfillment SQL integration',()=>{
 let p:PrismaClient,service:FulfillmentAnalyticsService;
 const user={id:'test',roleCodes:['CLIENT'],permissionCodes:[],clientScopeMode:'LIMITED',clientIds:['c'],writableClientIds:[]} as AuthUser;
 const q={clientId:'c',warehouseId:'w',channel:'FBS' as const,dateFrom:'2026-08-01',dateTo:'2026-10-31'};
 beforeAll(async()=>{
  vi.stubEnv('WMS_FULFILLMENT_ANALYTICS_ENABLED','true');p=new PrismaClient({datasources:{db:{url}}});
  // This schema is deliberately minimal; it models only columns read by this report.
  await p.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');await p.$executeRawUnsafe('CREATE SCHEMA public');
  const definitions=[
   '"Client" (id text PRIMARY KEY,name text,code text,"isDemo" boolean)',
   '"Warehouse" (id text PRIMARY KEY,name text)',
   '"WarehouseClient" ("clientId" text,"warehouseId" text)',
   '"Sku" (id text PRIMARY KEY,"clientId" text,name text,article text,size text,color text)',
   '"ClientRequest" (id text PRIMARY KEY,"clientId" text,"warehouseId" text,type text,status text)',
   '"ClientRequestEvent" ("requestId" text,"clientId" text,"statusTo" text,"createdAt" timestamp)',
   '"ClientRequestItem" ("requestId" text,"skuId" text,quantity int)',
   '"FbsOrderRequestLink" ("requestId" text,"clientId" text)',
   ...['FboAssembly','OzonFboShipment','YandexFbyShipment','LamodaFboAssembly'].map(t=>'"'+t+'" ("requestId" text)'),
   '"StockMovement" ("clientId" text,"warehouseId" text,"skuId" text,"boxId" text,type text,status text,quantity int,"sourceDocument" text,"createdAt" timestamp)',
   '"StockBalance" ("clientId" text,"warehouseId" text,"skuId" text,"boxId" text,status text,quantity int)',
   '"ReceiptStockIdentity" ("boxId" text,"receiptAt" timestamp)',
  ];for(const d of definitions)await p.$executeRawUnsafe('CREATE TABLE '+d);
  for(const sql of [
   `INSERT INTO "Client" VALUES ('c','Client','C',false),('other','Other','O',false)`,
   `INSERT INTO "Warehouse" VALUES ('w','FF'),('else','Other')`,
   `INSERT INTO "WarehouseClient" VALUES ('c','w'),('other','else')`,
   `INSERT INTO "Sku" VALUES ('a','c','A','AA',null,null),('b','c','B','BB',null,null),('foreign','other','Secret',null,null,null)`,
   `INSERT INTO "ClientRequest" VALUES ('fbs','c','w','OUTBOUND','DONE'),('old','c','w','OUTBOUND','DONE'),('fbo','c','w','OUTBOUND','DONE'),('other','c','w','OUTBOUND','DONE'),('pending','c','w','OUTBOUND','IN_WORK'),('cancelled','c','w','OUTBOUND','CANCELLED'),('secret','other','w','OUTBOUND','DONE'),('elsewhere','c','else','OUTBOUND','DONE')`,
   `INSERT INTO "ClientRequestEvent" VALUES ('fbs','c','DONE','2026-09-01'),('fbs','c','DONE','2026-09-02'),('old','c','DONE','2026-07-01'),('old','c','DONE','2026-09-01'),('fbo','c','DONE','2026-09-04'),('other','c','DONE','2026-09-05'),('secret','other','DONE','2026-09-01'),('elsewhere','c','DONE','2026-09-01')`,
   `INSERT INTO "FbsOrderRequestLink" VALUES ('fbs','c'),('fbs','c'),('old','c'),('secret','other'),('elsewhere','c')`,
   `INSERT INTO "FboAssembly" VALUES ('fbo')`,
   `INSERT INTO "ClientRequestItem" VALUES ('fbs','a',7),('fbs','a',3),('fbs',null,2),('old','a',100),('fbo','b',20),('other','a',50),('pending','a',10),('cancelled','a',999),('secret','foreign',888),('elsewhere','a',777)`,
   `INSERT INTO "StockBalance" VALUES ('c','w','a','box','AVAILABLE',60),('c','w','a','box','PACKING',5),('c','w','b',null,'AVAILABLE',3),('other','w','foreign',null,'AVAILABLE',999),('c','else','a',null,'AVAILABLE',333)`,
   `INSERT INTO "StockMovement" VALUES ('c','w','a','box','RECEIPT','AVAILABLE',75,null,'2026-08-01'),('c','w','a','box','SHIP','AVAILABLE',-10,'fbs','2026-09-01'),('c','w','b',null,'INITIAL_IMPORT','AVAILABLE',3,null,'2026-08-01')`,
  ])await p.$executeRawUnsafe(sql);
  service=new FulfillmentAnalyticsService(p as any,new ClientScopeService());
 });
 afterAll(async()=>{await p?.$disconnect();vi.unstubAllEnvs();});
 it('counts each first completion once, excludes other clients/warehouses and keeps quantities',async()=>{
  const result=await service.dashboard(q,user);expect(result.quality).toEqual({completedRequests:1,unclassifiedRequests:1,missingSkuUnits:2});
  expect(result.summary.shippedUnits).toBe(10);expect(result.items.find(i=>i.skuId==='a')).toMatchObject({receivedUnits:75,currentUnits:65,freeUnits:55,shipmentRequests:1,shippedStorageDays:31,shippedAgeCoveragePercent:100});
  expect(result.items.find(i=>i.skuId==='foreign')).toBeUndefined();
  expect(result.items.find(i=>i.skuId==='b')?.currentStorageDays).toBeNull();
  expect((await service.dashboard(q,user)).summary).toEqual(result.summary);
 });
 it('separates explicit FBO and leaves batch stock recommendation unknown',async()=>{
  const result=await service.dashboard({...q,channel:'FBO'},user);expect(result.summary.shippedUnits).toBe(20);expect(result.items.find(i=>i.skuId==='b')).toMatchObject({shipmentRequests:1,recommendedUnits:null});
 });
 it('retains scoped client/warehouse discovery without a WB connection',async()=>{expect(await service.clients(user)).toEqual([{id:'c',name:'Client',code:'C',warehouses:[{id:'w',name:'FF'}]}]);});
});
