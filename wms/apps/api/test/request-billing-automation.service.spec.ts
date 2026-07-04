import {
  BillingChargeSource,
  BillingChargeStatus,
  BillingInvoiceSource,
  BillingUnit,
  ClientLogisticsInvoiceMode,
  ClientStorageBillingMode,
  ClientRequestStatus,
  ClientRequestType,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { RequestBillingAutomationService } from '../src/modules/billing/request-billing-automation.service';

describe('RequestBillingAutomationService', () => {
  it('создает один draft-счет по выполненной заявке из утвержденных упаковочных начислений', async () => {
    const prisma = fakePrisma({
      request: requestFixture({ logisticsInvoiceMode: ClientLogisticsInvoiceMode.DISABLED }),
      charges: [chargeFixture({ id: 'charge-box', sourceKey: 'fulfillment-package:request-1:BOX_60_40_40', totalRub: 200 })],
    });
    const service = serviceWith(prisma);

    await service.generateForDoneRequest('request-1', user());

    expect(prisma.state.invoices).toHaveLength(1);
    expect(prisma.state.invoices[0]).toMatchObject({
      source: BillingInvoiceSource.REQUEST_DONE,
      sourceKey: 'request-done:request-1:main',
      status: 'DRAFT',
      totalRub: 280,
    });
    expect(prisma.state.invoices[0].items).toEqual([
      expect.objectContaining({ chargeId: 'charge-box' }),
      expect.objectContaining({ description: 'Сборка короба по заявке Отгрузка' }),
    ]);
  });

  it('creates fulfillment package charges when a manual DONE request has no charges yet', async () => {
    const prisma = fakePrisma({
      request: requestFixture({ logisticsInvoiceMode: ClientLogisticsInvoiceMode.DISABLED }),
      charges: [],
    });
    const service = serviceWith(prisma);

    await service.generateForDoneRequest('request-1', user());

    expect(prisma.state.charges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: 'fulfillment-package:request-1:BOX_60_40_40',
          description: 'Короб 60*40*40 по заявке Отгрузка',
          quantity: 2,
          totalRub: 200,
        }),
        expect.objectContaining({
          sourceKey: 'fulfillment-package:request-1:BOX_ASSEMBLY',
          description: 'Сборка короба по заявке Отгрузка',
          quantity: 2,
          totalRub: 80,
        }),
      ]),
    );
    expect(prisma.state.invoices).toHaveLength(1);
    expect(prisma.state.invoices[0]).toMatchObject({
      source: BillingInvoiceSource.REQUEST_DONE,
      sourceKey: 'request-done:request-1:main',
      status: 'DRAFT',
      totalRub: 280,
    });
  });

  it('создает отдельный draft-счет логистики в режиме SEPARATE', async () => {
    const prisma = fakePrisma({
      request: requestFixture({ logisticsInvoiceMode: ClientLogisticsInvoiceMode.SEPARATE }),
      charges: [chargeFixture({ id: 'charge-box', totalRub: 140 })],
      quote: { estimatedTotalRub: 900, requiresManualReview: false },
    });
    const service = serviceWith(prisma);

    await service.generateForDoneRequest('request-1', user());

    expect(prisma.state.invoices.map((invoice) => invoice.sourceKey)).toEqual([
      'request-done:request-1:main',
      'request-done:request-1:logistics',
    ]);
    expect(prisma.state.invoices[0].totalRub).toBe(220);
    expect(prisma.state.invoices[1]).toMatchObject({ source: BillingInvoiceSource.LOGISTICS, totalRub: 900 });
  });

  it('добавляет логистику в общий счет в режиме SAME_INVOICE', async () => {
    const prisma = fakePrisma({
      request: requestFixture({ logisticsInvoiceMode: ClientLogisticsInvoiceMode.SAME_INVOICE }),
      charges: [chargeFixture({ id: 'charge-box', totalRub: 140 })],
      quote: { estimatedTotalRub: 900, requiresManualReview: false },
    });
    const service = serviceWith(prisma);

    await service.generateForDoneRequest('request-1', user());

    expect(prisma.state.invoices).toHaveLength(1);
    expect(prisma.state.invoices[0]).toMatchObject({
      sourceKey: 'request-done:request-1:main',
      totalRub: 1120,
    });
    expect(prisma.state.invoices[0].items.map((item) => item.chargeId)).toContain('charge-logistics');
  });

  it('не блокирует основной счет, если тариф логистики не найден', async () => {
    const prisma = fakePrisma({
      request: requestFixture({ logisticsInvoiceMode: ClientLogisticsInvoiceMode.SEPARATE }),
      charges: [chargeFixture({ id: 'charge-box', totalRub: 140 })],
      quoteError: new Error('Направление логистики не найдено'),
    });
    const service = serviceWith(prisma);

    await service.generateForDoneRequest('request-1', user());

    expect(prisma.state.invoices).toHaveLength(1);
    expect(prisma.state.invoices[0].sourceKey).toBe('request-done:request-1:main');
    expect(prisma.state.events).toEqual([
      expect.objectContaining({
        title: 'Требуется ручной расчет логистики',
        body: expect.stringContaining('Основной счет по заявке формируется без логистики.'),
      }),
    ]);
  });

  it('создает хранение по отгрузке только в режиме ON_SHIPMENT', async () => {
    const monthlyPrisma = fakePrisma({
      request: requestFixture({ storageBillingMode: ClientStorageBillingMode.MONTHLY, logisticsInvoiceMode: ClientLogisticsInvoiceMode.DISABLED }),
      charges: [chargeFixture({ id: 'charge-box', totalRub: 140 })],
    });
    await serviceWith(monthlyPrisma).generateForDoneRequest('request-1', user());
    expect(monthlyPrisma.state.charges.some((charge) => charge.sourceKey === 'request-done:request-1:storage-on-shipment')).toBe(false);

    const onShipmentPrisma = fakePrisma({
      request: requestFixture({ storageBillingMode: ClientStorageBillingMode.ON_SHIPMENT, logisticsInvoiceMode: ClientLogisticsInvoiceMode.DISABLED }),
      charges: [chargeFixture({ id: 'charge-box', totalRub: 140 })],
    });
    await serviceWith(onShipmentPrisma).generateForDoneRequest('request-1', user());
    expect(onShipmentPrisma.state.charges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: 'request-done:request-1:storage-on-shipment',
          source: BillingChargeSource.STORAGE,
        }),
      ]),
    );
  });

  it('повторный запуск по заявке не создает дубликаты счетов и начислений', async () => {
    const prisma = fakePrisma({
      request: requestFixture({ logisticsInvoiceMode: ClientLogisticsInvoiceMode.SEPARATE }),
      charges: [chargeFixture({ id: 'charge-box', totalRub: 140 })],
      quote: { estimatedTotalRub: 900, requiresManualReview: false },
    });
    const service = serviceWith(prisma);

    await service.generateForDoneRequest('request-1', user());
    await service.generateForDoneRequest('request-1', user());

    expect(prisma.state.invoices).toHaveLength(2);
    expect(prisma.state.charges.filter((charge) => charge.sourceKey === 'request-done:request-1:logistics-charge')).toHaveLength(1);
  });

  it('создает счет логистики по коробам из строк счета, если пакеты в заявке не сохранены', async () => {
    const prisma = fakePrisma({
      request: {
        ...requestFixture({ logisticsInvoiceMode: ClientLogisticsInvoiceMode.SEPARATE }),
        packages: [],
      },
      charges: [
        chargeFixture({
          id: 'charge-box',
          serviceId: 'service-box',
          serviceCode: 'BOX_60_40_40',
          quantity: 3,
          totalRub: 300,
        }),
        chargeFixture({
          id: 'charge-box-assembly',
          serviceId: 'service-box-assembly',
          serviceCode: 'BOX_ASSEMBLY',
          quantity: 3,
          totalRub: 120,
        }),
      ],
      quote: { estimatedTotalRub: 1500, requiresManualReview: false },
    });
    const service = serviceWith(prisma);

    await service.generateForDoneRequest('request-1', user());

    expect(prisma.state.charges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: BillingChargeSource.LOGISTICS,
          sourceKey: 'request-done:request-1:logistics-charge',
          totalRub: 1500,
          metadata: expect.objectContaining({
            boxes: 3,
            pallets: 0,
            billedBy: 'BOXES',
          }),
        }),
      ]),
    );
    expect(prisma.state.invoices.map((invoice) => invoice.sourceKey)).toContain('request-done:request-1:logistics');
  });
});

