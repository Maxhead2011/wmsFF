import { BadRequestException } from '@nestjs/common';
import { ClientRequestStatus, ClientRequestType, PickWaveRequestStatus, PickWaveStatus, UserStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { FulfillmentWaveService } from '../src/modules/stock/fulfillment-wave.service';

describe('FulfillmentWaveService', () => {
  it('создает волну из outbound-заявок, доступных пользователю', async () => {
    const prisma = {
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([requestFixture('request-1')]),
      },
      pickWaveRequest: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      pickWave: {
        create: vi.fn().mockResolvedValue({ id: 'wave-1', waveNumber: 'WAVE-1', requests: [] }),
      },
    };
    const scopes = {
      requireClientAccess: vi.fn(),
      resolveClientFilter: vi.fn(),
    };
    const service = new FulfillmentWaveService(prisma as never, scopes as never, { pickClientRequest: vi.fn() } as never);

    await expect(service.createWave({ requestIds: ['request-1'], comment: 'Собрать первую волну' }, user())).resolves.toMatchObject({
      id: 'wave-1',
    });

    expect(scopes.requireClientAccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'client-1', 'write');
    expect(prisma.pickWave.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PickWaveStatus.PLANNED,
          comment: 'Собрать первую волну',
          createdByUserId: 'user-1',
          requests: {
            create: [{ requestId: 'request-1' }],
          },
        }),
      }),
    );
  });

  it('не добавляет в волну уже собранную заявку', async () => {
    const prisma = {
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([requestFixture('request-1', ClientRequestStatus.IN_WORK)]),
      },
      pickWaveRequest: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new FulfillmentWaveService(
      prisma as never,
      { requireClientAccess: vi.fn(), resolveClientFilter: vi.fn() } as never,
      { pickClientRequest: vi.fn() } as never,
    );

    await expect(service.createWave({ requestIds: ['request-1'] }, user())).rejects.toThrow(BadRequestException);
  });

  it('сохраняет ответственного сборщика для волны', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'picker-1', status: UserStatus.ACTIVE }),
      },
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([requestFixture('request-1')]),
      },
      pickWaveRequest: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      pickWave: {
        create: vi.fn().mockResolvedValue({ id: 'wave-1', waveNumber: 'WAVE-1', assignedPickerUserId: 'picker-1' }),
      },
    };
    const service = new FulfillmentWaveService(
      prisma as never,
      { requireClientAccess: vi.fn(), resolveClientFilter: vi.fn() } as never,
      { pickClientRequest: vi.fn() } as never,
    );

    await service.createWave({ requestIds: ['request-1'], assignedPickerUserId: ' picker-1 ' }, user());

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'picker-1' },
      select: { id: true, status: true },
    });
    expect(prisma.pickWave.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignedPickerUserId: 'picker-1',
        }),
      }),
    );
  });

  it('не назначает заблокированного сборщика на волну', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'picker-1', status: UserStatus.BLOCKED }),
      },
    };
    const service = new FulfillmentWaveService(
      prisma as never,
      { requireClientAccess: vi.fn(), resolveClientFilter: vi.fn() } as never,
      { pickClientRequest: vi.fn() } as never,
    );

    await expect(service.createWave({ requestIds: ['request-1'], assignedPickerUserId: 'picker-1' }, user())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('запускает волну через idempotent pick-request и закрывает строки', async () => {
    const wave = {
      id: 'wave-1',
      waveNumber: 'WAVE-1',
      status: PickWaveStatus.PLANNED,
      requests: [
        {
          requestId: 'request-1',
          status: PickWaveRequestStatus.PLANNED,
          request: requestFixture('request-1'),
        },
      ],
    };
    const prisma = {
      pickWave: {
        findUnique: vi.fn().mockResolvedValue(wave),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...wave, ...data })),
      },
      pickWaveRequest: {
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const operations = {
      pickClientRequest: vi.fn().mockResolvedValue({
        status: 'APPLIED',
        requestId: 'request-1',
        pickedLines: [],
      }),
    };
    const service = new FulfillmentWaveService(
      prisma as never,
      { requireClientAccess: vi.fn(), resolveClientFilter: vi.fn() } as never,
      operations as never,
    );

    await expect(service.runWave('wave-1', { idempotencyKey: 'wave-run' }, user())).resolves.toMatchObject({
      wave: {
        status: PickWaveStatus.DONE,
      },
      results: [
        {
          requestId: 'request-1',
          status: 'APPLIED',
        },
      ],
    });

    expect(operations.pickClientRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-1',
        idempotencyKey: 'wave-run:request-1',
      }),
      expect.objectContaining({ id: 'user-1' }),
    );
    expect(prisma.pickWaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PickWaveRequestStatus.PICKED,
          pickedAt: expect.any(Date),
        }),
      }),
    );
  });
});

function requestFixture(id: string, status: ClientRequestStatus = ClientRequestStatus.APPROVED) {
  return {
    id,
    clientId: 'client-1',
    title: 'Отгрузка',
    type: ClientRequestType.OUTBOUND,
    status,
    items: [{ id: 'item-1', skuId: 'sku-1', barcode: null, quantity: 2 }],
  };
}

function user(): AuthUser {
  return {
    id: 'user-1',
    email: 'operator@example.com',
    name: 'Operator',
    roleCodes: ['OPERATOR'],
    permissionCodes: ['stock:write'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  };
}
