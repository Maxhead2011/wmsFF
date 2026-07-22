import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MarketplaceType, StockStatus } from '@prisma/client';
import { Prisma as AnalyticsPrisma } from '@logoff/analytics-client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { AnalyticsCryptoService } from './analytics-crypto.service';
import { AnalyticsPrismaService } from './analytics-prisma.service';
import { AnalyticsDashboardQueryDto, AnalyticsSyncDto } from './dto/analytics-query.dto';
import { UpsertAnalyticsConnectionDto } from './dto/upsert-analytics-connection.dto';

const WB_ANALYTICS_URL = 'https://seller-analytics-api.wildberries.ru';
const WB_COMMON_URL = 'https://common-api.wildberries.ru';
const WB_STATISTICS_URL = 'https://statistics-api.wildberries.ru';
const PAGE_LIMIT = 1000;
const WMS_STOCK_STATUSES: StockStatus[] = [StockStatus.AVAILABLE, StockStatus.PACKING, StockStatus.SHIPPING];

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsPrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly crypto: AnalyticsCryptoService,
  ) {}

  async listClients(user: AuthUser) {
    this.assertAnalyticsAccess(user);
    const clientFilter = this.clientScopes.resolveClientFilter(user);
    const clients = await this.prisma.client.findMany({
      where: { id: clientFilter },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true },
    });
    const [connections, states] = await Promise.all([
      this.analytics.analyticsConnection.findMany({ where: { clientId: { in: clients.map((client) => client.id) } } }),
      this.analytics.analyticsSyncState.findMany({ where: { clientId: { in: clients.map((client) => client.id) } } }),
    ]);
    const connectionMap = new Map(connections.map((connection) => [connection.clientId, connection]));
    const stateMap = new Map(states.map((state) => [state.clientId, state]));

    return clients.map((client) => {
      const connection = connectionMap.get(client.id);
      const state = stateMap.get(client.id);
      return {
        ...client,
        connection: connection
          ? {
              connected: connection.isActive,
              marketplace: connection.marketplace,
              accountName: connection.accountName,
              lastVerifiedAt: connection.lastVerifiedAt,
            }
          : { connected: false, marketplace: 'WILDBERRIES', accountName: null, lastVerifiedAt: null },
        sync: state
          ? {
              status: state.status,
              periodDays: state.periodDays,
              productCount: state.productCount,
              lastSyncedAt: state.lastSyncedAt,
              lastError: state.lastError,
            }
          : null,
      };
    });
  }

  async upsertConnection(clientId: string, dto: UpsertAnalyticsConnectionDto, user: AuthUser) {
    if (!user.permissionCodes.includes('system:admin')) {
      throw new ForbiddenException('Подключать API аналитики может только администратор.');
    }
    const client = await this.prisma.client.findUnique({ where: { id: clientId }, select: { id: true, code: true, name: true } });
    if (!client) throw new NotFoundException('Клиент не найден.');

    const apiKey = dto.apiKey.trim();
    const seller = await wbJson(`${WB_COMMON_URL}/api/v1/seller-info`, apiKey);
    const accountName = textValue(seller.name) || textValue(seller.tradeMark) || 'Wildberries';
    const sellerSid = textValue(seller.sid) || null;
    const now = new Date();
    const connection = await this.analytics.analyticsConnection.upsert({
      where: { clientId },
      create: {
        clientId,
        marketplace: 'WILDBERRIES',
        accountName,
        sellerSid,
        apiKeyEncrypted: this.crypto.encrypt(apiKey),
        isActive: true,
        lastVerifiedAt: now,
      },
      update: {
        accountName,
        sellerSid,
        apiKeyEncrypted: this.crypto.encrypt(apiKey),
        isActive: true,
        lastVerifiedAt: now,
      },
    });

    return {
      client,
      connected: true,
      marketplace: connection.marketplace,
      accountName: connection.accountName,
      lastVerifiedAt: connection.lastVerifiedAt,
    };
  }

  async sync(dto: AnalyticsSyncDto, user: AuthUser) {
    this.assertAnalyticsAccess(user);
    this.clientScopes.requireClientAccess(user, dto.clientId, 'read');
    const [client, connection, currentState] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: dto.clientId }, select: { id: true, name: true } }),
      this.analytics.analyticsConnection.findUnique({ where: { clientId: dto.clientId } }),
      this.analytics.analyticsSyncState.findUnique({ where: { clientId: dto.clientId } }),
    ]);
    if (!client) throw new NotFoundException('Клиент не найден.');
    if (!connection?.isActive) {
      throw new BadRequestException('Для клиента не подключён API-ключ аналитики Wildberries.');
    }

    const now = new Date();
    if (currentState?.status === 'RUNNING' && currentState.lastStartedAt && now.getTime() - currentState.lastStartedAt.getTime() < 10 * 60_000) {
      throw new ConflictException('Синхронизация аналитики уже выполняется.');
    }
    if (currentState?.lastStartedAt && now.getTime() - currentState.lastStartedAt.getTime() < 60_000) {
      throw new HttpException('Wildberries разрешает обновлять аналитику не чаще одного раза в минуту.', HttpStatus.TOO_MANY_REQUESTS);
    }

    await this.analytics.analyticsSyncState.upsert({
      where: { clientId: dto.clientId },
      create: { clientId: dto.clientId, status: 'RUNNING', periodDays: dto.periodDays, lastStartedAt: now },
      update: { status: 'RUNNING', periodDays: dto.periodDays, lastStartedAt: now, lastError: null },
    });

    try {
      const apiKey = this.crypto.decrypt(connection.apiKeyEncrypted);
      const periods = analyticsPeriods(dto.periodDays);
      const [stockResult, funnelResult, regionsResult, regionalSalesResult] = await Promise.allSettled([
        this.fetchStockProducts(apiKey, periods.selected),
        this.fetchFunnelProducts(apiKey, periods),
        this.fetchRegions(apiKey, periods.selected),
        this.fetchRegionalSales(apiKey, analyticsPeriods(Math.min(dto.periodDays, 30))),
      ]);

      const syncedAt = new Date();
      const cachedCoreAllowed =
        (stockResult.status === 'rejected' && isGlobalLimiterError(stockResult.reason)) ||
        (funnelResult.status === 'rejected' && isGlobalLimiterError(funnelResult.reason));
      const cachedProducts = cachedCoreAllowed
        ? await this.analytics.analyticsProduct.findMany({ where: { clientId: dto.clientId } })
        : [];
      if (stockResult.status === 'rejected' && (!isGlobalLimiterError(stockResult.reason) || cachedProducts.length === 0)) {
        throw sourceError('остатки и показатели товаров', stockResult.reason);
      }
      if (funnelResult.status === 'rejected' && (!isGlobalLimiterError(funnelResult.reason) || cachedProducts.length === 0)) {
        throw sourceError('воронка продаж', funnelResult.reason);
      }

      const usingCachedProducts = stockResult.status === 'rejected' || funnelResult.status === 'rejected';
      const products = usingCachedProducts
        ? cachedProducts
        : mergeProducts(dto.clientId, stockResult.value, funnelResult.value, syncedAt);
      const regions = regionsResult.status === 'fulfilled' ? mapRegions(dto.clientId, regionsResult.value, syncedAt) : [];
      const regionalSales =
        regionalSalesResult.status === 'fulfilled'
          ? mapRegionalSales(dto.clientId, regionalSalesResult.value.current, regionalSalesResult.value.past, syncedAt)
          : [];
      const currency =
        (funnelResult.status === 'fulfilled' ? funnelResult.value.currency : null) ||
        (stockResult.status === 'fulfilled' ? stockResult.value.currency : null) ||
        currentState?.currency ||
        'RUB';
      const totals = productTotals(products);
      const sourceStatus = {
        products: stockResult.status === 'fulfilled' ? 'READY' : 'CACHED_RATE_LIMITED',
        funnel: funnelResult.status === 'fulfilled' ? 'READY' : 'CACHED_RATE_LIMITED',
        regions: regionsResult.status === 'fulfilled' ? 'READY' : 'CACHED_RATE_LIMITED',
        regionalSales:
          regionalSalesResult.status === 'fulfilled' ? `READY_${regionalSalesResult.value.source}` : 'CACHED_RATE_LIMITED',
        exactWarehouseProductStock: 'REQUIRES_PERSONAL_OR_SERVICE_TOKEN',
      };
      const warnings = [
        usingCachedProducts ? 'Товары: WB исчерпал лимит запросов, сохранены последние успешно загруженные данные.' : null,
        regionsResult.status === 'rejected' ? `Склады: ${safeErrorMessage(regionsResult.reason)}` : null,
        regionalSalesResult.status === 'rejected' ? `Продажи по регионам: ${safeErrorMessage(regionalSalesResult.reason)}` : null,
      ].filter((value): value is string => Boolean(value));
      const regionalWarning = warnings.join(' · ') || null;
      const snapshotDate = new Date(`${periods.today}T00:00:00.000Z`);
      const productWrites = usingCachedProducts
        ? []
        : [
            this.analytics.analyticsProduct.deleteMany({ where: { clientId: dto.clientId } }),
            this.analytics.analyticsProduct.createMany({ data: products as AnalyticsPrisma.AnalyticsProductCreateManyInput[] }),
          ];
      const regionWrites =
        regionsResult.status === 'fulfilled'
          ? [
              this.analytics.analyticsRegion.deleteMany({ where: { clientId: dto.clientId } }),
              this.analytics.analyticsRegion.createMany({ data: regions }),
            ]
          : [];
      const regionalSalesWrites =
        regionalSalesResult.status === 'fulfilled'
          ? [
              this.analytics.analyticsRegionalSale.deleteMany({ where: { clientId: dto.clientId } }),
              this.analytics.analyticsRegionalSale.createMany({ data: regionalSales }),
            ]
          : [];

      await this.analytics.$transaction(
        [
          ...productWrites,
          ...regionWrites,
          ...regionalSalesWrites,
          this.analytics.analyticsDailySummary.upsert({
            where: { clientId_snapshotDate: { clientId: dto.clientId, snapshotDate } },
            create: { clientId: dto.clientId, snapshotDate, periodDays: dto.periodDays, ...totals },
            update: { periodDays: dto.periodDays, ...totals },
          }),
          this.analytics.analyticsSyncState.update({
            where: { clientId: dto.clientId },
            data: {
              status: regionalWarning ? 'READY_WITH_WARNINGS' : 'READY',
              periodDays: dto.periodDays,
              currency,
              productCount: products.length,
              lastSyncedAt: syncedAt,
              lastError: regionalWarning,
              sourceStatus: sourceStatus as AnalyticsPrisma.InputJsonValue,
            },
          }),
        ],
      );

      return this.dashboard({ clientId: dto.clientId, limit: 100, offset: 0 }, user);
    } catch (caught) {
      const message = safeErrorMessage(caught);
      await this.analytics.analyticsSyncState.update({
        where: { clientId: dto.clientId },
        data: { status: 'ERROR', lastError: message.slice(0, 1000) },
      });
      if (caught instanceof BadGatewayException || caught instanceof BadRequestException) throw caught;
      throw new BadGatewayException(`Не удалось обновить аналитику Wildberries: ${message}`);
    }
  }

  async dashboard(query: AnalyticsDashboardQueryDto, user: AuthUser) {
    this.assertAnalyticsAccess(user);
    this.clientScopes.requireClientAccess(user, query.clientId, 'read');
    const [client, connection, state, storedProducts, regions, regionalSales, history] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: query.clientId }, select: { id: true, code: true, name: true } }),
      this.analytics.analyticsConnection.findUnique({ where: { clientId: query.clientId } }),
      this.analytics.analyticsSyncState.findUnique({ where: { clientId: query.clientId } }),
      this.analytics.analyticsProduct.findMany({ where: { clientId: query.clientId }, orderBy: [{ orderSum: 'desc' }, { stockCount: 'asc' }] }),
      this.analytics.analyticsRegion.findMany({ where: { clientId: query.clientId }, orderBy: [{ stockCount: 'desc' }, { officeName: 'asc' }] }),
      this.analytics.analyticsRegionalSale.findMany({ where: { clientId: query.clientId }, orderBy: { currentQty: 'desc' } }),
      this.analytics.analyticsDailySummary.findMany({ where: { clientId: query.clientId }, orderBy: { snapshotDate: 'asc' }, take: 90 }),
    ]);
    if (!client) throw new NotFoundException('Клиент не найден.');

    const wmsStock = await this.wmsStock(query.clientId, storedProducts.map((product) => product.nmId));
    const products = storedProducts.map((product) => ({
      ...product,
      wmsStock: wmsStock.byNmId.get(product.nmId)?.quantity ?? 0,
      wmsSkuCount: wmsStock.byNmId.get(product.nmId)?.skuCount ?? 0,
    }));
    const totals = dashboardTotals(products, wmsStock);
    const recommendations = buildRecommendations(products);
    const regionalAnalytics = buildRegionalAnalytics(products, regions, regionalSales, Math.min(state?.periodDays ?? 30, 30));
    const filtered = products.filter((product) => matchesProduct(product, query.search, query.availability));
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;

    return {
      generatedAt: new Date().toISOString(),
      client,
      access: {
        analyticsEnabled: true,
        canManageConnection: user.permissionCodes.includes('system:admin'),
        canSync: Boolean(connection?.isActive),
      },
      connection: connection
        ? {
            connected: connection.isActive,
            marketplace: connection.marketplace,
            accountName: connection.accountName,
            lastVerifiedAt: connection.lastVerifiedAt,
          }
        : { connected: false, marketplace: 'WILDBERRIES', accountName: null, lastVerifiedAt: null },
      sync: state
        ? {
            status: state.status,
            periodDays: state.periodDays,
            currency: state.currency,
            productCount: state.productCount,
            lastStartedAt: state.lastStartedAt,
            lastSyncedAt: state.lastSyncedAt,
            lastError: state.lastError,
            sourceStatus: state.sourceStatus,
          }
        : null,
      totals,
      recommendations,
      regionalAnalytics,
      products: {
        total: filtered.length,
        limit,
        offset,
        items: filtered.slice(offset, offset + limit),
      },
      regions: regions.map((region) => ({
        regionName: region.regionName,
        officeId: region.officeId,
        officeName: region.officeName,
        stockCount: region.stockCount,
        stockSum: region.stockSum,
        toClientCount: region.toClientCount,
        fromClientCount: region.fromClientCount,
        saleRateDays: region.saleRateDays,
      })),
      history: history.map((item) => ({
        date: item.snapshotDate,
        periodDays: item.periodDays,
        productCount: item.productCount,
        stockCount: item.stockCount,
        stockSum: item.stockSum,
        ordersCount: item.ordersCount,
        ordersSum: item.ordersSum,
        buyoutCount: item.buyoutCount,
        buyoutSum: item.buyoutSum,
        lostOrdersSum: item.lostOrdersSum,
      })),
    };
  }

  private async fetchStockProducts(apiKey: string, period: DatePeriod) {
    const items: JsonRecord[] = [];
    let currency = 'RUB';
    for (let offset = 0; offset < 50_000; offset += PAGE_LIMIT) {
      const response = await wbJson(`${WB_ANALYTICS_URL}/api/v2/stocks-report/products/products`, apiKey, {
        nmIDs: [],
        currentPeriod: period,
        stockType: '',
        skipDeletedNm: true,
        orderBy: { field: 'avgOrders', mode: 'desc' },
        availabilityFilters: [],
        limit: PAGE_LIMIT,
        offset,
      });
      const data = asRecord(response.data);
      const page = asArray(data.items).map(asRecord);
      items.push(...page);
      currency = textValue(data.currency) || currency;
      if (page.length < PAGE_LIMIT) break;
      await delay(20_500);
    }
    return { items, currency };
  }

  private async fetchFunnelProducts(apiKey: string, periods: AnalyticsPeriods) {
    const products: JsonRecord[] = [];
    let currency = 'RUB';
    for (let offset = 0; offset < 50_000; offset += PAGE_LIMIT) {
      const response = await wbJson(`${WB_ANALYTICS_URL}/api/analytics/v3/sales-funnel/products`, apiKey, {
        selectedPeriod: periods.selected,
        pastPeriod: periods.past,
        nmIds: [],
        brandNames: [],
        subjectIds: [],
        tagIds: [],
        skipDeletedNm: true,
        orderBy: { field: 'orderCount', mode: 'desc' },
        limit: PAGE_LIMIT,
        offset,
      });
      const data = asRecord(response.data);
      const page = asArray(data.products).map(asRecord);
      products.push(...page);
      currency = textValue(data.currency) || currency;
      if (page.length < PAGE_LIMIT) break;
      await delay(20_500);
    }
    return { products, currency };
  }

  private async fetchRegions(apiKey: string, period: DatePeriod) {
    const response = await wbJson(`${WB_ANALYTICS_URL}/api/v2/stocks-report/offices`, apiKey, {
      nmIDs: [],
      subjectIDs: [],
      brandNames: [],
      tagIDs: [],
      currentPeriod: period,
      stockType: '',
      skipDeletedNm: true,
    });
    return asArray(asRecord(response.data).regions).map(asRecord);
  }

  private async fetchRegionalSales(apiKey: string, periods: AnalyticsPeriods) {
    try {
      return await this.fetchRegionalSalesFromStatistics(apiKey, periods);
    } catch {
      return this.fetchRegionalSalesFromAnalytics(apiKey, periods);
    }
  }

  private async fetchRegionalSalesFromStatistics(apiKey: string, periods: AnalyticsPeriods) {
    const dateFrom = `${periods.past.start}T00:00:00`;
    const rows = await wbArray(
      `${WB_STATISTICS_URL}/api/v1/supplier/sales?${new URLSearchParams({ dateFrom, flag: '0' })}`,
      apiKey,
    );
    const current: JsonRecord[] = [];
    const past: JsonRecord[] = [];
    for (const row of rows.map(asRecord)) {
      if (textValue(row.saleID).toLocaleUpperCase('en-US').startsWith('R')) continue;
      const date = textValue(row.date).slice(0, 10);
      const target = dateInPeriod(date, periods.selected) ? current : dateInPeriod(date, periods.past) ? past : null;
      if (!target) continue;
      target.push({
        cityName: '',
        countryName: row.countryName,
        foName: row.oblastOkrugName,
        regionName: row.regionName,
        nmID: row.nmId,
        saleInvoiceCostPrice: numberValue(row.finishedPrice) || numberValue(row.priceWithDisc),
        saleItemInvoiceQty: 1,
      });
    }
    return { current, past, source: 'STATISTICS_SALES' as const };
  }

  private async fetchRegionalSalesFromAnalytics(apiKey: string, periods: AnalyticsPeriods) {
    // WB applies a seller-wide limiter across analytics methods. Let the core
    // product requests finish, then keep the two region periods apart.
    await delay(20_500);
    const current = await wbJsonWithLimiterRetry(
      `${WB_ANALYTICS_URL}/api/v1/analytics/region-sale?${periodQuery(periods.selected)}`,
      apiKey,
    );
    await delay(20_500);
    const past = await wbJsonWithLimiterRetry(
      `${WB_ANALYTICS_URL}/api/v1/analytics/region-sale?${periodQuery(periods.past)}`,
      apiKey,
    );
    return {
      current: asArray(current.report).map(asRecord),
      past: asArray(past.report).map(asRecord),
      source: 'REGION_SALE' as const,
    };
  }

  private async wmsStock(clientId: string, nmIds: string[]) {
    const requestedNmIds = new Set(nmIds);
    const [total, skus] = await Promise.all([
      this.prisma.stockBalance.aggregate({
        where: { clientId, quantity: { gt: 0 }, status: { in: WMS_STOCK_STATUSES } },
        _sum: { quantity: true },
      }),
      this.prisma.sku.findMany({
        where: {
          clientId,
          marketplace: MarketplaceType.WILDBERRIES,
          marketplaceProductId: { not: null },
          balances: { some: { status: { in: WMS_STOCK_STATUSES }, quantity: { gt: 0 } } },
        },
        select: {
          marketplaceProductId: true,
          balances: {
            where: { status: { in: WMS_STOCK_STATUSES }, quantity: { gt: 0 } },
            select: { quantity: true },
          },
        },
      }),
    ]);
    const byNmId = new Map<string, { quantity: number; skuCount: number }>();
    let matchedQuantity = 0;
    for (const sku of skus) {
      if (!sku.marketplaceProductId) continue;
      // WB stores the product and size as "nmId:sizeId" in the WMS card; analytics is aggregated by nmId.
      const nmId = sku.marketplaceProductId.split(':', 1)[0];
      if (!requestedNmIds.has(nmId)) continue;
      const current = byNmId.get(nmId) ?? { quantity: 0, skuCount: 0 };
      const quantity = sku.balances.reduce((sum, balance) => sum + balance.quantity, 0);
      current.quantity += quantity;
      current.skuCount += 1;
      matchedQuantity += quantity;
      byNmId.set(nmId, current);
    }
    const totalQuantity = total._sum.quantity ?? 0;
    return {
      byNmId,
      totalQuantity,
      matchedQuantity,
      unlinkedQuantity: Math.max(0, totalQuantity - matchedQuantity),
    };
  }

  private assertAnalyticsAccess(user: AuthUser) {
    if (!user.analyticsEnabled) {
      throw new ForbiddenException('Раздел «Аналитика» отключён в профиле этого логина.');
    }
  }
}

