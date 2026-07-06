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
          payload: { clientId: 'client-1', barcode: '4600001', kiz: 'KIZ-1', boxCode: 'RCV-1', quantity: '2' },
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
        kiz: 'KIZ-1',
        boxCode: 'RCV-1',
        quantity: 2,
        idempotencyKey: 'receipt-1',
      }),
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
              fromBoxCode: 'BOX-1',
              toBoxCode: 'BOX-2',
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
        fromBoxCode: 'BOX-1',
        toBoxCode: 'BOX-2',
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
            payload: { clientId: 'client-1', barcode: '4600002', boxCode: 'RCV-1', quantity: 1 },
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
            payload: { clientId: 'client-1', barcode: '4600002', boxCode: 'BOX-1', countedQuantity: 3 },
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
            payload: { clientId: 'client-1', barcode: '4600002', boxCode: 'BOX-1', countedQuantity: 3 },
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
});

function createService(
  overrides: {
    transferBetweenBoxes?: ReturnType<typeof vi.fn>;
    receiveIntoBox?: ReturnType<typeof vi.fn>;
    prisma?: Record<string, unknown>;
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
  );
}
