import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';

describe('AnalyticsService access', () => {
  it('не обращается к БД, если аналитика отключена в профиле логина', async () => {
    const service = new AnalyticsService({} as never, {} as never, {} as never, {} as never);

    await expect(
      service.listClients({
        id: 'user-1',
        email: 'client@example.com',
        name: 'Клиент',
        analyticsEnabled: false,
        roleCodes: ['CLIENT'],
        permissionCodes: [],
        clientScopeMode: 'LIMITED',
        clientIds: ['client-1'],
        writableClientIds: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('показывает полный остаток WMS отдельно от сопоставленной с отчётом WB части', async () => {
    const prisma = {
      client: { findUnique: async () => ({ id: 'client-1', code: 'CL-1', name: 'Клиент' }) },
      stockBalance: { aggregate: async () => ({ _sum: { quantity: 27_337 } }) },
      sku: {
        findMany: async () => [
          { marketplaceProductId: '100:1', balances: [{ quantity: 10_000 }] },
          { marketplaceProductId: '100:2', balances: [{ quantity: 6_363 }] },
          { marketplaceProductId: '999:1', balances: [{ quantity: 10_973 }] },
        ],
      },
    };
    const analytics = {
      analyticsConnection: { findUnique: async () => null },
      analyticsSyncState: { findUnique: async () => null },
      analyticsProduct: {
        findMany: async () => [
          {
            nmId: '100',
            name: 'Товар',
            vendorCode: null,
            brandName: null,
            subjectName: null,
            photoUrl: null,
            availability: null,
            stockCount: 1,
            stockSum: 0,
            avgOrders: 0,
            orderCount: 0,
            orderSum: 0,
            funnelBuyoutCount: 0,
            funnelBuyoutSum: 0,
            lostOrdersCount: 0,
            lostOrdersSum: 0,
            cartToOrderPercent: 0,
            openCount: 0,
            orderCountDynamic: 0,
          },
        ],
      },
      analyticsRegion: {
        findMany: async () => [
          {
            regionName: 'Центральный',
            officeName: null,
            stockCount: 20,
            stockSum: 20_000,
            saleRateDays: 20,
            toClientCount: 2,
            fromClientCount: 1,
          },
          {
            regionName: 'Центральный',
            officeName: 'Коледино',
            stockCount: 15,
            stockSum: 15_000,
            saleRateDays: 15,
            toClientCount: 0,
            fromClientCount: 0,
          },
          {
            regionName: 'Нет данных',
            officeName: null,
            stockCount: 1,
            stockSum: 1_000,
            saleRateDays: -0.04,
            toClientCount: 0,
            fromClientCount: 0,
          },
        ],
      },
      analyticsRegionalSale: {
        findMany: async () => [
          {
            regionName: 'Центральный',
            nmId: '100',
            currentQty: 30,
            currentAmount: 30_000,
            pastQty: 15,
            pastAmount: 15_000,
          },
        ],
      },
      analyticsDailySummary: { findMany: async () => [] },
    };
    const clientScopes = { requireClientAccess: () => undefined };
    const service = new AnalyticsService(prisma as never, analytics as never, clientScopes as never, {} as never);

    const result = await service.dashboard(
      { clientId: 'client-1', periodDays: 30, limit: 100, offset: 0 },
      {
        id: 'admin-1',
        email: 'admin',
        name: 'Администратор',
        analyticsEnabled: true,
        roleCodes: ['ADMIN'],
        permissionCodes: ['system:admin'],
        clientScopeMode: 'ALL',
        clientIds: [],
        writableClientIds: [],
      },
    );

    expect(result.totals.wmsStock).toBe(27_337);
    expect(result.totals.wmsMatchedStock).toBe(16_363);
    expect(result.totals.wmsUnlinkedStock).toBe(10_974);
    expect(result.products.items[0].wmsStock).toBe(16_363);
    expect(result.regionalAnalytics.regions[0]).toMatchObject({
      regionName: 'Центральный',
      salesDynamicPercent: 100,
      recommendedSupply: 10,
      topWarehouse: 'Коледино',
      status: 'SHORTAGE',
    });
    expect(result.regionalAnalytics.productActions[0]).toMatchObject({
      nmId: '100',
      regionName: 'Центральный',
      recommendedQty: 29,
      confidence: 'ESTIMATE',
    });
    expect(result.regionalAnalytics.regions.find((region) => region.regionName === 'Нет данных')).toMatchObject({
      coverageDays: null,
      wbSaleRateDays: null,
    });
  });
});