type JsonRecord = Record<string, unknown>;
type DatePeriod = { start: string; end: string };
type AnalyticsPeriods = { today: string; selected: DatePeriod; past: DatePeriod };

function analyticsPeriods(days: number): AnalyticsPeriods {
  const today = moscowDate(new Date());
  const selectedEnd = shiftDate(today, -1);
  const selectedStart = shiftDate(selectedEnd, -(days - 1));
  const pastEnd = shiftDate(selectedStart, -1);
  const pastStart = shiftDate(pastEnd, -(days - 1));
  return { today, selected: { start: selectedStart, end: selectedEnd }, past: { start: pastStart, end: pastEnd } };
}

function moscowDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mergeProducts(
  clientId: string,
  stockReport: { items: JsonRecord[] },
  funnelReport: { products: JsonRecord[] },
  syncedAt: Date,
): AnalyticsPrisma.AnalyticsProductCreateManyInput[] {
  const stocks = new Map(stockReport.items.map((item) => [textValue(item.nmID), item]));
  const funnels = new Map(
    funnelReport.products.map((item) => {
      const product = asRecord(item.product);
      return [textValue(product.nmId), item] as const;
    }),
  );
  const nmIds = [...new Set([...stocks.keys(), ...funnels.keys()].filter(Boolean))];

  return nmIds.map((nmId) => {
    const stock = stocks.get(nmId) ?? {};
    const funnel = funnels.get(nmId) ?? {};
    const product = asRecord(funnel.product);
    const stockMetrics = asRecord(stock.metrics);
    const statistic = asRecord(funnel.statistic);
    const selected = asRecord(statistic.selected);
    const past = asRecord(statistic.past);
    const comparison = asRecord(statistic.comparison);
    const conversions = asRecord(selected.conversions);
    const price = asRecord(stockMetrics.currentPrice);

    return {
      clientId,
      nmId,
      name: textValue(stock.name) || textValue(product.title) || `Товар WB ${nmId}`,
      vendorCode: nullableText(stock.vendorCode) ?? nullableText(product.vendorCode),
      brandName: nullableText(stock.brandName) ?? nullableText(product.brandName),
      subjectName: nullableText(stock.subjectName) ?? nullableText(product.subjectName),
      photoUrl: nullableText(stock.mainPhoto),
      availability: nullableText(stockMetrics.availability),
      stockCount: numberValue(stockMetrics.stockCount),
      stockSum: numberValue(stockMetrics.stockSum),
      avgOrders: numberValue(stockMetrics.avgOrders),
      ordersCount: numberValue(stockMetrics.ordersCount),
      ordersSum: numberValue(stockMetrics.ordersSum),
      buyoutCount: numberValue(stockMetrics.buyoutCount),
      buyoutSum: numberValue(stockMetrics.buyoutSum),
      buyoutPercent: numberValue(stockMetrics.buyoutPercent),
      lostOrdersCount: numberValue(stockMetrics.lostOrdersCount),
      lostOrdersSum: numberValue(stockMetrics.lostOrdersSum),
      lostBuyoutsCount: numberValue(stockMetrics.lostBuyoutsCount),
      lostBuyoutsSum: numberValue(stockMetrics.lostBuyoutsSum),
      turnoverDays: durationDays(stockMetrics.avgStockTurnover),
      saleRateDays: durationDays(stockMetrics.saleRate),
      currentPriceMin: nullableNumber(price.minPrice),
      currentPriceMax: nullableNumber(price.maxPrice),
      openCount: numberValue(selected.openCount),
      cartCount: numberValue(selected.cartCount),
      orderCount: numberValue(selected.orderCount),
      orderSum: numberValue(selected.orderSum),
      funnelBuyoutCount: numberValue(selected.buyoutCount),
      funnelBuyoutSum: numberValue(selected.buyoutSum),
      cancelCount: numberValue(selected.cancelCount),
      cancelSum: numberValue(selected.cancelSum),
      addToCartPercent: numberValue(conversions.addToCartPercent),
      cartToOrderPercent: numberValue(conversions.cartToOrderPercent),
      funnelBuyoutPercent: numberValue(conversions.buyoutPercent),
      orderCountDynamic: numberValue(comparison.orderCountDynamic),
      orderSumDynamic: numberValue(comparison.orderSumDynamic),
      openCountDynamic: numberValue(comparison.openCountDynamic),
      cartCountDynamic: numberValue(comparison.cartCountDynamic),
      selectedMetrics: selected as AnalyticsPrisma.InputJsonValue,
      pastMetrics: past as AnalyticsPrisma.InputJsonValue,
      comparisonMetrics: comparison as AnalyticsPrisma.InputJsonValue,
      stockMetrics: stockMetrics as AnalyticsPrisma.InputJsonValue,
      syncedAt,
    };
  });
}