function serviceWith(prisma: ReturnType<typeof fakePrisma>) {
  return new RequestBillingAutomationService(
    prisma as never,
    { requireClientAccess: vi.fn() } as never,
    {
      quote: vi.fn(async () => {
        if (prisma.state.quoteError) {
          throw prisma.state.quoteError;
        }
        const quote = prisma.state.quote;
        return {
          tariffSet: { id: 'tariff-1', name: 'Тариф', sourceFile: null },
          route: { origin: 'Москва', destination: 'Казань' },
          input: { boxes: 2, pallets: null },
          tier: { label: '1-2 короба', pricingMode: 'TOTAL', priceRub: quote.estimatedTotalRub },
          estimatedTotalRub: quote.estimatedTotalRub,
          requiresManualReview: quote.requiresManualReview,
          note: quote.requiresManualReview ? 'ручная проверка' : null,
        };
      }),
    } as never,
  );
}

function fakePrisma(input: {
  request: ReturnType<typeof requestFixture>;
  charges?: FakeCharge[];
  quote?: { estimatedTotalRub: number | null; requiresManualReview: boolean };
  quoteError?: Error;
}) {
  const state = {
    request: input.request,
    charges: [...(input.charges ?? [])],
    invoices: [] as FakeInvoice[],
    events: [] as Array<Record<string, unknown>>,
    notifications: [] as Array<Record<string, unknown>>,
    services: [
      { id: 'service-storage', code: 'STORAGE_LITER_DAY', name: 'Хранение по литражу', unit: BillingUnit.LITER_DAY, defaultPriceRub: null },
      { id: 'service-logistics', code: 'LOGISTICS_DELIVERY', name: 'Доставка по заявке', unit: BillingUnit.SERVICE, defaultPriceRub: null },
      { id: 'service-item-processing', code: 'ITEM_PROCESSING', name: 'Обработка товара', unit: BillingUnit.PIECE, defaultPriceRub: null },
    ],
    quote: input.quote ?? { estimatedTotalRub: null, requiresManualReview: true },
    quoteError: input.quoteError,
  };

  const prisma = {
    state,
    $transaction: (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    clientRequest: {
      findUnique: vi.fn(async () => state.request),
    },
    billingCharge: {
      findFirst: vi.fn(async (args: { where: { sourceKey?: string } }) =>
        state.charges.find((charge) => charge.sourceKey === args.where.sourceKey) ?? null,
      ),
      findMany: vi.fn(async (args: { where: { id?: { in: string[] }; source?: { not: BillingChargeSource }; service?: { code?: { in: string[] } } } }) => {
        const serviceCodeFilter = args.where.service?.code?.in;
        return state.charges.filter((charge) => {
          const serviceCode = charge.serviceCode ?? state.services.find((service) => service.id === charge.serviceId)?.code;
          if (serviceCodeFilter && !serviceCodeFilter.includes(serviceCode ?? '')) {
            return false;
          }
          if (args.where.id?.in && !args.where.id.in.includes(charge.id)) {
            return false;
          }
          if (charge.clientId !== state.request.clientId || charge.requestId !== state.request.id) {
            return false;
          }
          if (charge.status !== BillingChargeStatus.APPROVED) {
            return false;
          }
          if (args.where.source?.not && charge.source === args.where.source.not) {
            return false;
          }
          return serviceCodeFilter || !state.invoices.some((invoice) => invoice.items.some((item) => item.chargeId === charge.id));
        }).map((charge) => ({
          ...charge,
          service: {
            code: charge.serviceCode ?? state.services.find((service) => service.id === charge.serviceId)?.code,
          },
        }));
      }),
      create: vi.fn(async (args: { data: Record<string, unknown>; select?: unknown }) => {
        const data = args.data;
        const code = (data.sourceKey as string | undefined)?.includes('logistics-charge')
          ? 'charge-logistics'
          : (data.sourceKey as string | undefined)?.includes('storage-on-shipment')
            ? 'charge-storage'
            : (data.sourceKey as string | undefined)?.includes('item-processing')
              ? 'charge-item-processing'
              : `charge-${state.charges.length + 1}`;
        const charge = {
          id: code,
          clientId: data.clientId as string,
          serviceId: data.serviceId as string,
          requestId: data.requestId as string,
          description: data.description as string,
          unit: data.unit as BillingUnit,
          quantity: Number(data.quantity),
          unitPriceRub: Number(data.unitPriceRub),
          totalRub: Number(data.totalRub),
          status: data.status as BillingChargeStatus,
          serviceDate: data.serviceDate as Date,
          source: data.source as BillingChargeSource,
          sourceKey: data.sourceKey as string,
          metadata: data.metadata as Record<string, unknown> | undefined,
          createdAt: new Date('2026-07-03T10:00:00.000Z'),
        } satisfies FakeCharge;
        state.charges.push(charge);
        return { id: charge.id };
      }),
    },
    billingService: {
      upsert: vi.fn(async (args: { where: { code: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = state.services.find((service) => service.code === args.where.code);
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const service = { id: `service-${args.where.code}`, ...args.create };
        state.services.push(service as never);
        return service;
      }),
    },
    clientBillingService: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async (args: { create: Record<string, unknown> }) => ({
        id: `client-price-${String(args.create.serviceId)}`,
        clientId: args.create.clientId,
        serviceId: args.create.serviceId,
        priceRub: args.create.priceRub,
        taxMode: args.create.taxMode,
        isActive: args.create.isActive,
      })),
    },
    billingInvoice: {
      findFirst: vi.fn(async (args: { where: { sourceKey?: string } }) =>
        state.invoices.find((invoice) => invoice.sourceKey === args.where.sourceKey) ?? null,
      ),
      count: vi.fn(async () => state.invoices.length),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const items = ((args.data.items as { create: FakeInvoiceItem[] }).create ?? []).map((item) => ({ ...item }));
        const invoice = {
          id: `invoice-${state.invoices.length + 1}`,
          number: args.data.number as string,
          clientId: args.data.clientId as string,
          requestId: args.data.requestId as string,
          source: args.data.source as BillingInvoiceSource,
          sourceKey: args.data.sourceKey as string,
          status: 'DRAFT',
          totalRub: Number(args.data.totalRub),
          items,
        } satisfies FakeInvoice;
        state.invoices.push(invoice);
        return invoice;
      }),
    },
    clientRequestEvent: {
      findFirst: vi.fn(async () => state.events[0] ?? null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const event = { id: `event-${state.events.length + 1}`, ...args.data };
        state.events.push(event);
        return { id: event.id };
      }),
    },
    clientNotificationPreference: {
      findUnique: vi.fn(async () => ({ isEnabled: true })),
    },
    clientNotification: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        state.notifications.push(args.data);
        return { id: `notification-${state.notifications.length}` };
      }),
    },
  };

  return prisma;
}

