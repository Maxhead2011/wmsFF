import { BadRequestException } from '@nestjs/common';
import {
  BillingChargeSource,
  BillingChargeStatus,
  BillingUnit,
  ClientNotificationEvent,
  LogisticsDeliveryStatus,
  LogisticsPricingMode,
  LogisticsTripStatus,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { calculateLogisticsPalletCount, LogisticsService } from '../src/modules/logistics/logistics.service';

describe('LogisticsService', () => {
  const service = new LogisticsService({} as never, {} as never);

  it('выбирает более конкретную паллетную ступень вместо открытого диапазона', () => {
    const tier = service.selectRateTier(
      [
        {
          label: 'от 7 палет',
          minPallets: 7,
          maxPallets: null,
          maxBoxes: null,
          pricingMode: LogisticsPricingMode.PER_PALLET,
          priceRub: 4000,
        },
        {
          label: '18 палет',
          minPallets: 18,
          maxPallets: 18,
          maxBoxes: null,
          pricingMode: LogisticsPricingMode.PER_PALLET,
          priceRub: 3500,
        },
      ],
      { pallets: 18 },
    );

    expect(tier.label).toBe('18 палет');
  });

  it('считает паллетный тариф умножением на количество паллет', () => {
    const total = service.calculateQuoteTotal(
      {
        label: '2-3 палеты',
        minPallets: 2,
        maxPallets: 3,
        maxBoxes: null,
        pricingMode: LogisticsPricingMode.PER_PALLET,
        priceRub: 6000,
      },
      3,
    );

    expect(total).toBe(18000);
  });

  it('переводит короба в расчетные паллеты с допуском четыре короба', () => {
    expect(calculateLogisticsPalletCount(17)).toBe(1);
    expect(calculateLogisticsPalletCount(20)).toBe(1);
    expect(calculateLogisticsPalletCount(21)).toBe(2);
    expect(calculateLogisticsPalletCount(80)).toBe(5);
    expect(calculateLogisticsPalletCount(163)).toBe(10);
  });

  it('сопоставляет склады одного города при разных уточнениях в скобках', async () => {
    const prisma = {
      logisticsTariffSet: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tariff-1',
          name: 'Тариф',
          sourceFile: 'tariff.xlsx',
          note: null,
        }),
      },
      logisticsDirection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'direction-1',
            tariffSetId: 'tariff-1',
            origin: 'МОСКВА',
            destination: 'Екатеринбург (Испытателей)',
            note: null,
            tiers: [
              {
                label: '4-6 палет',
                minPallets: 4,
                maxPallets: 6,
                maxBoxes: null,
                pricingMode: LogisticsPricingMode.PER_PALLET,
                priceRub: 10000,
              },
            ],
          },
        ]),
      },
    };
    const deliveryService = new LogisticsService(prisma as never, {} as never);

    const quote = await deliveryService.quote({
      tariffSetId: 'tariff-1',
      destination: 'Екатеринбург (Перспективная)',
      pallets: 5,
    });

    expect(quote.route.destination).toBe('Екатеринбург (Испытателей)');
    expect(quote.estimatedTotalRub).toBe(50000);
  });

  it('применяет паллетный тариф при прямом расчете большой партии коробов', async () => {
    const prisma = {
      logisticsTariffSet: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tariff-1',
          name: 'Тариф',
          sourceFile: 'tariff.xlsx',
          note: null,
        }),
      },
      logisticsDirection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'direction-1',
            tariffSetId: 'tariff-1',
            origin: 'МОСКВА',
            destination: 'Краснодар (Тихорецкая)',
            note: null,
            tiers: [
              {
                label: '4-6 палет',
                minPallets: 4,
                maxPallets: 6,
                maxBoxes: null,
                pricingMode: LogisticsPricingMode.PER_PALLET,
                priceRub: 7000,
              },
            ],
          },
        ]),
      },
    };
    const deliveryService = new LogisticsService(prisma as never, {} as never);

    const quote = await deliveryService.quote({
      tariffSetId: 'tariff-1',
      destination: 'Краснодар (Тихорецкая)',
      boxes: 80,
    });

    expect(quote.input).toEqual({ boxes: null, pallets: 5 });
    expect(quote.estimatedTotalRub).toBe(35000);
  });

  it('возвращает клиенту FBS только город и итоговую стоимость с налогом', async () => {
    const prisma = {
      logisticsTariffSet: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'tariff-active',
          name: 'Действующий тариф',
          sourceFile: 'tariff.xlsx',
          note: null,
        }),
      },
      logisticsDirection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'direction-1',
            tariffSetId: 'tariff-active',
            origin: 'Москва',
            destination: 'Казань',
            note: null,
            tiers: [
              {
                label: 'до 10 коробов',
                minPallets: null,
                maxPallets: null,
                maxBoxes: 10,
                pricingMode: LogisticsPricingMode.TOTAL,
                priceRub: 5000,
              },
            ],
          },
        ]),
      },
    };
    const deliveryService = new LogisticsService(prisma as never, {} as never);

    const result = await deliveryService.quoteFbsCalculator({
      quantity: 14,
      destination: 'Казань',
    });

    expect(result).toEqual({
      destination: 'Казань',
      totalWithTax: 5832.98,
      requiresManualReview: false,
    });
    expect(Object.keys(result).sort()).toEqual([
      'destination',
      'requiresManualReview',
      'totalWithTax',
    ]);
  });

  it('отдаёт клиентскому FBS-калькулятору только города активного тарифа', async () => {
    const prisma = {
      logisticsTariffSet: {
        findFirst: vi.fn().mockResolvedValue({ id: 'tariff-active' }),
      },
      logisticsDirection: {
        findMany: vi.fn().mockResolvedValue([
          { destination: 'Казань' },
          { destination: 'КАЗАНЬ' },
          { destination: 'Воронеж' },
        ]),
      },
    };
    const deliveryService = new LogisticsService(prisma as never, {} as never);

    await expect(deliveryService.listFbsCalculatorDestinations()).resolves.toEqual({
      destinations: ['Воронеж', 'Казань'],
    });
  });

  it('не делает авторасчет для неоднозначных тарифных строк', () => {
    const total = service.calculateQuoteTotal(
      {
        label: 'от 16 до 17 палет',
        minPallets: 16,
        maxPallets: 17,
        maxBoxes: null,
        pricingMode: LogisticsPricingMode.MANUAL_REVIEW,
        priceRub: 25000,
      },
      16,
    );

    expect(total).toBeNull();
  });

  it('считает маршрут только из Москвы даже при лишнем поле отправления', async () => {
    const prisma = {
      logisticsTariffSet: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tariff-1',
          name: 'Тариф',
          sourceFile: null,
        }),
      },
      logisticsDirection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'direction-moscow',
            tariffSetId: 'tariff-1',
            origin: 'Москва',
            destination: 'Казань',
            note: null,
            tiers: [
              {
                label: 'до 10 коробов',
                minPallets: null,
                maxPallets: null,
                maxBoxes: 10,
                pricingMode: LogisticsPricingMode.TOTAL,
                priceRub: 5000,
              },
            ],
          },
          {
            id: 'direction-spb',
            tariffSetId: 'tariff-1',
            origin: 'Санкт-Петербург',
            destination: 'Казань',
            note: null,
            tiers: [
              {
                label: 'до 10 коробов',
                minPallets: null,
                maxPallets: null,
                maxBoxes: 10,
                pricingMode: LogisticsPricingMode.TOTAL,
                priceRub: 9000,
              },
            ],
          },
        ]),
      },
    };
    const deliveryService = new LogisticsService(prisma as never, {} as never);
    const payload = {
      tariffSetId: 'tariff-1',
      origin: 'Санкт-Петербург',
      destination: 'Казань',
      boxes: 4,
    };

    const quote = await deliveryService.quote(payload);

    expect(quote.route.origin).toBe('Москва');
    expect(quote.estimatedTotalRub).toBe(5000);
  });

  it('возвращает ошибку, когда подходящей ступени нет', () => {
    expect(() => service.selectRateTier([], { boxes: 2 })).toThrow(BadRequestException);
  });

  it('создает заявку на доставку с автоматическим расчетом тарифа', async () => {
    const prisma = {
      clientRequest: {
        findFirst: vi.fn().mockResolvedValue({ id: 'request-1', packages: [{ packageType: 'BOX' }] }),
      },
      logisticsTariffSet: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tariff-1',
          name: 'Тариф',
          sourceFile: null,
        }),
      },
      logisticsDirection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'direction-1',
            tariffSetId: 'tariff-1',
            origin: 'МОСКВА',
            destination: 'КАЗАНЬ',
            note: null,
            tiers: [
              {
                label: 'до 10 коробов',
                minPallets: null,
                maxPallets: null,
                maxBoxes: 10,
                pricingMode: LogisticsPricingMode.TOTAL,
                priceRub: 5000,
              },
            ],
          },
        ]),
      },
      logisticsDeliveryRequest: {
        create: vi.fn().mockResolvedValue({ id: 'delivery-1' }),
      },
    };
    const deliveryService = new LogisticsService(prisma as never, { requireClientAccess: vi.fn() } as never);

    await deliveryService.createDeliveryRequest(
      {
        clientId: 'client-1',
        requestId: 'request-1',
        tariffSetId: 'tariff-1',
        destination: 'КАЗАНЬ',
        boxes: 4,
      },
      user(),
    );

    expect(prisma.logisticsDeliveryRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          requestId: 'request-1',
          origin: 'Москва',
          status: 'QUOTED',
          estimatedTotalRub: 5000,
          boxes: 1,
          pallets: null,
          requiresManualReview: false,
          createdByUserId: 'user-1',
        }),
      }),
    );
  });

  it('использует паллетную ступень прайса для большой партии коробов', async () => {
    const tariffSet = {
      id: 'tariff-1',
      name: 'Логистика 1.04.2026',
      sourceFile: 'Логистика 1.04.2026.xlsx',
      note: null,
    };
    const prisma = {
      clientRequest: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'request-1',
          packages: Array.from({ length: 80 }, () => ({ packageType: 'BOX' })),
        }),
      },
      logisticsTariffSet: {
        findFirst: vi.fn().mockResolvedValue(tariffSet),
        findUnique: vi.fn().mockResolvedValue(tariffSet),
      },
      logisticsDirection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'direction-1',
            tariffSetId: 'tariff-1',
            origin: 'МОСКВА',
            destination: 'Краснодар (Тихорецкая)',
            note: null,
            tiers: [
              {
                label: '4-6 палет',
                minPallets: 4,
                maxPallets: 6,
                maxBoxes: null,
                pricingMode: LogisticsPricingMode.PER_PALLET,
                priceRub: 7000,
              },
            ],
          },
        ]),
      },
      logisticsDeliveryRequest: {
        create: vi.fn().mockResolvedValue({ id: 'delivery-1' }),
      },
    };
    const deliveryService = new LogisticsService(prisma as never, { requireClientAccess: vi.fn() } as never);

    await deliveryService.createDeliveryRequest(
      {
        clientId: 'client-1',
        requestId: 'request-1',
        destination: 'Краснодар (Тихорецкая)',
      },
      user(),
    );

    expect(prisma.logisticsDeliveryRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tariffSetId: 'tariff-1',
          boxes: 80,
          pallets: 5,
          estimatedTotalRub: 35000,
          requiresManualReview: false,
          status: LogisticsDeliveryStatus.QUOTED,
        }),
      }),
    );
  });

  it('не разрешает привязать доставку к заявке другого клиента', async () => {
    const prisma = {
      clientRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const deliveryService = new LogisticsService(prisma as never, { requireClientAccess: vi.fn() } as never);

    await expect(
      deliveryService.createDeliveryRequest(
        {
          clientId: 'client-1',
          requestId: 'foreign-request',
          destination: 'КАЗАНЬ',
          boxes: 4,
        },
        user(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('создает уведомление клиенту при смене статуса доставки', async () => {
    const prisma = {
      logisticsDeliveryRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'delivery-1',
          clientId: 'client-1',
          status: LogisticsDeliveryStatus.REQUESTED,
          origin: 'Москва',
          destination: 'Казань',
        }),
        update: vi.fn().mockResolvedValue({
          id: 'delivery-1',
          requestId: 'request-1',
          status: LogisticsDeliveryStatus.PLANNED,
        }),
      },
      clientNotificationPreference: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      clientNotification: {
        create: vi.fn().mockResolvedValue({ id: 'notification-1' }),
      },
      $transaction: vi.fn((callback) => callback(prisma)),
    };
    const deliveryService = new LogisticsService(prisma as never, { requireClientAccess: vi.fn() } as never);

    await deliveryService.updateDeliveryStatus(
      'delivery-1',
      { status: LogisticsDeliveryStatus.PLANNED },
      user(),
    );

    expect(prisma.clientNotificationPreference.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId_eventType: {
            clientId: 'client-1',
            eventType: ClientNotificationEvent.LOGISTICS_DELIVERY_STATUS_CHANGED,
          },
        },
      }),
    );
    expect(prisma.clientNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          requestId: 'request-1',
          title: 'Статус доставки изменен',
          body: 'Москва -> Казань: запрос -> запланировано',
          severity: 'INFO',
        }),
      }),
    );
  });

  it('финализирует ручной расчет доставки', async () => {
    const prisma = {
      logisticsDeliveryRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'delivery-1',
          clientId: 'client-1',
          status: LogisticsDeliveryStatus.REQUESTED,
          billingChargeId: null,
        }),
        update: vi.fn().mockResolvedValue({
          id: 'delivery-1',
          estimatedTotalRub: '8200.00',
          requiresManualReview: false,
          status: LogisticsDeliveryStatus.QUOTED,
        }),
      },
    };
    const deliveryService = new LogisticsService(prisma as never, { requireClientAccess: vi.fn() } as never);

    await deliveryService.finalizeDeliveryQuote(
      'delivery-1',
      {
        estimatedTotalRub: 8200,
        managerComment: 'финальный расчет',
      },
      user(),
    );

    expect(prisma.logisticsDeliveryRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({
          estimatedTotalRub: 8200,
          requiresManualReview: false,
          status: LogisticsDeliveryStatus.QUOTED,
          managerComment: 'финальный расчет',
        }),
      }),
    );
  });

  it('создает начисление биллинга по доставленной заявке', async () => {
    const tx = {
      billingService: {
        upsert: vi.fn().mockResolvedValue({ id: 'service-delivery' }),
      },
      billingCharge: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'charge-delivery' }),
      },
      logisticsDeliveryRequest: {
        update: vi.fn().mockResolvedValue({ id: 'delivery-1', billingChargeId: 'charge-delivery' }),
      },
    };
    const prisma = {
      logisticsDeliveryRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'delivery-1',
          clientId: 'client-1',
          requestId: 'request-1',
          tariffSetId: 'tariff-1',
          billingChargeId: null,
          origin: 'Москва',
          destination: 'Казань',
          boxes: 4,
          pallets: null,
          desiredShipDate: new Date('2026-06-20T00:00:00.000Z'),
          plannedShipDate: null,
          status: LogisticsDeliveryStatus.DELIVERED,
          estimatedTotalRub: '7500.00',
          requiresManualReview: false,
          comment: 'доставка клиента',
          managerComment: null,
          client: { id: 'client-1', code: 'CL-1', name: 'Client' },
          request: { id: 'request-1', title: 'Заявка' },
          tariffSet: { id: 'tariff-1', name: 'Тариф' },
          billingCharge: null,
        }),
      },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const deliveryService = new LogisticsService(prisma as never, { requireClientAccess: vi.fn() } as never);

    await deliveryService.generateDeliveryBillingCharge('delivery-1', user());

    expect(tx.billingCharge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          requestId: 'request-1',
          serviceId: 'service-delivery',
          description: 'Доставка Москва -> Казань',
          unit: BillingUnit.SERVICE,
          quantity: 1,
          unitPriceRub: 7500,
          totalRub: 7500,
          status: BillingChargeStatus.APPROVED,
          source: BillingChargeSource.LOGISTICS,
          sourceKey: 'logistics-delivery:delivery-1',
          createdByUserId: 'user-1',
          approvedByUserId: 'user-1',
          metadata: expect.objectContaining({
            deliveryRequestId: 'delivery-1',
            boxes: 4,
            tariffSetId: 'tariff-1',
          }),
        }),
      }),
    );
    expect(tx.logisticsDeliveryRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1' },
        data: { billingChargeId: 'charge-delivery' },
      }),
    );
  });

  it('создает рейс с автонумерацией по плановой дате', async () => {
    const prisma = {
      logisticsCarrier: {
        findFirst: vi.fn().mockResolvedValue({ id: 'carrier-1' }),
      },
      logisticsTrip: {
        count: vi.fn().mockResolvedValue(2),
        create: vi.fn().mockResolvedValue({ id: 'trip-1' }),
      },
    };
    const deliveryService = new LogisticsService(prisma as never, { requireClientAccess: vi.fn() } as never);

    await deliveryService.createTrip({
      carrierId: 'carrier-1',
      plannedDate: '2026-06-28',
      vehicleNumber: 'A123BC',
      driverName: 'Иван',
    });

    expect(prisma.logisticsTrip.count).toHaveBeenCalledWith({
      where: { code: { startsWith: 'TRIP-20260628' } },
    });
    expect(prisma.logisticsTrip.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'TRIP-20260628-003',
          carrierId: 'carrier-1',
          vehicleNumber: 'A123BC',
          driverName: 'Иван',
        }),
      }),
    );
  });

  it('назначает доставку в рейс и переводит заявку в план', async () => {
    const tripDate = new Date('2026-06-28T00:00:00.000Z');
    const prisma = {
      logisticsDeliveryRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'delivery-1',
          clientId: 'client-1',
          status: LogisticsDeliveryStatus.QUOTED,
          plannedShipDate: null,
        }),
        update: vi.fn().mockResolvedValue({
          id: 'delivery-1',
          tripId: 'trip-1',
          status: LogisticsDeliveryStatus.PLANNED,
        }),
      },
      logisticsTrip: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'trip-1',
          status: LogisticsTripStatus.PLANNED,
          plannedDate: tripDate,
        }),
      },
    };
    const deliveryService = new LogisticsService(prisma as never, { requireClientAccess: vi.fn() } as never);

    await deliveryService.assignDeliveryTrip('delivery-1', { tripId: 'trip-1' }, user());

    expect(prisma.logisticsDeliveryRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({
          trip: { connect: { id: 'trip-1' } },
          status: LogisticsDeliveryStatus.PLANNED,
          plannedShipDate: tripDate,
        }),
      }),
    );
  });
  it('uses packed request places instead of manually entered delivery quantity', async () => {
    const prisma = {
      clientRequest: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'request-1',
          packages: [{ packageType: 'BOX' }, { packageType: 'PALLET' }, { packageType: 'ПАЛЛЕТ' }],
        }),
      },
      logisticsTariffSet: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tariff-1',
          name: 'Tariff',
          sourceFile: null,
        }),
      },
      logisticsDirection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'direction-1',
            tariffSetId: 'tariff-1',
            origin: 'Москва',
            destination: 'Казань',
            note: null,
            tiers: [
              {
                label: '2 pallets',
                minPallets: 2,
                maxPallets: 2,
                maxBoxes: null,
                pricingMode: LogisticsPricingMode.PER_PALLET,
                priceRub: 3000,
              },
            ],
          },
        ]),
      },
      logisticsDeliveryRequest: {
        create: vi.fn().mockResolvedValue({ id: 'delivery-1' }),
      },
    };
    const deliveryService = new LogisticsService(prisma as never, { requireClientAccess: vi.fn() } as never);

    await deliveryService.createDeliveryRequest(
      {
        clientId: 'client-1',
        requestId: 'request-1',
        tariffSetId: 'tariff-1',
        destination: 'Казань',
        boxes: 99,
      },
      user(),
    );

    expect(prisma.logisticsDeliveryRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          boxes: 1,
          pallets: 2,
          estimatedTotalRub: 6000,
        }),
      }),
    );
  });
});

function user(): AuthUser {
  return {
    id: 'user-1',
    email: 'manager@example.com',
    name: 'Manager',
    roleCodes: ['MANAGER'],
    permissionCodes: ['logistics:read', 'logistics:request'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  };
}