function mapRegions(clientId: string, values: JsonRecord[], syncedAt: Date): AnalyticsPrisma.AnalyticsRegionCreateManyInput[] {
  const rows: AnalyticsPrisma.AnalyticsRegionCreateManyInput[] = [];
  for (const region of values) {
    const regionName = textValue(region.regionName) || 'Без региона';
    const regionMetrics = asRecord(region.metrics);
    rows.push(regionRow(clientId, `region:${regionName}`, regionName, null, null, regionMetrics, syncedAt));
    for (const officeValue of asArray(region.offices)) {
      const office = asRecord(officeValue);
      const officeId = textValue(office.officeID) || textValue(office.officeId) || textValue(office.officeName);
      rows.push(
        regionRow(
          clientId,
          `office:${officeId}`,
          regionName,
          officeId || null,
          nullableText(office.officeName),
          asRecord(office.metrics),
          syncedAt,
        ),
      );
    }
  }
  return rows;
}

function regionRow(
  clientId: string,
  regionKey: string,
  regionName: string,
  officeId: string | null,
  officeName: string | null,
  metrics: JsonRecord,
  syncedAt: Date,
): AnalyticsPrisma.AnalyticsRegionCreateManyInput {
  return {
    clientId,
    regionKey,
    regionName,
    officeId,
    officeName,
    stockCount: numberValue(metrics.stockCount),
    stockSum: numberValue(metrics.stockSum),
    toClientCount: numberValue(metrics.toClientCount),
    fromClientCount: numberValue(metrics.fromClientCount),
    saleRateDays: durationDays(metrics.saleRate),
    metrics: metrics as AnalyticsPrisma.InputJsonValue,
    syncedAt,
  };
}

