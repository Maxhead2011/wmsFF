import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { KizDuplicateService } from '../src/modules/print/kiz-duplicate.service';

const url=process.env.KIZ_DUPLICATE_TEST_DATABASE_URL;
if(url && !/^postgresql:\/\/codex_tests@127\.0\.0\.1:55469\/kiz_duplicate_tests/.test(url)) throw new Error('Dedicated local test database only');
describe.skipIf(!url).sequential('duplicate queue on real PostgreSQL',()=>{
 const p=new PrismaClient({datasources:{db:{url}}}),service=new KizDuplicateService(p as never);
 const ids={client:randomUUID(),warehouse:randomUUID(),user:randomUUID(),sku:randomUUID(),station:randomUUID(),mark:randomUUID(),job:randomUUID()};
 const raw="0104680992597663215(bfrY!Bf.IME\u001d91EE12\u001d92AbCd/0123+xyz=";
 const user:any={id:ids.user,name:'Тест',roleCodes:['OPERATOR'],permissionCodes:['print:write'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:ids.warehouse};
 const body={id:ids.job,clientId:ids.client,stationId:ids.station,skuId:ids.sku,kiz:raw,deviceCode:'test-device'};
 let previousFlag:string|undefined;
 beforeAll(async()=>{
  previousFlag=process.env.WMS_KIZ_DUPLICATE_ENABLED;process.env.WMS_KIZ_DUPLICATE_ENABLED='true';
  await p.warehouse.create({data:{id:ids.warehouse,code:ids.warehouse,name:'Test branch'}});
  await p.client.create({data:{id:ids.client,code:ids.client,name:'Test client'}});
  await p.warehouseClient.create({data:{warehouseId:ids.warehouse,clientId:ids.client}});
  await p.user.create({data:{id:ids.user,email:ids.user+'@test.invalid',passwordHash:'not-a-password',name:'Test user'}});
  await p.sku.create({data:{id:ids.sku,clientId:ids.client,internalSku:'test',name:'Костюм',article:'Корея_голубой',size:'L / 48',color:'голубой'}});
  await p.productMark.create({data:{id:ids.mark,clientId:ids.client,skuId:ids.sku,value:raw}});
  await p.fbsPrintStation.create({data:{id:ids.station,name:ids.station,agentKey:ids.station,printerName:'test',printerModel:'test'}});
  await service.heartbeat(ids.station,user);
 });
 afterAll(async()=>{
  await p.auditLog.deleteMany({where:{userId:ids.user}});await p.kizDuplicateJob.deleteMany({where:{requestedById:ids.user}});
  await p.kizDuplicatePrinter.deleteMany({where:{stationId:ids.station}});await p.fbsPrintStation.deleteMany({where:{id:ids.station}});
  await p.productMark.deleteMany({where:{id:ids.mark}});await p.sku.deleteMany({where:{id:ids.sku}});
  await p.warehouseClient.deleteMany({where:{clientId:ids.client}});await p.client.deleteMany({where:{id:ids.client}});
  await p.user.deleteMany({where:{id:ids.user}});await p.warehouse.deleteMany({where:{id:ids.warehouse}});
  await p.$disconnect();if(previousFlag===undefined)delete process.env.WMS_KIZ_DUPLICATE_ENABLED;else process.env.WMS_KIZ_DUPLICATE_ENABLED=previousFlag;
 });
 // TEST: exercise actual SQL matching, unique idempotency, transaction locks and audit persistence.
 it('matches the original KIZ and creates one job under concurrent retries',async()=>{
  expect(await service.lookup(body,user)).toMatchObject({state:'READY',match:'EXACT_KIZ'});
  const results=await Promise.all([service.create(body,user),service.create(body,user)]);
  expect(results.map(r=>r.id)).toEqual([ids.job,ids.job]);
  expect(await p.kizDuplicateJob.count({where:{id:ids.job}})).toBe(1);
  expect(await p.auditLog.count({where:{entityId:ids.job,action:'KIZ_DUPLICATE_QUEUED'}})).toBe(1);
 },15000);
 it('hands a job to only one simultaneous agent poll and never reclaims it',async()=>{
  const results=await Promise.all([service.claim(ids.station,user),service.claim(ids.station,user)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  await p.kizDuplicateJob.update({where:{id:ids.job},data:{claimedAt:new Date(0)}});
  expect(await service.claim(ids.station,user)).toBeNull();
 });
 it('records one result and verifies full bytes without changing stock or marks',async()=>{
  const before=await p.productMark.findUnique({where:{id:ids.mark}});
  await Promise.all([service.finish(ids.station,ids.job,true,null,user),service.finish(ids.station,ids.job,true,null,user)]);
  expect(await p.auditLog.count({where:{entityId:ids.job,action:'KIZ_DUPLICATE_PRINTED'}})).toBe(1);
  await expect(service.verify(ids.job,raw+'x',user)).rejects.toThrow('не совпадает');
  await service.verify(ids.job,raw,user);
  expect((await service.status(ids.job,user)).status).toBe('VERIFIED');
  expect(await p.productMark.findUnique({where:{id:ids.mark}})).toEqual(before);
  expect(await p.stockMovement.count({where:{clientId:ids.client}})).toBe(0);
  expect(await p.fbsTsdAssembly.count({where:{clientId:ids.client}})).toBe(0);
 });
});
