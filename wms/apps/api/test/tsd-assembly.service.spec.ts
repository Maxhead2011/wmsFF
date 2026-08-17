import { describe, expect, it, vi } from 'vitest';
import { ClientRequestStatus } from '@prisma/client';
import { TsdAssemblyService, boxSearchInstruction, validateStageAction } from '../src/modules/tsd/tsd-assembly.service';

describe('boxSearchInstruction', () => {
  it.each([
    [{ requiresRelabel: false, requiresMovement: false, shipsWhole: true }, 'WHOLE', 'ЦЕЛИКОМ'],
    [{ requiresRelabel: true, requiresMovement: false, shipsWhole: true }, 'RELABEL', 'ПЕРЕМАРКИРОВКА'],
    [{ requiresRelabel: false, requiresMovement: true, shipsWhole: false }, 'MOVEMENT', 'ПЕРЕМЕЩЕНИЕ'],
    [{ requiresRelabel: true, requiresMovement: true, shipsWhole: false }, 'RELABEL_MOVEMENT', 'МАРК+ПЕРЕМЕЩЕНИЕ'],
  ] as const)('возвращает тип работ для короба', (input, type, label) => {
    expect(boxSearchInstruction(input)).toMatchObject({ instructionType: type, instructionLabel: label });
  });
});

describe('validateStageAction: уникальность скана короба', () => {
  it('принимает первый скан нужного короба', () => {
    expect(
      validateStageAction({ searchBoxes: [{ boxCode: 'FFL_BOX_1', found: false }] }, 'box-search', 'scan', 'ffl_box_1'),
    ).toMatchObject({ status: 'FOUND', accepted: true });
  });

  it('отклоняет повторный скан уже найденного короба', () => {
    expect(
      validateStageAction({ searchBoxes: [{ boxCode: 'FFL_BOX_1', found: true }] }, 'box-search', 'scan', 'FFL_BOX_1'),
    ).toMatchObject({ status: 'DUPLICATE', accepted: false, message: expect.stringContaining('уже был пропикан') });
  });
});

describe('TsdAssemblyService: активная очередь', () => {
  it('не возвращает упакованные и завершённые заявки в рабочий список ТСД', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      clientRequest: { findMany },
    };
    const clientScopes = {
      resolveClientFilter: vi.fn().mockReturnValue({ in: ['client-1'] }),
    };
    const service = new TsdAssemblyService(
      prisma as never,
      clientScopes as never,
      {} as never,
      {} as never,
    );

    await service.listActiveRequests({ id: 'worker-1' } as never);

    const statuses = findMany.mock.calls[0][0].where.status.in;
    expect(statuses).toEqual([
      ClientRequestStatus.SUBMITTED,
      ClientRequestStatus.IN_REVIEW,
      ClientRequestStatus.APPROVED,
      ClientRequestStatus.IN_WORK,
    ]);
    expect(statuses).not.toContain(ClientRequestStatus.PACKED);
    expect(statuses).not.toContain(ClientRequestStatus.DONE);
  });
});

