import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientNotificationEvent, ClientRequestEventType, ClientRequestStatus, ClientRequestType, Prisma, StockStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { isClientNotificationEnabled } from '../client-notifications/client-notification-preferences';
import { TelegramNotificationService } from '../client-notifications/telegram-notification.service';
import { StockOperationsService } from '../stock/stock-operations.service';
import { clientRequestFileSummarySelect } from './client-request-files.service';
import { clientRequestPackageInclude } from './client-request-packages.include';
import { CreateClientRequestDto } from './dto/create-client-request.dto';
import { ListClientRequestsDto } from './dto/list-client-requests.dto';
import { PreviewClientRequestAvailabilityDto } from './dto/preview-client-request-availability.dto';
import { UpdateClientRequestDto } from './dto/update-client-request.dto';
import { UpdateClientRequestBoxSelectionDto } from './dto/update-client-request-box-selection.dto';
import { UpdateClientRequestStatusDto } from './dto/update-client-request-status.dto';

@Injectable()
export class ClientRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly stockOperations: StockOperationsService,
    private readonly telegram?: TelegramNotificationService,
  ) {}

  list(query: ListClientRequestsDto, user: AuthUser) {
    const boxCode = query.boxCode?.trim();
    const where: Prisma.ClientRequestWhereInput = {
      clientId: this.clientScopes.resolveClientFilter(user, query.clientId),
      status:
        query.status ??
        (query.archive
          ? ClientRequestStatus.DONE
          : { not: ClientRequestStatus.DONE }),
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

    return this.prisma.clientRequest.findMany({
      where,
      include: clientRequestInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
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
    return request;
  }

  async previewAvailability(dto: PreviewClientRequestAvailabilityDto, user: AuthUser): Promise<ClientRequestAvailabilityPreview> {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
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
    const stockBySkuId = await this.stockQuantityBySkuId(dto.clientId, skuIds);
    const reservationsBySkuId = await this.activeReservationBySkuId(dto.clientId, skuIds, barcodes, dto.excludeRequestId);

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
    await this.ensureSkuItemsBelongToClient(dto.clientId, dto.items ?? []);
    const destinationCity = normalizeRequiredText(dto.destinationCity, 'Город поставки обязателен.');

    // Русский комментарий: клиентская заявка всегда стартует как SUBMITTED; статусы меняет отдельный workflow.
    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.clientRequest.create({
        data: {
          clientId: dto.clientId,
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
      select: { id: true, clientId: true, status: true },
    });

    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'write');

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
    assertManualBoxSelectionRequest(request);

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
    const [balances, savedSelections] = await Promise.all([
      skuIds.length
        ? this.prisma.stockBalance.findMany({
            where: {
              clientId: request.clientId,
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
    ]);

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
          boxes: [...boxes.values()].sort((left, right) => left.boxCode.localeCompare(right.boxCode, 'ru')),
        };
      }),
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

    if (
      !usesRecordedPackages &&
      request.status !== ClientRequestStatus.DONE &&
      isManuallyCreatedStockRequest(request)
    ) {
      const selectedBoxes = await this.prisma.clientRequestBoxSelection.count({
        where: { requestItem: { requestId: request.id } },
      });
      if (selectedBoxes === 0) {
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
    };
    if (usesRecordedPackages) {
      // Аварийное закрытие уже зафиксировало фактические короба, их состав и складские движения.
      // При сдаче повторно ничего не подбираем из остатков: начисления и логистика берутся из этих упаковочных мест.
      await this.stockOperations.shipClientRequest(fulfillment, user);
    } else {
      await this.stockOperations.shipClientRequestFromCurrentStock(fulfillment, user);
    }

    return this.prisma.$transaction(async (tx) => {
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
      select: { id: true, clientId: true, status: true, title: true },
    });

    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'write');

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

  private async stockQuantityBySkuId(clientId: string, skuIds: string[]) {
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
      },
      _sum: { quantity: true },
    });

    return new Map(stockRows.map((row) => [row.skuId, Number(row._sum.quantity ?? 0)]));
  }

  private async activeReservationBySkuId(clientId: string, skuIds: string[], barcodes: string[], excludeRequestId?: string) {
    const empty = new Map<string, { quantity: number; requests: ClientRequestAvailabilityConflict[] }>();
    if (skuIds.length === 0 && barcodes.length === 0) {
      return empty;
    }

    const requests = await this.prisma.clientRequest.findMany({
      where: {
        clientId,
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

function canEditClientRequestAnyStatus(user: AuthUser) {
  return user.permissionCodes.includes('system:admin') || user.roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER'].includes(role));
}

const clientRequestInclude = {
  client: {
    select: {
      id: true,
      code: true,
      name: true,
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
