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
  ClientRequestEventType,
  ClientRequestStatus,
  ClientRequestType,
  FbsDeliveryDestination,
  MarketplaceType,
  Prisma,
  VolumeSource,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import type { FbsOrderSelectionDto } from './dto/fbs-order-selection.dto';
import { UpdateFbsBillingSettingsDto } from './dto/update-fbs-billing-settings.dto';
import { UpsertMarketplaceConnectionDto } from './dto/upsert-marketplace-connection.dto';
import { DEFAULT_FBS_ITEMS_PER_CARGO_PLACE } from './fbs.constants';
import {
  buildFbsCargoPlaceStickersPdf,
  buildFbsStickersPdf,
  type FbsStickerImage,
} from './fbs-stickers-pdf';

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
  itemCount: number;
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
  crossBorderType: string | null;
  pickupPointShipmentAllowed: boolean;
  requiredMeta: string[];
  optionalMeta: string[];
  comment: string | null;
  request: {
    id: string;
    number: number;
    title: string;
    status: ClientRequestStatus;
  } | null;
  billing: {
    chargeId: string;
    status: string;
    unitPriceRub: number;
    totalRub: number;
    invoiceNumber: string | null;
    invoiceStatus: string | null;
    breakdown: {
      fbsProcessingRub: number;
      additionalServicesRub: number;
      deliveryRub: number;
      boxFormationRub: number;
      boxMaterialRub: number;
      palletRub: number;
      shipmentKey: string;
      shipmentItems: number;
      boxCount: number;
      palletCount: number;
      deliveryDestination: FbsDeliveryDestination;
    };
  } | null;
};

