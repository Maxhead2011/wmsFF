import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  BillingChargeSource,
  BillingChargeStatus,
  BillingUnit,
  MarketplaceType,
  Prisma,
  VolumeSource,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { UpsertMarketplaceConnectionDto } from './dto/upsert-marketplace-connection.dto';

type MarketplaceConnectionWithClient = Prisma.ClientMarketplaceConnectionGetPayload<{
  include: { client: { select: { id: true; code: true; name: true } } };
}>;

type MarketplaceProductSyncItem = {
  marketplace: MarketplaceType;
  productId: string;
  offerId: string;
  internalSku: string;
  clientSku?: string;
  article?: string;
  barcode?: string;
  barcodes: string[];
  name: string;
  brand?: string;
  category?: string;
  color?: string;
  size?: string;
  weightGrams?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  needsChestnyZnak?: boolean;
  payload: Record<string, unknown>;
};

type WildberriesFbsOrder = Record<string, unknown> & {
  connectionId: string;
  accountName: string | null;
  marketplace: MarketplaceType;
  supplierStatus: string;
  wbStatus: string;
};

type FbsOrderSummary = {
  id: string;
  orderUid: string | null;
  connectionId: string;
  accountName: string | null;
  marketplace: MarketplaceType;
  category: 'active' | 'shipped' | 'archive';
  supplierStatus: string;
  wbStatus: string;
  statusLabel: string;
  article: string | null;
  nmId: string | null;
  chrtId: string | null;
  barcodes: string[];
  product: {
    id: string;
    name: string;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
  } | null;
  storageBoxes: Array<{ code: string; quantity: number; status: string }>;
  createdAt: string | null;
  sellerDate: string | null;
  deliveryDate: string | null;
  supplyId: string | null;
  warehouseId: string | null;
  officeId: string | null;
  cargoType: string | null;
  requiredMeta: string[];
  optionalMeta: string[];
  comment: string | null;
  billing: {
    chargeId: string;
    status: string;
    unitPriceRub: number;
    totalRub: number;
    invoiceNumber: string | null;
    invoiceStatus: string | null;
  } | null;
};

type FbsOrdersResponse = {
  client: { id: string; code: string; name: string };
  connected: boolean;
  connections: Array<{ id: string; marketplace: MarketplaceType; accountName: string | null }>;
  fetchedAt: string;
  counts: { active: number; shipped: number; archive: number; all: number };
  orders: FbsOrderSummary[];
};

