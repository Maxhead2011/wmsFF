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