type FbsOrdersResponse = {
  client: { id: string; code: string; name: string };
  connected: boolean;
  connections: Array<{ id: string; marketplace: MarketplaceType; accountName: string | null }>;
  fetchedAt: string;
  deliveryPlan: {
    destination: FbsDeliveryDestination;
    itemsPerCargoPlace: number;
    requiresCargoPlaces: boolean;
  };
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

  async listFbsActiveClients(user: AuthUser) {
    const clientFilter = this.clientScopes.resolveClientFilter(user);
    const connections = await this.prisma.clientMarketplaceConnection.findMany({
      where: {
        clientId: clientFilter,
        marketplace: { in: [MarketplaceType.WILDBERRIES, MarketplaceType.OZON] },
        isActive: true,
      },
      select: {
        client: { select: { id: true, code: true, name: true } },
      },
      orderBy: { client: { name: 'asc' } },
    });
    const clients = new Map(connections.map((connection) => [connection.client.id, connection.client]));
    const result: Array<{
      client: { id: string; code: string; name: string };
      activeOrders: number;
      fetchedAt: string;
    }> = [];

    for (const client of clients.values()) {
      try {
        const cached = this.fbsOrdersCache.get(client.id);
        const orders = cached?.value ?? (await this.loadFbsOrders(client.id));
        if (!cached) {
          this.fbsOrdersCache.set(client.id, { expiresAt: Date.now() + 30_000, value: orders });
        }
        if (orders.counts.active > 0) {
          result.push({
            client,
            activeOrders: orders.counts.active,
            fetchedAt: orders.fetchedAt,
          });
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Unknown marketplace API error';
        this.logger.warn(`FBS active clients summary failed for client ${client.id}: ${message}`);
      }
    }

    return result.sort(
      (left, right) =>
        right.activeOrders - left.activeOrders || left.client.name.localeCompare(right.client.name, 'ru-RU'),
    );
  }

  async assembleFbsOrders(dto: FbsOrderSelectionDto, user: AuthUser) {
    const clientId = dto.clientId.trim();
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const { response, orders } = await this.resolveSelectedFbsOrders(clientId, dto.orders);
    const deliveryPlan = await this.loadFbsDeliveryPlan(clientId);

    const unsupported = orders.filter((order) => order.marketplace !== MarketplaceType.WILDBERRIES);
    if (unsupported.length > 0) {
      throw new BadRequestException('Массовая сборка сейчас доступна только для заказов Wildberries.');
    }
    const unavailable = orders.filter((order) => order.supplierStatus !== 'new');
    if (unavailable.length > 0) {
      throw new BadRequestException(
        `В сборку можно перевести только новые заказы. Проверьте: ${unavailable.map((order) => order.id).join(', ')}.`,
      );
    }
    if (deliveryPlan.requiresCargoPlaces) {
      const pickupPointUnavailable = orders.filter((order) => !order.pickupPointShipmentAllowed);
      if (pickupPointUnavailable.length > 0) {
        throw new BadRequestException(
          `Wildberries не разрешает отгрузку выбранных заказов через ПВЗ: ${pickupPointUnavailable
            .map((order) => order.id)
            .join(', ')}. Выберите в тарифах клиента доставку в сортировочный центр.`,
        );
      }
    }

    const connections = await this.loadSelectedConnections(clientId, orders);
    const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
    const groupedOrders = new Map<string, FbsOrderSummary[]>();
    for (const order of orders) {
      const groupKey = [
        order.connectionId,
        order.cargoType ?? 'unknown-cargo',
        order.warehouseId ?? 'unknown-warehouse',
        order.crossBorderType ?? 'regular',
      ].join(':');
      const group = groupedOrders.get(groupKey) ?? [];
      group.push(order);
      groupedOrders.set(groupKey, group);
    }

    const supplies: Array<{
      id: string;
      connectionId: string;
      orderIds: string[];
      itemCount: number;
      cargoPlaceCount: number;
      cargoPlaceIds: string[];
    }> = [];
    let supplyIndex = 0;
    for (const group of groupedOrders.values()) {
      supplyIndex += 1;
      const connection = connectionById.get(group[0].connectionId);
      if (!connection) {
        throw new BadRequestException(`Подключение WB для заказа ${group[0].id} не найдено или отключено.`);
      }
      const headers = wbHeaders(connection.apiKey);
      const supplyName = fbsSupplyName(response.client.code, supplyIndex, groupedOrders.size);
      const created = await marketplaceJson('https://marketplace-api.wildberries.ru/api/v3/supplies', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: supplyName }),
      });
      const supplyId = textValue(created.id);
      if (!supplyId) {
        throw new BadRequestException('Wildberries создал поставку без номера. Повторите операцию позже.');
      }

      let addedOrders = 0;
      try {
        for (const orderChunk of chunks(group, 100)) {
          const orderIds = orderChunk.map((order) => numericWbOrderId(order.id));
          await marketplaceJson(
            `https://marketplace-api.wildberries.ru/api/marketplace/v3/supplies/${encodeURIComponent(supplyId)}/orders`,
            {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ orders: orderIds }),
            },
          );
          addedOrders += orderIds.length;
        }
      } catch (caught) {
        if (addedOrders === 0) {
          await deleteEmptyWbSupply(supplyId, headers);
        }
        const message = caught instanceof Error ? caught.message : 'неизвестная ошибка Wildberries';
        throw new BadRequestException(
          addedOrders > 0
            ? `Часть заказов (${addedOrders}) уже добавлена в поставку ${supplyId}, остальные WB не принял: ${message}`
            : `Wildberries не перевёл заказы в сборку: ${message}`,
        );
      }

      const itemCount = group.reduce((sum, order) => sum + Math.max(1, order.itemCount), 0);
      let cargoPlaceIds: string[] = [];
      if (deliveryPlan.requiresCargoPlaces) {
        const cargoPlaceCount = Math.ceil(itemCount / deliveryPlan.itemsPerCargoPlace);
        try {
          const cargoResponse = await marketplaceJson(
            `https://marketplace-api.wildberries.ru/api/v3/supplies/${encodeURIComponent(supplyId)}/trbx`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({ amount: cargoPlaceCount }),
            },
          );
          cargoPlaceIds = uniqueStrings(asArray<unknown>(cargoResponse.trbxIds).map(textValue));
          if (cargoPlaceIds.length !== cargoPlaceCount) {
            throw new Error(
              `ожидалось ${cargoPlaceCount}, Wildberries вернул ${cargoPlaceIds.length}`,
            );
          }
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'неизвестная ошибка Wildberries';
          throw new BadRequestException(
            `Заказы уже добавлены в поставку ${supplyId}, но грузоместа не созданы: ${message}. ` +
              `Создайте ${cargoPlaceCount} грузомест в кабинете WB для этой же поставки.`,
          );
        }
      }

      supplies.push({
        id: supplyId,
        connectionId: connection.id,
        orderIds: group.map((order) => order.id),
        itemCount,
        cargoPlaceCount: cargoPlaceIds.length,
        cargoPlaceIds,
      });
    }

    const refreshedOrders = await this.refreshFbsOrdersCache(clientId);
    return {
      assembled: orders.length,
      deliveryPlan,
      supplies,
      orders: refreshedOrders,
    };
  }

  async getFbsOrderStickersPdf(dto: FbsOrderSelectionDto, user: AuthUser) {
    const clientId = dto.clientId.trim();
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const { orders } = await this.resolveSelectedFbsOrders(clientId, dto.orders);

    const unavailable = orders.filter(
      (order) =>
        order.marketplace !== MarketplaceType.WILDBERRIES ||
        !['confirm', 'complete'].includes(order.supplierStatus),
    );
    if (unavailable.length > 0) {
      throw new BadRequestException(
        `ШК можно скачать для заказов WB в статусе «На сборке» или «В доставке». Проверьте: ${unavailable
          .map((order) => order.id)
          .join(', ')}.`,
      );
    }

    const connections = await this.loadSelectedConnections(clientId, orders);
    const ordersByConnection = new Map<string, FbsOrderSummary[]>();
    for (const order of orders) {
      const group = ordersByConnection.get(order.connectionId) ?? [];
      group.push(order);
      ordersByConnection.set(order.connectionId, group);
    }

    const stickersByOrderId = new Map<string, FbsStickerImage>();
    for (const connection of connections) {
      const connectionOrders = ordersByConnection.get(connection.id) ?? [];
      for (const orderChunk of chunks(connectionOrders, 100)) {
        const response = await marketplaceJson(
          'https://marketplace-api.wildberries.ru/api/v3/orders/stickers?type=png&width=58&height=40',
          {
            method: 'POST',
            headers: wbHeaders(connection.apiKey),
            body: JSON.stringify({ orders: orderChunk.map((order) => numericWbOrderId(order.id)) }),
          },
        );
        for (const sticker of asArray<Record<string, unknown>>(response.stickers)) {
          const orderId = textValue(sticker.orderId);
          const file = textValue(sticker.file);
          if (orderId && file) {
            stickersByOrderId.set(orderId, {
              orderId,
              barcode: textValue(sticker.barcode),
              file,
            });
          }
        }
      }
    }

    const missingOrderIds = orders.map((order) => order.id).filter((orderId) => !stickersByOrderId.has(orderId));
    if (missingOrderIds.length > 0) {
      throw new BadRequestException(
        `Wildberries пока не сформировал ШК для заказов: ${missingOrderIds.join(', ')}. Обновите статусы и повторите.`,
      );
    }
    const stickers = orders.map((order) => stickersByOrderId.get(order.id)!);
    const buffer = await buildFbsStickersPdf(stickers);
    return {
      fileName: `fbs-wb-order-stickers-${fileTimestamp(new Date())}.pdf`,
      contentType: 'application/pdf' as const,
      buffer,
      count: stickers.length,
    };
  }

  async getFbsCargoPlaceStickersPdf(dto: FbsOrderSelectionDto, user: AuthUser) {
    const clientId = dto.clientId.trim();
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const [{ orders }, deliveryPlan] = await Promise.all([
      this.resolveSelectedFbsOrders(clientId, dto.orders),
      this.loadFbsDeliveryPlan(clientId),
    ]);
    if (!deliveryPlan.requiresCargoPlaces) {
      throw new BadRequestException(
        'QR грузомест нужны только при сдаче поставки в ПВЗ. Для выбранного клиента настроена сдача в сортировочный центр.',
      );
    }

    const unavailable = orders.filter(
      (order) =>
        order.marketplace !== MarketplaceType.WILDBERRIES ||
        order.supplierStatus !== 'confirm' ||
        !order.supplyId,
    );
    if (unavailable.length > 0) {
      throw new BadRequestException(
        `QR грузомест можно скачать только для заказов WB в открытой поставке «На сборке»: ${unavailable
          .map((order) => order.id)
          .join(', ')}.`,
      );
    }

    const connections = await this.loadSelectedConnections(clientId, orders);
    const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
    const supplies = new Map<string, { connectionId: string; supplyId: string }>();
    for (const order of orders) {
      const supplyId = order.supplyId!;
      supplies.set(`${order.connectionId}:${supplyId}`, {
        connectionId: order.connectionId,
        supplyId,
      });
    }

    const stickers: FbsStickerImage[] = [];
    for (const supply of supplies.values()) {
      const connection = connectionById.get(supply.connectionId);
      if (!connection) {
        throw new BadRequestException(`Подключение WB для поставки ${supply.supplyId} не найдено.`);
      }
      const headers = wbHeaders(connection.apiKey);
      const cargoResponse = await marketplaceJson(
        `https://marketplace-api.wildberries.ru/api/v3/supplies/${encodeURIComponent(supply.supplyId)}/trbx`,
        { method: 'GET', headers },
      );
      const cargoPlaceIds = uniqueStrings(
        asArray<Record<string, unknown>>(cargoResponse.trbxes).map((cargoPlace) => textValue(cargoPlace.id)),
      );
      if (cargoPlaceIds.length === 0) {
        throw new BadRequestException(
          `В поставке ${supply.supplyId} нет грузомест. Сначала добавьте их из расчёта ${deliveryPlan.itemsPerCargoPlace} единиц товара на одно грузоместо.`,
        );
      }
      const stickerResponse = await marketplaceJson(
        `https://marketplace-api.wildberries.ru/api/v3/supplies/${encodeURIComponent(supply.supplyId)}/trbx/stickers?type=png`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ trbxIds: cargoPlaceIds }),
        },
      );
      const supplyStickers = asArray<Record<string, unknown>>(stickerResponse.stickers)
        .map((sticker, index) => ({
          orderId: `${supply.supplyId}-${index + 1}`,
          barcode: textValue(sticker.barcode),
          file: textValue(sticker.file),
        }))
        .filter((sticker) => sticker.file);
      if (supplyStickers.length !== cargoPlaceIds.length) {
        throw new BadRequestException(
          `Wildberries вернул ${supplyStickers.length} QR вместо ${cargoPlaceIds.length} для поставки ${supply.supplyId}.`,
        );
      }
      stickers.push(...supplyStickers);
    }

    const buffer = await buildFbsCargoPlaceStickersPdf(stickers);
    return {
      fileName: `fbs-wb-cargo-place-qr-${fileTimestamp(new Date())}.pdf`,
      contentType: 'application/pdf' as const,
      buffer,
      count: stickers.length,
    };
  }

  async createFbsRequest(dto: FbsOrderSelectionDto, user: AuthUser) {
    const clientId = dto.clientId.trim();
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    const { orders } = await this.resolveSelectedFbsOrders(clientId, dto.orders);
    const inactive = orders.filter((order) => order.category !== 'active');
    if (inactive.length > 0) {
      throw new BadRequestException(
        `Заявку можно создать только из активных FBS-заказов. Проверьте: ${inactive.map((order) => order.id).join(', ')}.`,
      );
    }
    const unmapped = orders.filter((order) => !order.product);
    if (unmapped.length > 0) {
      throw new BadRequestException(
        `Не найдены карточки товаров WMS для заказов: ${unmapped.map((order) => order.id).join(', ')}. Сначала синхронизируйте товары.`,
      );
    }

    const links = await this.prisma.fbsOrderRequestLink.findMany({
      where: {
        clientId,
        connectionId: { in: uniqueStrings(orders.map((order) => order.connectionId)) },
        orderId: { in: uniqueStrings(orders.map((order) => order.id)) },
      },
      include: {
        request: { select: { id: true, number: true, status: true } },
      },
    });
    const activeLinks = links.filter((link) => link.request.status !== ClientRequestStatus.CANCELLED);
    if (activeLinks.length > 0) {
      throw new BadRequestException(
        `Заказы уже включены в заявку: ${activeLinks
          .map((link) => `${link.orderId} — №${String(link.request.number).padStart(6, '0')}`)
          .join(', ')}.`,
      );
    }

    const orderIds = orders.map((order) => order.id);
    const itemGroups = new Map<
      string,
      { skuId: string; barcode: string | null; name: string; quantity: number; orderIds: string[] }
    >();
    for (const order of orders) {
      const product = order.product!;
      const current = itemGroups.get(product.id);
      if (current) {
        current.quantity += Math.max(1, order.itemCount);
        current.orderIds.push(order.id);
      } else {
        itemGroups.set(product.id, {
          skuId: product.id,
          barcode: order.barcodes[0] ?? null,
          name: product.name,
          quantity: Math.max(1, order.itemCount),
          orderIds: [order.id],
        });
      }
    }

    try {
      const request = await this.prisma.$transaction(async (tx) => {
        const created = await tx.clientRequest.create({
          data: {
            clientId,
            type: ClientRequestType.OUTBOUND,
            status: ClientRequestStatus.SUBMITTED,
            priority: 'NORMAL',
            title: `FBS — ${orders.length} заказ(а/ов)`,
            destinationCity: 'Маркетплейс FBS',
            comment: `Создано из FBS-заказов: ${orderIds.join(', ')}`,
            createdByUserId: user.id,
            items: {
              create: [...itemGroups.values()].map((item) => ({
                skuId: item.skuId,
                barcode: item.barcode,
                name: item.name,
                quantity: item.quantity,
                comment: `FBS-заказы: ${item.orderIds.join(', ')}`,
              })),
            },
          },
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            items: { select: { id: true, skuId: true, name: true, quantity: true } },
          },
        });

        await tx.clientRequestEvent.create({
          data: {
            requestId: created.id,
            clientId,
            eventType: ClientRequestEventType.CREATED,
            title: 'Заявка создана из FBS-заказов',
            body: orderIds.join(', '),
            statusTo: ClientRequestStatus.SUBMITTED,
            createdByUserId: user.id,
          },
        });

        for (const order of orders) {
          const existing = links.find(
            (link) =>
              link.marketplace === order.marketplace &&
              link.connectionId === order.connectionId &&
              link.orderId === order.id,
          );
          if (existing) {
            await tx.fbsOrderRequestLink.update({
              where: { id: existing.id },
              data: { requestId: created.id, createdByUserId: user.id },
            });
          } else {
            await tx.fbsOrderRequestLink.create({
              data: {
                clientId,
                marketplace: order.marketplace,
                connectionId: order.connectionId,
                orderId: order.id,
                requestId: created.id,
                createdByUserId: user.id,
              },
            });
          }
        }
        return created;
      });

      const refreshedOrders = await this.refreshFbsOrdersCache(clientId);
      return { request, linkedOrders: orders.length, orders: refreshedOrders };
    } catch (caught) {
      if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2002') {
        throw new BadRequestException('Один из выбранных FBS-заказов уже включён в другую заявку. Обновите таблицу.');
      }
      throw caught;
    }
  }

  private async resolveSelectedFbsOrders(
    clientId: string,
    selections: Array<{ connectionId: string; id: string }>,
  ) {
    const response = await this.loadFbsOrders(clientId);
    const orderByKey = new Map(response.orders.map((order) => [selectionKey(order.connectionId, order.id), order]));
    const uniqueSelections = new Map(
      selections.map((selection) => [selectionKey(selection.connectionId, selection.id), selection]),
    );
    const missing: string[] = [];
    const orders: FbsOrderSummary[] = [];
    for (const [key, selection] of uniqueSelections) {
      const order = orderByKey.get(key);
      if (order) orders.push(order);
      else missing.push(selection.id);
    }
    if (missing.length > 0) {
      throw new BadRequestException(`Заказы не найдены в выбранном кабинете: ${missing.join(', ')}.`);
    }
    return { response, orders };
  }

  private async loadSelectedConnections(clientId: string, orders: FbsOrderSummary[]) {
    const connectionIds = uniqueStrings(orders.map((order) => order.connectionId));
    const connections = await this.prisma.clientMarketplaceConnection.findMany({
      where: {
        id: { in: connectionIds },
        clientId,
        marketplace: MarketplaceType.WILDBERRIES,
        isActive: true,
      },
      include: {
        client: { select: { id: true, code: true, name: true } },
      },
    });
    if (connections.length !== connectionIds.length) {
      throw new BadRequestException('Одно из подключений Wildberries не найдено или отключено.');
    }
    return connections;
  }

  private async refreshFbsOrdersCache(clientId: string) {
    const value = await this.loadFbsOrders(clientId);
    this.fbsOrdersCache.set(clientId, { expiresAt: Date.now() + 30_000, value });
    return value;
  }

  async getFbsBillingSettings(clientId: string, user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);
    return this.loadFbsBillingSettingsView(clientId);
  }

  async updateFbsBillingSettings(
    clientId: string,
    dto: UpdateFbsBillingSettingsDto,
    user: AuthUser,
  ) {
    this.clientScopes.requireGlobalClientAccess(user);
    const { client, fbsService, boxFormationService, boxMaterialService } =
      await this.ensureFbsBillingBase(clientId);

    const requestedServiceIds = uniqueStrings([
      ...(dto.additionalServices ?? []).map((service) => service.serviceId),
      dto.boxFormationServiceId ?? '',
      dto.boxMaterialServiceId ?? '',
      dto.palletServiceId ?? '',
    ]);
    if (dto.palletsEnabled && !dto.palletServiceId) {
      throw new BadRequestException('Для начисления паллет выберите услугу паллеты.');
    }
    const requestedServices =
      requestedServiceIds.length > 0
        ? await this.prisma.billingService.findMany({
            where: { id: { in: requestedServiceIds }, isActive: true },
            include: {
              clientPrices: {
                where: { clientId, isActive: true },
                take: 1,
              },
            },
          })
        : [];
    const requestedById = new Map(requestedServices.map((service) => [service.id, service]));

    for (const serviceId of requestedServiceIds) {
      const service = requestedById.get(serviceId);
      if (!service) {
        throw new BadRequestException('Одна из выбранных услуг клиента недоступна.');
      }
      if (isPalletBillingService(service)) {
        const selectedAsPallet =
          service.id === dto.palletServiceId &&
          service.id !== dto.boxFormationServiceId &&
          service.id !== dto.boxMaterialServiceId &&
          !(dto.additionalServices ?? []).some((selection) => selection.serviceId === service.id);
        if (!selectedAsPallet) {
          throw new BadRequestException(
            'Паллетную услугу можно выбрать только в блоке «Учёт паллет».',
          );
        }
      } else if (service.id === dto.palletServiceId) {
        throw new BadRequestException('В блоке «Учёт паллет» выберите услугу паллеты или поддона.');
      }
      if (
        service.id !== boxFormationService.id &&
        service.id !== boxMaterialService.id &&
        service.clientPrices.length === 0
      ) {
        throw new BadRequestException(`Сначала подключите услугу «${service.name}» клиенту.`);
      }
    }

    const additionalServices = dto.additionalServices.filter(
      (selection) =>
        selection.serviceId !== fbsService.id &&
        selection.serviceId !== dto.boxFormationServiceId &&
        selection.serviceId !== dto.boxMaterialServiceId &&
        selection.serviceId !== dto.palletServiceId,
    );

    await this.prisma.$transaction(async (tx) => {
      const settings = await tx.clientFbsBillingSettings.upsert({
        where: { clientId },
        update: {
          defaultDeliveryDestination: dto.defaultDeliveryDestination,
          pickupPointBasePriceRub: dto.pickupPointBasePriceRub,
          vnukovoBasePriceRub: dto.vnukovoBasePriceRub,
          baseIncludedItems: dto.baseIncludedItems,
          extraBlockItems: dto.extraBlockItems,
          extraBlockPriceRub: dto.extraBlockPriceRub,
          boxCapacityItems: dto.boxCapacityItems,
          boxFormationServiceId: dto.boxFormationServiceId || null,
          boxMaterialServiceId: dto.boxMaterialServiceId || null,
          palletsEnabled: dto.palletsEnabled,
          boxesPerPallet: dto.boxesPerPallet,
          palletServiceId: dto.palletServiceId || null,
        },
        create: {
          clientId: client.id,
          defaultDeliveryDestination: dto.defaultDeliveryDestination,
          pickupPointBasePriceRub: dto.pickupPointBasePriceRub,
          vnukovoBasePriceRub: dto.vnukovoBasePriceRub,
          baseIncludedItems: dto.baseIncludedItems,
          extraBlockItems: dto.extraBlockItems,
          extraBlockPriceRub: dto.extraBlockPriceRub,
          boxCapacityItems: dto.boxCapacityItems,
          boxFormationServiceId: dto.boxFormationServiceId || null,
          boxMaterialServiceId: dto.boxMaterialServiceId || null,
          palletsEnabled: dto.palletsEnabled,
          boxesPerPallet: dto.boxesPerPallet,
          palletServiceId: dto.palletServiceId || null,
        },
      });
      await tx.clientFbsAdditionalService.deleteMany({
        where: { settingsId: settings.id },
      });
      if (additionalServices.length > 0) {
        await tx.clientFbsAdditionalService.createMany({
          data: additionalServices.map((selection) => ({
            settingsId: settings.id,
            serviceId: selection.serviceId,
            quantityMultiplier: selection.quantityMultiplier,
          })),
        });
      }
      await tx.clientBillingService.upsert({
        where: {
          clientId_serviceId: {
            clientId,
            serviceId: fbsService.id,
          },
        },
        update: {
          priceRub: dto.fbsProcessingPriceRub,
          isActive: true,
          updatedByUserId: user.id,
        },
        create: {
          clientId,
          serviceId: fbsService.id,
          priceRub: dto.fbsProcessingPriceRub,
          isActive: true,
          updatedByUserId: user.id,
        },
      });
    });

    this.fbsOrdersCache.delete(clientId);
    return this.loadFbsBillingSettingsView(clientId);
  }

  private async loadFbsBillingSettingsView(clientId: string) {
    const { client, settings, fbsService } = await this.ensureFbsBillingBase(clientId);
    const services = await this.prisma.billingService.findMany({
      where: { isActive: true },
      include: {
        clientPrices: {
          where: { clientId },
          take: 1,
        },
      },
      orderBy: [{ name: 'asc' }],
    });
    const fbsClientPrice = services.find((service) => service.id === fbsService.id)?.clientPrices[0];
    const additionalById = new Map(
      settings.additionalServices.map((selection) => [
        selection.serviceId,
        Number(selection.quantityMultiplier),
      ]),
    );

    return {
      client,
      settings: {
        id: settings.id,
        defaultDeliveryDestination: settings.defaultDeliveryDestination,
        pickupPointBasePriceRub: Number(settings.pickupPointBasePriceRub),
        vnukovoBasePriceRub: Number(settings.vnukovoBasePriceRub),
        baseIncludedItems: settings.baseIncludedItems,
        extraBlockItems: settings.extraBlockItems,
        extraBlockPriceRub: Number(settings.extraBlockPriceRub),
        boxCapacityItems: settings.boxCapacityItems,
        palletsEnabled: settings.palletsEnabled,
        boxesPerPallet: settings.boxesPerPallet,
        fbsProcessingPriceRub: Number(
          fbsClientPrice?.priceRub ?? fbsService.defaultPriceRub ?? 0,
        ),
        boxFormationServiceId: settings.boxFormationServiceId,
        boxMaterialServiceId: settings.boxMaterialServiceId,
        palletServiceId: settings.palletServiceId,
        additionalServices: settings.additionalServices.map((selection) => ({
          serviceId: selection.serviceId,
          quantityMultiplier: Number(selection.quantityMultiplier),
        })),
      },
      serviceOptions: services
        .filter((service) => service.id !== fbsService.id)
        .map((service) => {
          const clientPrice = service.clientPrices[0] ?? null;
          return {
            id: service.id,
            code: service.code,
            name: service.name,
            unit: service.unit,
            priceRub: Number(clientPrice?.priceRub ?? service.defaultPriceRub ?? 0),
            isActive: clientPrice?.isActive ?? false,
            isPallet: isPalletBillingService(service),
            quantityMultiplier: additionalById.get(service.id) ?? 1,
          };
        }),
      excludedRule:
        'Паллеты начисляются только при включённой настройке и выбранной паллетной услуге.',
    };
  }

  private async ensureFbsBillingBase(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, code: true, name: true },
    });
    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }

    const [fbsService, boxFormationService, boxMaterialService] = await Promise.all([
      this.prisma.billingService.upsert({
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
      }),
      this.prisma.billingService.upsert({
        where: { code: FBS_BOX_FORMATION_SERVICE_CODE },
        update: {
          name: 'Сборка короба',
          unit: BillingUnit.PIECE,
          isActive: true,
        },
        create: {
          code: FBS_BOX_FORMATION_SERVICE_CODE,
          name: 'Сборка короба',
          unit: BillingUnit.PIECE,
          defaultPriceRub: 40,
          isActive: true,
        },
      }),
      this.prisma.billingService.upsert({
        where: { code: FBS_BOX_MATERIAL_SERVICE_CODE },
        update: {
          name: 'Короб 60*40*40',
          unit: BillingUnit.PIECE,
          isActive: true,
        },
        create: {
          code: FBS_BOX_MATERIAL_SERVICE_CODE,
          name: 'Короб 60*40*40',
          unit: BillingUnit.PIECE,
          defaultPriceRub: 100,
          isActive: true,
        },
      }),
    ]);

    await Promise.all(
      [fbsService, boxFormationService, boxMaterialService].map((service) =>
        this.prisma.clientBillingService.upsert({
          where: {
            clientId_serviceId: {
              clientId,
              serviceId: service.id,
            },
          },
          update: {},
          create: {
            clientId,
            serviceId: service.id,
            priceRub: service.defaultPriceRub ?? 0,
            isActive: true,
          },
        }),
      ),
    );

    const settings = await this.prisma.clientFbsBillingSettings.upsert({
      where: { clientId },
      update: {},
      create: {
        clientId,
        defaultDeliveryDestination: FbsDeliveryDestination.PICKUP_POINT,
        pickupPointBasePriceRub: 500,
        vnukovoBasePriceRub: 1500,
        baseIncludedItems: 5,
        extraBlockItems: 5,
        extraBlockPriceRub: 250,
        boxCapacityItems: DEFAULT_FBS_ITEMS_PER_CARGO_PLACE,
        boxFormationServiceId: boxFormationService.id,
        boxMaterialServiceId: boxMaterialService.id,
        palletsEnabled: false,
        boxesPerPallet: 16,
        palletServiceId: null,
      },
      include: {
        additionalServices: true,
      },
    });

    return {
      client,
      settings,
      fbsService,
      boxFormationService,
      boxMaterialService,
    };
  }

  private async loadFbsDeliveryPlan(clientId: string): Promise<FbsOrdersResponse['deliveryPlan']> {
    const settings = await this.prisma.clientFbsBillingSettings.findUnique({
      where: { clientId },
      select: {
        defaultDeliveryDestination: true,
        boxCapacityItems: true,
      },
    });
    const destination = settings?.defaultDeliveryDestination ?? FbsDeliveryDestination.PICKUP_POINT;
    return {
      destination,
      itemsPerCargoPlace: Math.max(
        1,
        settings?.boxCapacityItems ?? DEFAULT_FBS_ITEMS_PER_CARGO_PLACE,
      ),
      requiresCargoPlaces: destination === FbsDeliveryDestination.PICKUP_POINT,
    };
  }

  private async loadFbsOrders(clientId: string): Promise<FbsOrdersResponse> {
    const [client, connections, deliveryPlan] = await Promise.all([
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
      this.loadFbsDeliveryPlan(clientId),
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
        deliveryPlan,
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
          itemCount: Math.max(1, Math.trunc(numberValue(order.itemCount)) || 1),
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
          supplyId: textValue(order.supplyId) || textValue(order.supplyID) || null,
          warehouseId: textValue(order.warehouseId) || null,
          officeId: textValue(order.officeId) || null,
          cargoType: textValue(order.cargoType) || null,
          crossBorderType: textValue(order.crossBorderType) || null,
          pickupPointShipmentAllowed: toBoolean(order.isPickupPointShipmentAllowed),
          requiredMeta: uniqueStrings(asArray<unknown>(order.requiredMeta).map(textValue)),
          optionalMeta: uniqueStrings(asArray<unknown>(order.optionalMeta).map(textValue)),
          comment: textValue(order.comment) || null,
          request: null,
          billing: null,
        };
      })
      .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
    const [billingByOrder, requestLinks] = await Promise.all([
      this.ensureFbsProcessingCharges(
        clientId,
        ordersWithoutBilling.filter((order) => order.category === 'shipped'),
      ),
      ordersWithoutBilling.length > 0
        ? this.prisma.fbsOrderRequestLink.findMany({
            where: {
              clientId,
              connectionId: { in: uniqueStrings(ordersWithoutBilling.map((order) => order.connectionId)) },
              orderId: { in: uniqueStrings(ordersWithoutBilling.map((order) => order.id)) },
            },
            include: {
              request: { select: { id: true, number: true, title: true, status: true } },
            },
          })
        : Promise.resolve([]),
    ]);
    const requestByOrder = new Map(
      requestLinks.map((link) => [selectionKey(link.connectionId, link.orderId), link.request]),
    );
    const orders = ordersWithoutBilling.map((order) => ({
      ...order,
      request: requestByOrder.get(selectionKey(order.connectionId, order.id)) ?? null,
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
      deliveryPlan,
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
        itemCount: 1,
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
      const itemCount = Math.max(
        1,
        products.reduce(
          (sum, currentProduct) => sum + Math.max(1, Math.trunc(numberValue(currentProduct.quantity)) || 1),
          0,
        ),
      );
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
        itemCount,
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

    const { settings, fbsService } = await this.ensureFbsBillingBase(clientId);
    const palletsEnabled = settings.palletsEnabled === true;
    const boxesPerPallet = Math.max(1, Number(settings.boxesPerPallet) || 16);
    const palletServiceId = settings.palletServiceId ?? null;
    const serviceIds = uniqueStrings([
      fbsService.id,
      settings.boxFormationServiceId ?? '',
      settings.boxMaterialServiceId ?? '',
      palletServiceId ?? '',
      ...settings.additionalServices.map((selection) => selection.serviceId),
    ]);
    const pricedServices = await this.prisma.billingService.findMany({
      where: { id: { in: serviceIds }, isActive: true },
      include: {
        clientPrices: {
          where: { clientId },
          take: 1,
        },
      },
    });
    const serviceById = new Map(pricedServices.map((service) => [service.id, service]));
    const servicePrice = (serviceId: string | null) => {
      if (!serviceId) return 0;
      const service = serviceById.get(serviceId);
      if (!service) return 0;
      const clientPrice = service.clientPrices[0] ?? null;
      if (clientPrice?.isActive === false) return 0;
      return Number(clientPrice?.priceRub ?? service.defaultPriceRub ?? 0);
    };
    const fbsProcessingPerItemRub = servicePrice(fbsService.id);
    const additionalServices = settings.additionalServices
      .map((selection) => {
        const service = serviceById.get(selection.serviceId);
        const quantityMultiplier = Number(selection.quantityMultiplier);
        return service && !isPalletBillingService(service)
          ? {
              serviceId: service.id,
              code: service.code,
              name: service.name,
              quantityMultiplier,
              unitPriceRub: servicePrice(service.id),
            }
          : null;
      })
      .filter(Boolean) as Array<{
        serviceId: string;
        code: string;
        name: string;
        quantityMultiplier: number;
        unitPriceRub: number;
      }>;
    const additionalPerItemRub = additionalServices.reduce(
      (sum, service) => sum + service.unitPriceRub * service.quantityMultiplier,
      0,
    );
    const batches = groupFbsOrdersByShipment(orders);

    for (const batchOrders of batches.values()) {
      const shipmentItems = batchOrders.reduce(
        (sum, order) => sum + Math.max(1, order.itemCount),
        0,
      );
      const weights = batchOrders.map((order) => Math.max(1, order.itemCount));
      const destinationBasePriceRub =
        settings.defaultDeliveryDestination === FbsDeliveryDestination.VNUKOVO_SORTING_CENTER
          ? Number(settings.vnukovoBasePriceRub)
          : Number(settings.pickupPointBasePriceRub);
      const extraBlocks = Math.ceil(
        Math.max(0, shipmentItems - settings.baseIncludedItems) /
          Math.max(1, settings.extraBlockItems),
      );
      const deliveryTotalRub = round(
        destinationBasePriceRub + extraBlocks * Number(settings.extraBlockPriceRub),
        2,
      );
      const boxCount = Math.ceil(shipmentItems / Math.max(1, settings.boxCapacityItems));
      const boxFormationTotalRub = round(
        boxCount * servicePrice(settings.boxFormationServiceId),
        2,
      );
      const boxMaterialTotalRub = round(
        boxCount * servicePrice(settings.boxMaterialServiceId),
        2,
      );
      const palletCount =
        palletsEnabled && palletServiceId
          ? Math.ceil(boxCount / boxesPerPallet)
          : 0;
      const palletTotalRub = round(
        palletCount * servicePrice(palletServiceId),
        2,
      );

      for (const [orderIndex, order] of batchOrders.entries()) {
        const itemCount = Math.max(1, order.itemCount);
        const fbsProcessingRub = round(fbsProcessingPerItemRub * itemCount, 2);
        const additionalServicesRub = round(additionalPerItemRub * itemCount, 2);
        const deliveryRub = allocateRub(deliveryTotalRub, weights, orderIndex);
        const boxFormationRub = allocateRub(boxFormationTotalRub, weights, orderIndex);
        const boxMaterialRub = allocateRub(boxMaterialTotalRub, weights, orderIndex);
        const palletRub = allocateRub(palletTotalRub, weights, orderIndex);
        const totalRub = round(
          fbsProcessingRub +
            additionalServicesRub +
            deliveryRub +
            boxFormationRub +
            boxMaterialRub +
            palletRub,
          2,
        );
        const unitPriceRub = round(totalRub / itemCount, 2);
        const shipmentKey = fbsShipmentKey(order);
        const breakdown: NonNullable<FbsOrderSummary['billing']>['breakdown'] = {
          fbsProcessingRub,
          additionalServicesRub,
          deliveryRub,
          boxFormationRub,
          boxMaterialRub,
          palletRub,
          shipmentKey,
          shipmentItems,
          boxCount,
          palletCount,
          deliveryDestination: settings.defaultDeliveryDestination,
        };
        const description = `Комплексная обработка FBS-заказа ${marketplaceShortLabel(order.marketplace)} №${order.id}`;
        const chargeMetadata = cleanJson({
          kind: 'FBS',
          pricingVersion: 3,
          marketplace: order.marketplace,
          connectionId: order.connectionId,
          orderId: order.id,
          supplyId: order.supplyId,
          itemCount,
          fbsProcessingPerItemRub,
          additionalServices,
          breakdown,
          deliveryRules: {
            destination: settings.defaultDeliveryDestination,
            destinationBasePriceRub,
            baseIncludedItems: settings.baseIncludedItems,
            extraBlockItems: settings.extraBlockItems,
            extraBlockPriceRub: Number(settings.extraBlockPriceRub),
          },
          boxRules: {
            capacityItems: settings.boxCapacityItems,
            formationServiceId: settings.boxFormationServiceId,
            materialServiceId: settings.boxMaterialServiceId,
          },
          palletRules: {
            enabled: palletsEnabled,
            boxesPerPallet,
            serviceId: palletServiceId,
          },
          palletsIncluded: palletsEnabled,
        });
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
        const shouldUpdate =
          existing?.status === BillingChargeStatus.DRAFT &&
          existing.invoiceItems.length === 0 &&
          (existing.serviceId !== fbsService.id ||
            existing.description !== description ||
            Number(existing.quantity) !== itemCount ||
            Number(existing.unitPriceRub) !== unitPriceRub ||
            Number(existing.totalRub) !== totalRub ||
            JSON.stringify(existing.metadata ?? null) !== JSON.stringify(chargeMetadata));
        const charge = !existing
          ? await this.prisma.billingCharge.create({
              data: {
                clientId,
                serviceId: fbsService.id,
                description,
                unit: BillingUnit.PIECE,
                quantity: itemCount,
                unitPriceRub,
                totalRub,
                status: BillingChargeStatus.DRAFT,
                serviceDate:
                  validDate(order.deliveryDate) ??
                  validDate(order.sellerDate) ??
                  validDate(order.createdAt) ??
                  new Date(),
                source: BillingChargeSource.MANUAL,
                sourceKey,
                metadata: chargeMetadata,
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
          : shouldUpdate
            ? await this.prisma.billingCharge.update({
              where: { id: existing.id },
              data: {
                serviceId: fbsService.id,
                description,
                quantity: itemCount,
                unitPriceRub,
                totalRub,
                metadata: chargeMetadata,
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
          breakdown,
        });
      }
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

function wbHeaders(apiKey: string) {
  return {
    Authorization: apiKey,
    'Content-Type': 'application/json',
  };
}

function numericWbOrderId(value: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new BadRequestException(`Некорректный номер заказа Wildberries: ${value}.`);
  }
  return result;
}

function selectionKey(connectionId: string, orderId: string) {
  return `${connectionId.trim()}:${orderId.trim()}`;
}

function fbsSupplyName(clientCode: string, index: number, total: number) {
  const suffix = total > 1 ? ` ${index}-${total}` : '';
  return `LOGOFF ${clientCode} ${fileTimestamp(new Date())}${suffix}`.slice(0, 128);
}

function fileTimestamp(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(value)
    .reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

async function deleteEmptyWbSupply(supplyId: string, headers: Record<string, string>) {
  try {
    await marketplaceJson(`https://marketplace-api.wildberries.ru/api/v3/supplies/${encodeURIComponent(supplyId)}`, {
      method: 'DELETE',
      headers,
    });
  } catch {
    // Cleanup is best-effort: the original WB error is more useful to the operator.
  }
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

function fbsShipmentKey(order: FbsOrderSummary) {
  const supply = order.supplyId?.trim();
  const date = (order.deliveryDate || order.sellerDate || order.createdAt || '').slice(0, 10);
  const batch = supply ? `supply:${supply}` : date ? `date:${date}` : `order:${order.id}`;
  return `${order.marketplace}:${order.connectionId}:${batch}`;
}

function groupFbsOrdersByShipment(orders: FbsOrderSummary[]) {
  const groups = new Map<string, FbsOrderSummary[]>();
  for (const order of orders) {
    const key = fbsShipmentKey(order);
    const group = groups.get(key) ?? [];
    group.push(order);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => left.id.localeCompare(right.id, 'ru-RU', { numeric: true }));
  }
  return groups;
}

function allocateRub(totalRub: number, weights: number[], index: number) {
  const totalCents = Math.round(totalRub * 100);
  const normalizedWeights = weights.map((weight) => Math.max(1, Math.trunc(weight) || 1));
  const totalWeight = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  const allocations = normalizedWeights.map((weight) =>
    Math.floor((totalCents * weight) / totalWeight),
  );
  let remainder = totalCents - allocations.reduce((sum, value) => sum + value, 0);
  for (let allocationIndex = 0; remainder > 0; allocationIndex = (allocationIndex + 1) % allocations.length) {
    allocations[allocationIndex] += 1;
    remainder -= 1;
  }
  return (allocations[index] ?? 0) / 100;
}

function isPalletBillingService(service: { code: string; name: string; unit: BillingUnit }) {
  const text = `${service.code} ${service.name}`.toLocaleUpperCase('ru-RU');
  return (
    service.unit === BillingUnit.PALLET ||
    text.includes('PALLET') ||
    text.includes('ПАЛЛЕТ') ||
    text.includes('ПОДДОН')
  );
}

const FBS_PROCESSING_SERVICE_CODE = 'FBS_PROCESSING';
const FBS_BOX_FORMATION_SERVICE_CODE = 'BOX_ASSEMBLY';
const FBS_BOX_MATERIAL_SERVICE_CODE = 'BOX_60_40_40';