@Injectable()
export class MarketplaceConnectionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketplaceConnectionsService.name);
  private readonly fbsOrdersCache = new Map<string, { expiresAt: number; value: FbsOrdersResponse }>();
  private fbsRefreshTimer: ReturnType<typeof setInterval> | undefined;
  private fbsBackgroundRefreshRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  onModuleInit() {
    this.fbsRefreshTimer = setInterval(() => {
      void this.refreshAllFbsClients();
    }, 60_000);
    this.fbsRefreshTimer.unref?.();
    void this.refreshAllFbsClients();
  }

  onModuleDestroy() {
    if (this.fbsRefreshTimer) {
      clearInterval(this.fbsRefreshTimer);
    }
  }

  private async refreshAllFbsClients() {
    if (this.fbsBackgroundRefreshRunning) {
      return;
    }
    this.fbsBackgroundRefreshRunning = true;
    try {
      const clients = await this.prisma.clientMarketplaceConnection.findMany({
        where: {
          marketplace: { in: [MarketplaceType.WILDBERRIES, MarketplaceType.OZON] },
          isActive: true,
        },
        select: { clientId: true },
        distinct: ['clientId'],
      });
      for (const { clientId } of clients) {
        try {
          const value = await this.loadFbsOrders(clientId);
          this.fbsOrdersCache.set(clientId, {
            expiresAt: Date.now() + 30_000,
            value,
          });
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'Unknown marketplace API error';
          this.logger.warn(`FBS refresh failed for client ${clientId}: ${message}`);
        }
      }
    } finally {
      this.fbsBackgroundRefreshRunning = false;
    }
  }

  async list(clientId: string | undefined, user: AuthUser) {
    const where: Prisma.ClientMarketplaceConnectionWhereInput = {
      clientId: this.clientScopes.resolveClientFilter(user, clientId),
    };

    const connections = await this.prisma.clientMarketplaceConnection.findMany({
      where,
      orderBy: [{ client: { name: 'asc' } }, { marketplace: 'asc' }, { accountName: 'asc' }],
      include: {
        client: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    return connections.map(maskConnection);
  }

  async listFbsOrders(clientId: string, user: AuthUser, refresh = false) {
    const normalizedClientId = clientId?.trim();
    if (!normalizedClientId) {
      throw new BadRequestException('Выберите клиента для просмотра заказов FBS.');
    }
    this.clientScopes.requireClientAccess(user, normalizedClientId, 'read');

    const cached = this.fbsOrdersCache.get(normalizedClientId);
    if (!refresh && cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value = await this.loadFbsOrders(normalizedClientId);
    this.fbsOrdersCache.set(normalizedClientId, {
      expiresAt: Date.now() + 30_000,
      value,
    });
    return value;
  }

  private async loadFbsOrders(clientId: string): Promise<FbsOrdersResponse> {
    const [client, connections] = await Promise.all([
      this.prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.clientMarketplaceConnection.findMany({
        where: {
          clientId,
          marketplace: { in: [MarketplaceType.WILDBERRIES, MarketplaceType.OZON] },
          isActive: true,
        },
        orderBy: [{ accountName: 'asc' }, { createdAt: 'asc' }],
        include: {
          client: {
            select: { id: true, code: true, name: true },
          },
        },
      }),
    ]);

    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }

    const fetchedAt = new Date().toISOString();
    if (connections.length === 0) {
      return {
        client,
        connected: false,
        connections: [],
        fetchedAt,
        counts: { active: 0, shipped: 0, archive: 0, all: 0 },
        orders: [],
      };
    }

    const rawOrders: WildberriesFbsOrder[] = [];
    for (const connection of connections) {
      if (connection.marketplace === MarketplaceType.WILDBERRIES) {
        rawOrders.push(...(await this.fetchWildberriesFbsOrders(connection)));
      } else if (connection.marketplace === MarketplaceType.OZON) {
        rawOrders.push(...(await this.fetchOzonFbsOrders(connection)));
      }
    }

    const barcodes = uniqueStrings(rawOrders.flatMap((order) => asArray<unknown>(order.skus).map(textValue)));
    const articles = uniqueStrings(rawOrders.map((order) => textValue(order.article)));
    const skus =
      barcodes.length > 0 || articles.length > 0
        ? await this.prisma.sku.findMany({
            where: {
              clientId,
              OR: [
                ...(barcodes.length > 0 ? [{ barcodes: { some: { value: { in: barcodes } } } }] : []),
                ...(articles.length > 0
                  ? [
                      { article: { in: articles } },
                      { clientSku: { in: articles } },
                    ]
                  : []),
              ],
            },
            select: {
              id: true,
              name: true,
              internalSku: true,
              clientSku: true,
              article: true,
              barcodes: { select: { value: true } },
              balances: {
                where: {
                  quantity: { gt: 0 },
                  boxId: { not: null },
                },
                select: {
                  quantity: true,
                  status: true,
                  box: { select: { code: true } },
                },
              },
            },
          })
        : [];

    const skuByBarcode = new Map(
      skus.flatMap((sku) => sku.barcodes.map((barcode) => [barcode.value, sku] as const)),
    );
    const skuByArticle = new Map(
      skus.flatMap((sku) =>
        uniqueStrings([sku.article ?? '', sku.clientSku ?? '', sku.internalSku]).map(
          (article) => [article.toLowerCase(), sku] as const,
        ),
      ),
    );

    const ordersWithoutBilling: FbsOrderSummary[] = rawOrders
      .map((order) => {
        const orderBarcodes = uniqueStrings(asArray<unknown>(order.skus).map(textValue));
        const article = textValue(order.article);
        const sku =
          orderBarcodes.map((barcode) => skuByBarcode.get(barcode)).find(Boolean) ??
          skuByArticle.get(article.toLowerCase()) ??
          null;
        const supplierStatus = textValue(order.supplierStatus) || 'new';
        const wbStatus = textValue(order.wbStatus) || 'waiting';
        const category = fbsOrderCategory(supplierStatus, wbStatus);

        return {
          id: textValue(order.id),
          orderUid: textValue(order.orderUid) || null,
          connectionId: order.connectionId,
          accountName: order.accountName,
          marketplace: order.marketplace,
          category,
          supplierStatus,
          wbStatus,
          statusLabel: fbsStatusLabel(supplierStatus, wbStatus),
          article: article || null,
          nmId: textValue(order.nmId) || null,
          chrtId: textValue(order.chrtId) || null,
          barcodes: orderBarcodes,
          product: sku
            ? {
                id: sku.id,
                name: sku.name,
                internalSku: sku.internalSku,
                clientSku: sku.clientSku,
                article: sku.article,
              }
            : null,
          storageBoxes: sku
            ? sku.balances
                .filter((balance) => balance.box)
                .map((balance) => ({
                  code: balance.box!.code,
                  quantity: balance.quantity,
                  status: balance.status,
                }))
                .sort((left, right) => left.code.localeCompare(right.code))
            : [],
          createdAt: textValue(order.createdAt) || null,
          sellerDate: textValue(order.sellerDate) || null,
          deliveryDate: textValue(order.ddate) || null,
          supplyId: textValue(order.supplyId) || null,
          warehouseId: textValue(order.warehouseId) || null,
          officeId: textValue(order.officeId) || null,
          cargoType: textValue(order.cargoType) || null,
          requiredMeta: uniqueStrings(asArray<unknown>(order.requiredMeta).map(textValue)),
          optionalMeta: uniqueStrings(asArray<unknown>(order.optionalMeta).map(textValue)),
          comment: textValue(order.comment) || null,
          billing: null,
        };
      })
      .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
    const billingByOrder = await this.ensureFbsProcessingCharges(
      clientId,
      ordersWithoutBilling.filter((order) => order.category === 'shipped'),
    );
    const orders = ordersWithoutBilling.map((order) => ({
      ...order,
      billing: billingByOrder.get(fbsOrderKey(order)) ?? null,
    }));

    return {
      client,
      connected: true,
      connections: connections.map((connection) => ({
        id: connection.id,
        marketplace: connection.marketplace,
        accountName: connection.accountName,
      })),
      fetchedAt,
      counts: {
        active: orders.filter((order) => order.category === 'active').length,
        shipped: orders.filter((order) => order.category === 'shipped').length,
        archive: orders.filter((order) => order.category === 'archive').length,
        all: orders.length,
      },
      orders,
    };
  }

  private async fetchWildberriesFbsOrders(connection: MarketplaceConnectionWithClient) {
    const headers = {
      Authorization: connection.apiKey,
      'Content-Type': 'application/json',
    };
    const [newResponse, historicalOrders] = await Promise.all([
      marketplaceJson('https://marketplace-api.wildberries.ru/api/v3/orders/new', {
        method: 'GET',
        headers,
      }),
      fetchWildberriesFbsHistory(headers),
    ]);

    const ordersById = new Map<string, Record<string, unknown>>();
    for (const order of historicalOrders) {
      const id = textValue(order.id);
      if (id) {
        ordersById.set(id, order);
      }
    }
    for (const order of asArray<Record<string, unknown>>(newResponse.orders)) {
      const id = textValue(order.id);
      if (id) {
        ordersById.set(id, { ...(ordersById.get(id) ?? {}), ...order });
      }
    }

    const ids = [...ordersById.keys()]
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    const statuses = new Map<string, { supplierStatus: string; wbStatus: string }>();
    for (const orderIds of chunks(ids, 1000)) {
      const response = await marketplaceJson('https://marketplace-api.wildberries.ru/api/v3/orders/status', {
        method: 'POST',
        headers,
        body: JSON.stringify({ orders: orderIds }),
      });
      for (const status of asArray<Record<string, unknown>>(response.orders)) {
        const id = textValue(status.id);
        if (id) {
          statuses.set(id, {
            supplierStatus: textValue(status.supplierStatus),
            wbStatus: textValue(status.wbStatus),
          });
        }
      }
    }

    return [...ordersById.entries()].map(([id, order]) => {
      const status = statuses.get(id);
      return {
        ...order,
        connectionId: connection.id,
        accountName: connection.accountName,
        marketplace: MarketplaceType.WILDBERRIES,
        supplierStatus: status?.supplierStatus || 'new',
        wbStatus: status?.wbStatus || 'waiting',
      } satisfies WildberriesFbsOrder;
    });
  }

  private async fetchOzonFbsOrders(connection: MarketplaceConnectionWithClient) {
    if (!connection.sellerId) {
      throw new BadRequestException('Для Ozon заполните Client-Id.');
    }
    const headers = {
      'Client-Id': connection.sellerId,
      'Api-Key': connection.apiKey,
      'Content-Type': 'application/json',
    };
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();
    const postings: Record<string, unknown>[] = [];

    for (let offset = 0; offset < 5000; offset += 1000) {
      const response = await marketplaceJson('https://api-seller.ozon.ru/v3/posting/fbs/list', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          dir: 'DESC',
          filter: { since, to },
          limit: 1000,
          offset,
          with: {
            analytics_data: true,
            barcodes: true,
            financial_data: false,
          },
        }),
      });
      const page = asArray<Record<string, unknown>>(asRecord(response.result).postings);
      postings.push(...page);
      if (page.length < 1000) {
        break;
      }
    }

    return postings.map((posting) => {
      const products = asArray<Record<string, unknown>>(posting.products);
      const product = products[0] ?? {};
      const status = textValue(posting.status);
      const analytics = asRecord(posting.analytics_data);
      return {
        ...posting,
        id: textValue(posting.posting_number),
        orderUid: textValue(posting.order_id) || textValue(posting.posting_number),
        article: textValue(product.offer_id),
        nmId: textValue(product.sku),
        chrtId: '',
        skus: uniqueStrings([
          ...asArray<unknown>(posting.barcodes).map(textValue),
          ...asArray<unknown>(product.barcodes).map(textValue),
          textValue(product.offer_id),
        ]),
        createdAt: textValue(posting.in_process_at) || textValue(posting.shipment_date),
        sellerDate: textValue(posting.shipment_date),
        ddate: textValue(posting.delivering_date),
        supplyId: textValue(posting.tracking_number),
        warehouseId: textValue(analytics.warehouse_id),
        officeId: textValue(analytics.warehouse_name),
        cargoType: '',
        requiredMeta: [],
        optionalMeta: [],
        connectionId: connection.id,
        accountName: connection.accountName,
        marketplace: MarketplaceType.OZON,
        supplierStatus: status,
        wbStatus: status,
      } satisfies WildberriesFbsOrder;
    });
  }

  private async ensureFbsProcessingCharges(clientId: string, orders: FbsOrderSummary[]) {
    const result = new Map<string, NonNullable<FbsOrderSummary['billing']>>();
    if (orders.length === 0) {
      return result;
    }

    const service = await this.prisma.billingService.upsert({
      where: { code: FBS_PROCESSING_SERVICE_CODE },
      update: {
        name: 'Обработка заказа FBS',
        unit: BillingUnit.PIECE,
        isActive: true,
      },
      create: {
        code: FBS_PROCESSING_SERVICE_CODE,
        name: 'Обработка заказа FBS',
        unit: BillingUnit.PIECE,
        defaultPriceRub: 0,
        isActive: true,
      },
    });
    const clientPrice = await this.prisma.clientBillingService.findUnique({
      where: {
        clientId_serviceId: {
          clientId,
          serviceId: service.id,
        },
      },
      select: { priceRub: true, isActive: true },
    });
    const unitPriceRub =
      clientPrice?.isActive === false
        ? 0
        : Number(clientPrice?.priceRub ?? service.defaultPriceRub ?? 0);

    for (const order of orders) {
      const sourceKey = `fbs:${order.marketplace.toLowerCase()}:${order.connectionId}:${order.id}`;
      const existing = await this.prisma.billingCharge.findUnique({
        where: { sourceKey },
        include: {
          invoiceItems: {
            where: { invoice: { status: { not: 'CANCELLED' } } },
            select: {
              invoice: { select: { number: true, status: true } },
            },
            take: 1,
          },
        },
      });
      const charge = !existing
        ? await this.prisma.billingCharge.create({
          data: {
            clientId,
            serviceId: service.id,
            description: `Обработка FBS-заказа ${marketplaceShortLabel(order.marketplace)} №${order.id}`,
            unit: BillingUnit.PIECE,
            quantity: 1,
            unitPriceRub,
            totalRub: unitPriceRub,
            status: BillingChargeStatus.DRAFT,
            serviceDate: validDate(order.createdAt) ?? new Date(),
            source: BillingChargeSource.MANUAL,
            sourceKey,
            metadata: {
              kind: 'FBS',
              marketplace: order.marketplace,
              connectionId: order.connectionId,
              orderId: order.id,
              supplyId: order.supplyId,
            },
          },
          include: {
            invoiceItems: {
              where: { invoice: { status: { not: 'CANCELLED' } } },
              select: {
                invoice: { select: { number: true, status: true } },
              },
              take: 1,
            },
          },
          })
        : existing.status === BillingChargeStatus.DRAFT &&
            existing.invoiceItems.length === 0 &&
            Number(existing.unitPriceRub) !== unitPriceRub
          ? await this.prisma.billingCharge.update({
              where: { id: existing.id },
              data: {
                unitPriceRub,
                totalRub: unitPriceRub,
              },
              include: {
                invoiceItems: {
                  where: { invoice: { status: { not: 'CANCELLED' } } },
                  select: {
                    invoice: { select: { number: true, status: true } },
                  },
                  take: 1,
                },
              },
            })
          : existing;
      const invoice = charge.invoiceItems[0]?.invoice ?? null;
      result.set(fbsOrderKey(order), {
        chargeId: charge.id,
        status: charge.status,
        unitPriceRub: Number(charge.unitPriceRub),
        totalRub: Number(charge.totalRub),
        invoiceNumber: invoice?.number ?? null,
        invoiceStatus: invoice?.status ?? null,
      });
    }

    return result;
  }

  async createFbsConnection(dto: UpsertMarketplaceConnectionDto, user: AuthUser) {
    if (dto.marketplace !== MarketplaceType.WILDBERRIES && dto.marketplace !== MarketplaceType.OZON) {
      throw new BadRequestException('В разделе FBS можно подключить Wildberries или Ozon.');
    }
    this.clientScopes.requireClientAccess(user, dto.clientId, 'read');
    if (dto.marketplace === MarketplaceType.OZON && !dto.sellerId?.trim()) {
      throw new BadRequestException('Для Ozon укажите Client-Id.');
    }

    try {
      const created = await this.prisma.clientMarketplaceConnection.create({
        data: normalizedData(dto),
        include: {
          client: {
            select: { id: true, code: true, name: true },
          },
        },
      });
      this.fbsOrdersCache.delete(dto.clientId);
      return maskConnection(created);
    } catch (caught) {
      if (isUniqueError(caught)) {
        throw new BadRequestException('Такое подключение маркетплейса уже существует.');
      }
      throw caught;
    }
  }

  async create(dto: UpsertMarketplaceConnectionDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');

    try {
      const created = await this.prisma.clientMarketplaceConnection.create({
        data: normalizedData(dto),
        include: {
          client: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      });

      return maskConnection(created);
    } catch (caught) {
      if (isUniqueError(caught)) {
        throw new BadRequestException('Такое подключение для клиента уже есть.');
      }
      throw caught;
    }
  }

  async update(id: string, dto: Partial<UpsertMarketplaceConnectionDto>, user: AuthUser) {
    const existing = await this.prisma.clientMarketplaceConnection.findUnique({
      where: { id },
      select: { clientId: true },
    });

    if (!existing) {
      throw new NotFoundException('Подключение маркетплейса не найдено.');
    }
    this.clientScopes.requireClientAccess(user, existing.clientId, 'write');
    if (dto.clientId && dto.clientId !== existing.clientId) {
      this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    }

    try {
      const updated = await this.prisma.clientMarketplaceConnection.update({
        where: { id },
        data: normalizedData(dto),
        include: {
          client: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      });

      return maskConnection(updated);
    } catch (caught) {
      if (isUniqueError(caught)) {
        throw new BadRequestException('Такое подключение для клиента уже есть.');
      }
      throw caught;
    }
  }

  async delete(id: string, user: AuthUser) {
    const existing = await this.prisma.clientMarketplaceConnection.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        marketplace: true,
        accountName: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Подключение маркетплейса не найдено.');
    }
    this.clientScopes.requireClientAccess(user, existing.clientId, 'write');

    await this.prisma.clientMarketplaceConnection.delete({ where: { id } });
    return {
      id: existing.id,
      marketplace: existing.marketplace,
      accountName: existing.accountName,
      deleted: true,
    };
  }

  async syncProducts(id: string, user: AuthUser) {
    const connection = await this.prisma.clientMarketplaceConnection.findUnique({
      where: { id },
      include: {
        client: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    if (!connection) {
      throw new NotFoundException('Подключение маркетплейса не найдено.');
    }
    this.clientScopes.requireClientAccess(user, connection.clientId, 'write');

    if (!connection.isActive) {
      throw new BadRequestException('Подключение отключено. Включите его перед синхронизацией товаров.');
    }

    const products = await this.fetchMarketplaceProducts(connection);
    const result = {
      marketplace: connection.marketplace,
      clientId: connection.clientId,
      productsReceived: products.length,
      created: 0,
      updated: 0,
      barcodesTouched: 0,
      skipped: 0,
      errors: [] as Array<{ offerId: string; message: string }>,
    };

    for (const product of products) {
      try {
        const synced = await this.upsertMarketplaceSku(connection.clientId, product);
        result[synced.created ? 'created' : 'updated'] += 1;
        result.barcodesTouched += synced.barcodesTouched;
      } catch (caught) {
        result.skipped += 1;
        result.errors.push({
          offerId: product.offerId,
          message: caught instanceof Error ? caught.message : 'Не удалось сохранить товар.',
        });
      }
    }

    return result;
  }

  private async fetchMarketplaceProducts(connection: MarketplaceConnectionWithClient) {
    if (connection.marketplace === MarketplaceType.WILDBERRIES) {
      return this.fetchWildberriesProducts(connection);
    }

    if (connection.marketplace === MarketplaceType.OZON) {
      return this.fetchOzonProducts(connection);
    }

    throw new BadRequestException('Автоматическая выгрузка товаров сейчас подключена для Wildberries и Ozon.');
  }

  private async fetchWildberriesProducts(connection: MarketplaceConnectionWithClient) {
    const products: MarketplaceProductSyncItem[] = [];
    const maxPages = 1000;
    let cursor: Record<string, unknown> = { limit: 100 };

    for (let page = 0; page < maxPages; page += 1) {
      const response = await marketplaceJson('https://content-api.wildberries.ru/content/v2/get/cards/list', {
        method: 'POST',
        headers: {
          Authorization: connection.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          settings: {
            sort: {
              ascending: true,
            },
            cursor,
            filter: {
              withPhoto: -1,
            },
          },
        }),
      });
      const cards = asArray<Record<string, unknown>>(response.cards);

      for (const card of cards) {
        const sizes = asArray<Record<string, unknown>>(card.sizes);
        const effectiveSizes = sizes.length > 0 ? sizes : [null];
        for (const size of effectiveSizes) {
          products.push(mapWildberriesCard(card, size));
        }
      }

      const nextCursor = asRecord(response.cursor);
      const total = numberValue(nextCursor.total);
      const limit = numberValue(nextCursor.limit) || 100;
      const updatedAt = textValue(nextCursor.updatedAt);
      const nmID = textValue(nextCursor.nmID);
      if (cards.length === 0 || !updatedAt || !nmID || total < limit) {
        break;
      }

      cursor = { limit, updatedAt, nmID: Number(nmID) || nmID };
    }

    return products;
  }

  private async fetchOzonProducts(connection: MarketplaceConnectionWithClient) {
    if (!connection.sellerId) {
      throw new BadRequestException('Для Ozon заполните ID продавца / Client-Id.');
    }

    const headers = {
      'Client-Id': connection.sellerId,
      'Api-Key': connection.apiKey,
      'Content-Type': 'application/json',
    };
    const listed: Array<{ product_id?: number | string; offer_id?: string }> = [];
    let lastId = '';

    for (let page = 0; page < 100; page += 1) {
      const response = await marketplaceJson('https://api-seller.ozon.ru/v3/product/list', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: {
            visibility: 'ALL',
          },
          last_id: lastId,
          limit: 100,
        }),
      });
      const result = asRecord(response.result);
      const items = asArray<{ product_id?: number | string; offer_id?: string }>(result.items);
      listed.push(...items);
      const nextLastId = textValue(result.last_id);
      if (items.length === 0 || !nextLastId || nextLastId === lastId) {
        break;
      }
      lastId = nextLastId;
    }

    const products: MarketplaceProductSyncItem[] = [];
    for (const chunk of chunks(listed, 100)) {
      const productIds = chunk.map((item) => item.product_id).filter((id): id is string | number => id != null);
      const detailsById = await this.fetchOzonProductDetails(headers, productIds);
      const attributesById = await this.fetchOzonProductAttributes(headers, productIds);

      for (const item of chunk) {
        const productId = String(item.product_id ?? item.offer_id ?? '');
        if (!productId) {
          continue;
        }

        products.push(mapOzonProduct(item, detailsById.get(productId), attributesById.get(productId)));
      }
    }

    return products;
  }

  private async fetchOzonProductDetails(headers: Record<string, string>, productIds: Array<string | number>) {
    if (productIds.length === 0) {
      return new Map<string, Record<string, unknown>>();
    }

    const response = await marketplaceJson('https://api-seller.ozon.ru/v3/product/info/list', {
      method: 'POST',
      headers,
      body: JSON.stringify({ product_id: productIds }),
    });
    const items = asArray<Record<string, unknown>>(asRecord(response.result).items);
    return new Map(items.map((item) => [textValue(item.id) || textValue(item.product_id), item]));
  }

  private async fetchOzonProductAttributes(headers: Record<string, string>, productIds: Array<string | number>) {
    if (productIds.length === 0) {
      return new Map<string, Record<string, unknown>>();
    }

    try {
      const response = await marketplaceJson('https://api-seller.ozon.ru/v4/product/info/attributes', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: {
            product_id: productIds,
            visibility: 'ALL',
          },
          limit: productIds.length,
        }),
      });
      const items = asArray<Record<string, unknown>>(asRecord(response.result).items);
      return new Map(items.map((item) => [textValue(item.id) || textValue(item.product_id), item]));
    } catch {
      return new Map<string, Record<string, unknown>>();
    }
  }

  private async upsertMarketplaceSku(clientId: string, product: MarketplaceProductSyncItem) {
    const existing =
      (await this.prisma.sku.findFirst({
        where: {
          clientId,
          marketplace: product.marketplace,
          marketplaceProductId: product.productId,
        },
      })) ??
      (await this.prisma.sku.findFirst({
        where: {
          clientId,
          marketplace: product.marketplace,
          marketplaceOfferId: product.offerId,
        },
      })) ??
      (product.barcode
        ? (
            await this.prisma.barcode.findFirst({
              where: { value: product.barcode, sku: { clientId } },
              include: { sku: true },
            })
          )?.sku
        : null) ??
      (await this.prisma.sku.findUnique({
        where: {
          clientId_internalSku: {
            clientId,
            internalSku: product.internalSku,
          },
        },
      }));

    const preserveManualVolume =
      existing?.volumeSource === VolumeSource.MANUAL && Number(existing.volumeLiters) > 0;
    const data = marketplaceSkuData(clientId, product, preserveManualVolume);
    const sku = existing
      ? await this.prisma.sku.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.sku.create({
          data,
        });

    let barcodesTouched = 0;
    for (const barcode of product.barcodes) {
      await this.prisma.barcode.upsert({
        where: {
          skuId_value: {
            skuId: sku.id,
            value: barcode,
          },
        },
        update: { isPrimary: barcode === product.barcode },
        create: {
          skuId: sku.id,
          value: barcode,
          isPrimary: barcode === product.barcode,
        },
      });
      barcodesTouched += 1;
    }

    return { created: !existing, barcodesTouched };
  }
}