function mapRegionalSales(
  clientId: string,
  currentRows: JsonRecord[],
  pastRows: JsonRecord[],
  syncedAt: Date,
): AnalyticsPrisma.AnalyticsRegionalSaleCreateManyInput[] {
  type Bucket = {
    regionKey: string;
    regionName: string;
    nmId: string;
    currentQty: number;
    currentAmount: number;
    pastQty: number;
    pastAmount: number;
    locations: Set<string>;
  };
  const buckets = new Map<string, Bucket>();

  const add = (row: JsonRecord, period: 'current' | 'past') => {
    const nmId = textValue(row.nmID);
    if (!nmId) return;
    const regionName = normalizeDemandRegion(row);
    const regionKey = regionName.toLocaleLowerCase('ru-RU');
    const key = `${regionKey}:${nmId}`;
    const bucket = buckets.get(key) ?? {
      regionKey,
      regionName,
      nmId,
      currentQty: 0,
      currentAmount: 0,
      pastQty: 0,
      pastAmount: 0,
      locations: new Set<string>(),
    };
    const quantity = Math.max(0, numberValue(row.saleItemInvoiceQty));
    const amount = Math.max(0, numberValue(row.saleInvoiceCostPrice) * quantity);
    if (period === 'current') {
      bucket.currentQty += quantity;
      bucket.currentAmount += amount;
      bucket.locations.add([textValue(row.countryName), textValue(row.regionName), textValue(row.cityName)].join('|'));
    } else {
      bucket.pastQty += quantity;
      bucket.pastAmount += amount;
    }
    buckets.set(key, bucket);
  };

  currentRows.forEach((row) => add(row, 'current'));
  pastRows.forEach((row) => add(row, 'past'));

  return [...buckets.values()].map((bucket) => ({
    clientId,
    regionKey: bucket.regionKey,
    regionName: bucket.regionName,
    nmId: bucket.nmId,
    currentQty: roundMetric(bucket.currentQty),
    currentAmount: roundMetric(bucket.currentAmount),
    pastQty: roundMetric(bucket.pastQty),
    pastAmount: roundMetric(bucket.pastAmount),
    locationsCount: bucket.locations.size,
    syncedAt,
  }));
}

