import 'reflect-metadata';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {PrismaClient} from '@prisma/client';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {PayrollService} from '../src/modules/expenses/payroll.service';
const Tested:typeof PayrollService=process.env.PAYROLL_CANDIDATE_SERVICE?createRequire(import.meta.url)(process.env.PAYROLL_CANDIDATE_SERVICE).PayrollService:PayrollService;
const url=process.env.ATTENDANCE_TEST_DATABASE_URL;
if(url&&url!=='postgresql://codex_payroll@127.0.0.1:55487/payroll_tests')throw Error('Dedicated local payroll database only');
// TEST: real transactions exercise money, stale previews, rollback, repeat calls and paid-shift recovery.
describe.skipIf(!url).sequential('advance ledger PostgreSQL',()=>{
 let db:PrismaClient,svc:PayrollService;const old=[process.env.WMS_PAYROLL_ATTENDANCE_ENABLED,process.env.WMS_PAYROLL_ADVANCES_ENABLED,process.env.WMS_PAYROLL_CORRECTIONS_ENABLED];
 beforeAll(()=>{process.env.WMS_PAYROLL_ATTENDANCE_ENABLED='true';process.env.WMS_PAYROLL_ADVANCES_ENABLED='true';process.env.WMS_PAYROLL_CORRECTIONS_ENABLED='true';db=new PrismaClient({datasources:{db:{url:url!}}});svc=new Tested(db as never);});
 afterAll(async()=>{await db.$disconnect();['WMS_PAYROLL_ATTENDANCE_ENABLED','WMS_PAYROLL_ADVANCES_ENABLED','WMS_PAYROLL_CORRECTIONS_ENABLED'].forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];});});
 async function setup(amount=600000){const id=randomUUID(),w=randomUUID(),key=randomUUID();const user:any={id:'advance-test',roleCodes:['ADMIN'],warehouseIds:[w],writableWarehouseIds:[w]};await db.payrollEmployee.create({data:{id,name:'Advance test',warehouseId:w}});await db.payrollHistorical.create({data:{key,employeeId:id,warehouseId:w,workDate:'2026-11-01',amountKopecks:amount,status:'UNPAID',data:{paidTime:1,lunch:0,rate:100},sourceHash:'test',createdById:user.id}});const dto={entries:[{employeeId:id,keys:[`HISTORY:${key}`]}],dateFrom:'2026-11-01',dateTo:'2026-11-01',status:'PAID',comment:'test',expectedAmountKopecks:amount};return {id,w,key,user,dto};}
 it('consumes once, repeats safely, and restores credit on payout reversal',async()=>{
  const x=await setup();const credit={operationId:randomUUID(),issuedDate:'2026-10-20',amountKopecks:438439,reason:'cash'};
  await svc.addAdvance(x.id,credit,x.user);await svc.addAdvance(x.id,credit,x.user);
  expect(await svc.advances(x.user)).toHaveLength(1);
  const preview=await svc.previewPayment(x.dto,x.user);expect(preview.netKopecks).toBe(161561);
  const request={...x.dto,operationId:randomUUID(),previewHash:preview.previewHash};
  const paid:any=await svc.setStatusBatch(request,x.user);expect(paid.netKopecks).toBe(161561);
  expect(await svc.setStatusBatch(request,x.user)).toEqual(paid);
  expect((await svc.advances(x.user))[0].remainingKopecks).toBe(0);
  await expect(svc.cancelAdvance(credit.operationId,'mistake',x.user)).rejects.toThrow();
  await svc.setStatusBatch({...x.dto,status:'UNPAID'},x.user);
  expect((await svc.advances(x.user))[0].remainingKopecks).toBe(438439);
  const next=await svc.previewPayment(x.dto,x.user);expect(next.netKopecks).toBe(161561);
 });
 it('rejects a stale preview and leaves earnings and advances untouched',async()=>{
  const x=await setup();const preview=await svc.previewPayment(x.dto,x.user);
  await svc.addAdvance(x.id,{operationId:randomUUID(),issuedDate:'2026-11-02',amountKopecks:10000,reason:'cash'},x.user);
  await expect(svc.setStatusBatch({...x.dto,operationId:randomUUID(),previewHash:preview.previewHash},x.user)).rejects.toThrow();
  expect(await db.payrollSettlement.findUnique({where:{key:`HISTORY:${x.key}`}})).toBeNull();expect((await svc.advances(x.user))[0].remainingKopecks).toBe(10000);
 });
 it('carries excess forward and refuses a foreign branch',async()=>{
  const x=await setup(100000);await svc.addAdvance(x.id,{operationId:randomUUID(),issuedDate:'2026-11-02',amountKopecks:438439,reason:'cash'},x.user);
  const preview=await svc.previewPayment(x.dto,x.user);expect(preview.netKopecks).toBe(0);await svc.setStatusBatch({...x.dto,operationId:randomUUID(),previewHash:preview.previewHash},x.user);
  expect((await svc.advances(x.user))[0].remainingKopecks).toBe(338439);
  await expect(svc.addAdvance(x.id,{operationId:randomUUID(),issuedDate:'2026-11-02',amountKopecks:1,reason:'foreign'},{...x.user,warehouseIds:[],writableWarehouseIds:[]})).rejects.toThrow();
 });
 it('serializes concurrent payouts without consuming the same balance twice',async()=>{
  const x=await setup();await svc.addAdvance(x.id,{operationId:randomUUID(),issuedDate:'2026-11-02',amountKopecks:100000,reason:'cash'},x.user);const preview=await svc.previewPayment(x.dto,x.user);
  const requests=[1,2].map(()=>({...x.dto,operationId:randomUUID(),previewHash:preview.previewHash}));
  const result=await Promise.allSettled(requests.map(r=>svc.setStatusBatch(r,x.user)));expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const used:any[]=await db.$queryRaw`SELECT * FROM "PayrollAdvanceUse" WHERE "settlementKey"=${`HISTORY:${x.key}`} AND "reversedAt" IS NULL`;expect(used).toHaveLength(1);expect(used[0].amountKopecks).toBe(100000);
 });
 it('preserves the original paid amount and creates exactly the agreed recovery credit',async()=>{
  const x=await setup();const owner={...x.user,roleCodes:['OWNER']};await db.payrollCondition.create({data:{employeeId:x.id,kind:'HOURLY',startsAt:new Date('2026-01-01'),rateKopecks:35000,reason:'test',createdById:owner.id}});
  const shift=await db.payrollShift.create({data:{employeeId:x.id,startsAt:new Date('2026-11-07T07:00:05.457Z'),endsAt:new Date('2026-11-08T06:38:02.486Z'),workDate:'2026-11-07',source:'TABLET',createdById:owner.id}});
  const report=await svc.report(x.id,'2026-11-07','2026-11-07',owner);const row=report.rows[0];expect(row.amountKopecks).toBe(792138);
  await db.payrollSettlement.create({data:{key:row.key,employeeId:x.id,warehouseId:x.w,workDate:'2026-11-07',status:'PAID',snapshot:JSON.parse(JSON.stringify(row)),comment:'paid',paidAt:new Date('2026-11-12'),updatedById:owner.id}});
  const dto={operationId:randomUUID(),endsAt:'2026-11-07T18:06:25.966Z',expectedVersion:shift.version,expectedCreditKopecks:438439,reason:'Confirmed departure with colleague'};
  await expect(svc.correctPaidShiftWithCredit(x.id,shift.id,{...dto,expectedCreditKopecks:438400},owner)).rejects.toThrow();
  expect((await db.payrollShift.findUniqueOrThrow({where:{id:shift.id}})).endsAt!.toISOString()).toBe('2026-11-08T06:38:02.486Z');
  await svc.correctPaidShiftWithCredit(x.id,shift.id,dto,owner);await svc.correctPaidShiftWithCredit(x.id,shift.id,dto,owner);
  const paid:any=await db.payrollSettlement.findUniqueOrThrow({where:{key:row.key}});expect(paid.status).toBe('PAID');expect(paid.snapshot.amountKopecks).toBe(353699);expect(paid.snapshot.paymentCorrection.originalPaidAmountKopecks).toBe(792138);
  expect((await svc.advances(x.user)).map(a=>a.amountKopecks)).toEqual([438439]);
 });
});
