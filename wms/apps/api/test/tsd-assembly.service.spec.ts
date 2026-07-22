import { describe, expect, it, vi } from 'vitest';
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

describe('TsdAssemblyService: факт сборки FBS', () => {
  it('возвращает короб, заказ, ШК товара, размер и четыре цифры наклейки WB', async () => {
    const prisma = {
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([{ orderId: '5355303495' }, { orderId: '5355303496' }]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'task-1',
            orderId: '5355303495',
            skuId: 'sku-1',
            productName: 'Костюм',
            article: 'ART-1',
            boxCode: 'FFL_LKB0106_039',
            barcode: '2047945700181',
            stickerPartB: '9753',
            stickerBarcode: 'WB-FULL-BARCODE',
            status: 'COMPLETED',
            workerName: 'Сборщик',
            completedAt: new Date('2026-07-23T08:00:00.000Z'),
            updatedAt: new Date('2026-07-23T08:00:00.000Z'),
          },
        ]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([{ id: 'sku-1', size: '52' }]),
      },
    };
    const service = new TsdAssemblyService(prisma as never, {} as never, {} as never, {} as never);

    const result = await (service as any).loadFbsAssemblyFacts('request-1');

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
    });
  });
});
