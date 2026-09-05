import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientNotificationEvent, ClientRequestEventType, ClientRequestStatus, ClientRequestType, MarketplaceType, MovementType, Prisma, StockStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { isClientNotificationEnabled } from '../client-notifications/client-notification-preferences';
import { TelegramNotificationService } from '../client-notifications/telegram-notification.service';
import { StockOperationsService } from '../stock/stock-operations.service';
import { clientRequestFileSummarySelect } from './client-request-files.service';
import { clientRequestPackageInclude } from './client-request-packages.include';
import { readFbsAttemptHistory } from '../../common/shipment-history/fbs-attempt-history';
import {
  assertWarehouseAccess,
  effectiveWarehouseId,
  warehouseScopeWhere,
} from './client-request-warehouse-scope';
import { CreateClientRequestDto } from './dto/create-client-request.dto';
import { ListClientRequestsDto } from './dto/list-client-requests.dto';
import { PreviewClientRequestAvailabilityDto } from './dto/preview-client-request-availability.dto';
import { UpdateClientRequestDto } from './dto/update-client-request.dto';
import { UpdateClientRequestBoxSelectionDto } from './dto/update-client-request-box-selection.dto';
import { UpdateClientRequestStatusDto } from './dto/update-client-request-status.dto';
import type { FbsSynchronizationResolutionAction } from './dto/resolve-fbs-synchronization.dto';

const FBS_NO_BOX_CODE = 'БЕЗ КОРОБА';
const fbsStockReservationStatuses = ['RESERVED', 'IN_PROGRESS', 'COMPLETED', 'RETURN_REQUIRED'];

// ADDED: старые планы могли сохранить orderIds как JSON-строку, поэтому читаем оба безопасных формата.
function fbsSupplyOrderIds(value: Prisma.JsonValue): string[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed.filter((orderId): orderId is string => typeof orderId === 'string') : [];
}

function fbsSupplyScopeKey(clientId: string, connectionId: string, marketplace: MarketplaceType): string {
  return JSON.stringify([clientId, connectionId, marketplace]);
}

