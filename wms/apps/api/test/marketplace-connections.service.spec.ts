import { FbsDeliveryDestination, MarketplaceType, Prisma, VolumeSource } from '@prisma/client';
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
          sourceKey: 'fbs:wildberries:connection-1:1001',
          unitPriceRub: 715,
          totalRub: 715,
          metadata: expect.objectContaining({
            kind: 'FBS',
            pricingVersion: 3,
            orderId: '1001',
            palletsIncluded: false,
            breakdown: expect.objectContaining({
              fbsProcessingRub: 75,
              deliveryRub: 500,
              boxFormationRub: 40,
              boxMaterialRub: 100,
            }),
          }),
        }),
      }),
    );
    expect(result.get('WILDBERRIES:connection-1:1001')).toMatchObject({
      chargeId: 'charge-1',
      totalRub: 715,
      invoiceNumber: null,
      breakdown: expect.objectContaining({
        deliveryRub: 500,
        boxCount: 1,
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
    expect(batchCharges).toHaveLength(6);
    expect(
      batchCharges.reduce(
        (sum, charge) => sum + Number(charge.metadata.breakdown.deliveryRub),
        0,
      ),
    ).toBe(750);
    expect(batchCharges.reduce((sum, charge) => sum + Number(charge.totalRub), 0)).toBe(1340);

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
          totalRub: 3105,
          metadata: expect.objectContaining({
            palletsIncluded: true,
            palletRules: {
              enabled: true,
              boxesPerPallet: 2,
              serviceId: 'service-pallet',
            },
            breakdown: expect.objectContaining({
              boxCount: 2,
              palletCount: 1,
              palletRub: 300,
            }),
          }),
        }),
      }),
    );
    expect(palletResult.get('WILDBERRIES:connection-1:3001')).toMatchObject({
      totalRub: 3105,
      breakdown: expect.objectContaining({
        palletCount: 1,
        palletRub: 300,
      }),
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

});
