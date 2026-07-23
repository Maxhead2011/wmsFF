import {
  ClientRequestStatus,
  FbsDeliveryDestination,
  MarketplaceType,
  Prisma,
  VolumeSource,
} from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

describe('MarketplaceConnectionsService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves a manually assigned volume while refreshing a client product card from an API', async () => {
    const existing = {
      id: 'sku-1',
      clientId: 'client-1',
      internalSku: 'SKU-1',
      volumeLiters: new Prisma.Decimal(7.5),
      volumeSource: VolumeSource.MANUAL,
    };
    const prisma = {
      sku: {
        findFirst: vi.fn().mockResolvedValue(existing),
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
      },
      barcode: {
        findFirst: vi.fn(),
        upsert: vi.fn(),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await (service as any).upsertMarketplaceSku('client-1', {
      marketplace: MarketplaceType.WILDBERRIES,
      productId: 'product-1',
      offerId: 'offer-1',
      internalSku: 'SKU-1',
      article: 'ARTICLE-1',
      barcodes: [],
      name: 'Обновлённая карточка',
      lengthCm: 30,
      widthCm: 20,
      heightCm: 10,
      payload: { source: 'api' },
    });

    const data = prisma.sku.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      name: 'Обновлённая карточка',
      lengthCm: 30,
      widthCm: 20,
      heightCm: 10,
    });
    expect(data).not.toHaveProperty('volumeLiters');
    expect(data).not.toHaveProperty('volumeSource');
  });

  it('loads real WB FBS orders for the selected client and adds storage boxes', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ id: 'client-1', code: 'CL-1', name: 'Клиент' }),
      },
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'connection-1',
            clientId: 'client-1',
            marketplace: MarketplaceType.WILDBERRIES,
            accountName: 'Основной кабинет',
            sellerId: null,
            apiKey: 'secret-key',
            isActive: true,
            comment: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
          },
        ]),
      },
      clientFbsBillingSettings: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sku-1',
            name: 'Тестовый товар',
            internalSku: 'SKU-1',
            clientSku: 'ART-1',
            article: 'ART-1',
            barcodes: [{ value: '460000000001' }],
            balances: [
              {
                quantity: 4,
                status: 'AVAILABLE',
                box: { code: 'FFL_TEST_001' },
              },
            ],
          },
        ]),
      },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const payload = url.includes('/orders/new')
          ? {
              orders: [
                {
                  id: 1001,
                  orderUid: 'order-uid-1',
                  article: 'ART-1',
                  skus: ['460000000001'],
                  createdAt: '2026-07-19T10:00:00Z',
                },
              ],
            }
          : url.includes('/orders/status')
            ? { orders: [{ id: 1001, supplierStatus: 'new', wbStatus: 'waiting' }] }
            : { orders: [], next: 0 };
        return {
          ok: true,
          status: 200,
          json: async () => payload,
        } as Response;
      }),
    );
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);

    const result = await service.listFbsOrders(
      'client-1',
      {
        id: 'user-1',
        email: 'client@example.test',
        name: 'Клиент',
        roleCodes: ['CLIENT'],
        permissionCodes: ['clients:read'],
        clientScopeMode: 'LIMITED',
        clientIds: ['client-1'],
        writableClientIds: [],
      },
      true,
    );

    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(expect.anything(), 'client-1', 'read');
    expect(result.connected).toBe(true);
    expect(result.counts).toMatchObject({ active: 1, shipped: 0, archive: 0 });
    expect(result.orders[0]).toMatchObject({
      id: '1001',
      category: 'active',
      article: 'ART-1',
      product: { name: 'Тестовый товар' },
      storageBoxes: [{ code: 'FFL_TEST_001', quantity: 4, status: 'AVAILABLE' }],
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://marketplace-api.wildberries.ru/api/v3/orders/status',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ orders: [1001] }),
      }),
    );
  });

  it('does not allow a user to request FBS orders outside their client scope', async () => {
    const clientScopes = {
      requireClientAccess: vi.fn(() => {
        throw new ForbiddenException();
      }),
    };
    const prisma = {
      client: { findUnique: vi.fn() },
      clientMarketplaceConnection: { findMany: vi.fn() },
    };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);

    await expect(
      service.listFbsOrders(
        'another-client',
        {
          id: 'user-1',
          email: 'client@example.test',
          name: 'Клиент',
          roleCodes: ['CLIENT'],
          permissionCodes: ['clients:read'],
          clientScopeMode: 'LIMITED',
          clientIds: ['client-1'],
          writableClientIds: [],
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.client.findUnique).not.toHaveBeenCalled();
  });

  it('keeps the TSD queue in the last WB supply and reassigns a stale unstarted task', async () => {
    const staleUpdatedAt = new Date('2026-07-22T06:00:00Z');
    const fbsTsdAssembly = {
      findFirst: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ requestId: 'request-31', supplyId: 'WB-GI-31' }),
      findUnique: vi.fn().mockResolvedValue({
        id: 'stale-task',
        orderId: 'order-from-current-supply',
        status: 'IN_PROGRESS',
        deviceCode: 'USER:old-worker',
        workerName: 'Старый сборщик',
        boxId: null,
        barcode: null,
        kiz: null,
        updatedAt: staleUpdatedAt,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'stale-task', ...data })),
      create: vi.fn(),
    };
    const prisma = {
      fbsTsdAssembly,
      clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue([{ clientId: 'client-1' }]) },
      clientRequestItem: { findFirst: vi.fn().mockResolvedValue({ id: 'request-item-31' }) },
    };
    const clientScopes = {
      resolveClientFilter: vi.fn().mockReturnValue('client-1'),
      requireClientAccess: vi.fn(),
    };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    const order = (id: string, requestId: string, supplyId: string, createdAt: string) => ({
      id,
      connectionId: 'connection-1',
      marketplace: MarketplaceType.WILDBERRIES,
      category: 'active',
      supplierStatus: 'confirm',
      product: {
        id: `sku-${requestId}`,
        name: `Товар ${requestId}`,
        article: requestId,
        clientSku: null,
        internalSku: requestId,
        needsChestnyZnak: false,
        isUnmarked: true,
      },
      request: { id: requestId, status: 'SUBMITTED' },
      supplyId,
      storageBoxes: [{ code: 'FFL_TEST_001', quantity: 1, status: 'AVAILABLE' }],
      requiredMeta: [],
      optionalMeta: [],
      barcodes: ['4600000000012'],
      itemCount: 1,
      createdAt,
    });
    vi.spyOn(service as any, 'loadFbsOrders').mockResolvedValue({
      orders: [
        order('order-from-next-request', 'request-32', 'WB-GI-32', '2026-07-22T10:00:00Z'),
        order('order-from-current-supply', 'request-31', 'WB-GI-31', '2026-07-22T11:00:00Z'),
      ],
    });
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(async (task: unknown) => task);

    const result = await service.getNextFbsTsdAssembly(undefined, {
      id: 'worker-1',
      name: 'Сборщик',
    } as never);

    expect(fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'stale-task',
        status: 'IN_PROGRESS',
        updatedAt: staleUpdatedAt,
        boxId: null,
        barcode: null,
        kiz: null,
      }),
      data: expect.objectContaining({ status: 'RELEASED' }),
    });
    expect(fbsTsdAssembly.update).toHaveBeenCalledWith({
      where: { id: 'stale-task' },
      data: expect.objectContaining({
        orderId: 'order-from-current-supply',
        requestId: 'request-31',
        supplyId: 'WB-GI-31',
      }),
    });
    expect(fbsTsdAssembly.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ orderId: 'order-from-current-supply' });
  });

  it('allows a client to connect their own WB API without granting client editing rights', async () => {
    const created = {
      id: 'connection-1',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      accountName: 'Основной кабинет',
      sellerId: null,
      apiKey: 'secret-key-value',
      isActive: true,
      comment: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
    };
    const prisma = {
      clientMarketplaceConnection: {
        create: vi.fn().mockResolvedValue(created),
      },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);

    const result = await service.createFbsConnection(
      {
        clientId: 'client-1',
        marketplace: MarketplaceType.WILDBERRIES,
        accountName: 'Основной кабинет',
        apiKey: 'secret-key-value',
        isActive: true,
      },
      {
        id: 'user-1',
        email: 'client@example.test',
        name: 'Клиент',
        roleCodes: ['CLIENT'],
        permissionCodes: ['clients:read'],
        clientScopeMode: 'LIMITED',
        clientIds: ['client-1'],
        writableClientIds: [],
      },
    );

    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(expect.anything(), 'client-1', 'read');
    expect(result).toMatchObject({
      id: 'connection-1',
      marketplace: MarketplaceType.WILDBERRIES,
      hasApiKey: true,
    });
    expect(result).not.toHaveProperty('apiKey');
  });

  it('lists only accessible clients that currently have active FBS orders', async () => {
    const clientOne = { id: 'client-1', code: 'CL-1', name: 'Первый клиент' };
    const clientTwo = { id: 'client-2', code: 'CL-2', name: 'Второй клиент' };
    const prisma = {
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([
          { client: clientOne },
          { client: clientOne },
          { client: clientTwo },
        ]),
      },
    };
    const clientScopes = {
      resolveClientFilter: vi.fn().mockReturnValue({ in: ['client-1', 'client-2'] }),
    };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    vi.spyOn(service as any, 'loadFbsOrders').mockImplementation(async (clientId: string) => ({
      client: clientId === clientOne.id ? clientOne : clientTwo,
      counts: { active: clientId === clientOne.id ? 3 : 0, shipped: 0, archive: 0, all: 3 },
      fetchedAt: '2026-07-21T18:00:00.000Z',
      orders: [],
    }));

    const result = await service.listFbsActiveClients({ id: 'user-1' } as never);

    expect(clientScopes.resolveClientFilter).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }));
    expect(prisma.clientMarketplaceConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: { in: ['client-1', 'client-2'] }, isActive: true }),
      }),
    );
    expect(result).toEqual([
      {
        client: clientOne,
        activeOrders: 3,
        fetchedAt: '2026-07-21T18:00:00.000Z',
      },
    ]);
    expect((service as any).loadFbsOrders).toHaveBeenCalledTimes(2);
  });

  it('creates an idempotent FBS processing charge when an order is shipped', async () => {
    const fbsService = {
      id: 'service-fbs',
      code: 'FBS_PROCESSING',
      name: 'Обработка заказа FBS',
      unit: 'PIECE',
      defaultPriceRub: new Prisma.Decimal(0),
      clientPrices: [{ priceRub: new Prisma.Decimal(75), isActive: true }],
    };
    const formationService = {
      id: 'service-formation',
      code: 'BOX_ASSEMBLY',
      name: 'Сборка короба',
      unit: 'PIECE',
      defaultPriceRub: new Prisma.Decimal(40),
      clientPrices: [{ priceRub: new Prisma.Decimal(40), isActive: true }],
    };
    const boxService = {
      id: 'service-box',
      code: 'BOX_60_40_40',
      name: 'Короб 60*40*40',
      unit: 'PIECE',
      defaultPriceRub: new Prisma.Decimal(100),
      clientPrices: [{ priceRub: new Prisma.Decimal(100), isActive: true }],
    };
    const palletService = {
      id: 'service-pallet',
      code: 'PALLET',
      name: 'Паллета',
      unit: 'PALLET',
      defaultPriceRub: new Prisma.Decimal(300),
      clientPrices: [{ priceRub: new Prisma.Decimal(300), isActive: true }],
    };
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ id: 'client-1', code: 'CL-1', name: 'Клиент' }),
      },
      billingService: {
        upsert: vi.fn().mockImplementation(async ({ where }) => {
          if (where.code === 'BOX_ASSEMBLY') return formationService;
          if (where.code === 'BOX_60_40_40') return boxService;
          return fbsService;
        }),
        findMany: vi.fn().mockResolvedValue([
          fbsService,
          formationService,
          boxService,
          palletService,
        ]),
      },
      clientBillingService: {
        upsert: vi.fn(),
      },
      clientFbsBillingSettings: {
        upsert: vi.fn().mockResolvedValue({
          id: 'settings-1',
          clientId: 'client-1',
          defaultDeliveryDestination: 'PICKUP_POINT',
          pickupPointBasePriceRub: new Prisma.Decimal(500),
          vnukovoBasePriceRub: new Prisma.Decimal(1500),
          baseIncludedItems: 5,
          extraBlockItems: 5,
          extraBlockPriceRub: new Prisma.Decimal(250),
          boxCapacityItems: 14,
          boxFormationServiceId: formationService.id,
          boxMaterialServiceId: boxService.id,
          palletsEnabled: false,
          boxesPerPallet: 16,
          palletServiceId: null,
          additionalServices: [],
        }),
      },
      billingCharge: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }) => ({
          id: 'charge-1',
          ...data,
          invoiceItems: [],
        })),
        update: vi.fn(),
      },
      billingInvoice: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    const result = await (service as any).ensureFbsProcessingCharges('client-1', [
      {
        id: '1001',
        marketplace: MarketplaceType.WILDBERRIES,
        connectionId: 'connection-1',
        category: 'shipped',
        itemCount: 1,
        createdAt: '2026-07-19T10:00:00Z',
        sellerDate: '2026-07-19T11:00:00Z',
        deliveryDate: '2026-07-19T12:00:00Z',
        supplyId: 'WB-GI-1',
      },
    ]);

    expect(prisma.billingCharge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          serviceId: 'service-fbs',
          requestId: null,
          description: 'Обработка заказов по FBS',
          sourceKey: 'fbs-calculator:client-1:WILDBERRIES:connection-1:supply:WB-GI-1',
          unitPriceRub: 1839.89,
          totalRub: 1839.89,
          metadata: expect.objectContaining({
            kind: 'FBS',
            pricingVersion: 4,
            calculator: 'BUILT_IN',
            calculatorDestination: 'Внуково',
            orderIds: ['1001'],
            quote: expect.objectContaining({
              quantity: 1,
              boxes: 1,
              deliveryPrice: 1500,
              totalWithTax: 1839.89,
            }),
          }),
        }),
      }),
    );
    expect(result.get('WILDBERRIES:connection-1:1001')).toMatchObject({
      chargeId: 'charge-1',
      totalRub: 1839.89,
      invoiceNumber: null,
      breakdown: expect.objectContaining({
        deliveryRub: 1500,
        boxCount: 1,
        deliveryDestination: 'VNUKOVO_SORTING_CENTER',
      }),
    });

    prisma.billingCharge.create.mockClear();
    await (service as any).ensureFbsProcessingCharges(
      'client-1',
      Array.from({ length: 6 }, (_value, index) => ({
        id: String(2001 + index),
        marketplace: MarketplaceType.WILDBERRIES,
        connectionId: 'connection-1',
        category: 'shipped',
        itemCount: 1,
        createdAt: '2026-07-19T10:00:00Z',
        sellerDate: '2026-07-19T11:00:00Z',
        deliveryDate: '2026-07-19T12:00:00Z',
        supplyId: 'WB-GI-2',
      })),
    );
    const batchCharges = prisma.billingCharge.create.mock.calls.map((call) => call[0].data);
    expect(batchCharges).toHaveLength(1);
    expect(batchCharges[0]).toMatchObject({
      description: 'Обработка заказов по FBS',
      quantity: 6,
      totalRub: 1943.62,
      metadata: expect.objectContaining({
        orderIds: ['2001', '2002', '2003', '2004', '2005', '2006'],
        quote: expect.objectContaining({ deliveryPrice: 1500, totalWithTax: 1943.62 }),
      }),
    });

    prisma.clientFbsBillingSettings.upsert.mockResolvedValue({
      id: 'settings-1',
      clientId: 'client-1',
      defaultDeliveryDestination: 'PICKUP_POINT',
      pickupPointBasePriceRub: new Prisma.Decimal(500),
      vnukovoBasePriceRub: new Prisma.Decimal(1500),
      baseIncludedItems: 5,
      extraBlockItems: 5,
      extraBlockPriceRub: new Prisma.Decimal(250),
      boxCapacityItems: 14,
      boxFormationServiceId: formationService.id,
      boxMaterialServiceId: boxService.id,
      palletsEnabled: true,
      boxesPerPallet: 2,
      palletServiceId: palletService.id,
      additionalServices: [],
    });
    prisma.billingCharge.create.mockClear();
    const palletResult = await (service as any).ensureFbsProcessingCharges('client-1', [
      {
        id: '3001',
        marketplace: MarketplaceType.WILDBERRIES,
        connectionId: 'connection-1',
        category: 'shipped',
        itemCount: 17,
        createdAt: '2026-07-19T10:00:00Z',
        sellerDate: '2026-07-19T11:00:00Z',
        deliveryDate: '2026-07-19T12:00:00Z',
        supplyId: 'WB-GI-3',
      },
    ]);
    expect(prisma.billingCharge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalRub: 2395.21,
          metadata: expect.objectContaining({
            pricingVersion: 4,
            quote: expect.objectContaining({
              boxes: 2,
              deliveryPrice: 1500,
              totalWithTax: 2395.21,
            }),
          }),
        }),
      }),
    );
    expect(palletResult.get('WILDBERRIES:connection-1:3001')).toMatchObject({
      totalRub: 2395.21,
      breakdown: expect.objectContaining({
        boxCount: 2,
        palletCount: 0,
        palletRub: 0,
      }),
    });
  });

  it('rebuilds a draft FBS invoice into one calculator line and cancels legacy draft charges', async () => {
    const tx = {
      billingInvoiceItem: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      billingInvoice: {
        findFirst: vi.fn().mockResolvedValue({ id: 'invoice-1' }),
        update: vi.fn().mockResolvedValue({ id: 'invoice-1' }),
      },
      billingCharge: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    const charge = {
      id: 'calculator-charge',
      clientId: 'client-1',
      description: 'Обработка заказов по FBS',
      unit: 'PIECE',
      quantity: new Prisma.Decimal(14),
      unitPriceRub: new Prisma.Decimal(150.68),
      totalRub: new Prisma.Decimal(2109.57),
      serviceDate: new Date('2026-07-22T10:00:00Z'),
      createdAt: new Date('2026-07-22T10:00:00Z'),
    };
    const prisma = {
      billingInvoice: {
        findUnique: vi.fn().mockResolvedValue({ id: 'invoice-1', number: 'FBS-202607-0001', status: 'DRAFT' }),
      },
      billingCharge: { findMany: vi.fn().mockResolvedValue([charge]) },
      billingInvoiceItem: {
        findMany: vi.fn().mockResolvedValue([
          { chargeId: 'legacy-charge-1' },
          { chargeId: 'legacy-charge-2' },
        ]),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const orders = ['1001', '1002'].map((id) => ({
      id,
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      supplyId: 'WB-GI-1',
      shipmentPlan: { destination: 'VNUKOVO_SORTING_CENTER' },
      request: { id: 'request-1' },
    }));
    const billingByOrder = new Map(
      orders.map((order) => [
        `WILDBERRIES:connection-1:${order.id}`,
        {
          chargeId: charge.id,
          status: 'DRAFT',
          unitPriceRub: 150.68,
          totalRub: 1054.785,
          invoiceNumber: null,
          invoiceStatus: null,
          breakdown: {},
        },
      ]),
    );

    await (service as any).ensureFbsShipmentInvoices('client-1', orders, billingByOrder);

    expect(tx.billingInvoiceItem.deleteMany).toHaveBeenCalledWith({ where: { invoiceId: 'invoice-1' } });
    expect(tx.billingInvoiceItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        invoiceId: 'invoice-1',
        chargeId: 'calculator-charge',
        description: 'Обработка заказов по FBS',
        quantity: charge.quantity,
        totalRub: charge.totalRub,
      })],
    });
    expect(tx.billingInvoice.update).toHaveBeenCalledWith({
      where: { id: 'invoice-1' },
      data: expect.objectContaining({ requestId: 'request-1', totalRub: 2109.57 }),
    });
    expect(tx.billingCharge.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { in: ['legacy-charge-1', 'legacy-charge-2'] }, status: 'DRAFT' }),
      data: { status: 'CANCELLED' },
    });
  });

  it('loads the exact WB sticker and its large four-digit part for the TSD', async () => {
    const prisma = {
      clientMarketplaceConnection: {
        findFirst: vi.fn().mockResolvedValue({ apiKey: 'secret-key' }),
      },
      fbsTsdAssembly: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          stickers: [{ orderId: 5355080461, partA: 12345, partB: 9753, barcode: 'WB123', file: 'aW1hZ2U=' }],
        }),
      } as Response)),
    );
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    const result = await (service as any).loadFbsTsdOrderSticker({
      id: 'task-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      orderId: '5355080461',
    });

    expect(result).toEqual({
      partA: '12345',
      partB: '9753',
      barcode: 'WB123',
      imageBase64: 'aW1hZ2U=',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://marketplace-api.wildberries.ru/api/v3/orders/stickers?type=png&width=58&height=40',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ orders: [5355080461] }),
      }),
    );
    expect(prisma.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: {
        stickerPartA: '12345',
        stickerPartB: '9753',
        stickerBarcode: 'WB123',
      },
    });
  });

  it('switches an untouched TSD task when the scanned box belongs to another pending order in the same request', async () => {
    const currentTask = {
      id: 'task-current',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      orderId: 'order-current',
      requestId: 'request-32',
      deviceCode: 'USER:worker',
      status: 'IN_PROGRESS',
      boxId: null,
      barcode: null,
      kiz: null,
    };
    const createdTask = {
      ...currentTask,
      id: 'task-matching-box',
      orderId: '5355467854',
      skuId: 'sku-black',
      boxId: 'box-101',
      boxCode: 'FFL_LKB1705_101',
    };
    const tx = {
      fbsTsdAssembly: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(currentTask),
        update: vi.fn().mockResolvedValue({ ...currentTask, status: 'RELEASED' }),
        create: vi.fn().mockResolvedValue(createdTask),
      },
    };
    const prisma = {
      clientRequestItem: { findFirst: vi.fn().mockResolvedValue({ id: 'request-item-black' }) },
      fbsTsdAssembly: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _sum: { itemCount: 0 } }),
      },
      stockBalance: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 30 } }) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadFbsOrders').mockResolvedValue({
      orders: [{
        id: '5355467854',
        marketplace: MarketplaceType.WILDBERRIES,
        connectionId: 'connection-1',
        category: 'active',
        supplierStatus: 'confirm',
        request: { id: 'request-32', status: 'SUBMITTED' },
        product: {
          id: 'sku-black',
          name: 'Костюм летний брючный оверсайз',
          article: 'Корея_2черный',
          clientSku: null,
          internalSku: 'Корея_2черный',
          needsChestnyZnak: true,
          isUnmarked: false,
        },
        storageBoxes: [{ code: 'FFL_LKB1705_101', status: 'AVAILABLE', quantity: 30 }],
        requiredMeta: ['sgtin'],
        optionalMeta: [],
        barcodes: ['4600000000001'],
        itemCount: 1,
        supplyId: 'WB-GI-32',
        createdAt: '2026-07-22T10:00:00Z',
      }],
    });
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(
      async (task: unknown, _user: unknown, message: string) => ({ task, message }),
    );

    const result = await (service as any).switchFbsTsdAssemblyToBox(
      currentTask,
      { id: 'box-101', code: 'FFL_LKB1705_101' },
      { id: 'worker-1', name: 'Сборщик' },
    );

    expect(tx.fbsTsdAssembly.update).toHaveBeenCalledWith({
      where: { id: 'task-current' },
      data: expect.objectContaining({ status: 'RELEASED' }),
    });
    expect(tx.fbsTsdAssembly.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: '5355467854',
        requestId: 'request-32',
        boxId: 'box-101',
        boxCode: 'FFL_LKB1705_101',
        status: 'IN_PROGRESS',
      }),
    });
    expect(result).toMatchObject({
      task: { orderId: '5355467854', boxCode: 'FFL_LKB1705_101' },
      message: expect.stringContaining('Короб FFL_LKB1705_101 нужен заявке'),
    });
  });

  it('moves selected new WB orders to a supply and refreshes their statuses', async () => {
    const connection = {
      id: 'connection-1',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      apiKey: 'secret-key',
      isActive: true,
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
    };
    const prisma = {
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([connection]),
      },
      clientFbsBillingSettings: {
        findUnique: vi.fn().mockResolvedValue({
          defaultDeliveryDestination: 'PICKUP_POINT',
          boxCapacityItems: 14,
        }),
      },
      fbsSupplyPlan: {
        upsert: vi.fn().mockResolvedValue({ id: 'plan-1' }),
        update: vi.fn().mockResolvedValue({ id: 'plan-1' }),
      },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    const selectedOrders = Array.from({ length: 15 }, (_value, index) => ({
      id: String(1001 + index),
      connectionId: connection.id,
      marketplace: MarketplaceType.WILDBERRIES,
      supplierStatus: 'new',
      cargoType: '1',
      warehouseId: '1693195',
      crossBorderType: null,
      pickupPointShipmentAllowed: true,
      itemCount: 1,
    }));
    vi.spyOn(service as any, 'resolveSelectedFbsOrders').mockResolvedValue({
      response: { client: connection.client },
      orders: selectedOrders,
    });
    vi.spyOn(service as any, 'refreshFbsOrdersCache').mockResolvedValue({ orders: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: url.endsWith('/trbx') ? 201 : 200,
        json: async () =>
          url.endsWith('/api/v3/supplies')
            ? { id: 'supply-1' }
            : url.endsWith('/trbx')
              ? { trbxIds: ['WB-TRBX-1', 'WB-TRBX-2'] }
              : {},
      } as Response)),
    );

    const result = await service.assembleFbsOrders(
      {
        clientId: 'client-1',
        orders: selectedOrders.map((order) => ({ connectionId: order.connectionId, id: order.id })),
      },
      { id: 'user-1' } as never,
    );

    expect(result).toMatchObject({
      assembled: 15,
      deliveryPlan: {
        destination: 'PICKUP_POINT',
        itemsPerCargoPlace: 14,
        requiresCargoPlaces: true,
      },
      supplies: [
        {
          id: 'supply-1',
          connectionId: connection.id,
          orderIds: selectedOrders.map((order) => order.id),
          itemCount: 15,
          cargoPlaceCount: 2,
          cargoPlaceIds: ['WB-TRBX-1', 'WB-TRBX-2'],
        },
      ],
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://marketplace-api.wildberries.ru/api/marketplace/v3/supplies/supply-1/orders',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ orders: selectedOrders.map((order) => Number(order.id)) }),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://marketplace-api.wildberries.ru/api/v3/supplies/supply-1/trbx',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ amount: 2 }),
      }),
    );
    expect(prisma.fbsSupplyPlan.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          supplyId: 'supply-1',
          deliveryDestination: 'PICKUP_POINT',
          itemsPerCargoPlace: 14,
          orderIds: selectedOrders.map((order) => order.id),
        }),
      }),
    );
    expect(prisma.fbsSupplyPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          cargoPlaceCount: 2,
          cargoPlaceIds: ['WB-TRBX-1', 'WB-TRBX-2'],
        },
      }),
    );
  });

  it('persists sorting-center selection and does not create cargo places', async () => {
    const connection = {
      id: 'connection-1',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      apiKey: 'secret-key',
      isActive: true,
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
    };
    const prisma = {
      clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue([connection]) },
      clientFbsBillingSettings: {
        findUnique: vi.fn().mockResolvedValue({ defaultDeliveryDestination: 'PICKUP_POINT' }),
      },
      fbsSupplyPlan: {
        upsert: vi.fn().mockResolvedValue({ id: 'plan-1' }),
        update: vi.fn(),
      },
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );
    const selectedOrder = {
      id: '2001',
      connectionId: connection.id,
      marketplace: MarketplaceType.WILDBERRIES,
      supplierStatus: 'new',
      cargoType: '1',
      warehouseId: '1693195',
      crossBorderType: null,
      pickupPointShipmentAllowed: false,
      itemCount: 1,
    };
    vi.spyOn(service as any, 'resolveSelectedFbsOrders').mockResolvedValue({
      response: { client: connection.client },
      orders: [selectedOrder],
    });
    vi.spyOn(service as any, 'refreshFbsOrdersCache').mockResolvedValue({ orders: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => url.endsWith('/api/v3/supplies') ? { id: 'supply-sc-1' } : {},
      } as Response)),
    );

    const result = await service.assembleFbsOrders(
      {
        clientId: 'client-1',
        deliveryDestination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
        orders: [{ connectionId: connection.id, id: selectedOrder.id }],
      },
      { id: 'user-1' } as never,
    );

    expect(result.deliveryPlan).toMatchObject({
      destination: 'VNUKOVO_SORTING_CENTER',
      requiresCargoPlaces: false,
    });
    expect(result.supplies[0]).toMatchObject({ cargoPlaceCount: 0, cargoPlaceIds: [] });
    expect(prisma.fbsSupplyPlan.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ deliveryDestination: 'VNUKOVO_SORTING_CENTER' }),
      }),
    );
    expect(prisma.fbsSupplyPlan.update).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/trbx'))).toBe(false);
  });

  it('creates one outbound request and persistently links every selected FBS order', async () => {
    const tx = {
      clientRequest: {
        create: vi.fn().mockResolvedValue({
          id: 'request-1',
          number: 42,
          title: 'FBS — 2 заказ(а/ов)',
          status: 'SUBMITTED',
          items: [{ id: 'item-1', skuId: 'sku-1', name: 'Костюм', quantity: 2 }],
        }),
      },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
      fbsOrderRequestLink: { create: vi.fn().mockResolvedValue({}), update: vi.fn() },
    };
    const prisma = {
      fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    const orders = ['1001', '1002'].map((id) => ({
      id,
      connectionId: 'connection-1',
      marketplace: MarketplaceType.WILDBERRIES,
      category: 'active',
      itemCount: 1,
      barcodes: ['460000000001'],
      product: { id: 'sku-1', name: 'Костюм', internalSku: 'SKU-1', clientSku: null, article: null },
    }));
    vi.spyOn(service as any, 'resolveSelectedFbsOrders').mockResolvedValue({ response: {}, orders });
    vi.spyOn(service as any, 'refreshFbsOrdersCache').mockResolvedValue({ orders: [] });

    const result = await service.createFbsRequest(
      {
        clientId: 'client-1',
        orders: orders.map((order) => ({ connectionId: order.connectionId, id: order.id })),
      },
      { id: 'user-1' } as never,
    );

    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(expect.anything(), 'client-1', 'write');
    expect(tx.clientRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'OUTBOUND',
          items: { create: [expect.objectContaining({ skuId: 'sku-1', quantity: 2 })] },
        }),
      }),
    );
    expect(tx.fbsOrderRequestLink.create).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ request: { id: 'request-1', number: 42 }, linkedOrders: 2 });
  });

  it('registers a scanned FBS KIZ against an unmarked historical balance without forcing GTIN to equal the order barcode', async () => {
    const barcode = '4600000000012';
    const kiz = '010590000000001221SERIAL123456';
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      orderId: '1001',
      skuId: 'sku-1',
      productName: 'Костюм',
      requiresKiz: true,
      status: 'IN_PROGRESS',
      boxId: 'box-1',
      boxCode: 'FFL_TEST_001',
      barcode,
      barcodes: [barcode],
      kiz: null,
      wbMetaStatus: 'PENDING',
    };
    const productMark = {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'mark-1' }),
      deleteMany: vi.fn(),
    };
    const fbsTsdAssembly = {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...task, ...data })),
      updateMany: vi.fn(),
    };
    const tx = {
      productMark,
      stockBalance: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 2 } }) },
      fbsTsdAssembly,
    };
    const prisma = {
      ...tx,
      clientMarketplaceConnection: { findFirst: vi.fn().mockResolvedValue({ apiKey: 'secret-key' }) },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(
      async (updated: unknown, _user: unknown, message: string) => ({ task: updated, message }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) } as Response)),
    );

    const result = await service.scanFbsTsdKiz('task-1', { kiz }, { id: 'user-1' } as never);

    expect(productMark.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'client-1',
        skuId: 'sku-1',
        boxId: 'box-1',
        value: kiz,
        status: 'AVAILABLE',
      }),
      select: { id: true },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://marketplace-api.wildberries.ru/api/v3/orders/1001/meta/sgtin',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ sgtins: [kiz] }) }),
    );
    expect(result).toMatchObject({
      message: 'КИЗ принят Wildberries и зарегистрирован в остатках WMS. Подтвердите сборку заказа.',
    });
  });

  it('asks the TSD to confirm moving a known KIZ from another box', async () => {
    const kiz = '010590000000001221MOVE123456';
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      orderId: '1001',
      requestId: 'request-1',
      skuId: 'sku-1',
      productName: 'Костюм',
      article: 'ART-1',
      requiresKiz: true,
      status: 'IN_PROGRESS',
      boxId: 'box-target',
      boxCode: 'FFL_TARGET_001',
      barcode: '4600000000012',
      barcodes: ['4600000000012'],
      kiz: null,
      wbMetaStatus: 'PENDING',
    };
    const prisma = {
      productMark: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'mark-1',
          clientId: 'client-1',
          skuId: 'sku-1',
          boxId: 'box-source',
          status: 'AVAILABLE',
          box: { code: 'FFL_SOURCE_001' },
          sku: { name: 'Костюм' },
        }),
      },
      fbsTsdAssembly: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockResolvedValue({ task, progress: {} });

    const result = await service.scanFbsTsdKiz('task-1', { kiz }, { id: 'user-1' } as never);

    expect(result).toMatchObject({
      state: 'CONFIRM_KIZ_MOVE',
      kizMoveProposal: {
        kiz,
        fromBoxCode: 'FFL_SOURCE_001',
        toBoxCode: 'FFL_TARGET_001',
        productName: 'Костюм',
        article: 'ART-1',
      },
    });
  });

  it('moves exactly one marked FBS item into the opened box and records the movement', async () => {
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      orderId: '1001',
      requestId: 'request-1',
      skuId: 'sku-1',
      boxId: 'box-target',
      boxCode: 'FFL_TARGET_001',
      workerName: 'Сборщик',
      deviceCode: 'TSD-1',
    };
    const updatedTask = { ...task, kiz: 'KIZ-1', wbMetaStatus: 'ACCEPTED' };
    const tx = {
      fbsTsdAssembly: {
        findUnique: vi.fn().mockResolvedValue(task),
        update: vi.fn().mockResolvedValue(updatedTask),
      },
      productMark: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'mark-1',
          clientId: 'client-1',
          skuId: 'sku-1',
          boxId: 'box-source',
          status: 'AVAILABLE',
          box: { id: 'box-source', code: 'FFL_SOURCE_001', palletId: null },
        }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(1),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'box-target',
          code: 'FFL_TARGET_001',
          palletId: null,
          status: 'active',
        }),
        update: vi.fn(),
      },
      stockBalance: {
        findFirst: vi.fn().mockResolvedValue({ id: 'balance-source', quantity: 2 }),
        update: vi.fn().mockResolvedValue({ quantity: 1 }),
        delete: vi.fn(),
        upsert: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(1),
      },
      stockMovement: {
        create: vi.fn()
          .mockResolvedValueOnce({ id: 'movement-out' })
          .mockResolvedValueOnce({ id: 'movement-in' }),
      },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const inventoryLock = { assertStockMovementsAllowed: vi.fn().mockResolvedValue(undefined) };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never, inventoryLock as never);

    const result = await (service as any).moveExistingFbsKizToOpenedBox(
      task,
      'mark-1',
      'box-source',
      'KIZ-1',
      { id: 'user-1' },
    );

    expect(inventoryLock.assertStockMovementsAllowed).toHaveBeenCalled();
    expect(tx.stockBalance.update).toHaveBeenCalledWith({
      where: { id: 'balance-source' },
      data: { quantity: { decrement: 1 } },
    });
    expect(tx.stockBalance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ boxId: 'box-target', skuId: 'sku-1', quantity: 1 }),
      update: { quantity: { increment: 1 } },
    }));
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(2);
    expect(tx.productMark.update).toHaveBeenCalledWith({
      where: { id: 'mark-1' },
      data: { boxId: 'box-target', stockMovementId: 'movement-in' },
    });
    expect(tx.clientRequestEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: 'request-1',
        title: 'КИЗ перемещён при сборке FBS',
      }),
    });
    expect(result).toEqual({ task: updatedTask, mode: 'MOVED' });
  });

  it('relinks an orphan KIZ to a free unmarked unit in the opened box without changing quantities', async () => {
    const task = {
      id: 'task-1', clientId: 'client-1', orderId: '1001', requestId: 'request-1', skuId: 'sku-1',
      boxId: 'box-target', boxCode: 'FFL_LKB0106_039', workerName: 'Сборщик', deviceCode: 'TSD-1',
    };
    const updatedTask = { ...task, kiz: 'KIZ-ORPHAN', wbMetaStatus: 'ACCEPTED' };
    const tx = {
      fbsTsdAssembly: {
        findUnique: vi.fn().mockResolvedValue(task),
        update: vi.fn().mockResolvedValue(updatedTask),
      },
      productMark: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'mark-1', clientId: 'client-1', skuId: 'sku-1', boxId: 'box-source', status: 'AVAILABLE',
          box: { id: 'box-source', code: 'FFL_LKB1007_304', palletId: null },
        }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(9),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'box-target', code: 'FFL_LKB0106_039', palletId: null, status: 'active',
        }),
        update: vi.fn(),
      },
      stockBalance: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'target-balance', quantity: 2 }),
        update: vi.fn(),
        delete: vi.fn(),
        upsert: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      stockMovement: { create: vi.fn() },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const inventoryLock = { assertStockMovementsAllowed: vi.fn().mockResolvedValue(undefined) };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never, inventoryLock as never);

    const result = await (service as any).moveExistingFbsKizToOpenedBox(
      task, 'mark-1', 'box-source', 'KIZ-ORPHAN', { id: 'user-1' },
    );

    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.stockBalance.delete).not.toHaveBeenCalled();
    expect(tx.stockBalance.upsert).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.productMark.update).toHaveBeenCalledWith({
      where: { id: 'mark-1' },
      data: expect.objectContaining({
        boxId: 'box-target',
        stockMovementId: null,
        sourceDocument: expect.stringContaining('без изменения количества'),
      }),
    });
    expect(tx.clientRequestEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'КИЗ перепривязан при сборке FBS',
        body: expect.stringContaining('без изменения количества'),
      }),
    });
    expect(result).toEqual({ task: updatedTask, mode: 'RELINKED' });
  });

  it('matches WB cargo QR barcodes to cargo place ids even when WB returns stickers in another order', async () => {
    const prisma = {
      clientMarketplaceConnection: { findFirst: vi.fn().mockResolvedValue({ apiKey: 'secret-key' }) },
      fbsSupplyPlan: { update: vi.fn().mockResolvedValue({}) },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          stickers: [
            { barcode: '$WBMP:1:4119610:46511279', file: 'second' },
            { barcode: '$WBMP:1:4119610:46511278', file: 'first' },
          ],
        }),
      } as Response)),
    );
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const plan = {
      id: 'plan-1',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      supplyId: 'WB-GI-1',
      cargoPlaceIds: ['WB-MP-46511278', 'WB-MP-46511279'],
      cargoPlaceBarcodes: null,
    };

    const mapping = await (service as any).syncFbsCargoPlaceBarcodes(plan);

    expect(mapping).toEqual({
      'WB-MP-46511278': '$WBMP:1:4119610:46511278',
      'WB-MP-46511279': '$WBMP:1:4119610:46511279',
    });
    expect(prisma.fbsSupplyPlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: { cargoPlaceBarcodes: mapping },
    });
  });

  it('packs a completed FBS order into an open cargo place and records the operator', async () => {
    const packing = {
      id: 'packing-1',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      supplyId: 'WB-GI-1',
      cargoPlaceId: 'WB-MP-1',
      capacityItems: 14,
      deviceCode: 'TSD-1',
      status: 'OPEN',
    };
    const task = {
      id: 'task-1',
      orderId: '5355000001',
      stickerBarcode: '!order-barcode',
      stickerPartB: '1234',
      itemCount: 1,
      cargoPackingId: null,
    };
    const prisma = {
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([task]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { itemCount: 13 } }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsCargoPacking').mockResolvedValue(packing);
    vi.spyOn(service as any, 'buildFbsCargoPackingResponse').mockResolvedValue({ state: 'SCAN_ORDER' });

    await service.scanFbsCargoOrder(
      'packing-1',
      { orderCode: '!order-barcode' },
      { id: 'user-1', name: 'Сборщик' } as never,
    );

    expect(prisma.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-1', cargoPackingId: null },
      data: expect.objectContaining({
        cargoPackingId: 'packing-1',
        cargoPackedByUserId: 'user-1',
        cargoPackedByName: 'Сборщик',
      }),
    });
  });

  it('does not allow a cargo place to exceed its configured 14-item capacity', async () => {
    const prisma = {
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([{ id: 'task-1', orderId: '5355000001', itemCount: 1, cargoPackingId: null }]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { itemCount: 14 } }),
        updateMany: vi.fn(),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsCargoPacking').mockResolvedValue({
      id: 'packing-1',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      supplyId: 'WB-GI-1',
      cargoPlaceId: 'WB-MP-1',
      capacityItems: 14,
      deviceCode: 'TSD-1',
      status: 'OPEN',
    });

    await expect(
      service.scanFbsCargoOrder('packing-1', { orderCode: '5355000001' }, { id: 'user-1' } as never),
    ).rejects.toThrow('Грузоместо заполнено: 14 из 14');
    expect(prisma.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  });

  it('changes an active FBS supply from pickup point to sorting center without cancelling assembled orders', async () => {
    const orders = [
      {
        id: '5355000001',
        connectionId: 'connection-1',
        marketplace: MarketplaceType.WILDBERRIES,
        supplierStatus: 'confirm',
        supplyId: 'WB-GI-1',
      },
      {
        id: '5355000002',
        connectionId: 'connection-1',
        marketplace: MarketplaceType.WILDBERRIES,
        supplierStatus: 'confirm',
        supplyId: 'WB-GI-1',
      },
    ];
    const prisma: any = {
      fbsSupplyPlan: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'plan-1',
          clientId: 'client-1',
          deliveryDestination: FbsDeliveryDestination.PICKUP_POINT,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([{ requestId: 'request-1' }]),
      },
      fbsTsdAssembly: {
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      fbsCargoPlacePacking: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      clientRequestEvent: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction = vi.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    vi.spyOn(service as any, 'resolveSelectedFbsOrders').mockResolvedValue({
      response: { orders },
      orders,
    });
    vi.spyOn(service as any, 'loadSelectedConnections').mockResolvedValue([
      { id: 'connection-1', apiKey: 'wb-secret' },
    ]);
    vi.spyOn(service as any, 'refreshFbsOrdersCache').mockResolvedValue({ orders: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ trbxes: [{ id: 'WB-TRBX-1' }, { id: 'WB-TRBX-2' }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
          json: async () => ({}),
        }),
    );

    const result = await service.changeFbsSuppliesDestination(
      {
        clientId: 'client-1',
        deliveryDestination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
        orders: orders.map((order) => ({ connectionId: order.connectionId, id: order.id })),
      },
      { id: 'user-1', name: 'Администратор' } as never,
    );

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://marketplace-api.wildberries.ru/api/v3/supplies/WB-GI-1/trbx',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://marketplace-api.wildberries.ru/api/v3/supplies/WB-GI-1/trbx',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ trbxIds: ['WB-TRBX-1', 'WB-TRBX-2'] }),
      }),
    );
    expect(prisma.fbsTsdAssembly.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cargoPackingId: null }),
    }));
    expect(prisma.fbsCargoPlacePacking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
    expect(prisma.fbsSupplyPlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: {
        deliveryDestination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
        cargoPlaceCount: 0,
        cargoPlaceIds: [],
        cargoPlaceBarcodes: {},
      },
    });
    expect(result).toMatchObject({
      changed: 1,
      removedCargoPlaces: 2,
      detachedOrders: 2,
      cancelledPackings: 1,
      failed: [],
    });
  });

  it('calculates how many units and unique product positions will be taken from a scanned FBS box', async () => {
    const prisma = {
      clientRequestItem: {
        findMany: vi.fn().mockResolvedValue([
          { skuId: 'sku-1', quantity: 5, boxSelections: [{ quantity: 2 }] },
          { skuId: 'sku-2', quantity: 4, boxSelections: [] },
          { skuId: 'sku-3', quantity: 1, boxSelections: [] },
        ]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { skuId: 'sku-1', quantity: 10 },
          { skuId: 'sku-2', quantity: 2 },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    const result = await (service as any).fbsTsdSourceBoxUsage({
      requestId: 'request-1',
      clientId: 'client-1',
      boxId: 'box-1',
      boxCode: 'FFL_TEST_001',
    });

    expect(result).toEqual({
      boxCode: 'FFL_TEST_001',
      units: 5,
      positions: 2,
    });
  });

  it('removes an unstarted cancelled FBS order from the linked WMS request and cancels an empty request', async () => {
    const link = fbsRequestLink({
      orderId: '5355000001',
      lastCategory: 'active',
      lastSupplierStatus: 'confirm',
    });
    const request = fbsLinkedRequest({
      links: [link],
      items: [
        {
          id: 'item-1',
          skuId: 'sku-1',
          barcode: '460000000001',
          name: 'Костюм',
          quantity: 1,
          comment: 'FBS-заказы: 5355000001',
          packageItems: [],
          boxSelections: [],
        },
      ],
    });
    const tx: any = {
      clientRequest: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'request-1', status: ClientRequestStatus.SUBMITTED })
          .mockResolvedValueOnce(request),
        update: vi.fn().mockResolvedValue({}),
      },
      fbsOrderRequestLink: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn(),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
      clientRequestItem: {
        update: vi.fn(),
        create: vi.fn(),
        delete: vi.fn().mockResolvedValue({}),
      },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
      clientNotification: { create: vi.fn() },
    };
    const prisma: any = {
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([link]),
      },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await (service as any).syncFbsRequestsFromMarketplace('client-1', [
      fbsOrder({
        id: '5355000001',
        category: 'cancelled',
        supplierStatus: 'cancel',
        wbStatus: 'canceled_by_client',
        statusLabel: 'Отменён покупателем',
      }),
    ]);

    expect(tx.fbsOrderRequestLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'link-5355000001' },
        data: expect.objectContaining({ syncStatus: 'REMOVED' }),
      }),
    );
    expect(tx.clientRequestItem.delete).toHaveBeenCalledWith({ where: { id: 'item-1' } });
    expect(tx.clientRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'request-1' },
        data: expect.objectContaining({
          status: ClientRequestStatus.CANCELLED,
          title: 'FBS — 0 заказ(а/ов)',
        }),
      }),
    );
    expect(tx.clientNotification.create).not.toHaveBeenCalled();
  });

  it('keeps a physically collected cancelled FBS order and marks it for a manager decision', async () => {
    const link = fbsRequestLink({
      orderId: '5355000001',
      lastCategory: 'active',
      lastSupplierStatus: 'confirm',
    });
    const request = fbsLinkedRequest({
      links: [link],
      items: [
        {
          id: 'item-1',
          skuId: 'sku-1',
          barcode: '460000000001',
          name: 'Костюм',
          quantity: 1,
          comment: 'FBS-заказы: 5355000001',
          packageItems: [],
          boxSelections: [{ id: 'selection-1', quantity: 1 }],
        },
      ],
    });
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      orderId: '5355000001',
      requestItemId: 'item-1',
      skuId: 'sku-1',
      productName: 'Костюм',
      itemCount: 1,
      barcodes: ['460000000001'],
      storageBoxes: [],
      status: 'COMPLETED',
      boxId: 'box-1',
      boxCode: 'FFL_TEST_001',
      barcode: '460000000001',
      kiz: '010460000000001221SERIAL',
      stickerPartA: 'A',
      stickerPartB: '1234',
      stickerBarcode: 'WB-ORDER-1',
      cargoPackingId: null,
      completedAt: new Date(),
    };
    const tx: any = {
      clientRequest: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'request-1', status: ClientRequestStatus.IN_WORK })
          .mockResolvedValueOnce({ ...request, status: ClientRequestStatus.IN_WORK }),
        update: vi.fn(),
      },
      fbsOrderRequestLink: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn(),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([task]),
        update: vi.fn().mockResolvedValue({}),
      },
      clientRequestItem: {
        update: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
      clientNotification: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([{ ...link, request: { ...link.request, status: ClientRequestStatus.IN_WORK } }]),
      },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await (service as any).syncFbsRequestsFromMarketplace('client-1', [
      fbsOrder({
        id: '5355000001',
        category: 'cancelled',
        supplierStatus: 'cancel',
        wbStatus: 'canceled_by_client',
        statusLabel: 'Отменён покупателем',
      }),
    ]);

    expect(tx.fbsTsdAssembly.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({ status: 'RETURN_REQUIRED' }),
      }),
    );
    expect(tx.fbsOrderRequestLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ syncStatus: 'RETURN_REQUIRED' }),
      }),
    );
    expect(tx.clientRequestItem.delete).not.toHaveBeenCalled();
    expect(tx.clientNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ severity: 'WARNING' }),
      }),
    );
  });

  it('adds a new active order from the same FBS supply to the existing WMS request', async () => {
    const existingLink = fbsRequestLink({
      orderId: '5355000001',
      lastCategory: 'active',
      lastSupplierStatus: 'confirm',
    });
    const addedLink = {
      ...fbsRequestLink({
        orderId: '5355000002',
        lastCategory: null,
        lastSupplierStatus: null,
      }),
      id: 'link-5355000002',
    };
    const request = fbsLinkedRequest({
      links: [existingLink, addedLink],
      items: [
        {
          id: 'item-1',
          skuId: 'sku-1',
          barcode: '460000000001',
          name: 'Костюм',
          quantity: 1,
          comment: 'FBS-заказы: 5355000001',
          packageItems: [],
          boxSelections: [],
        },
      ],
    });
    const tx: any = {
      clientRequest: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'request-1', status: ClientRequestStatus.SUBMITTED })
          .mockResolvedValueOnce(request),
        update: vi.fn().mockResolvedValue({}),
      },
      fbsOrderRequestLink: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue(addedLink),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
      clientRequestItem: {
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn(),
        delete: vi.fn(),
      },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
      clientNotification: { create: vi.fn() },
    };
    const prisma: any = {
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([existingLink]),
      },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const orders = [
      fbsOrder({ id: '5355000001' }),
      fbsOrder({ id: '5355000002' }),
    ];

    await (service as any).syncFbsRequestsFromMarketplace('client-1', orders);

    expect(tx.fbsOrderRequestLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: '5355000002',
          requestId: 'request-1',
          syncStatus: 'ACTIVE',
        }),
      }),
    );
    expect(tx.clientRequestItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-1' },
        data: expect.objectContaining({
          quantity: 2,
          comment: 'FBS-заказы: 5355000001, 5355000002',
        }),
      }),
    );
  });

});

function fbsOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: '5355000001',
    orderUid: null,
    connectionId: 'connection-1',
    accountName: 'Основной кабинет',
    marketplace: MarketplaceType.WILDBERRIES,
    category: 'active',
    supplierStatus: 'confirm',
    wbStatus: 'waiting',
    statusLabel: 'На сборке',
    article: 'ART-1',
    nmId: '100',
    chrtId: '200',
    barcodes: ['460000000001'],
    itemCount: 1,
    product: {
      id: 'sku-1',
      name: 'Костюм',
      internalSku: 'SKU-1',
      clientSku: 'ART-1',
      article: 'ART-1',
      needsChestnyZnak: true,
      isUnmarked: false,
    },
    storageBoxes: [],
    createdAt: '2026-07-23T10:00:00.000Z',
    sellerDate: null,
    deliveryDate: null,
    supplyId: 'WB-GI-1',
    warehouseId: null,
    officeId: null,
    cargoType: null,
    crossBorderType: null,
    pickupPointShipmentAllowed: true,
    requiresReshipment: false,
    shipmentPlan: null,
    requiredMeta: [],
    optionalMeta: [],
    comment: null,
    request: null,
    billing: null,
    ...overrides,
  };
}

function fbsRequestLink({
  orderId,
  lastCategory,
  lastSupplierStatus,
}: {
  orderId: string;
  lastCategory: string | null;
  lastSupplierStatus: string | null;
}) {
  return {
    id: `link-${orderId}`,
    clientId: 'client-1',
    marketplace: MarketplaceType.WILDBERRIES,
    connectionId: 'connection-1',
    orderId,
    requestId: 'request-1',
    createdByUserId: 'user-1',
    syncStatus: 'ACTIVE',
    syncIssue: null,
    lastCategory,
    lastSupplierStatus,
    lastWbStatus: 'waiting',
    lastSupplyId: 'WB-GI-1',
    lastSkuId: 'sku-1',
    lastItemCount: 1,
    lastSeenAt: new Date('2026-07-23T09:00:00.000Z'),
    createdAt: new Date('2026-07-23T09:00:00.000Z'),
    updatedAt: new Date('2026-07-23T09:00:00.000Z'),
    request: {
      id: 'request-1',
      number: 31,
      status: ClientRequestStatus.SUBMITTED,
    },
  };
}

function fbsLinkedRequest({
  links,
  items,
}: {
  links: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
}) {
  return {
    id: 'request-1',
    number: 31,
    clientId: 'client-1',
    type: 'OUTBOUND',
    status: ClientRequestStatus.SUBMITTED,
    priority: 'NORMAL',
    title: `FBS — ${links.length} заказ(а/ов)`,
    comment: `Создано из FBS-заказов: ${links.map((link) => link.orderId).join(', ')}`,
    fbsOrderLinks: links,
    items,
  };
}
