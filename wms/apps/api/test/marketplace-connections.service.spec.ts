import { MarketplaceType, Prisma, VolumeSource } from '@prisma/client';
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

  it('creates an idempotent FBS processing charge when an order is shipped', async () => {
    const prisma = {
      billingService: {
        upsert: vi.fn().mockResolvedValue({
          id: 'service-fbs',
          code: 'FBS_PROCESSING',
          defaultPriceRub: new Prisma.Decimal(0),
        }),
      },
      clientBillingService: {
        findUnique: vi.fn().mockResolvedValue({
          priceRub: new Prisma.Decimal(75),
          isActive: true,
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
        createdAt: '2026-07-19T10:00:00Z',
        supplyId: 'WB-GI-1',
      },
    ]);

    expect(prisma.billingCharge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          serviceId: 'service-fbs',
          sourceKey: 'fbs:wildberries:connection-1:1001',
          unitPriceRub: 75,
          totalRub: 75,
          metadata: expect.objectContaining({
            kind: 'FBS',
            orderId: '1001',
          }),
        }),
      }),
    );
    expect(result.get('WILDBERRIES:connection-1:1001')).toMatchObject({
      chargeId: 'charge-1',
      totalRub: 75,
      invoiceNumber: null,
    });
  });
});