@Injectable()
export class ClientRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly stockOperations: StockOperationsService,
    private readonly telegram?: TelegramNotificationService,
  ) {}

  async list(query: ListClientRequestsDto, user: AuthUser) {
    const boxCode = query.boxCode?.trim();
    const where: Prisma.ClientRequestWhereInput = {
      clientId: this.clientScopes.resolveClientFilter(user, query.clientId),
      warehouseId:
        user.activeWarehouseId && !user.roleCodes.includes('CLIENT')
          ? user.activeWarehouseId
          : undefined,
      ...warehouseScopeWhere(user),
      status:
        query.status ??
        (query.archive
          ? { in: [ClientRequestStatus.DONE, ClientRequestStatus.CANCELLED] }
          : { notIn: [ClientRequestStatus.DONE, ClientRequestStatus.CANCELLED] }),
      type: query.type,
      AND: boxCode
        ? [
            {
              OR: [
                {
                  packages: {
                    some: {
                      packageCode: { contains: boxCode, mode: 'insensitive' },
                    },
                  },
                },
                {
                  pickWaveRequests: {
                    some: {
                      wave: {
                        balanceLines: {
                          some: {
                            sourceBoxCode: { contains: boxCode, mode: 'insensitive' },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          ]
        : undefined,
    };

    const requests = await this.prisma.clientRequest.findMany({
      where,
      include: clientRequestInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
    });
    const previousAttempts = await readFbsAttemptHistory(this.prisma, { requestId: { in: requests.map(request => request.id) } });
    for (const request of requests) {
      request._count.fbsOrderLinks += previousAttempts.filter(row => row.task.requestId === request.id).length;
    }
    const fbsRequestIds = requests
      .filter((request) => request._count.fbsOrderLinks > 0)
      .map((request) => request.id);
    if (fbsRequestIds.length === 0) {
      return requests;
    }

    const [links, assemblies] = await Promise.all([
      this.prisma.fbsOrderRequestLink.findMany({
        where: {
          requestId: { in: fbsRequestIds },
          syncStatus: { notIn: ['REMOVED', 'MOVING'] },
          lastCategory: { not: 'cancelled' },
        },
        select: {
          requestId: true,
          clientId: true,
          connectionId: true,
          marketplace: true,
          orderId: true,
          lastSupplyId: true,
        },
      }),
      this.prisma.fbsTsdAssembly.findMany({
        where: { requestId: { in: fbsRequestIds } },
        select: { requestId: true, orderId: true, status: true, completedAt: true },
      }),
    ]);
    for (const previous of previousAttempts) {
      links.push(previous.link);
      assemblies.push(previous.task);
    }
    // FIX: номер поставки нужен только отгруженным заявкам; активные не запускают архивный fallback-запрос.
    const doneFbsRequestIds = new Set(
      requests
        .filter(
          (request) => request.status === ClientRequestStatus.DONE && request._count.fbsOrderLinks > 0,
        )
        .map((request) => request.id),
    );
    const doneWbLinks = links.filter(
      (link) =>
        doneFbsRequestIds.has(link.requestId) && link.marketplace === MarketplaceType.WILDBERRIES,
    );
    // ADDED: номер поставки берём из актуальной ссылки, а для старого архива — из сохранённого плана WB.
    const wbSupplyIdsByRequest = new Map<string, Set<string>>();
    const wbLinksWithoutSupply = doneWbLinks.filter((link) => !link.lastSupplyId?.trim());
    for (const link of doneWbLinks) {
      const supplyId = link.lastSupplyId?.trim();
      if (!supplyId) {
        continue;
      }
      const supplyIds = wbSupplyIdsByRequest.get(link.requestId) ?? new Set<string>();
      supplyIds.add(supplyId);
      wbSupplyIdsByRequest.set(link.requestId, supplyIds);
    }

    if (wbLinksWithoutSupply.length > 0) {
      const fallbackScopes = new Map<
        string,
        { clientId: string; connectionId: string; marketplace: MarketplaceType }
      >();
      for (const link of wbLinksWithoutSupply) {
        fallbackScopes.set(
          fbsSupplyScopeKey(link.clientId, link.connectionId, link.marketplace),
          { clientId: link.clientId, connectionId: link.connectionId, marketplace: link.marketplace },
        );
      }
      const supplyPlans = await this.prisma.fbsSupplyPlan.findMany({
        where: { OR: [...fallbackScopes.values()] },
        select: {
          clientId: true,
          connectionId: true,
          marketplace: true,
          supplyId: true,
          orderIds: true,
        },
      });
      const plansByScopeAndOrder = new Map<string, Map<string, Set<string>>>();
      for (const plan of supplyPlans) {
        const scopeKey = fbsSupplyScopeKey(plan.clientId, plan.connectionId, plan.marketplace);
        const supplyIdsByOrder = plansByScopeAndOrder.get(scopeKey) ?? new Map<string, Set<string>>();
        for (const orderId of fbsSupplyOrderIds(plan.orderIds)) {
          const supplyIds = supplyIdsByOrder.get(orderId) ?? new Set<string>();
          supplyIds.add(plan.supplyId);
          supplyIdsByOrder.set(orderId, supplyIds);
        }
        plansByScopeAndOrder.set(scopeKey, supplyIdsByOrder);
      }
      for (const link of wbLinksWithoutSupply) {
        const supplyIds = plansByScopeAndOrder
          .get(fbsSupplyScopeKey(link.clientId, link.connectionId, link.marketplace))
          ?.get(link.orderId);
        if (!supplyIds) {
          continue;
        }
        const requestSupplyIds = wbSupplyIdsByRequest.get(link.requestId) ?? new Set<string>();
        for (const supplyId of supplyIds) {
          requestSupplyIds.add(supplyId);
        }
        wbSupplyIdsByRequest.set(link.requestId, requestSupplyIds);
      }
    }
    const activeOrdersByRequest = new Map<string, Set<string>>();
    for (const link of links) {
      const orders = activeOrdersByRequest.get(link.requestId) ?? new Set<string>();
      orders.add(link.orderId);
      activeOrdersByRequest.set(link.requestId, orders);
    }
    const completedOrdersByRequest = new Map<string, Set<string>>();
    for (const assembly of assemblies) {
      if (
        assembly.status !== 'COMPLETED' ||
        !activeOrdersByRequest.get(assembly.requestId)?.has(assembly.orderId)
      ) {
        continue;
      }
      // FIX: local-search activation does not invalidate physical completions; full reset changes task statuses.
      const orders = completedOrdersByRequest.get(assembly.requestId) ?? new Set<string>();
      orders.add(assembly.orderId);
      completedOrdersByRequest.set(assembly.requestId, orders);
    }

    return requests.map((request) => {
      const totalOrders = activeOrdersByRequest.get(request.id)?.size ?? 0;
      const wbSupplyIds = [...(wbSupplyIdsByRequest.get(request.id) ?? [])].sort((left, right) =>
        left.localeCompare(right),
      );
      if (totalOrders === 0) {
        return wbSupplyIds.length > 0 ? { ...request, wbSupplyIds } : request;
      }
      const completedOrders = completedOrdersByRequest.get(request.id)?.size ?? 0;
      return {
        ...request,
        ...(wbSupplyIds.length > 0 ? { wbSupplyIds } : {}),
        fbsCompletion: {
          totalOrders,
          completedOrders,
          percent: Math.min(100, Math.round((completedOrders / totalOrders) * 100)),
          completed: completedOrders === totalOrders,
        },
      };
    });
  }

  async get(id: string, user: AuthUser) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id },
      include: clientRequestInclude,
    });

    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'read');
    assertWarehouseAccess(user, request, 'read', 'Заявка не найдена в выбранном филиале.');
    if (
      user.activeWarehouseId &&
      !user.roleCodes.includes('CLIENT') &&
      request.warehouseId !== user.activeWarehouseId
    ) {
      throw new NotFoundException('Заявка не найдена в выбранном филиале.');
    }
    return request;
  }

  async previewAvailability(dto: PreviewClientRequestAvailabilityDto, user: AuthUser): Promise<ClientRequestAvailabilityPreview> {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    const warehouseId = await this.resolveRequestWarehouse(
      dto.clientId,
      dto.warehouseId,
      user,
    );
    const items = dto.items ?? [];

    if (dto.type !== ClientRequestType.OUTBOUND || items.length === 0) {
      return {
        clientId: dto.clientId,
        type: dto.type,
        canCommit: true,
        summary: {
          lines: items.length,
          requestedQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
          stockQuantity: 0,
          reservedQuantity: 0,
          availableQuantity: 0,
          shortageQuantity: 0,
          conflictsCount: 0,
        },
        lines: items.map((item, index) => this.nonOutboundAvailabilityLine(item, index)),
      };
    }

    const resolved = await this.resolveAvailabilityItems(dto.clientId, items);
    const skuIds = [...new Set(resolved.map((line) => line.skuId).filter(Boolean))] as string[];
    const barcodes = [...new Set(resolved.map((line) => line.barcode).filter(Boolean))] as string[];
    const includeLegacyMoscowRows = await this.isPrimaryMoscowWarehouse(warehouseId);
    const stockBySkuId = await this.stockQuantityBySkuId(
      dto.clientId,
      skuIds,
      warehouseId,
      includeLegacyMoscowRows,
    );
    const reservationsBySkuId = await this.activeReservationBySkuId(
      dto.clientId,
      skuIds,
      barcodes,
      dto.excludeRequestId,
      warehouseId,
      includeLegacyMoscowRows,
    );

    const lines = resolved.map((line) => {
      if (!line.skuId) {
        return {
          ...line,
          stockQuantity: 0,
          reservedQuantity: 0,
          availableQuantity: 0,
          shortageQuantity: line.requestedQuantity,
          canFulfill: false,
          conflicts: [],
        };
      }

      const stockQuantity = stockBySkuId.get(line.skuId) ?? 0;
      const reservation = reservationsBySkuId.get(line.skuId);
      const reservedQuantity = reservation?.quantity ?? 0;
      const availableQuantity = Math.max(0, stockQuantity - reservedQuantity);
      const shortageQuantity = Math.max(0, line.requestedQuantity - availableQuantity);

      return {
        ...line,
        stockQuantity,
        reservedQuantity,
        availableQuantity,
        shortageQuantity,
        canFulfill: shortageQuantity === 0,
        conflicts: reservation?.requests ?? [],
      };
    });

    return {
      clientId: dto.clientId,
      type: dto.type,
      canCommit: lines.every((line) => line.canFulfill),
      summary: {
        lines: lines.length,
        requestedQuantity: lines.reduce((sum, line) => sum + line.requestedQuantity, 0),
        stockQuantity: lines.reduce((sum, line) => sum + Math.min(line.stockQuantity, line.requestedQuantity), 0),
        reservedQuantity: lines.reduce((sum, line) => sum + Math.min(line.reservedQuantity, line.requestedQuantity), 0),
        availableQuantity: lines.reduce((sum, line) => sum + Math.min(line.availableQuantity, line.requestedQuantity), 0),
        shortageQuantity: lines.reduce((sum, line) => sum + line.shortageQuantity, 0),
        conflictsCount: lines.filter((line) => line.conflicts.length > 0).length,
      },
      lines,
    };
  }

  async create(dto: CreateClientRequestDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    const warehouseId = await this.resolveRequestWarehouse(
      dto.clientId,
      dto.warehouseId,
      user,
    );
    await this.ensureSkuItemsBelongToClient(dto.clientId, dto.items ?? []);
    const destinationCity = normalizeRequiredText(dto.destinationCity, 'Город поставки обязателен.');

    // Русский комментарий: клиентская заявка всегда стартует как SUBMITTED; статусы меняет отдельный workflow.
    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.clientRequest.create({
        data: {
          clientId: dto.clientId,
          warehouseId,
          type: dto.type,
          status: ClientRequestStatus.SUBMITTED,
          priority: dto.priority ?? 'NORMAL',
          title: dto.title.trim(),
          comment: normalizeText(dto.comment),
          contactName: normalizeText(dto.contactName),
          contactPhone: normalizeText(dto.contactPhone),
          destinationCity,
          deliveryAddress: normalizeText(dto.deliveryAddress),
          desiredDate: dto.desiredDate ? new Date(dto.desiredDate) : undefined,
          createdByUserId: user.id,
          items: dto.items?.length
            ? {
                create: dto.items.map((item) => ({
                  skuId: normalizeText(item.skuId),
                  barcode: normalizeText(item.barcode),
                  name: normalizeText(item.name),
                  quantity: item.quantity,
                  comment: normalizeText(item.comment),
                })),
              }
            : undefined,
        },
        include: clientRequestInclude,
      });

      await tx.clientRequestEvent.create({
        data: {
          requestId: request.id,
          clientId: request.clientId,
          eventType: ClientRequestEventType.CREATED,
          title: 'Заявка создана',
          body: request.comment ?? undefined,
          statusTo: ClientRequestStatus.SUBMITTED,
          createdByUserId: user.id,
        },
      });

      return request;
    });

    void this.telegram?.notifyFulfillment(
      [
        'LOGOFF WMS: новая заявка от клиента.',
        `Заявка: ${created.title}`,
        `Клиент: ${created.client.name}`,
        `Город: ${created.destinationCity ?? '-'}`,
        `Строк: ${created.items.length}`,
      ].join('\n'),
    );

    return created;
  }

  async update(id: string, dto: UpdateClientRequestDto, user: AuthUser) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id },
      select: { id: true, clientId: true, warehouseId: true, type: true, status: true },
    });

    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'write');
    assertWarehouseAccess(user, request, 'write', 'Заявка не найдена в выбранном филиале.');
    if (request.type === ClientRequestType.SKU_COLLECTION) {
      // FIX: source rows and quantities are immutable after the reservation is created.
      throw new BadRequestException('Заявка «Сборка по SKU» изменяется только через специальную форму и ТСД.');
    }

    if (!canEditClientRequestAnyStatus(user) && !clientEditableStatuses.has(request.status)) {
      throw new BadRequestException('Заявку можно редактировать только до начала работы склада.');
    }

    await this.ensureSkuItemsBelongToClient(request.clientId, dto.items ?? []);

    const data: Prisma.ClientRequestUpdateInput = {
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.title !== undefined ? { title: normalizeRequiredText(dto.title, 'Название заявки обязательно.') } : {}),
      ...(dto.comment !== undefined ? { comment: normalizeText(dto.comment) ?? null } : {}),
      ...(dto.contactName !== undefined ? { contactName: normalizeText(dto.contactName) ?? null } : {}),
      ...(dto.contactPhone !== undefined ? { contactPhone: normalizeText(dto.contactPhone) ?? null } : {}),
      ...(dto.destinationCity !== undefined
        ? { destinationCity: normalizeRequiredText(dto.destinationCity, 'Город поставки обязателен.') }
        : {}),
      ...(dto.deliveryAddress !== undefined ? { deliveryAddress: normalizeText(dto.deliveryAddress) ?? null } : {}),
      ...(dto.desiredDate !== undefined ? { desiredDate: dto.desiredDate ? new Date(dto.desiredDate) : null } : {}),
    };

    return this.prisma.$transaction(async (tx) => {
      if (dto.items !== undefined) {
        await tx.clientRequestItem.deleteMany({ where: { requestId: id } });
        data.items = {
          create: dto.items.map((item) => ({
            skuId: normalizeText(item.skuId),
            barcode: normalizeText(item.barcode),
            name: normalizeText(item.name),
            quantity: item.quantity,
            comment: normalizeText(item.comment),
          })),
        };
      }

      return tx.clientRequest.update({
        where: { id },
        data,
        include: clientRequestInclude,
      });
    });
  }

  async getManualBoxSelection(id: string, user: AuthUser) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            sku: {
              include: { barcodes: { orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }] } },
            },
          },
          orderBy: { id: 'asc' },
        },
        pickWaveRequests: {
          include: { wave: { select: { status: true } } },
        },
      },
    });
    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }
    this.clientScopes.requireClientAccess(user, request.clientId, 'read');
    assertWarehouseAccess(user, request, 'read', 'Заявка не найдена в выбранном филиале.');
    assertStockSourceResolutionRequest(request);

    const resolvedItems = await Promise.all(
      request.items.map(async (item) => ({
        item,
        sku:
          item.sku ??
          (item.barcode
            ? (
                await this.prisma.barcode.findFirst({
                  where: { value: item.barcode, sku: { clientId: request.clientId } },
                  include: {
                    sku: {
                      include: { barcodes: { orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }] } },
                    },
                  },
                })
              )?.sku
            : null),
      })),
    );
    const skuIds = [...new Set(resolvedItems.map((row) => row.sku?.id).filter((value): value is string => Boolean(value)))];
    const [balances, savedSelections, fbsOrderLinks, fbsTasks] = await Promise.all([
      skuIds.length
        ? this.prisma.stockBalance.findMany({
            where: {
              clientId: request.clientId,
              warehouseId: request.warehouseId ?? undefined,
              skuId: { in: skuIds },
              status: { in: manualSelectionStockStatuses },
              quantity: { gt: 0 },
              box: { status: { notIn: ['deleted', 'archived'] } },
            },
            include: { box: { select: { id: true, code: true, status: true } } },
            orderBy: [{ box: { code: 'asc' } }, { status: 'asc' }],
          })
        : Promise.resolve([]),
      this.prisma.clientRequestBoxSelection.findMany({
        where: { requestItem: { requestId: request.id } },
        include: { box: { select: { id: true, code: true, status: true } } },
        orderBy: [{ box: { code: 'asc' } }],
      }),
      this.prisma.fbsOrderRequestLink.findMany({
        where: {
          requestId: request.id,
          syncStatus: { not: 'REMOVED' },
        },
        select: {
          connectionId: true,
          orderId: true,
          lastSkuId: true,
          lastCategory: true,
          lastSupplierStatus: true,
          lastWbStatus: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.fbsTsdAssembly.findMany({
        where: { requestId: request.id },
        select: {
          connectionId: true,
          orderId: true,
          status: true,
          boxCode: true,
          reservedBoxCode: true,
          sourceBoxPending: true,
          barcode: true,
          stickerPartB: true,
        },
      }),
    ]);
    for (const previous of await readFbsAttemptHistory(this.prisma, { requestId: request.id })) {
      fbsOrderLinks.push(previous.link);
      fbsTasks.push(previous.task);
    }
    const fbsTaskByOrder = new Map(
      fbsTasks.map((task) => [`${task.connectionId}:${task.orderId}`, task]),
    );

    return {
      request: {
        id: request.id,
        number: request.number,
        title: request.title,
        status: request.status,
        clientId: request.clientId,
      },
      editable: manualBoxSelectionEditableStatuses.has(request.status),
      summary: {
        items: request.items.length,
        requestedQuantity: request.items.reduce((sum, item) => sum + item.quantity, 0),
        selectedQuantity: savedSelections.reduce((sum, selection) => sum + selection.quantity, 0),
      },
      items: resolvedItems.map(({ item, sku }) => {
        const itemSelections = savedSelections.filter((selection) => selection.requestItemId === item.id);
        const boxes = new Map<
          string,
          {
            boxId: string;
            boxCode: string;
            boxStatus: string;
            availableQuantity: number;
            selectedQuantity: number;
            statuses: Array<{ status: StockStatus; quantity: number }>;
          }
        >();
        balances
          .filter((balance) => balance.skuId === sku?.id && balance.box)
          .forEach((balance) => {
            const current = boxes.get(balance.box!.id) ?? {
              boxId: balance.box!.id,
              boxCode: balance.box!.code,
              boxStatus: balance.box!.status,
              availableQuantity: 0,
              selectedQuantity: 0,
              statuses: [],
            };
            current.availableQuantity += balance.quantity;
            current.statuses.push({ status: balance.status, quantity: balance.quantity });
            boxes.set(balance.box!.id, current);
          });
        itemSelections.forEach((selection) => {
          const current = boxes.get(selection.boxId) ?? {
            boxId: selection.boxId,
            boxCode: selection.box.code,
            boxStatus: selection.box.status,
            availableQuantity: 0,
            selectedQuantity: 0,
            statuses: [],
          };
          current.selectedQuantity = selection.quantity;
          boxes.set(selection.boxId, current);
        });
        const selectedQuantity = itemSelections.reduce((sum, selection) => sum + selection.quantity, 0);
        return {
          requestItemId: item.id,
          requestedQuantity: item.quantity,
          selectedQuantity,
          sku: sku
            ? {
                id: sku.id,
                internalSku: sku.internalSku,
                article: sku.article,
                name: sku.name,
                barcodes: sku.barcodes.map((barcode) => barcode.value),
              }
            : null,
          requestedBarcode: item.barcode,
          requestedName: item.name,
          itemComment: item.comment,
          fbsOrders: fbsOrderLinks
            .filter((link) => link.lastSkuId === sku?.id)
            .map((link) => {
              const task = fbsTaskByOrder.get(`${link.connectionId}:${link.orderId}`);
              return {
                orderId: link.orderId,
                assemblyStatus: task?.status ?? 'NOT_STARTED',
                sourceBoxPending: task?.sourceBoxPending ?? false,
                boxCode:
                  task?.boxCode ?? task?.reservedBoxCode ?? null,
                barcode: task?.barcode ?? null,
                stickerPartB: task?.stickerPartB ?? null,
                wbStatus:
                  link.lastWbStatus ??
                  link.lastSupplierStatus ??
                  link.lastCategory ??
                  null,
              };
            }),
          boxes: [...boxes.values()].sort((left, right) => {
            if (left.selectedQuantity !== right.selectedQuantity) {
              return right.selectedQuantity - left.selectedQuantity;
            }
            if (left.availableQuantity !== right.availableQuantity) {
              return right.availableQuantity - left.availableQuantity;
            }
            return left.boxCode.localeCompare(right.boxCode, 'ru');
          }),
        };
      }),
    };
  }

  async getFbsBoxSearch(id: string, user: AuthUser) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        clientId: true,
        warehouseId: true,
        client: { select: { id: true, code: true, name: true, storesWithoutBoxes: true } },
        items: {
          select: {
            id: true,
            skuId: true,
            barcode: true,
            name: true,
            quantity: true,
            comment: true,
            sku: {
              select: {
                id: true,
                internalSku: true,
                article: true,
                name: true,
                barcodes: { orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }], select: { value: true } },
              },
            },
          },
          orderBy: { id: 'asc' },
        },
        fbsOrderLinks: {
          select: { orderId: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }
    this.clientScopes.requireClientAccess(user, request.clientId, 'read');
    assertWarehouseAccess(user, request, 'read', 'Заявка не найдена в выбранном филиале.');
    if (request.fbsOrderLinks.length === 0) {
      throw new BadRequestException('Поиск коробов доступен только для заявки, созданной из FBS-заказов.');
    }

    const linkedOrderIds = new Set(request.fbsOrderLinks.map((link) => link.orderId));
    const skuIds = [...new Set(request.items.map((item) => item.skuId).filter((value): value is string => Boolean(value)))];
    const warehouseRequestIds = request.warehouseId
      ? (
          await this.prisma.clientRequest.findMany({
            where: { clientId: request.clientId, warehouseId: request.warehouseId },
            select: { id: true },
          })
        ).map((candidate) => candidate.id)
      : undefined;
    if (request.client.storesWithoutBoxes) {
      const [balances, reservations] = await Promise.all([
        skuIds.length
          ? this.prisma.stockBalance.findMany({
              where: {
                clientId: request.clientId,
                warehouseId: request.warehouseId ?? undefined,
                skuId: { in: skuIds },
                status: StockStatus.AVAILABLE,
                quantity: { gt: 0 },
                boxId: null,
              },
              select: {
                skuId: true,
                quantity: true,
              },
            })
          : Promise.resolve([]),
        skuIds.length
          ? this.prisma.fbsTsdAssembly.findMany({
              where: {
                clientId: request.clientId,
                requestId: warehouseRequestIds ? { in: warehouseRequestIds } : undefined,
                skuId: { in: skuIds },
                boxId: null,
                reservedBoxId: null,
                boxCode: FBS_NO_BOX_CODE,
                status: { in: fbsStockReservationStatuses },
              },
              select: {
                orderId: true,
                requestId: true,
                requestItemId: true,
                skuId: true,
                itemCount: true,
                status: true,
              },
            })
          : Promise.resolve([]),
      ]);
      const availableBySku = new Map<string, number>();
      for (const balance of balances) {
        availableBySku.set(
          balance.skuId,
          (availableBySku.get(balance.skuId) ?? 0) + balance.quantity,
        );
      }
      const reservedBySku = new Map<string, number>();
      for (const reservation of reservations) {
        reservedBySku.set(
          reservation.skuId,
          (reservedBySku.get(reservation.skuId) ?? 0) + reservation.itemCount,
        );
      }
      const warehouseStock = request.items.flatMap((item) => {
        if (!item.skuId || !item.sku) return [];
        const parsedOrderIds = parseFbsOrderIds(item.comment).filter((orderId) =>
          linkedOrderIds.has(orderId),
        );
        const itemOrderIds = parsedOrderIds.length > 0
          ? parsedOrderIds
          : request.items.length === 1
            ? [...linkedOrderIds]
            : reservations
                .filter(
                  (reservation) =>
                    reservation.requestId === request.id &&
                    reservation.requestItemId === item.id,
                )
                .map((reservation) => reservation.orderId);
        const orderIds = [...new Set(itemOrderIds)].sort(naturalOrderIdCompare);
        const reservedOrderIds = [
          ...new Set(
            reservations
              .filter(
                (reservation) =>
                  reservation.requestId === request.id &&
                  reservation.skuId === item.skuId &&
                  orderIds.includes(reservation.orderId),
              )
              .map((reservation) => reservation.orderId),
          ),
        ].sort(naturalOrderIdCompare);
        const availableQuantity = availableBySku.get(item.skuId) ?? 0;
        const reservedQuantity = reservedBySku.get(item.skuId) ?? 0;
        return [{
          requestItemId: item.id,
          skuId: item.skuId,
          productName: item.sku.name || item.name || 'Товар без наименования',
          article: item.sku.article ?? item.sku.internalSku,
          barcodes: item.sku.barcodes.map((barcode) => barcode.value),
          requestedQuantity: item.quantity,
          availableQuantity,
          reservedQuantity,
          freeQuantity: Math.max(0, availableQuantity - reservedQuantity),
          orderIds,
          reservedOrderIds,
        }];
      });
      const foundOrderIds = new Set(
        warehouseStock
          .filter((item) => item.availableQuantity > 0)
          .flatMap((item) => item.orderIds),
      );
      const confirmedOrderIds = new Set(
        warehouseStock.flatMap((item) => item.reservedOrderIds),
      );
      const { storesWithoutBoxes: _storesWithoutBoxes, ...client } = request.client;
      return {
        stockMode: 'WITHOUT_BOXES' as const,
        request: {
          id: request.id,
          number: request.number,
          title: request.title,
          status: request.status,
          client,
        },
        summary: {
          boxes: 0,
          orders: linkedOrderIds.size,
          confirmedOrders: confirmedOrderIds.size,
          unmatchedOrders: [...linkedOrderIds].filter(
            (orderId) => !foundOrderIds.has(orderId),
          ).length,
        },
        warehouseStock,
        boxes: [],
        unmatchedOrderIds: [...linkedOrderIds]
          .filter((orderId) => !foundOrderIds.has(orderId))
          .sort(naturalOrderIdCompare),
      };
    }

    const [balances, requestTasks, reservations] = await Promise.all([
      skuIds.length
        ? this.prisma.stockBalance.findMany({
            where: {
              clientId: request.clientId,
              warehouseId: request.warehouseId ?? undefined,
              skuId: { in: skuIds },
              status: StockStatus.AVAILABLE,
              quantity: { gt: 0 },
              boxId: { not: null },
              box: { status: { notIn: ['deleted', 'archived'] } },
            },
            select: {
              skuId: true,
              boxId: true,
              quantity: true,
              box: { select: { id: true, code: true, status: true } },
            },
          })
        : Promise.resolve([]),
      this.prisma.fbsTsdAssembly.findMany({
        where: { requestId: request.id, status: { not: 'RELEASED' } },
        select: { orderId: true, requestItemId: true, skuId: true, boxId: true, boxCode: true, itemCount: true, status: true },
      }),
      skuIds.length
        ? this.prisma.fbsTsdAssembly.findMany({
            where: {
              clientId: request.clientId,
              requestId: warehouseRequestIds ? { in: warehouseRequestIds } : undefined,
              skuId: { in: skuIds },
              OR: [
                { boxId: { not: null } },
                { reservedBoxId: { not: null } },
              ],
              status: { in: ['RESERVED', 'IN_PROGRESS', 'COMPLETED'] },
            },
            select: {
              skuId: true,
              boxId: true,
              reservedBoxId: true,
              itemCount: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const reservedBySkuBox = new Map<string, number>();
    reservations.forEach((reservation) => {
      const boxId = reservation.boxId ?? reservation.reservedBoxId;
      if (!boxId) return;
      const key = `${reservation.skuId}:${boxId}`;
      reservedBySkuBox.set(key, (reservedBySkuBox.get(key) ?? 0) + reservation.itemCount);
    });
    const exactTaskByOrderId = new Map(
      requestTasks
        .filter((task) => task.boxId && linkedOrderIds.has(task.orderId))
        .map((task) => [task.orderId, task] as const),
    );
    const boxes = new Map<
      string,
      {
        boxId: string;
        boxCode: string;
        boxStatus: string;
        orderIds: Set<string>;
        confirmedOrderIds: Set<string>;
        candidateOrderIds: Set<string>;
        items: Array<{
          requestItemId: string;
          skuId: string;
          productName: string;
          article: string | null;
          barcodes: string[];
          requestedQuantity: number;
          availableQuantity: number;
          freeQuantity: number;
          orderIds: string[];
          confirmedOrderIds: string[];
          candidateOrderIds: string[];
        }>;
      }
    >();

    for (const item of request.items) {
      if (!item.skuId || !item.sku) continue;
      const parsedOrderIds = parseFbsOrderIds(item.comment).filter((orderId) => linkedOrderIds.has(orderId));
      const itemOrderIds = parsedOrderIds.length > 0
        ? parsedOrderIds
        : request.items.length === 1
          ? [...linkedOrderIds]
          : requestTasks.filter((task) => task.requestItemId === item.id).map((task) => task.orderId);
      const uniqueItemOrderIds = [...new Set(itemOrderIds)];
      const unassignedOrderIds = uniqueItemOrderIds.filter((orderId) => !exactTaskByOrderId.get(orderId)?.boxId);
      const itemBalances = balances.filter((balance) => balance.skuId === item.skuId && balance.boxId && balance.box);

      for (const balance of itemBalances) {
        const boxId = balance.boxId!;
        const confirmedOrderIds = uniqueItemOrderIds.filter(
          (orderId) => exactTaskByOrderId.get(orderId)?.boxId === boxId,
        );
        const freeQuantity = Math.max(0, balance.quantity - (reservedBySkuBox.get(`${item.skuId}:${boxId}`) ?? 0));
        const candidateOrderIds = freeQuantity > 0 ? unassignedOrderIds : [];
        const matchingOrderIds = [...new Set([...confirmedOrderIds, ...candidateOrderIds])];
        if (matchingOrderIds.length === 0) continue;

        const row = boxes.get(boxId) ?? {
          boxId,
          boxCode: balance.box!.code,
          boxStatus: balance.box!.status,
          orderIds: new Set<string>(),
          confirmedOrderIds: new Set<string>(),
          candidateOrderIds: new Set<string>(),
          items: [],
        };
        matchingOrderIds.forEach((orderId) => row.orderIds.add(orderId));
        confirmedOrderIds.forEach((orderId) => row.confirmedOrderIds.add(orderId));
        candidateOrderIds.forEach((orderId) => row.candidateOrderIds.add(orderId));
        row.items.push({
          requestItemId: item.id,
          skuId: item.skuId,
          productName: item.sku.name || item.name || 'Товар без наименования',
          article: item.sku.article ?? item.sku.internalSku,
          barcodes: item.sku.barcodes.map((barcode) => barcode.value),
          requestedQuantity: item.quantity,
          availableQuantity: balance.quantity,
          freeQuantity,
          orderIds: matchingOrderIds,
          confirmedOrderIds,
          candidateOrderIds,
        });
        boxes.set(boxId, row);
      }
    }

    const allCandidateBoxes = [...boxes.values()]
      .map((box) => ({
        ...box,
        orderIds: [...box.orderIds].sort(naturalOrderIdCompare),
        confirmedOrderIds: [...box.confirmedOrderIds].sort(naturalOrderIdCompare),
        candidateOrderIds: [...box.candidateOrderIds].sort(naturalOrderIdCompare),
        items: box.items.sort((left, right) => left.productName.localeCompare(right.productName, 'ru-RU')),
      }))
      .sort((left, right) => {
        const leftConfirmed = left.confirmedOrderIds.length > 0 ? 0 : 1;
        const rightConfirmed = right.confirmedOrderIds.length > 0 ? 0 : 1;
        return leftConfirmed - rightConfirmed || left.boxCode.localeCompare(right.boxCode, 'ru-RU');
      });
    const resultBoxes = allCandidateBoxes.filter(
      (box) => box.orderIds.length > 1 || box.confirmedOrderIds.length > 0,
    );
    const foundOrderIds = new Set(allCandidateBoxes.flatMap((box) => box.orderIds));

    const { storesWithoutBoxes: _storesWithoutBoxes, ...client } = request.client;
    return {
      stockMode: 'BOXES' as const,
      request: {
        id: request.id,
        number: request.number,
        title: request.title,
        status: request.status,
        client,
      },
      summary: {
        boxes: resultBoxes.length,
        orders: linkedOrderIds.size,
        confirmedOrders: new Set(resultBoxes.flatMap((box) => box.confirmedOrderIds)).size,
        unmatchedOrders: [...linkedOrderIds].filter((orderId) => !foundOrderIds.has(orderId)).length,
      },
      warehouseStock: [],
      boxes: resultBoxes,
      unmatchedOrderIds: [...linkedOrderIds].filter((orderId) => !foundOrderIds.has(orderId)).sort(naturalOrderIdCompare),
    };
  }

  async getFbsBoxSearchXlsx(id: string, user: AuthUser) {
    const data = await this.getFbsBoxSearch(id, user);
    const workbook = XLSX.utils.book_new();
    const generatedAt = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());
    if (data.stockMode === 'WITHOUT_BOXES') {
      const summaryRows: Array<Array<string | number>> = [
        ['Остатки склада FBS без коробов'],
        ['Заявка', `№${String(data.request.number).padStart(6, '0')} · ${data.request.title}`],
        ['Клиент', `${data.request.client.code} · ${data.request.client.name}`],
        ['Заказов в заявке', data.summary.orders],
        ['Товарных позиций', data.warehouseStock.length],
        ['Зарезервировано заказов', data.summary.confirmedOrders],
        ['Сформировано', generatedAt],
        [],
        ['Режим хранения', 'Поштучный остаток без привязки к коробам и палет-сортам.'],
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
      summarySheet['!cols'] = [{ wch: 27 }, { wch: 92 }];
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Сводка');

      const detailsRows: Array<Array<string | number>> = [
        [
          'Товар',
          'Артикул',
          'Штрихкоды',
          'Заказы WB',
          'Нужно по заявке, шт.',
          'Остаток на складе, шт.',
          'Зарезервировано, шт.',
          'Свободно, шт.',
        ],
        ...data.warehouseStock.map((item) => [
          item.productName,
          item.article ?? '',
          item.barcodes.join(', '),
          formatFbsOrderIds(item.orderIds),
          item.requestedQuantity,
          item.availableQuantity,
          item.reservedQuantity,
          item.freeQuantity,
        ]),
      ];
      const detailsSheet = XLSX.utils.aoa_to_sheet(detailsRows);
      detailsSheet['!cols'] = [
        { wch: 46 },
        { wch: 24 },
        { wch: 34 },
        { wch: 34 },
        { wch: 20 },
        { wch: 24 },
        { wch: 22 },
        { wch: 16 },
      ];
      detailsSheet['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: Math.max(0, detailsRows.length - 1), c: detailsRows[0].length - 1 },
        }),
      };
      XLSX.utils.book_append_sheet(workbook, detailsSheet, 'Остатки склада');

      return {
        fileName: `fbs-warehouse-stock-${String(data.request.number).padStart(6, '0')}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        content: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
      };
    }

    const summaryRows: Array<Array<string | number>> = [
      ['Совпадающие короба FBS'],
      ['Заявка', `№${String(data.request.number).padStart(6, '0')} · ${data.request.title}`],
      ['Клиент', `${data.request.client.code} · ${data.request.client.name}`],
      ['Заказов в заявке', data.summary.orders],
      ['Совпадающих коробов', data.summary.boxes],
      ['Подтверждено через ТСД', data.summary.confirmedOrders],
      ['Сформировано', generatedAt],
      [],
      ['Проверка', 'В файл включены только короба, общие для нескольких FBS-заказов, и короба, точно подтвержденные через ТСД.'],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet['!cols'] = [{ wch: 27 }, { wch: 92 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Сводка');

    const detailsRows: Array<Array<string | number>> = [
      [
        'Короб',
        'Заказы WB',
        'Подтверждение',
        'Товар',
        'Артикул',
        'Штрихкоды',
        'Заказы по товару',
        'Доступно, шт.',
        'Свободно, шт.',
      ],
      ...data.boxes.flatMap((box) =>
        box.items.map((item) => [
          box.boxCode,
          formatFbsOrderIds(box.orderIds),
          box.confirmedOrderIds.length > 0
            ? `Подтверждено ТСД: ${formatFbsOrderIds(box.confirmedOrderIds)}`
            : 'Совпадение по остаткам',
          item.productName,
          item.article ?? '',
          item.barcodes.join(', '),
          formatFbsOrderIds(item.orderIds),
          item.availableQuantity,
          item.freeQuantity,
        ]),
      ),
    ];
    const detailsSheet = XLSX.utils.aoa_to_sheet(detailsRows);
    detailsSheet['!cols'] = [
      { wch: 24 },
      { wch: 34 },
      { wch: 32 },
      { wch: 46 },
      { wch: 22 },
      { wch: 34 },
      { wch: 34 },
      { wch: 15 },
      { wch: 15 },
    ];
    detailsSheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(0, detailsRows.length - 1), c: detailsRows[0].length - 1 },
      }),
    };
    XLSX.utils.book_append_sheet(workbook, detailsSheet, 'Совпадающие короба');

    return {
      fileName: `fbs-shared-boxes-${String(data.request.number).padStart(6, '0')}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    };
  }

  async saveManualBoxSelection(id: string, dto: UpdateClientRequestBoxSelectionDto, user: AuthUser) {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.clientRequest.findUnique({
        where: { id },
        include: {
          items: { include: { sku: true } },
          pickWaveRequests: { include: { wave: { select: { status: true } } } },
        },
      });
      if (!request) {
        throw new NotFoundException('Клиентская заявка не найдена.');
      }
      this.clientScopes.requireClientAccess(user, request.clientId, 'write');
      assertWarehouseAccess(user, request, 'write', 'Заявка не найдена в выбранном филиале.');
      assertManualBoxSelectionRequest(request);
      if (!manualBoxSelectionEditableStatuses.has(request.status)) {
        throw new BadRequestException('Короба можно выбирать только до упаковки и сдачи заявки.');
      }

      if (dto.selections.length === 0) {
        await tx.clientRequestBoxSelection.deleteMany({ where: { requestItem: { requestId: request.id } } });
        await tx.clientRequestEvent.create({
          data: {
            requestId: request.id,
            clientId: request.clientId,
            eventType: ClientRequestEventType.COMMENT,
            title: 'Выбор коробов очищен',
            body: 'Ручной выбор коробов для списания удалён.',
            createdByUserId: user.id,
          },
        });
        return;
      }

      const duplicateKeys = new Set<string>();
      for (const selection of dto.selections) {
        const key = `${selection.requestItemId}:${selection.boxId}`;
        if (duplicateKeys.has(key)) {
          throw new BadRequestException('Один короб нельзя добавить к одной позиции дважды.');
        }
        duplicateKeys.add(key);
      }

      const itemById = new Map(request.items.map((item) => [item.id, item]));
      const resolvedSkuByItem = new Map<string, { id: string; internalSku: string }>();
      for (const item of request.items) {
        const sku =
          item.sku ??
          (item.barcode
            ? (
                await tx.barcode.findFirst({
                  where: { value: item.barcode, sku: { clientId: request.clientId } },
                  include: { sku: true },
                })
              )?.sku
            : null);
        if (!sku) {
          throw new BadRequestException(`Позиция ${item.name ?? item.barcode ?? item.id} не сопоставлена с товаром WMS.`);
        }
        resolvedSkuByItem.set(item.id, { id: sku.id, internalSku: sku.internalSku });
      }

      const requestedBoxIds = [...new Set(dto.selections.map((selection) => selection.boxId))];
      const balances = await tx.stockBalance.findMany({
        where: {
          clientId: request.clientId,
          warehouseId: request.warehouseId ?? undefined,
          boxId: { in: requestedBoxIds },
          skuId: { in: [...new Set([...resolvedSkuByItem.values()].map((sku) => sku.id))] },
          status: { in: manualSelectionStockStatuses },
          quantity: { gt: 0 },
          box: { status: { notIn: ['deleted', 'archived'] } },
        },
        include: { box: { select: { id: true, code: true } } },
      });
      const availableBySkuBox = new Map<string, { quantity: number; boxCode: string }>();
      balances.forEach((balance) => {
        if (!balance.box) return;
        const key = `${balance.skuId}:${balance.box.id}`;
        const current = availableBySkuBox.get(key) ?? { quantity: 0, boxCode: balance.box.code };
        current.quantity += balance.quantity;
        availableBySkuBox.set(key, current);
      });

      const selectedByItem = new Map<string, number>();
      const selectedBySkuBox = new Map<string, number>();
      for (const selection of dto.selections) {
        const item = itemById.get(selection.requestItemId);
        if (!item) {
          throw new BadRequestException('В выборе коробов найдена позиция, которой нет в заявке.');
        }
        const sku = resolvedSkuByItem.get(item.id)!;
        const skuBoxKey = `${sku.id}:${selection.boxId}`;
        const available = availableBySkuBox.get(skuBoxKey);
        if (!available) {
          throw new BadRequestException(`В выбранном коробе нет доступного остатка позиции ${sku.internalSku}.`);
        }
        selectedByItem.set(item.id, (selectedByItem.get(item.id) ?? 0) + selection.quantity);
        selectedBySkuBox.set(skuBoxKey, (selectedBySkuBox.get(skuBoxKey) ?? 0) + selection.quantity);
      }
      for (const item of request.items) {
        const selected = selectedByItem.get(item.id) ?? 0;
        if (selected !== item.quantity) {
          const sku = resolvedSkuByItem.get(item.id)!;
          throw new BadRequestException(
            `Для позиции ${sku.internalSku} нужно выбрать ${item.quantity} шт., сейчас выбрано ${selected} шт.`,
          );
        }
      }
      for (const [key, selected] of selectedBySkuBox) {
        const available = availableBySkuBox.get(key)!;
        if (selected > available.quantity) {
          throw new BadRequestException(
            `В коробе ${available.boxCode} доступно ${available.quantity} шт., выбрано ${selected} шт.`,
          );
        }
      }

      await tx.clientRequestBoxSelection.deleteMany({ where: { requestItem: { requestId: request.id } } });
      await tx.clientRequestBoxSelection.createMany({
        data: dto.selections.map((selection) => ({
          requestItemId: selection.requestItemId,
          skuId: resolvedSkuByItem.get(selection.requestItemId)!.id,
          boxId: selection.boxId,
          quantity: selection.quantity,
        })),
      });
      const selectedBoxes = [...new Set(
        dto.selections
          .map((selection) => {
            const sku = resolvedSkuByItem.get(selection.requestItemId)!;
            return availableBySkuBox.get(`${sku.id}:${selection.boxId}`)?.boxCode;
          })
          .filter((value): value is string => Boolean(value)),
      )];
      await tx.clientRequestEvent.create({
        data: {
          requestId: request.id,
          clientId: request.clientId,
          eventType: ClientRequestEventType.COMMENT,
          title: 'Выбраны короба для списания',
          body: `${selectedBoxes.length} кор.: ${selectedBoxes.join(', ')}`,
          createdByUserId: user.id,
        },
      });
    });

    return this.getManualBoxSelection(id, user);
  }

  async updateStatus(id: string, dto: UpdateClientRequestStatusDto, user: AuthUser) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        warehouseId: true,
        type: true,
        status: true,
        title: true,
        comment: true,
        items: { select: { id: true }, take: 1 },
        packages: {
          where: { comment: 'Фактический короб из аварийного Excel' },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }

    // Русский комментарий: даже менеджер с ограниченным scope не меняет статусы чужого клиента.
    this.clientScopes.requireClientAccess(user, request.clientId, 'write');
    assertWarehouseAccess(user, request, 'write', 'Заявка не найдена в выбранном филиале.');
    if (request.type === ClientRequestType.SKU_COLLECTION) {
      // FIX: status is derived only from atomic SKU scans; manual status changes could strand reserved stock.
      throw new BadRequestException('Статус заявки «Сборка по SKU» изменяется только сканированием на ТСД.');
    }

    const shouldFinalizeStockRequest =
      dto.status === ClientRequestStatus.DONE &&
      (request.type === ClientRequestType.OUTBOUND ||
        (request.type === ClientRequestType.DELIVERY &&
          request.items.length > 0 &&
          isManuallyCreatedStockRequest(request)));

    const updated = shouldFinalizeStockRequest
      ? await this.finalizeOutboundByManualStatus(request, dto, user)
      : await this.prisma.$transaction(async (tx) => {
      const updated = await tx.clientRequest.update({
        where: { id },
        data: {
          status: dto.status,
          managerComment: normalizeText(dto.managerComment),
          assignedToUserId: dto.status === ClientRequestStatus.IN_WORK ? user.id : undefined,
        },
        include: clientRequestInclude,
      });

      if (request.status !== dto.status) {
        await tx.clientRequestEvent.create({
          data: {
            requestId: id,
            clientId: request.clientId,
            eventType: ClientRequestEventType.STATUS_CHANGED,
            title: 'Статус заявки изменен',
            body: normalizeText(dto.managerComment),
            statusFrom: request.status,
            statusTo: dto.status,
            createdByUserId: user.id,
          },
        });

        if (await isClientNotificationEnabled(tx, request.clientId, ClientNotificationEvent.REQUEST_STATUS_CHANGED)) {
          await tx.clientNotification.create({
            data: {
              clientId: request.clientId,
              requestId: id,
              title: 'Статус заявки изменен',
              body: `${request.title}: ${request.status} -> ${dto.status}`,
              severity: 'INFO',
              createdByUserId: user.id,
            },
          });
        }
      }

      return updated;
    });

    if (request.status !== dto.status) {
      void this.telegram?.notifyClient(
        request.clientId,
        [
          'LOGOFF WMS: изменен статус заявки.',
          `Заявка: ${updated.title}`,
          `Город: ${updated.destinationCity ?? '-'}`,
          `Статус: ${request.status} -> ${dto.status}`,
        ].join('\n'),
      );
    }

    return updated;
  }

  /**
   * Resolves a marketplace-status discrepancy without using the marketplace
   * as a warehouse ledger. CONFIRM_DELIVERED is allowed only when an exact,
   * idempotent physical SHIP movement for the WMS request already exists.
   */
  async resolveFbsSynchronization(
    id: string,
    action: FbsSynchronizationResolutionAction,
    requestNumber: number,
    user: AuthUser,
  ) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        title: true,
        clientId: true,
        warehouseId: true,
        status: true,
        type: true,
        items: { select: { quantity: true } },
        fbsOrderLinks: {
          where: { syncStatus: { notIn: ['REMOVED', 'MOVING'] } },
          select: {
            lastCategory: true,
            lastSupplierStatus: true,
          },
        },
      },
    });
    if (!request) {
      throw new NotFoundException('FBS-заявка не найдена.');
    }
    this.clientScopes.requireClientAccess(user, request.clientId, 'write');
    assertWarehouseAccess(user, request, 'write', 'Заявка не найдена в выбранном филиале.');
    if (requestNumber !== request.number) {
      throw new BadRequestException('Введите номер именно этой заявки для подтверждения действия.');
    }
    if (request.type !== ClientRequestType.OUTBOUND || request.fbsOrderLinks.length === 0) {
      throw new BadRequestException('Действие доступно только для FBS-заявки.');
    }

    const hasUndeliveredMarketplaceOrder = request.fbsOrderLinks.some(
      (link) => !['archive', 'cancelled'].includes(link.lastCategory ?? ''),
    );
    if (hasUndeliveredMarketplaceOrder) {
      throw new BadRequestException(
        'В заявке есть заказы, которые ещё не доставлены покупателю. Заявка остаётся в работе.',
      );
    }

    // Marketplace statuses are informational and must never be the source of
    // truth for warehouse balances. A request may be confirmed as delivered
    // by the reconciliation tool only after the physical WMS shipment has
    // already written off exactly the quantity recorded in the request.
    if (action === 'CONFIRM_DELIVERED') {
      const shipped = await this.prisma.stockMovement.aggregate({
        where: {
          sourceDocument: request.id,
          type: MovementType.SHIP,
          quantity: { lt: 0 },
        },
        _sum: { quantity: true },
      });
      const requestQuantity = request.items.reduce(
        (sum, item) => sum + Math.max(0, item.quantity),
        0,
      );
      const shippedQuantity = Math.abs(shipped._sum.quantity ?? 0);
      if (shippedQuantity !== requestQuantity) {
        throw new BadRequestException(
          `Статус Wildberries не может изменить остатки WMS. ` +
            `В заявке ${requestQuantity} ед., физически списано ${shippedQuantity} ед. ` +
            'Закройте заявку действием «Сдано»: WMS спишет товары по фактическому составу заявки. ' +
            'Последующие статусы, отмены и возвраты Wildberries остатки не изменят.',
        );
      }
    }

    const nextStatus =
      action === 'CONFIRM_DELIVERED'
        ? ClientRequestStatus.DONE
        : ClientRequestStatus.IN_WORK;
    const comment =
      action === 'CONFIRM_DELIVERED'
        ? 'Сдача подтверждена после проверки физического списания WMS. Статусы маркетплейса остатки не изменяли.'
        : 'Заявка возвращена в работу по результату проверки FBS. Статусы маркетплейса и остатки не изменялись.';

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.clientRequest.update({
        where: { id: request.id },
        data: {
          status: nextStatus,
          managerComment: comment,
          assignedToUserId: nextStatus === ClientRequestStatus.IN_WORK ? user.id : undefined,
        },
        include: clientRequestInclude,
      });
      if (request.status !== nextStatus) {
        await tx.clientRequestEvent.create({
          data: {
            requestId: request.id,
            clientId: request.clientId,
            eventType: ClientRequestEventType.STATUS_CHANGED,
            title:
              action === 'CONFIRM_DELIVERED'
                ? 'Сдача FBS-заявки подтверждена'
                : 'FBS-заявка возвращена в работу',
            body: comment,
            statusFrom: request.status,
            statusTo: nextStatus,
            createdByUserId: user.id,
          },
        });
      }
      return result;
    });

    return {
      request: updated,
      action,
      stockChanged: false,
      message: comment,
    };
  }

  private async finalizeOutboundByManualStatus(
    request: {
      id: string;
      clientId: string;
      type: ClientRequestType;
      status: ClientRequestStatus;
      title: string;
      comment: string | null;
      packages: Array<{ id: string }>;
    },
    dto: UpdateClientRequestStatusDto,
    user: AuthUser,
  ) {
    const comment = normalizeText(dto.managerComment) ?? 'Заявка сдана вручную; остатки списаны автоматически.';
    const usesRecordedPackages = request.status === ClientRequestStatus.PACKED && request.packages.length > 0;
    const pendingSourceTasks = this.prisma.fbsTsdAssembly?.findMany
      ? await this.prisma.fbsTsdAssembly.findMany({
          where: {
            requestId: request.id,
            status: 'COMPLETED',
            sourceBoxPending: true,
          },
          select: { id: true, orderId: true, requestItemId: true },
        })
      : [];
    if (pendingSourceTasks.length > 0) {
      const sourceItemIds = new Set(
        (dto.stockSources ?? [])
          .filter((source) => source.quantity > 0)
          .map((source) => source.requestItemId),
      );
      const unresolved = pendingSourceTasks.filter(
        (task) => !sourceItemIds.has(task.requestItemId),
      );
      if (unresolved.length > 0) {
        throw new BadRequestException(
          `Для заказов №${unresolved.map((task) => task.orderId).join(', №')} товар был вложен без исходного короба. Укажите фактический короб, откуда он был взят, и повторите закрытие заявки.`,
        );
      }
    }

    if (
      !usesRecordedPackages &&
      request.status !== ClientRequestStatus.DONE &&
      isManuallyCreatedStockRequest(request)
    ) {
      const selectedBoxes = await this.prisma.clientRequestBoxSelection.count({
        where: { requestItem: { requestId: request.id } },
      });
      if (selectedBoxes === 0 && !dto.stockSources?.length) {
        throw new BadRequestException('Сначала нажмите «Выбрать короба» и укажите, откуда списывать товары заявки.');
      }
    }

    const fulfillment = {
      requestId: request.id,
      idempotencyKey: `manual-status-done:${request.id}`,
      comment,
      boxes: dto.boxes,
      pallets: dto.pallets,
      packedUnits: dto.packedUnits,
      packages: dto.packages,
      // FIX: по умолчанию ограничение 25 кг остается обязательным.
      allowOverweightPackages: dto.allowOverweightPackages,
    };
    if (pendingSourceTasks.length > 0 && dto.stockSources?.length) {
      await this.stockOperations.shipClientRequestFromCurrentStock(
        fulfillment,
        user,
        dto.stockSources,
      );
    } else if (usesRecordedPackages) {
      // Аварийное закрытие уже зафиксировало фактические короба, их состав и складские движения.
      // При сдаче повторно ничего не подбираем из остатков: начисления и логистика берутся из этих упаковочных мест.
      await this.stockOperations.shipClientRequest(fulfillment, user);
    } else if (dto.stockSources?.length) {
      await this.stockOperations.shipClientRequestFromCurrentStock(
        fulfillment,
        user,
        dto.stockSources,
      );
    } else {
      await this.stockOperations.shipClientRequestFromCurrentStock(fulfillment, user);
    }

    return this.prisma.$transaction(async (tx) => {
      if (pendingSourceTasks.length > 0) {
        await tx.fbsTsdAssembly.updateMany({
          where: {
            id: { in: pendingSourceTasks.map((task) => task.id) },
            sourceBoxPending: true,
          },
          data: { sourceBoxPending: false },
        });
      }
      const updated = await tx.clientRequest.update({
        where: { id: request.id },
        data: {
          status: ClientRequestStatus.DONE,
          managerComment: comment,
          assignedToUserId: user.id,
        },
        include: clientRequestInclude,
      });

      if (request.status === ClientRequestStatus.DONE) {
        return updated;
      }

      await tx.clientRequestEvent.create({
        data: {
          requestId: request.id,
          clientId: request.clientId,
          eventType: ClientRequestEventType.STATUS_CHANGED,
          title: 'Статус заявки изменен',
          body: comment,
          statusFrom: request.status,
          statusTo: ClientRequestStatus.DONE,
          createdByUserId: user.id,
        },
      });

      if (await isClientNotificationEnabled(tx, request.clientId, ClientNotificationEvent.REQUEST_STATUS_CHANGED)) {
        await tx.clientNotification.create({
          data: {
            clientId: request.clientId,
            requestId: request.id,
            title: 'Статус заявки изменен',
            body: `${request.title}: ${request.status} -> ${ClientRequestStatus.DONE}`,
            severity: 'INFO',
            createdByUserId: user.id,
          },
        });
      }

      return updated;
    });
  }

  async cancel(id: string, user: AuthUser) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id },
      select: { id: true, clientId: true, warehouseId: true, type: true, status: true, title: true },
    });

    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'write');
    assertWarehouseAccess(user, request, 'write', 'Заявка не найдена в выбранном филиале.');
    if (request.type === ClientRequestType.SKU_COLLECTION) {
      throw new BadRequestException('Эту заявку нельзя отменить из общего списка: сначала завершите сборку и повторную приёмку.');
    }

    if (request.status === ClientRequestStatus.CANCELLED) {
      return this.get(id, user);
    }

    if (!clientCancelableStatuses.has(request.status)) {
      throw new BadRequestException('Заявку нельзя отменить: склад уже начал обработку.');
    }

    const notifyClient = await isClientNotificationEnabled(this.prisma, request.clientId, ClientNotificationEvent.REQUEST_STATUS_CHANGED);
    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.clientRequest.update({
        where: { id },
        data: {
          status: ClientRequestStatus.CANCELLED,
          managerComment: 'Отменено клиентом.',
          assignedToUserId: null,
        },
        include: clientRequestInclude,
      });

      await tx.clientRequestEvent.create({
        data: {
          requestId: id,
          clientId: request.clientId,
          eventType: ClientRequestEventType.STATUS_CHANGED,
          title: 'Заявка отменена клиентом',
          body: 'Отменено клиентом.',
          statusFrom: request.status,
          statusTo: ClientRequestStatus.CANCELLED,
          createdByUserId: user.id,
        },
      });

      if (notifyClient) {
        await tx.clientNotification.create({
          data: {
            clientId: request.clientId,
            requestId: id,
            title: 'Заявка отменена клиентом',
            body: request.title,
            severity: 'WARNING',
            createdByUserId: user.id,
          },
        });
      }

      return updated;
    });

    if (notifyClient) {
      void this.telegram?.notifyClient(
        request.clientId,
        ['LOGOFF WMS: заявка отменена.', `Заявка: ${updated.title}`, `Статус: ${request.status} -> ${ClientRequestStatus.CANCELLED}`].join('\n'),
      );
    }

    return updated;
  }

  private async ensureSkuItemsBelongToClient(clientId: string, items: Array<{ skuId?: string }>) {
    const skuIds = [...new Set(items.map((item) => item.skuId).filter(Boolean))] as string[];
    if (skuIds.length === 0) {
      return;
    }

    const foundSkus = await this.prisma.sku.findMany({
      where: {
        id: { in: skuIds },
        clientId,
      },
      select: { id: true },
    });

    if (foundSkus.length !== skuIds.length) {
      throw new BadRequestException('Одна или несколько SKU в заявке не принадлежат выбранному клиенту.');
    }
  }

  private nonOutboundAvailabilityLine(
    item: { skuId?: string; barcode?: string; name?: string; quantity: number },
    index: number,
  ): ClientRequestAvailabilityLine {
    return {
      index,
      skuId: normalizeText(item.skuId) ?? null,
      internalSku: null,
      name: normalizeText(item.name) ?? null,
      barcode: normalizeText(item.barcode) ?? null,
      requestedQuantity: item.quantity,
      stockQuantity: 0,
      reservedQuantity: 0,
      availableQuantity: item.quantity,
      shortageQuantity: 0,
      canFulfill: true,
      conflicts: [],
    };
  }

  private async resolveAvailabilityItems(
    clientId: string,
    items: Array<{ skuId?: string; barcode?: string; name?: string; quantity: number }>,
  ): Promise<Array<Omit<ClientRequestAvailabilityLine, 'stockQuantity' | 'reservedQuantity' | 'availableQuantity' | 'shortageQuantity' | 'canFulfill' | 'conflicts'>>> {
    const skuIds = [...new Set(items.map((item) => normalizeText(item.skuId)).filter(Boolean))] as string[];
    const barcodes = [...new Set(items.map((item) => normalizeText(item.barcode)).filter(Boolean))] as string[];
    const [skus, barcodeRows] = await Promise.all([
      skuIds.length
        ? this.prisma.sku.findMany({
            where: { id: { in: skuIds }, clientId },
            select: { id: true, internalSku: true, name: true },
          })
        : Promise.resolve([]),
      barcodes.length
        ? this.prisma.barcode.findMany({
            where: { value: { in: barcodes }, sku: { clientId } },
            include: { sku: { select: { id: true, internalSku: true, name: true } } },
          })
        : Promise.resolve([]),
    ]);
    const skuById = new Map(skus.map((sku) => [sku.id, sku]));
    const barcodeByValue = new Map(barcodeRows.map((row) => [row.value, row]));

    return items.map((item, index) => {
      const barcode = normalizeText(item.barcode) ?? null;
      const sku = (item.skuId ? skuById.get(item.skuId) : null) ?? (barcode ? barcodeByValue.get(barcode)?.sku : null);

      return {
        index,
        skuId: sku?.id ?? null,
        internalSku: sku?.internalSku ?? null,
        name: sku?.name ?? normalizeText(item.name) ?? null,
        barcode,
        requestedQuantity: item.quantity,
      };
    });
  }

  private async stockQuantityBySkuId(
    clientId: string,
    skuIds: string[],
    warehouseId: string,
    includeLegacyUnassigned = false,
  ) {
    if (skuIds.length === 0) {
      return new Map<string, number>();
    }

    const stockRows = await this.prisma.stockBalance.groupBy({
      by: ['skuId'],
      where: {
        clientId,
        skuId: { in: skuIds },
        status: StockStatus.AVAILABLE,
        quantity: { gt: 0 },
        ...(includeLegacyUnassigned
          ? {
              OR: [
                { box: { warehouseId } },
                { box: { warehouseId: null } },
              ],
            }
          : { box: { warehouseId } }),
      },
      _sum: { quantity: true },
    });

    return new Map(stockRows.map((row) => [row.skuId, Number(row._sum.quantity ?? 0)]));
  }

  private async activeReservationBySkuId(
    clientId: string,
    skuIds: string[],
    barcodes: string[],
    excludeRequestId: string | undefined,
    warehouseId: string,
    includeLegacyUnassigned = false,
  ) {
    const empty = new Map<string, { quantity: number; requests: ClientRequestAvailabilityConflict[] }>();
    if (skuIds.length === 0 && barcodes.length === 0) {
      return empty;
    }

    const requests = await this.prisma.clientRequest.findMany({
      where: {
        clientId,
        ...(includeLegacyUnassigned
          ? { OR: [{ warehouseId }, { warehouseId: null }] }
          : { warehouseId }),
        ...(excludeRequestId?.trim() ? { id: { not: excludeRequestId.trim() } } : {}),
        type: ClientRequestType.OUTBOUND,
        status: { in: activeRequestStatuses },
        items: {
          some: {
            OR: [
              ...(skuIds.length ? [{ skuId: { in: skuIds } }] : []),
              ...(barcodes.length ? [{ barcode: { in: barcodes } }] : []),
            ],
          },
        },
      },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        createdAt: true,
        desiredDate: true,
        items: {
          where: {
            OR: [
              ...(skuIds.length ? [{ skuId: { in: skuIds } }] : []),
              ...(barcodes.length ? [{ barcode: { in: barcodes } }] : []),
            ],
          },
          select: {
            skuId: true,
            barcode: true,
            quantity: true,
          },
        },
      },
    });
    const barcodeToSkuId = await this.barcodeToSkuId(clientId, barcodes);
    const result = new Map<string, { quantity: number; requests: ClientRequestAvailabilityConflict[] }>();

    requests.forEach((request) => {
      request.items.forEach((item) => {
        const skuId = item.skuId ?? (item.barcode ? barcodeToSkuId.get(item.barcode) : undefined);
        if (!skuId) {
          return;
        }

        const current = result.get(skuId) ?? { quantity: 0, requests: [] };
        current.quantity += item.quantity;
        const conflict = current.requests.find((entry) => entry.requestId === request.id);
        if (conflict) {
          conflict.quantity += item.quantity;
        } else {
          current.requests.push({
            requestId: request.id,
            title: request.title,
            type: request.type,
            status: request.status,
            createdAt: request.createdAt.toISOString(),
            desiredDate: request.desiredDate?.toISOString() ?? null,
            quantity: item.quantity,
          });
        }
        result.set(skuId, current);
      });
    });

    return result;
  }

  private async isPrimaryMoscowWarehouse(warehouseId: string) {
    const primaryWarehouse = await this.prisma.warehouse.findUnique({
      where: { code: 'MSK' },
      select: { id: true },
    });
    return primaryWarehouse?.id === warehouseId;
  }

  private async resolveRequestWarehouse(
    clientId: string,
    requestedWarehouseId: string | undefined,
    user: AuthUser,
  ) {
    const scopedWarehouseId = effectiveWarehouseId(user, 'write');
    const warehouseId = scopedWarehouseId ?? (user.roleCodes.includes('CLIENT')
      ? requestedWarehouseId?.trim()
      : user.activeWarehouseId || requestedWarehouseId?.trim());
    if (!warehouseId) {
      throw new BadRequestException('Выберите филиал для заявки.');
    }
    if (
      !user.roleCodes.includes('CLIENT') &&
      user.activeWarehouseId &&
      requestedWarehouseId &&
      requestedWarehouseId !== user.activeWarehouseId
    ) {
      throw new ForbiddenException('Заявку можно создать только в выбранном филиале.');
    }
    const link = await this.prisma.warehouseClient.findFirst({
      where: {
        warehouseId,
        clientId,
        status: 'ACTIVE',
        warehouse: { isActive: true },
      },
      select: { clientId: true },
    });
    if (!link) {
      throw new BadRequestException('Клиент не активен в выбранном филиале.');
    }
    return warehouseId;
  }

  private async barcodeToSkuId(clientId: string, barcodes: string[]) {
    if (barcodes.length === 0) {
      return new Map<string, string>();
    }

    const rows = await this.prisma.barcode.findMany({
      where: { value: { in: barcodes }, sku: { clientId } },
      select: { value: true, skuId: true },
    });

    return new Map(rows.map((row) => [row.value, row.skuId]));
  }
}

