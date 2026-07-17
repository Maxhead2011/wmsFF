import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

describe('StockOperationsService billing automation', () => {
  it('начисляет обработку по единицам и не создает новую паллету для остатка до четырех коробов', async () => {
    const createdCharges: Array<Record<string, unknown>> = [];
    const tx = {
      billingCharge: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          createdCharges.push(data);
          return Promise.resolve({ id: `charge-${createdCharges.length}` });
        }),
      },
      billingService: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'service-processing',
          code: 'ITEM_PROCESSING',
          name: 'Обработка товара',
          clientPrices: [
            {
              id: 'client-price-processing',
              priceRub: 12,
              taxMode: 'INCLUDED',
              isActive: true,
            },
          ],
        }),
        upsert: vi.fn().mockImplementation(({ where }: { where: { code: string } }) =>
          Promise.resolve({ id: `service-${where.code}`, code: where.code }),
        ),
      },
      clientBillingService: {
        upsert: vi.fn().mockImplementation(({ create }: { create: { priceRub: number } }) =>
          Promise.resolve({
            id: 'client-price-standard',
            priceRub: create.priceRub,
            taxMode: 'INCLUDED',
            isActive: true,
          }),
        ),
      },
    };
    const service = new StockOperationsService({} as never, {} as never, {} as never);
    const billingService = service as unknown as {
      createFulfillmentBillingCharges: (
        tx: unknown,
        input: {
          request: { id: string; clientId: string; title: string };
          packages: Array<{ packageType: string }>;
          processedUnits: number;
          user: AuthUser;
          serviceDate: Date;
        },
      ) => Promise<void>;
    };

    await billingService.createFulfillmentBillingCharges(tx, {
      request: { id: 'request-1', clientId: 'client-1', title: 'Поставка' },
      packages: Array.from({ length: 17 }, () => ({ packageType: 'BOX' })),
      processedUnits: 123,
      user: user(),
      serviceDate: new Date('2026-07-11T10:00:00.000Z'),
    });

    await billingService.createFulfillmentBillingCharges(tx, {
      request: { id: 'request-2', clientId: 'client-1', title: 'Поставка 2' },
      packages: Array.from({ length: 22 }, () => ({ packageType: 'BOX' })),
      processedUnits: 10,
      user: user(),
      serviceDate: new Date('2026-07-11T11:00:00.000Z'),
    });

    expect(createdCharges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Обработка товара по заявке Поставка',
          quantity: 123,
          unitPriceRub: 12,
          totalRub: 1476,
          sourceKey: 'fulfillment-processing:request-1:ITEM_PROCESSING',
        }),
        expect.objectContaining({
          description: 'Паллет по заявке Поставка',
          quantity: 1,
          sourceKey: 'fulfillment-package:request-1:PALLET',
        }),
        expect.objectContaining({
          description: 'Сборка паллета по заявке Поставка',
          quantity: 1,
          sourceKey: 'fulfillment-package:request-1:PALLET_ASSEMBLY',
        }),
        expect.objectContaining({
          description: 'Паллет по заявке Поставка 2',
          quantity: 2,
          sourceKey: 'fulfillment-package:request-2:PALLET',
        }),
      ]),
    );
  });

  it('добавляет перемаркировку отдельной строкой по цене клиента', async () => {
    const createdCharges: Array<Record<string, unknown>> = [];
    const tx = {
      tsdOperation: {
        count: vi.fn().mockResolvedValue(15),
      },
      billingCharge: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          createdCharges.push(data);
          return Promise.resolve({ id: `charge-${createdCharges.length}` });
        }),
      },
      billingService: {
        findFirst: vi.fn().mockImplementation(({ where }: { where: { OR: Array<{ code?: string }> } }) => {
          const code = where.OR[0]?.code;
          const price = code === 'RELABELING' ? 8 : 12;
          return Promise.resolve({
            id: `service-${code}`,
            code,
            name: code === 'RELABELING' ? 'Перемаркировка' : 'Обработка товара',
            clientPrices: [{ id: `price-${code}`, priceRub: price, taxMode: 'INCLUDED', isActive: true }],
          });
        }),
      },
      clientBillingService: {},
    };
    const service = new StockOperationsService({} as never, {} as never, {} as never);
    const billingService = service as unknown as {
      createFulfillmentBillingCharges: (
        tx: unknown,
        input: {
          request: { id: string; clientId: string; title: string; items: Array<{ quantity: number; comment: string }> };
          packages: Array<{ packageType: string }>;
          processedUnits: number;
          user: AuthUser;
          serviceDate: Date;
        },
      ) => Promise<void>;
    };

    await billingService.createFulfillmentBillingCharges(tx, {
      request: {
        id: 'request-relabel',
        clientId: 'client-1',
        title: 'Поставка с перемаркировкой',
        items: [{ quantity: 15, comment: 'Перемаркировка из: 111\nПеремаркировка в: 222' }],
      },
      packages: [],
      processedUnits: 40,
      user: user(),
      serviceDate: new Date('2026-07-13T08:00:00.000Z'),
    });

    expect(tx.tsdOperation.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ operationType: 'assembly_stage', status: 'ACCEPTED' }),
      }),
    );
    expect(createdCharges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Перемаркировка по заявке Поставка с перемаркировкой',
          quantity: 15,
          unitPriceRub: 8,
          totalRub: 120,
          sourceKey: 'fulfillment-relabeling:request-relabel:RELABELING',
        }),
      ]),
    );
  });

  it('сохраняет тариф одежды после перемещения из FFL_LK0 в балансный короб', async () => {
    const createdCharges: Array<Record<string, unknown>> = [];
    const movement = (
      id: string,
      skuId: string,
      boxId: string,
      boxCode: string,
      type: string,
      status: string,
      quantity: number,
      idempotencyKey: string,
      sourceDocument: string | null = null,
    ) => ({
      id,
      skuId,
      boxId,
      box: { code: boxCode },
      type,
      status,
      quantity,
      idempotencyKey,
      sourceDocument,
      createdAt: new Date(`2026-07-13T08:${id.padStart(2, '0')}:00.000Z`),
    });
    const tx = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ name: 'ИП Лукин И.И.', legalName: 'ИП Лукин Илья Ильич' }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          movement('01', 'sku-clothes', 'box-lk0', 'FFL_LK0107_001', 'RECEIPT', 'AVAILABLE', 10, 'receipt-clothes'),
          movement('02', 'sku-clothes', 'box-lk0', 'FFL_LK0107_001', 'MOVE', 'AVAILABLE', -10, 'move-clothes:out'),
          movement('03', 'sku-clothes', 'box-bal', 'FFL_BAL1307_01', 'MOVE', 'AVAILABLE', 10, 'move-clothes:in'),
          movement('04', 'sku-clothes', 'box-bal', 'FFL_BAL1307_01', 'PICK', 'AVAILABLE', -10, 'pick-clothes:out'),
          movement('05', 'sku-clothes', 'box-bal', 'FFL_BAL1307_01', 'PICK', 'PACKING', 10, 'pick-clothes:in'),
          movement('06', 'sku-normal', 'box-lkb', 'FFL_LKB1307_001', 'RECEIPT', 'AVAILABLE', 5, 'receipt-normal'),
          movement('07', 'sku-normal', 'box-lkb', 'FFL_LKB1307_001', 'PICK', 'AVAILABLE', -5, 'pick-normal:out'),
          movement('08', 'sku-normal', 'box-lkb', 'FFL_LKB1307_001', 'PICK', 'PACKING', 5, 'pick-normal:in'),
          movement('09', 'sku-return', 'box-voz', 'FFL_VOZ1307_001', 'RECEIPT', 'AVAILABLE', 4, 'receipt-return'),
          movement('10', 'sku-return', 'box-voz', 'FFL_VOZ1307_001', 'MOVE', 'AVAILABLE', -4, 'move-return:out'),
          movement('11', 'sku-return', 'box-bal-return', 'FFL_BAL1307_02', 'MOVE', 'AVAILABLE', 4, 'move-return:in'),
          movement('12', 'sku-return', 'box-bal-return', 'FFL_BAL1307_02', 'PICK', 'AVAILABLE', -4, 'pick-return:out'),
          movement('13', 'sku-return', 'box-bal-return', 'FFL_BAL1307_02', 'PICK', 'PACKING', 4, 'pick-return:in'),
          movement('14', 'sku-clothes', 'box-bal', 'FFL_BAL1307_01', 'PACK', 'PACKING', -10, 'pack-clothes:out', 'request-mixed'),
          movement('15', 'sku-clothes', 'box-bal', 'FFL_BAL1307_01', 'PACK', 'SHIPPING', 10, 'pack-clothes:in', 'request-mixed'),
          movement('16', 'sku-return', 'box-bal-return', 'FFL_BAL1307_02', 'PACK', 'PACKING', -4, 'pack-return:out', 'request-mixed'),
          movement('17', 'sku-return', 'box-bal-return', 'FFL_BAL1307_02', 'PACK', 'SHIPPING', 4, 'pack-return:in', 'request-mixed'),
          movement('18', 'sku-normal', 'box-lkb', 'FFL_LKB1307_001', 'PACK', 'PACKING', -5, 'pack-normal:out', 'request-mixed'),
          movement('19', 'sku-normal', 'box-lkb', 'FFL_LKB1307_001', 'PACK', 'SHIPPING', 5, 'pack-normal:in', 'request-mixed'),
        ]),
      },
      tsdOperation: { count: vi.fn().mockResolvedValue(0) },
      billingCharge: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          createdCharges.push(data);
          return Promise.resolve({ id: `charge-${createdCharges.length}` });
        }),
      },
      billingService: {
        findFirst: vi.fn().mockImplementation(({ where }: { where: { OR: Array<{ code?: string }> } }) => {
          const code = where.OR[0]?.code;
          const price = code === 'NOM_ОБРАБОТКА_ОДЕЖДЫ' ? 20 : 12;
          return Promise.resolve({
            id: `service-${code}`,
            code,
            name: code === 'NOM_ОБРАБОТКА_ОДЕЖДЫ' ? 'Обработка одежды' : 'Обработка товара',
            clientPrices: [{ id: `price-${code}`, priceRub: price, taxMode: 'INCLUDED', isActive: true }],
          });
        }),
      },
      clientBillingService: {},
    };
    const service = new StockOperationsService({} as never, {} as never, {} as never);
    const billingService = service as unknown as {
      createFulfillmentBillingCharges: (tx: unknown, input: Record<string, unknown>) => Promise<void>;
    };

    await billingService.createFulfillmentBillingCharges(tx, {
      request: {
        id: 'request-mixed',
        clientId: 'client-lukin',
        title: 'Смешанная поставка',
        items: [{ skuId: 'sku-clothes' }, { skuId: 'sku-return' }, { skuId: 'sku-normal' }],
      },
      packages: [],
      processedUnits: 19,
      user: user(),
      serviceDate: new Date('2026-07-13T09:00:00.000Z'),
    });

    expect(createdCharges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Обработка одежды по заявке Смешанная поставка',
          quantity: 14,
          unitPriceRub: 20,
          totalRub: 280,
          sourceKey: 'fulfillment-clothing-processing:request-mixed:NOM_ОБРАБОТКА_ОДЕЖДЫ',
        }),
        expect.objectContaining({
          description: 'Обработка товара по заявке Смешанная поставка',
          quantity: 5,
          unitPriceRub: 12,
          totalRub: 60,
        }),
      ]),
    );
  });
});

function user(): AuthUser {
  return {
    id: 'user-1',
    email: 'admin@logoff.pro',
    name: 'Администратор',
    roleCodes: ['ADMIN'],
    permissionCodes: ['system:admin'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  };
}