function normalizedData(dto: Partial<UpsertMarketplaceConnectionDto>): Prisma.ClientMarketplaceConnectionUncheckedCreateInput {
  return {
    ...(dto.clientId === undefined ? {} : { clientId: dto.clientId }),
    ...(dto.marketplace === undefined ? {} : { marketplace: dto.marketplace }),
    ...(dto.accountName === undefined ? {} : { accountName: normalizeNullable(dto.accountName) }),
    ...(dto.sellerId === undefined ? {} : { sellerId: normalizeNullable(dto.sellerId) }),
    ...(dto.apiKey === undefined ? {} : { apiKey: dto.apiKey.trim() }),
    ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
    ...(dto.comment === undefined ? {} : { comment: normalizeNullable(dto.comment) }),
  } as Prisma.ClientMarketplaceConnectionUncheckedCreateInput;
}

function maskConnection(connection: {
  id: string;
  clientId: string;
  marketplace: string;
  accountName: string | null;
  sellerId: string | null;
  apiKey: string;
  isActive: boolean;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  client: { id: string; code: string; name: string };
}) {
  return {
    id: connection.id,
    clientId: connection.clientId,
    marketplace: connection.marketplace,
    accountName: connection.accountName,
    sellerId: connection.sellerId,
    apiKeyMask: maskApiKey(connection.apiKey),
    hasApiKey: Boolean(connection.apiKey),
    isActive: connection.isActive,
    comment: connection.comment,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    client: connection.client,
  };
}

