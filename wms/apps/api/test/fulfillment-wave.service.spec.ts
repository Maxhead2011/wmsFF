import { ClientRequestStatus, ClientRequestType, PickWaveBalanceReviewStatus, PickWaveRequestStatus, PickWaveStatus, UserStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { FulfillmentWaveService } from '../src/modules/stock/fulfillment-wave.service';

describe('FulfillmentWaveService', () => {
  // TEST: both approved and already-in-work requests freeze one persisted plan without changing stock.
  it.each([ClientRequestStatus.APPROVED, ClientRequestStatus.IN_WORK])('создает зафиксированную волну из доступной outbound-заявки %s', async (requestStatus) => {
    const tx = {
      pickWave: { create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'wave-1', ...data })) },
      clientRequest: { update: vi.fn() },
      clientRequestEvent: { create: vi.fn() },
    };
    const instructions = instructionFixture();
    const operations = { pickClientRequest: vi.fn() };
    const prisma = {
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([requestFixture('request-1', requestStatus)]),
      },
      pickWaveRequest: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      pickWave: tx.pickWave,
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const scopes = {
      requireClientAccess: vi.fn(),
      resolveClientFilter: vi.fn(),
    };
    const service = new FulfillmentWaveService(prisma as never, scopes as never, operations as never, instructions as never, {} as never);

    await expect(service.createWave({ requestIds: ['request-1'], comment: 'Собрать первую волну' }, user())).resolves.toMatchObject({
      id: 'wave-1',
      status: PickWaveStatus.FROZEN,
    });

    expect(scopes.requireClientAccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'client-1', 'write');
    expect(prisma.pickWave.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PickWaveStatus.FROZEN,
          warehouseId: 'warehouse-1',
          balanceReviewStatus: PickWaveBalanceReviewStatus.NOT_REQUIRED,
          plan: wavePlan(),
          planGeneratedAt: new Date('2026-07-15T10:00:00.000Z'),
          planFrozenAt: new Date('2026-07-15T10:00:00.000Z'),
          comment: 'Собрать первую волну',
          createdByUserId: 'user-1',
          requests: {
            create: [{ requestId: 'request-1' }],
          },
        }),
      }),
    );
    expect(instructions.buildWaveDraft).toHaveBeenCalledTimes(1);
    expect(instructions.buildWaveDraft).toHaveBeenCalledWith(['request-1'], user());
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(instructions.invalidateRequestInstruction).toHaveBeenCalledTimes(1);
    expect(instructions.invalidateRequestInstruction).toHaveBeenCalledWith('request-1');
    expect(operations.pickClientRequest).not.toHaveBeenCalled();
    if (requestStatus === ClientRequestStatus.IN_WORK) {
      expect(tx.clientRequest.update).not.toHaveBeenCalled();
      expect(tx.clientRequestEvent.create).not.toHaveBeenCalled();
    } else {
      expect(tx.clientRequest.update).toHaveBeenCalledTimes(1);
      expect(tx.clientRequest.update).toHaveBeenCalledWith({
        where: { id: 'request-1' }, data: { status: ClientRequestStatus.IN_WORK, assignedToUserId: 'user-1' },
      });
      expect(tx.clientRequestEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
        requestId: 'request-1', statusFrom: ClientRequestStatus.APPROVED, statusTo: ClientRequestStatus.IN_WORK,
      }) }));
    }
  });

  it('не добавляет в волну уже упакованную заявку PACKED', async () => {
    const prisma = {
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([requestFixture('request-1', ClientRequestStatus.PACKED)]),
      },
      pickWaveRequest: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn(),
    };
    const instructions = instructionFixture();
    const service = new FulfillmentWaveService(
      prisma as never,
      { requireClientAccess: vi.fn(), resolveClientFilter: vi.fn() } as never,
      { pickClientRequest: vi.fn() } as never,
      instructions as never,
      {} as never,
    );

    await expect(service.createWave({ requestIds: ['request-1'] }, user())).rejects.toThrow(
      'В волну можно добавлять новые, проверяемые, согласованные или уже переданные в работу заявки.',
    );
    expect(instructions.buildWaveDraft).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('сохраняет ответственного сборщика для волны', async () => {
    const tx = {
      pickWave: { create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'wave-1', ...data })) },
      clientRequest: { update: vi.fn() },
      clientRequestEvent: { create: vi.fn() },
    };
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
      pickWave: tx.pickWave,
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new FulfillmentWaveService(
      prisma as never,
      { requireClientAccess: vi.fn(), resolveClientFilter: vi.fn() } as never,
      { pickClientRequest: vi.fn() } as never,
      instructionFixture() as never,
      {} as never,
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
          status: PickWaveStatus.FROZEN,
        }),
      }),
    );
    expect(tx.clientRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' }, data: { status: ClientRequestStatus.IN_WORK, assignedToUserId: 'picker-1' },
    });
  });

  it('не назначает заблокированного сборщика на волну', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'picker-1', status: UserStatus.BLOCKED }),
      },
      $transaction: vi.fn(),
    };
    const service = new FulfillmentWaveService(
      prisma as never,
      { requireClientAccess: vi.fn(), resolveClientFilter: vi.fn() } as never,
      { pickClientRequest: vi.fn() } as never,
    );

    await expect(service.createWave({ requestIds: ['request-1'], assignedPickerUserId: 'picker-1' }, user())).rejects.toThrow(
      'Ответственный сборщик для волны не найден или заблокирован.',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // TEST: preserve legacy PLANNED runs while proving the current FROZEN creation contract can run.
  it.each([PickWaveStatus.PLANNED, PickWaveStatus.FROZEN])('запускает волну %s через idempotent pick-request и закрывает строки', async (waveStatus) => {
    const wave = {
      id: 'wave-1',
      warehouseId: 'warehouse-1',
      waveNumber: 'WAVE-1',
      status: waveStatus,
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

  // TEST: neither read-only access nor pending client review may start a stock operation.
  it.each([
    { readOnly: true, pending: false, message: 'В выбранном филиале доступен только просмотр.' },
    { readOnly: false, pending: true, message: 'Сначала клиент должен проверить и подтвердить складские балансы волны.' },
  ])('не запускает волну без разрешения: $message', async ({ readOnly, pending, message }) => {
    const wave = {
      id: 'wave-1', warehouseId: 'warehouse-1', status: pending ? PickWaveStatus.BALANCE_REVIEW : PickWaveStatus.FROZEN,
      balanceReviewStatus: pending ? PickWaveBalanceReviewStatus.PENDING : PickWaveBalanceReviewStatus.NOT_REQUIRED,
      requests: [{ requestId: 'request-1', request: requestFixture('request-1'), status: PickWaveRequestStatus.PLANNED }],
    };
    const prisma = {
      pickWave: { findUnique: vi.fn().mockResolvedValue(wave), updateMany: vi.fn(), update: vi.fn() },
      pickWaveRequest: { update: vi.fn() },
    };
    const operations = { pickClientRequest: vi.fn() };
    const service = new FulfillmentWaveService(prisma as never, { requireClientAccess: vi.fn() } as never,
      operations as never, instructionFixture() as never, {} as never);
    await expect(service.runWave('wave-1', { idempotencyKey: 'denied-run' }, {
      ...user(), writableWarehouseIds: readOnly ? [] : ['warehouse-1'],
    })).rejects.toThrow(message);
    expect(prisma.pickWave.updateMany).not.toHaveBeenCalled();
    expect(prisma.pickWave.update).not.toHaveBeenCalled();
    expect(prisma.pickWaveRequest.update).not.toHaveBeenCalled();
    expect(operations.pickClientRequest).not.toHaveBeenCalled();
  });
});

function requestFixture(id: string, status: ClientRequestStatus = ClientRequestStatus.APPROVED) {
  return {
    id,
    clientId: 'client-1',
    warehouseId: 'warehouse-1',
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
    activeWarehouseId: 'warehouse-1',
    warehouseIds: ['warehouse-1'],
    writableWarehouseIds: ['warehouse-1'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  };
}

// TEST: deterministic instruction contract consumed by the transactional wave creator.
function wavePlan() {
  return { reservations: [{ orderId: 'item-1', balanceId: 'balance-1', quantity: 2 }], warnings: [] };
}

function instructionFixture() {
  return {
    buildWaveDraft: vi.fn().mockResolvedValue({
      generatedAt: '2026-07-15T10:00:00.000Z', plan: wavePlan(), balanceLines: [],
    }),
    invalidateRequestInstruction: vi.fn(),
  };
}
