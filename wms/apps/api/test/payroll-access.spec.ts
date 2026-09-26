import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PayrollService, payrollWarehouses } from '../src/modules/expenses/payroll.service';
import type { AuthUser } from '../src/modules/auth/auth.types';
const user = { id: 'admin', roleCodes: ['ADMIN'], warehouseIds: ['moscow'], writableWarehouseIds: ['moscow'] } as AuthUser;
// TEST: payroll branch access and payout validation cannot rely on the tablet UI.
describe('payroll access', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('restricts administrators even when they have global operational permissions', () => {
    expect(payrollWarehouses({ ...user, permissionCodes: ['system:admin'] })).toEqual(['moscow']);
    expect(payrollWarehouses({ ...user, warehouseIds: undefined })).toEqual([]);
    expect(payrollWarehouses({ ...user, roleCodes: ['OWNER'] })).toBeUndefined();
  });
  it('denies picker access', () => {
    expect(() => payrollWarehouses({ ...user, roleCodes: ['PICKER'] })).toThrow();
  });
  it('keeps new endpoints disabled by default', async () => {
    vi.stubEnv('WMS_PAYROLL_ATTENDANCE_ENABLED', 'false');
    await expect(new PayrollService({} as any).employees(user)).rejects.toThrow('не включён');
  });
  it('requires both payout phone and bank and rejects another branch', async () => {
    vi.stubEnv('WMS_PAYROLL_ATTENDANCE_ENABLED', 'true');
    const service = new PayrollService({ warehouse: { findUnique: vi.fn().mockResolvedValue({ id: 'moscow' }) } } as any);
    const dto = { name: 'Employee', warehouseId: 'moscow', picker: true, loader: false, isActive: true, paymentMethod: 'TRANSFER' };
    await expect(service.saveEmployee(undefined, dto, user)).rejects.toThrow('телефон и банк');
    await expect(service.saveEmployee(undefined, { ...dto, warehouseId: 'noginsk' }, user)).rejects.toThrow('филиалу');
  });
});
