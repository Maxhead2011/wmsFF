import { UnauthorizedException } from '@nestjs/common';
import { ClientRequestStatus, Prisma, TsdDeviceStatus, UserStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { TsdDeviceService } from '../src/modules/tsd/tsd-device.service';

const deviceCode = 'TSD-INSTALL-12345678';
const nextUser = {
  id: 'next-user', email: 'next@example.com', name: 'Новый сотрудник',
  status: UserStatus.ACTIVE, passwordHash: 'hash',
  roles: [{ role: { code: 'OPERATOR', permissions: [{ permission: { code: 'stock:write' } }] } }],
};

function task(id: string, requestId: string) {
  return {
    id, requestId, status: 'IN_PROGRESS', deviceCode, workerUserId: 'previous-user', workerName: 'Прежний сотрудник',
    boxId: `box-${id}`, boxCode: `BOX-${id}`, barcode: `barcode-${id}`, kiz: `kiz-${id}`,
    sourceBarcode: `source-${id}`, reservedBoxId: `reserved-${id}`, reservedBoxCode: `RESERVED-${id}`,
    startedAt: new Date('2026-09-09T10:00:00Z'), wbMetaStatus: 'ACCEPTED', errorMessage: 'old error',
  };
}

function fixture(closedStatus: ClientRequestStatus | null = ClientRequestStatus.DONE) {
  const device = { id: 'device-1', code: deviceCode, name: 'Прежний сотрудник · 12345678', userId: 'previous-user', status: TsdDeviceStatus.ACTIVE };
  const tasks = [task('closed-task', 'closed-request'), task('open-task', 'open-request')];
  const requests = [
    { id: 'open-request', status: ClientRequestStatus.IN_WORK },
    ...(closedStatus ? [{ id: 'closed-request', status: closedStatus }] : []),
  ];
  const tx = {
    tsdDevice: {
      findUnique: vi.fn(async () => ({ ...device })),
      updateMany: vi.fn(async ({ data }) => { Object.assign(device, data); return { count: 1 }; }),
      update: vi.fn(async ({ data }) => Object.assign(device, data)),
    },
    fbsTsdAssembly: {
      findMany: vi.fn(async ({ where }) => tasks.filter((row) => row.deviceCode === where.deviceCode
        && row.workerUserId === where.workerUserId && row.status === where.status)
        .map(({ id, requestId }) => ({ id, requestId }))),
      updateMany: vi.fn(async ({ where, data }) => {
        const matching = tasks.filter((row) => row.deviceCode === where.deviceCode
          && row.workerUserId === where.workerUserId && row.status === where.status
          && (!where.id || where.id.in.includes(row.id)));
        matching.forEach((row) => Object.assign(row, data));
        return { count: matching.length };
      }),
    },
    clientRequest: {
      findMany: vi.fn(async ({ where }) => requests.filter((row) => where.id.in.includes(row.id)
        && !where.status.notIn.includes(row.status)).map(({ id }) => ({ id }))),
    },
    auditLog: { create: vi.fn(async (_args: { data: { action: string; [key: string]: unknown } }) => ({})) },
  };
  const prisma = {
    user: { findUnique: vi.fn(async () => nextUser) }, tsdDevice: tx.tsdDevice,
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const sign = vi.fn(() => 'new-user-token');
  const service = new TsdDeviceService(prisma as never, { verify: vi.fn(async () => true) } as never,
    { sign } as never, {} as never);
  // The legacy-device cleanup is a separate unchanged transaction, outside this regression.
  vi.spyOn(service as never as { releaseUntouchedLegacyFbsLeases: () => Promise<number> },
    'releaseUntouchedLegacyFbsLeases').mockResolvedValue(0);
  const login = () => service.login({ login: nextUser.email, password: 'password', installationCode: deviceCode });
  return { device, tasks, tx, prisma, sign, login };
}

describe('shared TSD installation live compatibility', () => {
  // TEST: closed/deleted requests must not follow a handheld to the next employee.
  it.each([ClientRequestStatus.DONE, ClientRequestStatus.CANCELLED, ClientRequestStatus.REJECTED, null])(
    'parks a %s request with physical scans preserved and transfers only open tasks', async (status) => {
      const { tasks, tx, prisma, device, sign, login } = fixture(status);
      const previousEvidence = { ...tasks[0] };
      const result = await login();
      expect(tasks[0]).toEqual({
        ...previousEvidence, status: 'RETURN_REQUIRED', deviceCode: 'AUTO:FBS:PALLET_SORT',
        workerUserId: null, workerName: null,
        errorMessage: 'Задание снято с ТСД: исходная FBS-заявка уже закрыта или удалена.',
      });
      expect(tasks[1]).toMatchObject({ status: 'IN_PROGRESS', workerUserId: nextUser.id, workerName: nextUser.name,
        deviceCode, boxId: 'box-open-task', kiz: 'kiz-open-task', errorMessage: null });
      expect(device.userId).toBe(nextUser.id);
      expect(result.device.name).toBe(`${nextUser.name} · 12345678`);
      expect(sign).toHaveBeenCalledWith(nextUser.id, { deviceId: device.id, deviceCode });
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        userId: nextUser.id, action: 'TSD_STALE_FBS_TASKS_PARKED', entityId: device.id,
        payload: { deviceCode, previousUserId: 'previous-user', staleTaskIds: ['closed-task'], parkedTasks: 1 },
      }) });
      expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        action: 'TSD_SHARED_INSTALLATION_REBOUND',
        payload: { deviceCode, previousUserId: 'previous-user', nextUserId: nextUser.id, movedFbsTasks: 1, parkedStaleFbsTasks: 1 },
      }) });
    },
  );

  // TEST: no tasks from another installation/employee or terminal status can be rebound.
  it('leaves unrelated task leases unchanged', async () => {
    const { tasks, login } = fixture();
    const unrelated = [
      { ...task('other-device', 'closed-request'), deviceCode: 'TSD-INSTALL-OTHER' },
      { ...task('other-user', 'closed-request'), workerUserId: 'other-user' },
      { ...task('completed', 'closed-request'), status: 'COMPLETED' },
    ];
    const before = unrelated.map((row) => ({ ...row }));
    tasks.push(...unrelated);
    await login();
    expect(unrelated).toEqual(before);
  });

  it('updates the employee name without moving any tasks on an idle installation', async () => {
    const { tasks, tx, login } = fixture();
    tasks.length = 0;
    const result = await login();
    expect(result.device.name).toBe(`${nextUser.name} · 12345678`);
    expect(tx.clientRequest.findMany).not.toHaveBeenCalled();
    expect(tx.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  });

  // TEST: a changed task lease must not be overwritten or transferred using the stale snapshot.
  it('does not transfer a closed task if its conditional parking update loses the lease', async () => {
    const { tasks, tx, login } = fixture();
    const update = tx.fbsTsdAssembly.updateMany.getMockImplementation()!;
    tx.fbsTsdAssembly.updateMany.mockImplementationOnce(async (args) => {
      tasks[0].workerUserId = 'concurrent-worker';
      return update(args);
    });
    await login();
    expect(tasks[0]).toMatchObject({ workerUserId: 'concurrent-worker', status: 'IN_PROGRESS', kiz: 'kiz-closed-task' });
    expect(tasks[1].workerUserId).toBe(nextUser.id);
    expect(tx.auditLog.create.mock.calls.map(([args]) => args.data.action)).not.toContain('TSD_STALE_FBS_TASKS_PARKED');
  });

  // TEST: failed ownership acquisition or serialization must never issue a new session token.
  it('rejects a concurrent device owner change before transferring live tasks', async () => {
    const { tx, sign, login } = fixture();
    tx.tsdDevice.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sign).not.toHaveBeenCalled();
    expect(tx.fbsTsdAssembly.updateMany.mock.calls.some(([args]) => args.data.workerUserId === nextUser.id)).toBe(false);
  });

  it('rejects a serializable transaction conflict without signing a token', async () => {
    const { prisma, sign, login } = fixture();
    prisma.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034', clientVersion: 'test',
    }));
    await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sign).not.toHaveBeenCalled();
  });
});
