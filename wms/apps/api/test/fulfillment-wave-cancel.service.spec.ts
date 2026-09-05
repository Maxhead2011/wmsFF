import { ClientRequestStatus, ClientRequestType, PickWaveRequestStatus, PickWaveStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { FulfillmentWaveService } from '../src/modules/stock/fulfillment-wave.service';

describe('FulfillmentWaveService.cancelWave', () => {
  it('отменяет незапущенную волну и возвращает заявку в прежний статус', async () => {
    const wave = waveFixture();
    const tx = {
      pickWave: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      pickWaveBalanceAllocation: { updateMany: vi.fn() },
      clientRequestItem: { deleteMany: vi.fn() },
      clientRequest: { update: vi.fn().mockResolvedValue(undefined) },
      clientRequestEvent: { create: vi.fn().mockResolvedValue(undefined) },
    };
    const prisma = {
      pickWave: {
        findUnique: vi.fn().mockResolvedValue(wave),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...wave, status: PickWaveStatus.CANCELLED }),
      },
      stockMovement: { count: vi.fn().mockResolvedValue(0) },
      clientRequestEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            requestId: 'request-1',
            statusFrom: ClientRequestStatus.APPROVED,
          },
        ]),
      },
      pickWaveBalanceAllocation: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation((callback) => callback(tx)),
    };
    const scopes = { requireClientAccess: vi.fn() };
    const instructions = { invalidateRequestInstruction: vi.fn() };
    const service = new FulfillmentWaveService(
      prisma as never,
      scopes as never,
      {} as never,
      instructions as never,
      {} as never,
    );

    await expect(service.cancelWave(wave.id, user())).resolves.toMatchObject({ status: PickWaveStatus.CANCELLED });

    expect(scopes.requireClientAccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'client-1', 'write');
    expect(tx.pickWave.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: wave.id, status: PickWaveStatus.FROZEN },
        data: expect.objectContaining({ status: PickWaveStatus.CANCELLED }),
      }),
    );
    expect(tx.clientRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: { status: ClientRequestStatus.APPROVED },
    });
    expect(instructions.invalidateRequestInstruction).toHaveBeenCalledWith('request-1');
  });

  it('не отменяет волну с уже собранной заявкой', async () => {
    const wave = waveFixture();
    wave.requests[0].status = PickWaveRequestStatus.PICKED;
    const prisma = { pickWave: { findUnique: vi.fn().mockResolvedValue(wave) }, $transaction: vi.fn() };
    const service = new FulfillmentWaveService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    // TEST: reach the picked-request guard, not an unrelated missing-warehouse error.
    await expect(service.cancelWave(wave.id, user())).rejects.toThrow(
      'В волне уже есть собранные заявки. Отмена может повредить складские остатки.',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('не отменяет волну, если по ней уже есть складское списание', async () => {
    const wave = waveFixture();
    const prisma = {
      pickWave: { findUnique: vi.fn().mockResolvedValue(wave) },
      stockMovement: { count: vi.fn().mockResolvedValue(1) },
      $transaction: vi.fn(),
    };
    const service = new FulfillmentWaveService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    // TEST: a posted movement prevents cancellation before the write transaction.
    await expect(service.cancelWave(wave.id, user())).rejects.toThrow(
      'По волне уже проведены складские движения. Безопасная отмена невозможна.',
    );
    expect(prisma.stockMovement.count).toHaveBeenCalledWith({
      where: { type: 'PICK', sourceDocument: { in: ['request-1'] }, idempotencyKey: { contains: wave.id } },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

function waveFixture() {
  return {
    id: 'wave-1',
    // TEST: wave and its request belong to the actor's concrete branch.
    warehouseId: 'warehouse-1',
    waveNumber: 'WAVE-1',
    status: PickWaveStatus.FROZEN,
    comment: null,
    requests: [
      {
        waveId: 'wave-1',
        requestId: 'request-1',
        status: PickWaveRequestStatus.PLANNED,
        request: {
          id: 'request-1',
          clientId: 'client-1',
          warehouseId: 'warehouse-1',
          title: 'Отгрузка',
          type: ClientRequestType.OUTBOUND,
          status: ClientRequestStatus.IN_WORK,
          priority: 'NORMAL',
          destinationCity: null,
          client: { id: 'client-1', code: 'CLIENT', name: 'Клиент' },
          items: [],
        },
      },
    ],
    balanceLines: [],
  };
}

function user(): AuthUser {
  return {
    id: 'user-1',
    email: 'admin@example.com',
    name: 'Администратор',
    roleCodes: ['ADMIN'],
    permissionCodes: ['stock:write'],
    activeWarehouseId: 'warehouse-1',
    warehouseIds: ['warehouse-1'],
    writableWarehouseIds: ['warehouse-1'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  };
}
