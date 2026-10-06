import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PayrollService } from '../src/modules/expenses/payroll.service';
const TestedService: typeof PayrollService = process.env.PAYROLL_CANDIDATE_SERVICE ? createRequire(import.meta.url)(process.env.PAYROLL_CANDIDATE_SERVICE).PayrollService : PayrollService;
const url = process.env.ATTENDANCE_TEST_DATABASE_URL;
if (url && url !== 'postgresql://codex_payroll@127.0.0.1:55487/payroll_tests') throw Error('Dedicated local payroll database only');
// TEST: real PostgreSQL transactions preserve time/lunch while moving a tablet shift and undoing the correction.
describe.skipIf(!url).sequential('payroll reversible corrections', () => {
  let db: PrismaClient, svc: PayrollService, a: string, b: string, w: string, user: any;
  const flags = [process.env.WMS_PAYROLL_ATTENDANCE_ENABLED, process.env.WMS_PAYROLL_CORRECTIONS_ENABLED];
  beforeAll(async () => {
    process.env.WMS_PAYROLL_ATTENDANCE_ENABLED = 'true'; process.env.WMS_PAYROLL_CORRECTIONS_ENABLED = 'true';
    db = new PrismaClient({ datasources: { db: { url: url! } } }); svc = new TestedService(db as never);
    w = randomUUID(); a = randomUUID(); b = randomUUID(); user = { id: 'correction-test', roleCodes: ['ADMIN'], warehouseIds: [w], writableWarehouseIds: [w] };
    for (const id of [a, b]) await db.payrollEmployee.create({ data: { id, name: id, warehouseId: w, rates: { create: { kind: 'HOURLY', startsAt: new Date('2026-01-01'), rateKopecks: id === a ? 30000 : 40000, reason: 'test', createdById: user.id } } } });
  });
  afterAll(async () => { await db?.$disconnect(); for (const [i, key] of ['WMS_PAYROLL_ATTENDANCE_ENABLED', 'WMS_PAYROLL_CORRECTIONS_ENABLED'].entries()) { if (flags[i] === undefined) delete process.env[key]; else process.env[key] = flags[i]; } });
  it('moves a closed shift with its lunch and restores it through history', async () => {
    const startsAt = '2026-10-01T06:00:00.123Z', endsAt = '2026-10-01T15:00:00.456Z';
    const shift = await svc.addShift(a, { startsAt, endsAt, reason: 'test' }, user);
    await db.payrollBreak.create({ data: { id: randomUUID(), shiftId: shift.id, startsAt: new Date('2026-10-01T10:00Z'), endsAt: new Date('2026-10-01T10:30Z') } });
    await svc.updateShift(a, shift.id, { startsAt, endsAt, reason: 'Wrong tablet identity', employeeId: b, expectedVersion: shift.version } as any, user);
    expect(await db.payrollShift.findUnique({ where: { id: shift.id } })).toMatchObject({ employeeId: b, startsAt: new Date(startsAt), endsAt: new Date(endsAt) });
    expect((await svc.report(a, '2026-10-01', '2026-10-01', user)).rows).toHaveLength(0);
    expect((await svc.report(b, '2026-10-01', '2026-10-01', user)).rows[0]).toMatchObject({ lunchMs: 1800000 });
    const audit = await db.payrollAudit.findFirstOrThrow({ where: { entityId: shift.id, action: 'SHIFT_CORRECTED' } });
    await (svc as any).undoCorrection(audit.id, 'Вернуть исходную запись', user);
    expect(await db.payrollShift.findUnique({ where: { id: shift.id } })).toMatchObject({ employeeId: a, startsAt: new Date(startsAt), endsAt: new Date(endsAt) });
    await expect((svc as any).undoCorrection(audit.id, 'Повтор', user)).rejects.toThrow();
  });
  it('restores changed shift times and the exact manual lunch override', async () => {
    const original = { startsAt: '2026-10-02T06:00:00.123Z', endsAt: '2026-10-02T15:00:00.456Z', lunchMinutes: 45, reason: 'test' };
    const shift = await svc.addShift(a, original, user);
    await svc.updateShift(a, shift.id, { ...original, endsAt: '2026-10-02T16:00:00.456Z', lunchMinutes: 30, reason: 'Correction' }, user);
    const entry = await db.payrollAudit.findFirstOrThrow({ where: { entityId: shift.id, action: 'SHIFT_CORRECTED' } });
    await (svc as any).undoCorrection(entry.id, 'Undo time correction', user);
    expect(await db.payrollShift.findUnique({ where: { id: shift.id } })).toMatchObject({ endsAt: new Date(original.endsAt) });
    expect(await db.payrollWorkDay.findUnique({ where: { employeeId_workDate: { employeeId: a, workDate: '2026-10-02' } } })).toMatchObject({ lunchMinutes: 45 });
  });
  it('moves participants and quantities of confirmed unpaid handling and undoes the complete operation', async () => {
    const dto = { warehouseId: w, startsAt: '2026-10-03T06:00:00.123Z', operation: 'UNLOAD', palletCount: 1, boxCount: 16, bagCount: 5, rollCount: 30, employeeIds: [a], reason: 'test' };
    const op = await svc.addHandling(dto, user); await svc.confirmHandling(op.id, user);
    const before = await db.payrollHandling.findUniqueOrThrow({ where: { id: op.id }, include: { shares: true } });
    const report = await svc.report(a, '2026-10-03', '2026-10-03', user);
    await svc.changeHandling(op.id, { ...dto, employeeIds: [b], boxCount: 32, startsAt: '2026-10-03T07:00:00.123Z', operation: 'LOAD', expectedState: (report.rows.find(r => r.kind === 'PALLET')!.detail as any).correctionToken, reason: 'Wrong person and volume' } as any, user);
    expect(await db.payrollHandling.findUnique({ where: { id: op.id }, include: { shares: true } })).toMatchObject({ status: 'REVIEW', boxCount: 32, shares: [{ employeeId: b, amountKopecks: null }] });
    const entry = await db.payrollAudit.findFirstOrThrow({ where: { entityId: op.id, action: 'HANDLING_CORRECTED' } });
    await (svc as any).undoCorrection(entry.id, 'Undo work correction', user);
    expect(await db.payrollHandling.findUnique({ where: { id: op.id }, include: { shares: true } })).toEqual(before);
  });
  it('blocks foreign branches, wrong demo scope and disabled corrections', async () => {
    const shift = await svc.addShift(a, { startsAt: '2026-10-04T06:00Z', endsAt: '2026-10-04T15:00Z', reason: 'test' }, user);
    const foreign = await db.payrollEmployee.create({ data: { name: 'foreign', warehouseId: randomUUID() } });
    const demo = await db.payrollEmployee.create({ data: { name: 'demo', warehouseId: w, isDemo: true } });
    for (const employeeId of [foreign.id, demo.id]) await expect(svc.updateShift(a, shift.id, { startsAt: shift.startsAt.toISOString(), endsAt: shift.endsAt!.toISOString(), employeeId, reason: 'test' } as any, user)).rejects.toThrow();
    process.env.WMS_PAYROLL_CORRECTIONS_ENABLED = 'false';
    try { await expect(svc.updateShift(a, shift.id, { startsAt: shift.startsAt.toISOString(), endsAt: shift.endsAt!.toISOString(), employeeId: b, reason: 'test' } as any, user)).rejects.toThrow(); }
    finally { process.env.WMS_PAYROLL_CORRECTIONS_ENABLED = 'true'; }
    expect(await db.payrollShift.findUnique({ where: { id: shift.id } })).toMatchObject({ employeeId: a });
  });
  it('rejects overlapping targets, stale versions and open shifts without partial updates', async () => {
    const dto = { startsAt: '2026-10-05T06:00Z', endsAt: '2026-10-05T15:00Z', reason: 'test' };
    const shift = await svc.addShift(a, dto, user); await svc.addShift(b, dto, user);
    await expect(svc.updateShift(a, shift.id, { ...dto, employeeId: b } as any, user)).rejects.toThrow('пересекается');
    await expect(svc.updateShift(a, shift.id, { ...dto, expectedVersion: 99 } as any, user)).rejects.toThrow('изменена');
    const open = await svc.addShift(a, { startsAt: '2026-10-06T06:00Z', reason: 'test' }, user);
    await expect(svc.updateShift(a, open.id, { startsAt: '2026-10-06T06:00Z', employeeId: b, reason: 'test' } as any, user)).rejects.toThrow('закрытую');
    expect(await db.payrollAudit.count({ where: { entityId: { in: [shift.id, open.id] }, action: 'SHIFT_CORRECTED' } })).toBe(0);
  });
  it('rejects edits of paid shifts and undo after a later change or payment', async () => {
    const dto = { startsAt: '2026-09-20T06:00Z', endsAt: '2026-09-20T15:00Z', reason: 'test' };
    const shift = await svc.addShift(a, dto, user);
    await svc.updateShift(a, shift.id, { ...dto, endsAt: '2026-09-20T16:00Z' }, user);
    const entry = await db.payrollAudit.findFirstOrThrow({ where: { entityId: shift.id, action: 'SHIFT_CORRECTED' } });
    await svc.updateShift(a, shift.id, { ...dto, endsAt: '2026-09-20T17:00Z' }, user);
    await expect((svc as any).undoCorrection(entry.id, 'Cannot overwrite newer edit', user)).rejects.toThrow('изменились');
    await db.payrollSettlement.update({ where: { key: `WORK:${a}:2026-09-20` }, data: { status: 'PAID' } });
    await expect(svc.updateShift(a, shift.id, dto, user)).rejects.toThrow('оплачена');
    await expect((svc as any).undoCorrection(entry.id, 'Cannot overwrite payment', user)).rejects.toThrow('оплачена');
  });
  it('rolls back invalid lunch and rejects changes excluding actual breaks', async () => {
    const dto = { startsAt: '2026-09-21T06:00Z', endsAt: '2026-09-21T15:00Z', reason: 'test' };
    const shift = await svc.addShift(a, dto, user);
    await db.payrollBreak.create({ data: { id: randomUUID(), shiftId: shift.id, startsAt: new Date('2026-09-21T10:00Z'), endsAt: new Date('2026-09-21T11:00Z') } });
    await expect(svc.updateShift(a, shift.id, { ...dto, employeeId: b, lunchMinutes: 9999 } as any, user)).rejects.toThrow('Обед');
    expect(await db.payrollShift.findUnique({ where: { id: shift.id } })).toMatchObject({ employeeId: a, version: shift.version });
    await expect(svc.updateShift(a, shift.id, { ...dto, endsAt: '2026-09-21T09:00Z' }, user)).rejects.toThrow('обеда');
  });
  it('lists visible history with actor and marks undo while protecting demo and warehouse scope', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const history = await (svc as any).correctionHistory(today, today, undefined, user);
    expect(history.entries.some((e: any) => e.action === 'SHIFT_CORRECTED' && e.undone && !e.canUndo)).toBe(true);
    expect(history.entries.some((e: any) => e.action === 'CORRECTION_UNDONE')).toBe(true);
    expect((await (svc as any).correctionHistory(today, today, undefined, { ...user, warehouseIds: [] })).entries).toEqual([]);
    expect((await (svc as any).correctionHistory(today, today, undefined, { ...user, isDemo: true })).entries).toEqual([]);
    const entry = history.entries.find((e: any) => e.canUndo);
    if (entry) await expect((svc as any).undoCorrection(entry.id, 'Unauthorized', { ...user, writableWarehouseIds: [] })).rejects.toThrow();
  });
  it('protects paid handling and rejects concurrent stale correction forms', async () => {
    const dto = { warehouseId: w, startsAt: '2026-09-22T06:00:00Z', operation: 'UNLOAD', palletCount: 1, employeeIds: [a], reason: 'test' };
    const op = await svc.addHandling(dto, user); await svc.confirmHandling(op.id, user);
    let report = await svc.report(a, '2026-09-22', '2026-09-22', user);
    const expectedState = (report.rows.find(r => r.kind === 'PALLET')!.detail as any).correctionToken;
    const outcomes = await Promise.allSettled([2, 3].map(palletCount => svc.changeHandling(op.id, { ...dto, palletCount, expectedState } as any, user)));
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await svc.confirmHandling(op.id, user);
    report = await svc.report(a, '2026-09-22', '2026-09-22', user);
    await svc.setStatus({ employeeId: a, dateFrom: '2026-09-22', dateTo: '2026-09-22', status: 'PAID', comment: 'Paid test', keys: report.rows.filter(r => r.kind === 'PALLET').map(r => r.key) }, user);
    await expect(svc.changeHandling(op.id, { ...dto, employeeIds: [b] }, user)).rejects.toThrow('оплачена');
    const entry = await db.payrollAudit.findFirstOrThrow({ where: { entityId: op.id, action: 'HANDLING_CORRECTED' } });
    await expect((svc as any).undoCorrection(entry.id, 'Do not reverse paid amount', user)).rejects.toThrow('оплачена');
  });
});