function maskApiKey(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return '********';
  }
  return `${'*'.repeat(8)}${trimmed.slice(-4)}`;
}

function normalizeNullable(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function isUniqueError(caught: unknown) {
  return caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2002';
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  const normalized = textValue(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  return ['1', 'true', 'yes', 'y', 'да'].includes(normalized);
}

async function marketplaceJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      textValue(payload.message) ||
      textValue(payload.error) ||
      textValue(payload.detail) ||
      `Маркетплейс вернул HTTP ${response.status}.`;
    throw new BadRequestException(message);
  }

  return payload;
}

async function fetchWildberriesFbsHistory(headers: Record<string, string>) {
  const orders: Record<string, unknown>[] = [];
  let next = 0;

  for (let page = 0; page < 5; page += 1) {
    const url = new URL('https://marketplace-api.wildberries.ru/api/v3/orders');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('next', String(next));
    const response = await marketplaceJson(url.toString(), {
      method: 'GET',
      headers,
    });
    const pageOrders = asArray<Record<string, unknown>>(response.orders);
    orders.push(...pageOrders);

    const nextValue = numberValue(response.next);
    if (pageOrders.length < 1000 || !nextValue || nextValue === next) {
      break;
    }
    next = nextValue;
  }

  return orders;
}

function fbsOrderCategory(supplierStatus: string, wbStatus: string): 'active' | 'shipped' | 'archive' {
  const archiveSupplierStatuses = new Set(['cancel', 'cancel_carrier', 'cancelled', 'canceled']);
  const archiveWbStatuses = new Set([
    'sold',
    'canceled',
    'canceled_by_client',
    'declined_by_client',
    'defect',
    'canceled_by_carrier',
  ]);
  if (archiveSupplierStatuses.has(supplierStatus) || archiveWbStatuses.has(wbStatus)) {
    return 'archive';
  }
  if (['complete', 'delivering', 'delivered'].includes(supplierStatus)) {
    return 'shipped';
  }
  return 'active';
}

