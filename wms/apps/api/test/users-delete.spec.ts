import { afterEach, describe, expect, it, vi } from 'vitest';
import { validate } from 'class-validator';
import { UsersService } from '../src/modules/users/users.service';
import { UpdateUserProfileDto } from '../src/modules/users/dto/update-user-profile.dto';
import { AuthGuard } from '../src/modules/auth/guards/auth.guard';
import { AuthService } from '../src/modules/auth/auth.service';
import { MobileAuthService } from '../src/modules/mobile/mobile-auth.service';
import { MobileService } from '../src/modules/mobile/mobile.service';
import { AdministrationService } from '../src/modules/administration/administration.service';
import { TsdDeviceService } from '../src/modules/tsd/tsd-device.service';

afterEach(() => vi.unstubAllEnvs());

// TEST: authorization uses persisted roles and assignments, never the active branch or request roles.
function setup(actorRoles = ['ADMIN'], actorBranch: string | null = 'moscow', targetRoles = ['OPERATOR'], targetBranch: string | null = 'moscow') {
  const record = (id: string, roles: string[], branch: string | null) => ({ id, name: id, email: `${id}@example.com`,
    status: 'ACTIVE', isDemo: false, tsdActivationCodeHash: 'hash', activeWarehouseId: 'selected-other',
    roles: roles.map(code => ({ role: { code, name: code } })),
    warehouseScopes: branch ? [{ canRead: true, canWrite: true, warehouse: { id: branch } }] : [],
  });
  const actor = record('actor', actorRoles, actorBranch), target = record('target', targetRoles, targetBranch);
  const db: any = { user: {
    findFirst: vi.fn(async ({ where }) => [actor, target].find(row => row.id === where.id && row.isDemo === where.isDemo && (!where.status?.not || row.status !== where.status.not)) ?? null),
    findMany: vi.fn(async () => [actor, target]),
    update: vi.fn(async () => target),
  }, auditLog: { create: vi.fn(async () => ({})) },
    userSession: { updateMany: vi.fn(async () => ({ count: 2 })) },
    mobileSession: { updateMany: vi.fn(async () => ({ count: 1 })) },
    tsdDevice: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  const user: any = { id: 'actor', isDemo: false, roleCodes: ['OWNER'], permissionCodes: ['system:admin'], activeWarehouseId: 'selected-other' };
  const service: any = new UsersService(db, {} as never, {} as never);
  return { service, db, actor, target, user };
}

describe('soft deletion of users', () => {
  // TEST: deleting an employee must not prevent another employee signing into the shared handheld.
  it('preserves a shared TSD for the next employee while revoking the deleted account', async () => {
    vi.stubEnv('WMS_USER_DELETION_PRESERVE_TSD_DEVICES', 'true');
    const { service, db, user } = setup();
    const device = { id: 'physical-device', code: 'TSD-INSTALL-SHARED', name: 'Shared', userId: 'target', status: 'ACTIVE' };
    db.tsdDevice.updateMany.mockImplementation(async ({ data }: any) => { Object.assign(device, data); return { count: 1 }; });
    await service.deleteUser('target', user);
    expect(device.status).toBe('ACTIVE');
    expect(db.tsdDevice.updateMany).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { status: 'ARCHIVED', tsdActivationCodeHash: null } });
    expect(db.userSession.updateMany).toHaveBeenCalledWith({ where: { userId: 'target' }, data: { expiresAt: expect.any(Date) } });
    expect(db.mobileSession.updateMany).toHaveBeenCalledWith({ where: { userId: 'target', revokedAt: null }, data: { revokedAt: expect.any(Date) } });

    const nextUser = { id: 'next-employee', name: 'Next', email: 'next', status: 'ACTIVE', passwordHash: 'hash',
      roles: [{ role: { code: 'OPERATOR', permissions: [{ permission: { code: 'stock:write' } }] } }] };
    const sign = vi.fn(() => 'next-user-token');
    const tsd: any = new TsdDeviceService({ user: { findUnique: async () => nextUser },
      tsdDevice: { findUnique: async () => device } } as never, { verify: async () => true } as never, { sign } as never);
    tsd.rebindSharedInstallation = vi.fn(async () => ({ ...device, userId: nextUser.id }));
    tsd.releaseUntouchedLegacyFbsLeases = vi.fn(async () => undefined);
    await expect(tsd.login({ login: 'next', password: 'correct', installationCode: device.code })).resolves.toMatchObject({ accessToken: 'next-user-token' });
    expect(tsd.rebindSharedInstallation).toHaveBeenCalledWith(device, nextUser);
    expect(sign).toHaveBeenCalledWith(nextUser.id, { deviceId: device.id, deviceCode: device.code });
  });
  // TEST: preserving shared devices must never undo a deliberate administrator device block.
  it('preserves an existing manual TSD block when its employee is archived', async () => {
    vi.stubEnv('WMS_USER_DELETION_PRESERVE_TSD_DEVICES', 'true');
    const { service, db, user } = setup();
    const device = { status: 'BLOCKED' };
    db.tsdDevice.updateMany.mockImplementation(async ({ data }: any) => { Object.assign(device, data); return { count: 1 }; });
    await service.deleteUser('target', user);
    expect(device.status).toBe('BLOCKED');
    expect(db.tsdDevice.updateMany).not.toHaveBeenCalled();
  });
  // TEST: installations without the opt-in retain their existing deletion behavior.
  it('keeps the sold installation behavior when shared-device preservation is disabled', async () => {
    vi.stubEnv('WMS_USER_DELETION_PRESERVE_TSD_DEVICES', 'false');
    const { service, db, user } = setup();
    await service.deleteUser('target', user);
    expect(db.tsdDevice.updateMany).toHaveBeenCalledWith({ where: { userId: 'target' }, data: { status: 'BLOCKED' } });
  });
  it('hides archived users from mobile and workspace-access selectors', async () => {
    const findMany = vi.fn(async () => []);
    const mobile: any = Object.create(MobileService.prototype);
    mobile.prisma = { user: { findMany } }; mobile.resolveClientIds = async () => [];
    await mobile.nativeModule({ roleCodes: ['OWNER'], permissionCodes: ['system:admin'] }, 'access', { limit: 20 });
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { status: { not: 'ARCHIVED' } } });
    const administration: any = Object.create(AdministrationService.prototype);
    administration.prisma = mobile.prisma; administration.assertOwner = () => {}; administration.settings = { get: async () => ({}) };
    await administration.listWorkspaceVisibility({ isDemo: false });
    expect(findMany.mock.calls[1][0]).toMatchObject({ where: { status: { not: 'ARCHIVED' } } });
  });
  it('rejects ambiguous multiple branch assignments and mixed privileged target roles', async () => {
    const { service, target, actor, user, db } = setup();
    actor.warehouseScopes.push({ canRead: true, canWrite: true, warehouse: { id: 'other' } });
    await expect(service.deleteUser('target', user)).rejects.toThrow();
    actor.warehouseScopes.pop(); target.roles.push({ role: { code: 'ADMIN', name: 'Admin' } });
    await expect(service.deleteUser('target', user)).rejects.toThrow();
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('blocks and hides a same-branch employee while retaining the user and recording the actor', async () => {
    const { service, db, user } = setup();
    await expect(service.deleteUser('target', user)).resolves.toMatchObject({ id: 'target', status: 'ARCHIVED' });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { status: 'ARCHIVED', tsdActivationCodeHash: null } });
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'actor', action: 'USER_ARCHIVED', entityId: 'target' }) }));
    expect(db.tsdDevice.updateMany).toHaveBeenCalledWith({ where: { userId: 'target' }, data: { status: 'BLOCKED' } });
    expect(db.mobileSession.updateMany).toHaveBeenCalledWith({ where: { userId: 'target', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(db.userSession.updateMany).toHaveBeenCalledWith({ where: { userId: 'target' }, data: { expiresAt: expect.any(Date) } });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable' }));
  });
  it.each([
    ['ADMIN', 'moscow', 'ADMIN', 'moscow'], ['ADMIN', 'moscow', 'OWNER', 'moscow'],
    ['ADMIN', 'moscow', 'OPERATOR', 'other'], ['ADMIN', null, 'OPERATOR', 'moscow'],
    ['MANAGER', 'moscow', 'OPERATOR', 'moscow'], ['ADMIN', 'moscow', 'OPERATOR', null],
  ])('denies %s/%s deleting %s/%s even with forged owner claims', async (role, branch, targetRole, targetBranch) => {
    const { service, db, user } = setup([role], branch, [targetRole], targetBranch);
    await expect(service.deleteUser('target', user)).rejects.toThrow();
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it.each(['ADMIN', 'OWNER', 'OPERATOR'])('allows OWNER to delete %s in any branch', async role => {
    const { service, user } = setup(['OWNER'], null, [role], 'other');
    await expect(service.deleteUser('target', user)).resolves.toMatchObject({ status: 'ARCHIVED' });
  });
  it('allows OWNER self-deletion as requested', async () => {
    const { service, user } = setup(['OWNER'], null);
    await expect(service.deleteUser('actor', user)).resolves.toMatchObject({ id: 'actor', status: 'ARCHIVED' });
  });
  it('denies a blocked actor and crossing demo boundaries', async () => {
    const { service, actor, target, user, db } = setup(['OWNER']);
    actor.status = 'BLOCKED';
    await expect(service.deleteUser('target', user)).rejects.toThrow();
    actor.status = 'ACTIVE'; target.isDemo = true;
    await expect(service.deleteUser('target', user)).rejects.toThrow();
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('is idempotent for an already archived account', async () => {
    const { service, target, user, db } = setup(); target.status = 'ARCHIVED';
    await expect(service.deleteUser('target', user)).resolves.toMatchObject({ status: 'ARCHIVED' });
    expect(db.user.update).not.toHaveBeenCalled(); expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it('excludes archived users and reports deletion rights from the same assignment rule', async () => {
    const { service, db, user } = setup();
    const rows = await service.list(user);
    expect(db.user.findMany.mock.calls[0][0].where).toMatchObject({ status: { not: 'ARCHIVED' } });
    expect(rows.find((row: any) => row.id === 'target').canDelete).toBe(true);
    expect(rows.find((row: any) => row.id === 'actor').canDelete).toBe(false);
  });
  it('cannot restore an archived user via the profile endpoint', async () => {
    const { service, target, user, db } = setup(); target.status = 'ARCHIVED';
    await expect(service.updateProfile('target', { status: 'ACTIVE' }, user)).rejects.toThrow('Пользователь не найден');
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('rejects ARCHIVED through the general profile DTO to prevent bypassing deletion authorization', async () => {
    const dto = Object.assign(new UpdateUserProfileDto(), { status: 'ARCHIVED' });
    expect((await validate(dto)).some(error => error.property === 'status')).toBe(true);
  });
});

// TEST: existing authentication gates must reject the new archived status on all entry paths.
describe('archived account authentication', () => {
  // TEST: an ACTIVE physical device does not restore its archived employee's credentials.
  it.each(['password', 'device-secret'])('rejects archived TSD account via %s after device unblocking', async method => {
    const archived = { id: 'deleted', status: 'ARCHIVED', passwordHash: 'hash' };
    const sign = vi.fn();
    const tsd = new TsdDeviceService({ user: { findUnique: async () => archived },
      tsdDevice: { findUnique: async () => ({ status: 'ACTIVE', secretHash: 'hash', user: archived }) } } as never,
      { verify: async () => true } as never, { sign } as never);
    const login = method === 'password' ? { login: 'deleted', password: 'correct', installationCode: 'TSD-INSTALL-SHARED' }
      : { code: 'TSD-INSTALL-SHARED', secret: 'correct' };
    await expect(tsd.login(login)).rejects.toThrow(/Пользователь.*заблокирован/);
    expect(sign).not.toHaveBeenCalled();
  });
  it.each([undefined, 'tsd-device'])('rejects a previously issued token (device: %s)', async deviceId => {
    const guard = new AuthGuard({ getAllAndOverride: () => false } as never,
      { verify: () => ({ sub: 'deleted', deviceId }) } as never,
      { user: { findUnique: async () => ({ id: 'deleted', status: 'ARCHIVED' }) } } as never,
      {} as never, {} as never, {} as never);
    const context: any = { getHandler: () => null, getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer old-token' } }) }) };
    await expect(guard.canActivate(context)).rejects.toThrow('Пользователь заблокирован');
  });
  it('rejects a correct password for an archived account', async () => {
    const service: any = Object.create(AuthService.prototype);
    service.findUserWithAccess = async () => ({ status: 'ARCHIVED', passwordHash: 'hash' });
    service.passwords = { verify: async () => true };
    await expect(service.login({ email: 'deleted@example.com', password: 'correct' })).rejects.toThrow('Пользователь заблокирован');
  });
  it('rejects mobile token refresh even if the old session was not revoked', async () => {
    const service = new MobileAuthService({ mobileSession: { findUnique: async () => ({
      expiresAt: new Date(Date.now() + 60000), device: { isActive: true }, user: { status: 'ARCHIVED' },
    }) } } as never, {} as never, {} as never, {} as never);
    await expect(service.refresh('old-token')).rejects.toThrow('Пользователь заблокирован');
  });
});