export type ClientRequestAvailabilityConflict = {
  requestId: string;
  title: string;
  type: ClientRequestType;
  status: ClientRequestStatus;
  createdAt: string;
  desiredDate: string | null;
  quantity: number;
};

export type ClientRequestAvailabilityLine = {
  index: number;
  skuId: string | null;
  internalSku: string | null;
  name: string | null;
  barcode: string | null;
  requestedQuantity: number;
  stockQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  shortageQuantity: number;
  canFulfill: boolean;
  conflicts: ClientRequestAvailabilityConflict[];
};

export type ClientRequestAvailabilityPreview = {
  clientId: string;
  type: ClientRequestType;
  canCommit: boolean;
  summary: {
    lines: number;
    requestedQuantity: number;
    stockQuantity: number;
    reservedQuantity: number;
    availableQuantity: number;
    shortageQuantity: number;
    conflictsCount: number;
  };
  lines: ClientRequestAvailabilityLine[];
};

const activeRequestStatuses = [
  ClientRequestStatus.SUBMITTED,
  ClientRequestStatus.IN_REVIEW,
  ClientRequestStatus.APPROVED,
  ClientRequestStatus.IN_WORK,
  ClientRequestStatus.PACKED,
];

const clientCancelableStatuses = new Set<ClientRequestStatus>([
  ClientRequestStatus.SUBMITTED,
  ClientRequestStatus.IN_REVIEW,
  ClientRequestStatus.APPROVED,
]);

