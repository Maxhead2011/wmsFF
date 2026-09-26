import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayrollService } from '../src/modules/expenses/payroll.service';
const user = { id: 'admin', roleCodes: ['ADMIN'], warehouseIds: ['msk'], writableWarehouseIds: ['msk'] } as any;
const dto = { startTime: '18:00', endTime: '01:20', lunchMinutes: 60, rateKopecks: 25000, reason: 'Исправлено по отметке ухода' };
function setup(status = 'REVIEW') {
 const db: any = { payrollEmployee: { findFirst: vi.fn().mockResolvedValue({ id: 'e', warehouseId: 'msk' }) }, payrollHistorical: { findFirst: vi.fn().mockResolvedValue({ key: 'h', employeeId: 'e', status, amountKopecks: 0, data: { start: .75, end: 0, lunch: 0, rate: 250, paidTime: 0 }, workDate: '2026-08-10' }), update: vi.fn().mockImplementation(x => x.data) }, payrollSettlement: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() }, payrollAudit: { create: vi.fn() }, $queryRaw: vi.fn() };
 db.$transaction = (f: any) => f(db); return { db, service: new PayrollService(db) };
}
// TEST: historical time corrections preserve payment protection and an audit trail.
describe('historical time edits', () => {
 beforeEach(() => vi.stubEnv('WMS_PAYROLL_ATTENDANCE_ENABLED', 'true'));
 afterEach(() => vi.unstubAllEnvs());
 it('calculates overnight time with explicitly retained lunch and audits the original', async () => {
  const { db, service } = setup(); const result = await service.updateHistory('e', 'h', dto, user);
  expect(result.amountKopecks).toBe(158333); expect(result.status).toBe('REVIEW');
  expect(db.payrollAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: 'admin', action: 'HISTORY_UPDATED', details: expect.objectContaining({ before: expect.objectContaining({ amountKopecks: 0 }), reason: dto.reason }) }) }));
 });
 it('blocks paid records until explicitly moved to review', async () => {
  const { db, service } = setup('PAID'); await expect(service.updateHistory('e', 'h', dto, user)).rejects.toThrow('На проверке');
  expect(db.payrollHistorical.update).not.toHaveBeenCalled();
  db.payrollSettlement.findUnique.mockResolvedValue({ status: 'REVIEW' });
  await expect(service.updateHistory('e', 'h', dto, user)).resolves.toMatchObject({ status: 'REVIEW' });
 });
 it('rejects another employee, empty reason and excessive lunch', async () => {
  const { db, service } = setup(); await expect(service.updateHistory('e', 'h', { ...dto, reason: ' ' }, user)).rejects.toThrow();
  await expect(service.updateHistory('e', 'h', { ...dto, lunchMinutes: 1000 }, user)).rejects.toThrow();
  db.payrollHistorical.findFirst.mockResolvedValue(null); await expect(service.updateHistory('e', 'h', dto, user)).rejects.toThrow('не найдена');
 });
});
