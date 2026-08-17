import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

describe('StockOperationsService', () => {
  const service = new StockOperationsService({} as never, {} as never, {} as never);

  it('планирует перенос между коробами без потери количества', () => {
    expect(service.planTransferQuantities(10, 3, 4)).toEqual({
      sourceQuantity: 6,
      targetQuantity: 7,
    });
  });

  it('не разрешает переносить больше доступного остатка', () => {
    expect(() => service.planTransferQuantities(2, 0, 3)).toThrow(BadRequestException);
  });

  it('создает отрицательную корректировку инвентаризации через ledger', async () => {
    const tx = {
      stockMovement: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      },
      sku: {
        findFirst: vi.fn().mockResolvedValue({ id: 'sku-1' }),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue({ id: 'box-1', code: 'BOX-1', palletId: null }),
      },
      stockBalance: {
        findFirst: vi.fn().mockResolvedValue({ id: 'balance-1', quantity: 5 }),
        update: vi.fn().mockResolvedValue({ id: 'balance-1', quantity: 2 }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const adjustmentService = new StockOperationsService(
      { $transaction: (callback: (tx: typeof tx) => unknown) => callback(tx) } as never,
      { requireClientAccess: vi.fn() } as never,
      { balanceKey: vi.fn() } as never,
    );

    await expect(
      adjustmentService.adjustInventoryToCounted(
        {
          clientId: 'client-1',
          skuId: 'sku-1',
          boxCode: 'BOX-1',
          countedQuantity: 2,
          idempotencyKey: 'inventory-1',
        },
        user(),
      ),
    ).resolves.toMatchObject({
      status: 'APPLIED',
      previousQuantity: 5,
      countedQuantity: 2,
      delta: -3,
    });
    expect(tx.stockBalance.update).toHaveBeenCalledWith({
      where: { id: 'balance-1' },
      data: { quantity: { decrement: 3 } },
    });
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'INVENTORY_ADJUSTMENT',
          quantity: -3,
          idempotencyKey: 'inventory-1',
        }),
      }),
    );
  });

  it('собирает outbound-заявку в PACKING через PICK-движения', async () => {
    const tx = {
      stockMovement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          type: 'OUTBOUND',
          status: 'APPROVED',
          title: 'Отгрузка',
          managerComment: null,
          items: [{ id: 'item-1', skuId: 'sku-1', barcode: null, quantity: 2 }],
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      clientRequestEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'event-packed' }),
      },
      sku: {
        findFirst: vi.fn().mockResolvedValue({ id: 'sku-1', internalSku: 'SKU-1' }),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'balance-1',
            balanceKey: 'client-1:sku-1:box-1:AVAILABLE',
            clientId: 'client-1',
            skuId: 'sku-1',
            boxId: 'box-1',
            palletId: null,
            status: 'AVAILABLE',
            quantity: 5,
          },
        ]),
        update: vi.fn().mockResolvedValue({ id: 'balance-1', quantity: 3 }),
        delete: vi.fn().mockResolvedValue(undefined),
        upsert: vi.fn().mockResolvedValue({ id: 'packing-balance' }),
      },
    };
    const pickService = new StockOperationsService(
      { $transaction: (callback: (tx: typeof tx) => unknown) => callback(tx) } as never,
      { requireClientAccess: vi.fn() } as never,
      { balanceKey: vi.fn().mockReturnValue('client-1:sku-1:box-1:PACKING') } as never,
    );

    await expect(
      pickService.pickClientRequest(
        {
          requestId: 'request-1',
          idempotencyKey: 'pick-1',
        },
        user(),
      ),
    ).resolves.toMatchObject({
      status: 'APPLIED',
      requestId: 'request-1',
      pickedLines: [
        {
          itemId: 'item-1',
          skuId: 'sku-1',
          requestedQuantity: 2,
          pickedQuantity: 2,
        },
      ],
    });

    expect(tx.stockBalance.update).toHaveBeenCalledWith({
      where: { id: 'balance-1' },
      data: { quantity: { decrement: 2 } },
    });
    expect(tx.stockBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'PACKING',
          quantity: 2,
        }),
      }),
    );
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'PICK',
          status: 'AVAILABLE',
          quantity: -2,
          sourceDocument: 'request-1',
          idempotencyKey: 'pick-1:item-1:balance-1:out',
        }),
      }),
    );
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'PICK',
          status: 'PACKING',
          quantity: 2,
          sourceDocument: 'request-1',
          idempotencyKey: 'pick-1:item-1:balance-1:in',
        }),
      }),
    );
    expect(tx.clientRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'IN_WORK',
          assignedToUserId: 'user-1',
        }),
      }),
    );
  });

  it('не запускает сборку повторно после перехода заявки в работу', async () => {
    const tx = {
      stockMovement: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          type: 'OUTBOUND',
          status: 'IN_WORK',
          title: 'Отгрузка',
          managerComment: null,
          items: [{ id: 'item-1', skuId: 'sku-1', barcode: null, quantity: 2 }],
        }),
      },
      stockBalance: {
        findMany: vi.fn(),
      },
    };
    const pickService = new StockOperationsService(
      { $transaction: (callback: (tx: typeof tx) => unknown) => callback(tx) } as never,
      { requireClientAccess: vi.fn() } as never,
      { balanceKey: vi.fn() } as never,
    );

    await expect(
      pickService.pickClientRequest(
        {
          requestId: 'request-1',
          idempotencyKey: 'pick-again',
        },
        user(),
      ),
    ).rejects.toThrow(BadRequestException);

    expect(tx.stockBalance.findMany).not.toHaveBeenCalled();
  });

  it('упаковывает собранную outbound-заявку в SHIPPING через PACK-движения', async () => {
    const tx = {
      stockMovement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          type: 'OUTBOUND',
          status: 'IN_WORK',
          title: 'Отгрузка',
          items: [{ id: 'item-1', skuId: 'sku-1', barcode: null, quantity: 2 }],
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      clientRequestEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'event-packed-places' }),
      },
      sku: {
        findFirst: vi.fn().mockResolvedValue({ id: 'sku-1', internalSku: 'SKU-1' }),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'packing-balance',
            balanceKey: 'client-1:sku-1:box-1:PACKING',
            clientId: 'client-1',
            skuId: 'sku-1',
            boxId: 'box-1',
            palletId: null,
            status: 'PACKING',
            quantity: 2,
          },
        ]),
        update: vi.fn().mockResolvedValue({ id: 'packing-balance', quantity: 0 }),
        delete: vi.fn().mockResolvedValue(undefined),
        upsert: vi.fn().mockResolvedValue({ id: 'shipping-balance' }),
      },
      clientRequestPackage: {
        create: vi.fn().mockResolvedValue({
          id: 'package-1',
          requestId: 'request-1',
          clientId: 'client-1',
          packageCode: 'PKG-request--1',
          items: [],
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const packService = new StockOperationsService(
      { $transaction: (callback: (tx: typeof tx) => unknown) => callback(tx) } as never,
      { requireClientAccess: vi.fn() } as never,
      { balanceKey: vi.fn().mockReturnValue('client-1:sku-1:box-1:SHIPPING') } as never,
    );

    await expect(
      packService.packageClientRequest(
        {
          requestId: 'request-1',
          idempotencyKey: 'pack-1',
        },
        user(),
      ),
    ).resolves.toMatchObject({
      status: 'APPLIED',
      requestId: 'request-1',
      packedLines: [
        {
          itemId: 'item-1',
          skuId: 'sku-1',
          requestedQuantity: 2,
          packedQuantity: 2,
        },
      ],
      packages: [
        {
          packageCode: 'PKG-request--1',
        },
      ],
    });

    expect(tx.stockBalance.delete).toHaveBeenCalledWith({ where: { id: 'packing-balance' } });
    expect(tx.stockBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'SHIPPING',
          quantity: 2,
        }),
      }),
    );
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'PACK',
          status: 'PACKING',
          quantity: -2,
          sourceDocument: 'request-1',
        }),
      }),
    );
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'PACK',
          status: 'SHIPPING',
          quantity: 2,
          sourceDocument: 'request-1',
        }),
      }),
    );
    expect(tx.clientRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PACKED',
          assignedToUserId: 'user-1',
        }),
      }),
    );
    expect(tx.clientRequestPackage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestId: 'request-1',
          clientId: 'client-1',
          packageCode: 'PKG-request--1',
          packageType: 'BOX',
          createdByUserId: 'user-1',
          items: {
            create: [
              expect.objectContaining({
                requestItemId: 'item-1',
                skuId: 'sku-1',
                quantity: 2,
              }),
            ],
          },
        }),
      }),
    );
  });

  it('проверяет ручную детализацию упаковочных мест по количеству заявки', async () => {
    const tx = {
      stockMovement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      },
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          type: 'OUTBOUND',
          status: 'IN_WORK',
          title: 'Отгрузка',
          items: [{ id: 'item-1', skuId: 'sku-1', barcode: null, quantity: 3 }],
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      clientRequestEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'event-done' }),
      },
      sku: {
        findFirst: vi.fn().mockResolvedValue({ id: 'sku-1', internalSku: 'SKU-1' }),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'packing-balance',
            balanceKey: 'client-1:sku-1:box-1:PACKING',
            clientId: 'client-1',
            skuId: 'sku-1',
            boxId: 'box-1',
            palletId: null,
            status: 'PACKING',
            quantity: 3,
          },
        ]),
        update: vi.fn().mockResolvedValue({ id: 'packing-balance', quantity: 0 }),
        delete: vi.fn().mockResolvedValue(undefined),
        upsert: vi.fn().mockResolvedValue({ id: 'shipping-balance' }),
      },
      clientRequestPackage: {
        create: vi.fn().mockResolvedValue({
          id: 'package-1',
          requestId: 'request-1',
          clientId: 'client-1',
          packageCode: 'PLACE-1',
          items: [],
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const packService = new StockOperationsService(
      { $transaction: (callback: (tx: typeof tx) => unknown) => callback(tx) } as never,
      { requireClientAccess: vi.fn() } as never,
      { balanceKey: vi.fn().mockReturnValue('client-1:sku-1:box-1:SHIPPING') } as never,
    );

    await expect(
      packService.packageClientRequest(
        {
          requestId: 'request-1',
          idempotencyKey: 'pack-places',
          packages: [
            {
              packageCode: 'PLACE-1',
              packageType: 'BOX',
              weightGrams: 1200,
              items: [{ requestItemId: 'item-1', quantity: 2 }],
            },
            {
              packageCode: 'PLACE-2',
              packageType: 'BOX',
              items: [{ requestItemId: 'item-1', quantity: 1 }],
            },
          ],
        },
        user(),
      ),
    ).resolves.toMatchObject({
      status: 'APPLIED',
    });

    expect(tx.clientRequestPackage.create).toHaveBeenCalledTimes(2);
    expect(tx.clientRequestPackage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          packageCode: 'PLACE-1',
          weightGrams: 1200,
          items: {
            create: [
              expect.objectContaining({
                requestItemId: 'item-1',
                quantity: 2,
              }),
            ],
          },
        }),
      }),
    );
  });

  it('закрывает outbound-заявку отгрузкой из SHIPPING через SHIP-движение', async () => {
    const tx = {
      stockMovement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          type: 'OUTBOUND',
          status: 'PACKED',
          title: 'Отгрузка',
          items: [{ id: 'item-1', skuId: 'sku-1', barcode: null, quantity: 2 }],
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      clientRequestEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'event-shipped' }),
      },
      sku: {
        findFirst: vi.fn().mockResolvedValue({ id: 'sku-1', internalSku: 'SKU-1' }),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'shipping-balance',
            balanceKey: 'client-1:sku-1:box-1:SHIPPING',
            clientId: 'client-1',
            skuId: 'sku-1',
            boxId: 'box-1',
            palletId: null,
            status: 'SHIPPING',
            quantity: 2,
          },
        ]),
        update: vi.fn().mockResolvedValue({ id: 'shipping-balance', quantity: 0 }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const shipService = new StockOperationsService(
      { $transaction: (callback: (tx: typeof tx) => unknown) => callback(tx) } as never,
      { requireClientAccess: vi.fn() } as never,
      { balanceKey: vi.fn() } as never,
    );

    await expect(
      shipService.shipClientRequest(
        {
          requestId: 'request-1',
          idempotencyKey: 'ship-1',
        },
        user(),
      ),
    ).resolves.toMatchObject({
      status: 'APPLIED',
      requestId: 'request-1',
      shippedLines: [
        {
          itemId: 'item-1',
          skuId: 'sku-1',
          requestedQuantity: 2,
          shippedQuantity: 2,
        },
      ],
    });

    expect(tx.stockBalance.delete).toHaveBeenCalledWith({ where: { id: 'shipping-balance' } });
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'SHIP',
          status: 'SHIPPING',
          quantity: -2,
          sourceDocument: 'request-1',
          idempotencyKey: 'ship-1:item-1:shipping-balance:out',
        }),
      }),
    );
    expect(tx.clientRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DONE',
          assignedToUserId: 'user-1',
        }),
      }),
    );
  });

  it('ручное закрытие товарной DELIVERY-заявки списывает товар из выбранного короба и запускает формирование счета', async () => {
    const tx = {
      stockMovement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          type: 'DELIVERY',
          status: 'APPROVED',
          title: 'Ручная сдача',
          items: [{ id: 'item-1', skuId: 'sku-1', barcode: null, quantity: 3 }],
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      clientRequestPackage: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'package-1', items: [] }),
      },
      clientRequestEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'event-1' }),
      },
      clientRequestBoxSelection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'selection-1',
            requestItemId: 'item-1',
            skuId: 'sku-1',
            boxId: 'box-selected',
            quantity: 3,
            box: { code: 'FFL_SELECTED' },
          },
        ]),
      },
      sku: {
        findFirst: vi.fn().mockResolvedValue({ id: 'sku-1', internalSku: 'SKU-1' }),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'other-balance',
            balanceKey: 'client-1:sku-1:box-other:no-pallet:AVAILABLE',
            clientId: 'client-1',
            skuId: 'sku-1',
            boxId: 'box-other',
            palletId: null,
            status: 'AVAILABLE',
            quantity: 20,
            updatedAt: new Date('2026-07-01T00:00:00.000Z'),
            box: { code: 'FFL_OTHER' },
          },
          {
            id: 'selected-balance',
            balanceKey: 'client-1:sku-1:box-selected:no-pallet:AVAILABLE',
            clientId: 'client-1',
            skuId: 'sku-1',
            boxId: 'box-selected',
            palletId: null,
            status: 'AVAILABLE',
            quantity: 3,
            updatedAt: new Date('2026-07-03T00:00:00.000Z'),
            box: { code: 'FFL_SELECTED' },
          },
        ]),
        update: vi.fn().mockResolvedValue({ id: 'selected-balance', quantity: 0 }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const billingAutomation = {
      generateForDoneRequest: vi.fn().mockResolvedValue({ status: 'APPLIED', created: 1, mainInvoiceId: 'invoice-1' }),
    };
    const shipService = new StockOperationsService(
      { $transaction: (callback: (tx: typeof tx) => unknown) => callback(tx) } as never,
      { requireClientAccess: vi.fn() } as never,
      { balanceKey: vi.fn() } as never,
      billingAutomation as never,
    );

    await expect(
      shipService.shipClientRequestFromCurrentStock(
        {
          requestId: 'request-1',
          idempotencyKey: 'manual-done',
          comment: 'Сдано вручную',
          boxes: 1,
          pallets: 0,
          packedUnits: 3,
        },
        user(),
      ),
    ).resolves.toMatchObject({
      status: 'APPLIED',
      requestId: 'request-1',
      shippedLines: [
        {
          itemId: 'item-1',
          skuId: 'sku-1',
          requestedQuantity: 3,
          shippedQuantity: 3,
        },
      ],
    });

    expect(tx.stockBalance.delete).toHaveBeenCalledWith({ where: { id: 'selected-balance' } });
    expect(tx.stockBalance.delete).not.toHaveBeenCalledWith({ where: { id: 'other-balance' } });
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'SHIP',
          status: 'AVAILABLE',
          quantity: -3,
          sourceDocument: 'request-1',
          boxId: 'box-selected',
          idempotencyKey: 'manual-done:item-1:selected-balance:out',
        }),
      }),
    );
    expect(tx.clientRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DONE',
          assignedToUserId: 'user-1',
          managerComment: 'Сдано вручную',
        }),
      }),
    );
    expect(billingAutomation.generateForDoneRequest).toHaveBeenCalledWith('request-1', expect.any(Object));
  });

  it('восстанавливает недостающий резерв уже собранного FBS после инвентаризации короба', async () => {
    const tx = {
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue(
          Array.from({ length: 7 }, () => ({
            requestItemId: 'item-1',
            skuId: 'sku-1',
            boxId: 'box-1',
            itemCount: 1,
            completedAt: new Date('2026-07-22T20:00:00.000Z'),
          })),
        ),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            skuId: 'sku-1',
            boxId: 'box-1',
            status: 'AVAILABLE',
            quantity: 1,
          },
        ]),
        upsert: vi.fn().mockResolvedValue({ id: 'shipping-balance' }),
      },
      box: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'box-1',
            code: 'FFL_LKB1107_213',
            palletId: null,
          },
        ]),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          {
            skuId: 'sku-1',
            boxId: 'box-1',
            createdAt: new Date('2026-07-23T12:00:00.000Z'),
          },
        ]),
        create: vi.fn().mockResolvedValue({ id: 'recovery-movement' }),
      },
    };
    const recoveryService = new StockOperationsService(
      {} as never,
      {} as never,
      {
        balanceKey: vi.fn().mockReturnValue('client-1:sku-1:box-1:no-pallet:SHIPPING'),
      } as never,
    );

    await (recoveryService as unknown as {
      restoreCompletedFbsSelectionShortages: (
        tx: typeof tx,
        request: {
          id: string;
          clientId: string;
          items: Array<{ id: string; skuId: string; barcode: null; quantity: number }>;
        },
        selections: Array<{
          id: string;
          requestItemId: string;
          skuId: string;
          boxId: string;
          quantity: number;
          box: { code: string };
        }>,
        baseKey: string,
      ) => Promise<void>;
    }).restoreCompletedFbsSelectionShortages(
      tx,
      {
        id: 'request-32',
        clientId: 'client-1',
        items: [{ id: 'item-1', skuId: 'sku-1', barcode: null, quantity: 7 }],
      },
      [
        {
          id: 'selection-1',
          requestItemId: 'item-1',
          skuId: 'sku-1',
          boxId: 'box-1',
          quantity: 7,
          box: { code: 'FFL_LKB1107_213' },
        },
      ],
      'manual-status-done:request-32',
    );

    expect(tx.stockBalance.upsert).toHaveBeenCalledWith({
      where: { balanceKey: 'client-1:sku-1:box-1:no-pallet:SHIPPING' },
      update: { quantity: { increment: 7 } },
      create: {
        balanceKey: 'client-1:sku-1:box-1:no-pallet:SHIPPING',
        clientId: 'client-1',
        skuId: 'sku-1',
        boxId: 'box-1',
        palletId: null,
        status: 'SHIPPING',
        quantity: 7,
      },
    });
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'INVENTORY_ADJUSTMENT',
          status: 'SHIPPING',
          quantity: 7,
          sourceDocument: 'request-32',
          idempotencyKey: 'manual-status-done:request-32:fbs-reconciled:selection-1',
        }),
      }),
    );
  });

  it('не считает переклейку пересчётом и списывает собранный товар из AVAILABLE', async () => {
    const availableBalance = {
      id: 'available-balance',
      balanceKey: 'client-1:sku-1:box-1:no-pallet:AVAILABLE',
      clientId: 'client-1',
      skuId: 'sku-1',
      boxId: 'box-1',
      palletId: null,
      status: 'AVAILABLE',
      quantity: 9,
      updatedAt: new Date('2026-07-24T19:00:00.000Z'),
    };
    const tx = {
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            requestItemId: 'item-1',
            skuId: 'sku-1',
            boxId: 'box-1',
            itemCount: 1,
            completedAt: new Date('2026-07-24T20:00:00.000Z'),
          },
        ]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([availableBalance]),
        update: vi.fn().mockResolvedValue({ ...availableBalance, quantity: 8 }),
        delete: vi.fn(),
        upsert: vi.fn().mockResolvedValue({ id: 'shipping-balance' }),
      },
      box: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'box-1',
            code: 'FFL_LKB1107_245',
            palletId: null,
          },
        ]),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          {
            skuId: 'sku-1',
            boxId: 'box-1',
            createdAt: new Date('2026-07-24T20:01:00.000Z'),
            idempotencyKey: 'fbs-relabel:assembly-1:source',
            sourceDocument: 'FBS TSD, заказ 5355467854',
          },
        ]),
        create: vi.fn().mockResolvedValue({ id: 'movement-1' }),
      },
    };
    const recoveryService = new StockOperationsService(
      {} as never,
      {} as never,
      {
        balanceKey: vi.fn().mockReturnValue('client-1:sku-1:box-1:no-pallet:SHIPPING'),
      } as never,
    );

    await (recoveryService as unknown as {
      restoreCompletedFbsSelectionShortages: (
        tx: typeof tx,
        request: {
          id: string;
          clientId: string;
          items: Array<{ id: string; skuId: string; barcode: null; quantity: number }>;
        },
        selections: Array<{
          id: string;
          requestItemId: string;
          skuId: string;
          boxId: string;
          quantity: number;
          box: { code: string };
        }>,
        baseKey: string,
      ) => Promise<void>;
    }).restoreCompletedFbsSelectionShortages(
      tx,
      {
        id: 'request-35',
        clientId: 'client-1',
        items: [{ id: 'item-1', skuId: 'sku-1', barcode: null, quantity: 1 }],
      },
      [
        {
          id: 'selection-1',
          requestItemId: 'item-1',
          skuId: 'sku-1',
          boxId: 'box-1',
          quantity: 1,
          box: { code: 'FFL_LKB1107_245' },
        },
      ],
      'manual-status-done:request-35',
    );

    expect(tx.stockBalance.update).toHaveBeenCalledWith({
      where: { id: 'available-balance' },
      data: { quantity: { decrement: 1 } },
    });
    expect(tx.stockBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { quantity: { increment: 1 } },
        create: expect.objectContaining({
          status: 'SHIPPING',
          quantity: 1,
        }),
      }),
    );
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'PICK',
          status: 'AVAILABLE',
          quantity: -1,
          idempotencyKey:
            'manual-status-done:request-35:fbs-reserved:selection-1:available-balance:out',
        }),
      }),
    );
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'PACK',
          status: 'SHIPPING',
          quantity: 1,
          idempotencyKey: 'manual-status-done:request-35:fbs-reserved:selection-1:in',
        }),
      }),
    );
  });

  it('закрывает проблемную позицию по подтверждённому физическому коробу и восстанавливает только недостающую часть', async () => {
    const existingBalance = {
      id: 'balance-1',
      balanceKey: 'client-1:sku-1:box-1:no-pallet:AVAILABLE',
      clientId: 'client-1',
      skuId: 'sku-1',
      boxId: 'box-1',
      palletId: null,
      status: 'AVAILABLE',
      quantity: 1,
      updatedAt: new Date('2026-07-25T00:00:00.000Z'),
      box: { code: 'FFL_LKB1107_245' },
    };
    const reconciledBalance = {
      id: 'shipping-1',
      balanceKey: 'client-1:sku-1:box-1:no-pallet:SHIPPING',
      clientId: 'client-1',
      skuId: 'sku-1',
      boxId: 'box-1',
      palletId: null,
      status: 'SHIPPING',
      quantity: 1,
      updatedAt: new Date('2026-07-25T01:00:00.000Z'),
    };
    const tx = {
      sku: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'sku-1',
          internalSku: 'Костюм-вейв-44',
          weightGrams: 500,
        }),
      },
      box: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'box-1',
            code: 'FFL_LKB1107_245',
            palletId: null,
          },
        ]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([existingBalance]),
        upsert: vi.fn().mockResolvedValue(reconciledBalance),
      },
      stockMovement: {
        create: vi.fn().mockResolvedValue({ id: 'adjustment-1' }),
      },
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const physicalService = new StockOperationsService(
      {} as never,
      {} as never,
      {
        balanceKey: vi.fn().mockReturnValue(reconciledBalance.balanceKey),
      } as never,
    );

    const plan = await (physicalService as unknown as {
      planRequestAllocationsWithPhysicalSources: (
        tx: typeof tx,
        request: {
          id: string;
          clientId: string;
          items: Array<{ id: string; skuId: string; barcode: null; quantity: number }>;
        },
        selections: never[],
        sources: Array<{ requestItemId: string; boxCode: string; quantity: number }>,
        baseKey: string,
      ) => Promise<{
        lines: Array<{ allocations: Array<{ quantity: number }> }>;
      }>;
    }).planRequestAllocationsWithPhysicalSources(
      tx,
      {
        id: 'request-35',
        clientId: 'client-1',
        items: [{ id: 'item-1', skuId: 'sku-1', barcode: null, quantity: 2 }],
      },
      [],
      [
        {
          requestItemId: 'item-1',
          boxCode: 'ffl_lkb1107_245',
          quantity: 2,
        },
      ],
      'manual-status-done:request-35',
    );

    expect(plan.lines[0]?.allocations.map((allocation) => allocation.quantity)).toEqual([1, 1]);
    expect(tx.stockBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          boxId: 'box-1',
          status: 'SHIPPING',
          quantity: 1,
        }),
      }),
    );
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          boxId: 'box-1',
          type: 'INVENTORY_ADJUSTMENT',
          status: 'SHIPPING',
          quantity: 1,
          idempotencyKey:
            'manual-status-done:request-35:physical-source:item-1:box-1:0',
        }),
      }),
    );
  });

  it('требует фактический источник для каждого FBS-заказа, который не завершён на ТСД', async () => {
    const tx = {
      sku: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'sku-incomplete',
            internalSku: 'новый_корея_2черный-XL / 48',
            weightGrams: 500,
          })
          .mockResolvedValueOnce({
            id: 'sku-confirmed',
            internalSku: 'SKU-CONFIRMED',
            weightGrams: 500,
          }),
      },
      box: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'balance-incomplete',
            balanceKey: 'client-1:sku-incomplete:no-box:no-pallet:AVAILABLE',
            clientId: 'client-1',
            skuId: 'sku-incomplete',
            boxId: null,
            palletId: null,
            status: 'AVAILABLE',
            quantity: 1,
            updatedAt: new Date('2026-07-25T00:00:00.000Z'),
            box: null,
          },
        ]),
      },
      stockMovement: {
        create: vi.fn(),
      },
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([
          {
            connectionId: 'connection-1',
            orderId: '5371905207',
            lastSkuId: 'sku-incomplete',
          },
        ]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const physicalService = new StockOperationsService(
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      (physicalService as any).planRequestAllocationsWithPhysicalSources(
        tx,
        {
          id: 'request-37',
          clientId: 'client-1',
          items: [
            { id: 'item-incomplete', skuId: 'sku-incomplete', barcode: null, quantity: 1 },
            { id: 'item-confirmed', skuId: 'sku-confirmed', barcode: null, quantity: 1 },
          ],
        },
        [],
        [{ requestItemId: 'item-confirmed', noBox: true, quantity: 1 }],
        'manual-status-done:request-37',
      ),
    ).rejects.toThrow(
      /не завершены FBS-заказы №5371905207.*Подтвердите фактический короб/,
    );
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('позволяет подтвердить физический товар без короба', async () => {
    const reconciledBalance = {
      id: 'shipping-no-box',
      balanceKey: 'client-1:sku-1:no-box:no-pallet:SHIPPING',
      clientId: 'client-1',
      skuId: 'sku-1',
      boxId: null,
      palletId: null,
      status: 'SHIPPING',
      quantity: 1,
      updatedAt: new Date('2026-07-25T01:00:00.000Z'),
    };
    const tx = {
      sku: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'sku-1',
          internalSku: 'SKU-1',
          weightGrams: 300,
        }),
      },
      box: {
        findMany: vi.fn(),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue(reconciledBalance),
      },
      stockMovement: {
        create: vi.fn().mockResolvedValue({ id: 'adjustment-no-box' }),
      },
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const physicalService = new StockOperationsService(
      {} as never,
      {} as never,
      {
        balanceKey: vi.fn().mockReturnValue(reconciledBalance.balanceKey),
      } as never,
    );

    const plan = await (physicalService as unknown as {
      planRequestAllocationsWithPhysicalSources: (
        tx: typeof tx,
        request: {
          id: string;
          clientId: string;
          items: Array<{ id: string; skuId: string; barcode: null; quantity: number }>;
        },
        selections: never[],
        sources: Array<{ requestItemId: string; noBox: true; quantity: number }>,
        baseKey: string,
      ) => Promise<{
        lines: Array<{
          allocations: Array<{ balance: { boxId: string | null }; quantity: number }>;
        }>;
      }>;
    }).planRequestAllocationsWithPhysicalSources(
      tx,
      {
        id: 'request-35',
        clientId: 'client-1',
        items: [{ id: 'item-1', skuId: 'sku-1', barcode: null, quantity: 1 }],
      },
      [],
      [{ requestItemId: 'item-1', noBox: true, quantity: 1 }],
      'manual-status-done:request-35',
    );

    expect(plan.lines[0]?.allocations[0]).toMatchObject({
      balance: { boxId: null },
      quantity: 1,
    });
    expect(tx.box.findMany).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          boxId: null,
          type: 'INVENTORY_ADJUSTMENT',
          status: 'SHIPPING',
          quantity: 1,
          idempotencyKey:
            'manual-status-done:request-35:physical-source:item-1:no-box:0',
        }),
      }),
    );
  });

  it('атомарно перемещает отсканированную единицу на ТСД и архивирует пустой исходный короб', async () => {
    const sku = {
      id: 'sku-1',
      clientId: 'client-1',
      internalSku: 'SKU-1',
      clientSku: null,
      article: 'ART-1',
      name: 'Тестовый товар',
      color: 'чёрный',
      size: 'M',
      needsChestnyZnak: false,
      isUnmarked: false,
      barcodes: [{ value: '2040000000001', isPrimary: true }],
    };
    const sourceBox = {
      id: 'box-source',
      clientId: 'client-1',
      code: 'FFL_SOURCE_001',
      status: 'active',
      palletId: null,
      client: { id: 'client-1', code: 'CLIENT', name: 'Клиент' },
      balances: [{
        id: 'balance-source',
        balanceKey: 'source-key',
        clientId: 'client-1',
        skuId: 'sku-1',
        boxId: 'box-source',
        palletId: null,
        status: 'AVAILABLE',
        quantity: 1,
        sku,
      }],
    };
    const targetBox = {
      id: 'box-target',
      clientId: 'client-1',
      code: 'FFL_TARGET_001',
      status: 'active',
      palletId: null,
    };
    const stockMovementFindUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'movement-in' });
    const tx = {
      box: {
        findUnique: vi.fn(async (args: any) => {
          if (args.where?.code === 'FFL_SOURCE_001') return sourceBox;
          if (args.where?.code === 'FFL_TARGET_001') return targetBox;
          if (args.where?.clientId_code?.code === 'FFL_SOURCE_001') return sourceBox;
          if (args.where?.clientId_code?.code === 'FFL_TARGET_001') return null;
          return null;
        }),
        create: vi.fn().mockResolvedValue(targetBox),
        update: vi.fn().mockResolvedValue({ ...sourceBox, status: 'archived' }),
      },
      sku: {
        findFirst: vi.fn().mockResolvedValue(sku),
      },
      productMark: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn(),
      },
      stockBalance: {
        findFirst: vi.fn().mockResolvedValue(sourceBox.balances[0]),
        update: vi.fn().mockResolvedValue({ ...sourceBox.balances[0], quantity: 0 }),
        delete: vi.fn().mockResolvedValue(undefined),
        upsert: vi.fn().mockResolvedValue({
          id: 'balance-target',
          boxId: targetBox.id,
          quantity: 1,
        }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: null } }),
      },
      stockMovement: {
        findUnique: stockMovementFindUnique,
        create: vi.fn().mockResolvedValue({ id: 'movement' }),
      },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const transferService = new StockOperationsService(
      {
        $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
      } as never,
      clientScopes as never,
      {
        balanceKey: vi.fn().mockReturnValue('target-key'),
      } as never,
    );

    await expect(
      transferService.executeTsdTransfer(
        {
          fromBoxCode: 'FFL_SOURCE_001',
          toBoxCode: 'FFL_TARGET_001',
          scanCode: '2040000000001',
          idempotencyKey: 'tsd-transfer:test-1',
        },
        user(),
      ),
    ).resolves.toMatchObject({
      status: 'APPLIED',
      sourceBoxCode: 'FFL_SOURCE_001',
      targetBoxCode: 'FFL_TARGET_001',
      sourceBoxArchived: true,
      sourceRemaining: 0,
      item: {
        skuId: 'sku-1',
        scanType: 'BARCODE',
      },
    });
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(2);
    expect(tx.box.update).toHaveBeenCalledWith({
      where: { id: 'box-source' },
      data: { status: 'archived' },
    });
    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(
      user(),
      'client-1',
      'write',
    );
  });

  it('атомарно перемещает несколько отсканированных единиц в один целевой короб', async () => {
    let remaining = 2;
    const sku = {
      id: 'sku-1',
      clientId: 'client-1',
      internalSku: 'SKU-1',
      clientSku: null,
      article: 'ARTICLE-1',
      name: 'Костюм',
      color: 'чёрный',
      size: '48',
      needsChestnyZnak: false,
      isUnmarked: true,
      barcodes: [{ value: '2040000000001', isPrimary: true }],
    };
    const sourceBoxBase = {
      id: 'box-source',
      clientId: 'client-1',
      code: 'FFL_SOURCE_001',
      status: 'active',
      palletId: null,
      client: { id: 'client-1', code: 'CLIENT', name: 'Клиент' },
    };
    const targetBox = {
      id: 'box-target',
      clientId: 'client-1',
      code: 'FFL_TARGET_001',
      status: 'active',
      palletId: null,
    };
    const sourceBalance = () => ({
      id: 'balance-source',
      balanceKey: 'source-key',
      clientId: 'client-1',
      skuId: 'sku-1',
      boxId: 'box-source',
      palletId: null,
      status: 'AVAILABLE',
      quantity: remaining,
      sku,
    });
    const sourceBox = () => ({
      ...sourceBoxBase,
      balances: remaining > 0 ? [sourceBalance()] : [],
    });
    const tx = {
      box: {
        findUnique: vi.fn(async (args: any) => {
          if (args.where?.code === 'FFL_SOURCE_001') return sourceBox();
          if (args.where?.code === 'FFL_TARGET_001') return targetBox;
          if (args.where?.clientId_code?.code === 'FFL_SOURCE_001') return sourceBoxBase;
          if (args.where?.clientId_code?.code === 'FFL_TARGET_001') return targetBox;
          return null;
        }),
        create: vi.fn().mockResolvedValue(targetBox),
        update: vi.fn().mockResolvedValue({ ...sourceBoxBase, status: 'archived' }),
      },
      sku: {
        findFirst: vi.fn().mockResolvedValue(sku),
      },
      productMark: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn(),
      },
      stockBalance: {
        findFirst: vi.fn(async () => sourceBalance()),
        update: vi.fn(async (args: any) => {
          remaining -= Number(args.data?.quantity?.decrement ?? 0);
          return { ...sourceBalance(), quantity: remaining };
        }),
        delete: vi.fn().mockResolvedValue(undefined),
        upsert: vi.fn().mockResolvedValue({
          id: 'balance-target',
          boxId: targetBox.id,
          quantity: 2,
        }),
        aggregate: vi.fn(async () => ({ _sum: { quantity: remaining || null } })),
      },
      stockMovement: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'movement' }),
      },
    };
    const batchService = new StockOperationsService(
      {
        $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
      } as never,
      { requireClientAccess: vi.fn() } as never,
      {
        balanceKey: vi.fn().mockReturnValue('target-key'),
      } as never,
    );

    await expect(
      batchService.executeTsdTransferBatch(
        {
          fromBoxCode: 'FFL_SOURCE_001',
          toBoxCode: 'FFL_TARGET_001',
          scanCodes: ['2040000000001', '2040000000001'],
          idempotencyKey: 'tsd-transfer-batch:test-1',
        },
        user(),
      ),
    ).resolves.toMatchObject({
      status: 'APPLIED',
      sourceBoxCode: 'FFL_SOURCE_001',
      targetBoxCode: 'FFL_TARGET_001',
      sourceBoxArchived: true,
      sourceRemaining: 0,
      movedQuantity: 2,
      items: [
        { skuId: 'sku-1', scanType: 'BARCODE' },
        { skuId: 'sku-1', scanType: 'BARCODE' },
      ],
    });
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(4);
    expect(tx.box.update).toHaveBeenCalledWith({
      where: { id: 'box-source' },
      data: { status: 'archived' },
    });
  });
});

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