function normalizeDemandRegion(row: JsonRecord) {
  const country = textValue(row.countryName);
  const district = textValue(row.foName) || textValue(row.oblastOkrugName);
  if (country && country !== 'Россия') return country;
  if (district.includes('Централь')) return 'Центральный';
  if (district.includes('Южн') || district.includes('Северо-Кавказ')) return 'Южный и Северо-Кавказский';
  if (district.includes('Приволж')) return 'Приволжский';
  if (district.includes('Ураль')) return 'Уральский';
  if (district.includes('Северо-Запад')) return 'Северо-Западный';
  if (district.includes('Сибир') || district.includes('Дальневост')) return 'Дальневосточный и Сибирский';
  return country || district || 'Другие регионы';
}

type DashboardRegion = Awaited<ReturnType<AnalyticsPrismaService['analyticsRegion']['findMany']>>[number];
type DashboardRegionalSale = Awaited<ReturnType<AnalyticsPrismaService['analyticsRegionalSale']['findMany']>>[number];

function buildRegionalAnalytics(
  products: DashboardProduct[],
  regions: DashboardRegion[],
  regionalSales: DashboardRegionalSale[],
  periodDays: number,
) {
  const targetDays = 30;
  const excessDays = 60;
  const detailedDemandAvailable = regionalSales.length > 0;
  const productMap = new Map(products.map((product) => [product.nmId, product]));
  const regionSales = new Map<string, { currentQty: number; currentAmount: number; pastQty: number; pastAmount: number }>();
  for (const sale of regionalSales) {
    const current = regionSales.get(sale.regionName) ?? { currentQty: 0, currentAmount: 0, pastQty: 0, pastAmount: 0 };
    current.currentQty += sale.currentQty;
    current.currentAmount += sale.currentAmount;
    current.pastQty += sale.pastQty;
    current.pastAmount += sale.pastAmount;
    regionSales.set(sale.regionName, current);
  }

  const regionStock = new Map(
    regions
      .filter((region) => !region.officeName && region.regionName !== 'Маркетплейс')
      .map((region) => [region.regionName, region]),
  );
  const topWarehouse = new Map<string, DashboardRegion>();
  for (const office of regions.filter((region) => Boolean(region.officeName))) {
    const current = topWarehouse.get(office.regionName);
    if (!current || office.stockCount > current.stockCount) topWarehouse.set(office.regionName, office);
  }

  const names = [...new Set([...regionStock.keys(), ...regionSales.keys()])];
  const totalSalesQty = detailedDemandAvailable
    ? sum([...regionSales.values()], (region) => region.currentQty)
    : sum([...regionStock.values()], (region) =>
        region.saleRateDays && region.saleRateDays > 0 ? (region.stockCount / region.saleRateDays) * periodDays : 0,
      );
  const totalRegionalStock = sum([...regionStock.values()], (region) => region.stockCount);
  const regionRows = names
    .map((regionName) => {
      const stock = regionStock.get(regionName);
      const directSales = regionSales.get(regionName);
      const fallbackDemand =
        !directSales && stock?.saleRateDays && stock.saleRateDays > 0
          ? (stock.stockCount / stock.saleRateDays) * periodDays
          : 0;
      const sales = directSales ?? { currentQty: fallbackDemand, currentAmount: 0, pastQty: 0, pastAmount: 0 };
      const dailyDemand = periodDays > 0 ? sales.currentQty / periodDays : 0;
      const coverageDays = dailyDemand > 0 ? (stock?.stockCount ?? 0) / dailyDemand : stock?.saleRateDays ?? null;
      const targetStock = Math.ceil(dailyDemand * targetDays);
      const recommendedSupply = Math.max(0, targetStock - Math.round(stock?.stockCount ?? 0));
      const excessStock = Math.max(0, Math.round((stock?.stockCount ?? 0) - dailyDemand * excessDays));
      const status = regionalStatus(coverageDays, sales.currentQty, stock?.stockCount ?? 0);
      const warehouse = topWarehouse.get(regionName);
      return {
        regionName,
        salesQty: roundMetric(sales.currentQty),
        salesAmount: roundMetric(sales.currentAmount),
        pastSalesQty: roundMetric(sales.pastQty),
        salesDynamicPercent: directSales ? percentDynamic(sales.currentQty, sales.pastQty) : 0,
        salesSharePercent: totalSalesQty > 0 ? (sales.currentQty / totalSalesQty) * 100 : 0,
        stockCount: stock?.stockCount ?? 0,
        stockSharePercent: totalRegionalStock > 0 ? ((stock?.stockCount ?? 0) / totalRegionalStock) * 100 : 0,
        coverageDays: coverageDays === null ? null : roundMetric(coverageDays),
        wbSaleRateDays: stock?.saleRateDays ?? null,
        targetStock,
        recommendedSupply,
        excessStock,
        toClientCount: stock?.toClientCount ?? 0,
        fromClientCount: stock?.fromClientCount ?? 0,
        estimatedLostSales: totalSalesQty > 0 ? roundMetric(productLostSales(products) * (sales.currentQty / totalSalesQty)) : 0,
        topWarehouse: warehouse?.officeName ?? null,
        topWarehouseStock: warehouse?.stockCount ?? 0,
        status,
      };
    })
    .sort((left, right) => regionalStatusRank(left.status) - regionalStatusRank(right.status) || right.recommendedSupply - left.recommendedSupply);

  const stockShare = new Map(regionRows.map((region) => [region.regionName, region.stockSharePercent / 100]));
  const productRegionalTotal = new Map<string, number>();
  for (const sale of regionalSales) productRegionalTotal.set(sale.nmId, (productRegionalTotal.get(sale.nmId) ?? 0) + sale.currentQty);
  const candidates = regionalSales
    .map((sale) => {
      const product = productMap.get(sale.nmId);
      const totalProductSales = productRegionalTotal.get(sale.nmId) ?? 0;
      if (!product || totalProductSales <= 0 || sale.currentQty <= 0) return null;
      const demandShare = sale.currentQty / totalProductSales;
      const estimatedRegionStock = Math.max(0, Math.round(product.stockCount * (stockShare.get(sale.regionName) ?? 0)));
      const targetRegionStock = Math.ceil((sale.currentQty / periodDays) * targetDays);
      const gap = Math.max(0, targetRegionStock - estimatedRegionStock);
      if (gap <= 0) return null;
      return {
        nmId: sale.nmId,
        name: product.name,
        vendorCode: product.vendorCode,
        photoUrl: product.photoUrl,
        regionName: sale.regionName,
        salesQty: sale.currentQty,
        pastSalesQty: sale.pastQty,
        salesDynamicPercent: percentDynamic(sale.currentQty, sale.pastQty),
        demandSharePercent: demandShare * 100,
        estimatedRegionStock,
        targetRegionStock,
        gap,
        wmsStock: product.wmsStock,
        recommendedQty: 0,
        uncoveredQty: gap,
        confidence: 'ESTIMATE' as const,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const byProduct = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const list = byProduct.get(candidate.nmId) ?? [];
    list.push(candidate);
    byProduct.set(candidate.nmId, list);
  }
  for (const list of byProduct.values()) {
    let available = list[0]?.wmsStock ?? 0;
    list.sort((left, right) => right.gap - left.gap || right.salesQty - left.salesQty);
    for (const candidate of list) {
      candidate.recommendedQty = Math.min(candidate.gap, Math.max(0, Math.floor(available)));
      candidate.uncoveredQty = candidate.gap - candidate.recommendedQty;
      available -= candidate.recommendedQty;
    }
  }
  const productActions = candidates
    .sort((left, right) => right.recommendedQty - left.recommendedQty || right.uncoveredQty - left.uncoveredQty || right.salesQty - left.salesQty)
    .slice(0, 60)
    .map((candidate) => ({
      ...candidate,
      reason:
        candidate.recommendedQty > 0
          ? `Покрыть расчётный дефицит на ${targetDays} дней из доступного остатка LOGOFF.`
          : 'Есть расчётный региональный дефицит, но сопоставленного свободного остатка LOGOFF недостаточно.',
    }));

  return {
    available: regionRows.length > 0,
    periodDays,
    targetDays,
    demandSource: detailedDemandAvailable ? ('REGIONAL_SALES' as const) : ('WB_SALE_RATE' as const),
    dynamicsAvailable: detailedDemandAvailable,
    productActionsAvailable: detailedDemandAvailable,
    exactProductWarehouseStockAvailable: false,
    limitation:
      (detailedDemandAvailable
        ? ''
        : 'Региональный спрос временно рассчитан по оборачиваемости WB; динамика и товарная детализация появятся после снятия лимита Statistics API. ') +
      'Точный остаток каждого товара по складам требует персональный или сервисный токен WB. С текущим базовым токеном распределение товара по регионам является расчётной оценкой.',
    summary: {
      regions: regionRows.length,
      shortageRegions: regionRows.filter((region) => region.status === 'CRITICAL' || region.status === 'SHORTAGE').length,
      recommendedSupply: sum(regionRows, (region) => region.recommendedSupply),
      excessStock: sum(regionRows, (region) => region.excessStock),
      salesQty: totalSalesQty,
      salesAmount: sum([...regionSales.values()], (region) => region.currentAmount),
    },
    regions: regionRows,
    productActions,
  };
}

function regionalStatus(coverageDays: number | null, salesQty: number, stockCount: number) {
  if (salesQty <= 0) return stockCount > 0 ? 'NO_DEMAND' : 'NO_DATA';
  if (stockCount <= 0 || coverageDays === null || coverageDays < 14) return 'CRITICAL';
  if (coverageDays < 30) return 'SHORTAGE';
  if (coverageDays > 60) return 'OVERSTOCK';
  return 'BALANCED';
}

function regionalStatusRank(value: string) {
  return value === 'CRITICAL' ? 0 : value === 'SHORTAGE' ? 1 : value === 'OVERSTOCK' ? 2 : value === 'BALANCED' ? 3 : 4;
}

function productLostSales(products: DashboardProduct[]) {
  return sum(products, (product) => product.lostOrdersSum);
}

function percentDynamic(current: number, past: number) {
  if (past <= 0) return current > 0 ? 100 : 0;
  return ((current - past) / past) * 100;
}

function periodQuery(period: DatePeriod) {
  return new URLSearchParams({ dateFrom: period.start, dateTo: period.end }).toString();
}

function dateInPeriod(value: string, period: DatePeriod) {
  return value >= period.start && value <= period.end;
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function productTotals(
  products: Array<{
    stockCount?: number;
    stockSum?: number;
    orderCount?: number;
    orderSum?: number;
    funnelBuyoutCount?: number;
    funnelBuyoutSum?: number;
    lostOrdersSum?: number;
  }>,
) {
  return {
    productCount: products.length,
    stockCount: sum(products, (product) => product.stockCount ?? 0),
    stockSum: sum(products, (product) => product.stockSum ?? 0),
    ordersCount: sum(products, (product) => product.orderCount ?? 0),
    ordersSum: sum(products, (product) => product.orderSum ?? 0),
    buyoutCount: sum(products, (product) => product.funnelBuyoutCount ?? 0),
    buyoutSum: sum(products, (product) => product.funnelBuyoutSum ?? 0),
    lostOrdersSum: sum(products, (product) => product.lostOrdersSum ?? 0),
  };
}

type DashboardProduct = Awaited<ReturnType<AnalyticsPrismaService['analyticsProduct']['findMany']>>[number] & {
  wmsStock: number;
  wmsSkuCount: number;
};

type WmsStockSnapshot = Awaited<ReturnType<AnalyticsService['wmsStock']>>;

function dashboardTotals(products: DashboardProduct[], wmsStock: WmsStockSnapshot) {
  const orderCount = sum(products, (product) => product.orderCount);
  const buyoutCount = sum(products, (product) => product.funnelBuyoutCount);
  return {
    products: products.length,
    activeProducts: products.filter((product) => product.orderCount > 0).length,
    wbStock: sum(products, (product) => product.stockCount),
    wmsStock: wmsStock.totalQuantity,
    wmsMatchedStock: wmsStock.matchedQuantity,
    wmsUnlinkedStock: wmsStock.unlinkedQuantity,
    wmsMatchPercent: wmsStock.totalQuantity > 0 ? (wmsStock.matchedQuantity / wmsStock.totalQuantity) * 100 : 100,
    orders: orderCount,
    ordersSum: sum(products, (product) => product.orderSum),
    buyouts: buyoutCount,
    buyoutsSum: sum(products, (product) => product.funnelBuyoutSum),
    buyoutPercent: orderCount > 0 ? (buyoutCount / orderCount) * 100 : 0,
    lostOrdersSum: sum(products, (product) => product.lostOrdersSum),
    outOfStock: products.filter((product) => product.stockCount <= 0 && (product.avgOrders > 0 || product.orderCount > 0)).length,
    lowStock: products.filter((product) => product.availability === 'deficient').length,
    overstock: products.filter((product) => product.availability === 'nonLiquid' || product.availability === 'nonActual').length,
  };
}

function buildRecommendations(products: DashboardProduct[]) {
  return products
    .flatMap((product) => {
      const base = { nmId: product.nmId, name: product.name, vendorCode: product.vendorCode, photoUrl: product.photoUrl };
      if (product.stockCount <= 0 && (product.avgOrders > 0 || product.orderCount > 0)) {
        return [{ ...base, kind: 'OUT_OF_STOCK', severity: 'CRITICAL', value: product.lostOrdersSum, message: 'Товар продаётся, но остаток WB закончился. Нужна срочная поставка.' }];
      }
      if (product.availability === 'deficient') {
        return [{ ...base, kind: 'LOW_STOCK', severity: 'WARNING', value: product.stockCount, message: 'WB определяет остаток как дефицитный. Подготовьте пополнение.' }];
      }
      if (product.availability === 'nonLiquid' || product.availability === 'nonActual') {
        return [{ ...base, kind: 'OVERSTOCK', severity: 'INFO', value: product.stockCount, message: 'Товар продаётся медленно: проверьте цену, карточку и объём следующей поставки.' }];
      }
      if (product.openCount >= 50 && product.cartToOrderPercent < 10) {
        return [{ ...base, kind: 'LOW_CONVERSION', severity: 'WARNING', value: product.cartToOrderPercent, message: 'Есть просмотры, но слабая конверсия корзины в заказ. Проверьте цену и карточку.' }];
      }
      if (product.orderCountDynamic >= 20) {
        return [{ ...base, kind: 'GROWTH', severity: 'POSITIVE', value: product.orderCountDynamic, message: 'Заказы растут. Стоит заранее увеличить запас.' }];
      }
      return [];
    })
    .sort((left, right) => severityRank(left.severity) - severityRank(right.severity) || right.value - left.value)
    .slice(0, 24);
}

function severityRank(value: string) {
  return value === 'CRITICAL' ? 0 : value === 'WARNING' ? 1 : value === 'POSITIVE' ? 2 : 3;
}

function matchesProduct(product: DashboardProduct, search?: string, availability?: string) {
  if (availability && availability !== 'all') {
    if (availability === 'outOfStock') {
      if (product.stockCount > 0) return false;
    } else if (product.availability !== availability) {
      return false;
    }
  }
  const query = search?.trim().toLocaleLowerCase('ru-RU');
  if (!query) return true;
  return [product.name, product.vendorCode, product.brandName, product.subjectName, product.nmId]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(query));
}

async function wbJson(url: string, apiKey: string, body?: JsonRecord) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  let payload: JsonRecord = {};
  try {
    payload = raw ? asRecord(JSON.parse(raw)) : {};
  } catch {
    payload = { message: raw.slice(0, 500) };
  }
  if (!response.ok) {
    const message = textValue(payload.detail) || textValue(payload.message) || textValue(payload.error) || `HTTP ${response.status}`;
    throw new BadGatewayException(`Wildberries: ${message}`);
  }
  return payload;
}

async function wbArray(url: string, apiKey: string) {
  const response = await fetch(url, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await response.text();
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : [];
  } catch {
    payload = { message: raw.slice(0, 500) };
  }
  if (!response.ok) {
    const error = asRecord(payload);
    const message = textValue(error.detail) || textValue(error.message) || textValue(error.error) || `HTTP ${response.status}`;
    throw new BadGatewayException(`Wildberries: ${message}`);
  }
  if (!Array.isArray(payload)) throw new BadGatewayException('Wildberries вернул неожиданный формат статистики продаж.');
  return payload;
}

async function wbJsonWithLimiterRetry(url: string, apiKey: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await wbJson(url, apiKey);
    } catch (caught) {
      const limited = safeErrorMessage(caught).toLocaleLowerCase('en-US').includes('limited by global limiter');
      if (!limited || attempt === 2) throw caught;
      await delay(20_500);
    }
  }
  throw new BadGatewayException('Wildberries: исчерпаны попытки получения региональной аналитики.');
}

function isGlobalLimiterError(value: unknown) {
  return safeErrorMessage(value).toLocaleLowerCase('en-US').includes('limited by global limiter');
}

function sourceError(source: string, reason: unknown) {
  return new BadGatewayException(`Wildberries не вернул источник «${source}»: ${safeErrorMessage(reason)}`);
}

function safeErrorMessage(value: unknown) {
  return value instanceof Error ? value.message : typeof value === 'string' ? value : 'неизвестная ошибка';
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function nullableText(value: unknown) {
  const text = textValue(value);
  return text || null;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function durationDays(value: unknown) {
  const duration = asRecord(value);
  if (Object.keys(duration).length === 0) return null;
  return numberValue(duration.days) + numberValue(duration.hours) / 24 + numberValue(duration.mins) / 1440;
}

function sum<T>(items: T[], getter: (item: T) => number) {
  return items.reduce((total, item) => total + getter(item), 0);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