type FakeCharge = {
  id: string;
  clientId: string;
  serviceId: string;
  requestId: string;
  description: string;
  unit: BillingUnit;
  quantity: number;
  unitPriceRub: number;
  totalRub: number;
  status: BillingChargeStatus;
  serviceDate: Date;
  source: BillingChargeSource;
  sourceKey: string;
  serviceCode?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
};

type FakeInvoiceItem = {
  chargeId: string;
  description: string;
  unit: BillingUnit;
  quantity: number;
  unitPriceRub: number;
  totalRub: number;
  serviceDate: Date;
};

type FakeInvoice = {
  id: string;
  number: string;
  clientId: string;
  requestId: string;
  source: BillingInvoiceSource;
  sourceKey: string;
  status: string;
  totalRub: number;
  items: FakeInvoiceItem[];
};

function requestFixture(overrides: {
  logisticsInvoiceMode?: ClientLogisticsInvoiceMode;
  storageBillingMode?: ClientStorageBillingMode;
}) {
  return {
    id: 'request-1',
    clientId: 'client-1',
    type: ClientRequestType.OUTBOUND,
    status: ClientRequestStatus.DONE,
    title: 'Отгрузка',
    destinationCity: 'Казань',
    createdAt: new Date('2026-07-01T09:00:00.000Z'),
    updatedAt: new Date('2026-07-03T10:00:00.000Z'),
    client: {
      id: 'client-1',
      isDemo: false,
      storageAccountingEnabled: true,
      storagePriceRubPerLiterDay: '0.5',
      logisticsInvoiceMode: overrides.logisticsInvoiceMode ?? ClientLogisticsInvoiceMode.SEPARATE,
      storageBillingMode: overrides.storageBillingMode ?? ClientStorageBillingMode.MONTHLY,
    },
    items: [],
    packages: [
      {
        id: 'package-1',
        packageType: 'BOX',
        items: [
          {
            id: 'package-item-1',
            requestItemId: 'item-1',
            quantity: 2,
            sku: { id: 'sku-1', internalSku: 'SKU-1', name: 'Товар', volumeLiters: '1.5' },
          },
        ],
      },
      {
        id: 'package-2',
        packageType: 'BOX',
        items: [
          {
            id: 'package-item-2',
            requestItemId: 'item-2',
            quantity: 3,
            sku: { id: 'sku-2', internalSku: 'SKU-2', name: 'Товар 2', volumeLiters: '2' },
          },
        ],
      },
    ],
  };
}

function chargeFixture(overrides: Partial<FakeCharge> = {}): FakeCharge {
  return {
    id: 'charge-1',
    clientId: 'client-1',
    serviceId: 'service-box',
    requestId: 'request-1',
    description: 'Короб 60*40*40',
    unit: BillingUnit.PIECE,
    quantity: 2,
    unitPriceRub: 70,
    totalRub: 140,
    status: BillingChargeStatus.APPROVED,
    serviceDate: new Date('2026-07-03T10:00:00.000Z'),
    source: BillingChargeSource.MANUAL,
    sourceKey: 'fulfillment-package:request-1:BOX_60_40_40',
    createdAt: new Date('2026-07-03T10:00:00.000Z'),
    ...overrides,
  };
}

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'User',
    roleCodes: ['ADMIN'],
    permissionCodes: ['system:admin'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
    ...overrides,
  };
}
