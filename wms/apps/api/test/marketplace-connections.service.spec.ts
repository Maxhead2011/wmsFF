import {
  ClientRequestStatus,
  ClientRequestType,
  FbsDeliveryDestination,
  BillingPriceTaxMode,
  MarketplaceType,
  MovementType,
  Prisma,
  StockStatus,
  VolumeSource,
} from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FBS_UNLIMITED_CARGO_PLACE_CAPACITY } from '../src/modules/marketplace-connections/fbs.constants';
import {
  formatMarketplaceHttpError,
  MarketplaceConnectionsService,
} from '../src/modules/marketplace-connections/marketplace-connections.service';

describe('MarketplaceConnectionsService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('расшифровывает конфликт WB 409 вместе с кодом и проблемным заказом', () => {
    const message = formatMarketplaceHttpError(
      'https://marketplace-api.wildberries.ru/api/marketplace/v3/supplies/WB-1/orders',
      409,
      {
        code: 'MetaValidationFail',
        message: 'Ошибка добавления сборочного задания к поставке',
        metaDetails: [{ orderId: 5426435634, error: 'invalid status' }],
        requestId: 'req-409',
      },
    );

    expect(message).toContain('Wildberries вернул HTTP 409 (MetaValidationFail)');
    expect(message).toContain('5426435634');
    expect(message).toContain('invalid status');
    expect(message).toContain('req-409');
  });

  // TEST: the full WB history may exceed PostgreSQL's 32,767 bind-variable limit.
  it('loads FBS request links in bounded batches without losing orders', async () => {
    const findMany = vi.fn(async (args: { where: { orderId: { in: string[] } } }) =>
      args.where.orderId.in.map((orderId) => ({
        connectionId: 'connection-1',
        orderId,
        request: { id: `request-${orderId}` },
      })),
    );
    const service = new MarketplaceConnectionsService(
      { fbsOrderRequestLink: { findMany } } as never,
      {} as never,
    );
    const orders = Array.from({ length: 32_768 }, (_, index) => ({
      connectionId: 'connection-1',
      id: String(index + 1),
    }));

    const links = await (service as any).loadActiveFbsOrderRequestLinks(
      'client-1',
      orders,
    );

    expect(findMany).toHaveBeenCalledTimes(7);
    expect(
      findMany.mock.calls.every(([args]) => args.where.orderId.in.length <= 5_000),
    ).toBe(true);
    expect(findMany.mock.calls.flatMap(([args]) => args.where.orderId.in)).toHaveLength(32_768);
    expect(links).toHaveLength(32_768);
  });

  it('защищает расчёт FBS от старых коробов и заявок без филиала, относя их только к Москве', async () => {
    const stockFindMany = vi.fn().mockResolvedValue([
      { skuId: 'sku-1', quantity: 100, box: { status: 'active' } },
    ]);
    const requestItemFindMany = vi.fn().mockResolvedValue([
      { skuId: 'sku-1', quantity: 80 },
    ]);
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ storesWithoutBoxes: false }),
      },
      warehouse: {
        findUnique: vi.fn().mockResolvedValue({ id: 'warehouse-moscow' }),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'sku-1', marketplaceProductId: '100500:200600' },
        ]),
      },
      stockBalance: { findMany: stockFindMany },
      clientRequestItem: { findMany: requestItemFindMany },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadFbsOrders').mockResolvedValue({ orders: [] });

    const moscow = await service.calculateFbsStockQuantities(
      'client-1',
      ['sku-1'],
      'warehouse-moscow',
    );

    expect(moscow.get('sku-1')).toMatchObject({
      available: 100,
      reserved: 80,
      sellable: 20,
    });
    expect(stockFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          box: expect.objectContaining({
            OR: [
              { warehouseId: 'warehouse-moscow' },
              { warehouseId: null },
            ],
          }),
        }),
      }),
    );
    expect(requestItemFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          request: expect.objectContaining({
            AND: expect.arrayContaining([
              {
                OR: [
                  { warehouseId: 'warehouse-moscow' },
                  { warehouseId: null },
                ],
              },
            ]),
          }),
        }),
      }),
    );

    await service.calculateFbsStockQuantities(
      'client-1',
      ['sku-1'],
      'warehouse-krasnodar',
    );
    expect(stockFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          box: expect.objectContaining({ warehouseId: 'warehouse-krasnodar' }),
        }),
      }),
    );
    expect(requestItemFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          request: expect.objectContaining({
            AND: expect.arrayContaining([{ warehouseId: 'warehouse-krasnodar' }]),
          }),
        }),
      }),
    );
  });

  it('creates a separate FBS primary-processing invoice from client services', async () => {
    let chargeIndex = 0;
    const billingInvoiceCreate = vi.fn().mockImplementation(async ({ data }) => ({
      id: 'primary-invoice-1',
      number: data.number,
      status: data.status,
    }));
    const prisma = {
      billingInvoice: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: billingInvoiceCreate,
      },
      billingCharge: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(async ({ data }) => ({
          id: `primary-charge-${++chargeIndex}`,
          ...data,
        })),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await (service as any).ensureFbsPrimaryProcessingInvoice({
      clientId: 'client-1',
      shipmentKey: 'WILDBERRIES:connection-1:supply:WB-GI-1',
      shipmentOrders: [
        {
          id: '1001',
          marketplace: MarketplaceType.WILDBERRIES,
          connectionId: 'connection-1',
          supplyId: 'WB-GI-1',
        },
      ],
      shipmentItems: 2,
      serviceDate: new Date('2026-07-28T10:00:00.000Z'),
      requestId: 'request-1',
      services: [
        {
          id: 'client-service-receipt',
          clientId: 'client-1',
          serviceId: 'service-receipt',
          priceRub: new Prisma.Decimal(10),
          taxMode: BillingPriceTaxMode.INCLUDED,
          isActive: true,
          service: {
            id: 'service-receipt',
            code: 'RECEIPT_ITEM',
            name: 'Приёмка товара',
            unit: 'PIECE',
            isActive: true,
          },
        },
        {
          id: 'client-service-sorting',
          clientId: 'client-1',
          serviceId: 'service-sorting',
          priceRub: new Prisma.Decimal(94),
          taxMode: BillingPriceTaxMode.ADD_6_PERCENT,
          isActive: true,
          service: {
            id: 'service-sorting',
            code: 'SORTING_ITEM',
            name: 'Сортировка товара',
            unit: 'PIECE',
            isActive: true,
          },
        },
      ],
    });

    expect(billingInvoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          requestId: 'request-1',
          sourceKey:
            'fbs-primary-invoice:client-1:WILDBERRIES:connection-1:supply:WB-GI-1',
          totalRub: 220,
          items: {
            create: [
              expect.objectContaining({
                description: 'Первичная обработка FBS: Приёмка товара',
                quantity: 2,
                unitPriceRub: 10,
                totalRub: 20,
              }),
              expect.objectContaining({
                description: 'Первичная обработка FBS: Сортировка товара',
                quantity: 2,
                unitPriceRub: 100,
                totalRub: 200,
              }),
            ],
          },
        }),
        select: { id: true, number: true, status: true },
      }),
    );
  });

  it('records a duplicate FBS KIZ scan for both affected online requests', async () => {
    const auditCreate = vi.fn().mockImplementation(({ data }) => Promise.resolve(data));
    const prisma = {
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'request-new', number: 44, title: 'Новая заявка' },
          { id: 'request-old', number: 43, title: 'Предыдущая заявка' },
        ]),
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue({
          createdAt: new Date('2026-07-27T10:00:00.000Z'),
          payload: { scannedAt: '2026-07-27T09:59:30.000Z' },
        }),
        create: auditCreate,
      },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await (service as any).recordDuplicateFbsKizScan(
      {
        id: 'assembly-new',
        clientId: 'client-1',
        requestId: 'request-new',
        orderId: '5370000002',
        boxCode: 'FFL_NEW_001',
        deviceCode: 'TSD-02',
        workerName: 'Сборщик 2',
      },
      '010460000000000021ABC123',
      {
        id: 'assembly-old',
        requestId: 'request-old',
        orderId: '5370000001',
        status: 'COMPLETED',
        boxCode: 'FFL_OLD_001',
        deviceCode: 'TSD-01',
        workerName: 'Сборщик 1',
        completedAt: new Date('2026-07-27T10:05:00.000Z'),
        createdAt: new Date('2026-07-27T09:55:00.000Z'),
        updatedAt: new Date('2026-07-27T10:05:00.000Z'),
      },
      { id: 'admin-1', name: 'Администратор' },
    );

    expect(auditCreate).toHaveBeenCalledTimes(2);
    expect(auditCreate.mock.calls.map(([call]) => call.data.entityId).sort()).toEqual([
      'request-new',
      'request-old',
    ]);
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      action: 'FBS_KIZ_DUPLICATE_SCAN',
      entity: 'ClientRequest',
      payload: {
        attempt: {
          requestNumber: 44,
          orderId: '5370000002',
          boxCode: 'FFL_NEW_001',
          deviceCode: 'TSD-02',
        },
        existing: {
          requestNumber: 43,
          orderId: '5370000001',
          boxCode: 'FFL_OLD_001',
          deviceCode: 'TSD-01',
          scannedAt: '2026-07-27T09:59:30.000Z',
        },
      },
    });
  });

  it('reconciles relabel stock, open reservations and WB shipment facts without changing balances', async () => {
    const sentRequest = {
      id: 'request-done',
      number: 38,
      title: 'FBS заявка',
      status: ClientRequestStatus.DONE,
      updatedAt: new Date('2026-07-26T20:00:00.000Z'),
      events: [{ createdAt: new Date('2026-07-26T20:00:00.000Z') }],
      fbsOrderLinks: [{
        connectionId: 'connection-1',
        orderId: '5372479758',
        lastSupplyId: null,
        lastSupplierStatus: 'complete',
        lastWbStatus: 'waiting',
      }],
    };
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'client-1',
          code: 'LUKIN',
          name: 'ИП Лукин',
          storesWithoutBoxes: false,
        }),
      },
      clientArticleMapping: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'mapping-1',
          clientId: 'client-1',
          sourceArticle: 'Корея_2черный',
          targetArticle: 'новый_корея_2черный',
        }]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sku-source',
            internalSku: 'Корея_2черный-XL / 48',
            clientSku: 'Корея_2черный',
            article: 'Корея_2черный',
            name: 'Костюм исходный',
            color: 'черный',
            size: 'XL / 48',
            barcodes: [{ value: '2049156013708', isPrimary: true }],
            balances: [{
              id: 'balance-source',
              boxId: 'box-1',
              palletId: null,
              status: StockStatus.AVAILABLE,
              quantity: 13,
              box: { code: 'FFL_LKB1705_101' },
            }],
          },
          {
            id: 'sku-target',
            internalSku: 'новый_корея_2черный-XL / 48',
            clientSku: 'новый_корея_2черный',
            article: 'новый_корея_2черный',
            name: 'Костюм после переклейки',
            color: 'черный',
            size: 'XL / 48',
            barcodes: [{ value: '2051369340502', isPrimary: true }],
            balances: [],
          },
        ]),
      },
      clientRequest: {
        findMany: vi.fn()
          .mockResolvedValueOnce([sentRequest])
          .mockResolvedValueOnce([
            { id: 'request-done', number: 38, title: 'FBS заявка', status: ClientRequestStatus.DONE },
            { id: 'request-open', number: 50, title: 'Новая FBS заявка', status: ClientRequestStatus.IN_WORK },
          ]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'assembly-missing',
            connectionId: 'connection-1',
            orderId: '5372479758',
            supplyId: 'WB-GI-258219980',
            requestId: 'request-done',
            requestItemId: 'item-1',
            skuId: 'sku-target',
            sourceSkuId: 'sku-source',
            productName: 'Костюм после переклейки',
            article: 'новый_корея_2черный',
            sourceProductName: 'Костюм исходный',
            sourceArticle: 'Корея_2черный',
            itemCount: 1,
            status: 'COMPLETED',
            boxId: 'box-1',
            boxCode: 'FFL_LKB1705_101',
            sourceBarcode: '2049156013708',
            barcode: null,
            relabelRequired: true,
            relabelConfirmedAt: null,
            completedAt: new Date('2026-07-26T19:00:00.000Z'),
            updatedAt: new Date('2026-07-26T19:00:00.000Z'),
          },
          {
            id: 'assembly-reserved',
            connectionId: 'connection-1',
            orderId: '5384847250',
            supplyId: 'WB-GI-259096034',
            requestId: 'request-open',
            requestItemId: 'item-2',
            skuId: 'sku-source',
            sourceSkuId: null,
            productName: 'Костюм исходный',
            article: 'Корея_2черный',
            sourceProductName: null,
            sourceArticle: null,
            itemCount: 1,
            status: 'COMPLETED',
            boxId: 'box-1',
            boxCode: 'FFL_LKB1705_101',
            sourceBarcode: null,
            barcode: '2049156013708',
            relabelRequired: false,
            relabelConfirmedAt: null,
            completedAt: new Date('2026-07-27T17:00:00.000Z'),
            updatedAt: new Date('2026-07-27T17:00:00.000Z'),
          },
        ]),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    vi.spyOn(service, 'listFbsOrders').mockResolvedValue({
      client: { id: 'client-1', code: 'LUKIN', name: 'ИП Лукин' },
      connected: true,
      connections: [],
      fetchedAt: '2026-07-27T18:00:00.000Z',
      deliveryPlan: {
        destination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
        itemsPerCargoPlace: 14,
        requiresCargoPlaces: false,
      },
      counts: { active: 2, shipped: 1, cancelled: 0, archive: 0, all: 3 },
      orders: [
        {
          id: '5372479758',
          connectionId: 'connection-1',
          category: 'shipped',
          supplierStatus: 'complete',
          wbStatus: 'waiting',
          supplyId: 'WB-GI-258219980',
          itemCount: 1,
          product: {
            id: 'sku-target',
            name: 'Костюм после переклейки',
            internalSku: 'новый_корея_2черный-XL / 48',
            clientSku: 'новый_корея_2черный',
            article: 'новый_корея_2черный',
            size: 'XL / 48',
          },
          request: {
            id: 'request-done',
            number: 38,
            title: 'FBS заявка',
            status: ClientRequestStatus.DONE,
          },
        },
        {
          id: '5384847250',
          connectionId: 'connection-1',
          category: 'active',
          supplierStatus: 'confirm',
          wbStatus: 'waiting',
          supplyId: 'WB-GI-259096034',
          itemCount: 1,
          product: {
            id: 'sku-source',
            name: 'Костюм исходный',
            internalSku: 'Корея_2черный-XL / 48',
            clientSku: 'Корея_2черный',
            article: 'Корея_2черный',
            size: 'XL / 48',
          },
          request: {
            id: 'request-open',
            number: 50,
            title: 'Новая FBS заявка',
            status: ClientRequestStatus.IN_WORK,
          },
        },
        {
          id: '5384963757',
          connectionId: 'connection-1',
          category: 'active',
          supplierStatus: 'confirm',
          wbStatus: 'waiting',
          supplyId: 'WB-GI-259096034',
          itemCount: 1,
          product: {
            id: 'sku-source',
            name: 'Костюм исходный',
            internalSku: 'Корея_2черный-XL / 48',
            clientSku: 'Корея_2черный',
            article: 'Корея_2черный',
            size: 'XL / 48',
          },
          request: {
            id: 'request-open',
            number: 50,
            title: 'Новая FBS заявка',
            status: ClientRequestStatus.IN_WORK,
          },
        },
      ],
    } as never);

    const report = await service.listFbsRelabelReconciliation(
      'client-1',
      '2026-07-20',
      '2026-07-27',
      '2049156013708',
      { id: 'admin-1' } as never,
      true,
    );

    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-1' }),
      'client-1',
      'read',
    );
    expect(report.totals.stockUnits).toBe(13);
    expect(report.totals.reservedUnits).toBe(2);
    expect(report.totals.assembledReservedUnits).toBe(1);
    expect(report.totals.pendingReservedUnits).toBe(1);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'missing-relabel:assembly-missing',
        kind: 'MISSING_RELABEL',
        correctable: true,
      }),
    ]));
    expect(prisma.stockMovement.findMany).toHaveBeenCalledTimes(1);
  });

  it('checks Wildberries access to product cards, FBS orders and warehouses independently', async () => {
    const connection = {
      id: 'connection-1',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      accountName: 'Основной кабинет',
      sellerId: null,
      apiKey: 'secret-api-key',
      isActive: true,
      comment: null,
      createdAt: new Date('2026-07-27T10:00:00.000Z'),
      updatedAt: new Date('2026-07-27T10:00:00.000Z'),
      client: { id: 'client-1', code: 'CLIENT-1', name: 'Клиент' },
    };
    const prisma = {
      clientMarketplaceConnection: {
        findUnique: vi.fn().mockResolvedValue(connection),
      },
    };
    const clientScopes = {
      requireClientAccess: vi.fn(),
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      const payload = url.includes('/content/v2/get/cards/list')
        ? { cards: [{ nmID: 1 }] }
        : url.endsWith('/api/v3/orders/new')
          ? { orders: [{ id: 1 }] }
          : [{ id: 10, name: 'Основной склад' }];
      return {
        ok: true,
        status: 200,
        json: async () => payload,
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);

    const result = await service.checkConnection('connection-1', {} as never);

    expect(result).toMatchObject({
      connectionId: 'connection-1',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      ok: true,
      checks: [
        { key: 'products', ok: true },
        { key: 'fbsOrders', ok: true },
        { key: 'warehouses', ok: true },
      ],
    });
    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(expect.anything(), 'client-1', 'write');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('checks Ozon access through current product, FBS posting and warehouse APIs', async () => {
    const connection = {
      id: 'ozon-connection-1',
      clientId: 'client-1',
      marketplace: MarketplaceType.OZON,
      accountName: 'Ozon FBS',
      sellerId: '123456',
      apiKey: 'ozon-api-key',
      isActive: true,
      comment: null,
      createdAt: new Date('2026-08-03T08:00:00.000Z'),
      updatedAt: new Date('2026-08-03T08:00:00.000Z'),
      client: { id: 'client-1', code: 'CLIENT-1', name: 'Client' },
    };
    const prisma = {
      clientMarketplaceConnection: {
        findUnique: vi.fn().mockResolvedValue(connection),
      },
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      const payload = url.includes('/v3/product/list')
        ? { result: { items: [{ product_id: 1 }] } }
        : url.includes('/v4/posting/fbs/list')
          ? { postings: [{ posting_number: '100-1' }], has_next: false, cursor: '' }
          : { warehouses: [{ warehouse_id: 10, name: 'Moscow FBS' }], has_next: false, cursor: '' };
      return {
        ok: true,
        status: 200,
        json: async () => payload,
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);

    const result = await service.checkConnection('ozon-connection-1', {} as never);

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual([
      expect.objectContaining({ key: 'products', ok: true }),
      expect.objectContaining({ key: 'fbsOrders', ok: true }),
      expect.objectContaining({ key: 'warehouses', ok: true }),
    ]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api-seller.ozon.ru/v3/product/list',
      'https://api-seller.ozon.ru/v4/posting/fbs/list',
      'https://api-seller.ozon.ru/v2/warehouse/list',
    ]);
    const postingRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(postingRequest).toMatchObject({ limit: 1, sort_dir: 'DESC', translit: false });
    expect(postingRequest).not.toHaveProperty('offset');
    const warehouseRequest = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(warehouseRequest).toEqual({ limit: 100 });
  });

  it('loads all Ozon FBS posting pages through the v4 cursor', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const secondPage = request.cursor === 'next-page';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          postings: [
            {
              posting_number: secondPage ? '100-2' : '100-1',
              order_id: secondPage ? 1002 : 1001,
              status: secondPage ? 'awaiting_deliver' : 'awaiting_packaging',
              products: [{ offer_id: secondPage ? 'OFFER-2' : 'OFFER-1', sku: secondPage ? 502 : 501, quantity: 1 }],
              analytics_data: { warehouse_id: 10, warehouse_name: 'Moscow FBS' },
              shipment_date: '2026-08-03T12:00:00Z',
            },
          ],
          has_next: !secondPage,
          cursor: secondPage ? '' : 'next-page',
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new MarketplaceConnectionsService({} as never, {} as never);

    const orders = await (service as any).fetchOzonFbsOrders({
      id: 'ozon-connection-1',
      marketplace: MarketplaceType.OZON,
      accountName: 'Ozon FBS',
      sellerId: '123456',
      apiKey: 'ozon-api-key',
    });

    expect(orders.map((order: { id: string }) => order.id)).toEqual(['100-1', '100-2']);
    expect(orders[0]).toMatchObject({
      marketplace: MarketplaceType.OZON,
      supplierStatus: 'awaiting_packaging',
      warehouseId: '10',
      warehouseName: 'Moscow FBS',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ limit: 100 });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty('cursor');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ cursor: 'next-page' });
  });

  it('submits a physically assembled Ozon posting through the current v4 ship API', async () => {
    const prisma = {
      clientMarketplaceConnection: {
        findFirst: vi.fn().mockResolvedValue({ sellerId: '123456', apiKey: 'ozon-api-key' }),
      },
      fbsTsdAssembly: {
        update: vi.fn().mockImplementation(({ data }) => ({ id: 'task-ozon', ...data })),
        updateMany: vi.fn(),
      },
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const payload = url.endsWith('/v3/posting/fbs/get')
        ? {
            result: {
              posting_number: '59639100-0681-1',
              status: 'awaiting_packaging',
              products: [{ sku: 4717802605, offer_id: '4673735179486', quantity: 1 }],
              requirements: { products_requiring_mandatory_mark: [] },
            },
          }
        : { result: [{ posting_number: '59639100-0681-1', result: true }] };
      return { ok: true, status: 200, json: async () => payload } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await (service as any).submitOzonFbsTask({
      id: 'task-ozon',
      clientId: 'client-ozon',
      connectionId: 'ozon-connection-1',
      marketplace: MarketplaceType.OZON,
      orderId: '59639100-0681-1',
      article: '4673735179486',
      itemCount: 1,
      kiz: null,
      marketplaceSubmittedAt: null,
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api-seller.ozon.ru/v3/posting/fbs/get',
      'https://api-seller.ozon.ru/v4/posting/fbs/ship',
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      posting_number: '59639100-0681-1',
      packages: [{ products: [{ product_id: 4717802605, quantity: 1 }] }],
      with: { additional_data: true },
    });
    expect(prisma.fbsTsdAssembly.update).toHaveBeenCalledWith({
      where: { id: 'task-ozon' },
      data: expect.objectContaining({ marketplaceSubmitError: null, errorMessage: null }),
    });
  });

  // TEST: Ozon PDF must be rasterized on the API so an old ATOL never opens PdfRenderer.
  it('loads the Ozon PDF label and persists a TSD-safe PNG', async () => {
    const prisma = {
      clientMarketplaceConnection: {
        findFirst: vi.fn().mockResolvedValue({ sellerId: '123456', apiKey: 'ozon-api-key' }),
      },
      fbsTsdAssembly: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const pdfDocument = await PDFDocument.create();
    pdfDocument.addPage([164.25, 113.25]);
    const pdf = Buffer.from(await pdfDocument.save());
    const fetchMock = vi.fn(async () => new Response(pdf, {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    const result = await (service as any).loadOzonFbsTsdOrderSticker({
      id: 'task-ozon',
      clientId: 'client-ozon',
      connectionId: 'ozon-connection-1',
      marketplace: MarketplaceType.OZON,
      orderId: '59639100-0681-1',
      marketplaceSubmittedAt: new Date(),
      marketplaceLabelBase64: null,
      marketplaceLabelContentType: null,
    });

    expect(result).toEqual(expect.objectContaining({
      marketplace: MarketplaceType.OZON,
      barcode: '59639100-0681-1',
      contentType: 'image/png',
      imageBase64: expect.any(String),
    }));
    expect(Buffer.from(result.imageBase64, 'base64').subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-seller.ozon.ru/v2/posting/fbs/package-label',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ posting_number: ['59639100-0681-1'] }),
      }),
    );
    expect(prisma.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-ozon' },
      data: expect.objectContaining({
        marketplaceLabelBase64: expect.any(String),
        marketplaceLabelContentType: 'image/png',
        stickerBarcode: '59639100-0681-1',
      }),
    });
  });

  // TEST: an already stored PDF from an affected order is migrated before it reaches the TSD.
  it('converts an existing stored Ozon PDF label to PNG', async () => {
    const pdfDocument = await PDFDocument.create();
    pdfDocument.addPage([164.25, 113.25]);
    const pdf = Buffer.from(await pdfDocument.save());
    const prisma = {
      fbsTsdAssembly: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    const result = await (service as any).loadOzonFbsTsdOrderSticker({
      id: 'task-existing-ozon-pdf',
      orderId: '0126929054-0054-1',
      marketplaceLabelBase64: pdf.toString('base64'),
      marketplaceLabelContentType: 'application/pdf',
    });

    expect(result.contentType).toBe('image/png');
    expect(prisma.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-existing-ozon-pdf' },
      data: expect.objectContaining({ marketplaceLabelContentType: 'image/png' }),
    });
  });

  it('returns a partial access report when the API key lacks product-card permission', async () => {
    const prisma = {
      clientMarketplaceConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'connection-1',
          clientId: 'client-1',
          marketplace: MarketplaceType.WILDBERRIES,
          accountName: null,
          sellerId: null,
          apiKey: 'limited-api-key',
          isActive: true,
          comment: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          client: { id: 'client-1', code: 'CLIENT-1', name: 'Клиент' },
        }),
      },
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const denied = url.includes('/content/v2/get/cards/list');
      return {
        ok: !denied,
        status: denied ? 403 : 200,
        json: async () => (denied ? { message: 'token scope denied' } : { orders: [] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );

    const result = await service.checkConnection('connection-1', {} as never);

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.key === 'products')).toMatchObject({
      ok: false,
      message: expect.stringContaining('проверьте API-ключ и разрешения'),
    });
    expect(result.checks.find((check) => check.key === 'fbsOrders')?.ok).toBe(true);
    expect(result.checks.find((check) => check.key === 'warehouses')?.ok).toBe(true);
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

  it('merges a receipt draft matched by barcode into an existing API product card', async () => {
    const existing = {
      id: 'sku-api',
      clientId: 'client-1',
      internalSku: 'SKU-API',
      volumeLiters: null,
      volumeSource: VolumeSource.CALCULATED,
    };
    const receiptDraft = {
      id: 'sku-draft',
      clientId: 'client-1',
      internalSku: 'AUTO-460000000001',
      isDraft: true,
      draftSource: 'RECEIPT_SCAN',
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
        findMany: vi.fn().mockResolvedValue([{ value: '460000000001', sku: receiptDraft }]),
        upsert: vi.fn(),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const merge = vi.spyOn(service as any, 'mergeReceiptDraftSku').mockResolvedValue(undefined);

    const result = await (service as any).upsertMarketplaceSku('client-1', {
      marketplace: MarketplaceType.WILDBERRIES,
      productId: 'product-1',
      offerId: 'offer-1',
      internalSku: 'SKU-API',
      article: 'ARTICLE-1',
      barcode: '460000000001',
      barcodes: ['460000000001'],
      name: 'Карточка из API',
      payload: { source: 'api' },
    });

    expect(merge).toHaveBeenCalledWith('client-1', 'sku-draft', 'sku-api');
    expect(result).toMatchObject({ created: false, mergedDrafts: 1, barcodesTouched: 1 });
  });

  it('moves balances, movements and marks from a receipt draft to the API SKU', async () => {
    const source = {
      id: 'sku-draft',
      clientId: 'client-1',
      internalSku: 'AUTO-460000000001',
      name: 'Новый товар без карточки: 460000000001',
      color: null,
      size: null,
      volumeLiters: null,
      volumeSource: VolumeSource.MANUAL,
      barcodes: [{ value: '460000000001', isPrimary: true }],
    };
    const target = {
      id: 'sku-api',
      clientId: 'client-1',
      internalSku: 'SKU-API',
      name: 'Карточка из API',
      color: 'Чёрный',
      size: 'M',
      volumeLiters: new Prisma.Decimal(5),
      volumeSource: VolumeSource.CALCULATED,
      barcodes: [{ value: '460000000001', isPrimary: true }],
    };
    const updateMany = () => vi.fn().mockResolvedValue({ count: 0 });
    const tx = {
      sku: {
        findFirst: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(target),
        update: vi.fn(),
        delete: vi.fn(),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'balance-draft',
            clientId: 'client-1',
            skuId: 'sku-draft',
            boxId: 'box-1',
            palletId: null,
            status: StockStatus.AVAILABLE,
            quantity: 7,
          },
        ]),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        delete: vi.fn(),
      },
      stockMovement: { updateMany: updateMany() },
      productMark: { updateMany: updateMany() },
      clientRequestItem: { updateMany: updateMany() },
      clientRequestBoxSelection: { updateMany: updateMany() },
      clientRequestPackageItem: { updateMany: updateMany() },
      pickWaveBalanceLine: { updateMany: updateMany(), findMany: vi.fn() },
      pickWaveBalanceAllocation: { updateMany: updateMany() },
      fbsTsdAssembly: { updateMany: updateMany() },
      fbsOrderRequestLink: { updateMany: updateMany() },
      fbsStockPublication: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
      barcode: { upsert: vi.fn(), deleteMany: vi.fn() },
    };
    const prisma = {
      ...tx,
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await (service as any).mergeReceiptDraftSku('client-1', 'sku-draft', 'sku-api');

    expect(tx.stockBalance.update).toHaveBeenCalledWith({
      where: { id: 'balance-draft' },
      data: {
        skuId: 'sku-api',
        balanceKey: 'client-1:sku-api:box-1:no-pallet:AVAILABLE',
      },
    });
    expect(tx.stockMovement.updateMany).toHaveBeenCalledWith({
      where: { clientId: 'client-1', skuId: 'sku-draft' },
      data: { skuId: 'sku-api' },
    });
    expect(tx.productMark.updateMany).toHaveBeenCalledWith({
      where: { clientId: 'client-1', skuId: 'sku-draft' },
      data: { skuId: 'sku-api' },
    });
    expect(tx.barcode.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { skuId_value: { skuId: 'sku-api', value: '460000000001' } },
      }),
    );
    expect(tx.sku.delete).toHaveBeenCalledWith({ where: { id: 'sku-draft' } });
  });

  it('connects the selected Wildberries warehouse as the working FBS warehouse', async () => {
    const prisma = {
      clientMarketplaceConnection: {
        update: vi.fn().mockResolvedValue({ id: 'connection-1' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    vi.spyOn(service as any, 'loadFbsStockContext').mockResolvedValue({
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
      connections: [],
      connection: { id: 'connection-1', apiKey: 'secret' },
      warehouses: [{ id: '1693195', name: 'Основной склад FBS' }],
      warehouse: { id: '1693195', name: 'Основной склад FBS' },
      connectedWarehouseId: '',
      connectedWarehouseName: '',
    });

    const result = await service.connectFbsStockWarehouse(
      {
        clientId: 'client-1',
        connectionId: 'connection-1',
        warehouseId: '1693195',
      },
      {
        id: 'admin-1',
        email: 'admin@example.test',
        name: 'Администратор',
        roleCodes: ['ADMIN'],
        permissionCodes: ['system:admin'],
        clientScopeMode: 'ALL',
        clientIds: [],
        writableClientIds: [],
      },
    );

    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(expect.anything(), 'client-1', 'write');
    expect(prisma.clientMarketplaceConnection.update).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: expect.objectContaining({
        fbsWarehouseId: '1693195',
        fbsWarehouseName: 'Основной склад FBS',
        fbsWarehouseConnectedAt: expect.any(Date),
      }),
    });
    expect(result).toMatchObject({
      connected: true,
      connectionId: 'connection-1',
      warehouseId: '1693195',
      warehouseName: 'Основной склад FBS',
    });
  });

  it('lets a scoped client stop an FBS product and sends zero stock to Wildberries', async () => {
    const publication = {
      id: 'publication-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      warehouseId: '1693195',
      skuId: 'sku-1',
      enabled: false,
    };
    const prisma = {
      sku: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'sku-1',
          marketplaceProductId: '100500:200600',
        }),
      },
      fbsStockPublication: {
        upsert: vi.fn().mockResolvedValue(publication),
        update: vi.fn().mockResolvedValue(publication),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    vi.spyOn(service as any, 'loadFbsStockContext').mockResolvedValue({
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
      connections: [],
      connection: { id: 'connection-1', apiKey: 'secret' },
      warehouses: [],
      warehouse: { id: '1693195', name: 'Мой склад FBS тест' },
      connectedWarehouseId: '1693195',
      connectedWarehouseName: 'Мой склад FBS тест',
    });
    vi.spyOn(service as any, 'calculateFbsStockQuantities').mockResolvedValue(
      new Map([
        [
          'sku-1',
          {
            skuId: 'sku-1',
            chrtId: 200600,
            available: 18,
            reserved: 3,
            sellable: 15,
          },
        ],
      ]),
    );
    const putStocks = vi.spyOn(service as any, 'putWildberriesStocks').mockResolvedValue(undefined);

    const result = await service.updateFbsStockPublication(
      {
        clientId: 'client-1',
        connectionId: 'connection-1',
        warehouseId: '1693195',
        skuId: 'sku-1',
        enabled: false,
      },
      {
        id: 'user-1',
        email: 'client@example.test',
        name: 'Клиент',
        roleCodes: ['CLIENT'],
        permissionCodes: ['stock:read'],
        clientScopeMode: 'LIMITED',
        clientIds: ['client-1'],
        writableClientIds: [],
      },
    );

    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(expect.anything(), 'client-1', 'read');
    expect(putStocks).toHaveBeenCalledWith('secret', '1693195', [
      { chrtId: 200600, amount: 0 },
    ]);
    expect(prisma.fbsStockPublication.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ enabled: false, lastWmsAmount: 15 }),
        update: expect.objectContaining({ enabled: false, lastWmsAmount: 15 }),
      }),
    );
    expect(result).toMatchObject({ updated: true, enabled: false, amount: 0 });
  });

  it('publishes only the free WMS quantity when FBS sale is enabled', async () => {
    const publication = {
      id: 'publication-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      warehouseId: '1693195',
      skuId: 'sku-1',
      enabled: true,
    };
    const prisma = {
      sku: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'sku-1',
          marketplaceProductId: '100500:200600',
        }),
      },
      fbsStockPublication: {
        upsert: vi.fn().mockResolvedValue(publication),
        update: vi.fn().mockResolvedValue(publication),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );
    vi.spyOn(service as any, 'loadFbsStockContext').mockResolvedValue({
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
      connections: [],
      connection: { id: 'connection-1', apiKey: 'secret' },
      warehouses: [],
      warehouse: { id: '1693195', name: 'Мой склад FBS тест' },
      connectedWarehouseId: '1693195',
      connectedWarehouseName: 'Мой склад FBS тест',
    });
    vi.spyOn(service as any, 'calculateFbsStockQuantities').mockResolvedValue(
      new Map([
        [
          'sku-1',
          {
            skuId: 'sku-1',
            chrtId: 200600,
            available: 18,
            reserved: 3,
            sellable: 15,
          },
        ],
      ]),
    );
    const putStocks = vi.spyOn(service as any, 'putWildberriesStocks').mockResolvedValue(undefined);

    const result = await service.updateFbsStockPublication(
      {
        clientId: 'client-1',
        connectionId: 'connection-1',
        warehouseId: '1693195',
        skuId: 'sku-1',
        enabled: true,
      },
      {
        id: 'admin-1',
        email: 'admin@example.test',
        name: 'Администратор',
        roleCodes: ['ADMIN'],
        permissionCodes: ['system:admin'],
        clientScopeMode: 'ALL',
        clientIds: [],
        writableClientIds: [],
      },
    );

    expect(putStocks).toHaveBeenCalledWith('secret', '1693195', [
      { chrtId: 200600, amount: 15 },
    ]);
    expect(result).toMatchObject({ updated: true, enabled: true, amount: 15 });
  });

  it('caps a requested FBS amount at free WMS stock and reports the shortage', async () => {
    const publication = {
      id: 'publication-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      warehouseId: '1693195',
      skuId: 'sku-1',
      enabled: true,
      saleLimit: 50,
    };
    const prisma = {
      sku: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'sku-1',
          marketplaceProductId: '100500:200600',
        }),
      },
      fbsStockPublication: {
        upsert: vi.fn().mockResolvedValue(publication),
        update: vi.fn().mockResolvedValue(publication),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );
    vi.spyOn(service as any, 'loadFbsStockContext').mockResolvedValue({
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
      connections: [],
      connection: { id: 'connection-1', apiKey: 'secret' },
      warehouses: [],
      warehouse: { id: '1693195', name: 'Мой склад FBS' },
      connectedWarehouseId: '1693195',
      connectedWarehouseName: 'Мой склад FBS',
    });
    vi.spyOn(service as any, 'calculateFbsStockQuantities').mockResolvedValue(
      new Map([
        ['sku-1', { skuId: 'sku-1', chrtId: 200600, available: 18, reserved: 3, sellable: 15 }],
      ]),
    );
    const putStocks = vi.spyOn(service as any, 'putWildberriesStocks').mockResolvedValue(undefined);

    const result = await service.updateFbsStockPublication(
      {
        clientId: 'client-1',
        connectionId: 'connection-1',
        warehouseId: '1693195',
        skuId: 'sku-1',
        enabled: true,
        saleLimit: 50,
      },
      {
        id: 'admin-1',
        email: 'admin@example.test',
        name: 'Администратор',
        roleCodes: ['ADMIN'],
        permissionCodes: ['system:admin'],
        clientScopeMode: 'ALL',
        clientIds: [],
        writableClientIds: [],
      },
    );

    expect(putStocks).toHaveBeenCalledWith('secret', '1693195', [{ chrtId: 200600, amount: 15 }]);
    expect(prisma.fbsStockPublication.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ saleLimit: 50 }),
        update: expect.objectContaining({ saleLimit: 50 }),
      }),
    );
    expect(result).toMatchObject({
      saleLimit: 50,
      requestedAmount: 50,
      targetAmount: 15,
      publishedAmount: 15,
      shortage: true,
      shortageAmount: 35,
    });
  });

  it('changes the FBS sale status for several products in one request', async () => {
    const prisma = {
      sku: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'sku-1', marketplaceProductId: '100500:200600' },
          { id: 'sku-2', marketplaceProductId: '100501:200601' },
        ]),
      },
      fbsStockPublication: {
        upsert: vi
          .fn()
          .mockResolvedValueOnce({ id: 'publication-1', skuId: 'sku-1' })
          .mockResolvedValueOnce({ id: 'publication-2', skuId: 'sku-2' }),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    vi.spyOn(service as any, 'loadFbsStockContext').mockResolvedValue({
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
      connections: [],
      connection: { id: 'connection-1', apiKey: 'secret' },
      warehouses: [],
      warehouse: { id: '1693195', name: 'Мой склад FBS' },
      connectedWarehouseId: '1693195',
      connectedWarehouseName: 'Мой склад FBS',
    });
    vi.spyOn(service as any, 'calculateFbsStockQuantities').mockResolvedValue(
      new Map([
        ['sku-1', { skuId: 'sku-1', chrtId: 200600, available: 4, reserved: 1, sellable: 3 }],
        ['sku-2', { skuId: 'sku-2', chrtId: 200601, available: 7, reserved: 2, sellable: 5 }],
      ]),
    );
    const putStocks = vi.spyOn(service as any, 'putWildberriesStocks').mockResolvedValue(undefined);

    const result = await service.updateFbsStockPublicationBulk(
      {
        clientId: 'client-1',
        connectionId: 'connection-1',
        warehouseId: '1693195',
        skuIds: ['sku-1', 'sku-2'],
        enabled: false,
      },
      {
        id: 'client-user-1',
        email: 'client@example.test',
        name: 'Клиент',
        roleCodes: ['CLIENT'],
        permissionCodes: ['stock:read'],
        clientScopeMode: 'LIMITED',
        clientIds: ['client-1'],
        writableClientIds: [],
      },
    );

    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(expect.anything(), 'client-1', 'read');
    expect(putStocks).toHaveBeenCalledWith('secret', '1693195', [
      { chrtId: 200600, amount: 0 },
      { chrtId: 200601, amount: 0 },
    ]);
    expect(prisma.fbsStockPublication.upsert).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      updated: true,
      enabled: false,
      requested: 2,
      updatedProducts: 2,
      synced: 2,
      amount: 0,
    });
  });

  it('applies one FBS sale limit to every selected SKU without publishing unavailable stock', async () => {
    const prisma = {
      sku: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'sku-1', marketplaceProductId: '100500:200600' },
          { id: 'sku-2', marketplaceProductId: '100501:200601' },
        ]),
      },
      fbsStockPublication: {
        upsert: vi
          .fn()
          .mockResolvedValueOnce({ id: 'publication-1', skuId: 'sku-1', saleLimit: 10 })
          .mockResolvedValueOnce({ id: 'publication-2', skuId: 'sku-2', saleLimit: 10 }),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );
    vi.spyOn(service as any, 'loadFbsStockContext').mockResolvedValue({
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
      connections: [],
      connection: { id: 'connection-1', apiKey: 'secret' },
      warehouses: [],
      warehouse: { id: '1693195', name: 'Мой склад FBS' },
      connectedWarehouseId: '1693195',
      connectedWarehouseName: 'Мой склад FBS',
    });
    vi.spyOn(service as any, 'calculateFbsStockQuantities').mockResolvedValue(
      new Map([
        ['sku-1', { skuId: 'sku-1', chrtId: 200600, available: 4, reserved: 1, sellable: 3 }],
        ['sku-2', { skuId: 'sku-2', chrtId: 200601, available: 7, reserved: 2, sellable: 5 }],
      ]),
    );
    const putStocks = vi.spyOn(service as any, 'putWildberriesStocks').mockResolvedValue(undefined);

    const result = await service.updateFbsStockPublicationBulk(
      {
        clientId: 'client-1',
        connectionId: 'connection-1',
        warehouseId: '1693195',
        skuIds: ['sku-1', 'sku-2'],
        enabled: true,
        saleLimit: 10,
      },
      {
        id: 'admin-1',
        email: 'admin@example.test',
        name: 'Администратор',
        roleCodes: ['ADMIN'],
        permissionCodes: ['system:admin'],
        clientScopeMode: 'ALL',
        clientIds: [],
        writableClientIds: [],
      },
    );

    expect(putStocks).toHaveBeenCalledWith('secret', '1693195', [
      { chrtId: 200600, amount: 3 },
      { chrtId: 200601, amount: 5 },
    ]);
    expect(result).toMatchObject({
      saleLimit: 10,
      requestedAmount: 20,
      targetAmount: 8,
      publishedAmount: 8,
      shortage: true,
      shortageProducts: 2,
      shortageAmount: 12,
    });
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ skuId: 'sku-1', targetAmount: 3, shortageAmount: 7 }),
        expect.objectContaining({ skuId: 'sku-2', targetAmount: 5, shortageAmount: 5 }),
      ]),
    );
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

  it('refreshes active WB statuses every cycle without rechecking the completed archive', async () => {
    const statusBodies: number[][] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        let payload: unknown;
        if (url.includes('/orders/status')) {
          const ids = JSON.parse(String(init?.body)).orders as number[];
          statusBodies.push(ids);
          payload = {
            orders: ids.map((id) => ({
              id,
              supplierStatus: id === 1001 ? 'new' : 'complete',
              wbStatus: id === 1001 ? 'waiting' : 'sold',
            })),
          };
        } else if (url.includes('/orders/new')) {
          payload = { orders: [] };
        } else if (url.includes('/supplies/orders/reshipment')) {
          payload = { orders: [] };
        } else if (url.includes('/api/v3/warehouses')) {
          payload = [];
        } else {
          payload = {
            orders: [
              { id: 1001, article: 'ACTIVE', skus: ['1001'] },
              { id: 1002, article: 'DONE', skus: ['1002'] },
            ],
            next: 0,
          };
        }
        return { ok: true, status: 200, json: async () => payload } as Response;
      }),
    );
    const service = new MarketplaceConnectionsService({} as never, {} as never);
    const connection = {
      id: 'connection-1',
      apiKey: 'secret-key',
      accountName: 'WB',
    } as never;

    await (service as any).fetchWildberriesFbsOrders(connection);
    await (service as any).fetchWildberriesFbsOrders(connection);

    expect(statusBodies).toEqual([[1001, 1002], [1001]]);
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

  it('refreshes a cached FBS list incrementally and restores request orders omitted by WB', async () => {
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService({} as never, clientScopes as never);
    const liveResponse = {
      client: { id: 'client-1', code: 'CL-1', name: 'Client' },
      connected: true,
      connections: [],
      fetchedAt: '2026-08-08T16:00:00.000Z',
      deliveryPlan: {
        destination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
        itemsPerCargoPlace: 2_000_000_000,
        requiresCargoPlaces: false,
      },
      counts: { active: 2, shipped: 0, cancelled: 0, archive: 0, all: 2 },
      orders: [fbsOrder({ id: 'order-1' }), fbsOrder({ id: 'order-2' })],
    };
    const restoredResponse = {
      ...liveResponse,
      counts: { active: 68, shipped: 0, cancelled: 0, archive: 0, all: 68 },
      orders: Array.from({ length: 68 }, (_, index) => ({ id: `order-${index + 1}` })),
    };
    (service as any).fbsOrdersCache.set('client-1', {
      expiresAt: Date.now() + 60_000,
      value: {
        ...liveResponse,
        fetchedAt: '2026-08-08T15:00:00.000Z',
        counts: { active: 1, shipped: 0, cancelled: 0, archive: 0, all: 1 },
        orders: [fbsOrder({ id: 'order-cached' })],
      },
    });
    const loadOrders = vi
      .spyOn(service as any, 'loadFbsOrders')
      .mockResolvedValue(liveResponse);
    const syncRequests = vi
      .spyOn(service as any, 'syncFbsRequestsFromMarketplace')
      .mockResolvedValue(undefined);
    const merge = vi
      .spyOn(service as any, 'mergeSyncedFbsTsdRequestOrders')
      .mockResolvedValue(restoredResponse);
    vi.spyOn(service as any, 'scopeFbsOrdersForUser').mockResolvedValue(restoredResponse);

    const result = await service.listFbsOrders('client-1', { id: 'admin-1' } as never, true);

    expect(result.counts.active).toBe(68);
    expect(result.orders).toHaveLength(68);
    expect(loadOrders).toHaveBeenCalledWith('client-1', expect.any(Map));
    expect(syncRequests).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({
        orders: expect.arrayContaining([
          expect.objectContaining({ id: 'order-cached' }),
          expect.objectContaining({ id: 'order-1' }),
          expect.objectContaining({ id: 'order-2' }),
        ]),
      }),
    );
  });

  it('forces a fresh FBS order load when reserves are refreshed', async () => {
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService({} as never, clientScopes as never);
    const freshOrders = {
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
      connected: true,
      connections: [],
      fetchedAt: '2026-07-25T13:00:00.000Z',
      deliveryPlan: {
        destination: FbsDeliveryDestination.PICKUP_POINT,
        itemsPerCargoPlace: 14,
        requiresCargoPlaces: true,
      },
      counts: { active: 2, shipped: 0, cancelled: 0, archive: 0, all: 2 },
      orders: [],
    };
    vi.spyOn(service as any, 'loadFbsStockContext').mockResolvedValue({
      client: freshOrders.client,
      connections: [{ id: 'connection-1' }],
      connection: { id: 'connection-1' },
      warehouses: [{ id: 'warehouse-1' }],
      warehouse: { id: 'warehouse-1' },
    });
    const loadOrders = vi.spyOn(service as any, 'loadFbsOrders').mockResolvedValue(freshOrders);
    const buildResponse = vi.spyOn(service as any, 'buildFbsStocksResponse').mockResolvedValue({
      items: [],
    });
    (service as any).fbsOrdersCache.set('client-1', {
      expiresAt: Date.now() + 60_000,
      value: { ...freshOrders, fetchedAt: '2026-07-25T12:00:00.000Z' },
    });

    await service.listFbsStocks(
      'client-1',
      'connection-1',
      'warehouse-1',
      {
        id: 'user-1',
        email: 'admin@example.test',
        name: 'Администратор',
        roleCodes: ['ADMIN'],
        permissionCodes: [],
        clientScopeMode: 'ALL',
        clientIds: [],
        writableClientIds: [],
      },
      true,
    );

    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(expect.anything(), 'client-1', 'read');
    expect(loadOrders).toHaveBeenCalledWith('client-1');
    expect((service as any).fbsOrdersCache.get('client-1').value).toBe(freshOrders);
    expect(buildResponse).toHaveBeenCalled();
  });

  it('uses the ordered product directly when its barcode has available stock', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ relabelingEnabled: true }),
      },
      clientArticleMapping: {
        findMany: vi.fn(),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const directBoxes = [
      { code: 'FFL_DIRECT_001', quantity: 2, status: 'AVAILABLE' },
    ];
    const order = fbsOrder({
      storageBoxes: directBoxes,
      relabeling: {
        required: true,
        sourceSkuId: 'stale-source',
        sourceProductName: 'Старый источник',
        sourceArticle: 'SOURCE-1',
        sourceBarcodes: ['2000000000001'],
      },
    });

    const [listedOrder] = await (service as any).applyFbsRelabelingStockSources(
      'client-1',
      [order],
    );
    const tsdSource = await (service as any).resolveFbsTsdStockSource(
      'client-1',
      order.product,
      directBoxes,
    );

    expect(listedOrder.storageBoxes).toEqual(directBoxes);
    expect(listedOrder.relabeling).toBeNull();
    expect(tsdSource).toMatchObject({
      storageBoxes: directBoxes,
      relabelRequired: false,
    });
    expect(prisma.clientArticleMapping.findMany).not.toHaveBeenCalled();
    expect(prisma.client.findUnique).toHaveBeenCalledTimes(2);
  });

  it('falls back to the relabel source when all direct stock is already reserved', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({
          relabelingEnabled: true,
          storesWithoutBoxes: false,
        }),
      },
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([{ id: 'request-43' }]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            boxId: 'box-31',
            itemCount: 1,
            requestId: 'request-43',
            status: 'COMPLETED',
          },
        ]),
      },
      clientArticleMapping: {
        findMany: vi.fn().mockResolvedValue([
          {
            sourceArticle: 'Корея_2голубой',
            targetArticle: 'новый_корея_2голубой',
          },
        ]),
      },
      sku: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'target-sku',
          internalSku: 'новый_корея_2голубой-XL / 48',
          clientSku: 'новый_корея_2голубой',
          article: 'новый_корея_2голубой',
          size: 'XL / 48',
        }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'source-sku',
            name: 'Костюм летний брючный оверсайз',
            internalSku: 'Корея_2голубой-XL / 48',
            clientSku: 'Корея_2голубой',
            article: 'Корея_2голубой',
            barcodes: [{ value: '2049156013562' }],
            balances: [
              {
                quantity: 19,
                status: 'AVAILABLE',
                box: { code: 'FFL_LKB25_031' },
              },
            ],
          },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const product = {
      id: 'target-sku',
      name: 'Костюм летний брючный оверсайз',
      internalSku: 'новый_корея_2голубой-XL / 48',
      clientSku: 'новый_корея_2голубой',
      article: 'новый_корея_2голубой',
      size: 'XL / 48',
      needsChestnyZnak: true,
      isUnmarked: false,
    };

    const result = await (service as any).resolveFbsTsdStockSource(
      'client-1',
      product,
      [{ code: 'FFL_LKB25_031', quantity: 1, status: 'AVAILABLE' }],
    );

    expect(result).toMatchObject({
      sourceSkuId: 'source-sku',
      sourceArticle: 'Корея_2голубой',
      relabelRequired: true,
      storageBoxes: [
        { code: 'FFL_LKB25_031', quantity: 19, status: 'AVAILABLE' },
      ],
    });
  });

  it('assigns an FBS order without a box when piece stock has a legacy box link', async () => {
    const fbsTsdAssembly = {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(
        async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'task-46',
          ...data,
        }),
      ),
    };
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({
          relabelingEnabled: false,
          storesWithoutBoxes: true,
        }),
      },
      stockBalance: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 96 } }),
      },
      fbsTsdAssembly,
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([{ clientId: 'client-uskow' }]),
      },
      clientRequestItem: {
        findFirst: vi.fn().mockResolvedValue({ id: 'request-item-46' }),
      },
    };
    const clientScopes = {
      resolveClientFilter: vi.fn().mockReturnValue('client-uskow'),
      requireClientAccess: vi.fn(),
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      clientScopes as never,
    );
    vi.spyOn(service as any, 'loadFbsOrders').mockResolvedValue({
      orders: [
        {
          id: '5378514902',
          connectionId: 'connection-uskow',
          marketplace: MarketplaceType.WILDBERRIES,
          category: 'active',
          supplierStatus: 'confirm',
          product: {
            id: 'sku-kb-1',
            name: 'KB-1',
            article: 'KB-1',
            clientSku: null,
            internalSku: 'KB-1-0',
            needsChestnyZnak: false,
            isUnmarked: true,
          },
          request: {
            id: 'request-46',
            number: 46,
            status: ClientRequestStatus.IN_WORK,
          },
          supplyId: 'WB-GI-258732082',
          storageBoxes: [],
          requiredMeta: [],
          optionalMeta: [],
          barcodes: ['2040000000046'],
          itemCount: 1,
          createdAt: '2026-07-26T10:00:00Z',
        },
      ],
    });
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(
      async (task: unknown) => task,
    );

    const result = await service.getNextFbsTsdAssembly('USER:worker', {
      id: 'worker-1',
      name: 'Сборщик',
    } as never);

    expect(fbsTsdAssembly.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: '5378514902',
        requestId: 'request-46',
        skuId: 'sku-kb-1',
        boxId: null,
        boxCode: 'БЕЗ КОРОБА',
        status: 'IN_PROGRESS',
      }),
    });
    expect(prisma.stockBalance.aggregate).toHaveBeenCalledWith({
      where: {
        clientId: 'client-uskow',
        skuId: 'sku-kb-1',
        status: StockStatus.AVAILABLE,
        OR: [
          { boxId: null },
          {
            boxId: { not: null },
            box: { status: { notIn: ['deleted', 'archived'] } },
          },
        ],
      },
      _sum: { quantity: true },
    });
    expect(result).toMatchObject({
      id: 'task-46',
      orderId: '5378514902',
      boxCode: 'БЕЗ КОРОБА',
    });
  });

  it('shows source product boxes in an FBS order only when direct stock is absent', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ relabelingEnabled: true }),
      },
      clientArticleMapping: {
        findMany: vi.fn().mockResolvedValue([
          {
            sourceArticle: 'Корея_2голубой',
            targetArticle: 'новый_корея_2голубой',
          },
        ]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'source-sku-1',
            name: 'Костюм Корея голубой',
            internalSku: 'Корея_2голубой-XL',
            clientSku: 'Корея_2голубой',
            article: 'Корея_2голубой',
            size: 'XL / 48',
            barcodes: [{ value: '2049156013579' }],
            balances: [
              {
                quantity: 5,
                status: 'AVAILABLE',
                box: { code: 'FFL_LKB0106_039' },
              },
              {
                quantity: 3,
                status: 'AVAILABLE',
                box: { code: 'FFL_LKB0207_222' },
              },
            ],
          },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const order = fbsOrder({
      article: 'новый_корея_2голубой',
      product: {
        id: 'target-sku-1',
        name: 'Новый костюм Корея голубой',
        internalSku: 'новый_корея_2голубой-XL',
        clientSku: 'новый_корея_2голубой',
        article: 'новый_корея_2голубой',
        size: 'XL / 48',
        needsChestnyZnak: true,
        isUnmarked: false,
      },
      storageBoxes: [],
    });

    const [result] = await (service as any).applyFbsRelabelingStockSources(
      'client-1',
      [order],
    );

    expect(result.relabeling).toMatchObject({
      required: true,
      sourceSkuId: 'source-sku-1',
      sourceProductName: 'Костюм Корея голубой',
      sourceArticle: 'Корея_2голубой',
      sourceBarcodes: ['2049156013579'],
    });
    expect(result.storageBoxes).toEqual([
      { code: 'FFL_LKB0106_039', quantity: 5, status: 'AVAILABLE' },
      { code: 'FFL_LKB0207_222', quantity: 3, status: 'AVAILABLE' },
    ]);
  });

  it('keeps the TSD queue in the last WB supply and reassigns a stale unstarted task', async () => {
    const staleUpdatedAt = new Date('2026-07-22T06:00:00Z');
    const releasedUpdatedAt = new Date('2026-07-22T09:00:00Z');
    const releasedTask = {
      id: 'stale-task',
      orderId: 'order-from-current-supply',
      status: 'RELEASED',
      deviceCode: 'USER:old-worker',
      workerName: null,
      reservedBoxId: null,
      reservedBoxCode: null,
      boxId: null,
      boxCode: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
      relabelConfirmedAt: null,
      wbMetaStatus: 'NOT_REQUIRED',
      marketplaceSubmittedAt: null,
      marketplaceLabelBase64: null,
      marketplaceLabelContentType: null,
      marketplaceSubmitError: null,
      stickerPartA: null,
      stickerPartB: null,
      stickerBarcode: null,
      sourceBoxPending: false,
      cargoPackingId: null,
      cargoPackedAt: null,
      cargoPackedByUserId: null,
      cargoPackedByName: null,
      completedAt: null,
      updatedAt: releasedUpdatedAt,
    };
    const fbsTsdAssembly = {
      findFirst: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ requestId: 'request-31', supplyId: 'WB-GI-31' }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn()
        .mockResolvedValueOnce({
          ...releasedTask,
          status: 'IN_PROGRESS',
          workerName: 'Старый сборщик',
          updatedAt: staleUpdatedAt,
        })
        .mockResolvedValueOnce(releasedTask)
        .mockResolvedValueOnce({
          ...releasedTask,
          status: 'IN_PROGRESS',
          deviceCode: 'USER:worker-1',
          workerName: 'Сборщик',
        }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
    expect(fbsTsdAssembly.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'stale-task',
        status: 'RELEASED',
        updatedAt: releasedUpdatedAt,
      },
      data: expect.objectContaining({
        orderId: 'order-from-current-supply',
        requestId: 'request-31',
        supplyId: 'WB-GI-31',
      }),
    });
    expect(fbsTsdAssembly.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ orderId: 'order-from-current-supply' });
  });

  // TEST: a recently assigned but untouched task must not remain locked by a
  // physical TSD whose monitor heartbeat has expired.
  it('reassigns an untouched FBS task immediately when its physical TSD is offline', async () => {
    const recentUpdatedAt = new Date(Date.now() - 30_000);
    const releasedUpdatedAt = new Date();
    const releasedTask = {
      id: 'offline-task',
      orderId: '5573896135',
      status: 'RELEASED',
      deviceCode: 'TSD-INSTALL-OFFLINE',
      workerName: null,
      reservedBoxId: null,
      reservedBoxCode: null,
      boxCode: null,
      sourceBarcode: null,
      boxId: null,
      barcode: null,
      kiz: null,
      relabelConfirmedAt: null,
      wbMetaStatus: 'NOT_REQUIRED',
      marketplaceSubmittedAt: null,
      marketplaceLabelBase64: null,
      marketplaceLabelContentType: null,
      marketplaceSubmitError: null,
      stickerPartA: null,
      stickerPartB: null,
      stickerBarcode: null,
      sourceBoxPending: false,
      cargoPackingId: null,
      cargoPackedAt: null,
      cargoPackedByUserId: null,
      cargoPackedByName: null,
      completedAt: null,
      updatedAt: releasedUpdatedAt,
    };
    const fbsTsdAssembly = {
      findFirst: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ requestId: 'request-311', supplyId: 'WB-GI-311' }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn()
        .mockResolvedValueOnce({
          ...releasedTask,
          status: 'IN_PROGRESS',
          workerUserId: 'worker-nadezhda',
          workerName: 'Надежда',
          updatedAt: recentUpdatedAt,
        })
        .mockResolvedValueOnce(releasedTask)
        .mockResolvedValueOnce({
          ...releasedTask,
          status: 'IN_PROGRESS',
          deviceCode: 'TSD-INSTALL-CURRENT',
          workerUserId: 'worker-current',
          workerName: 'Сборщик',
        }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
    };
    const prisma = {
      fbsTsdAssembly,
      tsdOperation: {
        findUnique: vi.fn().mockResolvedValue({
          updatedAt: new Date(Date.now() - 120_000),
        }),
      },
      clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue([{ clientId: 'client-1' }]) },
      clientRequestItem: { findFirst: vi.fn().mockResolvedValue({ id: 'request-item-311' }) },
      $transaction: vi.fn(async (callback: (tx: Record<string, unknown>) => unknown) => callback({
        $queryRaw: vi.fn().mockResolvedValue([{ updatedAt: new Date(Date.now() - 120_000) }]),
        fbsTsdAssembly,
      })),
    };
    const clientScopes = {
      resolveClientFilter: vi.fn().mockReturnValue('client-1'),
      requireClientAccess: vi.fn(),
    };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    vi.spyOn(service as any, 'loadFbsOrders').mockResolvedValue({
      orders: [{
        id: '5573896135',
        connectionId: 'connection-1',
        marketplace: MarketplaceType.WILDBERRIES,
        category: 'active',
        supplierStatus: 'confirm',
        product: {
          id: 'sku-311',
          name: 'Костюм',
          article: 'ARTICLE-311',
          clientSku: null,
          internalSku: 'SKU-311',
          needsChestnyZnak: false,
          isUnmarked: true,
        },
        request: { id: 'request-311', status: 'SUBMITTED' },
        supplyId: 'WB-GI-311',
        storageBoxes: [{ code: 'FFL_TEST_311', quantity: 1, status: 'AVAILABLE' }],
        requiredMeta: [],
        optionalMeta: [],
        barcodes: ['4600000000311'],
        itemCount: 1,
        createdAt: new Date().toISOString(),
      }],
    });
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(async (task: unknown) => task);

    const result = await service.getNextFbsTsdAssembly(undefined, {
      id: 'worker-current',
      name: 'Сборщик',
      deviceCode: 'TSD-INSTALL-CURRENT',
    } as never);

    expect(prisma.tsdOperation.findUnique).toHaveBeenCalledWith({
      where: { operationKey: 'monitor-heartbeat:TSD-INSTALL-OFFLINE' },
      select: { updatedAt: true },
    });
    expect(fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'offline-task',
        status: 'IN_PROGRESS',
        workerUserId: 'worker-nadezhda',
        updatedAt: recentUpdatedAt,
        sourceBarcode: null,
        boxId: null,
        barcode: null,
        kiz: null,
      }),
      data: expect.objectContaining({
        status: 'RELEASED',
        workerUserId: null,
        workerName: null,
        errorMessage: expect.stringContaining('ТСД TSD-INSTALL-OFFLINE офлайн'),
      }),
    });
    expect(fbsTsdAssembly.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'offline-task',
        status: 'RELEASED',
        updatedAt: releasedUpdatedAt,
      },
      data: expect.objectContaining({
        orderId: '5573896135',
        requestId: 'request-311',
        deviceCode: 'TSD-INSTALL-CURRENT',
      }),
    });
    expect(result).toMatchObject({
      orderId: '5573896135',
      deviceCode: 'TSD-INSTALL-CURRENT',
      workerUserId: 'worker-current',
    });
  });

  // TEST: an active order in the previous supply keeps its owner, while the
  // queue continues with the first free order from the following supply.
  it('continues to the next supply when the previous supply order belongs to an online TSD', async () => {
    const onlineTask = {
      id: 'online-task',
      orderId: '5573896135',
      status: 'IN_PROGRESS',
      deviceCode: 'TSD-INSTALL-NADEZHDA',
      workerUserId: 'worker-nadezhda',
      workerName: 'Надежда',
      reservedBoxId: null,
      reservedBoxCode: null,
      boxId: null,
      boxCode: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
      relabelConfirmedAt: null,
      wbMetaStatus: 'NOT_REQUIRED',
      marketplaceSubmittedAt: null,
      marketplaceLabelBase64: null,
      marketplaceLabelContentType: null,
      marketplaceSubmitError: null,
      stickerPartA: null,
      stickerPartB: null,
      stickerBarcode: null,
      sourceBoxPending: false,
      cargoPackingId: null,
      cargoPackedAt: null,
      cargoPackedByUserId: null,
      cargoPackedByName: null,
      completedAt: null,
      updatedAt: new Date(),
    };
    const fbsTsdAssembly = {
      findFirst: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ requestId: 'request-311', supplyId: 'WB-GI-311' }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn()
        .mockResolvedValueOnce(onlineTask)
        .mockResolvedValueOnce(null),
      updateMany: vi.fn(),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'next-supply-task',
        ...data,
      })),
    };
    const prisma = {
      fbsTsdAssembly,
      tsdOperation: {
        findUnique: vi.fn().mockResolvedValue({ updatedAt: new Date(Date.now() - 30_000) }),
      },
      clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue([{ clientId: 'client-1' }]) },
      clientRequestItem: { findFirst: vi.fn().mockResolvedValue({ id: 'request-item' }) },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {
      resolveClientFilter: vi.fn().mockReturnValue('client-1'),
      requireClientAccess: vi.fn(),
    } as never);
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
      storageBoxes: [{ code: `FFL_${requestId}`, quantity: 1, status: 'AVAILABLE' }],
      requiredMeta: [],
      optionalMeta: [],
      barcodes: ['4600000000311'],
      itemCount: 1,
      createdAt,
    });
    vi.spyOn(service as any, 'loadFbsOrders').mockResolvedValue({
      orders: [
        order('5573896135', 'request-311', 'WB-GI-311', '2026-08-29T08:00:00.000Z'),
        order('5573897000', 'request-312', 'WB-GI-312', '2026-08-29T08:01:00.000Z'),
      ],
    });
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(async (task: unknown) => task);

    const result = await service.getNextFbsTsdAssembly(undefined, {
      id: 'worker-current',
      name: 'Сборщик',
      deviceCode: 'TSD-INSTALL-CURRENT',
    } as never);

    expect(fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
    expect(fbsTsdAssembly.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: '5573897000',
        requestId: 'request-312',
        supplyId: 'WB-GI-312',
        deviceCode: 'TSD-INSTALL-CURRENT',
      }),
    });
    expect(result).toMatchObject({ orderId: '5573897000' });
  });

  // TEST: an online TSD remains the exclusive owner of its FBS task.
  it('keeps a physical TSD online while its monitor heartbeat is fresh', async () => {
    const prisma = {
      tsdOperation: {
        findUnique: vi.fn().mockResolvedValue({ updatedAt: new Date(Date.now() - 30_000) }),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await expect(
      (service as any).isFbsTsdDeviceOffline('TSD-INSTALL-ONLINE'),
    ).resolves.toBe(false);
  });

  // TEST: absent monitor data is unknown and cannot authorize task stealing.
  it('does not classify a TSD with no monitor heartbeat as offline', async () => {
    const prisma = {
      tsdOperation: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await expect(
      (service as any).isFbsTsdDeviceOffline('TSD-INSTALL-UNKNOWN'),
    ).resolves.toBe(false);
  });

  // TEST: labels and other non-scan progress protect a task from automatic
  // release just like a scanned box, product barcode or KIZ.
  it('does not treat a task with generated sticker progress as untouched', () => {
    const service = new MarketplaceConnectionsService({} as never, {} as never);
    const task = {
      boxId: null,
      boxCode: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
      relabelConfirmedAt: null,
      wbMetaStatus: 'NOT_REQUIRED',
      marketplaceSubmittedAt: null,
      marketplaceLabelBase64: null,
      marketplaceLabelContentType: null,
      marketplaceSubmitError: null,
      stickerPartA: null,
      stickerPartB: null,
      stickerBarcode: 'WB-STICKER-1234',
      sourceBoxPending: false,
      cargoPackingId: null,
      cargoPackedAt: null,
      cargoPackedByUserId: null,
      cargoPackedByName: null,
      completedAt: null,
    };

    expect((service as any).isFbsTsdTaskUntouchedForAutoRelease(task)).toBe(false);
  });

  // TEST: the final locked heartbeat read wins over an earlier stale snapshot.
  it('does not release an FBS task when its TSD reconnects before the guarded update', async () => {
    const updateMany = vi.fn();
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: Record<string, unknown>) => unknown) => callback({
        $queryRaw: vi.fn().mockResolvedValue([{ updatedAt: new Date(Date.now() - 10_000) }]),
        fbsTsdAssembly: { updateMany },
      })),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await expect(
      (service as any).releaseOfflineUntouchedFbsTsdTask({
        id: 'reconnected-task',
        deviceCode: 'TSD-INSTALL-RECONNECTED',
        workerUserId: 'worker-1',
        workerName: 'Сборщик',
        reservedBoxId: null,
        updatedAt: new Date(),
      }),
    ).resolves.toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('continues the TSD queue from a synced WMS request when the WB API is temporarily unavailable', async () => {
    const fbsTsdAssembly = {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'fallback-task',
        ...data,
      })),
    };
    const prisma = {
      fbsTsdAssembly,
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([{ clientId: 'client-1' }]),
      },
      clientRequestItem: {
        findFirst: vi.fn().mockResolvedValue({ id: 'request-item-33' }),
      },
    };
    const clientScopes = {
      resolveClientFilter: vi.fn().mockReturnValue('client-1'),
      requireClientAccess: vi.fn(),
    };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    vi.spyOn(service as any, 'loadFbsOrders').mockRejectedValue(
      new Error('Wildberries global rate limit'),
    );
    vi.spyOn(service as any, 'loadFbsTsdRequestOrders').mockResolvedValue({
      orders: [{
        id: '5359402675',
        connectionId: 'connection-1',
        marketplace: MarketplaceType.WILDBERRIES,
        category: 'active',
        supplierStatus: 'confirm',
        product: {
          id: 'sku-33',
          name: 'Костюм',
          article: 'ARTICLE-33',
          clientSku: null,
          internalSku: 'SKU-33',
          needsChestnyZnak: true,
          isUnmarked: false,
        },
        request: { id: 'request-33', number: 33, status: ClientRequestStatus.IN_WORK },
        supplyId: 'WB-GI-33',
        storageBoxes: [{ code: 'FFL_LKB1705_101', quantity: 4, status: 'AVAILABLE' }],
        requiredMeta: [],
        optionalMeta: [],
        barcodes: ['4600000000033'],
        itemCount: 1,
        createdAt: '2026-07-23T10:00:00Z',
      }],
    });
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(async (task: unknown) => task);

    const result = await service.getNextFbsTsdAssembly('USER:worker', {
      id: 'worker-1',
      name: 'Сборщик',
    } as never);

    expect(fbsTsdAssembly.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: '5359402675',
        requestId: 'request-33',
        supplyId: 'WB-GI-33',
        deviceCode: 'USER:worker',
      }),
    });
    expect(result).toMatchObject({
      id: 'fallback-task',
      orderId: '5359402675',
      requestId: 'request-33',
    });
  });

  it('does not steal an untouched FBS task from another TSD using the same user account', async () => {
    const prisma = {
      fbsTsdAssembly: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const clientScopes = {
      requireClientAccess: vi.fn(),
      resolveClientFilter: vi.fn().mockReturnValue('client-1'),
    };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);

    const result = await service.getNextFbsTsdAssembly('USER:new-code', {
      id: 'worker-1',
      name: 'Сборщик',
    } as never);

    expect(prisma.fbsTsdAssembly.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        status: 'IN_PROGRESS',
        deviceCode: 'USER:new-code',
      },
      orderBy: { updatedAt: 'desc' },
    });
    expect(result).toMatchObject({
      state: 'EMPTY',
    });
  });

  // TEST: a task whose parent request has already been closed must disappear
  // from the handheld queue without losing its saved scan evidence.
  it('parks a ghost TSD task from a closed FBS request', async () => {
    const updatedAt = new Date('2026-08-31T09:02:47.947Z');
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-454',
          status: ClientRequestStatus.DONE,
        }),
      },
      fbsTsdAssembly: { updateMany },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const task = {
      id: 'ghost-task',
      requestId: 'request-454',
      status: 'IN_PROGRESS',
      deviceCode: 'TSD-INSTALL-8F4AD3F8D15EA12C',
      workerUserId: 'worker-valeron',
      workerName: 'Валерон',
      barcode: '4673735179493',
      kiz: 'accepted-kiz',
      updatedAt,
    };

    await expect(
      (service as any).parkFbsTsdAssignmentFromClosedRequest(task),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ghost-task',
        status: 'IN_PROGRESS',
        deviceCode: 'TSD-INSTALL-8F4AD3F8D15EA12C',
        workerUserId: 'worker-valeron',
        updatedAt,
      },
      data: expect.objectContaining({
        status: 'RETURN_REQUIRED',
        deviceCode: 'AUTO:FBS:PALLET_SORT',
        workerUserId: null,
        workerName: null,
      }),
    });
  });

  // TEST: duplicate active Ozon connections return the same posting twice and
  // used to double the requested quantity in one FBS request.
  it('rejects a second active Ozon connection with the same Client-Id', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'existing-ozon-connection' });
    const service = new MarketplaceConnectionsService({
      clientMarketplaceConnection: { findFirst },
    } as never, {} as never);

    await expect(
      (service as any).requireUniqueActiveOzonSeller({
        clientId: 'client-bushkova',
        marketplace: MarketplaceType.OZON,
        sellerId: ' 4732619 ',
        isActive: true,
      }),
    ).rejects.toThrow('Ozon Client-Id 4732619 уже подключён');
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        clientId: 'client-bushkova',
        marketplace: MarketplaceType.OZON,
        sellerId: '4732619',
        isActive: true,
      },
      select: { id: true },
    });
  });

  // ADDED: A saved empty assignment cannot bypass the WB `confirm` queue filter.
  it('releases an untouched WB task while the order is temporarily new', async () => {
    const updatedAt = new Date('2026-08-16T11:53:22.000Z');
    const prisma = {
      fbsOrderRequestLink: {
        findUnique: vi.fn().mockResolvedValue({
          syncStatus: 'ACTIVE',
          lastCategory: 'active',
          lastSupplierStatus: 'new',
          request: { fbsEmergencyAssemblyAt: null },
        }),
      },
      fbsTsdAssembly: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const task = {
      id: 'task-new',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      orderId: '5491216813',
      status: 'IN_PROGRESS',
      deviceCode: 'TSD-1',
      workerUserId: 'worker-1',
      workerName: 'Сборщик',
      updatedAt,
      reservedBoxId: null,
      boxId: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
    };

    await expect(
      (service as any).releaseUntouchedFbsTsdAssignmentAwaitingWbConfirmation(
        task,
        { id: 'worker-1', name: 'Сборщик' },
      ),
    ).resolves.toBe(true);
    expect(prisma.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'task-new',
        status: 'IN_PROGRESS',
        workerUserId: 'worker-1',
        updatedAt,
        boxId: null,
        barcode: null,
        kiz: null,
      }),
      data: expect.objectContaining({
        status: 'RELEASED',
        workerUserId: null,
        workerName: null,
      }),
    });
  });

  // ADDED: Confirmed orders continue through the existing assignment path.
  it('keeps an untouched WB task when the order is confirm', async () => {
    const prisma = {
      fbsOrderRequestLink: {
        findUnique: vi.fn().mockResolvedValue({
          syncStatus: 'ACTIVE',
          lastCategory: 'active',
          lastSupplierStatus: 'confirm',
          request: { fbsEmergencyAssemblyAt: null },
        }),
      },
      fbsTsdAssembly: { updateMany: vi.fn() },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await expect(
      (service as any).releaseUntouchedFbsTsdAssignmentAwaitingWbConfirmation(
        {
          id: 'task-confirm',
          marketplace: MarketplaceType.WILDBERRIES,
          connectionId: 'connection-1',
          orderId: 'order-confirm',
          status: 'IN_PROGRESS',
          deviceCode: 'TSD-1',
          workerUserId: 'worker-1',
          updatedAt: new Date(),
          reservedBoxId: null,
          boxId: null,
          sourceBarcode: null,
          barcode: null,
          kiz: null,
        },
        { id: 'worker-1', name: 'Сборщик' },
      ),
    ).resolves.toBe(false);
    expect(prisma.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  });

  // ADDED: Physical work is never discarded when WB changes status mid-task.
  it('keeps a physically started WB task even when the order becomes new', async () => {
    const prisma = {
      fbsOrderRequestLink: { findUnique: vi.fn() },
      fbsTsdAssembly: { updateMany: vi.fn() },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await expect(
      (service as any).releaseUntouchedFbsTsdAssignmentAwaitingWbConfirmation(
        {
          id: 'task-scanned',
          marketplace: MarketplaceType.WILDBERRIES,
          connectionId: 'connection-1',
          orderId: 'order-scanned',
          status: 'IN_PROGRESS',
          deviceCode: 'TSD-1',
          workerUserId: 'worker-1',
          updatedAt: new Date(),
          reservedBoxId: null,
          boxId: 'box-1',
          sourceBarcode: null,
          barcode: '2049190574845',
          kiz: null,
        },
        { id: 'worker-1', name: 'Сборщик' },
      ),
    ).resolves.toBe(false);
    expect(prisma.fbsOrderRequestLink.findUnique).not.toHaveBeenCalled();
    expect(prisma.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
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

  // TEST: Global access must not bypass the warehouse-level "do not process"
  // rule, otherwise an administrator can still select excluded WB orders.
  it('hides orders from excluded WB warehouses even for administrators', async () => {
    const excludedOrder = fbsOrder({
      id: '5355000001',
      warehouseId: 'wb-warehouse-excluded',
      warehouseName: 'Не обслуживаем',
    });
    const allowedOrder = fbsOrder({
      id: '5355000002',
      warehouseId: 'wb-warehouse-allowed',
      warehouseName: 'Обслуживаем',
    });
    const prisma = {
      fbsWarehouseRoutingRule: {
        findMany: vi.fn().mockResolvedValue([
          {
            connectionId: 'connection-1',
            marketplaceWarehouseId: 'wb-warehouse-excluded',
          },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const response = {
      connected: true,
      connections: [{ id: 'connection-1' }],
      counts: { active: 2, shipped: 0, cancelled: 0, archive: 0, all: 2 },
      orders: [excludedOrder, allowedOrder],
    };

    const result = await (service as any).scopeFbsOrdersForUser(response, {
      id: 'admin-1',
      roleCodes: ['ADMIN'],
      permissionCodes: ['system:admin'],
    });

    expect(result.orders.map((order: { id: string }) => order.id)).toEqual(['5355000002']);
    expect(result.counts).toEqual({
      active: 1,
      shipped: 0,
      cancelled: 0,
      archive: 0,
      all: 1,
    });
    expect(prisma.fbsWarehouseRoutingRule.findMany).toHaveBeenCalledWith({
      where: {
        connectionId: { in: ['connection-1'] },
        marketplaceWarehouseId: { in: ['wb-warehouse-excluded', 'wb-warehouse-allowed'] },
        mode: 'EXCLUDED',
      },
      select: {
        connectionId: true,
        marketplaceWarehouseId: true,
      },
    });
  });

  it('hides completed TSD orders and requests without remaining FBS work', async () => {
    const request54 = {
      id: 'request-54',
      number: 54,
      title: 'FBS — 1 заказ',
      status: ClientRequestStatus.IN_WORK,
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
    };
    const request55 = {
      id: 'request-55',
      number: 55,
      title: 'FBS — 2 заказа',
      status: ClientRequestStatus.IN_WORK,
      client: request54.client,
    };
    const link = (
      request: typeof request54,
      orderId: string,
      skuId: string,
    ) => ({
      requestId: request.id,
      connectionId: 'connection-1',
      orderId,
      lastCategory: 'active',
      lastSupplierStatus: 'confirm',
      lastSupplyId: 'WB-GI-1',
      lastSkuId: skuId,
      request,
    });
    const prisma = {
      fbsTsdAssembly: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([
          {
            requestId: request54.id,
            connectionId: 'connection-1',
            orderId: 'order-54-done',
            status: 'COMPLETED',
          },
          {
            requestId: request55.id,
            connectionId: 'connection-1',
            orderId: 'order-55-done',
            status: 'COMPLETED',
          },
        ]),
      },
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([
          link(request54, 'order-54-done', 'sku-54'),
          link(request55, 'order-55-done', 'sku-55-done'),
          link(request55, 'order-55-active', 'sku-55-active'),
        ]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            skuId: 'sku-55-active',
            clientId: 'client-1',
            boxId: 'box-1',
          },
        ]),
      },
      client: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const clientScopes = {
      resolveClientFilter: vi.fn().mockReturnValue({ in: ['client-1'] }),
      requireClientAccess: vi.fn(),
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      clientScopes as never,
    );

    const result = await service.listFbsTsdRequests('TSD-1', {
      id: 'worker-1',
      name: 'Сборщик',
    } as never);

    expect(result.requests).toEqual([
      expect.objectContaining({
        requestId: request55.id,
        requestNumber: 55,
        totalOrders: 1,
        readyOrders: 1,
        completedOrders: 0,
      }),
    ]);
  });

  it('shows an Ozon awaiting-packaging order as ready in the TSD request queue', async () => {
    const request = {
      id: 'request-139',
      number: 139,
      title: 'FBS Ozon — 1 заказ',
      status: ClientRequestStatus.IN_WORK,
      fbsEmergencyAssemblyAt: null,
      fbsEmergencyAssemblyByName: null,
      client: { id: 'client-ozon', code: 'CL-OZON', name: 'Ozon клиент' },
    };
    const prisma = {
      fbsTsdAssembly: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([
          {
            requestId: request.id,
            marketplace: MarketplaceType.OZON,
            connectionId: 'connection-ozon',
            orderId: '59639100-0681-1',
            lastCategory: 'active',
            lastSupplierStatus: 'awaiting_packaging',
            lastSupplyId: null,
            lastSkuId: 'sku-ozon',
            request,
          },
        ]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { skuId: 'sku-ozon', clientId: 'client-ozon', boxId: 'box-ozon' },
        ]),
      },
      client: { findMany: vi.fn().mockResolvedValue([]) },
      sku: { findMany: vi.fn() },
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      {
        resolveClientFilter: vi.fn().mockReturnValue('client-ozon'),
        requireClientAccess: vi.fn(),
      } as never,
    );

    await expect(
      service.listFbsTsdRequests('TSD-OZON', {
        id: 'worker-ozon',
        name: 'Сборщик Ozon',
      } as never),
    ).resolves.toMatchObject({
      requests: [
        {
          requestId: 'request-139',
          marketplaces: [MarketplaceType.OZON],
          totalOrders: 1,
          readyOrders: 1,
          awaitingWbConfirmation: 0,
          noAvailableStock: 0,
        },
      ],
    });
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
            pricingVersion: 7,
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
    const sameDayResult = await (service as any).ensureFbsProcessingCharges(
      'client-1',
      [
        {
          id: '1101',
          marketplace: MarketplaceType.WILDBERRIES,
          connectionId: 'connection-1',
          category: 'shipped',
          itemCount: 1,
          deliveryDate: '2026-07-20T10:00:00Z',
          supplyId: 'WB-GI-A',
        },
        {
          id: '1102',
          marketplace: MarketplaceType.WILDBERRIES,
          connectionId: 'connection-1',
          category: 'shipped',
          itemCount: 1,
          deliveryDate: '2026-07-20T15:00:00Z',
          supplyId: 'WB-GI-B',
        },
      ],
    );
    const sameDayCharges = prisma.billingCharge.create.mock.calls.map((call) => call[0].data);
    expect(sameDayCharges).toHaveLength(2);
    expect(sameDayCharges[0]).toMatchObject({
      totalRub: 1839.89,
      metadata: expect.objectContaining({
        logisticsTrip: expect.objectContaining({
          billingDay: '2026-07-20',
          automaticPrimary: true,
          charged: true,
          logisticsItems: 2,
        }),
      }),
    });
    expect(sameDayCharges[1]).toMatchObject({
      totalRub: 244.15,
      metadata: expect.objectContaining({
        logisticsTrip: expect.objectContaining({
          billingDay: '2026-07-20',
          automaticPrimary: false,
          extraTripOverride: false,
          charged: false,
          logisticsRub: 1595.74,
        }),
        quote: expect.objectContaining({
          deliveryPrice: 0,
          totalWithTax: 244.15,
        }),
      }),
    });
    expect(sameDayResult.get('WILDBERRIES:connection-1:1102')).toMatchObject({
      totalRub: 244.15,
      breakdown: expect.objectContaining({ deliveryRub: 0 }),
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
            pricingVersion: 7,
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

    prisma.clientFbsBillingSettings.upsert.mockResolvedValue({
      id: 'settings-1',
      clientId: 'client-1',
      turnkeyEnabled: false,
      turnkeyUnitPriceRub: new Prisma.Decimal(0),
      fixedPlusLogisticsEnabled: true,
      fixedPlusLogisticsUnitPriceRub: new Prisma.Decimal(50),
      fixedPlusLogisticsDestination: 'Казань',
      boxCapacityItems: 14,
      boxFormationServiceId: formationService.id,
      boxMaterialServiceId: boxService.id,
      palletsEnabled: false,
      boxesPerPallet: 16,
      palletServiceId: null,
      additionalServices: [],
    });
    prisma.billingCharge.create.mockClear();
    const logistics = {
      quote: vi.fn().mockResolvedValue({
        route: { origin: 'Москва', destination: 'Казань' },
        estimatedTotalRub: 1000,
        requiresManualReview: false,
      }),
    };
    const fixedPlusLogisticsService = new MarketplaceConnectionsService(
      prisma as never,
      {} as never,
      undefined,
      logistics as never,
    );
    const fixedPlusLogisticsResult = await (fixedPlusLogisticsService as any)
      .ensureFbsProcessingCharges('client-1', [
        {
          id: '4001',
          marketplace: MarketplaceType.WILDBERRIES,
          connectionId: 'connection-1',
          category: 'shipped',
          itemCount: 10,
          createdAt: '2026-07-19T10:00:00Z',
          sellerDate: '2026-07-19T11:00:00Z',
          deliveryDate: '2026-07-19T12:00:00Z',
          supplyId: 'WB-GI-4',
        },
      ]);

    expect(logistics.quote).toHaveBeenCalledWith({
      destination: 'Казань',
      boxes: 1,
    });
    expect(prisma.billingCharge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 10,
          unitPriceRub: 156.38,
          totalRub: 1563.83,
          metadata: expect.objectContaining({
            pricingVersion: 7,
            calculator: 'CLIENT_FIXED_PLUS_LOGISTICS',
            calculatorDestination: 'Казань',
            quote: expect.objectContaining({
              processingTotalRub: 500,
              deliveryPrice: 1000,
              deliveryWithTaxRub: 1063.83,
              totalWithTax: 1563.83,
            }),
          }),
        }),
      }),
    );
    expect(fixedPlusLogisticsResult.get('WILDBERRIES:connection-1:4001'))
      .toMatchObject({
        totalRub: 1563.83,
        breakdown: expect.objectContaining({
          fbsProcessingRub: 500,
          deliveryRub: 1063.83,
          boxFormationRub: 0,
          boxMaterialRub: 0,
        }),
      });
  });

  it('recalculates cached draft FBS charges immediately after a pricing mode change', async () => {
    const service = new MarketplaceConnectionsService({} as never, {} as never);
    const shippedOrder = {
      id: '1001',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      category: 'shipped',
      billing: null,
    };
    (service as any).fbsOrdersCache.set('client-1', {
      expiresAt: Date.now() + 60_000,
      value: {
        orders: [shippedOrder],
      },
    });
    vi.spyOn(service as any, 'ensureFbsProcessingCharges').mockResolvedValue(
      new Map([
        [
          'WILDBERRIES:connection-1:1001',
          {
            chargeId: 'charge-1',
            status: 'DRAFT',
            unitPriceRub: 50,
            totalRub: 50,
            invoiceNumber: 'FBS-202607-0001',
            invoiceStatus: 'DRAFT',
            breakdown: {},
          },
        ],
      ]),
    );

    const result = await service.recalculateFbsDraftBilling('client-1');

    expect((service as any).ensureFbsProcessingCharges).toHaveBeenCalledWith(
      'client-1',
      [shippedOrder],
    );
    expect(result).toEqual({
      recalculatedCharges: 1,
      recalculatedInvoices: 1,
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
      marketplace: 'WILDBERRIES',
      partA: '12345',
      partB: '9753',
      barcode: 'WB123',
      contentType: 'image/png',
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

  it('scopes saved TSD orders by request without filtering marketplace cabinets', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ id: 'client-1', code: 'CL-1', name: 'Клиент' }),
      },
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadFbsDeliveryPlan').mockResolvedValue({
      destination: FbsDeliveryDestination.PICKUP_POINT,
      itemsPerCargoPlace: 2000,
      requiresCargoPlaces: true,
    });

    await (service as any).loadFbsTsdRequestOrders(
      'client-1',
      'request-32',
      ['sku-in-scanned-box'],
    );

    expect(prisma.clientMarketplaceConnection.findMany).toHaveBeenCalledWith({
      where: expect.not.objectContaining({ requestId: expect.anything() }),
      select: expect.any(Object),
      orderBy: expect.any(Array),
    });
    expect(prisma.fbsOrderRequestLink.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        requestId: 'request-32',
        lastSkuId: { in: ['sku-in-scanned-box'] },
      }),
    }));
  });

  it('switches an untouched TSD task using a saved request order omitted from the live WB feed', async () => {
    const currentTask = {
      id: 'task-current',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      orderId: 'order-current',
      requestId: 'request-32',
      deviceCode: 'USER:worker-1',
      workerUserId: 'worker-1',
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
        findMany: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { itemCount: 0 } }),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([{ skuId: 'sku-black', quantity: 30 }]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 30 } }),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const savedOrder = {
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
      };
    const loadLiveOrders = vi.spyOn(service as any, 'loadFbsOrders').mockResolvedValue({
      orders: [],
      counts: { active: 0, shipped: 0, cancelled: 0, archive: 0, all: 0 },
    });
    const loadSavedOrders = vi.spyOn(service as any, 'loadFbsTsdRequestOrders').mockResolvedValue({
      orders: [savedOrder],
      counts: { active: 1, shipped: 0, cancelled: 0, archive: 0, all: 1 },
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
    // ADDED: regression — a direct box scan must stay inside the selected local
    // request and must not wait for a Wildberries network refresh.
    expect(loadSavedOrders).toHaveBeenCalledWith('client-1', 'request-32', ['sku-black']);
    expect(loadLiveOrders).not.toHaveBeenCalled();
  });

  // TEST: a virtual route on another online TSD must not hide the order from
  // the employee who physically scans the required box first.
  it('switches a physically scanned box from another untouched active TSD route', async () => {
    const currentTask = {
      id: 'task-current',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      orderId: 'order-current',
      requestId: 'request-469',
      supplyId: 'WB-GI-469',
      skuId: 'sku-current',
      sourceSkuId: null,
      itemCount: 1,
      deviceCode: 'TSD-WORKER-1',
      workerUserId: 'worker-1',
      workerName: 'Первый сборщик',
      status: 'IN_PROGRESS',
      reservedBoxId: 'box-current',
      boxId: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
      relabelConfirmedAt: null,
    };
    const targetTask = {
      ...currentTask,
      id: 'task-target',
      orderId: 'order-target',
      skuId: 'sku-in-scanned-box',
      deviceCode: 'TSD-WORKER-2',
      workerUserId: 'worker-2',
      workerName: 'Второй сборщик',
      reservedBoxId: 'box-scanned',
      reservedBoxCode: 'FFL_LKB0807_009',
    };
    const switchedTask = {
      ...targetTask,
      deviceCode: currentTask.deviceCode,
      workerUserId: currentTask.workerUserId,
      workerName: currentTask.workerName,
      boxId: 'box-scanned',
      boxCode: 'FFL_LKB0807_009',
    };
    const tx = {
      fbsTsdAssembly: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(currentTask)
          .mockResolvedValueOnce(targetTask),
        update: vi.fn()
          .mockResolvedValueOnce({ ...currentTask, status: 'RESERVED' })
          .mockResolvedValueOnce(switchedTask),
      },
    };
    const findMany = vi.fn(async ({ where }: { where: { status?: { in?: string[] } } }) =>
      where.status?.in?.includes('IN_PROGRESS') ? [targetTask] : [],
    );
    const prisma = {
      fbsTsdAssembly: { findMany },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { skuId: 'sku-in-scanned-box', quantity: 1 },
        ]),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'fbsTsdReservationRows').mockResolvedValue([]);
    vi.spyOn(service as any, 'loadFbsTsdRequestOrders').mockResolvedValue({
      orders: [],
      counts: { active: 0, shipped: 0, cancelled: 0, archive: 0, all: 0 },
    });
    vi.spyOn(service as any, 'loadFbsOrders').mockResolvedValue({
      orders: [],
      counts: { active: 0, shipped: 0, cancelled: 0, archive: 0, all: 0 },
    });
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(
      async (task: unknown, _user: unknown, message: string) => ({ task, message }),
    );

    await expect(
      (service as any).switchFbsTsdAssemblyToBox(
        currentTask,
        { id: 'box-scanned', code: 'FFL_LKB0807_009' },
        { id: 'worker-1', name: 'Первый сборщик', deviceCode: 'TSD-WORKER-1' },
      ),
    ).resolves.toMatchObject({
      task: {
        id: 'task-target',
        workerUserId: 'worker-1',
        boxId: 'box-scanned',
      },
      message: expect.stringContaining('Короб FFL_LKB0807_009 нужен заявке'),
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: expect.objectContaining({ in: expect.arrayContaining(['IN_PROGRESS']) }),
        boxId: null,
        sourceBarcode: null,
        barcode: null,
        kiz: null,
      }),
    }));
  });

  it('переключается на любой нужный товар по ШК, даже если он не следующий по маршруту', async () => {
    const currentTask = {
      id: 'task-current',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      orderId: 'order-current',
      requestId: 'request-175',
      status: 'IN_PROGRESS',
      deviceCode: 'USER:worker',
      reservedBoxId: 'box-current',
      boxId: null,
      boxCode: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
      relabelConfirmedAt: null,
      relabelRequired: false,
      barcodes: ['4600000000001'],
    };
    const targetTask = {
      ...currentTask,
      id: 'task-target',
      orderId: '5430005935',
      status: 'RESERVED',
      reservedBoxId: 'box-target',
      reservedBoxCode: 'FFL_LKB1107_370',
      barcodes: ['4600000000099'],
    };
    const updatedTarget = {
      ...targetTask,
      status: 'IN_PROGRESS',
      deviceCode: 'USER:worker',
      workerUserId: 'worker-1',
      workerName: 'Сборщик',
      barcode: '4600000000099',
    };
    const tx = {
      fbsTsdAssembly: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(currentTask)
          .mockResolvedValueOnce(targetTask),
        update: vi.fn()
          .mockResolvedValueOnce({ ...currentTask, status: 'RESERVED' })
          .mockResolvedValueOnce(updatedTarget),
      },
    };
    const prisma = {
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([currentTask, targetTask]),
      },
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(
      async (task: unknown, _user: unknown, message: string) => ({ task, message }),
    );

    await expect(
      (service as any).switchFbsTsdAssemblyToBarcode(
        currentTask,
        ']C14600000000099',
        { id: 'worker-1', name: 'Сборщик' },
      ),
    ).resolves.toMatchObject({
      task: { id: 'task-target', orderId: '5430005935', barcode: '4600000000099' },
      message: expect.stringContaining('нужен для заказа №5430005935'),
    });
    expect(tx.fbsTsdAssembly.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'task-current' },
      data: expect.objectContaining({
        status: 'RESERVED',
        boxId: null,
        boxCode: null,
      }),
    });
    expect(tx.fbsTsdAssembly.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'task-target' },
      data: expect.objectContaining({
        status: 'IN_PROGRESS',
        barcode: '4600000000099',
        workerUserId: 'worker-1',
      }),
    });
  });

  it('considers shipped WB orders when switching boxes for an emergency request', async () => {
    const service = new MarketplaceConnectionsService({} as never, {} as never);
    const product = {
      id: 'sku-red-l',
      name: 'Спортивный костюм',
      article: 'springs-red',
      clientSku: null,
      internalSku: 'springs-red-L',
      needsChestnyZnak: false,
      isUnmarked: true,
    };
    vi.spyOn(service as any, 'loadFbsOrders').mockResolvedValue({
      orders: [
        {
          id: '5390458295',
          marketplace: MarketplaceType.WILDBERRIES,
          connectionId: 'connection-1',
          category: 'shipped',
          supplierStatus: 'complete',
          request: {
            id: 'request-65',
            status: 'IN_WORK',
            fbsEmergencyAssemblyAt: new Date('2026-07-29T09:32:59.589Z'),
          },
          product,
          storageBoxes: [
            {
              code: 'FFL_LKB0106_0124',
              status: 'AVAILABLE',
              quantity: 26,
            },
          ],
          relabeling: null,
          requiredMeta: [],
          optionalMeta: [],
          barcodes: ['4600000000001'],
          itemCount: 1,
          supplyId: 'WB-GI-259464259',
          createdAt: '2026-07-29T08:00:00Z',
        },
      ],
    });
    vi.spyOn(service as any, 'loadFbsTsdRequestOrders').mockResolvedValue({
      orders: [],
    });
    const resolveStock = vi
      .spyOn(service as any, 'resolveFbsTsdStockSource')
      .mockResolvedValue(null);

    const result = await (service as any).switchFbsTsdAssemblyToBox(
      {
        id: 'task-current',
        clientId: 'client-1',
        marketplace: MarketplaceType.WILDBERRIES,
        connectionId: 'connection-1',
        orderId: 'order-current',
        requestId: 'request-65',
      },
      { id: 'box-124', code: 'FFL_LKB0106_0124' },
      { id: 'worker-1', name: 'Сборщик' },
    );

    expect(resolveStock).toHaveBeenCalledWith('client-1', product, [
      {
        code: 'FFL_LKB0106_0124',
        status: 'AVAILABLE',
        quantity: 26,
      },
    ]);
    expect(result).toBeNull();
  });

  it('switches to a relabeling order when its source product is stored in the scanned box', async () => {
    const currentTask = {
      id: 'task-current',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      orderId: 'order-current',
      requestId: 'request-43',
      deviceCode: 'USER:worker',
      status: 'IN_PROGRESS',
      boxId: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
    };
    const switchedTask = {
      ...currentTask,
      id: 'task-relabel',
      orderId: '5373735382',
      skuId: 'sku-new-blue-xl',
      sourceSkuId: 'sku-blue-xl',
      boxId: 'box-31',
      boxCode: 'FFL_LKB25_031',
      relabelRequired: true,
    };
    const untouchedTarget = {
      ...switchedTask,
      deviceCode: 'USER:other-worker',
      status: 'IN_PROGRESS',
      boxId: null,
      boxCode: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
      relabelConfirmedAt: null,
    };
    const tx = {
      fbsTsdAssembly: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(untouchedTarget)
          .mockResolvedValueOnce(currentTask),
        update: vi.fn().mockImplementation(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
            where.id === 'task-relabel'
              ? { ...untouchedTarget, ...data }
              : { ...currentTask, ...data },
        ),
        create: vi.fn().mockResolvedValue(switchedTask),
      },
    };
    const prisma = {
      clientRequestItem: {
        findFirst: vi.fn().mockResolvedValue({ id: 'request-item-new-blue-xl' }),
      },
      fbsTsdAssembly: {
        findUnique: vi.fn().mockResolvedValue(untouchedTarget),
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockBalance: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 20 } }),
      },
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      {} as never,
    );
    vi.spyOn(service as any, 'loadFbsOrders').mockResolvedValue({
      orders: [
        {
          id: '5373735382',
          marketplace: MarketplaceType.WILDBERRIES,
          connectionId: 'connection-1',
          category: 'active',
          supplierStatus: 'confirm',
          request: { id: 'request-43', status: 'IN_WORK' },
          product: {
            id: 'sku-new-blue-xl',
            name: 'Костюм летний брючный оверсайз',
            article: 'новый_корея_2голубой',
            clientSku: null,
            internalSku: 'новый_корея_2голубой-XL / 48',
            needsChestnyZnak: true,
            isUnmarked: false,
          },
          storageBoxes: [
            {
              code: 'FFL_LKB25_031',
              status: 'AVAILABLE',
              quantity: 20,
            },
          ],
          relabeling: {
            required: true,
            sourceSkuId: 'sku-blue-xl',
            sourceProductName: 'Костюм летний брючный оверсайз',
            sourceArticle: 'Корея_2голубой',
            sourceBarcodes: ['2049156013562'],
          },
          requiredMeta: ['sgtin'],
          optionalMeta: [],
          barcodes: ['2053651729767'],
          itemCount: 1,
          supplyId: 'WB-GI-258491048',
          createdAt: '2026-07-25T10:00:00Z',
        },
      ],
    });
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(
      async (task: unknown, _user: unknown, message: string) => ({
        task,
        message,
      }),
    );

    const result = await (service as any).switchFbsTsdAssemblyToBox(
      currentTask,
      { id: 'box-31', code: 'FFL_LKB25_031' },
      { id: 'worker-1', name: 'Сборщик' },
    );

    expect(prisma.stockBalance.aggregate).toHaveBeenCalledWith({
      where: expect.objectContaining({ skuId: 'sku-blue-xl', boxId: 'box-31' }),
      _sum: { quantity: true },
    });
    expect(tx.fbsTsdAssembly.update).toHaveBeenCalledWith({
      where: { id: 'task-relabel' },
      data: expect.objectContaining({
        orderId: '5373735382',
        skuId: 'sku-new-blue-xl',
        sourceSkuId: 'sku-blue-xl',
        boxCode: 'FFL_LKB25_031',
        relabelRequired: true,
      }),
    });
    expect(tx.fbsTsdAssembly.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      task: {
        orderId: '5373735382',
        boxCode: 'FFL_LKB25_031',
        relabelRequired: true,
      },
      message: expect.stringContaining('Найдите исходный товар'),
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
              ? { trbxIds: ['WB-TRBX-1'] }
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
        itemsPerCargoPlace: FBS_UNLIMITED_CARGO_PLACE_CAPACITY,
        requiresCargoPlaces: true,
      },
      supplies: [
        {
          id: 'supply-1',
          connectionId: connection.id,
          orderIds: selectedOrders.map((order) => order.id),
          itemCount: 15,
          cargoPlaceCount: 1,
          cargoPlaceIds: ['WB-TRBX-1'],
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
        body: JSON.stringify({ amount: 1 }),
      }),
    );
    expect(prisma.fbsSupplyPlan.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          supplyId: 'supply-1',
          deliveryDestination: 'PICKUP_POINT',
          itemsPerCargoPlace: FBS_UNLIMITED_CARGO_PLACE_CAPACITY,
          orderIds: selectedOrders.map((order) => order.id),
        }),
      }),
    );
    expect(prisma.fbsSupplyPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          cargoPlaceCount: 1,
          cargoPlaceIds: ['WB-TRBX-1'],
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

  // TEST: request 424 contains active confirm/waiting orders without a WB supply.
  it.each([
    ['new', 'Новый'],
    ['confirm', 'На сборке'],
  ])('moves a linked %s/waiting WB order without a supply to a new supply and WMS request', async (supplierStatus, statusLabel) => {
    const order = {
      id: '5355000001',
      connectionId: 'connection-1',
      marketplace: MarketplaceType.WILDBERRIES,
      category: 'active',
      supplierStatus,
      wbStatus: 'waiting',
      statusLabel,
      supplyId: null,
      warehouseId: '1935323',
      warehouseName: 'СЦ Белая дача',
      itemCount: 1,
      barcodes: ['460000000001'],
      product: {
        id: 'sku-1',
        name: 'Костюм',
        internalSku: 'SKU-1',
        clientSku: null,
        article: 'ART-1',
      },
    };
    const sourceRequest = {
      id: 'request-old',
      number: 31,
      status: ClientRequestStatus.IN_WORK,
    };
    const tx = {
      clientRequest: {
        create: vi.fn().mockResolvedValue({
          id: 'request-new',
          number: 32,
          title: 'FBS — 1 заказ(а/ов)',
          status: ClientRequestStatus.SUBMITTED,
          items: [{ id: 'item-new', skuId: 'sku-1', name: 'Костюм', quantity: 1 }],
        }),
      },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
      fbsOrderRequestLink: { update: vi.fn().mockResolvedValue({}) },
      fbsTsdAssembly: { update: vi.fn() },
      fbsSupplyPlan: {
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'link-1',
            clientId: 'client-1',
            marketplace: MarketplaceType.WILDBERRIES,
            connectionId: 'connection-1',
            orderId: order.id,
            requestId: sourceRequest.id,
            syncStatus: 'ACTIVE',
            request: sourceRequest,
          },
        ]),
      },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
      fbsSupplyPlan: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'plan-old',
          clientId: 'client-1',
          marketplace: MarketplaceType.WILDBERRIES,
          connectionId: 'connection-1',
          supplyId: 'WB-GI-OLD',
          deliveryDestination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
          itemsPerCargoPlace: 14,
          cargoPlaceIds: [],
          cargoPlaceBarcodes: {},
        }),
      },
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'connection-1',
            clientId: 'client-1',
            marketplace: MarketplaceType.WILDBERRIES,
            apiKey: 'secret-key',
            isActive: true,
            client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
          },
        ]),
      },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );
    vi.spyOn(service as any, 'loadFbsDeliveryPlan').mockResolvedValue({
      destination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
      itemsPerCargoPlace: 14,
      requiresCargoPlaces: false,
    });
    vi.spyOn(service as any, 'resolveFbsRequestWarehouseId').mockResolvedValue(null);
    const syncRequests = vi
      .spyOn(service as any, 'syncFbsRequestsFromMarketplace')
      .mockResolvedValue(undefined);
    vi.spyOn(service as any, 'refreshFbsOrdersCache').mockResolvedValue({
      orders: [order],
    });
    vi.spyOn(service as any, 'resolveSelectedFbsOrders').mockResolvedValue({
      response: {
        client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
        connected: true,
        connections: [],
        fetchedAt: new Date().toISOString(),
        deliveryPlan: {
          destination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
          itemsPerCargoPlace: 14,
          requiresCargoPlaces: false,
        },
        counts: { active: 1, shipped: 0, cancelled: 0, archive: 0, all: 1 },
        orders: [order],
      },
      orders: [order],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith('/api/v3/supplies') ? { id: 'WB-GI-NEW' } : {},
      } as Response)),
    );

    const result = await service.moveFbsOrdersToNewSupply(
      {
        clientId: 'client-1',
        orders: [{ connectionId: 'connection-1', id: order.id }],
      },
      { id: 'user-1', name: 'Администратор' } as never,
    );

    expect(result).toMatchObject({
      moved: 1,
      sourceSupplyId: null,
      sourceSupplyIds: [],
      targetSupply: { id: 'WB-GI-NEW', cargoPlaceCount: 0 },
      sourceRequest: { id: 'request-old', number: 31 },
      targetRequest: { id: 'request-new', number: 32 },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://marketplace-api.wildberries.ru/api/marketplace/v3/supplies/WB-GI-NEW/orders',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ orders: [5355000001] }),
      }),
    );
    expect(tx.fbsOrderRequestLink.update).toHaveBeenCalledWith({
      where: { id: 'link-1' },
      data: expect.objectContaining({
        requestId: 'request-new',
        lastSupplyId: 'WB-GI-NEW',
        syncStatus: 'MOVING',
      }),
    });
    expect(tx.fbsSupplyPlan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        supplyId: 'WB-GI-NEW',
        marketplaceWarehouseId: '1935323',
        orderIds: [order.id],
      }),
    });
    expect(prisma.fbsSupplyPlan.findUnique).not.toHaveBeenCalled();
    expect(syncRequests).toHaveBeenCalledWith(
      'client-1',
      expect.arrayContaining([
        expect.objectContaining({
          id: order.id,
          supplierStatus: 'confirm',
          supplyId: 'WB-GI-NEW',
        }),
      ]),
      ['request-old', 'request-new'],
    );
  });

  it('merges unstarted FBS orders from multiple WMS requests and WB supplies', async () => {
    const orders = [
      {
        id: '5355000101',
        connectionId: 'connection-1',
        marketplace: MarketplaceType.WILDBERRIES,
        category: 'active',
        supplierStatus: 'confirm',
        wbStatus: 'waiting',
        statusLabel: 'На сборке',
        supplyId: 'WB-GI-OLD-1',
        itemCount: 1,
        barcodes: ['460000000101'],
        product: {
          id: 'sku-1',
          name: 'Костюм 1',
          internalSku: 'SKU-1',
          clientSku: null,
          article: 'ART-1',
        },
      },
      {
        id: '5355000102',
        connectionId: 'connection-1',
        marketplace: MarketplaceType.WILDBERRIES,
        category: 'active',
        supplierStatus: 'confirm',
        wbStatus: 'waiting',
        statusLabel: 'На сборке',
        supplyId: 'WB-GI-OLD-2',
        itemCount: 1,
        barcodes: ['460000000102'],
        product: {
          id: 'sku-2',
          name: 'Костюм 2',
          internalSku: 'SKU-2',
          clientSku: null,
          article: 'ART-2',
        },
      },
    ];
    const sourceRequests = [
      { id: 'request-old-1', number: 31, status: ClientRequestStatus.IN_WORK },
      { id: 'request-old-2', number: 35, status: ClientRequestStatus.IN_WORK },
    ];
    const tx = {
      clientRequest: {
        create: vi.fn().mockResolvedValue({
          id: 'request-new',
          number: 36,
          title: 'FBS — 2 заказ(а/ов)',
          status: ClientRequestStatus.SUBMITTED,
          items: [
            { id: 'item-new-1', skuId: 'sku-1', name: 'Костюм 1', quantity: 1 },
            { id: 'item-new-2', skuId: 'sku-2', name: 'Костюм 2', quantity: 1 },
          ],
        }),
      },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
      fbsOrderRequestLink: { update: vi.fn().mockResolvedValue({}) },
      fbsTsdAssembly: { update: vi.fn() },
      fbsSupplyPlan: {
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const sourcePlans = [
      {
        id: 'plan-old-1',
        clientId: 'client-1',
        marketplace: MarketplaceType.WILDBERRIES,
        connectionId: 'connection-1',
        supplyId: 'WB-GI-OLD-1',
        deliveryDestination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
        itemsPerCargoPlace: 14,
        cargoPlaceIds: [],
        cargoPlaceBarcodes: {},
      },
      {
        id: 'plan-old-2',
        clientId: 'client-1',
        marketplace: MarketplaceType.WILDBERRIES,
        connectionId: 'connection-1',
        supplyId: 'WB-GI-OLD-2',
        deliveryDestination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
        itemsPerCargoPlace: 14,
        cargoPlaceIds: [],
        cargoPlaceBarcodes: {},
      },
    ];
    const prisma = {
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue(
          orders.map((order, index) => ({
            id: `link-${index + 1}`,
            clientId: 'client-1',
            marketplace: MarketplaceType.WILDBERRIES,
            connectionId: 'connection-1',
            orderId: order.id,
            requestId: sourceRequests[index]!.id,
            syncStatus: 'ACTIVE',
            request: sourceRequests[index],
          })),
        ),
      },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
      fbsSupplyPlan: {
        findUnique: vi.fn().mockImplementation(
          ({ where }: { where: { marketplace_connectionId_supplyId: { supplyId: string } } }) =>
            sourcePlans.find(
              (plan) =>
                plan.supplyId ===
                where.marketplace_connectionId_supplyId.supplyId,
            ) ?? null,
        ),
      },
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'connection-1',
            clientId: 'client-1',
            marketplace: MarketplaceType.WILDBERRIES,
            apiKey: 'secret-key',
            isActive: true,
            client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
          },
        ]),
      },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );
    vi.spyOn(service as any, 'refreshFbsOrdersCache').mockResolvedValue({
      orders,
    });
    vi.spyOn(service as any, 'resolveSelectedFbsOrders').mockResolvedValue({
      response: {
        client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
        connected: true,
        connections: [],
        fetchedAt: new Date().toISOString(),
        deliveryPlan: {
          destination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
          itemsPerCargoPlace: 14,
          requiresCargoPlaces: false,
        },
        counts: { active: 2, shipped: 0, cancelled: 0, archive: 0, all: 2 },
        orders,
      },
      orders,
    });
    const syncRequests = vi
      .spyOn(service as any, 'syncFbsRequestsFromMarketplace')
      .mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith('/api/v3/supplies') ? { id: 'WB-GI-NEW' } : {},
      } as Response)),
    );

    const result = await service.moveFbsOrdersToNewSupply(
      {
        clientId: 'client-1',
        orders: orders.map((order) => ({
          connectionId: order.connectionId,
          id: order.id,
        })),
      },
      { id: 'user-1', name: 'Администратор' } as never,
    );

    expect(result).toMatchObject({
      moved: 2,
      sourceSupplyIds: ['WB-GI-OLD-1', 'WB-GI-OLD-2'],
      sourceRequests: [
        { id: 'request-old-1', number: 31 },
        { id: 'request-old-2', number: 35 },
      ],
      targetSupply: { id: 'WB-GI-NEW', cargoPlaceCount: 0 },
      targetRequest: { id: 'request-new', number: 36 },
    });
    expect(tx.fbsOrderRequestLink.update).toHaveBeenCalledTimes(2);
    expect(tx.fbsSupplyPlan.update).toHaveBeenCalledTimes(2);
    expect(tx.clientRequestEvent.create).toHaveBeenCalledTimes(3);
    expect(syncRequests).toHaveBeenCalledWith(
      'client-1',
      expect.arrayContaining([
        expect.objectContaining({ id: orders[0]!.id, supplyId: 'WB-GI-NEW' }),
        expect.objectContaining({ id: orders[1]!.id, supplyId: 'WB-GI-NEW' }),
      ]),
      ['request-old-1', 'request-old-2', 'request-new'],
    );
  });

  it('collects only active unprocessed WB orders from selected WMS requests', async () => {
    const activeOrder = {
      id: '5355000201',
      connectionId: 'connection-1',
      marketplace: MarketplaceType.WILDBERRIES,
      category: 'active',
      supplierStatus: 'confirm',
      statusLabel: 'На сборке',
      supplyId: 'WB-GI-OLD-1',
      product: { id: 'sku-1', name: 'Костюм 1' },
    };
    const shippedOrder = {
      id: '5355000202',
      connectionId: 'connection-1',
      marketplace: MarketplaceType.WILDBERRIES,
      category: 'shipped',
      supplierStatus: 'complete',
      statusLabel: 'В доставке',
      supplyId: 'WB-GI-OLD-2',
      product: { id: 'sku-2', name: 'Костюм 2' },
    };
    const prisma = {
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'request-old-1',
            number: 31,
            clientId: 'client-1',
            type: ClientRequestType.OUTBOUND,
            status: ClientRequestStatus.IN_WORK,
            fbsOrderLinks: [
              {
                connectionId: 'connection-1',
                orderId: activeOrder.id,
                syncStatus: 'ACTIVE',
              },
            ],
          },
          {
            id: 'request-old-2',
            number: 35,
            clientId: 'client-1',
            type: ClientRequestType.OUTBOUND,
            status: ClientRequestStatus.IN_WORK,
            fbsOrderLinks: [
              {
                connectionId: 'connection-1',
                orderId: shippedOrder.id,
                syncStatus: 'ACTIVE',
              },
            ],
          },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );
    vi.spyOn(service as any, 'refreshFbsOrdersCache').mockResolvedValue({
      orders: [activeOrder, shippedOrder],
    });
    const move = vi
      .spyOn(service, 'moveFbsOrdersToNewSupply')
      .mockResolvedValue({
        moved: 1,
        skipped: 0,
        skippedOrders: [],
        sourceSupplyId: 'WB-GI-OLD-1',
        sourceSupplyIds: ['WB-GI-OLD-1'],
        sourceRequest: { id: 'request-old-1', number: 31 },
        sourceRequests: [{ id: 'request-old-1', number: 31 }],
        targetSupply: {
          id: 'WB-GI-NEW',
          cargoPlaceCount: 0,
          cargoPlaceIds: [],
        },
        targetRequest: {
          id: 'request-new',
          number: 36,
          title: 'FBS — 1 заказ(а/ов)',
          status: ClientRequestStatus.SUBMITTED,
        },
        orders: { orders: [] },
      } as never);

    const result = await service.mergeFbsRequestTails(
      { requestIds: ['request-old-1', 'request-old-2'] },
      { id: 'user-1' } as never,
    );

    expect(move).toHaveBeenCalledWith(
      {
        clientId: 'client-1',
        orders: [
          { connectionId: 'connection-1', id: activeOrder.id },
        ],
      },
      { id: 'user-1' },
    );
    expect(result).toMatchObject({
      moved: 1,
      selectedRequestCount: 2,
      skipped: 1,
      skippedOrders: [
        { id: shippedOrder.id, reason: 'Текущий статус WB: В доставке.' },
      ],
    });
  });

  it('previews the exact FBS tail composition without moving orders', async () => {
    const order = {
      id: '5373735382',
      connectionId: 'connection-1',
      marketplace: MarketplaceType.WILDBERRIES,
      category: 'active',
      supplierStatus: 'confirm',
      statusLabel: 'На сборке',
      supplyId: 'WB-GI-258491048',
      itemCount: 1,
      article: 'новый_корея_2голубой',
      barcodes: ['2053651729767'],
      storageBoxes: [
        { code: 'FFL_LKB25_031', quantity: 20, status: 'AVAILABLE' },
      ],
      product: {
        id: 'sku-new-blue-xl',
        name: 'Костюм летний брючный оверсайз',
        internalSku: 'новый_корея_2голубой-XL / 48',
        clientSku: null,
        article: 'новый_корея_2голубой',
        size: 'XL / 48',
      },
    };
    const prisma = {
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'request-43',
            number: 43,
            clientId: 'client-1',
            type: ClientRequestType.OUTBOUND,
            status: ClientRequestStatus.IN_WORK,
            fbsOrderLinks: [
              {
                connectionId: 'connection-1',
                orderId: order.id,
                syncStatus: 'ACTIVE',
              },
            ],
          },
        ]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );
    vi.spyOn(service as any, 'refreshFbsOrdersCache').mockResolvedValue({
      orders: [order],
    });
    const move = vi.spyOn(service, 'moveFbsOrdersToNewSupply');

    const result = await service.previewFbsRequestTails(
      { requestIds: ['request-43'] },
      { id: 'user-1' } as never,
    );

    expect(result).toMatchObject({
      sourceRequests: [{ id: 'request-43', number: 43 }],
      orderCount: 1,
      itemCount: 1,
      skuCount: 1,
      orders: [
        {
          id: order.id,
          sourceRequest: { id: 'request-43', number: 43 },
          sourceSupplyId: 'WB-GI-258491048',
          product: {
            internalSku: 'новый_корея_2голубой-XL / 48',
            size: 'XL / 48',
          },
          storageBoxes: [{ code: 'FFL_LKB25_031', quantity: 20 }],
        },
      ],
    });
    expect(move).not.toHaveBeenCalled();
  });

  it('blocks moving an FBS order after any physical scan', async () => {
    const order = {
      id: '5355000001',
      connectionId: 'connection-1',
      marketplace: MarketplaceType.WILDBERRIES,
      category: 'active',
      supplierStatus: 'confirm',
      supplyId: 'WB-GI-OLD',
      itemCount: 1,
      product: { id: 'sku-1', name: 'Костюм' },
    };
    const prisma = {
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'link-1',
            connectionId: 'connection-1',
            orderId: order.id,
            requestId: 'request-old',
            syncStatus: 'ACTIVE',
            request: {
              id: 'request-old',
              number: 31,
              status: ClientRequestStatus.IN_WORK,
            },
          },
        ]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            orderId: order.id,
            status: 'IN_PROGRESS',
            boxId: 'box-1',
            barcode: null,
            kiz: null,
            stickerPartA: null,
            stickerPartB: null,
            stickerBarcode: null,
            cargoPackingId: null,
            completedAt: null,
          },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );
    vi.spyOn(service as any, 'refreshFbsOrdersCache').mockResolvedValue({
      orders: [order],
    });
    vi.spyOn(service as any, 'resolveSelectedFbsOrders').mockResolvedValue({
      response: { orders: [order] },
      orders: [order],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const attempt = service.moveFbsOrdersToNewSupply(
      {
        clientId: 'client-1',
        orders: [{ connectionId: 'connection-1', id: order.id }],
      },
      { id: 'user-1' } as never,
    );
    await expect(attempt).rejects.toThrow('Перенос не начат');
    await expect(attempt).rejects.toThrow(order.id);
    await expect(attempt).rejects.toThrow('Что сделать');
    await expect(attempt).rejects.toThrow('Ни один заказ не перенесён');
    expect(fetchMock).not.toHaveBeenCalled();
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
    const refreshOrders = vi
      .spyOn(service as any, 'refreshFbsOrdersCache')
      .mockResolvedValue({ orders: [] });

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
    expect(result).toEqual({
      request: expect.objectContaining({ id: 'request-1', number: 42 }),
      linkedOrders: 2,
    });
    expect(refreshOrders).not.toHaveBeenCalled();
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
      findMany: vi.fn().mockResolvedValue([]),
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

  it('rejects a box barcode in the FBS KIZ step before changing the order', async () => {
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      orderId: '1001',
      skuId: 'sku-1',
      requiresKiz: true,
      status: 'IN_PROGRESS',
      boxId: 'box-1',
      boxCode: 'FFL_TEST_001',
      barcode: '4600000000012',
      barcodes: ['4600000000012'],
      kiz: null,
      wbMetaStatus: 'PENDING',
    };
    const prisma = {
      productMark: { findFirst: vi.fn() },
      fbsTsdAssembly: { findMany: vi.fn() },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);

    await expect(
      service.scanFbsTsdKiz('task-1', { kiz: 'FFL_LONG_BOX_000001' }, { id: 'user-1' } as never),
    ).rejects.toThrow('Отсканирован номер короба');

    expect(prisma.productMark.findFirst).not.toHaveBeenCalled();
    expect(prisma.fbsTsdAssembly.findMany).not.toHaveBeenCalled();
  });

  it('writes a wrong-product KIZ scan to the online task and KIZ diagnostics', async () => {
    const kiz = '010590000000001221WRONGSKU123456';
    const task = {
      id: 'task-1',
      requestId: 'request-65',
      clientId: 'client-1',
      orderId: 'WB-1001',
      skuId: 'sku-expected',
      productName: 'Ожидаемый костюм',
      article: 'EXPECTED',
      requiresKiz: true,
      status: 'IN_PROGRESS',
      boxId: 'box-1',
      boxCode: 'FFL_TEST_001',
      barcode: '4600000000012',
      barcodes: ['4600000000012'],
      kiz: null,
      wbMetaStatus: 'PENDING',
      deviceCode: 'TSD-1',
      workerName: 'Сотрудник',
    };
    const wrongMark = {
      id: 'mark-1',
      clientId: 'client-1',
      skuId: 'sku-actual',
      boxId: 'box-2',
      status: 'AVAILABLE',
      box: { code: 'FFL_WRONG_001' },
      sku: {
        internalSku: 'ACTUAL-M',
        article: 'ACTUAL',
        name: 'Другой костюм',
        color: 'голубой',
        size: 'M',
      },
    };
    const update = vi.fn().mockResolvedValue(task);
    const prisma = {
      productMark: { findFirst: vi.fn().mockResolvedValue(wrongMark) },
      fbsTsdAssembly: { update },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);
    const recordConflict = vi
      .spyOn(service as any, 'recordLocalFbsKizConflict')
      .mockResolvedValue(undefined);

    await expect(
      service.scanFbsTsdKiz('task-1', { kiz }, { id: 'user-1', name: 'Администратор' } as never),
    ).rejects.toThrow('Этот КИЗ относится к другому товару: Другой костюм.');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { errorMessage: 'Этот КИЗ относится к другому товару: Другой костюм.' },
    });
    expect(recordConflict).toHaveBeenCalledWith(
      task,
      kiz,
      wrongMark,
      'Этот КИЗ относится к другому товару: Другой костюм.',
      expect.objectContaining({ id: 'user-1' }),
      'WRONG_SKU',
    );
  });

  it('replaces an unused historical KIZ when the opened box has no unmarked quantity', async () => {
    const barcode = '2047945838075';
    const kiz = '010590000000001221PHYSICAL123456';
    const previousKiz = '010590000000001221STALE12345678';
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      orderId: '5360364181',
      skuId: 'sku-1',
      productName: 'Спортивный костюм оверсайз с брюками',
      requiresKiz: true,
      status: 'IN_PROGRESS',
      boxId: 'box-1',
      boxCode: 'FFL_LKB0207_222',
      barcode,
      barcodes: [barcode],
      kiz: null,
      wbMetaStatus: 'PENDING',
    };
    const productMark = {
      findFirst: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'stale-mark-1',
          value: previousKiz,
          sourceDocument: 'Историческая загрузка',
        }),
      count: vi.fn().mockResolvedValue(10),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    };
    const fbsTsdAssembly = {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          kiz: '010590000000001221ALREADYUSED123',
          requestId: 'request-other',
          status: 'IN_PROGRESS',
        }]),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...task, ...data })),
      updateMany: vi.fn(),
    };
    const tx = {
      productMark,
      stockBalance: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 10 } }) },
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

    expect(productMark.update).toHaveBeenCalledWith({
      where: { id: 'stale-mark-1' },
      data: expect.objectContaining({
        value: kiz,
        sourceDocument: expect.stringContaining('без изменения количества'),
      }),
    });
    expect(productMark.create).not.toHaveBeenCalled();
    expect(productMark.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client-1',
          skuId: 'sku-1',
          boxId: 'box-1',
          status: 'AVAILABLE',
          value: { notIn: ['010590000000001221ALREADYUSED123'] },
        }),
      }),
    );
    expect(result).toMatchObject({
      message: 'КИЗ принят Wildberries и заменил устаревшую запись в коробе FFL_LKB0207_222. Количество товара не изменилось. Подтвердите сборку заказа.',
    });
  });

  it('restores the historical KIZ when Wildberries rejects its physical replacement', async () => {
    const barcode = '2047945838075';
    const kiz = '010590000000001221REJECTED123456';
    const previousKiz = '010590000000001221STALE12345678';
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      orderId: '5360364181',
      skuId: 'sku-1',
      productName: 'Спортивный костюм оверсайз с брюками',
      requiresKiz: true,
      status: 'IN_PROGRESS',
      boxId: 'box-1',
      boxCode: 'FFL_LKB0207_222',
      barcode,
      barcodes: [barcode],
      kiz: null,
      wbMetaStatus: 'PENDING',
    };
    const productMark = {
      findFirst: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'stale-mark-1',
          value: previousKiz,
          sourceDocument: 'Историческая загрузка',
        }),
      count: vi.fn().mockResolvedValue(10),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn(),
    };
    const fbsTsdAssembly = {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...task, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const tx = {
      productMark,
      stockBalance: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 10 } }) },
      fbsTsdAssembly,
    };
    const prisma = {
      ...tx,
      clientMarketplaceConnection: { findFirst: vi.fn().mockResolvedValue({ apiKey: 'secret-key' }) },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ message: 'КИЗ не подходит заказу' }),
      } as Response)),
    );

    await expect(service.scanFbsTsdKiz('task-1', { kiz }, { id: 'user-1' } as never))
      .rejects.toThrow('Wildberries не принял КИЗ');

    expect(productMark.updateMany).toHaveBeenCalledWith({
      where: { id: 'stale-mark-1', clientId: 'client-1', value: kiz },
      data: {
        value: previousKiz,
        sourceDocument: 'Историческая загрузка',
      },
    });
    expect(fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-1', kiz, wbMetaStatus: 'PENDING' },
      data: {
        kiz,
        wbMetaStatus: 'REJECTED',
        errorMessage: expect.stringContaining('КИЗ не подходит заказу'),
      },
    });
  });

  it('repairs a rejected FBS KIZ when Wildberries already attached it to the same order', async () => {
    const kiz = '010590000000001221ALREADYINWB123';
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      orderId: '5360364181',
      requestId: 'request-58',
      requestItemId: 'request-item-1',
      skuId: 'sku-1',
      productName: 'Костюм',
      requiresKiz: true,
      status: 'IN_PROGRESS',
      boxId: 'box-1',
      boxCode: 'FFL_TEST_001',
      barcode: '2047945838075',
      kiz,
      wbMetaStatus: 'REJECTED',
      errorMessage: 'KIZ already exists in supply',
      deviceCode: 'TSD-1',
      workerName: 'Сотрудник',
    };
    const accepted = { ...task, wbMetaStatus: 'ACCEPTED', errorMessage: null };
    const prisma = {
      fbsTsdAssembly: {
        findUnique: vi.fn().mockResolvedValue(task),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(accepted),
      },
      clientMarketplaceConnection: {
        findFirst: vi.fn().mockResolvedValue({ apiKey: 'secret-key' }),
      },
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      productMark: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'mark-1',
          clientId: 'client-1',
          skuId: 'sku-1',
          boxId: 'box-1',
          status: StockStatus.AVAILABLE,
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      clientRequestEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          orders: [
            {
              id: 5360364181,
              meta: { sgtin: { value: [kiz] } },
            },
          ],
        }),
      } as Response)),
    );
    const service = new MarketplaceConnectionsService(
      prisma as never,
      clientScopes as never,
    );

    const result = await service.resolveFbsKizConflict(
      'request-58',
      'task-1',
      { id: 'admin-1', name: 'Администратор' } as never,
    );

    expect(result).toMatchObject({
      resolved: true,
      assemblyId: 'task-1',
      orderId: '5360364181',
    });
    expect(prisma.fbsTsdAssembly.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { kiz, wbMetaStatus: 'ACCEPTED', errorMessage: null },
    });
    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(
      expect.anything(),
      'client-1',
      'write',
    );
  });

  it('removes an accepted FBS KIZ from Wildberries and returns the task to KIZ scanning', async () => {
    const kiz = '010590000000001221ACCEPTED123456';
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      orderId: '5360364181',
      requestId: 'request-1',
      requiresKiz: true,
      status: 'IN_PROGRESS',
      boxId: 'box-1',
      boxCode: 'FFL_TEST_001',
      barcode: '2047945838075',
      kiz,
      wbMetaStatus: 'ACCEPTED',
      stickerPartA: '123',
      stickerPartB: '4567',
      stickerBarcode: '1234567',
    };
    const updated = {
      ...task,
      kiz: null,
      wbMetaStatus: 'PENDING',
      stickerPartA: null,
      stickerPartB: null,
      stickerBarcode: null,
    };
    const prisma = {
      clientMarketplaceConnection: {
        findFirst: vi.fn().mockResolvedValue({ apiKey: 'secret-key' }),
      },
      fbsTsdAssembly: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(updated),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(
      async (value: unknown, _user: unknown, message: string) => ({ task: value, message }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) } as Response)),
    );

    const result = await service.undoFbsTsdKiz('task-1', { id: 'user-1' } as never);

    expect(fetch).toHaveBeenCalledWith(
      'https://marketplace-api.wildberries.ru/api/v3/orders/5360364181/meta?key=sgtin',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'secret-key' }),
      }),
    );
    expect(prisma.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        status: 'IN_PROGRESS',
        kiz,
        wbMetaStatus: 'ACCEPTED',
      },
      data: { wbMetaStatus: 'REMOVING', errorMessage: null },
    });
    expect(prisma.fbsTsdAssembly.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: {
        kiz: null,
        wbMetaStatus: 'PENDING',
        errorMessage: null,
        stickerPartA: null,
        stickerPartB: null,
        stickerBarcode: null,
      },
    });
    expect(result).toMatchObject({
      task: { kiz: null, wbMetaStatus: 'PENDING' },
      message: 'КИЗ отменён в Wildberries и освобождён в WMS. Отсканируйте другой КИЗ.',
    });
  });

  it('keeps an accepted FBS KIZ when Wildberries rejects its removal', async () => {
    const kiz = '010590000000001221ACCEPTED123456';
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      orderId: '5360364181',
      requiresKiz: true,
      status: 'IN_PROGRESS',
      kiz,
      wbMetaStatus: 'ACCEPTED',
    };
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const prisma = {
      clientMarketplaceConnection: {
        findFirst: vi.fn().mockResolvedValue({ apiKey: 'secret-key' }),
      },
      fbsTsdAssembly: {
        updateMany,
        update: vi.fn(),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({ message: 'Метаданные сейчас нельзя удалить' }),
      } as Response)),
    );

    await expect(service.undoFbsTsdKiz('task-1', { id: 'user-1' } as never))
      .rejects.toThrow('Не удалось отменить КИЗ в Wildberries');

    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'task-1',
        status: 'IN_PROGRESS',
        kiz,
        wbMetaStatus: 'REMOVING',
      },
      data: {
        wbMetaStatus: 'ACCEPTED',
        errorMessage: expect.stringContaining('Метаданные сейчас нельзя удалить'),
      },
    });
    expect(prisma.fbsTsdAssembly.update).not.toHaveBeenCalled();
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
      fbsTsdAssembly: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
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
      fbsSupplyPlan: {
        findUnique: vi.fn().mockResolvedValue({
          deliveryDestination: FbsDeliveryDestination.PICKUP_POINT,
        }),
      },
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

  it('opens a pickup-point cargo place when the scanner adds a QR symbology prefix', async () => {
    const prisma = {
      fbsSupplyPlan: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'plan-pvz',
          clientId: 'client-1',
          marketplace: MarketplaceType.WILDBERRIES,
          connectionId: 'connection-1',
          supplyId: 'WB-GI-PVZ',
          deliveryDestination: FbsDeliveryDestination.PICKUP_POINT,
          itemsPerCargoPlace: 14,
          cargoPlaceIds: ['WB-MP-46924736'],
          cargoPlaceBarcodes: {
            'WB-MP-46924736': '$WBMP:1:3941249:46924736',
          },
          client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
        }),
      },
      fbsCargoPlacePacking: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'packing-pvz' }),
      },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    vi.spyOn(service as any, 'buildFbsCargoPackingResponse').mockResolvedValue({
      state: 'SCAN_ORDER',
    });

    await service.openFbsCargoPacking(
      {
        planId: 'plan-pvz',
        cargoCode: '\u0002]Q3WBMP:1:3941249:46924736\r',
        deviceCode: 'TSD-1',
      },
      { id: 'user-1', name: 'Сборщик' } as never,
    );

    expect(prisma.fbsCargoPlacePacking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cargoPlaceId: 'WB-MP-46924736',
        cargoPlaceBarcode: '$WBMP:1:3941249:46924736',
        deviceCode: 'TSD-1',
      }),
    });
  });

  it('packs the next unassigned pickup-point order by the product barcode', async () => {
    const packing = {
      id: 'packing-pvz',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      supplyId: 'WB-GI-PVZ',
      cargoPlaceId: 'WB-MP-46924736',
      capacityItems: 14,
      deviceCode: 'TSD-1',
      status: 'OPEN',
    };
    const prisma = {
      fbsSupplyPlan: {
        findUnique: vi.fn().mockResolvedValue({
          deliveryDestination: FbsDeliveryDestination.PICKUP_POINT,
        }),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'task-packed',
            orderId: '5378514902',
            barcode: '2039034633814',
            itemCount: 1,
            cargoPackingId: 'another-packing',
          },
          {
            id: 'task-next',
            orderId: '5378879840',
            barcode: '2039034633814',
            itemCount: 1,
            cargoPackingId: null,
          },
        ]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { itemCount: 1 } }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsCargoPacking').mockResolvedValue(packing);
    vi.spyOn(service as any, 'buildFbsCargoPackingResponse').mockResolvedValue({
      state: 'SCAN_ORDER',
    });

    await service.scanFbsCargoOrder(
      'packing-pvz',
      { orderCode: '\u0002]C12039034633814\r' },
      { id: 'user-1', name: 'Сборщик' } as never,
    );

    expect(prisma.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-next', cargoPackingId: null },
      data: expect.objectContaining({
        cargoPackingId: 'packing-pvz',
        cargoPackedByUserId: 'user-1',
        cargoPackedByName: 'Сборщик',
      }),
    });
  });

  it('allows a cargo place to contain more than the historical 14-item capacity', async () => {
    const prisma = {
      fbsSupplyPlan: {
        findUnique: vi.fn().mockResolvedValue({
          deliveryDestination: FbsDeliveryDestination.PICKUP_POINT,
        }),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([{ id: 'task-1', orderId: '5355000001', itemCount: 1, cargoPackingId: null }]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { itemCount: 14 } }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
    vi.spyOn(service as any, 'buildFbsCargoPackingResponse').mockResolvedValue({
      state: 'SCAN_ORDER',
    });

    await expect(
      service.scanFbsCargoOrder('packing-1', { orderCode: '5355000001' }, { id: 'user-1' } as never),
    ).resolves.toBeDefined();
    expect(prisma.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-1', cargoPackingId: null },
      data: expect.objectContaining({ cargoPackingId: 'packing-1' }),
    });
  });

  it('cancels an open FBS packing and returns every packed item to the queue', async () => {
    const packing = {
      id: 'packing-1',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      supplyId: 'WB-GI-1',
      cargoPlaceId: 'FFL_OUT_001',
      capacityItems: 14,
      deviceCode: 'TSD-1',
      status: 'OPEN',
    };
    const tx = {
      fbsCargoPlacePacking: {
        findUnique: vi.fn().mockResolvedValue({ id: 'packing-1', status: 'OPEN' }),
        delete: vi.fn().mockResolvedValue({ id: 'packing-1' }),
      },
      fbsTsdAssembly: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { itemCount: 6 } }),
        updateMany: vi.fn().mockResolvedValue({ count: 6 }),
      },
    };
    const prisma = {
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsCargoPacking').mockResolvedValue(packing);
    vi.spyOn(service as any, 'buildFbsCargoPackingResponse').mockResolvedValue({
      state: 'SELECT_SUPPLY',
      packing: null,
    });

    await expect(
      service.cancelFbsCargoPacking(
        'packing-1',
        { id: 'user-1', name: 'Сборщик' } as never,
      ),
    ).resolves.toMatchObject({ state: 'SELECT_SUPPLY', packing: null });
    expect(tx.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: { cargoPackingId: 'packing-1' },
      data: {
        cargoPackingId: null,
        cargoPackedAt: null,
        cargoPackedByUserId: null,
        cargoPackedByName: null,
      },
    });
    expect(tx.fbsCargoPlacePacking.delete).toHaveBeenCalledWith({
      where: { id: 'packing-1' },
    });
  });

  it('opens a physical FFL box for a sorting-center supply without requesting WB cargo stickers', async () => {
    const prisma = {
      fbsSupplyPlan: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'plan-sc',
          clientId: 'client-1',
          marketplace: MarketplaceType.WILDBERRIES,
          connectionId: 'connection-1',
          supplyId: 'WB-GI-SC',
          deliveryDestination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
          itemsPerCargoPlace: 14,
          cargoPlaceIds: null,
          cargoPlaceBarcodes: null,
          client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
        }),
      },
      fbsCargoPlacePacking: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'packing-sc' }),
      },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    const syncStickers = vi.spyOn(service as any, 'syncFbsCargoPlaceBarcodes');
    vi.spyOn(service as any, 'buildFbsCargoPackingResponse').mockResolvedValue({
      state: 'SCAN_ORDER',
    });

    await service.openFbsCargoPacking(
      { planId: 'plan-sc', cargoCode: '\u0002]C1ffl_out_001\r', deviceCode: 'TSD-1' },
      { id: 'user-1', name: 'Сборщик' } as never,
    );

    expect(syncStickers).not.toHaveBeenCalled();
    expect(prisma.fbsCargoPlacePacking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        supplyId: 'WB-GI-SC',
        cargoPlaceId: 'FFL_OUT_001',
        cargoPlaceBarcode: 'FFL_OUT_001',
        capacityItems: FBS_UNLIMITED_CARGO_PLACE_CAPACITY,
        deviceCode: 'TSD-1',
      }),
    });
  });

  it('packs the next assembled sorting-center item by its product barcode', async () => {
    const packing = {
      id: 'packing-sc',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      supplyId: 'WB-GI-SC',
      cargoPlaceId: 'FFL_OUT_001',
      capacityItems: 14,
      deviceCode: 'TSD-1',
      status: 'OPEN',
    };
    const alreadyPacked = {
      id: 'task-packed',
      orderId: '5355000001',
      skuId: 'sku-1',
      barcode: '2040000000001',
      itemCount: 1,
      cargoPackingId: 'another-packing',
    };
    const nextItem = {
      id: 'task-next',
      orderId: '5355000002',
      skuId: 'sku-1',
      barcode: '2040000000001',
      itemCount: 1,
      cargoPackingId: null,
    };
    const prisma = {
      fbsSupplyPlan: {
        findUnique: vi.fn().mockResolvedValue({
          deliveryDestination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
        }),
      },
      barcode: {
        findFirst: vi.fn().mockResolvedValue({ skuId: 'sku-1' }),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([alreadyPacked, nextItem]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { itemCount: 3 } }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsCargoPacking').mockResolvedValue(packing);
    vi.spyOn(service as any, 'buildFbsCargoPackingResponse').mockResolvedValue({
      state: 'SCAN_ORDER',
    });

    await service.scanFbsCargoOrder(
      'packing-sc',
      { orderCode: '2040000000001' },
      { id: 'user-1', name: 'Сборщик' } as never,
    );

    expect(prisma.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-next', cargoPackingId: null },
      data: expect.objectContaining({
        cargoPackingId: 'packing-sc',
        cargoPackedByUserId: 'user-1',
        cargoPackedByName: 'Сборщик',
      }),
    });
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

  // TEST: An unchanged marketplace snapshot must not rewrite every untouched
  // TSD task in a large FBS request and block interactive box scans.
  it('does not update unchanged untouched TSD tasks during FBS request sync', async () => {
    const order = fbsOrder({ id: '5355000001' });
    const link = fbsRequestLink({
      orderId: order.id,
      lastCategory: 'active',
      lastSupplierStatus: 'confirm',
    });
    const item = {
      id: 'item-1',
      skuId: 'sku-1',
      barcode: '460000000001',
      name: 'Костюм',
      quantity: 1,
      comment: 'FBS-заказы: 5355000001',
      packageItems: [],
      boxSelections: [],
    };
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      requestId: 'request-1',
      requestItemId: item.id,
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      orderId: order.id,
      skuId: 'sku-1',
      productName: 'Костюм',
      article: 'ART-1',
      barcodes: ['460000000001'],
      // TEST: this WMS-only route must not be replaced by order.storageBoxes.
      storageBoxes: [
        {
          code: 'FFL_TEST_001',
          quantity: 1,
          status: StockStatus.AVAILABLE,
          palletCode: 'PALET_SORT_001',
        },
      ],
      itemCount: 1,
      supplyId: 'WB-GI-1',
      status: 'WAITING_STOCK',
      reservedBoxId: null,
      boxId: null,
      barcode: null,
      kiz: null,
      stickerPartA: null,
      stickerPartB: null,
      stickerBarcode: null,
      cargoPackingId: null,
      completedAt: null,
    };
    const request = fbsLinkedRequest({ links: [link], items: [item] });
    const tx: any = {
      clientRequest: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'request-1', status: ClientRequestStatus.SUBMITTED })
          .mockResolvedValueOnce(request),
        update: vi.fn(),
      },
      fbsOrderRequestLink: {
        findUnique: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([task]),
        update: vi.fn(),
      },
      clientRequestItem: {
        update: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
      clientRequestEvent: { create: vi.fn() },
      clientNotification: { create: vi.fn() },
    };
    const prisma: any = {
      fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue([link]) },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await (service as any).syncFbsRequestsFromMarketplace('client-1', [order]);

    expect(tx.fbsTsdAssembly.update).not.toHaveBeenCalled();
  });

  // TEST: a final WB status may consume only the PACKING movement created by
  // the same completed TSD task, and a repeated refresh must be a no-op.
  it('ships a completed WB task physical reservation exactly once', async () => {
    const reservation = {
      warehouseId: 'warehouse-1',
      boxId: 'box-1',
      palletId: null,
      quantity: 1,
    };
    const shipped = { ...reservation, quantity: -1 };
    const tx: any = {
      stockMovement: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([reservation])
          .mockResolvedValueOnce([reservation, shipped]),
        create: vi.fn().mockResolvedValue({ id: 'ship-1' }),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'packing-balance-1', quantity: 1 },
        ]),
        delete: vi.fn().mockResolvedValue({}),
        update: vi.fn(),
      },
      productMark: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = new MarketplaceConnectionsService({} as never, {} as never);
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      orderId: '5573752050',
      requestId: 'request-451',
      skuId: 'sku-1',
      status: 'COMPLETED',
      completedAt: new Date('2026-08-29T16:54:18.647Z'),
      kiz: '0104640569959669215TEST',
    };

    await expect(
      (service as any).shipCompletedWildberriesStockReservation(tx, task),
    ).resolves.toBe(1);
    await expect(
      (service as any).shipCompletedWildberriesStockReservation(tx, task),
    ).resolves.toBe(0);

    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: MovementType.SHIP,
        status: StockStatus.PACKING,
        quantity: -1,
        idempotencyKey:
          'fbs-sticker-pick:task-1:marketplace-complete:warehouse-1:box-1:no-pallet',
      }),
    });
    expect(tx.stockBalance.delete).toHaveBeenCalledWith({
      where: { id: 'packing-balance-1' },
    });
    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.productMark.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: StockStatus.PACKING }),
      data: { status: StockStatus.SHIPPING },
    });
  });

  // TEST: a historical task whose PACKING balance was already consumed must
  // not create a duplicate shipment or abort synchronization of its request.
  it('skips an already consumed completed WB reservation', async () => {
    const reservation = {
      warehouseId: 'warehouse-1',
      boxId: 'box-1',
      palletId: null,
      quantity: 1,
    };
    const tx: any = {
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([reservation]),
        create: vi.fn(),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
        update: vi.fn(),
      },
      productMark: { updateMany: vi.fn() },
    };
    const service = new MarketplaceConnectionsService({} as never, {} as never);

    await expect(
      (service as any).shipCompletedWildberriesStockReservation(tx, {
        id: 'task-1',
        clientId: 'client-1',
        marketplace: MarketplaceType.WILDBERRIES,
        orderId: '5573752050',
        requestId: 'request-451',
        skuId: 'sku-1',
        status: 'COMPLETED',
        completedAt: new Date('2026-08-29T16:54:18.647Z'),
        kiz: '0104640569959669215TEST',
      }),
    ).resolves.toBe(0);

    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.stockBalance.delete).not.toHaveBeenCalled();
    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.productMark.updateMany).not.toHaveBeenCalled();
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

  it('returns a cancelled FBS sync conflict to stock and releases its reservation', async () => {
    const task = {
      id: 'task-return-1',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      orderId: '5426435634',
      requestId: 'request-1',
      requestItemId: 'item-1',
      skuId: 'sku-1',
      productName: 'Костюм',
      itemCount: 1,
      requiresKiz: true,
      status: 'RETURN_REQUIRED',
      deviceCode: 'TSD-1',
      reservedBoxId: 'box-1',
      reservedBoxCode: 'FFL_TEST_001',
      boxId: 'box-1',
      boxCode: 'FFL_TEST_001',
      barcode: '460000000001',
      sourceBarcode: null,
      relabelConfirmedAt: null,
      kiz: '010460000000001221SERIAL',
      wbMetaStatus: 'ACCEPTED',
      cargoPackingId: null,
      completedAt: new Date(),
    };
    const link = {
      id: 'link-1',
      requestId: 'request-1',
      syncStatus: 'RETURN_REQUIRED',
      lastCategory: 'cancelled',
      lastSupplierStatus: 'confirm',
      lastWbStatus: 'canceled_by_client',
    };
    const tx: any = {
      fbsTsdAssembly: {
        findUnique: vi.fn().mockResolvedValue(task),
        update: vi.fn().mockResolvedValue({}),
      },
      fbsOrderRequestLink: {
        findUnique: vi.fn().mockResolvedValue(link),
        update: vi.fn().mockResolvedValue({}),
      },
      clientRequestBoxSelection: {
        findUnique: vi.fn().mockResolvedValue({ id: 'selection-1', quantity: 1 }),
        delete: vi.fn().mockResolvedValue({}),
        update: vi.fn(),
      },
      fbsCargoPlacePacking: { updateMany: vi.fn() },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      fbsTsdAssembly: { findUnique: vi.fn().mockResolvedValue(task) },
      fbsOrderRequestLink: { findUnique: vi.fn().mockResolvedValue(link) },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, scopes as never);
    vi.spyOn(service, 'listFbsOrders').mockResolvedValue({} as never);

    await expect(
      service.resolveFbsSyncConflict(
        'request-1',
        'task-return-1',
        { action: 'RETURN_TO_STOCK' } as never,
        { id: 'admin-1', name: 'Администратор' } as never,
      ),
    ).resolves.toMatchObject({
      resolved: true,
      orderId: '5426435634',
      action: 'RETURN_TO_STOCK',
    });

    expect(tx.clientRequestBoxSelection.delete).toHaveBeenCalledWith({
      where: { id: 'selection-1' },
    });
    expect(tx.fbsTsdAssembly.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-return-1' },
        data: expect.objectContaining({
          status: 'RELEASED',
          boxId: null,
          kiz: null,
          completedAt: null,
        }),
      }),
    );
    expect(tx.fbsOrderRequestLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ syncStatus: 'REMOVED', syncIssue: null }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'FBS_SYNC_CONFLICT_RETURNED_TO_STOCK' }),
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

  it('blocks WB delivery when another order of the WMS request is not collected on TSD', async () => {
    const firstOrder = fbsOrder({ id: '5355000001' });
    const missingOrder = fbsOrder({ id: '5355000002' });
    const firstLink = fbsRequestLink({
      orderId: firstOrder.id,
      lastCategory: 'active',
      lastSupplierStatus: 'confirm',
    });
    const missingLink = fbsRequestLink({
      orderId: missingOrder.id,
      lastCategory: 'active',
      lastSupplierStatus: 'confirm',
    });
    const prisma: any = {
      fbsOrderRequestLink: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([firstLink, missingLink])
          .mockResolvedValueOnce([firstLink, missingLink]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            requestId: 'request-1',
            connectionId: 'connection-1',
            orderId: firstOrder.id,
            status: 'COMPLETED',
            requiresKiz: true,
            kiz: '010460000000001121ABC',
            wbMetaStatus: 'ACCEPTED',
            barcode: '460000000001',
          },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await expect(
      (service as any).assertFbsDeliveryReadiness(
        'client-1',
        { orders: [firstOrder, missingOrder] },
        [firstOrder],
      ),
    ).rejects.toThrow(/Заявка WMS №000031: не собраны на ТСД \(1\): №5355000002/);
  });

  it('ignores an old cancelled request order that no longer belongs to the selected supply', async () => {
    const activeOrder = fbsOrder({ id: '5355000001' });
    const cancelledOrder = fbsOrder({
      id: '5355000002',
      category: 'cancelled',
      supplierStatus: 'cancel',
      wbStatus: 'canceled_by_client',
      statusLabel: 'Отменён покупателем',
      supplyId: null,
    });
    const activeLink = fbsRequestLink({
      orderId: activeOrder.id,
      lastCategory: 'active',
      lastSupplierStatus: 'confirm',
    });
    const cancelledLink = {
      ...fbsRequestLink({
        orderId: cancelledOrder.id,
        lastCategory: 'cancelled',
        lastSupplierStatus: 'cancel',
      }),
      syncStatus: 'RETURN_REQUIRED',
      lastWbStatus: 'canceled_by_client',
    };
    const prisma: any = {
      fbsOrderRequestLink: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([activeLink])
          .mockResolvedValueOnce([activeLink, cancelledLink]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            requestId: 'request-1',
            connectionId: 'connection-1',
            orderId: activeOrder.id,
            status: 'COMPLETED',
            requiresKiz: true,
            kiz: '010460000000001121ABC',
            wbMetaStatus: 'ACCEPTED',
            barcode: '460000000001',
          },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await expect(
      (service as any).assertFbsDeliveryReadiness(
        'client-1',
        { orders: [activeOrder, cancelledOrder] },
        [activeOrder],
      ),
    ).resolves.toBeUndefined();
    expect(prisma.fbsOrderRequestLink.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            {
              connectionId: activeOrder.connectionId,
              orderId: activeOrder.id,
            },
          ],
        }),
      }),
    );
  });

  it('blocks WB delivery when a cancelled order still belongs to the selected supply', async () => {
    const activeOrder = fbsOrder({ id: '5355000001' });
    const cancelledOrder = fbsOrder({
      id: '5355000002',
      category: 'cancelled',
      supplierStatus: 'cancel',
      wbStatus: 'canceled_by_client',
      statusLabel: 'Отменён покупателем',
      supplyId: activeOrder.supplyId,
    });
    const activeLink = fbsRequestLink({
      orderId: activeOrder.id,
      lastCategory: 'active',
      lastSupplierStatus: 'confirm',
    });
    const cancelledLink = {
      ...fbsRequestLink({
        orderId: cancelledOrder.id,
        lastCategory: 'cancelled',
        lastSupplierStatus: 'cancel',
      }),
      syncStatus: 'RETURN_REQUIRED',
      lastWbStatus: 'canceled_by_client',
    };
    const prisma: any = {
      fbsOrderRequestLink: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([activeLink, cancelledLink])
          .mockResolvedValueOnce([activeLink, cancelledLink]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            requestId: 'request-1',
            connectionId: 'connection-1',
            orderId: activeOrder.id,
            status: 'COMPLETED',
            requiresKiz: true,
            kiz: '010460000000001121ABC',
            wbMetaStatus: 'ACCEPTED',
            barcode: '460000000001',
          },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await expect(
      (service as any).assertFbsDeliveryReadiness(
        'client-1',
        { orders: [activeOrder, cancelledOrder] },
        [activeOrder],
      ),
    ).rejects.toThrow(/Заявка WMS №000031: отменены в WB \(1\): №5355000002/);
  });

  it('allows WB delivery validation after every request order is collected and its KIZ is accepted', async () => {
    const order = fbsOrder({ id: '5355000001' });
    const link = fbsRequestLink({
      orderId: order.id,
      lastCategory: 'active',
      lastSupplierStatus: 'confirm',
    });
    const prisma: any = {
      fbsOrderRequestLink: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([link])
          .mockResolvedValueOnce([link]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            requestId: 'request-1',
            connectionId: 'connection-1',
            orderId: order.id,
            status: 'COMPLETED',
            requiresKiz: true,
            kiz: '010460000000001121ABC',
            wbMetaStatus: 'ACCEPTED',
            barcode: '460000000001',
          },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await expect(
      (service as any).assertFbsDeliveryReadiness(
        'client-1',
        { orders: [order] },
        [order],
      ),
    ).resolves.toBeUndefined();
  });

  it('records the user who sent an FBS supply to Wildberries', async () => {
    const order = fbsOrder({
      id: '5355000001',
      supplyId: 'WB-GI-1',
      shipmentPlan: {
        destination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
        itemsPerCargoPlace: FBS_UNLIMITED_CARGO_PLACE_CAPACITY,
        requiresCargoPlaces: false,
        cargoPlaceCount: 0,
        cargoPlaceIds: [],
        sentToWbAt: null,
        sentToWbBy: null,
      },
    });
    const response = {
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
      connected: true,
      connections: [],
      fetchedAt: '2026-07-29T08:00:00.000Z',
      deliveryPlan: {
        destination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
        itemsPerCargoPlace: FBS_UNLIMITED_CARGO_PLACE_CAPACITY,
        requiresCargoPlaces: false,
      },
      counts: { active: 1, shipped: 0, cancelled: 0, archive: 0, all: 1 },
      orders: [order],
    };
    const prisma = {
      fbsSupplyPlan: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'plan-1',
          deliveryDestination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
        }),
        update: vi.fn().mockResolvedValue({ id: 'plan-1' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );
    vi.spyOn(service as any, 'refreshFbsOrdersCache').mockResolvedValue(response);
    vi.spyOn(service as any, 'resolveSelectedFbsOrders').mockResolvedValue({
      response,
      orders: [order],
    });
    vi.spyOn(service as any, 'assertFbsDeliveryReadiness').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'loadSelectedConnections').mockResolvedValue([
      { id: 'connection-1', apiKey: 'secret-key' },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 204,
        json: async () => ({}),
      } as Response)),
    );

    await expect(
      service.deliverFbsSupplies(
        {
          clientId: 'client-1',
          orders: [{ connectionId: 'connection-1', id: order.id }],
        },
        {
          id: 'user-1',
          email: 'manager@example.test',
          name: 'Иван Петров',
          roleCodes: ['MANAGER'],
          permissionCodes: ['fbs:write'],
          clientScopeMode: 'ALL',
          clientIds: [],
          writableClientIds: [],
        },
      ),
    ).resolves.toMatchObject({ delivered: 1, failed: [] });

    expect(prisma.fbsSupplyPlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: {
        sentToWbAt: expect.any(Date),
        sentToWbByUserId: 'user-1',
        sentToWbByName: 'Иван Петров',
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'FBS_SUPPLY_SENT_TO_WB',
        entity: 'FbsSupplyPlan',
        entityId: 'plan-1',
        payload: expect.objectContaining({
          clientId: 'client-1',
          connectionId: 'connection-1',
          supplyId: 'WB-GI-1',
          userName: 'Иван Петров',
        }),
      }),
    });
  });

  it('returns only the problematic WB order to rescan and leaves the rest of the request completed', async () => {
    const problemOrder = fbsOrder({
      id: '5355000001',
      request: { id: 'request-1', number: 31, title: 'FBS', status: ClientRequestStatus.SUBMITTED },
    });
    const healthyOrder = fbsOrder({
      id: '5355000002',
      request: { id: 'request-1', number: 31, title: 'FBS', status: ClientRequestStatus.SUBMITTED },
    });
    const cancelledOrder = fbsOrder({
      id: '5355000003',
      category: 'cancelled',
      supplierStatus: 'cancel',
      wbStatus: 'canceled_by_client',
      statusLabel: 'Отменён покупателем',
      request: { id: 'request-1', number: 31, title: 'FBS', status: ClientRequestStatus.SUBMITTED },
    });
    const tasks = [
      {
        id: 'assembly-problem',
        connectionId: 'connection-1',
        orderId: problemOrder.id,
        requestId: 'request-1',
        skuId: 'sku-1',
        status: 'COMPLETED',
        itemCount: 1,
        productName: 'Костюм проблемный',
        article: 'ART-1',
        barcodes: ['460000000001'],
        barcode: '460000000001',
        kiz: '010460000000001121PROBLEM',
        requiresKiz: true,
        wbMetaStatus: 'ACCEPTED',
        boxCode: 'FFL_TEST_001',
        reservedBoxCode: 'FFL_TEST_001',
        cargoPacking: { cargoPlaceId: 'CARGO-1' },
      },
      {
        id: 'assembly-healthy',
        connectionId: 'connection-1',
        orderId: healthyOrder.id,
        requestId: 'request-1',
        skuId: 'sku-1',
        status: 'COMPLETED',
        itemCount: 1,
        productName: 'Костюм исправный',
        article: 'ART-1',
        barcodes: ['460000000001'],
        barcode: '460000000001',
        kiz: '010460000000001121HEALTHY',
        requiresKiz: true,
        wbMetaStatus: 'ACCEPTED',
        boxCode: 'FFL_TEST_002',
        reservedBoxCode: 'FFL_TEST_002',
        cargoPacking: { cargoPlaceId: 'CARGO-1' },
      },
      {
        id: 'assembly-cancelled',
        connectionId: 'connection-1',
        orderId: cancelledOrder.id,
        requestId: 'request-1',
        skuId: 'sku-1',
        status: 'RETURN_REQUIRED',
        itemCount: 1,
        productName: 'Костюм отменённый',
        article: 'ART-1',
        barcodes: ['460000000001'],
        barcode: '460000000001',
        kiz: '010460000000001121CANCELLED',
        requiresKiz: true,
        wbMetaStatus: 'ACCEPTED',
        boxCode: 'FFL_TEST_003',
        reservedBoxCode: 'FFL_TEST_003',
        cargoPacking: { cargoPlaceId: 'CARGO-2' },
      },
    ];
    const links = [problemOrder, healthyOrder, cancelledOrder].map((order) => ({
      connectionId: order.connectionId,
      orderId: order.id,
      requestId: 'request-1',
      syncStatus: order.id === cancelledOrder.id ? 'RETURN_REQUIRED' : 'ACTIVE',
      syncIssue: order.id === cancelledOrder.id ? 'Заказ отменён покупателем WB' : null,
      request: { number: 31 },
    }));
    const tx = {
      fbsTsdAssembly: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      clientRequestEvent: {
        create: vi.fn().mockResolvedValue({ id: 'event-1' }),
      },
    };
    const prisma = {
      fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue(links) },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue(tasks) },
      sku: { findMany: vi.fn().mockResolvedValue([{ id: 'sku-1', size: 'M' }]) },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    const result = await (service as any).prepareFbsDeliveryRecovery(
      'client-1',
      { orders: [problemOrder, healthyOrder, cancelledOrder] },
      [problemOrder, healthyOrder, cancelledOrder],
      { id: 'admin-1', name: 'Администратор' },
      `WB отклонил заказ ${problemOrder.id}`,
    );

    expect(tx.fbsTsdAssembly.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: { id: 'assembly-problem', status: 'COMPLETED' },
      data: expect.objectContaining({
        status: 'RESCAN_REQUIRED',
        barcode: null,
        kiz: null,
      }),
    });
    expect(result.rescanOrders).toEqual([
      expect.objectContaining({
        orderId: problemOrder.id,
        requestNumber: 31,
        boxCode: 'FFL_TEST_001',
        cargoPlaceCode: 'CARGO-1',
      }),
    ]);
    expect(result.rescanOrders).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ orderId: healthyOrder.id })]),
    );
    expect(result.cancelledOrders).toEqual([
      expect.objectContaining({
        orderId: cancelledOrder.id,
        boxCode: 'FFL_TEST_003',
        cargoPlaceCode: 'CARGO-2',
        reason: 'Заказ отменён покупателем WB',
      }),
    ]);
  });

  // TEST: a WB supply sent with 200 orders must return only the 50 physically
  // unfinished orders; the 150 valid completed scans must remain untouched.
  it('finds only unfinished orders in a WB-delivered branch supply', async () => {
    const orders = Array.from({ length: 200 }, (_, index) => fbsOrder({
      id: String(5_600_000_000 + index),
      category: 'shipped',
      supplierStatus: 'complete',
      wbStatus: 'waiting',
      statusLabel: 'В доставке',
      supplyId: 'WB-GI-200',
      warehouseId: 'wb-warehouse-moscow',
      request: {
        id: 'request-source',
        number: 400,
        title: 'FBS — 200 заказов',
        status: ClientRequestStatus.DONE,
        warehouseId: 'warehouse-moscow',
        fbsEmergencyAssemblyAt: null,
        fbsEmergencyAssemblyByUserId: null,
        fbsEmergencyAssemblyByName: null,
      },
    }));
    const links = orders.map((order) => ({
      id: `link-${order.id}`,
      connectionId: order.connectionId,
      orderId: order.id,
      requestId: 'request-source',
      syncStatus: 'ACTIVE',
      lastCategory: 'shipped',
      lastSupplierStatus: 'complete',
      lastWbStatus: 'waiting',
      lastSupplyId: 'WB-GI-200',
      lastSkuId: 'sku-1',
      lastItemCount: 1,
      request: {
        id: 'request-source',
        number: 400,
        status: ClientRequestStatus.DONE,
        warehouseId: 'warehouse-moscow',
        fbsEmergencyAssemblyAt: null,
      },
    }));
    const tasks = orders.slice(0, 175).map((order, index) => ({
      id: `task-${order.id}`,
      connectionId: order.connectionId,
      orderId: order.id,
      requestId: 'request-source',
      requestItemId: 'source-item',
      skuId: 'sku-1',
      itemCount: 1,
      productName: 'Костюм',
      article: 'ART-1',
      barcodes: ['460000000001'],
      status: index < 150 ? 'COMPLETED' : 'IN_PROGRESS',
      barcode: index < 150 ? '460000000001' : null,
      kiz: index < 150 ? `010460000000001121${order.id}` : null,
      requiresKiz: true,
      wbMetaStatus: index < 150 ? 'ACCEPTED' : 'PENDING',
      boxCode: index < 150 ? 'FFL_TEST_001' : null,
      reservedBoxCode: null,
      completedAt: index < 150 ? new Date('2026-08-29T07:00:00.000Z') : null,
    }));
    const prisma = {
      fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue(links) },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue(tasks) },
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'connection-1',
          marketplace: MarketplaceType.WILDBERRIES,
          fbsExecutionWarehouseId: 'warehouse-moscow',
          fbsAutoRouteNewWarehouses: true,
        }]),
      },
      fbsWarehouseRoutingRule: { findMany: vi.fn().mockResolvedValue([]) },
      warehouse: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'warehouse-moscow',
          code: 'MSK',
          name: 'Москва',
          city: 'Москва',
        }),
      },
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );
    vi.spyOn(service as any, 'refreshFbsOrdersCache').mockResolvedValue({
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
      connected: true,
      connections: [{ id: 'connection-1', marketplace: MarketplaceType.WILDBERRIES }],
      fetchedAt: '2026-08-29T10:00:00.000Z',
      deliveryPlan: {},
      counts: { active: 0, shipped: 200, cancelled: 0, archive: 0, all: 200 },
      orders,
    });

    const result = await service.checkFbsBranchDeliveryRecovery(
      'client-1',
      {
        id: 'admin-1',
        name: 'Администратор',
        roleCodes: ['ADMIN'],
        permissionCodes: ['system:admin'],
        activeWarehouseId: 'warehouse-moscow',
        warehouseIds: ['warehouse-moscow'],
      } as never,
    );

    expect(result.counts).toMatchObject({
      supplies: 1,
      orders: 200,
      assembled: 150,
      recoveryRequired: 50,
      assemble: 25,
      complete: 25,
      reassemble: 0,
    });
    expect(result.recoveryOrders).toHaveLength(50);
    expect(result.recoveryOrders.filter((order) => order.action === 'COMPLETE')).toHaveLength(25);
    expect(result.recoveryOrders.filter((order) => order.action === 'ASSEMBLE')).toHaveLength(25);
    // TEST: a closed historical request is the exact premature-WB-send case
    // and must not block creation of the local recovery request.
    expect(result.recoveryOrders.every((order) => order.canSelect)).toBe(true);
    expect(result.recoveryOrders).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId: orders[0]!.id }),
      ]),
    );
  });

  // TEST: the normal "send to WB" path must stop before the WB mutation when
  // a 200-order supply has only 150 complete physical TSD scans.
  it('blocks sending a 200-order WB supply when 50 orders are not collected', async () => {
    const orders = Array.from({ length: 200 }, (_, index) => fbsOrder({
      id: String(5_610_000_000 + index),
      supplyId: 'WB-GI-GUARD-200',
      category: 'active',
      supplierStatus: 'confirm',
      statusLabel: 'На сборке',
    }));
    const links = orders.map((order) => ({
      connectionId: order.connectionId,
      orderId: order.id,
      requestId: 'request-guard',
      syncStatus: 'ACTIVE',
      lastCategory: 'active',
      lastSupplierStatus: 'confirm',
      lastWbStatus: 'waiting',
      request: {
        id: 'request-guard',
        number: 410,
        status: ClientRequestStatus.IN_WORK,
      },
    }));
    const tasks = orders.slice(0, 150).map((order) => ({
      requestId: 'request-guard',
      connectionId: order.connectionId,
      orderId: order.id,
      status: 'COMPLETED',
      requiresKiz: true,
      kiz: `010460000000001121${order.id}`,
      wbMetaStatus: 'ACCEPTED',
      barcode: '460000000001',
    }));
    const service = new MarketplaceConnectionsService({
      fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue(links) },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue(tasks) },
    } as never, {} as never);

    await expect(
      (service as any).assertFbsDeliveryReadiness(
        'client-1',
        { orders },
        [orders[0]],
      ),
    ).rejects.toThrow('не собраны на ТСД (50)');
  });

  // TEST: branch audit scope is taken from an explicit WB -> WMS routing rule,
  // not from a city/name guess and not from another branch's supply.
  it('checks only supplies routed to the active WMS branch', async () => {
    const moscowOrder = fbsOrder({
      id: '5600001001',
      category: 'shipped',
      supplierStatus: 'complete',
      statusLabel: 'В доставке',
      supplyId: 'WB-GI-MSK',
      warehouseId: 'wb-msk',
      request: null,
    });
    const noginskOrder = fbsOrder({
      id: '5600001002',
      category: 'shipped',
      supplierStatus: 'complete',
      statusLabel: 'В доставке',
      supplyId: 'WB-GI-NOG',
      warehouseId: 'wb-nog',
      request: null,
    });
    const prisma = {
      fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue([]) },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'connection-1',
          marketplace: MarketplaceType.WILDBERRIES,
          fbsExecutionWarehouseId: 'warehouse-moscow',
          fbsAutoRouteNewWarehouses: false,
        }]),
      },
      fbsWarehouseRoutingRule: {
        findMany: vi.fn().mockResolvedValue([
          {
            connectionId: 'connection-1',
            marketplaceWarehouseId: 'wb-msk',
            mode: 'BRANCH',
            executionWarehouseId: 'warehouse-moscow',
          },
          {
            connectionId: 'connection-1',
            marketplaceWarehouseId: 'wb-nog',
            mode: 'BRANCH',
            executionWarehouseId: 'warehouse-noginsk',
          },
        ]),
      },
      warehouse: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'warehouse-moscow',
          code: 'MSK',
          name: 'Москва',
          city: 'Москва',
        }),
      },
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );
    vi.spyOn(service as any, 'refreshFbsOrdersCache').mockResolvedValue({
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
      connected: true,
      connections: [{ id: 'connection-1', marketplace: MarketplaceType.WILDBERRIES }],
      fetchedAt: '2026-08-29T10:00:00.000Z',
      deliveryPlan: {},
      counts: { active: 0, shipped: 2, cancelled: 0, archive: 0, all: 2 },
      orders: [moscowOrder, noginskOrder],
    });

    const result = await service.checkFbsBranchDeliveryRecovery(
      'client-1',
      {
        id: 'admin-1',
        name: 'Администратор',
        roleCodes: ['ADMIN'],
        permissionCodes: ['system:admin'],
        activeWarehouseId: 'warehouse-moscow',
        warehouseIds: ['warehouse-moscow'],
      } as never,
    );

    expect(result.supplies.map((supply) => supply.supplyId)).toEqual(['WB-GI-MSK']);
    expect(result.recoveryOrders.map((order) => order.orderId)).toEqual(['5600001001']);
  });

  // TEST: creating a recovery request moves only the selected unfinished
  // orders, starts it without a pass and performs no mutation in Wildberries.
  it('creates an idempotent local delivery-recovery request without touching completed orders or WB', async () => {
    const sourceRequest = {
      id: 'request-source',
      number: 400,
      status: ClientRequestStatus.DONE,
      fbsEmergencyAssemblyAt: null,
    };
    const recoveryOrders = [
      {
        connectionId: 'connection-1',
        orderId: '5600000151',
        supplyId: 'WB-GI-200',
        warehouseId: 'wb-warehouse-moscow',
        warehouseName: 'Москва',
        requestId: sourceRequest.id,
        requestNumber: sourceRequest.number,
        requestStatus: sourceRequest.status,
        action: 'COMPLETE',
        actionLabel: 'Дособрать',
        reason: 'Сборка начата, но не завершена.',
        canSelect: true,
        blocker: null,
        itemCount: 1,
        skuId: 'sku-1',
        productName: 'Костюм',
        article: 'ART-1',
        size: 'M',
        barcode: '460000000001',
        requiresKiz: true,
        assemblyId: 'task-151',
        assemblyStatus: 'IN_PROGRESS',
        scannedBarcode: null,
        kiz: null,
        boxCode: 'FFL_TEST_001',
      },
      {
        connectionId: 'connection-1',
        orderId: '5600000176',
        supplyId: 'WB-GI-200',
        warehouseId: 'wb-warehouse-moscow',
        warehouseName: 'Москва',
        requestId: sourceRequest.id,
        requestNumber: sourceRequest.number,
        requestStatus: sourceRequest.status,
        action: 'ASSEMBLE',
        actionLabel: 'Собрать',
        reason: 'Сборка не начиналась.',
        canSelect: true,
        blocker: null,
        itemCount: 1,
        skuId: 'sku-1',
        productName: 'Костюм',
        article: 'ART-1',
        size: 'M',
        barcode: '460000000001',
        requiresKiz: true,
        assemblyId: null,
        assemblyStatus: null,
        scannedBarcode: null,
        kiz: null,
        boxCode: null,
      },
    ];
    const links = recoveryOrders.map((order) => ({
      id: `link-${order.orderId}`,
      connectionId: order.connectionId,
      orderId: order.orderId,
      requestId: sourceRequest.id,
      syncStatus: 'ACTIVE',
      request: sourceRequest,
    }));
    const tx = {
      clientRequest: {
        create: vi.fn().mockResolvedValue({
          id: 'request-recovery',
          number: 401,
          title: 'FBS ДОВОЗ — 2 заказа',
          status: ClientRequestStatus.IN_WORK,
          fbsEmergencyAssemblyAt: new Date('2026-08-29T10:00:00.000Z'),
          items: [{ id: 'recovery-item', skuId: 'sku-1', name: 'Костюм', quantity: 2 }],
        }),
      },
      clientRequestItem: {
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      fbsOrderRequestLink: { update: vi.fn().mockResolvedValue({}) },
      fbsTsdAssembly: { update: vi.fn().mockResolvedValue({}) },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue(links) },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'task-151',
          connectionId: 'connection-1',
          orderId: '5600000151',
          requestId: sourceRequest.id,
          requestItemId: 'source-item',
          status: 'IN_PROGRESS',
        }]),
      },
      clientRequestItem: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'source-item',
          requestId: sourceRequest.id,
          skuId: 'sku-1',
          quantity: 200,
        }]),
      },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    vi.spyOn(service, 'checkFbsBranchDeliveryRecovery').mockResolvedValue({
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
      branch: { id: 'warehouse-moscow', code: 'MSK', name: 'Москва', city: 'Москва' },
      checkedAt: '2026-08-29T10:00:00.000Z',
      counts: {
        supplies: 1,
        orders: 200,
        assembled: 150,
        recoveryRequired: 50,
        assemble: 25,
        complete: 25,
        reassemble: 0,
        readyToSendWb: 0,
        routeIssues: 0,
      },
      supplies: [],
      recoveryOrders: recoveryOrders as never,
      routeIssues: [],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.createFbsDeliveryRecoveryRequest(
      {
        clientId: 'client-1',
        orders: recoveryOrders.map((order) => ({
          connectionId: order.connectionId,
          id: order.orderId,
        })),
      },
      {
        id: 'admin-1',
        name: 'Администратор',
        roleCodes: ['ADMIN'],
        permissionCodes: ['system:admin'],
        activeWarehouseId: 'warehouse-moscow',
        warehouseIds: ['warehouse-moscow'],
      } as never,
    );

    expect(tx.clientRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: ClientRequestStatus.IN_WORK,
        title: 'FBS ДОВОЗ — 2 заказа',
        fbsEmergencyAssemblyAt: expect.any(Date),
        items: { create: [expect.objectContaining({ skuId: 'sku-1', quantity: 2 })] },
      }),
    }));
    expect(tx.fbsOrderRequestLink.update).toHaveBeenCalledTimes(2);
    expect(tx.fbsTsdAssembly.update).toHaveBeenCalledTimes(1);
    expect(tx.clientRequestItem.update).toHaveBeenCalledWith({
      where: { id: 'source-item' },
      data: { quantity: 198 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'CREATED',
      linkedOrders: 2,
      request: {
        id: 'request-recovery',
        number: 401,
        status: ClientRequestStatus.IN_WORK,
      },
    });

    // TEST: a repeated click returns the already active recovery request and
    // never opens a second write transaction.
    prisma.fbsOrderRequestLink.findMany.mockResolvedValueOnce(
      recoveryOrders.map((order) => ({
        id: `link-${order.orderId}`,
        connectionId: order.connectionId,
        orderId: order.orderId,
        requestId: 'request-recovery',
        syncStatus: 'ACTIVE',
        request: {
          id: 'request-recovery',
          number: 401,
          status: ClientRequestStatus.IN_WORK,
          fbsEmergencyAssemblyAt: new Date('2026-08-29T10:00:00.000Z'),
        },
      })),
    );
    const repeated = await service.createFbsDeliveryRecoveryRequest(
      {
        clientId: 'client-1',
        orders: recoveryOrders.map((order) => ({
          connectionId: order.connectionId,
          id: order.orderId,
        })),
      },
      {
        id: 'admin-1',
        name: 'Администратор',
        roleCodes: ['ADMIN'],
        permissionCodes: ['system:admin'],
        activeWarehouseId: 'warehouse-moscow',
        warehouseIds: ['warehouse-moscow'],
      } as never,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(repeated).toMatchObject({
      status: 'ALREADY_EXISTS',
      linkedOrders: 2,
      request: { id: 'request-recovery', number: 401 },
    });
  });

  it('enables idempotent local emergency assembly for a shipped FBS request without calling Wildberries', async () => {
    const request = {
      id: 'request-65',
      number: 65,
      clientId: 'client-1',
      type: ClientRequestType.OUTBOUND,
      status: ClientRequestStatus.SUBMITTED,
      fbsEmergencyAssemblyAt: null,
      fbsEmergencyAssemblyByUserId: null,
      fbsEmergencyAssemblyByName: null,
      fbsOrderLinks: [
        {
          marketplace: MarketplaceType.WILDBERRIES,
          connectionId: 'connection-1',
          orderId: '5355000001',
          syncStatus: 'ACTIVE',
          lastCategory: 'shipped',
          lastSupplierStatus: 'complete',
          lastSupplyId: 'WB-GI-1',
        },
      ],
    };
    const tx = {
      clientRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn(),
      },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({ id: 'event-1' }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      clientRequest: { findUnique: vi.fn().mockResolvedValue(request) },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      service.enableFbsEmergencyAssembly(
        request.id,
        {
          id: 'admin-1',
          email: 'admin@example.test',
          name: 'Администратор',
          roleCodes: ['ADMIN'],
          permissionCodes: [],
          clientScopeMode: 'ALL',
          clientIds: [],
          writableClientIds: [],
        },
      ),
    ).resolves.toMatchObject({
      status: 'APPLIED',
      request: {
        id: 'request-65',
        number: 65,
        status: ClientRequestStatus.IN_WORK,
        fbsEmergencyAssemblyByUserId: 'admin-1',
        fbsEmergencyAssemblyByName: 'Администратор',
      },
      orders: 1,
      shippedOrders: 1,
    });

    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(
      expect.anything(),
      'client-1',
      'write',
    );
    expect(tx.clientRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'request-65',
        fbsEmergencyAssemblyAt: null,
        status: {
          in: [
            ClientRequestStatus.SUBMITTED,
            ClientRequestStatus.IN_REVIEW,
            ClientRequestStatus.APPROVED,
            ClientRequestStatus.IN_WORK,
          ],
        },
      },
      data: {
        status: ClientRequestStatus.IN_WORK,
        fbsEmergencyAssemblyAt: expect.any(Date),
        fbsEmergencyAssemblyByUserId: 'admin-1',
        fbsEmergencyAssemblyByName: 'Администратор',
      },
    });
    expect(tx.clientRequestEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: 'request-65',
        eventType: 'STATUS_CHANGED',
        title: 'FBS-заявка экстренно возвращена в сборку',
        statusFrom: ClientRequestStatus.SUBMITTED,
        statusTo: ClientRequestStatus.IN_WORK,
        createdByUserId: 'admin-1',
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'admin-1',
        action: 'FBS_EMERGENCY_ASSEMBLY_ENABLED',
        entity: 'ClientRequest',
        entityId: 'request-65',
        payload: expect.objectContaining({
          requestNumber: 65,
          supplyIds: ['WB-GI-1'],
          wbMutationPerformed: false,
        }),
      }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not duplicate emergency assembly events when the request is already restored', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-65',
          number: 65,
          clientId: 'client-1',
          type: ClientRequestType.OUTBOUND,
          status: ClientRequestStatus.IN_WORK,
          fbsEmergencyAssemblyAt: new Date('2026-07-29T09:00:00.000Z'),
          fbsEmergencyAssemblyByUserId: 'admin-1',
          fbsEmergencyAssemblyByName: 'Администратор',
          fbsOrderLinks: [
            {
              marketplace: MarketplaceType.WILDBERRIES,
              connectionId: 'connection-1',
              orderId: '5355000001',
              syncStatus: 'ACTIVE',
              lastCategory: 'shipped',
              lastSupplierStatus: 'complete',
              lastSupplyId: 'WB-GI-1',
            },
          ],
        }),
      },
      $transaction: vi.fn(),
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );

    await expect(
      service.enableFbsEmergencyAssembly(
        'request-65',
        {
          id: 'admin-1',
          name: 'Администратор',
          roleCodes: ['ADMIN'],
          permissionCodes: [],
        } as never,
      ),
    ).resolves.toMatchObject({
      status: 'ALREADY_APPLIED',
      request: { id: 'request-65', number: 65 },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('blocks emergency assembly for non-admin users before changing the request', async () => {
    const prisma = {
      clientRequest: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await expect(
      service.enableFbsEmergencyAssembly(
        'request-65',
        {
          id: 'operator-1',
          name: 'Сборщик',
          roleCodes: ['OPERATOR'],
          permissionCodes: ['stock:write'],
        } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.clientRequest.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('shows a shipped request in the TSD picker when emergency assembly is enabled', async () => {
    const prisma = {
      fbsTsdAssembly: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      fbsOrderRequestLink: {
        findMany: vi.fn().mockResolvedValue([
          {
            requestId: 'request-65',
            connectionId: 'connection-1',
            orderId: '5355000001',
            lastCategory: 'shipped',
            lastSupplierStatus: 'complete',
            lastSupplyId: 'WB-GI-1',
            lastSkuId: 'sku-1',
            request: {
              id: 'request-65',
              number: 65,
              title: 'FBS — 1 заказ',
              status: ClientRequestStatus.IN_WORK,
              fbsEmergencyAssemblyAt: new Date('2026-07-29T09:00:00.000Z'),
              fbsEmergencyAssemblyByName: 'Администратор',
              client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
            },
          },
        ]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { skuId: 'sku-1', clientId: 'client-1', boxId: 'box-1' },
        ]),
      },
      client: { findMany: vi.fn().mockResolvedValue([]) },
      sku: { findMany: vi.fn() },
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      {
        resolveClientFilter: vi.fn().mockReturnValue(undefined),
        requireClientAccess: vi.fn(),
      } as never,
    );

    await expect(
      service.listFbsTsdRequests(
        'TSD-1',
        { id: 'worker-1', name: 'Сборщик' } as never,
      ),
    ).resolves.toMatchObject({
      requests: [
        {
          requestId: 'request-65',
          requestNumber: 65,
          totalOrders: 1,
          readyOrders: 1,
          awaitingWbConfirmation: 0,
          emergencyAssemblyAt: '2026-07-29T09:00:00.000Z',
          emergencyAssemblyByName: 'Администратор',
        },
      ],
    });
    expect(prisma.sku.findMany).not.toHaveBeenCalled();
  });

  it('assigns a shipped emergency order from the selected request as a normal TSD task', async () => {
    const emergencyAt = new Date('2026-07-29T09:00:00.000Z');
    const order = fbsOrder({
      category: 'shipped',
      supplierStatus: 'complete',
      request: {
        id: 'request-65',
        number: 65,
        title: 'FBS — 1 заказ',
        status: ClientRequestStatus.IN_WORK,
        fbsEmergencyAssemblyAt: emergencyAt,
        fbsEmergencyAssemblyByUserId: 'admin-1',
        fbsEmergencyAssemblyByName: 'Администратор',
      },
    });
    const releasedTask = {
      id: 'task-1',
      status: 'RELEASED',
      connectionId: 'connection-1',
      orderId: order.id,
      updatedAt: new Date('2026-07-29T09:05:00.000Z'),
    };
    const assignedTask = {
      ...releasedTask,
      status: 'IN_PROGRESS',
      requestId: 'request-65',
      deviceCode: 'TSD-1',
    };
    const prisma = {
      fbsTsdAssembly: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn()
          .mockResolvedValueOnce(releasedTask)
          .mockResolvedValueOnce(assignedTask),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn(),
      },
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-65',
          clientId: 'client-1',
          number: 65,
          status: ClientRequestStatus.IN_WORK,
          fbsEmergencyAssemblyAt: emergencyAt,
        }),
      },
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([{ clientId: 'client-1' }]),
      },
      clientRequestItem: {
        findFirst: vi.fn().mockResolvedValue({ id: 'request-item-1' }),
      },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    const response = {
      orders: [order],
      counts: { active: 0, shipped: 1, cancelled: 0, archive: 0, all: 1 },
    };
    vi.spyOn(service as any, 'loadFbsOrders').mockResolvedValue(response);
    vi.spyOn(service as any, 'mergeSyncedFbsTsdRequestOrders').mockResolvedValue(response);
    vi.spyOn(service as any, 'resolveFbsTsdStockSource').mockResolvedValue({
      sourceSkuId: null,
      sourceProductName: null,
      sourceArticle: null,
      sourceBarcodes: [],
      storageBoxes: [{ code: 'FFL_TEST_001', quantity: 2, status: StockStatus.AVAILABLE }],
      withoutBoxQuantity: 0,
      relabelRequired: false,
    });
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(
      async (task: unknown, _user: unknown, message: string) => ({ task, message }),
    );

    await expect(
      service.getNextFbsTsdAssembly(
        'TSD-1',
        { id: 'worker-1', name: 'Сборщик' } as never,
        'request-65',
      ),
    ).resolves.toMatchObject({
      task: assignedTask,
      message: expect.stringContaining('Wildberries не изменяется'),
    });
    expect(prisma.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        status: 'RELEASED',
        updatedAt: releasedTask.updatedAt,
      },
      data: expect.objectContaining({
        status: 'IN_PROGRESS',
        requestId: 'request-65',
        deviceCode: 'TSD-1',
        workerUserId: 'worker-1',
      }),
    });
    expect(prisma.fbsTsdAssembly.create).not.toHaveBeenCalled();
  });

  it('accepts a KIZ locally during emergency assembly and never mutates Wildberries', async () => {
    const kiz = '010590000000001221EMERGENCY1234';
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      orderId: '5355000001',
      requestId: 'request-65',
      skuId: 'sku-1',
      productName: 'Костюм',
      article: 'ART-1',
      requiresKiz: true,
      status: 'IN_PROGRESS',
      boxId: 'box-1',
      boxCode: 'FFL_TEST_001',
      barcode: '4600000000012',
      barcodes: ['4600000000012'],
      kiz: null,
      wbMetaStatus: 'PENDING',
      relabelRequired: false,
      relabelConfirmedAt: null,
      deviceCode: 'TSD-1',
      workerName: 'Сборщик',
    };
    const accepted = { ...task, kiz, wbMetaStatus: 'ACCEPTED' };
    const prisma = {
      productMark: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'mark-1',
          clientId: 'client-1',
          skuId: 'sku-1',
          boxId: 'box-1',
          status: StockStatus.AVAILABLE,
          box: { code: 'FFL_TEST_001' },
          sku: { name: 'Костюм' },
        }),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(accepted),
      },
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          fbsEmergencyAssemblyAt: new Date('2026-07-29T09:00:00.000Z'),
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
      clientMarketplaceConnection: { findFirst: vi.fn() },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(
      async (updated: unknown, _user: unknown, message: string) => ({ task: updated, message }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      service.scanFbsTsdKiz(
        'task-1',
        { kiz },
        { id: 'worker-1', name: 'Сборщик' } as never,
      ),
    ).resolves.toMatchObject({
      task: accepted,
      message: expect.stringContaining('Wildberries не изменялся'),
    });
    expect(prisma.fbsTsdAssembly.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { kiz, wbMetaStatus: 'ACCEPTED', errorMessage: null },
    });
    expect(prisma.clientMarketplaceConnection.findFirst).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ']Q3PALETSORT 101',
    ']C0PALETSORT 101',
    ']d2PALETSORT 101',
  ])('распознаёт паллетсорт с аппаратным префиксом сканера: %s', async (scannedCode) => {
    const pallet = {
      id: 'pallet-1',
      code: 'PALETSORT 101',
      source: 'TSD',
      status: 'CLOSED',
      zone: { id: 'zone-1', code: 'A', name: 'Зона A' },
      _count: { boxes: 12 },
    };
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          clientId: 'client-1',
          warehouseId: 'warehouse-1',
        }),
      },
      storagePallet: {
        findFirst: vi.fn().mockResolvedValue(pallet),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      requestId: 'request-43',
      status: 'IN_PROGRESS',
      errorMessage: null,
    };
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);
    const formatPallet = vi
      .spyOn(service as any, 'formatFbsTsdPalletScan')
      .mockResolvedValue({
        state: 'PALLET_BOXES',
        palletScan: { code: pallet.code, neededBoxCodes: ['FFL_LKB1705_101'] },
      });

    await expect(
      service.scanFbsTsdBox(
        'task-1',
        { boxCode: scannedCode },
        {
          id: 'user-1',
          email: 'worker@example.test',
          name: 'Сборщик',
          roleCodes: ['OPERATOR'],
          permissionCodes: ['stock:write'],
          clientScopeMode: 'ALL',
          clientIds: [],
          writableClientIds: [],
        },
      ),
    ).resolves.toMatchObject({
      state: 'PALLET_BOXES',
      palletScan: {
        code: 'PALETSORT 101',
        neededBoxCodes: ['FFL_LKB1705_101'],
      },
    });
    expect(prisma.storagePallet.findFirst).toHaveBeenCalledWith({
      where: {
        clientId: 'client-1',
        warehouseId: 'warehouse-1',
        code: { equals: 'PALETSORT 101', mode: Prisma.QueryMode.insensitive },
      },
      select: expect.any(Object),
    });
    expect(formatPallet).toHaveBeenCalledWith(task, pallet, expect.any(Object));
  });

  // ADDED: Regression for a physical box whose pallet-sort placement is being rebuilt.
  // TEST: a background refresh cannot recreate a reservation after the box was archived/unplaced.
  it('does not reserve an archived box from a stale background snapshot', async () => {
    const operation = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'box-archived' }]),
      box: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await expect(
      (service as any).withActivePalletSortBoxLock(
        {
          boxId: 'box-archived',
          clientId: 'client-1',
          skuId: 'sku-1',
          requiredQuantity: 1,
          warehouseId: 'warehouse-1',
          excludeTaskId: null,
        },
        operation,
      ),
    ).resolves.toBeNull();

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.box.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'box-archived',
        clientId: 'client-1',
        warehouseId: 'warehouse-1',
        // TEST: every operational box state is eligible; retired states are excluded.
        status: { notIn: ['deleted', 'archived'] },
        storagePlacement: {
          is: { pallet: { clientId: 'client-1', warehouseId: 'warehouse-1' } },
        },
      },
      select: { id: true },
    });
    expect(operation).not.toHaveBeenCalled();
  });

  // TEST: both background allocation and manager route repair recheck live stock under the shared Box lock.
  it('rechecks active placement and quantity before persisting an FBS reservation', async () => {
    const operation = vi.fn().mockResolvedValue({ id: 'saved-task' });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'box-live' }]),
      box: { findFirst: vi.fn().mockResolvedValue({ id: 'box-live' }) },
      stockBalance: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 2 } }) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const reservations = vi.spyOn(service as any, 'fbsTsdReservationRowsBySku')
      .mockResolvedValue(new Map([['sku-1', []]]));

    await expect(
      (service as any).withActivePalletSortBoxLock(
        {
          boxId: 'box-live',
          clientId: 'client-1',
          skuId: 'sku-1',
          requiredQuantity: 2,
          warehouseId: 'warehouse-1',
          excludeTaskId: 'task-current',
        },
        operation,
      ),
    ).resolves.toEqual({ id: 'saved-task' });

    expect(tx.box.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'box-live',
        clientId: 'client-1',
        warehouseId: 'warehouse-1',
        // TEST: receiving and active boxes share the same locked eligibility rule.
        status: { notIn: ['deleted', 'archived'] },
        storagePlacement: {
          is: { pallet: { clientId: 'client-1', warehouseId: 'warehouse-1' } },
        },
      },
      select: { id: true },
    });
    expect(tx.stockBalance.aggregate).toHaveBeenCalledWith({
      where: {
        boxId: 'box-live',
        clientId: 'client-1',
        skuId: 'sku-1',
        status: StockStatus.AVAILABLE,
        quantity: { gt: 0 },
      },
      _sum: { quantity: true },
    });
    expect(reservations).toHaveBeenCalledWith(
      {
        clientId: 'client-1',
        skuIds: ['sku-1'],
        excludeTaskId: 'task-current',
      },
      tx,
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.stockBalance.aggregate.mock.invocationCallOrder[0],
    );
    expect(tx.stockBalance.aggregate.mock.invocationCallOrder[0]).toBeLessThan(
      operation.mock.invocationCallOrder[0],
    );
  });

  // TEST: a second concurrent reservation sees the first one after waiting for the Box lock.
  it('does not reserve the same physical unit twice under the shared Box lock', async () => {
    const operation = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'box-live' }]),
      box: { findFirst: vi.fn().mockResolvedValue({ id: 'box-live' }) },
      stockBalance: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 1 } }) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const reservations = vi.spyOn(service as any, 'fbsTsdReservationRowsBySku')
      .mockResolvedValue(new Map([['sku-1', [{
        taskId: 'task-first',
        boxId: 'box-live',
        itemCount: 1,
        releasableBackground: false,
      }]]]));

    await expect(
      (service as any).withActivePalletSortBoxLock(
        {
          boxId: 'box-live',
          clientId: 'client-1',
          skuId: 'sku-1',
          requiredQuantity: 1,
          warehouseId: 'warehouse-1',
          excludeTaskId: 'task-second',
        },
        operation,
      ),
    ).resolves.toBeNull();

    expect(reservations).toHaveBeenCalledOnce();
    expect(operation).not.toHaveBeenCalled();
  });

  // TEST: a serializable conflict caused by waiting for the Box lock is retried with a fresh snapshot.
  it('retries a pallet-sort reservation once after PostgreSQL serialization conflict', async () => {
    const operation = vi.fn().mockResolvedValue({ id: 'saved-after-retry' });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'box-live' }]),
      box: { findFirst: vi.fn().mockResolvedValue({ id: 'box-live' }) },
      stockBalance: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 1 } }) },
    };
    const serializationError = new Prisma.PrismaClientKnownRequestError(
      'serialization conflict',
      { code: 'P2034', clientVersion: 'test' },
    );
    const transaction = vi.fn()
      .mockRejectedValueOnce(serializationError)
      .mockImplementationOnce(async (callback: (db: typeof tx) => unknown) => callback(tx));
    const service = new MarketplaceConnectionsService(
      { $transaction: transaction } as never,
      {} as never,
    );
    vi.spyOn(service as any, 'fbsTsdReservationRowsBySku')
      .mockResolvedValue(new Map([['sku-1', []]]));

    await expect(
      (service as any).withActivePalletSortBoxLock(
        {
          boxId: 'box-live',
          clientId: 'client-1',
          skuId: 'sku-1',
          requiredQuantity: 1,
          warehouseId: 'warehouse-1',
          excludeTaskId: null,
        },
        operation,
      ),
    ).resolves.toEqual({ id: 'saved-after-retry' });

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledOnce();
  });

  // TEST: fallback may only clear the exact untouched AUTO reservation from its snapshot.
  it('uses strict CAS when a background box recheck rejects a stale reservation', async () => {
    const updatedAt = new Date('2026-08-27T11:00:00.000Z');
    const existing = {
      id: 'task-background-1',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      orderId: '5355000001',
      requestId: 'request-1',
      skuId: 'sku-1',
      sourceSkuId: null,
      status: 'RESERVED',
      itemCount: 1,
      deviceCode: 'AUTO:FBS:PALLET_SORT',
      workerUserId: null,
      workerName: null,
      reservedBoxId: 'box-old',
      reservedBoxCode: 'FFL_OLD',
      reservedAt: new Date('2026-08-27T10:59:00.000Z'),
      boxId: null,
      boxCode: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
      completedAt: null,
      relabelConfirmedAt: null,
      updatedAt,
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue({ storesWithoutBoxes: false }) },
      clientRequestItem: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'item-1', requestId: 'request-1', skuId: 'sku-1' },
        ]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([existing]),
        updateMany,
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([{
          skuId: 'sku-1',
          boxId: 'box-new',
          quantity: 1,
          box: {
            id: 'box-new',
            code: 'FFL_NEW',
            warehouseId: 'warehouse-1',
            storagePlacement: {
              pallet: {
                id: 'pallet-1',
                code: 'PS-001',
                warehouseId: 'warehouse-1',
                status: 'active',
              },
            },
          },
        }]),
      },
      storagePalletBox: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'fbsTsdReservationRowsBySku')
      .mockResolvedValue(new Map([['sku-1', []]]));
    vi.spyOn(service as any, 'resolveFbsWarehouseFromWildberries')
      .mockResolvedValue('warehouse-1');
    vi.spyOn(service as any, 'withActivePalletSortBoxLock').mockResolvedValue(null);

    await (service as any).syncFbsPalletSortReservations('client-1', [
      fbsOrder({
        id: '5355000001',
        request: { id: 'request-1', warehouseId: 'warehouse-1' },
        warehouseId: 'wb-warehouse-1',
        officeId: 'wb-office-1',
      }),
    ]);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: existing.id,
        status: existing.status,
        updatedAt,
        deviceCode: existing.deviceCode,
        workerUserId: null,
        reservedBoxId: existing.reservedBoxId,
        reservedBoxCode: existing.reservedBoxCode,
        boxId: null,
        sourceBarcode: null,
        barcode: null,
        kiz: null,
        completedAt: null,
        relabelConfirmedAt: null,
      },
      data: expect.objectContaining({
        status: 'WAITING_STOCK',
        reservedBoxId: null,
        reservedBoxCode: null,
      }),
    });
  });

  // TEST: manager route repair uses the locked recheck and falls back to WAITING_STOCK on a stale box.
  it('does not attach manager route repair to a box archived during recalculation', async () => {
    const request = {
      id: 'request-repair-1',
      number: 311,
      clientId: 'client-1',
      warehouseId: 'warehouse-1',
      type: ClientRequestType.OUTBOUND,
      status: ClientRequestStatus.IN_WORK,
      client: { storesWithoutBoxes: false },
      fbsOrderLinks: [{
        marketplace: MarketplaceType.WILDBERRIES,
        connectionId: 'connection-1',
        orderId: 'order-1',
        lastSupplyId: 'supply-1',
        lastSkuId: 'sku-1',
        lastItemCount: 1,
      }],
      items: [{
        id: 'item-1',
        skuId: 'sku-1',
        barcode: '4600000000012',
        name: 'Костюм',
        sku: {
          id: 'sku-1',
          internalSku: 'SKU-1',
          clientSku: null,
          article: 'ART-1',
          name: 'Костюм',
          needsChestnyZnak: false,
          isUnmarked: false,
          barcodes: [{ value: '4600000000012' }],
        },
      }],
    };
    const task = {
      id: 'task-repair-1',
      requestId: request.id,
      connectionId: 'connection-1',
      orderId: 'order-1',
      skuId: 'sku-1',
      sourceSkuId: null,
      itemCount: 1,
      status: 'RESERVED',
      boxId: null,
      barcode: null,
      kiz: null,
      sourceBarcode: null,
      relabelConfirmedAt: null,
      updatedAt: new Date('2026-08-27T10:00:00.000Z'),
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      clientRequest: { findUnique: vi.fn().mockResolvedValue(request) },
      fbsTsdAssembly: {
        findMany: vi.fn()
          .mockResolvedValueOnce([task])
          .mockResolvedValueOnce([task]),
        updateMany,
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([{
          skuId: 'sku-1',
          boxId: 'box-stale',
          quantity: 1,
          box: {
            id: 'box-stale',
            code: 'FFL_STALE',
            warehouseId: 'warehouse-1',
            storagePlacement: { pallet: { code: 'PALLET-1' } },
          },
        }]),
      },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService(prisma as never, clientScopes as never);
    vi.spyOn(service as any, 'getFbsRequestRoute')
      .mockResolvedValueOnce({ version: 1, boxes: [] })
      .mockResolvedValueOnce({ version: 1, boxes: [] });
    vi.spyOn(service as any, 'fbsTsdReservationRows').mockResolvedValue([]);
    const lock = vi.spyOn(service as any, 'withActivePalletSortBoxLock').mockResolvedValue(null);

    await service.repairFbsRequestSelection(request.id, { id: 'admin-1' } as never);

    expect(lock).toHaveBeenCalledWith(
      {
        boxId: 'box-stale',
        clientId: 'client-1',
        skuId: 'sku-1',
        requiredQuantity: 1,
        warehouseId: 'warehouse-1',
        excludeTaskId: 'task-repair-1',
      },
      expect.any(Function),
    );
    expect(updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        id: 'task-repair-1',
        status: 'RESERVED',
        updatedAt: task.updatedAt,
        boxId: null,
        sourceBarcode: null,
        barcode: null,
        kiz: null,
        relabelConfirmedAt: null,
      }),
      data: expect.objectContaining({
        status: 'WAITING_STOCK',
        reservedBoxId: null,
        reservedBoxCode: null,
        reservedAt: null,
      }),
    });
  });

  // ADDED: Regression for a physical box whose pallet-sort placement is being rebuilt.
  it('accepts a required FBS box when its pallet-sort link is temporarily missing', async () => {
    const task = {
      id: 'task-1',
      clientId: 'client-1',
      requestId: 'request-255',
      skuId: 'sku-needed',
      sourceSkuId: null,
      status: 'IN_PROGRESS',
      itemCount: 1,
      relabelRequired: false,
      reservedAt: null,
      reservedBoxId: null,
      reservedBoxCode: null,
      boxId: null,
      boxCode: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
      relabelConfirmedAt: null,
      workerUserId: 'user-1',
      workerName: 'Надежда',
      deviceCode: 'TSD-1',
      errorMessage: null,
      updatedAt: new Date('2026-08-27T10:00:00.000Z'),
    };
    const accepted = {
      ...task,
      reservedBoxId: 'box-physical',
      reservedBoxCode: 'FFL_LKB2107_55',
      boxId: 'box-physical',
      boxCode: 'FFL_LKB2107_55',
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      // TEST: the FBS claim and administrative retirement serialize on the same Box row.
      $queryRaw: vi.fn().mockResolvedValue([{
        status: 'active',
        clientId: 'client-1',
        warehouseId: 'warehouse-1',
      }]),
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          clientId: 'client-1',
          warehouseId: 'warehouse-1',
        }),
      },
      stockBalance: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 1 } }),
      },
      fbsTsdAssembly: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(task)
          .mockResolvedValueOnce(accepted),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          clientId: 'client-1',
          warehouseId: 'warehouse-1',
        }),
      },
      storagePallet: { findFirst: vi.fn().mockResolvedValue(null) },
      box: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'box-physical',
          code: 'FFL_LKB2107_55',
          warehouseId: 'warehouse-1',
          storagePlacement: null,
        }),
      },
      stockBalance: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 1 } }),
      },
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);
    vi.spyOn(service as any, 'fbsTsdReservationRows').mockResolvedValue([]);
    vi.spyOn(service as any, 'fbsTsdReservationRowsBySku').mockResolvedValue(new Map([['sku-needed', []]]));
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(
      async (updated: unknown, _user: unknown, message: string) => ({ task: updated, message }),
    );

    await expect(
      service.scanFbsTsdBox(
        'task-1',
        { boxCode: 'FFL_LKB2107_55' },
        {
          id: 'user-1',
          email: 'nadezhda@example.test',
          name: 'Надежда',
          deviceCode: 'TSD-1',
          roleCodes: ['OPERATOR'],
          permissionCodes: ['stock:write'],
          clientScopeMode: 'ALL',
          clientIds: [],
          writableClientIds: [],
        } as never,
      ),
    ).resolves.toMatchObject({
      task: accepted,
      message: expect.stringContaining('Теперь сканируйте ШК товара'),
    });
    expect(prisma.box.findFirst).toHaveBeenCalledWith({
      where: {
        clientId: 'client-1',
        code: { equals: 'FFL_LKB2107_55', mode: Prisma.QueryMode.insensitive },
        status: { notIn: ['deleted', 'archived'] },
      },
      select: expect.any(Object),
    });
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.fbsTsdAssembly.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        status: 'IN_PROGRESS',
        workerUserId: 'user-1',
        deviceCode: 'TSD-1',
        updatedAt: task.updatedAt,
      },
      data: expect.objectContaining({ boxId: 'box-physical', boxCode: 'FFL_LKB2107_55' }),
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.fbsTsdAssembly.updateMany.mock.invocationCallOrder[0],
    );
  });

  // TEST: a request in branch A must never claim a physical box from branch B.
  it('rejects a physical FBS box from another request warehouse', async () => {
    const task = {
      id: 'task-cross-warehouse',
      clientId: 'client-1',
      requestId: 'request-warehouse-a',
      skuId: 'sku-1',
      sourceSkuId: null,
      status: 'IN_PROGRESS',
      itemCount: 1,
      relabelRequired: false,
      boxId: null,
      boxCode: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
      relabelConfirmedAt: null,
      workerUserId: 'user-1',
      workerName: 'Надежда',
      deviceCode: 'TSD-1',
      updatedAt: new Date('2026-08-27T12:00:00.000Z'),
    };
    const stockAggregate = vi.fn();
    const transaction = vi.fn();
    const service = new MarketplaceConnectionsService({
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          clientId: 'client-1',
          warehouseId: 'warehouse-a',
        }),
      },
      storagePallet: { findFirst: vi.fn().mockResolvedValue(null) },
      box: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'box-warehouse-b',
          code: 'FFL_OTHER_BRANCH',
          warehouseId: 'warehouse-b',
          storagePlacement: null,
        }),
      },
      stockBalance: { aggregate: stockAggregate },
      $transaction: transaction,
    } as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);

    await expect(
      service.scanFbsTsdBox(
        task.id,
        { boxCode: 'FFL_OTHER_BRANCH' },
        { id: 'user-1', deviceCode: 'TSD-1' } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(stockAggregate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  // TEST: a legacy request without warehouseId is scoped by the existing default-Moscow rule.
  it('rejects a non-Moscow box for a legacy FBS request without warehouseId', async () => {
    const task = {
      id: 'task-legacy-warehouse',
      clientId: 'client-1',
      requestId: 'request-legacy',
      status: 'IN_PROGRESS',
      reservedBoxId: null,
    };
    const transaction = vi.fn();
    const warehouseFindFirst = vi.fn().mockResolvedValue({ id: 'warehouse-moscow' });
    const service = new MarketplaceConnectionsService({
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({ clientId: 'client-1', warehouseId: null }),
      },
      warehouse: { findFirst: warehouseFindFirst },
      storagePallet: { findFirst: vi.fn().mockResolvedValue(null) },
      box: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'box-kazan',
          code: 'FFL_KAZAN',
          warehouseId: 'warehouse-kazan',
          storagePlacement: null,
        }),
      },
      $transaction: transaction,
    } as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);

    await expect(
      service.scanFbsTsdBox(
        task.id,
        { boxCode: 'FFL_KAZAN' },
        { id: 'user-1', deviceCode: 'TSD-1' } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(warehouseFindFirst).toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  // TEST: an AUTO task is fail-closed unless its saved reservation fixes the exact branch.
  it('rejects an AUTO FBS box outside the saved reservation warehouse', async () => {
    const task = {
      id: 'task-auto-warehouse',
      clientId: 'client-1',
      requestId: 'AUTO:WILDBERRIES:connection-1:order-1',
      status: 'IN_PROGRESS',
      reservedBoxId: 'box-route',
    };
    const transaction = vi.fn();
    const service = new MarketplaceConnectionsService({
      clientRequest: { findUnique: vi.fn().mockResolvedValue(null) },
      storagePallet: { findFirst: vi.fn().mockResolvedValue(null) },
      box: {
        findUnique: vi.fn().mockResolvedValue({
          clientId: 'client-1',
          warehouseId: 'warehouse-a',
          status: 'active',
        }),
        findFirst: vi.fn().mockResolvedValue({
          id: 'box-other',
          code: 'FFL_OTHER',
          warehouseId: 'warehouse-b',
          storagePlacement: null,
        }),
      },
      $transaction: transaction,
    } as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);

    await expect(
      service.scanFbsTsdBox(
        task.id,
        { boxCode: 'FFL_OTHER' },
        { id: 'user-1', deviceCode: 'TSD-1' } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction).not.toHaveBeenCalled();
  });

  // TEST: losing the physical task CAS must return a stale conflict and perform no claim.
  it('rejects a physical FBS claim when the lease CAS no longer matches', async () => {
    const updatedAt = new Date('2026-08-27T12:30:00.000Z');
    const task = {
      id: 'task-cas-lost',
      clientId: 'client-1',
      requestId: 'request-1',
      skuId: 'sku-1',
      sourceSkuId: null,
      status: 'IN_PROGRESS',
      itemCount: 1,
      relabelRequired: false,
      reservedAt: null,
      reservedBoxId: null,
      boxId: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
      relabelConfirmedAt: null,
      workerUserId: 'user-1',
      workerName: 'Надежда',
      deviceCode: 'TSD-1',
      updatedAt,
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{
        status: 'active',
        clientId: 'client-1',
        warehouseId: 'warehouse-1',
      }]),
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          clientId: 'client-1',
          warehouseId: 'warehouse-1',
        }),
      },
      stockBalance: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 1 } }) },
      fbsTsdAssembly: {
        findUnique: vi.fn().mockResolvedValue(task),
        updateMany,
      },
    };
    const service = new MarketplaceConnectionsService({
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    } as never, {} as never);
    vi.spyOn(service as any, 'fbsTsdReservationRowsBySku')
      .mockResolvedValue(new Map([['sku-1', []]]));

    await expect(
      (service as any).claimFbsTsdBoxAtomically(
        task,
        { id: 'box-1', code: 'FFL_BOX_1', warehouseId: 'warehouse-1' },
        'warehouse-1',
        { id: 'user-1', deviceCode: 'TSD-1' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: task.id,
        status: 'IN_PROGRESS',
        workerUserId: 'user-1',
        deviceCode: 'TSD-1',
        updatedAt,
      },
      data: expect.objectContaining({ boxId: 'box-1', boxCode: 'FFL_BOX_1' }),
    });
  });

  // TEST: a box that is still in the receiving workflow is already a valid
  // physical FBS source when it has AVAILABLE stock and belongs to the branch.
  it('claims an FBS box with receiving status instead of reporting another request', async () => {
    const updatedAt = new Date('2026-08-29T09:30:00.000Z');
    const task = {
      id: 'task-receiving-box',
      clientId: 'client-1',
      requestId: 'request-1',
      skuId: 'sku-1',
      sourceSkuId: null,
      status: 'IN_PROGRESS',
      itemCount: 1,
      relabelRequired: false,
      reservedAt: null,
      reservedBoxId: 'box-receiving',
      boxId: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
      relabelConfirmedAt: null,
      workerUserId: 'user-1',
      workerName: 'Сборщик',
      deviceCode: 'TSD-1',
      updatedAt,
    };
    const claimedTask = {
      ...task,
      boxId: 'box-receiving',
      boxCode: 'FFL_RECEIVING_1',
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{
        status: 'receiving',
        clientId: 'client-1',
        warehouseId: 'warehouse-1',
      }]),
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          clientId: 'client-1',
          warehouseId: 'warehouse-1',
        }),
      },
      stockBalance: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 4 } }),
      },
      fbsTsdAssembly: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(task)
          .mockResolvedValueOnce(task)
          .mockResolvedValueOnce(claimedTask),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const transaction = vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx));
    const service = new MarketplaceConnectionsService({
      $transaction: transaction,
    } as never, {} as never);
    vi.spyOn(service as any, 'fbsTsdReservationRowsBySku')
      .mockResolvedValue(new Map([['sku-1', []]]));

    await expect(
      (service as any).claimFbsTsdBoxAtomically(
        task,
        { id: 'box-receiving', code: 'FFL_RECEIVING_1', warehouseId: 'warehouse-1' },
        'warehouse-1',
        { id: 'user-1', deviceCode: 'TSD-1' },
      ),
    ).resolves.toMatchObject({
      id: 'task-receiving-box',
      boxId: 'box-receiving',
      boxCode: 'FFL_RECEIVING_1',
    });
    expect(tx.fbsTsdAssembly.updateMany).toHaveBeenCalledOnce();
    // TEST: a physical alternative-box scan must not inherit Prisma's
    // five-second interactive transaction timeout.
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      maxWait: 10_000,
      timeout: 15_000,
    });
  });

  it('показывает на паллетсорте только короба, закреплённые за текущей FBS-заявкой', async () => {
    const prisma = {
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          { boxId: null, reservedBoxId: 'box-needed' },
          { boxId: 'box-scanned', reservedBoxId: 'box-old' },
        ]),
      },
      storagePalletBox: {
        findMany: vi.fn().mockResolvedValue([
          { boxCode: 'FFL_NEEDED_001' },
          { boxCode: 'FFL_SCANNED_002' },
        ]),
      },
      clientRequestItem: { findMany: vi.fn() },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await expect(
      (service as any).remainingRequestBoxesOnStoragePallet(
        'request-175',
        'client-1',
        'pallet-402',
        'FFL_SCANNED_002',
      ),
    ).resolves.toEqual(['FFL_NEEDED_001']);
    expect(prisma.fbsTsdAssembly.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ requestId: 'request-175' }),
      }),
    );
    expect(prisma.storagePalletBox.findMany).toHaveBeenCalledWith({
      where: {
        palletId: 'pallet-402',
        boxId: { in: ['box-needed', 'box-scanned'] },
      },
      select: { boxCode: true },
    });
    expect(prisma.clientRequestItem.findMany).not.toHaveBeenCalled();
  });

  // TEST: scanning a pallet-sort must keep boxes visible when their orders are
  // only virtually assigned to another employee and no physical scan exists.
  it('shows a box on the pallet when another active TSD route is still untouched', async () => {
    const currentTask = {
      id: 'task-current',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      requestId: 'request-469',
      supplyId: 'WB-GI-469',
      skuId: 'sku-current',
      sourceSkuId: null,
      itemCount: 1,
      status: 'IN_PROGRESS',
      boxId: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
      relabelConfirmedAt: null,
    };
    const otherActiveTask = {
      ...currentTask,
      id: 'task-other-worker',
      skuId: 'sku-on-pallet',
      reservedBoxId: 'box-on-pallet',
      reservedBoxCode: 'FFL_LKB0807_009',
    };
    const findMany = vi.fn(async ({ where }: { where: { status?: { in?: string[] } } }) =>
      where.status?.in?.includes('IN_PROGRESS') ? [otherActiveTask] : [],
    );
    const prisma = {
      fbsTsdAssembly: { findMany },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            skuId: 'sku-on-pallet',
            boxId: 'box-on-pallet',
            quantity: 1,
          },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'fbsTsdReservationRowsBySku').mockResolvedValue(new Map([
      ['sku-on-pallet', [{
        taskId: 'task-other-worker',
        boxId: 'box-on-pallet',
        itemCount: 1,
        releasableBackground: false,
      }]],
      ['sku-current', []],
    ]));

    await expect(
      (service as any).neededFbsRequestBoxesFromPlacements(currentTask, [
        { boxId: 'box-on-pallet', boxCode: 'FFL_LKB0807_009' },
      ]),
    ).resolves.toEqual(['FFL_LKB0807_009']);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: expect.objectContaining({ in: expect.arrayContaining(['IN_PROGRESS']) }),
        boxId: null,
        sourceBarcode: null,
        barcode: null,
        kiz: null,
      }),
    }));
  });

  // TEST: one WMS request may contain several WB supplies. A pallet shown for
  // an untouched order from another supply must remain valid when scanned.
  it('accepts a needed pallet across supplies of the same FBS request', async () => {
    const currentTask = {
      id: 'task-current',
      clientId: 'client-1',
      marketplace: MarketplaceType.WILDBERRIES,
      connectionId: 'connection-1',
      requestId: 'request-466',
      supplyId: 'WB-GI-SUPPLY-A',
      skuId: 'sku-current',
      sourceSkuId: null,
      itemCount: 1,
      status: 'IN_PROGRESS',
      boxId: null,
      sourceBarcode: null,
      barcode: null,
      kiz: null,
      relabelConfirmedAt: null,
    };
    const taskFromAnotherSupply = {
      ...currentTask,
      id: 'task-supply-b',
      supplyId: 'WB-GI-SUPPLY-B',
      skuId: 'sku-on-pallet',
      status: 'RESERVED',
      reservedBoxId: 'box-on-pallet',
      reservedBoxCode: 'FFL_LKB0207_219',
    };
    const findMany = vi.fn(async ({ where }: { where: { supplyId?: string | null } }) =>
      where.supplyId === undefined ? [taskFromAnotherSupply] : [],
    );
    const prisma = {
      fbsTsdAssembly: { findMany },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([{
          skuId: 'sku-on-pallet',
          boxId: 'box-on-pallet',
          quantity: 1,
        }]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'fbsTsdReservationRowsBySku').mockResolvedValue(new Map([
      ['sku-current', []],
      ['sku-on-pallet', [{
        taskId: 'task-supply-b',
        boxId: 'box-on-pallet',
        itemCount: 1,
        releasableBackground: true,
      }]],
    ]));

    await expect(
      (service as any).neededFbsRequestBoxesFromPlacements(currentTask, [
        { boxId: 'box-on-pallet', boxCode: 'FFL_LKB0207_219' },
      ]),
    ).resolves.toEqual(['FFL_LKB0207_219']);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ supplyId: expect.anything() }),
    }));
  });

  it('освобождает нетронутый фоновый резерв, когда короб физически выбран для заявки', async () => {
    const prisma = {
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'auto-new', itemCount: 1, status: 'RESERVED', deviceCode: 'AUTO:FBS:PALLET_SORT' },
          { id: 'auto-old', itemCount: 1, status: 'RESERVED', deviceCode: 'AUTO:FBS:PALLET_SORT' },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    vi.spyOn(service as any, 'fbsTsdReservationRows').mockResolvedValue([
      { boxId: 'box-15', itemCount: 1 },
      { boxId: 'box-15', itemCount: 1 },
    ]);

    await expect(
      (service as any).releaseUntouchedFbsReservationsForScannedBox({
        clientId: 'client-1',
        requestId: 'request-175',
        taskId: 'task-current',
        skuId: 'sku-korea',
        boxId: 'box-15',
        boxCode: 'FFL_LKB25_015',
        requiredQuantity: 1,
        availableQuantity: 2,
      }),
    ).resolves.toBe(1);
    expect(prisma.fbsTsdAssembly.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['auto-new'] },
          deviceCode: 'AUTO:FBS:PALLET_SORT',
          boxId: null,
          reservedBoxId: 'box-15',
        }),
        data: expect.objectContaining({
          status: 'WAITING_STOCK',
          reservedBoxId: null,
          reservedBoxCode: null,
        }),
      }),
    );
  });

  it('reserves FBS stock without boxes for a client configured for piece storage', async () => {
    const tasks: Array<Record<string, any>> = [];
    const fbsTsdAssembly = {
      findMany: vi.fn(async ({ select }: { select?: { connectionId?: boolean } }) =>
        select?.connectionId ? tasks : [],
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const task = {
          id: 'task-no-box-1',
          ...data,
          reservedAt: data.reservedAt as Date | null,
        };
        tasks.push(task);
        return task;
      }),
      update: vi.fn(),
    };
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ storesWithoutBoxes: true }),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([{ skuId: 'sku-1', quantity: 5 }]),
      },
      fbsTsdAssembly,
      storagePalletBox: {
        findMany: vi.fn(),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    const result = await (service as any).syncFbsPalletSortReservations(
      'client-1',
      [
        fbsOrder({
          storageBoxes: [
            { code: 'FFL_SHOULD_NOT_BE_USED', quantity: 10, status: 'AVAILABLE' },
          ],
          product: {
            ...fbsOrder().product,
            needsChestnyZnak: false,
            isUnmarked: true,
          },
        }),
      ],
    );

    // FIX: Piece balances are loaded once for the whole order batch.
    expect(prisma.stockBalance.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-1',
        skuId: { in: ['sku-1'] },
        status: StockStatus.AVAILABLE,
        OR: [
          { boxId: null },
          {
            boxId: { not: null },
            box: { status: { notIn: ['deleted', 'archived'] } },
          },
        ],
      },
      select: { skuId: true, quantity: true },
    });
    expect(fbsTsdAssembly.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'RESERVED',
        boxId: null,
        boxCode: 'БЕЗ КОРОБА',
        reservedBoxId: null,
        reservedBoxCode: null,
      }),
    });
    expect(result.get('connection-1:5355000001')).toMatchObject({
      status: 'RESERVED',
      withoutBox: true,
      boxCode: 'БЕЗ КОРОБА',
      palletCode: null,
    });
  });

  it('loads pallet-sort sources in one batch and does not reserve one unit twice', async () => {
    const tasks: Array<Record<string, any>> = [];
    const fbsTsdAssembly = {
      findMany: vi.fn(async ({ select }: { select?: { skuId?: boolean; status?: boolean } }) => {
        return tasks;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const task = { id: `task-${data.orderId}`, ...data };
        tasks.push(task);
        return task;
      }),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ storesWithoutBoxes: false }),
      },
      clientRequestItem: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'item-1', requestId: 'request-1', skuId: 'sku-1' },
        ]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            skuId: 'sku-1',
            boxId: 'box-1',
            quantity: 1,
            box: {
              id: 'box-1',
              code: 'FFL_BOX_001',
              warehouseId: 'warehouse-1',
              storagePlacement: {
                pallet: {
                  id: 'pallet-1',
                  code: 'PS-001',
                  warehouseId: 'warehouse-1',
                  status: 'active',
                },
              },
            },
          },
        ]),
      },
      fbsTsdAssembly,
      storagePalletBox: {
        findMany: vi.fn().mockResolvedValue([
          {
            boxId: 'box-1',
            pallet: { code: 'PS-001', warehouseId: 'warehouse-1' },
          },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const routeLookup = vi
      .spyOn(service as any, 'resolveFbsWarehouseFromWildberries')
      .mockResolvedValue('warehouse-1');
    const request = { id: 'request-1', warehouseId: null };

    const result = await (service as any).syncFbsPalletSortReservations(
      'client-1',
      [
        fbsOrder({
          id: '5355000001',
          request,
          warehouseId: 'wb-warehouse-1',
          officeId: 'wb-office-1',
        }),
        fbsOrder({
          id: '5355000002',
          request,
          warehouseId: 'wb-warehouse-1',
          officeId: 'wb-office-1',
        }),
      ],
    );

    // ADDED: one request-item query and one stock query serve the entire batch.
    expect(prisma.clientRequestItem.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.stockBalance.findMany).toHaveBeenCalledTimes(1);
    expect(routeLookup).toHaveBeenCalledTimes(1);
    expect(fbsTsdAssembly.create).toHaveBeenCalledTimes(2);
    expect(tasks.map((task) => task.status)).toEqual(['RESERVED', 'WAITING_STOCK']);
    expect(tasks.map((task) => task.reservedBoxId)).toEqual(['box-1', null]);
    expect(result.get('connection-1:5355000001')).toMatchObject({
      status: 'RESERVED',
      boxCode: 'FFL_BOX_001',
      palletCode: 'PS-001',
    });
    expect(result.get('connection-1:5355000002')).toMatchObject({
      status: 'WAITING_STOCK',
      boxCode: null,
    });

    await (service as any).syncFbsPalletSortReservations(
      'client-1',
      [
        fbsOrder({
          id: '5355000001',
          request,
          warehouseId: 'wb-warehouse-1',
          officeId: 'wb-office-1',
        }),
        fbsOrder({
          id: '5355000002',
          request,
          warehouseId: 'wb-warehouse-1',
          officeId: 'wb-office-1',
        }),
      ],
    );

    // ADDED: An unchanged second refresh performs no per-order UPDATE.
    expect(fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  });

  it('routes one WB seller warehouse to its own branch instead of the central branch', async () => {
    const prisma = {
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'connection-1',
            apiKey: 'wb-key',
            fbsExecutionWarehouseId: 'warehouse-moscow',
            fbsAutoRouteNewWarehouses: true,
          },
        ]),
      },
      warehouse: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'warehouse-moscow', code: 'MSK', name: 'ФФ Москва', city: 'Москва' },
          { id: 'warehouse-kazan', code: 'KZN', name: 'ФФ Казань', city: 'Казань' },
        ]),
      },
      fbsWarehouseRoutingRule: {
        findMany: vi.fn().mockResolvedValue([
          {
            connectionId: 'connection-1',
            marketplaceWarehouseId: '1935327',
            mode: 'BRANCH',
            executionWarehouseId: 'warehouse-kazan',
          },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    const warehouseId = await (service as any).resolveFbsWarehouseFromWildberries(
      'client-1',
      [fbsOrder({ warehouseId: '1935327', officeId: '3088703' })],
    );

    expect(warehouseId).toBe('warehouse-kazan');
  });

  it('does not route new orders from a WB seller warehouse excluded from WMS', async () => {
    const prisma = {
      clientMarketplaceConnection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'connection-1',
            apiKey: 'wb-key',
            fbsExecutionWarehouseId: 'warehouse-moscow',
            fbsAutoRouteNewWarehouses: true,
          },
        ]),
      },
      warehouse: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'warehouse-moscow', code: 'MSK', name: 'ФФ Москва', city: 'Москва' },
        ]),
      },
      fbsWarehouseRoutingRule: {
        findMany: vi.fn().mockResolvedValue([
          {
            connectionId: 'connection-1',
            marketplaceWarehouseId: '1935327',
            mode: 'EXCLUDED',
            executionWarehouseId: null,
          },
        ]),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);

    await expect(
      (service as any).resolveFbsWarehouseFromWildberries(
        'client-1',
        [fbsOrder({ warehouseId: '1935327', officeId: '3088703' })],
      ),
    ).rejects.toMatchObject({ name: 'FbsWarehouseExcludedError' });
  });

  it('loads large pallet-sort reservation sets with IN batches instead of composite OR branches', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ storesWithoutBoxes: false }),
      },
      stockBalance: {
        findMany: vi.fn(),
      },
      fbsTsdAssembly: {
        findMany,
      },
      storagePalletBox: {
        findMany: vi.fn(),
      },
    };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const orders = Array.from({ length: 8_001 }, (_, index) =>
      fbsOrder({ id: String(5_400_000_000 + index), category: 'cancelled' }),
    );

    await expect(
      (service as any).syncFbsPalletSortReservations('client-1', orders),
    ).resolves.toBeInstanceOf(Map);

    // FIX: one initial and one final query; no 4,000-branch SQL expression.
    expect(findMany).toHaveBeenCalledTimes(2);
    for (const [query] of findMany.mock.calls) {
      expect(query.where.OR).toBeUndefined();
      expect(query.where.connectionId).toEqual({ in: ['connection-1'] });
      expect(query.where.orderId.in).toHaveLength(8_001);
      expect(query.where.orderId.in.length).toBeLessThanOrEqual(20_000);
    }
  });

  it('exports cancelled orders only after checking the current client scope and server snapshot', async () => {
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new MarketplaceConnectionsService({} as never, clientScopes as never);
    const cancelled = fbsOrder({
      category: 'cancelled',
      supplierStatus: 'cancel',
      wbStatus: 'canceled_by_client',
      statusLabel: 'Отменён покупателем',
      deliveryDate: '2026-08-27T12:34:56.000Z',
    });
    const resolve = vi.spyOn(service as any, 'resolveSelectedFbsOrders').mockResolvedValue({
      response: {},
      orders: [cancelled],
    });
    const scopedResponse = { orders: [cancelled] } as never;
    const list = vi.spyOn(service, 'listFbsOrders').mockResolvedValue(scopedResponse);
    const user = { id: 'user-1' } as never;

    const result = await service.exportFbsCancelledOrders(
      {
        clientId: ' client-1 ',
        orders: [{ connectionId: 'connection-1', id: '5355000001' }],
      },
      user,
    );

    // TEST: access and fresh resolution happen before the workbook is returned.
    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(user, 'client-1', 'read');
    expect(list).toHaveBeenCalledWith('client-1', user, true);
    expect(resolve).toHaveBeenCalledWith(
      'client-1',
      [{ connectionId: 'connection-1', id: '5355000001' }],
      scopedResponse,
    );
    expect(result.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(result.fileName).toMatch(/^FBS-cancelled-orders-.*\.xlsx$/);
  });

  it('rejects an order whose current server status is no longer cancelled', async () => {
    const service = new MarketplaceConnectionsService(
      {} as never,
      { requireClientAccess: vi.fn() } as never,
    );
    vi.spyOn(service as any, 'resolveSelectedFbsOrders').mockResolvedValue({
      response: {},
      orders: [fbsOrder({ category: 'active' })],
    });
    vi.spyOn(service, 'listFbsOrders').mockResolvedValue({ orders: [] } as never);

    // TEST: a stale browser row cannot be exported after its marketplace status changes.
    await expect(
      service.exportFbsCancelledOrders(
        {
          clientId: 'client-1',
          orders: [{ connectionId: 'connection-1', id: '5355000001' }],
        },
        { id: 'user-1' } as never,
      ),
    ).rejects.toThrow(BadRequestException);
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
      size: null,
      needsChestnyZnak: true,
      isUnmarked: false,
    },
    storageBoxes: [],
    relabeling: null,
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
