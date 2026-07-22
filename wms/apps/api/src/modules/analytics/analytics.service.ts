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
const PAGE_LIMIT = 1000;

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
      const [stockResult, funnelResult, regionsResult] = await Promise.allSettled([
        this.fetchStockProducts(apiKey, periods.selected),
        this.fetchFunnelProducts(apiKey, periods),
        this.fetchRegions(apiKey, periods.selected),
      ]);

      if (stockResult.status === 'rejected') throw sourceError('остатки и показатели товаров', stockResult.reason);
      if (funnelResult.status === 'rejected') throw sourceError('воронка продаж', funnelResult.reason);

      const syncedAt = new Date();
      const products = mergeProducts(dto.clientId, stockResult.value, funnelResult.value, syncedAt);
      const regions = regionsResult.status === 'fulfilled' ? mapRegions(dto.clientId, regionsResult.value, syncedAt) : [];
      const currency = funnelResult.value.currency || stockResult.value.currency || 'RUB';
      const totals = productTotals(products);
      const sourceStatus = {
        products: 'READY',
        funnel: 'READY',
        regions: regionsResult.status === 'fulfilled' ? 'READY' : 'UNAVAILABLE',
      };
      const regionWarning = regionsResult.status === 'rejected' ? safeErrorMessage(regionsResult.reason) : null;
      const snapshotDate = new Date(`${periods.today}T00:00:00.000Z`);

      await this.analytics.$transaction(
        [
          this.analytics.analyticsProduct.deleteMany({ where: { clientId: dto.clientId } }),
          this.analytics.analyticsProduct.createMany({ data: products }),
          this.analytics.analyticsRegion.deleteMany({ where: { clientId: dto.clientId } }),
          this.analytics.analyticsRegion.createMany({ data: regions }),
          this.analytics.analyticsDailySummary.upsert({
            where: { clientId_snapshotDate: { clientId: dto.clientId, snapshotDate } },
            create: { clientId: dto.clientId, snapshotDate, periodDays: dto.periodDays, ...totals },
            update: { periodDays: dto.periodDays, ...totals },
          }),
          this.analytics.analyticsSyncState.update({
            where: { clientId: dto.clientId },
            data: {
              status: regionWarning ? 'READY_WITH_WARNINGS' : 'READY',
              periodDays: dto.periodDays,
              currency,
              productCount: products.length,
              lastSyncedAt: syncedAt,
              lastError: regionWarning,
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
    const [client, connection, state, storedProducts, regions, history] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: query.clientId }, select: { id: true, code: true, name: true } }),
      this.analytics.analyticsConnection.findUnique({ where: { clientId: query.clientId } }),
      this.analytics.analyticsSyncState.findUnique({ where: { clientId: query.clientId } }),
      this.analytics.analyticsProduct.findMany({ where: { clientId: query.clientId }, orderBy: [{ orderSum: 'desc' }, { stockCount: 'asc' }] }),
      this.analytics.analyticsRegion.findMany({ where: { clientId: query.clientId }, orderBy: [{ stockCount: 'desc' }, { officeName: 'asc' }] }),
      this.analytics.analyticsDailySummary.findMany({ where: { clientId: query.clientId }, orderBy: { snapshotDate: 'asc' }, take: 90 }),
    ]);
    if (!client) throw new NotFoundException('Клиент не найден.');

    const wmsStockMap = await this.wmsStock(query.clientId, storedProducts.map((product) => product.nmId));
    const products = storedProducts.map((product) => ({
      ...product,
      wmsStock: wmsStockMap.get(product.nmId)?.quantity ?? 0,
      wmsSkuCount: wmsStockMap.get(product.nmId)?.skuCount ?? 0,
    }));
    const totals = dashboardTotals(products);
    const recommendations = buildRecommendations(products);
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

  private async wmsStock(clientId: string, nmIds: string[]) {
    if (nmIds.length === 0) return new Map<string, { quantity: number; skuCount: number }>();
    const skus = await this.prisma.sku.findMany({
      where: { clientId, marketplace: MarketplaceType.WILDBERRIES, marketplaceProductId: { in: nmIds } },
      select: {
        marketplaceProductId: true,
        balances: { where: { status: StockStatus.AVAILABLE }, select: { quantity: true } },
      },
    });
    const result = new Map<string, { quantity: number; skuCount: number }>();
    for (const sku of skus) {
      if (!sku.marketplaceProductId) continue;
      const current = result.get(sku.marketplaceProductId) ?? { quantity: 0, skuCount: 0 };
      current.quantity += sku.balances.reduce((sum, balance) => sum + balance.quantity, 0);
      current.skuCount += 1;
      result.set(sku.marketplaceProductId, current);
    }
    return result;
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

function productTotals(products: AnalyticsPrisma.AnalyticsProductCreateManyInput[]) {
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

function dashboardTotals(products: DashboardProduct[]) {
  const orderCount = sum(products, (product) => product.orderCount);
  const buyoutCount = sum(products, (product) => product.funnelBuyoutCount);
  return {
    products: products.length,
    activeProducts: products.filter((product) => product.orderCount > 0).length,
    wbStock: sum(products, (product) => product.stockCount),
    wmsStock: sum(products, (product) => product.wmsStock),
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
