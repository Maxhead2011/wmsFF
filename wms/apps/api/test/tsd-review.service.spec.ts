import { TsdOperationStatus, TsdReviewReason } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TsdPayloadParser } from '../src/modules/tsd/tsd-payload.parser';
import { TsdReviewService } from '../src/modules/tsd/tsd-review.service';

describe('TsdReviewService', () => {
  it('подтверждает inventory_scan и закрывает операцию после ledger adjustment', async () => {
    const prisma = {
      tsdOperation: {
        findUnique: vi.fn().mockResolvedValue(reviewOperation()),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...reviewOperation(), ...data })),
      },
    };
    const stockOperations = {
      adjustInventoryToCounted: vi.fn().mockResolvedValue({
        status: 'APPLIED',
        previousQuantity: 5,
        countedQuantity: 3,
        delta: -2,
      }),
    };
    const service = new TsdReviewService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
      stockOperations as never,
      new TsdPayloadParser(),
    );

    await expect(
      service.resolveReviewOperation(
        'operation-1',
        { action: 'APPLY_INVENTORY_ADJUSTMENT', comment: 'Факт подтвержден' },
        user(),
      ),
    ).resolves.toMatchObject({
      operation: {
        status: TsdOperationStatus.ACCEPTED,
      },
      resolution: {
        action: 'APPLY_INVENTORY_ADJUSTMENT',
        adjustment: {
          delta: -2,
        },
      },
    });
    expect(stockOperations.adjustInventoryToCounted).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        barcode: '4600001',
        boxCode: 'FFL_BOX_1',
        countedQuantity: 3,
        idempotencyKey: 'inventory-1:inventory-adjustment',
      }),
      expect.objectContaining({ id: 'user-1' }),
    );
    expect(prisma.tsdOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TsdOperationStatus.ACCEPTED,
          reviewReason: TsdReviewReason.INVENTORY_MISMATCH,
          resolutionMessage: 'Разбор подтвержден: дельта -2.',
          reviewAction: 'APPLY_INVENTORY_ADJUSTMENT',
        }),
      }),
    );
  });

  it('отклоняет операцию без изменения stock ledger', async () => {
    const prisma = {
      tsdOperation: {
        findUnique: vi.fn().mockResolvedValue(reviewOperation()),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...reviewOperation(), ...data })),
      },
    };
    const stockOperations = {
      adjustInventoryToCounted: vi.fn(),
    };
    const clientScopes = {
      requireClientAccess: vi.fn(),
    };
    const service = new TsdReviewService(
      prisma as never,
      clientScopes as never,
      stockOperations as never,
      new TsdPayloadParser(),
    );

    await expect(
      service.resolveReviewOperation(
        'operation-1',
        { action: 'REJECT', comment: 'Пересчитать повторно', reason: TsdReviewReason.OTHER },
        user(),
      ),
    ).resolves.toMatchObject({
      operation: {
        status: TsdOperationStatus.REJECTED,
        reviewReason: TsdReviewReason.OTHER,
        resolutionMessage: 'Отклонено: Пересчитать повторно',
      },
      resolution: {
        action: 'REJECT',
      },
    });
    expect(stockOperations.adjustInventoryToCounted).not.toHaveBeenCalled();
    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'client-1', 'write');
    expect(prisma.tsdOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewReason: TsdReviewReason.OTHER,
          resolutionMessage: 'Отклонено: Пересчитать повторно',
        }),
      }),
    );
  });

  it('принимает фактический товар с ошибкой без повторной привязки занятого КИЗ', async () => {
    const operation = receiptReviewOperation();
    const prisma = {
      tsdOperation: {
        findUnique: vi.fn().mockResolvedValue(operation),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...operation, ...data })),
      },
      productMark: {
        findFirst: vi.fn().mockResolvedValue({
          box: { code: 'FFL_OLD_BOX' },
          sku: { name: 'Костюм синий' },
        }),
      },
    };
    const stockOperations = {
      receiveIntoBox: vi.fn().mockResolvedValue({ status: 'APPLIED', box: 'FFL_NEW_BOX', quantity: 1 }),
    };
    const clientScopes = {
      requireGlobalClientAccess: vi.fn(),
      requireClientAccess: vi.fn(),
    };
    const service = new TsdReviewService(
      prisma as never,
      clientScopes as never,
      stockOperations as never,
      new TsdPayloadParser(),
    );

    await expect(
      service.resolveReviewOperation(
        operation.id,
        { action: 'ACCEPT_RECEIPT_WITH_ERROR', comment: 'В коробе физически 10 единиц' },
        user(),
      ),
    ).resolves.toMatchObject({
      operation: { status: TsdOperationStatus.ACCEPTED },
      resolution: {
        action: 'ACCEPT_RECEIPT_WITH_ERROR',
        receipt: { status: 'APPLIED', quantity: 1 },
        duplicate: { boxCode: 'FFL_OLD_BOX', skuName: 'Костюм синий' },
      },
    });
    expect(stockOperations.receiveIntoBox).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        barcode: '2042311717329',
        boxCode: 'FFL_NEW_BOX',
        quantity: 1,
        allowReceiptError: true,
        idempotencyKey: 'receipt-duplicate-1:accepted-with-error',
      }),
      expect.objectContaining({ id: 'user-1' }),
    );
    expect(stockOperations.receiveIntoBox.mock.calls[0][0]).not.toHaveProperty('kiz');
    expect(prisma.tsdOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TsdOperationStatus.ACCEPTED,
          reviewReason: TsdReviewReason.RECEIPT_FAILED,
          reviewAction: 'APPLY_INVENTORY_ADJUSTMENT',
          reviewComment: expect.stringContaining('[RECEIPT_ERROR_ACCEPTED]'),
          resolutionMessage: expect.stringContaining('FFL_OLD_BOX'),
        }),
      }),
    );
  });

  it('отдает историю разобранных операций ТСД', async () => {
    const prisma = {
      tsdOperation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const clientScopes = {
      requireGlobalClientAccess: vi.fn(),
    };
    const service = new TsdReviewService(
      prisma as never,
      clientScopes as never,
      { adjustInventoryToCounted: vi.fn() } as never,
      new TsdPayloadParser(),
    );

    await expect(service.listReviewHistory(user())).resolves.toEqual([]);
    expect(clientScopes.requireGlobalClientAccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }));
    expect(prisma.tsdOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          reviewedAt: {
            not: null,
          },
        },
        orderBy: [{ reviewedAt: 'desc' }],
        take: 200,
      }),
    );
  });

  it('показывает в сводке непринятый товар и короб существующего дубля КИЗ', async () => {
    const operation = receiptReviewOperation();
    const prisma = {
      tsdOperation: { findMany: vi.fn().mockResolvedValue([operation]) },
      client: { findMany: vi.fn().mockResolvedValue([{ id: 'client-1', code: 'CL-1', name: 'Тестовый клиент' }]) },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sku-new',
            clientId: 'client-1',
            internalSku: 'NEW-SKU',
            article: 'ART-NEW',
            name: 'Костюм новый',
            color: 'Синий',
            size: 'M',
            barcodes: [{ value: '2042311717329', isPrimary: true }],
          },
        ]),
      },
      productMark: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'mark-1',
            clientId: 'client-1',
            value: '0104680992590237215SSMBHDEDWKWW91',
            box: { code: 'FFL_OLD_BOX' },
            sku: {
              id: 'sku-old',
              internalSku: 'OLD-SKU',
              article: 'ART-OLD',
              name: 'Костюм, где уже записан КИЗ',
              color: 'Черный',
              size: 'L',
              barcodes: [{ value: '2042311717000', isPrimary: true }],
            },
          },
        ]),
      },
      tsdDevice: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'device-1', code: 'tsd-1', name: 'ТСД 1', user: { name: 'Сборщик', email: 'worker@example.com' } },
        ]),
      },
      box: {
        findMany: vi.fn().mockResolvedValue([
          {
            clientId: 'client-1',
            code: 'FFL_NEW_BOX',
            balances: [{ quantity: 9 }],
          },
        ]),
      },
    };
    const clientScopes = { requireGlobalClientAccess: vi.fn() };
    const service = new TsdReviewService(
      prisma as never,
      clientScopes as never,
      {} as never,
      new TsdPayloadParser(),
    );

    await expect(service.listReceiptReviewDashboard(user())).resolves.toMatchObject({
      stats: {
        acceptedQuantity: 0,
        notAcceptedQuantity: 1,
        duplicateKizQuantity: 1,
      },
      items: [
        {
          result: 'NOT_ACCEPTED',
          boxCode: 'FFL_NEW_BOX',
          sku: { name: 'Костюм новый', color: 'Синий', size: 'M' },
          duplicate: {
            boxCode: 'FFL_OLD_BOX',
            name: 'Костюм, где уже записан КИЗ',
            barcode: '2042311717000',
          },
        },
      ],
      boxesToCheck: [
        {
          boxCode: 'FFL_NEW_BOX',
          boxExists: true,
          accountedQuantity: 9,
          notAcceptedQuantity: 1,
          maximumPhysicalQuantity: 10,
          issueOperations: 1,
          duplicateKizQuantity: 1,
        },
      ],
    });
    expect(clientScopes.requireGlobalClientAccess).toHaveBeenCalled();
  });
});