describe('TsdAssemblyService: факт сборки FBS', () => {
  it('возвращает короб, заказ, ШК товара, размер и четыре цифры наклейки WB', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([
          { orderId: '5355303495', connectionId: 'connection-1', lastSkuId: 'sku-1' },
          { orderId: '5355303496', connectionId: 'connection-1', lastSkuId: 'sku-1' },
        ]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'task-1',
            orderId: '5355303495',
            requestItemId: 'item-1',
            skuId: 'sku-1',
            productName: 'Костюм',
            article: 'ART-1',
            boxCode: 'FFL_LKB0106_039',
            barcode: '2047945700181',
            stickerPartB: '9753',
            stickerBarcode: 'WB-FULL-BARCODE',
            status: 'COMPLETED',
            deviceCode: 'TSD-1',
            itemCount: 1,
            workerName: 'Сборщик',
            completedAt: new Date('2026-07-23T08:00:00.000Z'),
            updatedAt: new Date('2026-07-23T08:00:00.000Z'),
          },
        ]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'sku-1',
          internalSku: 'SKU-1',
          clientSku: 'ART-1',
          article: 'ART-1',
          color: 'Чёрный',
          size: '52',
        }]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      storagePalletBox: {
        // ADDED: the saved allocation has no pallet, while the box is physically placed.
        findMany: vi.fn().mockResolvedValue([{
          boxCode: 'FFL_LKB0106_039',
          palletId: 'pallet-1',
          pallet: {
            code: 'PALET_SORT_041',
            zoneId: 'zone-1',
            zone: { code: 'ZONE-002', name: '2 помещение' },
          },
        }]),
      },
    };
    const service = new TsdAssemblyService(prisma as never, {} as never, {} as never, {} as never);

    const result = await (service as any).loadFbsAssemblyFacts('request-1', [
      {
        itemId: 'item-1',
        skuId: 'sku-1',
        internalSku: 'SKU-1',
        name: 'Костюм',
        barcode: '2047945700181',
        requestedQuantity: 2,
        comment: null,
        allocations: [{ boxCode: 'FFL_LKB0106_039', quantity: 2 }],
      },
    ]);

    expect(result).toMatchObject({
      totalOrders: 2,
      startedOrders: 1,
      completedOrders: 1,
      rows: [
        {
          orderId: '5355303495',
          sourceBoxCode: 'FFL_LKB0106_039',
          productBarcode: '2047945700181',
          size: '52',
          wbStickerPartB: '9753',
          wbStickerBarcode: 'WB-FULL-BARCODE',
          statusLabel: 'Собрано',
        },
      ],
      notCollected: {
        remainingOrders: 1,
        remainingPositions: 1,
        remainingUnits: 1,
        pendingOrderIds: ['5355303496'],
        rows: [
          expect.objectContaining({
            requestItemId: 'item-1',
            name: 'Костюм',
            article: 'ART-1',
            color: 'Чёрный',
            size: '52',
            collectedQuantity: 1,
            remainingQuantity: 1,
            orderIds: ['5355303496'],
            orders: [expect.objectContaining({ id: '5355303496', connectionId: 'connection-1' })],
            availableBoxes: [{
              boxCode: 'FFL_LKB0106_039',
              quantity: 2,
              palletId: 'pallet-1',
              palletCode: 'PALET_SORT_041',
              storageLocation: {
                palletId: 'pallet-1',
                palletCode: 'PALET_SORT_041',
                zoneId: 'zone-1',
                zoneCode: 'ZONE-002',
                zoneName: '2 помещение',
              },
            }],
          }),
        ],
      },
    });
  });

  it('показывает изменённый после сборки заказ как требующий решения и не считает его несобранным', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([
          { orderId: '5355303495', connectionId: 'connection-1', lastSkuId: 'sku-1' },
        ]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'task-1',
            orderId: '5355303495',
            requestItemId: 'item-1',
            skuId: 'sku-1',
            productName: 'Костюм',
            article: 'ART-1',
            boxCode: 'FFL_LKB0106_039',
            barcode: '2047945700181',
            kiz: '010204794570018121SERIAL',
            stickerPartB: '9753',
            stickerBarcode: 'WB-FULL-BARCODE',
            status: 'RETURN_REQUIRED',
            deviceCode: 'TSD-1',
            errorMessage: 'Заказ отменён после начала сборки.',
            itemCount: 1,
            workerName: 'Сборщик',
            completedAt: new Date('2026-07-23T08:00:00.000Z'),
            updatedAt: new Date('2026-07-23T08:10:00.000Z'),
          },
        ]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'sku-1',
          internalSku: 'SKU-1',
          clientSku: 'ART-1',
          article: 'ART-1',
          color: 'Чёрный',
          size: '52',
        }]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      storagePalletBox: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new TsdAssemblyService(prisma as never, {} as never, {} as never, {} as never);

    const result = await (service as any).loadFbsAssemblyFacts('request-1', [
      {
        itemId: 'item-1',
        skuId: 'sku-1',
        internalSku: 'SKU-1',
        name: 'Костюм',
        barcode: '2047945700181',
        requestedQuantity: 1,
        comment: 'FBS-заказы: 5355303495',
        allocations: [{ boxCode: 'FFL_LKB0106_039', quantity: 1 }],
      },
    ]);

    expect(result).toMatchObject({
      completedOrders: 0,
      returnRequired: {
        orders: 1,
        units: 1,
        rows: [
          expect.objectContaining({
            orderId: '5355303495',
            kiz: '010204794570018121SERIAL',
            statusLabel: 'Требуется решение',
            syncIssue: 'Заказ отменён после начала сборки.',
          }),
        ],
      },
      notCollected: {
        remainingOrders: 0,
        remainingPositions: 0,
        remainingUnits: 0,
      },
    });
  });
});