function fbsStatusLabel(supplierStatus: string, wbStatus: string) {
  const labels: Record<string, string> = {
    new: 'Новый',
    confirm: 'На сборке',
    complete: 'Передан в доставку',
    cancel: 'Отменён продавцом',
    cancel_carrier: 'Отменён перевозчиком',
    awaiting_registration: 'Ожидает регистрации',
    acceptance_in_progress: 'Принимается в обработку',
    awaiting_approve: 'Ожидает подтверждения',
    awaiting_packaging: 'Ожидает сборки',
    awaiting_deliver: 'Готов к отгрузке',
    delivering: 'Передан в доставку',
    delivered: 'Доставлен',
    cancelled: 'Отменён',
    waiting: 'Ожидает передачи',
    sorted: 'Отсортирован WB',
    sold: 'Получен покупателем',
    canceled: 'Отменён',
    canceled_by_client: 'Отменён покупателем',
    declined_by_client: 'Отменён покупателем',
    defect: 'Отмена из-за брака',
    ready_for_pickup: 'Готов к получению',
    postponed_delivery: 'Доставка перенесена',
    accepted_by_carrier: 'Принят перевозчиком',
    sent_to_carrier: 'Передан перевозчику',
    canceled_by_carrier: 'Отменён перевозчиком',
  };
  return labels[supplierStatus] || labels[wbStatus] || supplierStatus || wbStatus || 'Статус не определён';
}

