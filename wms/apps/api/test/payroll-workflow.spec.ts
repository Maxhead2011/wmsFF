import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayrollService } from '../src/modules/expenses/payroll.service';
import type { AuthUser } from '../src/modules/auth/auth.types';
const user = { id: 'admin', roleCodes: ['ADMIN'], warehouseIds: ['msk'], writableWarehouseIds: ['msk'] } as AuthUser;
function setup() {
  const db: any = { payrollEmployee: { findFirst: vi.fn().mockResolvedValue({ id: 'e', warehouseId: 'msk' }) },
    payrollShift: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 's' }) },
    payrollSettlement: { findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    payrollHistorical: { findFirst: vi.fn().mockResolvedValue(null) },
    payrollAudit: { create: vi.fn() }, $queryRaw: vi.fn() };
  db.$transaction = (fn: (t: any) => any) => fn(db);
  return { db, service: new PayrollService(db) };
}
// TEST: mutations must be blocked before they can change a paid or overlapping day.
describe('payroll workflow', () => {
  beforeEach(() => vi.stubEnv('WMS_PAYROLL_ATTENDANCE_ENABLED', 'true'));
  afterEach(() => vi.unstubAllEnvs());
  const shift = { startsAt: '2026-09-26T09:00:00+03:00', endsAt: '2026-09-26T18:00:00+03:00', reason: 'Manual correction' };
  it('rejects additional shifts on a paid day', async () => {
    const { db, service } = setup(); db.payrollSettlement.findFirst.mockResolvedValue({ status: 'PAID' });
    await expect(service.addShift('e', shift, user)).rejects.toThrow('оплачен');
    expect(db.payrollShift.create).not.toHaveBeenCalled();
  });
  it('rejects an overlapping shift under the employee lock', async () => {
    const { db, service } = setup(); db.payrollShift.findFirst.mockResolvedValue({ id: 'old' });
    await expect(service.addShift('e', shift, user)).rejects.toThrow('пересекается');
    expect(db.$queryRaw).toHaveBeenCalled(); expect(db.payrollShift.create).not.toHaveBeenCalled();
  });
  it('records actor and reason for manual attendance', async () => {
    const { db, service } = setup(); await service.addShift('e', shift, user);
    expect(db.payrollAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: 'admin', action: 'SHIFT_CREATED' }) }));
  });
  it('does not pay the same selected accrual twice', async () => {
    const { db, service } = setup();
    vi.spyOn(service, 'report').mockResolvedValue({ rows: [{ key: 'WORK:e:2026-09-26', status: 'PAID', kind: 'HOURLY', amountKopecks: 10000 }], issues: [] } as any);
    await service.setStatus({ employeeId: 'e', dateFrom: '2026-09-26', dateTo: '2026-09-26', keys: ['WORK:e:2026-09-26'], status: 'PAID', comment: '' }, user);
    expect(db.payrollSettlement.upsert).not.toHaveBeenCalled();
  });
  it('does not pay unresolved calculations', async () => {
    const { db, service } = setup();
    vi.spyOn(service, 'report').mockResolvedValue({ rows: [{ key: 'a', status: 'UNPAID' }], issues: ['open shift'] } as any);
    await expect(service.setStatus({ employeeId: 'e', dateFrom: '2026-09-26', dateTo: '2026-09-26', keys: ['a'], status: 'PAID', comment: '' }, user)).rejects.toThrow('ошибки');
    expect(db.payrollSettlement.upsert).not.toHaveBeenCalled();
  });
});
