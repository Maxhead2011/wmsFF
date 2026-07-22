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
  BillingInvoiceSource,
  BillingInvoiceStatus,
  BillingUnit,
  ClientRequestEventType,
  ClientRequestStatus,
  ClientRequestType,
  FbsDeliveryDestination,
  MarketplaceType,
  MovementType,
  Prisma,
  StockStatus,
  VolumeSource,
} from '@prisma/client';
import { InventoryLockService } from '../../common/inventory/inventory-lock.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import {
  FBS_VNUKOVO,
  quoteFixedFbsCalculator,
} from '../logistics/fbs-calculator';
import type { FbsOrderSelectionDto } from './dto/fbs-order-selection.dto';
import type { FbsPassDto } from './dto/fbs-pass.dto';
import { UpdateFbsBillingSettingsDto } from './dto/update-fbs-billing-settings.dto';
import { UpsertMarketplaceConnectionDto } from './dto/upsert-marketplace-connection.dto';
import { DEFAULT_FBS_ITEMS_PER_CARGO_PLACE } from './fbs.constants';
import {
  buildFbsCargoPlaceStickersPdf,
  buildFbsPickListPdf,
  buildFbsSupplyStickersPdf,
  buildFbsStickersPdf,
  mergeFbsStickerPdfs,
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
  category: 'active' | 'shipped' | 'cancelled' | 'archive';
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
    needsChestnyZnak: boolean;
    isUnmarked: boolean;
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
  requiresReshipment: boolean;
  shipmentPlan: {
    destination: FbsDeliveryDestination;
    itemsPerCargoPlace: number;
    requiresCargoPlaces: boolean;
    cargoPlaceCount: number;
    cargoPlaceIds: string[];
  } | null;
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
  counts: { active: number; shipped: number; cancelled: number; archive: number; all: number };
  orders: FbsOrderSummary[];
};

type FbsTsdAssemblyRecord = Prisma.FbsTsdAssemblyGetPayload<{}>;
const FBS_TSD_STALE_UNSTARTED_TASK_MS = 2 * 60 * 60 * 1_000;