function fbsOrderKey(order: Pick<FbsOrderSummary, 'marketplace' | 'connectionId' | 'id'>) {
  return `${order.marketplace}:${order.connectionId}:${order.id}`;
}

function marketplaceShortLabel(marketplace: MarketplaceType) {
  return marketplace === MarketplaceType.WILDBERRIES ? 'WB' : marketplace === MarketplaceType.OZON ? 'Ozon' : marketplace;
}

function mapWildberriesCard(card: Record<string, unknown>, size: Record<string, unknown> | null): MarketplaceProductSyncItem {
  const nmID = textValue(card.nmID);
  const vendorCode = textValue(card.vendorCode);
  const chrtID = textValue(size?.chrtID);
  const sizeName = [textValue(size?.techSize), textValue(size?.wbSize)].filter(Boolean).join(' / ');
  const barcodes = uniqueStrings(asArray<unknown>(size?.skus).map(textValue));
  const dimensions = asRecord(card.dimensions);
  const characteristics = asArray<Record<string, unknown>>(card.characteristics);
  const needKiz = toBoolean(card.needKiz) || toBoolean(card.kizMarked);
  const color = characteristicValue(characteristics, ['цвет', 'color']);
  const productId = [nmID || vendorCode, chrtID].filter(Boolean).join(':') || vendorCode || cryptoSafeId(card);
  const offerId = barcodes[0] || chrtID || vendorCode || productId;

  return {
    marketplace: MarketplaceType.WILDBERRIES,
    productId,
    offerId,
    internalSku: safeSku([vendorCode || `WB-${productId}`, sizeName].filter(Boolean).join('-')),
    clientSku: vendorCode || undefined,
    article: vendorCode || undefined,
    barcode: barcodes[0],
    barcodes,
    name: textValue(card.title) || textValue(card.object) || vendorCode || `WB ${productId}`,
    brand: textValue(card.brand) || undefined,
    category: textValue(card.subjectName) || textValue(card.object) || undefined,
    color: color || undefined,
    size: sizeName || undefined,
    weightGrams: kgToGrams(numberValue(dimensions.weightBrutto)),
    lengthCm: positiveNumber(dimensions.length),
    widthCm: positiveNumber(dimensions.width),
    heightCm: positiveNumber(dimensions.height),
    needsChestnyZnak:
      needKiz ||
      toBoolean(card.needKiz) ||
      toBoolean(card.kizMarked) ||
      (Boolean(textValue(card.imtID)) && hasCharacteristic(characteristics, ['киз', 'честный знак', 'маркировка'])),
    payload: {
      marketplace: 'WILDBERRIES',
      card,
      size,
      characteristics,
      dimensions,
    },
  };
}