const clientEditableStatuses = new Set<ClientRequestStatus>([
  ClientRequestStatus.SUBMITTED,
  ClientRequestStatus.IN_REVIEW,
  ClientRequestStatus.APPROVED,
]);

const manualBoxSelectionEditableStatuses = new Set<ClientRequestStatus>([
  ClientRequestStatus.SUBMITTED,
  ClientRequestStatus.IN_REVIEW,
  ClientRequestStatus.APPROVED,
  ClientRequestStatus.IN_WORK,
]);

const manualSelectionStockStatuses: StockStatus[] = [
  StockStatus.SHIPPING,
  StockStatus.PACKING,
  StockStatus.AVAILABLE,
];

function isManuallyCreatedStockRequest(request: { type: ClientRequestType; comment?: string | null }) {
  return (
    (request.type === ClientRequestType.OUTBOUND || request.type === ClientRequestType.DELIVERY) &&
    !request.comment?.toLocaleLowerCase('ru-RU').includes('создано из excel:')
  );
}

function assertManualBoxSelectionRequest(request: {
  type: ClientRequestType;
  comment?: string | null;
  items?: Array<unknown>;
  pickWaveRequests?: Array<{ wave: { status: string } }>;
}) {
  if (!isManuallyCreatedStockRequest(request) || !request.items?.length) {
    throw new BadRequestException('Ручной выбор коробов доступен для товарных заявок «Отгрузка» и «Доставка», созданных вручную.');
  }

  const hasActiveWave = request.pickWaveRequests?.some(
    ({ wave }) => wave.status !== 'DONE' && wave.status !== 'CANCELLED',
  );
  if (hasActiveWave) {
    throw new BadRequestException('Заявка уже включена в волну сборки. Выбор коробов нужно выполнять до запуска волны.');
  }
}