@Injectable()
export class MarketplaceConnectionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketplaceConnectionsService.name);
  private readonly fbsOrdersCache = new Map<string, { expiresAt: number; value: FbsOrdersResponse }>();
  private readonly fbsTsdStickerCache = new Map<
    string,
    {
      expiresAt: number;
      value: { partA: string; partB: string; barcode: string; imageBase64: string };
    }
  >();
  private fbsRefreshTimer: ReturnType<typeof setInterval> | undefined;
  private fbsBackgroundRefreshRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly inventoryLock?: InventoryLockService,
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

  async getNextFbsTsdAssembly(deviceCodeValue: unknown, user: AuthUser) {
    const deviceCode = this.fbsTsdDeviceCode(deviceCodeValue, user);
    const current = await this.prisma.fbsTsdAssembly.findFirst({
      where: { deviceCode, status: 'IN_PROGRESS' },
      orderBy: { updatedAt: 'desc' },
    });
    if (current) {
      this.clientScopes.requireClientAccess(user, current.clientId, 'write');
      return this.formatFbsTsdAssembly(current, user, 'Продолжите начатый заказ.');
    }

    const previousBatch = await this.prisma.fbsTsdAssembly.findFirst({
      where: { deviceCode, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { requestId: true, supplyId: true },
    });

    const clientFilter = this.clientScopes.resolveClientFilter(user);
    const connections = await this.prisma.clientMarketplaceConnection.findMany({
      where: {
        clientId: clientFilter,
        marketplace: MarketplaceType.WILDBERRIES,
        isActive: true,
      },
      select: { clientId: true },
      orderBy: { client: { name: 'asc' } },
    });
    const clientIds = uniqueStrings(connections.map((connection) => connection.clientId));
    let lastMarketplaceError = '';
    let blockedBatchOrder: { orderId: string; workerName: string } | null = null;

    for (const clientId of clientIds) {
      try {
        const cached = this.fbsOrdersCache.get(clientId);
        const response = cached && cached.expiresAt > Date.now()
          ? cached.value
          : await this.loadFbsOrders(clientId);
        if (!cached || cached.expiresAt <= Date.now()) {
          this.fbsOrdersCache.set(clientId, { expiresAt: Date.now() + 30_000, value: response });
        }

        const candidates = response.orders
          .filter(
            (order) =>
              order.marketplace === MarketplaceType.WILDBERRIES &&
              order.category === 'active' &&
              order.supplierStatus === 'confirm' &&
              Boolean(order.product) &&
              Boolean(order.request) &&
              !['DONE', 'CANCELLED', 'REJECTED'].includes(order.request?.status ?? '') &&
              order.storageBoxes.some(
                (box) => box.quantity > 0 && box.status === StockStatus.AVAILABLE,
              ),
          )
          .sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? ''));
        const sameBatchCandidates = previousBatch
          ? candidates.filter((order) =>
              previousBatch.supplyId
                ? order.supplyId === previousBatch.supplyId
                : order.request?.id === previousBatch.requestId,
            )
          : [];
        const orderedCandidates = sameBatchCandidates.length > 0 ? sameBatchCandidates : candidates;

        for (const order of orderedCandidates) {
          const product = order.product!;
          const request = order.request!;
          const requestItem = await this.prisma.clientRequestItem.findFirst({
            where: { requestId: request.id, skuId: product.id },
            select: { id: true },
          });
          if (!requestItem) continue;

          const existing = await this.prisma.fbsTsdAssembly.findUnique({
            where: {
              marketplace_connectionId_orderId: {
                marketplace: order.marketplace,
                connectionId: order.connectionId,
                orderId: order.id,
              },
            },
          });
          if (existing?.status === 'COMPLETED') continue;
          if (existing?.status === 'IN_PROGRESS') {
            const staleUnstarted =
              !existing.boxId &&
              !existing.barcode &&
              !existing.kiz &&
              existing.updatedAt.getTime() <= Date.now() - FBS_TSD_STALE_UNSTARTED_TASK_MS;
            if (!staleUnstarted) {
              blockedBatchOrder = {
                orderId: existing.orderId,
                workerName: existing.workerName ?? existing.deviceCode,
              };
              continue;
            }
            const released = await this.prisma.fbsTsdAssembly.updateMany({
              where: {
                id: existing.id,
                status: 'IN_PROGRESS',
                updatedAt: existing.updatedAt,
                boxId: null,
                barcode: null,
                kiz: null,
              },
              data: {
                status: 'RELEASED',
                errorMessage: `Пустое задание автоматически возвращено в очередь спустя ${FBS_TSD_STALE_UNSTARTED_TASK_MS / 3_600_000} ч. без сканирования.`,
              },
            });
            if (released.count === 0) continue;
          }

          const storageBoxes = order.storageBoxes.filter(
            (box) => box.quantity > 0 && box.status === StockStatus.AVAILABLE,
          );
          const metadata = uniqueStrings([...order.requiredMeta, ...order.optionalMeta]).map((item) =>
            item.toLowerCase(),
          );
          const requiresKiz =
            metadata.includes('sgtin') || (product.needsChestnyZnak && !product.isUnmarked);
          const data = {
            clientId,
            marketplace: order.marketplace,
            connectionId: order.connectionId,
            orderId: order.id,
            supplyId: order.supplyId,
            requestId: request.id,
            requestItemId: requestItem.id,
            skuId: product.id,
            productName: product.name,
            article: product.article ?? product.clientSku ?? product.internalSku,
            barcodes: order.barcodes as Prisma.InputJsonValue,
            storageBoxes: storageBoxes as Prisma.InputJsonValue,
            itemCount: Math.max(1, order.itemCount),
            requiresKiz,
            status: 'IN_PROGRESS',
            deviceCode,
            workerUserId: user.id,
            workerName: user.name,
            boxId: null,
            boxCode: null,
            barcode: null,
            kiz: null,
            wbMetaStatus: requiresKiz ? 'PENDING' : 'NOT_REQUIRED',
            errorMessage: null,
            completedAt: null,
          };

          try {
            const task = existing
              ? await this.prisma.fbsTsdAssembly.update({ where: { id: existing.id }, data })
              : await this.prisma.fbsTsdAssembly.create({ data });
            return this.formatFbsTsdAssembly(task, user, 'Заказ назначен. Следуйте подсказке на экране.');
          } catch (caught) {
            if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2002') {
              continue;
            }
            throw caught;
          }
        }
      } catch (caught) {
        lastMarketplaceError = caught instanceof Error ? caught.message : 'Wildberries временно недоступен.';
        this.logger.warn(`FBS TSD queue failed for client ${clientId}: ${lastMarketplaceError}`);
      }
    }

    return this.emptyFbsTsdAssembly(
      deviceCode,
      user,
      lastMarketplaceError
        ? 'Не удалось обновить очередь Wildberries. Повторите через минуту.'
        : blockedBatchOrder
          ? `В текущей поставке остался заказ ${blockedBatchOrder.orderId}, но он закреплён за сотрудником ${blockedBatchOrder.workerName}. Продолжите его на том ТСД или отложите там задание.`
          : 'Готовых заказов нет. Заказы появятся после создания заявки и перевода поставки в статус «На сборке».',
    );
  }

  async scanFbsTsdBox(taskId: string, payload: Record<string, unknown>, user: AuthUser) {
    const task = await this.loadOwnedFbsTsdAssembly(taskId, user);
    if (task.status === 'COMPLETED') return this.formatFbsTsdAssembly(task, user, 'Заказ уже собран.');
    const boxCode = requiredFbsTsdText(payload.boxCode, 'Отсканируйте номер короба.');
    if (!boxCode.toUpperCase().startsWith('FFL')) {
      throw new BadRequestException('Это не номер короба. Отсканируйте короб с префиксом FFL.');
    }
    if (task.boxId) {
      if (task.boxCode?.toUpperCase() === boxCode.toUpperCase()) {
        return this.formatFbsTsdAssembly(task, user, `Короб ${task.boxCode} уже подтверждён.`);
      }
      throw new BadRequestException(`Сначала закончите работу с коробом ${task.boxCode}.`);
    }

    const box = await this.prisma.box.findFirst({
      where: {
        clientId: task.clientId,
        code: { equals: boxCode, mode: Prisma.QueryMode.insensitive },
        status: { notIn: ['deleted', 'archived'] },
      },
      select: { id: true, code: true },
    });
    if (!box) {
      throw new BadRequestException(`Короба ${boxCode} нет в WMS.`);
    }
    const available = await this.prisma.stockBalance.aggregate({
      where: {
        clientId: task.clientId,
        skuId: task.skuId,
        boxId: box.id,
        status: StockStatus.AVAILABLE,
      },
      _sum: { quantity: true },
    });
    const reserved = await this.prisma.fbsTsdAssembly.aggregate({
      where: {
        id: { not: task.id },
        clientId: task.clientId,
        skuId: task.skuId,
        boxId: box.id,
        status: { in: ['IN_PROGRESS', 'COMPLETED'] },
      },
      _sum: { itemCount: true },
    });
    const freeQuantity = (available._sum.quantity ?? 0) - (reserved._sum.itemCount ?? 0);
    if (freeQuantity < task.itemCount) {
      const switched = await this.switchFbsTsdAssemblyToBox(task, box, user);
      if (switched) return switched;
      throw new BadRequestException(`Короб ${box.code} не нужен для текущей FBS-заявки.`);
    }

    const updated = await this.prisma.fbsTsdAssembly.update({
      where: { id: task.id },
      data: { boxId: box.id, boxCode: box.code, errorMessage: null },
    });
    return this.formatFbsTsdAssembly(updated, user, `Короб ${box.code} принят. Теперь сканируйте ШК товара.`);
  }

  private async switchFbsTsdAssemblyToBox(
    currentTask: FbsTsdAssemblyRecord,
    box: { id: string; code: string },
    user: AuthUser,
  ) {
    const cached = this.fbsOrdersCache.get(currentTask.clientId);
    const response = cached && cached.expiresAt > Date.now()
      ? cached.value
      : await this.loadFbsOrders(currentTask.clientId);
    if (!cached || cached.expiresAt <= Date.now()) {
      this.fbsOrdersCache.set(currentTask.clientId, {
        expiresAt: Date.now() + 30_000,
        value: response,
      });
    }

    const candidates = response.orders
      .filter(
        (order) =>
          order.id !== currentTask.orderId &&
          order.marketplace === currentTask.marketplace &&
          order.connectionId === currentTask.connectionId &&
          order.category === 'active' &&
          order.supplierStatus === 'confirm' &&
          order.request?.id === currentTask.requestId &&
          Boolean(order.product) &&
          order.storageBoxes.some(
            (storageBox) =>
              storageBox.code.toLocaleUpperCase('ru-RU') === box.code.toLocaleUpperCase('ru-RU') &&
              storageBox.status === StockStatus.AVAILABLE &&
              storageBox.quantity > 0,
          ),
      )
      .sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? ''));

    for (const order of candidates) {
      const product = order.product!;
      const [requestItem, existing, available, reserved] = await Promise.all([
        this.prisma.clientRequestItem.findFirst({
          where: { requestId: currentTask.requestId, skuId: product.id },
          select: { id: true },
        }),
        this.prisma.fbsTsdAssembly.findUnique({
          where: {
            marketplace_connectionId_orderId: {
              marketplace: order.marketplace,
              connectionId: order.connectionId,
              orderId: order.id,
            },
          },
        }),
        this.prisma.stockBalance.aggregate({
          where: {
            clientId: currentTask.clientId,
            skuId: product.id,
            boxId: box.id,
            status: StockStatus.AVAILABLE,
          },
          _sum: { quantity: true },
        }),
        this.prisma.fbsTsdAssembly.aggregate({
          where: {
            clientId: currentTask.clientId,
            skuId: product.id,
            boxId: box.id,
            status: { in: ['IN_PROGRESS', 'COMPLETED'] },
          },
          _sum: { itemCount: true },
        }),
      ]);
      if (
        !requestItem ||
        existing?.status === 'COMPLETED' ||
        existing?.status === 'IN_PROGRESS' ||
        (available._sum.quantity ?? 0) - (reserved._sum.itemCount ?? 0) < Math.max(1, order.itemCount)
      ) {
        continue;
      }

      const storageBoxes = order.storageBoxes.filter(
        (storageBox) => storageBox.quantity > 0 && storageBox.status === StockStatus.AVAILABLE,
      );
      const metadata = uniqueStrings([...order.requiredMeta, ...order.optionalMeta]).map((item) =>
        item.toLowerCase(),
      );
      const requiresKiz = metadata.includes('sgtin') || (product.needsChestnyZnak && !product.isUnmarked);
      const taskData = {
        clientId: currentTask.clientId,
        marketplace: order.marketplace,
        connectionId: order.connectionId,
        orderId: order.id,
        supplyId: order.supplyId,
        requestId: currentTask.requestId,
        requestItemId: requestItem.id,
        skuId: product.id,
        productName: product.name,
        article: product.article ?? product.clientSku ?? product.internalSku,
        barcodes: order.barcodes as Prisma.InputJsonValue,
        storageBoxes: storageBoxes as Prisma.InputJsonValue,
        itemCount: Math.max(1, order.itemCount),
        requiresKiz,
        status: 'IN_PROGRESS',
        deviceCode: currentTask.deviceCode,
        workerUserId: user.id,
        workerName: user.name,
        boxId: box.id,
        boxCode: box.code,
        barcode: null,
        kiz: null,
        wbMetaStatus: requiresKiz ? 'PENDING' : 'NOT_REQUIRED',
        errorMessage: null,
        completedAt: null,
      };

      try {
        const switched = await this.prisma.$transaction(async (tx) => {
          const target = await tx.fbsTsdAssembly.findUnique({
            where: {
              marketplace_connectionId_orderId: {
                marketplace: order.marketplace,
                connectionId: order.connectionId,
                orderId: order.id,
              },
            },
          });
          if (target?.status === 'COMPLETED' || target?.status === 'IN_PROGRESS') return null;
          const freshCurrent = await tx.fbsTsdAssembly.findUnique({ where: { id: currentTask.id } });
          if (
            !freshCurrent ||
            freshCurrent.status !== 'IN_PROGRESS' ||
            freshCurrent.boxId ||
            freshCurrent.barcode ||
            freshCurrent.kiz
          ) {
            throw new BadRequestException('Задание на ТСД уже изменилось. Нажмите «Обновить» и повторите сканирование.');
          }
          await tx.fbsTsdAssembly.update({
            where: { id: currentTask.id },
            data: {
              status: 'RELEASED',
              errorMessage: `Сотрудник выбрал короб ${box.code}; задание возвращено в очередь.`,
            },
          });
          return target
            ? tx.fbsTsdAssembly.update({ where: { id: target.id }, data: taskData })
            : tx.fbsTsdAssembly.create({ data: taskData });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        if (!switched) continue;
        return this.formatFbsTsdAssembly(
          switched,
          user,
          `Короб ${box.code} нужен заявке. Переключено на заказ №${order.id}. Теперь сканируйте ШК товара.`,
        );
      } catch (caught) {
        if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2002') continue;
        throw caught;
      }
    }

    return null;
  }

  async scanFbsTsdBarcode(taskId: string, payload: Record<string, unknown>, user: AuthUser) {
    const task = await this.loadOwnedFbsTsdAssembly(taskId, user);
    if (!task.boxId) throw new BadRequestException('Сначала отсканируйте короб, указанный на экране.');
    if (task.barcode) return this.formatFbsTsdAssembly(task, user, 'Товар уже подтверждён.');
    const barcode = requiredFbsTsdText(payload.barcode, 'Отсканируйте ШК товара.');
    if (barcode.toUpperCase().startsWith('FFL')) {
      throw new BadRequestException('Сейчас нужен ШК товара, а не номер короба.');
    }
    if (barcode.length > 13) {
      throw new BadRequestException('Сейчас нужен ШК товара. КИЗ будет запрошен следующим шагом.');
    }
    const allowedBarcodes = jsonStringArray(task.barcodes);
    if (!allowedBarcodes.some((value) => value.toLowerCase() === barcode.toLowerCase())) {
      throw new BadRequestException(
        `Неверный товар. Нужен «${task.productName}», арт. ${task.article ?? 'не указан'}. Верните товар и отсканируйте правильный ШК.`,
      );
    }
    const updated = await this.prisma.fbsTsdAssembly.update({
      where: { id: task.id },
      data: { barcode, errorMessage: null },
    });
    return this.formatFbsTsdAssembly(
      updated,
      user,
      task.requiresKiz ? 'Товар верный. Теперь отсканируйте КИЗ.' : 'Товар верный. Подтвердите сборку.',
    );
  }

  async scanFbsTsdKiz(taskId: string, payload: Record<string, unknown>, user: AuthUser) {
    const task = await this.loadOwnedFbsTsdAssembly(taskId, user);
    if (!task.requiresKiz) throw new BadRequestException('Для этого товара КИЗ не требуется.');
    if (!task.boxId || !task.barcode) {
      throw new BadRequestException('Сначала подтвердите короб и ШК товара.');
    }
    if (task.kiz && task.wbMetaStatus === 'ACCEPTED') {
      return this.formatFbsTsdAssembly(task, user, 'КИЗ уже принят Wildberries.');
    }
    const kiz = requiredFbsTsdText(payload.kiz, 'Отсканируйте КИЗ товара.');
    const confirmBoxMove = payload.confirmBoxMove === true;
    if (task.kiz && task.wbMetaStatus === 'PENDING' && task.kiz.toLowerCase() !== kiz.toLowerCase()) {
      throw new BadRequestException(
        'Для этого заказа уже сохранён другой КИЗ и ожидается подтверждение Wildberries. Повторно отсканируйте тот же товар.',
      );
    }
    if (kiz.length < 16 || kiz.length > 135) {
      throw new BadRequestException('Отсканирован не КИЗ. Нужен код Data Matrix длиной от 16 до 135 символов.');
    }
    if (jsonStringArray(task.barcodes).some((barcode) => barcode === kiz)) {
      throw new BadRequestException('Отсканирован ШК товара. Сейчас нужен КИЗ Data Matrix.');
    }

    const mark = await this.prisma.productMark.findFirst({
      where: {
        value: { equals: kiz, mode: Prisma.QueryMode.insensitive },
      },
      select: {
        id: true,
        clientId: true,
        skuId: true,
        boxId: true,
        status: true,
        box: { select: { code: true } },
        sku: { select: { name: true } },
      },
    });
    if (mark && mark.clientId !== task.clientId) {
      throw new BadRequestException('Этот КИЗ уже зарегистрирован в WMS у другого клиента. Передайте товар менеджеру.');
    }
    if (mark && mark.skuId !== task.skuId) {
      throw new BadRequestException(`Этот КИЗ относится к другому товару: ${mark.sku.name}.`);
    }
    if (mark && mark.status !== StockStatus.AVAILABLE) {
      throw new BadRequestException('Этот КИЗ уже находится в сборке или был отгружен. Возьмите другую единицу.');
    }
    const duplicate = await this.prisma.fbsTsdAssembly.findFirst({
      where: {
        id: { not: task.id },
        kiz: { equals: kiz, mode: Prisma.QueryMode.insensitive },
        status: { not: 'RELEASED' },
      },
      select: { orderId: true },
    });
    if (duplicate) {
      throw new BadRequestException(`Этот КИЗ уже привязан к FBS-заказу ${duplicate.orderId}. Возьмите другую единицу.`);
    }

    const markNeedsBoxMove = Boolean(mark && mark.boxId !== task.boxId);
    if (mark && markNeedsBoxMove && !confirmBoxMove) {
      const fromBoxCode = mark.box?.code ?? 'без номера';
      const toBoxCode = task.boxCode ?? 'открытый короб';
      const formatted = await this.formatFbsTsdAssembly(
        task,
        user,
        `КИЗ числится в коробе ${fromBoxCode}, а товар взят из ${toBoxCode}. Подтвердите перенос одной единицы.`,
      );
      return {
        ...formatted,
        state: 'CONFIRM_KIZ_MOVE',
        kizMoveProposal: {
          kiz,
          fromBoxCode,
          toBoxCode,
          productName: task.productName,
          article: task.article,
        },
      };
    }
    if (mark && markNeedsBoxMove) {
      await this.inventoryLock?.assertStockMovementsAllowed();
    }

    let registeredHistoricalMarkId: string | null = null;
    if (!mark) {
      try {
        registeredHistoricalMarkId = await this.prisma.$transaction(async (tx) => {
          const [available, registeredMarks] = await Promise.all([
            tx.stockBalance.aggregate({
              where: {
                clientId: task.clientId,
                skuId: task.skuId,
                boxId: task.boxId,
                status: StockStatus.AVAILABLE,
              },
              _sum: { quantity: true },
            }),
            tx.productMark.count({
              where: {
                clientId: task.clientId,
                skuId: task.skuId,
                boxId: task.boxId,
                status: StockStatus.AVAILABLE,
              },
            }),
          ]);
          if ((available._sum.quantity ?? 0) <= registeredMarks) {
            throw new BadRequestException(
              `В коробе ${task.boxCode} нет свободной единицы этого товара без зарегистрированного КИЗа. Передайте короб менеджеру для сверки.`,
            );
          }

          const created = await tx.productMark.create({
            data: {
              clientId: task.clientId,
              skuId: task.skuId,
              boxId: task.boxId,
              value: kiz,
              sourceDocument: `FBS TSD, заказ ${task.orderId}: КИЗ восстановлен по фактическому товару`,
              status: StockStatus.AVAILABLE,
            },
            select: { id: true },
          });
          await tx.fbsTsdAssembly.update({
            where: { id: task.id },
            data: { kiz, wbMetaStatus: 'PENDING', errorMessage: null },
          });
          return created.id;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (caught) {
        if (isUniqueError(caught)) {
          throw new BadRequestException('Этот КИЗ уже успели зарегистрировать в WMS. Обновите задание и проверьте товар.');
        }
        throw caught;
      }
    }

    const connection = await this.prisma.clientMarketplaceConnection.findFirst({
      where: {
        id: task.connectionId,
        clientId: task.clientId,
        marketplace: MarketplaceType.WILDBERRIES,
        isActive: true,
      },
      select: { apiKey: true },
    });
    if (!connection) throw new BadRequestException('Подключение Wildberries отключено. Обратитесь к администратору.');

    try {
      await marketplaceJson(
        `https://marketplace-api.wildberries.ru/api/v3/orders/${numericWbOrderId(task.orderId)}/meta/sgtin`,
        {
          method: 'PUT',
          headers: wbHeaders(connection.apiKey),
          body: JSON.stringify({ sgtins: [kiz] }),
        },
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Wildberries не принял КИЗ.';
      if (registeredHistoricalMarkId) {
        await this.prisma.$transaction(async (tx) => {
          await tx.productMark.deleteMany({
            where: { id: registeredHistoricalMarkId!, clientId: task.clientId, value: kiz },
          });
          await tx.fbsTsdAssembly.updateMany({
            where: { id: task.id, kiz, wbMetaStatus: 'PENDING' },
            data: { kiz: null, wbMetaStatus: 'REJECTED', errorMessage: message },
          });
        });
      } else {
        await this.prisma.fbsTsdAssembly.update({
          where: { id: task.id },
          data: { wbMetaStatus: 'REJECTED', errorMessage: message },
        });
      }
      throw new BadRequestException(`Wildberries не принял КИЗ: ${message}`);
    }

    const boxCorrection = mark && markNeedsBoxMove
      ? await this.moveExistingFbsKizToOpenedBox(task, mark.id, mark.boxId, kiz, user)
      : null;
    const updated = boxCorrection?.task ?? await this.prisma.fbsTsdAssembly.update({
          where: { id: task.id },
          data: { kiz, wbMetaStatus: 'ACCEPTED', errorMessage: null },
        });
    return this.formatFbsTsdAssembly(
      updated,
      user,
      boxCorrection?.mode === 'RELINKED'
        ? `КИЗ принят Wildberries и перепривязан к фактической единице в коробе ${task.boxCode}. Количество товара не изменялось. Подтвердите сборку заказа.`
        : boxCorrection
        ? `КИЗ принят Wildberries. Товар перемещён из короба ${mark?.box?.code ?? 'без номера'} в ${task.boxCode}. Подтвердите сборку заказа.`
        : registeredHistoricalMarkId
        ? 'КИЗ принят Wildberries и зарегистрирован в остатках WMS. Подтвердите сборку заказа.'
        : 'КИЗ принят Wildberries. Подтвердите сборку заказа.',
    );
  }

  private async moveExistingFbsKizToOpenedBox(
    task: FbsTsdAssemblyRecord,
    markId: string,
    expectedSourceBoxId: string | null,
    kiz: string,
    user: AuthUser,
  ) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    return this.prisma.$transaction(async (tx) => {
      const [freshTask, freshMark] = await Promise.all([
        tx.fbsTsdAssembly.findUnique({ where: { id: task.id } }),
        tx.productMark.findUnique({
          where: { id: markId },
          include: { box: { select: { id: true, code: true, palletId: true } } },
        }),
      ]);
      if (!freshTask?.boxId || !freshTask.boxCode) {
        throw new BadRequestException('Открытый короб изменился. Обновите задание и повторите сканирование.');
      }
      if (freshTask.boxId !== task.boxId) {
        throw new BadRequestException('Открытый короб изменился после подтверждения. Обновите задание и повторите сканирование.');
      }
      if (!freshMark || freshMark.clientId !== freshTask.clientId || freshMark.skuId !== freshTask.skuId) {
        throw new BadRequestException('Данные КИЗа изменились. Обновите задание и повторите сканирование.');
      }
      if (freshMark.status !== StockStatus.AVAILABLE) {
        throw new BadRequestException('Этот КИЗ уже находится в сборке или был отгружен. Возьмите другую единицу.');
      }
      if (freshMark.boxId !== expectedSourceBoxId && freshMark.boxId !== freshTask.boxId) {
        throw new BadRequestException('Короб КИЗа изменился после подтверждения. Обновите задание и повторите сканирование.');
      }
      if (freshMark.boxId === freshTask.boxId) {
        const updatedTask = await tx.fbsTsdAssembly.update({
          where: { id: freshTask.id },
          data: { kiz, wbMetaStatus: 'ACCEPTED', errorMessage: null },
        });
        return { task: updatedTask, mode: 'ALREADY_IN_TARGET' as const };
      }
      if (!freshMark.boxId || !freshMark.box) {
        throw new BadRequestException('У КИЗа не указан исходный короб. Передайте товар менеджеру.');
      }

      const targetBox = await tx.box.findUnique({
        where: { id: freshTask.boxId },
        select: { id: true, code: true, palletId: true, status: true },
      });
      if (!targetBox || ['deleted', 'archived'].includes(targetBox.status)) {
        throw new BadRequestException(`Короб ${freshTask.boxCode} больше недоступен. Обновите задание.`);
      }
      const sourceBalance = await tx.stockBalance.findFirst({
        where: {
          clientId: freshTask.clientId,
          skuId: freshTask.skuId,
          boxId: freshMark.boxId,
          status: StockStatus.AVAILABLE,
        },
      });
      if (!sourceBalance || sourceBalance.quantity < 1) {
        const [targetBalance, targetMarks] = await Promise.all([
          tx.stockBalance.findFirst({
            where: {
              clientId: freshTask.clientId,
              skuId: freshTask.skuId,
              boxId: targetBox.id,
              status: StockStatus.AVAILABLE,
            },
          }),
          tx.productMark.count({
            where: {
              clientId: freshTask.clientId,
              skuId: freshTask.skuId,
              boxId: targetBox.id,
              status: StockStatus.AVAILABLE,
            },
          }),
        ]);
        if (!targetBalance || targetBalance.quantity <= targetMarks) {
          throw new BadRequestException(
            `В открытом коробе ${targetBox.code} нет свободной единицы этого товара без КИЗа. Передайте товар менеджеру.`,
          );
        }
        await tx.productMark.update({
          where: { id: freshMark.id },
          data: {
            boxId: targetBox.id,
            stockMovementId: null,
            sourceDocument: `FBS TSD, заказ ${freshTask.orderId}: КИЗ перепривязан к фактическому коробу без изменения количества`,
          },
        });
        await tx.clientRequestEvent.create({
          data: {
            requestId: freshTask.requestId,
            clientId: freshTask.clientId,
            eventType: ClientRequestEventType.COMMENT,
            title: 'КИЗ перепривязан при сборке FBS',
            body: `Заказ ${freshTask.orderId}; КИЗ ${printableFbsKiz(kiz)}; запись перенесена ${freshMark.box.code} → ${targetBox.code} без изменения количества; сотрудник ${freshTask.workerName ?? freshTask.deviceCode}.`,
            createdByUserId: user.id,
          },
        });
        const updatedTask = await tx.fbsTsdAssembly.update({
          where: { id: freshTask.id },
          data: { kiz, wbMetaStatus: 'ACCEPTED', errorMessage: null },
        });
        const [remainingBalances, remainingMarks] = await Promise.all([
          tx.stockBalance.count({ where: { boxId: freshMark.boxId, quantity: { gt: 0 } } }),
          tx.productMark.count({ where: { boxId: freshMark.boxId } }),
        ]);
        if (remainingBalances === 0 && remainingMarks === 0) {
          await tx.box.update({ where: { id: freshMark.boxId }, data: { status: 'archived' } });
        }
        return { task: updatedTask, mode: 'RELINKED' as const };
      }

      if (sourceBalance.quantity === 1) {
        await tx.stockBalance.delete({ where: { id: sourceBalance.id } });
      } else {
        await tx.stockBalance.update({
          where: { id: sourceBalance.id },
          data: { quantity: { decrement: 1 } },
        });
      }
      const targetBalanceKey = fbsStockBalanceKey({
        clientId: freshTask.clientId,
        skuId: freshTask.skuId,
        boxId: targetBox.id,
        palletId: targetBox.palletId,
        status: StockStatus.AVAILABLE,
      });
      await tx.stockBalance.upsert({
        where: { balanceKey: targetBalanceKey },
        update: { quantity: { increment: 1 } },
        create: {
          balanceKey: targetBalanceKey,
          clientId: freshTask.clientId,
          skuId: freshTask.skuId,
          boxId: targetBox.id,
          palletId: targetBox.palletId,
          status: StockStatus.AVAILABLE,
          quantity: 1,
        },
      });
      const movementKey = `fbs-kiz-move:${freshTask.id}:${freshMark.id}`;
      await tx.stockMovement.create({
        data: {
          clientId: freshTask.clientId,
          skuId: freshTask.skuId,
          boxId: freshMark.boxId,
          palletId: freshMark.box.palletId,
          type: MovementType.MOVE,
          status: StockStatus.AVAILABLE,
          quantity: -1,
          sourceDocument: `FBS TSD, заказ ${freshTask.orderId}`,
          idempotencyKey: `${movementKey}:out`,
          comment: `КИЗ перемещён в короб ${targetBox.code} при сборке FBS`,
        },
      });
      const inboundMovement = await tx.stockMovement.create({
        data: {
          clientId: freshTask.clientId,
          skuId: freshTask.skuId,
          boxId: targetBox.id,
          palletId: targetBox.palletId,
          type: MovementType.MOVE,
          status: StockStatus.AVAILABLE,
          quantity: 1,
          sourceDocument: `FBS TSD, заказ ${freshTask.orderId}`,
          idempotencyKey: `${movementKey}:in`,
          comment: `КИЗ перемещён из короба ${freshMark.box.code} при сборке FBS`,
        },
      });
      await tx.productMark.update({
        where: { id: freshMark.id },
        data: { boxId: targetBox.id, stockMovementId: inboundMovement.id },
      });
      await tx.clientRequestEvent.create({
        data: {
          requestId: freshTask.requestId,
          clientId: freshTask.clientId,
          eventType: ClientRequestEventType.COMMENT,
          title: 'КИЗ перемещён при сборке FBS',
          body: `Заказ ${freshTask.orderId}; КИЗ ${printableFbsKiz(kiz)}; ${freshMark.box.code} → ${targetBox.code}; сотрудник ${freshTask.workerName ?? freshTask.deviceCode}.`,
          createdByUserId: user.id,
        },
      });
      const updatedTask = await tx.fbsTsdAssembly.update({
        where: { id: freshTask.id },
        data: { kiz, wbMetaStatus: 'ACCEPTED', errorMessage: null },
      });
      const [remainingBalances, remainingMarks] = await Promise.all([
        tx.stockBalance.count({ where: { boxId: freshMark.boxId, quantity: { gt: 0 } } }),
        tx.productMark.count({ where: { boxId: freshMark.boxId } }),
      ]);
      if (remainingBalances === 0 && remainingMarks === 0) {
        await tx.box.update({ where: { id: freshMark.boxId }, data: { status: 'archived' } });
      }
      return { task: updatedTask, mode: 'MOVED' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async completeFbsTsdAssembly(taskId: string, user: AuthUser) {
    const task = await this.loadOwnedFbsTsdAssembly(taskId, user);
    if (task.status === 'COMPLETED') return this.formatFbsTsdAssembly(task, user, 'Заказ уже собран.');
    if (!task.boxId || !task.barcode) throw new BadRequestException('Сначала подтвердите короб и товар.');
    if (task.requiresKiz && (!task.kiz || task.wbMetaStatus !== 'ACCEPTED')) {
      throw new BadRequestException('Сначала отсканируйте КИЗ и дождитесь подтверждения Wildberries.');
    }

    const completed = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.fbsTsdAssembly.findUnique({ where: { id: task.id } });
      if (!fresh) throw new NotFoundException('Задание FBS не найдено.');
      if (fresh.status === 'COMPLETED') return fresh;
      const request = await tx.clientRequest.findUnique({
        where: { id: fresh.requestId },
        select: { id: true, status: true, title: true },
      });
      if (!request || ['DONE', 'CANCELLED', 'REJECTED'].includes(request.status)) {
        throw new BadRequestException('Заявка FBS уже закрыта или отменена. Обновите очередь.');
      }
      const requestItem = await tx.clientRequestItem.findUnique({
        where: { id: fresh.requestItemId },
        select: { id: true, quantity: true, skuId: true },
      });
      if (!requestItem || requestItem.skuId !== fresh.skuId) {
        throw new BadRequestException('Товар больше не найден в заявке FBS. Обратитесь к администратору.');
      }
      const selected = await tx.clientRequestBoxSelection.aggregate({
        where: { requestItemId: requestItem.id },
        _sum: { quantity: true },
      });
      if ((selected._sum.quantity ?? 0) + fresh.itemCount > requestItem.quantity) {
        throw new BadRequestException('Нужное количество по этой позиции уже собрано. Обновите очередь.');
      }

      await tx.clientRequestBoxSelection.upsert({
        where: { requestItemId_boxId: { requestItemId: requestItem.id, boxId: fresh.boxId! } },
        create: {
          requestItemId: requestItem.id,
          skuId: fresh.skuId,
          boxId: fresh.boxId!,
          quantity: fresh.itemCount,
        },
        update: { quantity: { increment: fresh.itemCount } },
      });
      await tx.clientRequestEvent.create({
        data: {
          requestId: request.id,
          clientId: fresh.clientId,
          eventType: ClientRequestEventType.COMMENT,
          title: 'FBS-заказ собран на ТСД',
          body: `Заказ ${fresh.orderId}; короб ${fresh.boxCode}; сотрудник ${fresh.workerName ?? fresh.deviceCode}${fresh.kiz ? `; КИЗ ${printableFbsKiz(fresh.kiz)}` : ''}${fresh.stickerPartB ? `; наклейка WB ${fresh.stickerPartB}` : ''}.`,
          createdByUserId: user.id,
        },
      });
      return tx.fbsTsdAssembly.update({
        where: { id: fresh.id },
        data: { status: 'COMPLETED', completedAt: new Date(), errorMessage: null },
      });
    });
    return this.formatFbsTsdAssembly(completed, user, 'Готово. Заказ собран и записан в заявку.');
  }

  async releaseFbsTsdAssembly(taskId: string, user: AuthUser) {
    const task = await this.loadOwnedFbsTsdAssembly(taskId, user);
    if (task.status === 'COMPLETED') throw new BadRequestException('Собранный заказ нельзя отложить.');
    if (task.kiz || task.wbMetaStatus === 'ACCEPTED') {
      throw new BadRequestException('КИЗ уже передан Wildberries. Для замены обратитесь к администратору.');
    }
    await this.prisma.fbsTsdAssembly.update({
      where: { id: task.id },
      data: {
        status: 'RELEASED',
        boxId: null,
        boxCode: null,
        barcode: null,
        errorMessage: 'Сотрудник отложил заказ на ТСД.',
      },
    });
    return this.emptyFbsTsdAssembly(task.deviceCode, user, 'Заказ отложен. Можно взять следующий.');
  }

  private async loadOwnedFbsTsdAssembly(taskId: string, user: AuthUser) {
    const task = await this.prisma.fbsTsdAssembly.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Задание FBS не найдено. Обновите очередь.');
    this.clientScopes.requireClientAccess(user, task.clientId, 'write');
    const deviceCode = this.fbsTsdDeviceCode(undefined, user);
    if (task.deviceCode !== deviceCode) {
      throw new BadRequestException('Этот заказ уже назначен другому сотруднику.');
    }
    return task;
  }

  private fbsTsdDeviceCode(deviceCodeValue: unknown, user: AuthUser) {
    return user.deviceCode || textValue(deviceCodeValue) || `USER:${user.id}`;
  }

  private async emptyFbsTsdAssembly(deviceCode: string, user: AuthUser, message: string) {
    const [completedToday, recentStickers] = await Promise.all([
      this.fbsTsdCompletedToday(deviceCode, user),
      this.fbsTsdStickerHistory(deviceCode, user),
    ]);
    return {
      state: 'EMPTY',
      message,
      task: null,
      progress: { completedToday, recentStickers },
    };
  }

  private async formatFbsTsdAssembly(task: FbsTsdAssemblyRecord, user: AuthUser, message: string) {
    const state = fbsTsdStage(task);
    const [client, skuDetails, balances, reservations, completedToday, requestSummary, orderSticker, recentStickers] = await Promise.all([
      this.prisma.client.findUnique({
        where: { id: task.clientId },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.sku.findUnique({
        where: { id: task.skuId },
        select: { color: true, size: true },
      }),
      this.prisma.stockBalance.findMany({
        where: {
          clientId: task.clientId,
          skuId: task.skuId,
          status: StockStatus.AVAILABLE,
          quantity: { gt: 0 },
          boxId: { not: null },
          box: { status: { notIn: ['deleted', 'archived'] } },
        },
        select: { boxId: true, quantity: true, box: { select: { code: true } } },
      }),
      this.prisma.fbsTsdAssembly.findMany({
        where: {
          id: { not: task.id },
          clientId: task.clientId,
          skuId: task.skuId,
          boxId: { not: null },
          status: { in: ['IN_PROGRESS', 'COMPLETED'] },
        },
        select: { boxId: true, itemCount: true },
      }),
      this.fbsTsdCompletedToday(task.deviceCode, user),
      this.prisma.clientRequest.findUnique({
        where: { id: task.requestId },
        select: {
          number: true,
          items: {
            select: {
              quantity: true,
              boxSelections: { select: { quantity: true } },
            },
          },
        },
      }),
      state === 'READY_TO_COMPLETE' ? this.loadFbsTsdOrderSticker(task) : Promise.resolve(null),
      this.fbsTsdStickerHistory(task.deviceCode, user),
    ]);
    const reservedByBox = new Map<string, number>();
    reservations.forEach((reservation) => {
      if (!reservation.boxId) return;
      reservedByBox.set(
        reservation.boxId,
        (reservedByBox.get(reservation.boxId) ?? 0) + reservation.itemCount,
      );
    });
    const boxesById = new Map<string, { id: string; code: string; quantity: number }>();
    balances.forEach((balance) => {
      if (!balance.boxId || !balance.box) return;
      const current = boxesById.get(balance.boxId) ?? {
        id: balance.boxId,
        code: balance.box.code,
        quantity: 0,
      };
      current.quantity += balance.quantity;
      boxesById.set(balance.boxId, current);
    });
    const storageBoxes = [...boxesById.values()]
      .map((box) => ({ ...box, quantity: box.quantity - (reservedByBox.get(box.id) ?? 0) }))
      .filter((box) => box.quantity >= task.itemCount || box.id === task.boxId)
      .sort((left, right) => left.quantity - right.quantity || left.code.localeCompare(right.code, 'ru-RU'));
    const recommendedBoxCode = task.boxCode ?? storageBoxes[0]?.code ?? null;
    const requestTotalItems = requestSummary?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
    const requestCompletedItems = requestSummary?.items.reduce(
      (sum, item) => sum + item.boxSelections.reduce((itemSum, selection) => itemSum + selection.quantity, 0),
      0,
    ) ?? 0;
    return {
      state,
      message,
      task: {
        id: task.id,
        orderId: task.orderId,
        supplyId: task.supplyId,
        requestId: task.requestId,
        client: client ?? { id: task.clientId, code: '', name: task.clientId },
        product: {
          id: task.skuId,
          name: task.productName,
          article: task.article,
          color: skuDetails?.color ?? null,
          size: skuDetails?.size ?? null,
          barcodes: jsonStringArray(task.barcodes),
        },
        itemCount: task.itemCount,
        requiresKiz: task.requiresKiz,
        recommendedBoxCode,
        storageBoxes,
        scannedBoxCode: task.boxCode,
        scannedBarcode: task.barcode,
        kizAccepted: Boolean(task.kiz && task.wbMetaStatus === 'ACCEPTED'),
        wbMetaStatus: task.wbMetaStatus,
        orderSticker,
        errorMessage: task.errorMessage,
        status: task.status,
      },
      progress: {
        completedToday,
        requestNumber: requestSummary?.number ?? null,
        requestTotalItems,
        requestCompletedItems,
        requestRemainingItems: Math.max(0, requestTotalItems - requestCompletedItems),
        recentStickers,
      },
    };
  }

  private async loadFbsTsdOrderSticker(task: FbsTsdAssemblyRecord) {
    const cacheKey = `${task.connectionId}:${task.orderId}`;
    const cached = this.fbsTsdStickerCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      await this.persistFbsTsdOrderSticker(task.id, cached.value);
      return cached.value;
    }

    const connection = await this.prisma.clientMarketplaceConnection.findFirst({
      where: {
        id: task.connectionId,
        clientId: task.clientId,
        marketplace: MarketplaceType.WILDBERRIES,
        isActive: true,
      },
      select: { apiKey: true },
    });
    if (!connection) return null;

    try {
      const response = await marketplaceJson(
        'https://marketplace-api.wildberries.ru/api/v3/orders/stickers?type=png&width=58&height=40',
        {
          method: 'POST',
          headers: wbHeaders(connection.apiKey),
          body: JSON.stringify({ orders: [numericWbOrderId(task.orderId)] }),
        },
      );
      const sticker = asArray<Record<string, unknown>>(response.stickers).find(
        (item) => textValue(item.orderId) === task.orderId,
      );
      const imageBase64 = textValue(sticker?.file);
      if (!sticker || !imageBase64) return null;
      const value = {
        partA: textValue(sticker.partA),
        partB: textValue(sticker.partB),
        barcode: textValue(sticker.barcode),
        imageBase64,
      };
      this.fbsTsdStickerCache.set(cacheKey, {
        expiresAt: Date.now() + 30 * 60 * 1_000,
        value,
      });
      await this.persistFbsTsdOrderSticker(task.id, value);
      return value;
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : 'неизвестная ошибка';
      this.logger.warn(`WB sticker is temporarily unavailable for FBS TSD order ${task.orderId}: ${reason}`);
      return null;
    }
  }

  private async persistFbsTsdOrderSticker(
    taskId: string,
    sticker: { partA: string; partB: string; barcode: string },
  ) {
    await this.prisma.fbsTsdAssembly.updateMany({
      where: { id: taskId },
      data: {
        stickerPartA: sticker.partA || null,
        stickerPartB: sticker.partB || null,
        stickerBarcode: sticker.barcode || null,
      },
    });
  }

  private async fbsTsdStickerHistory(deviceCode: string, user: AuthUser) {
    const clientFilter = this.clientScopes.resolveClientFilter(user);
    const rows = await this.prisma.fbsTsdAssembly.findMany({
      where: {
        deviceCode,
        clientId: clientFilter,
        status: 'COMPLETED',
        OR: [
          { stickerPartB: { not: null } },
          { stickerBarcode: { not: null } },
        ],
      },
      select: {
        orderId: true,
        requestId: true,
        productName: true,
        article: true,
        boxCode: true,
        stickerPartA: true,
        stickerPartB: true,
        stickerBarcode: true,
        completedAt: true,
      },
      orderBy: { completedAt: 'desc' },
      take: 50,
    });
    const requestIds = uniqueStrings(rows.map((row) => row.requestId));
    const requests = requestIds.length > 0
      ? await this.prisma.clientRequest.findMany({
          where: { id: { in: requestIds } },
          select: { id: true, number: true },
        })
      : [];
    const requestNumberById = new Map(requests.map((request) => [request.id, request.number]));
    return rows.map((row) => ({
      orderId: row.orderId,
      requestNumber: requestNumberById.get(row.requestId) ?? null,
      productName: row.productName,
      article: row.article,
      boxCode: row.boxCode,
      partA: row.stickerPartA,
      partB: row.stickerPartB,
      barcode: row.stickerBarcode,
      completedAt: row.completedAt?.toISOString() ?? null,
    }));
  }

  private async fbsTsdCompletedToday(deviceCode: string, user: AuthUser) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const clientFilter = this.clientScopes.resolveClientFilter(user);
    return this.prisma.fbsTsdAssembly.count({
      where: {
        deviceCode,
        status: 'COMPLETED',
        completedAt: { gte: today },
        clientId: clientFilter,
      },
    });
  }

  async assembleFbsOrders(dto: FbsOrderSelectionDto, user: AuthUser) {
    return this.moveFbsOrdersToSupply(dto, user, 'assemble');
  }

  async reshipFbsOrders(dto: FbsOrderSelectionDto, user: AuthUser) {
    return this.moveFbsOrdersToSupply(dto, user, 'reship');
  }

  private async moveFbsOrdersToSupply(
    dto: FbsOrderSelectionDto,
    user: AuthUser,
    mode: 'assemble' | 'reship',
  ) {
    const clientId = dto.clientId.trim();
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    const { response, orders } = await this.resolveSelectedFbsOrders(clientId, dto.orders);
    const defaultDeliveryPlan = await this.loadFbsDeliveryPlan(clientId);
    const destination = dto.deliveryDestination ?? defaultDeliveryPlan.destination;
    const deliveryPlan: FbsOrdersResponse['deliveryPlan'] = {
      destination,
      itemsPerCargoPlace: DEFAULT_FBS_ITEMS_PER_CARGO_PLACE,
      requiresCargoPlaces: destination === FbsDeliveryDestination.PICKUP_POINT,
    };

    const unsupported = orders.filter((order) => order.marketplace !== MarketplaceType.WILDBERRIES);
    if (unsupported.length > 0) {
      throw new BadRequestException('Массовая сборка сейчас доступна только для заказов Wildberries.');
    }
    const unavailable = orders.filter((order) =>
      mode === 'assemble' ? order.supplierStatus !== 'new' : !order.requiresReshipment,
    );
    if (unavailable.length > 0) {
      throw new BadRequestException(
        mode === 'assemble'
          ? `В сборку можно перевести только новые заказы. Проверьте: ${unavailable.map((order) => order.id).join(', ')}.`
          : `Повторная отгрузка доступна только для заказов, которые WB вернул в переотгрузку. Проверьте: ${unavailable.map((order) => order.id).join(', ')}.`,
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
      await this.prisma.fbsSupplyPlan.upsert({
        where: {
          marketplace_connectionId_supplyId: {
            marketplace: MarketplaceType.WILDBERRIES,
            connectionId: connection.id,
            supplyId,
          },
        },
        create: {
          clientId,
          marketplace: MarketplaceType.WILDBERRIES,
          connectionId: connection.id,
          supplyId,
          deliveryDestination: destination,
          itemsPerCargoPlace: deliveryPlan.itemsPerCargoPlace,
          cargoPlaceCount: 0,
          cargoPlaceIds: [],
          orderIds: group.map((order) => order.id),
          createdByUserId: user.id,
        },
        update: {
          deliveryDestination: destination,
          itemsPerCargoPlace: deliveryPlan.itemsPerCargoPlace,
          orderIds: group.map((order) => order.id),
        },
      });
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
          await this.prisma.fbsSupplyPlan.update({
            where: {
              marketplace_connectionId_supplyId: {
                marketplace: MarketplaceType.WILDBERRIES,
                connectionId: connection.id,
                supplyId,
              },
            },
            data: {
              cargoPlaceCount: cargoPlaceIds.length,
              cargoPlaceIds,
            },
          });
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
      reshipped: mode === 'reship' ? orders.length : 0,
      deliveryPlan,
      supplies,
      orders: refreshedOrders,
    };
  }

  async cancelFbsOrders(dto: FbsOrderSelectionDto, user: AuthUser) {
    const clientId = dto.clientId.trim();
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    const { orders } = await this.resolveSelectedFbsOrders(clientId, dto.orders);
    const unavailable = orders.filter(
      (order) =>
        order.marketplace !== MarketplaceType.WILDBERRIES ||
        !['new', 'confirm'].includes(order.supplierStatus),
    );
    if (unavailable.length > 0) {
      throw new BadRequestException(
        `Отменить можно только новые или находящиеся на сборке заказы WB. Проверьте: ${unavailable.map((order) => order.id).join(', ')}.`,
      );
    }

    const connections = await this.loadSelectedConnections(clientId, orders);
    const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
    const cancelled: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    const batches = chunks(orders, 20);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      await Promise.all(
        batches[batchIndex].map(async (order) => {
          const connection = connectionById.get(order.connectionId);
          if (!connection) return;
          try {
            await marketplaceJson(
              `https://marketplace-api.wildberries.ru/api/v3/orders/${numericWbOrderId(order.id)}/cancel`,
              { method: 'PATCH', headers: wbHeaders(connection.apiKey) },
            );
            cancelled.push(order.id);
          } catch (caught) {
            failed.push({
              id: order.id,
              message: caught instanceof Error ? caught.message : 'Wildberries не отменил заказ.',
            });
          }
        }),
      );
      if (batchIndex < batches.length - 1) await delay(12_000);
    }

    const refreshedOrders = await this.refreshFbsOrdersCache(clientId);
    return { cancelled: cancelled.length, failed, orders: refreshedOrders };
  }

  async deliverFbsSupplies(dto: FbsOrderSelectionDto, user: AuthUser) {
    const clientId = dto.clientId.trim();
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    const { orders } = await this.resolveSelectedFbsOrders(clientId, dto.orders);
    const unavailable = orders.filter(
      (order) =>
        order.marketplace !== MarketplaceType.WILDBERRIES ||
        order.supplierStatus !== 'confirm' ||
        !order.supplyId,
    );
    if (unavailable.length > 0) {
      throw new BadRequestException(
        `Передать в доставку можно только поставки WB со статусом «На сборке». Проверьте: ${unavailable.map((order) => order.id).join(', ')}.`,
      );
    }

    const connections = await this.loadSelectedConnections(clientId, orders);
    const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
    const supplies = new Map<string, { connectionId: string; supplyId: string }>();
    orders.forEach((order) => {
      supplies.set(`${order.connectionId}:${order.supplyId}`, {
        connectionId: order.connectionId,
        supplyId: order.supplyId!,
      });
    });
    const delivered: string[] = [];
    const failed: Array<{ supplyId: string; message: string }> = [];
    await Promise.all(
      [...supplies.values()].map(async (supply) => {
        const connection = connectionById.get(supply.connectionId);
        if (!connection) return;
        try {
          await marketplaceJson(
            `https://marketplace-api.wildberries.ru/api/v3/supplies/${encodeURIComponent(supply.supplyId)}/deliver`,
            { method: 'PATCH', headers: wbHeaders(connection.apiKey) },
          );
          delivered.push(supply.supplyId);
        } catch (caught) {
          failed.push({
            supplyId: supply.supplyId,
            message: caught instanceof Error ? caught.message : 'Wildberries не принял поставку в доставку.',
          });
        }
      }),
    );

    const refreshedOrders = await this.refreshFbsOrdersCache(clientId);
    return { delivered: delivered.length, failed, orders: refreshedOrders };
  }

  async listFbsPasses(clientId: string, connectionId: string | undefined, user: AuthUser) {
    const normalizedClientId = clientId?.trim();
    if (!normalizedClientId) throw new BadRequestException('Выберите клиента.');
    this.clientScopes.requireClientAccess(user, normalizedClientId, 'read');
    const connections = await this.prisma.clientMarketplaceConnection.findMany({
      where: { clientId: normalizedClientId, marketplace: MarketplaceType.WILDBERRIES, isActive: true },
      orderBy: [{ accountName: 'asc' }, { createdAt: 'asc' }],
      include: { client: { select: { id: true, code: true, name: true } } },
    });
    const selected = connections.find((connection) => connection.id === connectionId) ?? connections[0];
    if (!selected) {
      return { connections: [], selectedConnectionId: null, offices: [], passes: [] };
    }
    const headers = wbHeaders(selected.apiKey);
    const [offices, passes] = await Promise.all([
      marketplaceJson('https://marketplace-api.wildberries.ru/api/v3/passes/offices', { method: 'GET', headers }),
      marketplaceJson('https://marketplace-api.wildberries.ru/api/v3/passes', { method: 'GET', headers }),
    ]);
    return {
      connections: connections.map((connection) => ({
        id: connection.id,
        accountName: connection.accountName,
      })),
      selectedConnectionId: selected.id,
      offices: asArray<Record<string, unknown>>(offices),
      passes: asArray<Record<string, unknown>>(passes),
    };
  }

  async createFbsPass(dto: FbsPassDto, user: AuthUser) {
    const connection = await this.loadFbsPassConnection(dto.clientId, dto.connectionId, user, 'write');
    const created = await marketplaceJson('https://marketplace-api.wildberries.ru/api/v3/passes', {
      method: 'POST',
      headers: wbHeaders(connection.apiKey),
      body: JSON.stringify(fbsPassPayload(dto)),
    });
    return { id: numberValue(created.id), created: true };
  }

  async updateFbsPass(passId: string, dto: FbsPassDto, user: AuthUser) {
    const connection = await this.loadFbsPassConnection(dto.clientId, dto.connectionId, user, 'write');
    await marketplaceJson(`https://marketplace-api.wildberries.ru/api/v3/passes/${numericPositiveId(passId, 'пропуска')}`, {
      method: 'PUT',
      headers: wbHeaders(connection.apiKey),
      body: JSON.stringify(fbsPassPayload(dto)),
    });
    return { id: numericPositiveId(passId, 'пропуска'), updated: true };
  }

  async deleteFbsPass(
    passId: string,
    clientId: string,
    connectionId: string,
    user: AuthUser,
  ) {
    const connection = await this.loadFbsPassConnection(clientId, connectionId, user, 'write');
    const id = numericPositiveId(passId, 'пропуска');
    await marketplaceJson(`https://marketplace-api.wildberries.ru/api/v3/passes/${id}`, {
      method: 'DELETE',
      headers: wbHeaders(connection.apiKey),
    });
    return { id, deleted: true };
  }

  private async loadFbsPassConnection(
    clientId: string,
    connectionId: string,
    user: AuthUser,
    mode: 'read' | 'write',
  ) {
    const normalizedClientId = clientId.trim();
    this.clientScopes.requireClientAccess(user, normalizedClientId, mode);
    const connection = await this.prisma.clientMarketplaceConnection.findFirst({
      where: {
        id: connectionId.trim(),
        clientId: normalizedClientId,
        marketplace: MarketplaceType.WILDBERRIES,
        isActive: true,
      },
      include: { client: { select: { id: true, code: true, name: true } } },
    });
    if (!connection) throw new NotFoundException('Подключение Wildberries не найдено или отключено.');
    return connection;
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
    const crossBorderPdfByOrderId = new Map<string, Buffer>();
    for (const connection of connections) {
      const connectionOrders = ordersByConnection.get(connection.id) ?? [];
      const regularOrders = connectionOrders.filter((order) => numberValue(order.crossBorderType) === 0);
      const crossBorderOrders = connectionOrders.filter((order) => numberValue(order.crossBorderType) !== 0);
      for (const orderChunk of chunks(regularOrders, 100)) {
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
      for (const orderChunk of chunks(crossBorderOrders, 100)) {
        const response = await marketplaceJson(
          'https://marketplace-api.wildberries.ru/api/v3/orders/stickers/cross-border',
          {
            method: 'POST',
            headers: wbHeaders(connection.apiKey),
            body: JSON.stringify({ orders: orderChunk.map((order) => numericWbOrderId(order.id)) }),
          },
        );
        for (const sticker of asArray<Record<string, unknown>>(response.stickers)) {
          const orderId = textValue(sticker.orderId);
          const file = textValue(sticker.file);
          if (orderId && file && textValue(sticker.status) === 'ready') {
            crossBorderPdfByOrderId.set(orderId, Buffer.from(file, 'base64'));
          }
        }
      }
    }

    const missingOrderIds = orders
      .map((order) => order.id)
      .filter((orderId) => !stickersByOrderId.has(orderId) && !crossBorderPdfByOrderId.has(orderId));
    if (missingOrderIds.length > 0) {
      throw new BadRequestException(
        `Wildberries пока не сформировал ШК для заказов: ${missingOrderIds.join(', ')}. Обновите статусы и повторите.`,
      );
    }
    const regularStickers = orders
      .map((order) => stickersByOrderId.get(order.id))
      .filter((sticker): sticker is FbsStickerImage => Boolean(sticker));
    const pdfParts: Buffer[] = [];
    if (regularStickers.length > 0) pdfParts.push(await buildFbsStickersPdf(regularStickers));
    orders.forEach((order) => {
      const crossBorderPdf = crossBorderPdfByOrderId.get(order.id);
      if (crossBorderPdf) pdfParts.push(crossBorderPdf);
    });
    const buffer = await mergeFbsStickerPdfs(pdfParts);
    return {
      fileName: `fbs-wb-order-stickers-${fileTimestamp(new Date())}.pdf`,
      contentType: 'application/pdf' as const,
      buffer,
      count: orders.length,
    };
  }

  async getFbsCargoPlaceStickersPdf(dto: FbsOrderSelectionDto, user: AuthUser) {
    const clientId = dto.clientId.trim();
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const [{ orders }, deliveryPlan] = await Promise.all([
      this.resolveSelectedFbsOrders(clientId, dto.orders),
      this.loadFbsDeliveryPlan(clientId),
    ]);
    const unavailable = orders.filter(
      (order) =>
        order.marketplace !== MarketplaceType.WILDBERRIES ||
        order.supplierStatus !== 'confirm' ||
        !order.supplyId ||
        !fbsOrderDeliveryPlan(order, deliveryPlan).requiresCargoPlaces,
    );
    if (unavailable.length > 0) {
      throw new BadRequestException(
        `ШК для ПВЗ можно скачать только для заказов WB из поставки, созданной с направлением «ПВЗ», в статусе «На сборке»: ${unavailable
          .map((order) => order.id)
          .join(', ')}.`,
      );
    }

    const connections = await this.loadSelectedConnections(clientId, orders);
    const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
    const supplies = new Map<string, { connectionId: string; supplyId: string; itemsPerCargoPlace: number }>();
    for (const order of orders) {
      const supplyId = order.supplyId!;
      const orderPlan = fbsOrderDeliveryPlan(order, deliveryPlan);
      supplies.set(`${order.connectionId}:${supplyId}`, {
        connectionId: order.connectionId,
        supplyId,
        itemsPerCargoPlace: orderPlan.itemsPerCargoPlace,
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
          `В поставке ${supply.supplyId} нет грузомест. Сначала добавьте их из расчёта ${supply.itemsPerCargoPlace} единиц товара на одно грузоместо.`,
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

  async getFbsSupplyStickersPdf(dto: FbsOrderSelectionDto, user: AuthUser) {
    const clientId = dto.clientId.trim();
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const [{ orders }, deliveryPlan] = await Promise.all([
      this.resolveSelectedFbsOrders(clientId, dto.orders),
      this.loadFbsDeliveryPlan(clientId),
    ]);
    const unavailable = orders.filter(
      (order) =>
        order.marketplace !== MarketplaceType.WILDBERRIES ||
        order.supplierStatus !== 'complete' ||
        !order.supplyId ||
        fbsOrderDeliveryPlan(order, deliveryPlan).requiresCargoPlaces,
    );
    if (unavailable.length > 0) {
      throw new BadRequestException(
        `ШК для СЦ можно скачать только для поставки с направлением «Сортировочный центр» после её передачи в доставку. Проверьте заказы: ${unavailable
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
      const response = await marketplaceJson(
        `https://marketplace-api.wildberries.ru/api/v3/supplies/${encodeURIComponent(supply.supplyId)}/barcode?type=png`,
        { method: 'GET', headers: wbHeaders(connection.apiKey) },
      );
      const file = textValue(response.file);
      if (!file) {
        throw new BadRequestException(`Wildberries не вернул ШК поставки ${supply.supplyId}.`);
      }
      stickers.push({
        orderId: supply.supplyId,
        barcode: textValue(response.barcode),
        file,
      });
    }

    const buffer = await buildFbsSupplyStickersPdf(stickers);
    return {
      fileName: `fbs-wb-supply-qr-sc-${fileTimestamp(new Date())}.pdf`,
      contentType: 'application/pdf' as const,
      buffer,
      count: stickers.length,
    };
  }

  async getFbsRequestPickListPdf(requestId: string, user: AuthUser) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        clientId: true,
        number: true,
        title: true,
        client: { select: { code: true, name: true } },
      },
    });
    if (!request) throw new NotFoundException('Заявка не найдена.');
    this.clientScopes.requireClientAccess(user, request.clientId, 'read');

    const links = await this.prisma.fbsOrderRequestLink.findMany({
      where: { requestId },
      select: { connectionId: true, orderId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (links.length === 0) {
      throw new BadRequestException('Лист подбора с QR доступен только для заявки, созданной из FBS-заказов.');
    }

    const { orders } = await this.resolveSelectedFbsOrders(
      request.clientId,
      links.map((link) => ({ connectionId: link.connectionId, id: link.orderId })),
    );
    const unavailable = orders.filter(
      (order) =>
        order.marketplace !== MarketplaceType.WILDBERRIES ||
        !['confirm', 'complete'].includes(order.supplierStatus),
    );
    if (unavailable.length > 0) {
      throw new BadRequestException(
        `QR/ШК Wildberries появится после перевода всех заказов в сборку. Проверьте: ${unavailable
          .map((order) => order.id)
          .join(', ')}.`,
      );
    }

    const connections = await this.loadSelectedConnections(request.clientId, orders);
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
            stickersByOrderId.set(orderId, { orderId, barcode: textValue(sticker.barcode), file });
          }
        }
      }
    }
    const missing = orders.filter((order) => !stickersByOrderId.has(order.id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Wildberries пока не сформировал QR/ШК для заказов: ${missing.map((order) => order.id).join(', ')}.`,
      );
    }

    const buffer = await buildFbsPickListPdf({
      requestNumber: request.number,
      requestTitle: request.title,
      clientName: [request.client.code, request.client.name].filter(Boolean).join(' · '),
      rows: orders.map((order) => ({
        orderId: order.id,
        productName: order.product?.name || order.article || `Товар ${order.nmId ?? ''}`,
        article: order.product?.article || order.article || '',
        barcodes: order.barcodes,
        quantity: Math.max(1, order.itemCount),
        boxes: order.storageBoxes.map((box) => ({ code: box.code, quantity: box.quantity })),
        sticker: stickersByOrderId.get(order.id)!,
      })),
    });
    return {
      fileName: `fbs-pick-list-${String(request.number).padStart(6, '0')}-${fileTimestamp(new Date())}.pdf`,
      contentType: 'application/pdf' as const,
      buffer,
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
      },
    });
    const destination = settings?.defaultDeliveryDestination ?? FbsDeliveryDestination.PICKUP_POINT;
    return {
      destination,
      itemsPerCargoPlace: DEFAULT_FBS_ITEMS_PER_CARGO_PLACE,
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
        counts: { active: 0, shipped: 0, cancelled: 0, archive: 0, all: 0 },
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
              needsChestnyZnak: true,
              isUnmarked: true,
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
                needsChestnyZnak: sku.needsChestnyZnak,
                isUnmarked: sku.isUnmarked,
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
          requiresReshipment: toBoolean(order.requiresReshipment),
          shipmentPlan: null,
          requiredMeta: uniqueStrings(asArray<unknown>(order.requiredMeta).map(textValue)),
          optionalMeta: uniqueStrings(asArray<unknown>(order.optionalMeta).map(textValue)),
          comment: textValue(order.comment) || null,
          request: null,
          billing: null,
        };
      })
      .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
    const supplyIds = uniqueStrings(ordersWithoutBilling.map((order) => order.supplyId ?? ''));
    const supplyPlans = supplyIds.length > 0
      ? await this.prisma.fbsSupplyPlan.findMany({
          where: {
            clientId,
            supplyId: { in: supplyIds },
            connectionId: { in: uniqueStrings(ordersWithoutBilling.map((order) => order.connectionId)) },
          },
        })
      : [];
    const supplyPlanByKey = new Map(
      supplyPlans.map((plan) => [
        fbsSupplyPlanKey(plan.marketplace, plan.connectionId, plan.supplyId),
        {
          destination: plan.deliveryDestination,
          itemsPerCargoPlace: Math.max(1, plan.itemsPerCargoPlace),
          requiresCargoPlaces: plan.deliveryDestination === FbsDeliveryDestination.PICKUP_POINT,
          cargoPlaceCount: Math.max(0, plan.cargoPlaceCount),
          cargoPlaceIds: uniqueStrings(asArray<unknown>(plan.cargoPlaceIds).map(textValue)),
        },
      ]),
    );
    const ordersWithShipmentPlans = ordersWithoutBilling.map((order) => ({
      ...order,
      shipmentPlan: order.supplyId
        ? supplyPlanByKey.get(fbsSupplyPlanKey(order.marketplace, order.connectionId, order.supplyId)) ?? null
        : null,
    }));
    const requestLinks = ordersWithShipmentPlans.length > 0
      ? await this.prisma.fbsOrderRequestLink.findMany({
          where: {
            clientId,
            connectionId: { in: uniqueStrings(ordersWithShipmentPlans.map((order) => order.connectionId)) },
            orderId: { in: uniqueStrings(ordersWithShipmentPlans.map((order) => order.id)) },
          },
          include: {
            request: { select: { id: true, number: true, title: true, status: true } },
          },
        })
      : [];
    const requestByOrder = new Map(
      requestLinks.map((link) => [selectionKey(link.connectionId, link.orderId), link.request]),
    );
    const ordersWithRequests = ordersWithShipmentPlans.map((order) => ({
      ...order,
      request: requestByOrder.get(selectionKey(order.connectionId, order.id)) ?? null,
    }));
    const billingByOrder = await this.ensureFbsProcessingCharges(
      clientId,
      ordersWithRequests.filter((order) => order.category === 'shipped'),
    );
    const orders = ordersWithRequests.map((order) => ({
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
      deliveryPlan,
      counts: {
        active: orders.filter((order) => order.category === 'active').length,
        shipped: orders.filter((order) => order.category === 'shipped').length,
        cancelled: orders.filter((order) => order.category === 'cancelled').length,
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
    const [newResponse, historicalOrders, reshipmentResponse] = await Promise.all([
      marketplaceJson('https://marketplace-api.wildberries.ru/api/v3/orders/new', {
        method: 'GET',
        headers,
      }),
      fetchWildberriesFbsHistory(headers),
      marketplaceJson('https://marketplace-api.wildberries.ru/api/v3/supplies/orders/reshipment', {
        method: 'GET',
        headers,
      }),
    ]);
    const reshipmentByOrderId = new Map(
      asArray<Record<string, unknown>>(reshipmentResponse.orders).map((item) => [
        textValue(item.orderID) || textValue(item.orderId),
        textValue(item.supplyID) || textValue(item.supplyId),
      ]),
    );

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
        requiresReshipment: reshipmentByOrderId.has(id),
        reshipmentSupplyId: reshipmentByOrderId.get(id) || null,
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
        requiresReshipment: false,
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

    const { fbsService } = await this.ensureFbsBillingBase(clientId);
    const batches = groupFbsOrdersByShipment(orders);

    for (const [shipmentKey, batchOrders] of batches) {
      const shipmentItems = batchOrders.reduce(
        (sum, order) => sum + Math.max(1, order.itemCount),
        0,
      );
      const weights = batchOrders.map((order) => Math.max(1, order.itemCount));
      const quote = quoteFixedFbsCalculator(shipmentItems, FBS_VNUKOVO);
      if (!quote) throw new BadRequestException('Не удалось рассчитать обработку FBS по тарифу Внуково.');
      const requestIds = uniqueStrings(batchOrders.map((order) => order.request?.id ?? ''));
      const requestId = requestIds.length === 1 ? requestIds[0] : null;
      const invoiceSourceKey = `fbs-invoice:${clientId}:${shipmentKey}`;
      const lockedInvoice = await this.prisma.billingInvoice.findUnique({
        where: { sourceKey: invoiceSourceKey },
        select: {
          id: true,
          number: true,
          status: true,
          totalRub: true,
          items: { select: { chargeId: true }, take: 1 },
        },
      });
      if (lockedInvoice && lockedInvoice.status !== BillingInvoiceStatus.DRAFT) {
        const lockedTotalRub = Number(lockedInvoice.totalRub);
        batchOrders.forEach((order, orderIndex) => {
          const totalRub = allocateRub(lockedTotalRub, weights, orderIndex);
          result.set(fbsOrderKey(order), {
            chargeId: lockedInvoice.items[0]?.chargeId ?? `invoice:${lockedInvoice.id}`,
            status: BillingChargeStatus.APPROVED,
            unitPriceRub: round(totalRub / Math.max(1, order.itemCount), 2),
            totalRub,
            invoiceNumber: lockedInvoice.number,
            invoiceStatus: lockedInvoice.status,
            breakdown: {
              fbsProcessingRub: totalRub,
              additionalServicesRub: 0,
              deliveryRub: 0,
              boxFormationRub: 0,
              boxMaterialRub: 0,
              palletRub: 0,
              shipmentKey,
              shipmentItems,
              boxCount: quote.boxes,
              palletCount: 0,
              deliveryDestination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
            },
          });
        });
        continue;
      }

      const description = 'Обработка заказов по FBS';
      const sourceKey = `fbs-calculator:${clientId}:${shipmentKey}`;
      const serviceDate = batchOrders
        .map((order) =>
          validDate(order.deliveryDate) ??
          validDate(order.sellerDate) ??
          validDate(order.createdAt),
        )
        .filter((date): date is Date => Boolean(date))
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? new Date();
      const chargeMetadata = cleanJson({
        kind: 'FBS',
        pricingVersion: 4,
        calculator: 'BUILT_IN',
        calculatorDestination: FBS_VNUKOVO,
        marketplace: batchOrders[0].marketplace,
        connectionId: batchOrders[0].connectionId,
        supplyId: batchOrders[0].supplyId,
        shipmentKey,
        requestIds,
        orderIds: batchOrders.map((order) => order.id),
        quantity: shipmentItems,
        quote,
      });
      const existing = await this.prisma.billingCharge.findUnique({
        where: { sourceKey },
        include: {
          invoiceItems: {
            where: { invoice: { status: { not: 'CANCELLED' } } },
            select: { invoice: { select: { number: true, status: true } } },
            take: 1,
          },
        },
      });
      const unitPriceRub = round(quote.totalWithTax / shipmentItems, 2);
      const shouldUpdate =
        existing?.status === BillingChargeStatus.DRAFT &&
        existing.invoiceItems.every((item) => item.invoice.status === BillingInvoiceStatus.DRAFT) &&
        (existing.serviceId !== fbsService.id ||
          existing.requestId !== requestId ||
          existing.description !== description ||
          Number(existing.quantity) !== shipmentItems ||
          Number(existing.unitPriceRub) !== unitPriceRub ||
          Number(existing.totalRub) !== quote.totalWithTax ||
          JSON.stringify(existing.metadata ?? null) !== JSON.stringify(chargeMetadata));
      const charge = !existing
        ? await this.prisma.billingCharge.create({
            data: {
              clientId,
              serviceId: fbsService.id,
              requestId,
              description,
              unit: BillingUnit.PIECE,
              quantity: shipmentItems,
              unitPriceRub,
              totalRub: quote.totalWithTax,
              status: BillingChargeStatus.DRAFT,
              serviceDate,
              source: BillingChargeSource.MANUAL,
              sourceKey,
              metadata: chargeMetadata,
            },
            include: {
              invoiceItems: {
                where: { invoice: { status: { not: 'CANCELLED' } } },
                select: { invoice: { select: { number: true, status: true } } },
                take: 1,
              },
            },
          })
        : shouldUpdate
          ? await this.prisma.billingCharge.update({
              where: { id: existing.id },
              data: {
                serviceId: fbsService.id,
                requestId,
                description,
                quantity: shipmentItems,
                unitPriceRub,
                totalRub: quote.totalWithTax,
                serviceDate,
                metadata: chargeMetadata,
              },
              include: {
                invoiceItems: {
                  where: { invoice: { status: { not: 'CANCELLED' } } },
                  select: { invoice: { select: { number: true, status: true } } },
                  take: 1,
                },
              },
            })
          : existing;
      const invoice = charge.invoiceItems[0]?.invoice ?? null;

      for (const [orderIndex, order] of batchOrders.entries()) {
        const itemCount = Math.max(1, order.itemCount);
        const totalRub = allocateRub(quote.totalWithTax, weights, orderIndex);
        const fbsProcessingRub = allocateRub(
          (quote.processingCost + quote.stickersCost) * 1.5,
          weights,
          orderIndex,
        );
        const deliveryRub = allocateRub(quote.deliveryPrice, weights, orderIndex);
        const boxFormationRub = allocateRub(quote.assemblyCost * 1.5, weights, orderIndex);
        const boxMaterialRub = allocateRub(quote.boxesCost * 1.5, weights, orderIndex);
        const additionalServicesRub = round(
          totalRub - fbsProcessingRub - deliveryRub - boxFormationRub - boxMaterialRub,
          2,
        );
        const breakdown: NonNullable<FbsOrderSummary['billing']>['breakdown'] = {
          fbsProcessingRub,
          additionalServicesRub,
          deliveryRub,
          boxFormationRub,
          boxMaterialRub,
          palletRub: 0,
          shipmentKey,
          shipmentItems,
          boxCount: quote.boxes,
          palletCount: 0,
          deliveryDestination: FbsDeliveryDestination.VNUKOVO_SORTING_CENTER,
        };
        result.set(fbsOrderKey(order), {
          chargeId: charge.id,
          status: charge.status,
          unitPriceRub: round(totalRub / itemCount, 2),
          totalRub,
          invoiceNumber: invoice?.number ?? null,
          invoiceStatus: invoice?.status ?? null,
          breakdown,
        });
      }
    }

    await this.ensureFbsShipmentInvoices(clientId, orders, result);
    return result;
  }

  private async ensureFbsShipmentInvoices(
    clientId: string,
    orders: FbsOrderSummary[],
    billingByOrder: Map<string, NonNullable<FbsOrderSummary['billing']>>,
  ) {
    const eligibleOrders = orders.filter((order) => order.shipmentPlan && order.supplyId);
    const shipments = groupFbsOrdersByShipment(eligibleOrders);
    for (const [shipmentKey, shipmentOrders] of shipments) {
      const sourceKey = `fbs-invoice:${clientId}:${shipmentKey}`;
      let invoice = await this.prisma.billingInvoice.findUnique({
        where: { sourceKey },
        select: { id: true, number: true, status: true },
      });
      if (invoice && invoice.status !== BillingInvoiceStatus.DRAFT) {
        shipmentOrders.forEach((order) => {
          const billing = billingByOrder.get(fbsOrderKey(order));
          if (billing) {
            billingByOrder.set(fbsOrderKey(order), {
              ...billing,
              invoiceNumber: invoice!.number,
              invoiceStatus: invoice!.status,
            });
          }
        });
        continue;
      }
      const chargeIds = uniqueStrings(
        shipmentOrders.map((order) => billingByOrder.get(fbsOrderKey(order))?.chargeId ?? ''),
      );
      const charges = await this.prisma.billingCharge.findMany({
        where: { id: { in: chargeIds }, clientId },
        orderBy: [{ serviceDate: 'asc' }, { createdAt: 'asc' }],
      });
      if (charges.length === 0) continue;
      const periodFrom = charges.reduce(
        (date, charge) => (charge.serviceDate < date ? charge.serviceDate : date),
        charges[0].serviceDate,
      );
      const periodTo = charges.reduce(
        (date, charge) => (charge.serviceDate > date ? charge.serviceDate : date),
        charges[0].serviceDate,
      );
      const totalRub = round(charges.reduce((sum, charge) => sum + Number(charge.totalRub), 0), 2);
      const requestIds = uniqueStrings(shipmentOrders.map((order) => order.request?.id ?? ''));
      const requestId = requestIds.length === 1 ? requestIds[0] : null;
      if (!invoice) {
        const number = await this.nextFbsInvoiceNumber(periodTo);
        try {
          invoice = await this.prisma.billingInvoice.create({
            data: {
              number,
              clientId,
              periodFrom,
              periodTo,
              status: BillingInvoiceStatus.DRAFT,
              source: BillingInvoiceSource.MANUAL,
              sourceKey,
              requestId,
              totalRub,
              comment: `Автоматический черновик счёта за обработку FBS-поставки ${shipmentOrders[0].supplyId}.`,
              items: {
                create: charges.map((charge) => ({
                  chargeId: charge.id,
                  description: charge.description,
                  unit: charge.unit,
                  quantity: charge.quantity,
                  unitPriceRub: charge.unitPriceRub,
                  totalRub: charge.totalRub,
                  serviceDate: charge.serviceDate,
                })),
              },
            },
            select: { id: true, number: true, status: true },
          });
        } catch (caught) {
          if (!(caught instanceof Prisma.PrismaClientKnownRequestError) || caught.code !== 'P2002') throw caught;
          invoice = await this.prisma.billingInvoice.findUnique({
            where: { sourceKey },
            select: { id: true, number: true, status: true },
          });
        }
      } else {
        const previousItems = await this.prisma.billingInvoiceItem.findMany({
          where: { invoiceId: invoice.id },
          select: { chargeId: true },
        });
        const previousChargeIds = uniqueStrings(previousItems.map((item) => item.chargeId ?? ''))
          .filter((chargeId) => !chargeIds.includes(chargeId));
        await this.prisma.$transaction(async (tx) => {
          const editableInvoice = await tx.billingInvoice.findFirst({
            where: { id: invoice!.id, status: BillingInvoiceStatus.DRAFT },
            select: { id: true },
          });
          if (!editableInvoice) return;
          await tx.billingInvoiceItem.deleteMany({ where: { invoiceId: invoice!.id } });
          await tx.billingInvoiceItem.createMany({
            data: charges.map((charge) => ({
              invoiceId: invoice!.id,
              chargeId: charge.id,
              description: charge.description,
              unit: charge.unit,
              quantity: charge.quantity,
              unitPriceRub: charge.unitPriceRub,
              totalRub: charge.totalRub,
              serviceDate: charge.serviceDate,
            })),
          });
          await tx.billingInvoice.update({
            where: { id: invoice!.id },
            data: {
              periodFrom,
              periodTo,
              requestId,
              totalRub,
              comment: `Автоматический черновик счёта за обработку FBS-поставки ${shipmentOrders[0].supplyId}.`,
            },
          });
          if (previousChargeIds.length > 0) {
            await tx.billingCharge.updateMany({
              where: {
                id: { in: previousChargeIds },
                clientId,
                status: BillingChargeStatus.DRAFT,
              },
              data: { status: BillingChargeStatus.CANCELLED },
            });
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      }
      if (!invoice) continue;
      shipmentOrders.forEach((order) => {
        const billing = billingByOrder.get(fbsOrderKey(order));
        if (billing) {
          billingByOrder.set(fbsOrderKey(order), {
            ...billing,
            invoiceNumber: invoice!.number,
            invoiceStatus: invoice!.status,
          });
        }
      });
    }
  }

  private async nextFbsInvoiceNumber(date: Date) {
    const prefix = `FBS-${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const count = await this.prisma.billingInvoice.count({ where: { number: { startsWith: prefix } } });
    return `${prefix}-${String(count + 1).padStart(4, '0')}`;
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

function requiredFbsTsdText(value: unknown, message: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(message);
  }
  return value.trim();
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? uniqueStrings(value.map(textValue)) : [];
}

function fbsTsdStage(task: FbsTsdAssemblyRecord) {
  if (task.status === 'COMPLETED') return 'COMPLETED';
  if (!task.boxId) return 'SCAN_BOX';
  if (!task.barcode) return 'SCAN_BARCODE';
  if (task.requiresKiz && (!task.kiz || task.wbMetaStatus !== 'ACCEPTED')) return 'SCAN_KIZ';
  return 'READY_TO_COMPLETE';
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

function numericPositiveId(value: string, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new BadRequestException(`Некорректный номер ${label}: ${value}.`);
  }
  return result;
}

function fbsPassPayload(dto: FbsPassDto) {
  return {
    firstName: dto.firstName.trim(),
    lastName: dto.lastName.trim(),
    carModel: dto.carModel.trim(),
    carNumber: dto.carNumber.trim().toUpperCase(),
    officeId: dto.officeId,
  };
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function selectionKey(connectionId: string, orderId: string) {
  return `${connectionId.trim()}:${orderId.trim()}`;
}

function fbsSupplyPlanKey(marketplace: MarketplaceType, connectionId: string, supplyId: string) {
  return `${marketplace}:${connectionId.trim()}:${supplyId.trim()}`;
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

function fbsOrderCategory(supplierStatus: string, wbStatus: string): 'active' | 'shipped' | 'cancelled' | 'archive' {
  const cancelledSupplierStatuses = new Set(['cancel', 'cancel_carrier', 'cancelled', 'canceled']);
  const cancelledWbStatuses = new Set([
    'canceled',
    'canceled_by_client',
    'declined_by_client',
    'defect',
    'canceled_by_carrier',
  ]);
  if (cancelledSupplierStatuses.has(supplierStatus) || cancelledWbStatuses.has(wbStatus)) {
    return 'cancelled';
  }
  if (wbStatus === 'sold') return 'archive';
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

function printableFbsKiz(value: string) {
  return value
    .replace(/\u001d/gi, '<GS>')
    .replace(/[\u0000-\u001c\u001e-\u001f\u007f]/g, (symbol) =>
      `<0x${symbol.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}>`,
    );
}

function fbsStockBalanceKey(input: {
  clientId: string;
  skuId: string;
  boxId: string | null;
  palletId: string | null;
  status: StockStatus;
}) {
  return [input.clientId, input.skuId, input.boxId ?? 'no-box', input.palletId ?? 'no-pallet', input.status].join(':');
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

function fbsOrderDeliveryPlan(
  order: FbsOrderSummary,
  fallback: FbsOrdersResponse['deliveryPlan'],
): FbsOrdersResponse['deliveryPlan'] {
  return order.shipmentPlan
    ? {
        destination: order.shipmentPlan.destination,
        itemsPerCargoPlace: order.shipmentPlan.itemsPerCargoPlace,
        requiresCargoPlaces: order.shipmentPlan.requiresCargoPlaces,
      }
    : fallback;
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