function mapOzonProduct(
  item: { product_id?: number | string; offer_id?: string },
  detail: Record<string, unknown> | undefined,
  attributes: Record<string, unknown> | undefined,
): MarketplaceProductSyncItem {
  const source: Record<string, unknown> = { ...item, ...(detail ?? {}) };
  const productId = textValue(source.id) || textValue(source.product_id) || textValue(item.product_id) || textValue(item.offer_id);
  const offerId = textValue(source.offer_id) || textValue(item.offer_id) || productId;
  const barcodes = uniqueStrings([
    textValue(source.barcode),
    ...asArray<unknown>(source.barcodes).map(textValue),
    ...asArray<unknown>(source.sku_barcodes).map(textValue),
  ]);
  const attrs = asArray<Record<string, unknown>>(attributes?.attributes);
  const dimensions = extractOzonDimensions(source, attributes);

  return {
    marketplace: MarketplaceType.OZON,
    productId,
    offerId,
    internalSku: safeSku(offerId || `OZON-${productId}`),
    clientSku: offerId || undefined,
    article: offerId || undefined,
    barcode: barcodes[0],
    barcodes,
    name: textValue(source.name) || textValue(attributes?.name) || offerId || `Ozon ${productId}`,
    brand: textValue(source.brand) || attributeValue(attrs, ['бренд', 'brand']) || undefined,
    category: textValue(source.category_name) || textValue(attributes?.type_name) || textValue(attributes?.description_category_id) || undefined,
    color: attributeValue(attrs, ['цвет', 'color']) || undefined,
    size: attributeValue(attrs, ['размер', 'size']) || undefined,
    weightGrams: dimensions.weightGrams,
    lengthCm: dimensions.lengthCm,
    widthCm: dimensions.widthCm,
    heightCm: dimensions.heightCm,
    needsChestnyZnak: hasAttribute(attrs, ['честный знак', 'маркировка', 'киз']),
    payload: {
      marketplace: 'OZON',
      listItem: item,
      detail,
      attributes,
    },
  };
}

