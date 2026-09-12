import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AdministrationService } from '../src/modules/administration/administration.service';

afterEach(() => vi.unstubAllEnvs());
const admin = { id: 'admin', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], administrationEnabled: false, isDemo: false };
function setup() {
  const prisma = {
    tsdDevice: { findMany: vi.fn().mockResolvedValue([]) },
    tsdOperation: { findMany: vi.fn().mockResolvedValue([]) },
    fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new AdministrationService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never) };
}
describe('ADMIN monitoring read access', () => {
  it('opens the full read-only monitor for a non-owner ADMIN on our installation', async () => {
    // TEST: previously listTsdWorkloads rejected ADMIN before reading any monitoring data.
    vi.stubEnv('ADMIN_MONITORING_ENABLED', 'true');
    const { service } = setup();
    await expect(service.listTsdMonitor(admin as never)).resolves.toMatchObject({ devices: [] });
  });
  it.each([undefined, 'false'])('keeps sold installations unchanged with flag %s', async flag => {
    // TEST: the feature must be explicitly enabled per installation.
    vi.stubEnv('ADMIN_MONITORING_ENABLED', flag);
    const { service, prisma } = setup();
    await expect(service.listTsdWorkloads(admin as never)).rejects.toThrow(ForbiddenException);
    expect(prisma.tsdDevice.findMany).not.toHaveBeenCalled();
  });
  it.each([
    { roleCodes: ['MANAGER'] }, { roleCodes: ['CLIENT'] }, { isDemo: true }, { permissionCodes: [] },
  ])('does not widen access for %j', async override => {
    // TEST: a role/permission/demo mismatch cannot reach internal device data.
    vi.stubEnv('ADMIN_MONITORING_ENABLED', 'true');
    await expect(setup().service.listTsdMonitor({ ...admin, ...override } as never)).rejects.toThrow(ForbiddenException);
  });
  it('preserves owner access without the feature flag', async () => {
    vi.stubEnv('ADMIN_MONITORING_ENABLED', 'false');
    await expect(setup().service.listTsdWorkloads({ ...admin, administrationEnabled: true } as never)).resolves.toMatchObject({ devices: [] });
  });
  it('does not grant owner actions or administration with monitoring read access', async () => {
    // TEST: menu access does not authorize logout, task release, or general owner tools.
    vi.stubEnv('ADMIN_MONITORING_ENABLED', 'true');
    const { service } = setup();
    await expect(service.issueTsdMonitorAction('TSD-1', 'LOGOUT', admin as never)).rejects.toThrow(ForbiddenException);
    await expect(service.disconnectTsdRequest({ requestId: 'request', deviceCode: 'TSD-1' }, admin as never)).rejects.toThrow(ForbiddenException);
    expect(() => service.documentation(admin as never)).toThrow(ForbiddenException);
  });
});
