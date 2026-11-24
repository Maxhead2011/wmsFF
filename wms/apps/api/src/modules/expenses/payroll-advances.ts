import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';

export const payrollAdvancesEnabled = () => process.env.WMS_PAYROLL_ADVANCES_ENABLED === 'true';
export function requirePayrollAdvances() { if (!payrollAdvancesEnabled()) throw new NotFoundException('Авансы ФОТ не включены.'); }
type Tx = Pick<PrismaService, '$queryRaw' | '$executeRaw' | 'payrollAudit'>;
export type Advance = { id:string; employeeId:string; warehouseId:string; issuedDate:string; amountKopecks:number; remainingKopecks:number; kind:string; reason:string; cancelledAt:Date|null };
type Allocation = { advanceId:string; settlementKey:string; amountKopecks:number };
export const payrollPaymentHash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// FIX: allocate a shared employee balance once across explicit selected earning rows.
export function planPayrollAdvances(rows:Array<{key:string;rootId:string;amountKopecks:number}>, advances:Array<{id:string;rootId:string;remainingKopecks:number}>) {
  const allocations:Allocation[]=[];const balances=new Map(advances.map(a=>[a.id,a.remainingKopecks]));
  if(new Set(rows.map(r=>r.key)).size!==rows.length||new Set(advances.map(a=>a.id)).size!==advances.length)throw new BadRequestException('Повторные строки выплаты.');
  let grossKopecks=0,deductedKopecks=0;
  for(const r of rows){if(!Number.isSafeInteger(r.amountKopecks)||r.amountKopecks<0)throw new BadRequestException('Некорректная сумма начисления.');grossKopecks+=r.amountKopecks;let available=r.amountKopecks;
    for(const a of advances.filter(a=>a.rootId===r.rootId)){const balance=balances.get(a.id)!;if(!Number.isSafeInteger(balance)||balance<0)throw new BadRequestException('Некорректный остаток аванса.');const amount=Math.min(available,balance);if(!amount)continue;allocations.push({advanceId:a.id,settlementKey:r.key,amountKopecks:amount});available-=amount;balances.set(a.id,balance-amount);deductedKopecks+=amount;}
  }
  if(!Number.isSafeInteger(grossKopecks)||!Number.isSafeInteger(deductedKopecks))throw new BadRequestException('Слишком большая сумма.');
  return {grossKopecks,deductedKopecks,netKopecks:grossKopecks-deductedKopecks,allocations};
}
export async function payrollAdvanceRows(tx:Tx,employeeIds:string[]):Promise<Advance[]> {
  if(!employeeIds.length)return [];
  return tx.$queryRaw<Advance[]>`SELECT a.*, (a."amountKopecks"-COALESCE((SELECT SUM(u."amountKopecks") FROM "PayrollAdvanceUse" u WHERE u."advanceId"=a.id AND u."reversedAt" IS NULL),0))::int AS "remainingKopecks" FROM "PayrollAdvance" a WHERE a."employeeId" IN (${Prisma.join(employeeIds)}) ORDER BY a."issuedDate",a."createdAt",a.id`;
}
export async function createPayrollAdvance(tx:Tx,data:{id:string;employeeId:string;warehouseId:string;issuedDate:string;amountKopecks:number;kind:string;reason:string;actorId:string}) {
  if(!/^[0-9a-f-]{36}$/i.test(data.id)||!/^\d{4}-\d{2}-\d{2}$/.test(data.issuedDate)||!Number.isSafeInteger(data.amountKopecks)||data.amountKopecks<=0||data.amountKopecks>2147483647||!data.reason.trim()||data.reason.length>1000)throw new BadRequestException('Проверьте дату, сумму и основание аванса.');
  const old=await tx.$queryRaw<Advance[]>`SELECT * FROM "PayrollAdvance" WHERE id=${data.id}`;
  if(old.length){const o=old[0];if(o.employeeId!==data.employeeId||o.warehouseId!==data.warehouseId||o.amountKopecks!==data.amountKopecks||o.issuedDate!==data.issuedDate||o.kind!==data.kind||o.reason!==data.reason||o.cancelledAt)throw new BadRequestException('Идентификатор уже использован для другого аванса.');return o;}
  await tx.$executeRaw`INSERT INTO "PayrollAdvance" (id,"employeeId","warehouseId","issuedDate","amountKopecks",kind,reason,"createdById") VALUES (${data.id},${data.employeeId},${data.warehouseId},${data.issuedDate},${data.amountKopecks},${data.kind},${data.reason},${data.actorId})`;
  await tx.payrollAudit.create({data:{warehouseId:data.warehouseId,actorId:data.actorId,entityId:data.employeeId,action:'ADVANCE_CREATED',details:data}});
  return data;
}
export async function applyPayrollAdvances(tx:Tx,allocations:Allocation[],runId:string) {
  for(const a of allocations)await tx.$executeRaw`INSERT INTO "PayrollAdvanceUse" (id,"advanceId","settlementKey","amountKopecks","runId") VALUES (${randomUUID()},${a.advanceId},${a.settlementKey},${a.amountKopecks},${runId})`;
}
export async function reversePayrollAdvances(tx:Tx,keys:string[]) {
  if(keys.length)await tx.$executeRaw`UPDATE "PayrollAdvanceUse" SET "reversedAt"=now() WHERE "settlementKey" IN (${Prisma.join(keys)}) AND "reversedAt" IS NULL`;
}