function reviewOperation() {
  return {
    id: 'operation-1',
    deviceId: 'tsd-1',
    operationKey: 'inventory-1',
    operationType: 'inventory_scan',
    payload: {
      clientId: 'client-1',
      barcode: '4600001',
      boxCode: 'FFL_BOX_1',
      countedQuantity: 3,
    },
    status: TsdOperationStatus.NEEDS_REVIEW,
    serverMessage: 'Расхождение инвентаризации: в WMS 5, на ТСД 3.',
    reviewReason: TsdReviewReason.INVENTORY_MISMATCH,
    resolutionMessage: null,
    reviewAction: null,
    reviewComment: null,
    reviewedByUserId: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function receiptReviewOperation() {
  return {
    id: 'receipt-operation-1',
    deviceId: 'tsd-1',
    operationKey: 'receipt-duplicate-1',
    operationType: 'receipt_scan',
    payload: {
      clientId: 'client-1',
      barcode: '2042311717329',
      kiz: '0104680992590237215SSMBHDEDWKWW91',
      boxCode: 'FFL_NEW_BOX',
      quantity: 1,
      sourceDocument: 'TSD-RECEIPT-TEST',
    },
    status: TsdOperationStatus.NEEDS_REVIEW,
    serverMessage: 'ДУБЛЬ КИЗ. Этот КИЗ уже находится в коробе FFL_OLD_BOX.',
    reviewReason: TsdReviewReason.RECEIPT_FAILED,
    resolutionMessage: null,
    reviewAction: null,
    reviewComment: null,
    reviewedByUserId: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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