function assertStockSourceResolutionRequest(request: {
  type: ClientRequestType;
  items?: Array<unknown>;
}) {
  if (
    (request.type !== ClientRequestType.OUTBOUND &&
      request.type !== ClientRequestType.DELIVERY) ||
    !request.items?.length
  ) {
    throw new BadRequestException(
      'Фактический источник можно указать только для товарной заявки «Отгрузка» или «Доставка».',
    );
  }
}

function canEditClientRequestAnyStatus(user: AuthUser) {
  return user.permissionCodes.includes('system:admin') || user.roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER'].includes(role));
}

function parseFbsOrderIds(comment: string | null) {
  const value = comment?.match(/FBS-(?:заказы|orders)\s*:\s*(.+)$/iu)?.[1] ?? '';
  return value
    .split(',')
    .map((orderId) => orderId.trim())
    .filter(Boolean);
}

function naturalOrderIdCompare(left: string, right: string) {
  return left.localeCompare(right, 'ru-RU', { numeric: true, sensitivity: 'base' });
}

function formatFbsOrderIds(orderIds: string[]) {
  return orderIds.map((orderId) => `№${orderId}`).join(', ');
}

const clientRequestInclude = {
  warehouse: {
    select: {
      id: true,
      code: true,
      name: true,
      city: true,
    },
  },
  client: {
    select: {
      id: true,
      code: true,
      name: true,
      storesWithoutBoxes: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  assignedTo: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  items: {
    include: {
      sku: {
        select: {
          id: true,
          internalSku: true,
          name: true,
        },
      },
    },
    orderBy: {
      id: 'asc',
    },
  },
  files: {
    select: clientRequestFileSummarySelect,
    orderBy: {
      createdAt: 'desc',
    },
  },
  packages: {
    include: clientRequestPackageInclude,
    orderBy: {
      createdAt: 'asc',
    },
  },
  _count: {
    select: {
      fbsOrderLinks: true,
    },
  },
} satisfies Prisma.ClientRequestInclude;

function normalizeText(value?: string) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeRequiredText(value: string | undefined, message: string) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new BadRequestException(message);
  }
  return normalized;
}