function marketplaceSkuData(
  clientId: string,
  product: MarketplaceProductSyncItem,
  preserveManualVolume = false,
): Prisma.SkuUncheckedCreateInput {
  const volumeLiters = calculateVolumeLiters(product);

  return {
    clientId,
    internalSku: product.internalSku,
    clientSku: product.clientSku,
    article: product.article,
    name: product.name,
    brand: product.brand,
    category: product.category,
    color: product.color,
    size: product.size,
    weightGrams: product.weightGrams,
    lengthCm: product.lengthCm,
    widthCm: product.widthCm,
    heightCm: product.heightCm,
    ...(!preserveManualVolume && volumeLiters ? { volumeLiters, volumeSource: 'CALCULATED' } : {}),
    needsChestnyZnak: product.needsChestnyZnak ?? false,
    marketplace: product.marketplace,
    marketplaceProductId: product.productId,
    marketplaceOfferId: product.offerId,
    marketplacePayload: cleanJson(product.payload),
    marketplaceSyncedAt: new Date(),
  };
}

function extractOzonDimensions(source: Record<string, unknown>, attributes?: Record<string, unknown>) {
  const unit = textValue(source.dimension_unit).toLowerCase();
  const weightUnit = textValue(source.weight_unit).toLowerCase();
  const depth = positiveNumber(source.depth) ?? positiveNumber(source.length);
  const width = positiveNumber(source.width);
  const height = positiveNumber(source.height);
  const weight = positiveNumber(source.weight);

  return {
    lengthCm: convertLengthToCm(depth, unit),
    widthCm: convertLengthToCm(width, unit),
    heightCm: convertLengthToCm(height, unit),
    weightGrams:
      convertWeightToGrams(weight, weightUnit) ??
      convertWeightToGrams(positiveNumber(attributes?.weight), textValue(attributes?.weight_unit).toLowerCase()),
  };
}

function convertLengthToCm(value: number | undefined, unit: string) {
  if (!value) {
    return undefined;
  }
  if (unit === 'mm') {
    return round(value / 10, 2);
  }
  if (unit === 'm') {
    return round(value * 100, 2);
  }
  return round(value, 2);
}

function convertWeightToGrams(value: number | undefined, unit: string) {
  if (!value) {
    return undefined;
  }
  if (unit === 'kg' || unit === 'кг') {
    return Math.round(value * 1000);
  }
  return Math.round(value);
}

function kgToGrams(value: number | undefined) {
  return value ? Math.round(value * 1000) : undefined;
}

function calculateVolumeLiters(product: Pick<MarketplaceProductSyncItem, 'lengthCm' | 'widthCm' | 'heightCm'>) {
  if (!product.lengthCm || !product.widthCm || !product.heightCm) {
    return undefined;
  }

  return round((product.lengthCm * product.widthCm * product.heightCm) / 1000, 3);
}

function characteristicValue(characteristics: Array<Record<string, unknown>>, names: string[]) {
  return attributeValue(characteristics, names);
}

function attributeValue(attributes: Array<Record<string, unknown>>, names: string[]) {
  const normalizedNames = names.map((name) => name.toLowerCase());
  const attribute = attributes.find((item) => {
    const name = [textValue(item.name), textValue(item.charcName), textValue(item.attribute_name)].join(' ').toLowerCase();
    return normalizedNames.some((needle) => name.includes(needle));
  });
  if (!attribute) {
    return '';
  }

  const values = asArray<unknown>(attribute.values)
    .map((value) => (typeof value === 'object' && value !== null ? textValue((value as Record<string, unknown>).value) : textValue(value)))
    .filter(Boolean);
  return values.join(', ') || textValue(attribute.value);
}

function hasCharacteristic(characteristics: Array<Record<string, unknown>>, names: string[]) {
  return Boolean(characteristicValue(characteristics, names));
}

function hasAttribute(attributes: Array<Record<string, unknown>>, names: string[]) {
  return Boolean(attributeValue(attributes, names));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function textValue(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function numberValue(value: unknown) {
  if (value == null || value === '') {
    return 0;
  }
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveNumber(value: unknown) {
  const parsed = numberValue(value);
  return parsed > 0 ? parsed : undefined;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function safeSku(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= 100 ? normalized : `${normalized.slice(0, 83)}-${cryptoSafeId(normalized)}`;
}

function cryptoSafeId(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cleanJson(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function validDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const FBS_PROCESSING_SERVICE_CODE = 'FBS_PROCESSING';
