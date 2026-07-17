import { TsdOperationStatus, TsdReviewReason } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TsdOperationLogService } from '../src/modules/tsd/tsd-operation-log.service';
import { TsdPayloadParser } from '../src/modules/tsd/tsd-payload.parser';
import { TsdSyncService } from '../src/modules/tsd/tsd-sync.service';

describe('TsdSyncService', () => {
  const user: AuthUser = {
    id: 'user-1',
    email: 'operator@example.com',
    name: 'Operator',
    roleCodes: ['OPERATOR'],
    permissionCodes: ['stock:write'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  };

  it('применяет receipt_scan как приход в короб', async () => {
    const receiveIntoBox = vi.fn().mockResolvedValue({ status: 'APPLIED' });
    const service = createService({ receiveIntoBox });

    await expect(
      service.acceptOperation(
        {
          deviceId: 'tsd-1',
          operationKey: 'receipt-1',
          operationType: 'receipt_scan',
          payload: { clientId: 'client-1', barcode: '4600001', boxCode: 'FFL_RCV_1', quantity: '2' },
        },
        user,
      ),
    ).resolves.toMatchObject({
      operationKey: 'receipt-1',
      operationType: 'receipt_scan',
      status: 'APPLIED',
    });
    expect(receiveIntoBox).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        barcode: '4600001',
        boxCode: 'FFL_RCV_1',
        quantity: 2,
        idempotencyKey: 'receipt-1',
      }),
      user,
    );
  });

  it('принимает товар без короба для клиента с поштучной приемкой', async () => {
    const receiveIntoBox = vi.fn().mockResolvedValue({ status: 'APPLIED' });
    const service = createService({
      receiveIntoBox,
      prisma: { client: { findUnique: vi.fn().mockResolvedValue({ storesWithoutBoxes: true }) } },
    });

    const result = await service.acceptOperation(
      {
        deviceId: 'tsd-1',
        operationKey: 'receipt-unboxed-1',
        operationType: 'receipt_scan',
        payload: { clientId: 'client-1', barcode: '4600003', quantity: 1 },
      },
      user,
    );

    expect(result.status).toBe('APPLIED');
    expect(receiveIntoBox).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', barcode: '4600003', boxCode: undefined, quantity: 1 }),
      user,
    );
  });

  it('применяет move_scan через stock transfer', async () => {
    const transferBetweenBoxes = vi.fn().mockResolvedValue({ status: 'APPLIED' });
    const service = createService({ transferBetweenBoxes });

    const [result] = await service.syncOperations(
      {
        operations: [
          {
            deviceId: 'tsd-1',
            operationKey: 'move-1',
            operationType: 'move_scan',
            payload: {
              clientId: 'client-1',
              barcode: '4600001',
              fromBoxCode: 'FFL_BOX_1',
              toBoxCode: 'FFL_BOX_2',
              quantity: '3',
            },
          },
        ],
      },
      user,
    );

    expect(result.status).toBe('APPLIED');
    expect(transferBetweenBoxes).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        barcode: '4600001',
        fromBoxCode: 'FFL_BOX_1',
        toBoxCode: 'FFL_BOX_2',
        quantity: 3,
        idempotencyKey: 'move-1',
      }),
      user,
    );
  });

  it('возвращает REJECTED для некорректного move_scan и продолжает batch', async () => {
    const receiveIntoBox = vi.fn().mockResolvedValue({ status: 'APPLIED' });
    const service = createService({ receiveIntoBox });

    const results = await service.syncOperations(
      {
        operations: [
          {
            deviceId: 'tsd-1',
            operationKey: 'bad-move',
            operationType: 'move_scan',
            payload: { clientId: 'client-1' },
          },
          {
            deviceId: 'tsd-1',
            operationKey: 'receipt-2',
            operationType: 'receipt_scan',
            payload: { clientId: 'client-1', barcode: '4600002', boxCode: 'FFL_RCV_1', quantity: 1 },
          },
        ],
      },
      user,
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ operationKey: 'bad-move', status: 'REJECTED' });
    expect(results[1]).toMatchObject({ operationKey: 'receipt-2', status: 'APPLIED' });
  });

  it('отправляет inventory_scan с расхождением в NEEDS_REVIEW', async () => {
    const service = createService({
      prisma: {
        barcode: {
          findFirst: vi.fn().mockResolvedValue({ sku: { id: 'sku-1' } }),
        },
        box: {
          findUnique: vi.fn().mockResolvedValue({ id: 'box-1' }),
        },
        stockBalance: {
          findFirst: vi.fn().mockResolvedValue({ quantity: 5 }),
        },
      },
    });

    const [result] = await service.syncOperations(
      {
        operations: [
          {
            deviceId: 'tsd-1',
            operationKey: 'inventory-mismatch',
            operationType: 'inventory_scan',
            payload: { clientId: 'client-1', barcode: '4600002', boxCode: 'FFL_BOX_1', countedQuantity: 3 },
          },
        ],
      },
      user,
    );

    expect(result).toMatchObject({
      operationKey: 'inventory-mismatch',
      status: 'NEEDS_REVIEW',
      reviewReason: TsdReviewReason.INVENTORY_MISMATCH,
    });
  });

  it('отклоняет операцию, если device token не совпадает с deviceId операции', async () => {
    const transferBetweenBoxes = vi.fn();
    const service = createService({ transferBetweenBoxes });

    const [result] = await service.syncOperations(
      {
        operations: [
          {
            deviceId: 'other-tsd',
            operationKey: 'receipt-2',
            operationType: 'receipt_scan',
            payload: { barcode: '4600003' },
          },
        ],
      },
      { ...user, deviceId: 'device-db-id', deviceCode: 'tsd-1' },
    );

    expect(result).toMatchObject({ status: 'REJECTED', reviewReason: TsdReviewReason.DEVICE_MISMATCH });
    expect(transferBetweenBoxes).not.toHaveBeenCalled();
  });

  it('возвращает итог ручного разбора для повторной операции ТСД', async () => {
    const service = createService({
      prisma: {
        tsdOperation: {
          findUnique: vi.fn().mockResolvedValue({
            status: TsdOperationStatus.REJECTED,
            serverMessage: 'Расхождение инвентаризации: в WMS 5, на ТСД 3.',
            reviewReason: TsdReviewReason.INVENTORY_MISMATCH,
            resolutionMessage: 'Отклонено: нужен повторный пересчет',
          }),
          upsert: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    const [result] = await service.syncOperations(
      {
        operations: [
          {
            deviceId: 'tsd-1',
            operationKey: 'inventory-reviewed',
            operationType: 'inventory_scan',
            payload: { clientId: 'client-1', barcode: '4600002', boxCode: 'FFL_BOX_1', countedQuantity: 3 },
          },
        ],
      },
      user,
    );

    expect(result).toMatchObject({
      operationKey: 'inventory-reviewed',
      status: 'REJECTED',
      message: 'Отклонено: нужен повторный пересчет',
      reviewReason: TsdReviewReason.INVENTORY_MISMATCH,
      resolutionMessage: 'Отклонено: нужен повторный пересчет',
    });
  });

  it('последовательно проверяет одну позицию при параллельной работе двух ТСД', async () => {
    let remaining = 1;
    let activeChecks = 0;
    let maxActiveChecks = 0;
    const assertRelabelProgressAvailable = vi.fn().mockImplementation(async () => {
      activeChecks += 1;
      maxActiveChecks = Math.max(maxActiveChecks, activeChecks);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeChecks -= 1;
      if (remaining <= 0) throw new Error('Уже выполнено другим сборщиком');
      remaining -= 1;
    });
    const service = createService({
      assembly: { assertRelabelProgressAvailable, assertOutgoingBoxAvailable: vi.fn(), assertMovementProgressAvailable: vi.fn() },
    });
    const operation = (deviceId: string, operationKey: string) => ({
      deviceId,
      operationKey,
      operationType: 'assembly_stage' as const,
      payload: {
        requestId: 'request-1',
        action: 'relabel-complete',
        sourceBox: 'FFL_BOX_1',
        oldBarcode: '4600001',
        newBarcode: '4600002',
      },
    });

    const [first, second] = await Promise.all([
      service.acceptOperation(operation('tsd-1', 'relabel-1'), user),
      service.acceptOperation(operation('tsd-2', 'relabel-2'), user),
    ]);

    expect([first.status, second.status].sort()).toEqual(['ACCEPTED', 'REJECTED']);
    expect(maxActiveChecks).toBe(1);
  });
});

function createService(
  overrides: {
    transferBetweenBoxes?: ReturnType<typeof vi.fn>;
    receiveIntoBox?: ReturnType<typeof vi.fn>;
    prisma?: Record<string, unknown>;
    assembly?: Record<string, unknown>;
  } = {},
) {
  const prisma = {
    tsdOperation: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    sku: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    barcode: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    box: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    stockBalance: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    client: {
      findUnique: vi.fn().mockResolvedValue({ storesWithoutBoxes: false }),
    },
    ...overrides.prisma,
  };

  const clientScopes = {
    requireClientAccess: vi.fn(),
    requireGlobalClientAccess: vi.fn(),
  };

  return new TsdSyncService(
    {
      transferBetweenBoxes: overrides.transferBetweenBoxes ?? vi.fn(),
      receiveIntoBox: overrides.receiveIntoBox ?? vi.fn(),
    } as never,
    { touchActiveDevice: vi.fn().mockResolvedValue(undefined) } as never,
    prisma as never,
    clientScopes as never,
    new TsdPayloadParser(),
    new TsdOperationLogService(prisma as never, clientScopes as never),
    overrides.assembly as never,
  );
}
