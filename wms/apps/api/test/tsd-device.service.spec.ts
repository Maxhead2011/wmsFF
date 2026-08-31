import { TsdDeviceStatus, UserStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { TsdDeviceService } from '../src/modules/tsd/tsd-device.service';

describe('TsdDeviceService', () => {
  it('создает ТСД с одноразовым секретом и hash в базе', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(operatorUser()),
      },
      tsdDevice: {
        create: vi.fn().mockResolvedValue({
          id: 'device-1',
          code: 'TSD-01',
          name: 'Терминал 01',
          status: TsdDeviceStatus.ACTIVE,
          userId: 'user-1',
          createdAt: new Date('2026-06-26T00:00:00Z'),
        }),
      },
    };
    const service = new TsdDeviceService(
      prisma as never,
      { hash: vi.fn().mockResolvedValue('secret-hash') } as never,
      { sign: vi.fn() } as never,
    );

    const result = await service.createDevice({ code: ' tsd-01 ', name: 'Терминал 01', userId: 'user-1' });

    expect(result).toMatchObject({ id: 'device-1', code: 'TSD-01', deviceSecret: expect.any(String) });
    expect(prisma.tsdDevice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'TSD-01',
          secretHash: 'secret-hash',
        }),
      }),
    );
  });

  it('логинит активный ТСД и подписывает token с device claims', async () => {
    const prisma = {
      tsdDevice: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'device-1',
          code: 'TSD-01',
          name: 'Терминал 01',
          secretHash: 'secret-hash',
          status: TsdDeviceStatus.ACTIVE,
          userId: 'user-1',
          user: operatorUser(),
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const sign = vi.fn().mockReturnValue('signed-token');
    const service = new TsdDeviceService(
      prisma as never,
      { verify: vi.fn().mockResolvedValue(true) } as never,
      { sign } as never,
    );

    const result = await service.login({ code: 'tsd-01', secret: 'device-secret' });

    expect(sign).toHaveBeenCalledWith('user-1', { deviceId: 'device-1', deviceCode: 'TSD-01' });
    expect(result).toMatchObject({
      accessToken: 'signed-token',
      tokenType: 'Bearer',
      device: { id: 'device-1', code: 'TSD-01' },
    });
  });

  // TEST: a shared physical TSD must not keep the first employee's name after rebind.
  it('обновляет имя общего ТСД при входе другого сотрудника', async () => {
    const current = {
      id: 'device-1',
      code: 'TSD-INSTALL-8F4AD3F8D15EA12C',
      name: 'Надежда · D15EA12C',
      userId: 'user-nadezhda',
      status: TsdDeviceStatus.ACTIVE,
    };
    const rebound = {
      ...current,
      name: 'Валерон · D15EA12C',
      userId: 'user-valeron',
    };
    const tx = {
      tsdDevice: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(rebound),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      clientRequest: { findMany: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new TsdDeviceService(
      { $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)) } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      (service as any).rebindSharedInstallation(current, {
        id: 'user-valeron',
        name: 'Валерон',
      }),
    ).resolves.toMatchObject(rebound);
    expect(tx.tsdDevice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-valeron',
        name: 'Валерон · D15EA12C',
      }),
    }));
  });

  // TEST: a stale display name is also repaired when the correct user is
  // already bound to the device and simply logs in again.
  it('исправляет старое имя ТСД при повторном входе того же сотрудника', async () => {
    const current = {
      id: 'device-1',
      code: 'TSD-INSTALL-8F4AD3F8D15EA12C',
      name: 'Надежда · D15EA12C',
      userId: 'user-valeron',
      status: TsdDeviceStatus.ACTIVE,
    };
    const repaired = { ...current, name: 'Валерон · D15EA12C' };
    const tx = {
      tsdDevice: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(repaired),
        update: vi.fn().mockResolvedValue(repaired),
      },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
      clientRequest: { findMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const service = new TsdDeviceService(
      { $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)) } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      (service as any).rebindSharedInstallation(current, {
        id: 'user-valeron',
        name: 'Валерон',
      }),
    ).resolves.toMatchObject(repaired);
    expect(tx.tsdDevice.update).toHaveBeenCalledWith({
      where: { id: 'device-1' },
      data: expect.objectContaining({ name: 'Валерон · D15EA12C' }),
    });
    expect(tx.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  });

  // TEST: a ghost task from a closed request must be parked instead of being
  // rebound to every employee who signs in on the shared physical TSD.
  it('не переносит за новым сотрудником задание уже закрытой FBS-заявки', async () => {
    const current = {
      id: 'device-1',
      code: 'TSD-INSTALL-8F4AD3F8D15EA12C',
      name: 'Надежда · D15EA12C',
      userId: 'user-nadezhda',
      status: TsdDeviceStatus.ACTIVE,
    };
    const rebound = {
      ...current,
      name: 'Валерон · D15EA12C',
      userId: 'user-valeron',
    };
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const tx = {
      tsdDevice: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(rebound),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'ghost-task', requestId: 'closed-request' },
          { id: 'live-task', requestId: 'open-request' },
        ]),
        updateMany,
      },
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([{ id: 'open-request' }]),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new TsdDeviceService(
      { $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)) } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await (service as any).rebindSharedInstallation(current, {
      id: 'user-valeron',
      name: 'Валерон',
    });

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        id: { in: ['ghost-task'] },
        workerUserId: 'user-nadezhda',
        status: 'IN_PROGRESS',
      }),
      data: expect.objectContaining({
        status: 'RETURN_REQUIRED',
        deviceCode: 'AUTO:FBS:PALLET_SORT',
        workerUserId: null,
        workerName: null,
      }),
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        id: { in: ['live-task'] },
        workerUserId: 'user-nadezhda',
        status: 'IN_PROGRESS',
      }),
      data: expect.objectContaining({
        workerUserId: 'user-valeron',
        workerName: 'Валерон',
      }),
    });
  });
});

function operatorUser() {
  return {
    id: 'user-1',
    email: 'operator@example.com',
    name: 'Operator',
    status: UserStatus.ACTIVE,
    clientScopes: [],
    roles: [
      {
        role: {
          code: 'OPERATOR',
          permissions: [
            {
              permission: {
                code: 'stock:write',
              },
            },
          ],
        },
      },
    ],
  };
}
