import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingUnit, MovementType, Prisma, StockStatus, TsdOperationStatus, TsdReviewReason } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryLockService } from '../../common/inventory/inventory-lock.service';
import { receiptDateFromBoxCode } from '../../common/receipt-batches';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { BillingService } from '../billing/billing.service';
import { TelegramNotificationService } from '../client-notifications/telegram-notification.service';
import { StockBalancesService } from '../stock/stock-balances.service';
import { StockOperationsService } from '../stock/stock-operations.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpsertBoxDto } from './dto/upsert-box.dto';
import { UpsertPalletDto } from './dto/upsert-pallet.dto';

@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly balances: StockBalancesService,
    private readonly stockOperations: StockOperationsService,
    private readonly telegram: TelegramNotificationService,
    private readonly billing: BillingService,
    private readonly inventoryLock?: InventoryLockService,
  ) {}

  listWarehouses() {
    return this.prisma.warehouse.findMany({
      include: { zones: true },
      orderBy: { code: 'asc' },
    });
  }

  createWarehouse(dto: CreateWarehouseDto) {
    return this.prisma.warehouse.create({
      data: {
        code: dto.code.trim(),
        name: dto.name.trim(),
      },
    });
  }

  listZones(warehouseId?: string) {
    return this.prisma.zone.findMany({
      where: { warehouseId },
      include: { warehouse: true },
      orderBy: [{ warehouseId: 'asc' }, { code: 'asc' }],
    });
  }

  createZone(dto: CreateZoneDto) {
    // Русский комментарий: зоны нужны уже в MVP, стеллажи оставляем как следующий уровень адресации.
    return this.prisma.zone.create({
      data: {
        warehouseId: dto.warehouseId,
        code: dto.code.trim(),
        name: dto.name.trim(),
      },
    });
  }

  listBoxes(filter: { clientId?: string; code?: string }, user: AuthUser) {
    const where: Prisma.BoxWhereInput = {
      clientId: this.clientScopes.resolveClientFilter(user, filter.clientId),
      code: filter.code ? { contains: filter.code, mode: 'insensitive' } : undefined,
      status: { notIn: ['deleted', 'archived'] },
    };

    return this.prisma.box.findMany({
      where,
      include: {
        client: true,
        zone: true,
        pallet: true,
        _count: { select: { balances: true, movements: true } },
      },
      orderBy: { code: 'asc' },
      take: 200,
    });
  }

  async listOnlineReceipts(filter: { clientId?: string }, user: AuthUser) {
    const clientId = stringField(filter.clientId, 'clientId');
    this.clientScopes.requireClientAccess(user, clientId, 'read');

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, onlineReceiptVisibleToClient: true },
    });
    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }
    if (!canReadOnlineReceipt(user) && !client.onlineReceiptVisibleToClient) {
      throw new ForbiddenException('Онлайн-приемка не открыта в кабинете этого клиента.');
    }

    const since = new Date(Date.now() - 1000 * 60 * 60 * 72);
    const operations = (
      await this.prisma.tsdOperation.findMany({
        where: {
          operationType: { in: ['receipt_open_box', 'receipt_box_status', 'receipt_scan'] },
          OR: [
            { createdAt: { gte: since } },
            { operationType: 'receipt_open_box' },
            { operationType: 'receipt_box_status' },
          ],
          payload: { path: ['clientId'], equals: clientId },
        },
        // Fetch newest rows first so the operation cap cannot hide the current receipt batch.
        orderBy: { createdAt: 'desc' },
        take: 10000,
      })
    ).reverse();

    const sourceDocuments = [
      ...new Set(operations.map((operation) => stringFromPayload(operation.payload, 'sourceDocument')).filter(Boolean)),
    ];
    const operationBoxCodes = [
      ...new Set(operations.map((operation) => normalizeBoxCode(stringFromPayload(operation.payload, 'boxCode'))).filter(Boolean)),
    ];
    const receivingBoxes = await this.prisma.box.findMany({
      where: { clientId, status: 'receiving' },
      select: { code: true },
      orderBy: { code: 'asc' },
      take: 500,
    });
    const receivingBoxCodes = receivingBoxes.map((box) => box.code);

    const movementWhere: Prisma.StockMovementWhereInput = {
      clientId,
      type: MovementType.RECEIPT,
      OR: [
        sourceDocuments.length ? { sourceDocument: { in: sourceDocuments } } : undefined,
        { sourceDocument: { startsWith: 'TSD-RECEIPT-' }, createdAt: { gte: since } },
        operationBoxCodes.length ? { box: { code: { in: operationBoxCodes } } } : undefined,
      ].filter(Boolean) as Prisma.StockMovementWhereInput[],
    };

    const movements = await this.prisma.stockMovement.findMany({
      where: movementWhere,
      include: {
        box: true,
        sku: {
          include: {
            barcodes: {
              select: { value: true, isPrimary: true },
            },
          },
        },
        productMarks: {
          select: {
            id: true,
            value: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 3000,
    });

    const boxCodes = [
      ...new Set(
        [
          ...operationBoxCodes,
          ...receivingBoxCodes,
          ...movements.map((movement) => movement.box?.code ?? '').filter(Boolean),
        ].filter(Boolean),
      ),
    ];
    const boxes = boxCodes.length
      ? await this.prisma.box.findMany({
          where: { clientId, code: { in: boxCodes } },
          include: {
            balances: {
              include: {
                sku: {
                  include: {
                    barcodes: {
                      select: { value: true, isPrimary: true },
                    },
                  },
                },
              },
            },
            productMarks: {
              select: {
                id: true,
                skuId: true,
                value: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        })
      : [];

    const actors = await this.resolveTsdActors(operations.map((operation) => operation.deviceId));
    const operationActors = new Map(
      operations.map((operation) => [operation.id, actors.get(operation.deviceId) ?? actorFallback(operation.deviceId)]),
    );

    const boxMap = new Map<string, OnlineReceiptBoxBuilder>();
    const ensureBox = (boxCode: string, sourceDocument?: string | null) => {
      const safeBoxCode = normalizeBoxCode(boxCode);
      const safeSourceDocument = text(sourceDocument);
      const key = safeBoxCode;
      const existing = boxMap.get(key);
      if (existing) {
        attachSourceDocument(existing, safeSourceDocument);
        return existing;
      }
      const box = boxes.find((item) => item.code === safeBoxCode) ?? null;
      const created: OnlineReceiptBoxBuilder = {
        key,
        boxId: box?.id ?? null,
        boxCode: safeBoxCode,
        sourceDocument: safeSourceDocument,
        status: box?.status ?? 'receiving',
        firstSeenAt: null,
        lastSeenAt: null,
        openedAt: null,
        closedAt: null,
        deletedAt: null,
        operator: null,
        deviceCode: null,
        sourceDocuments: [],
        items: [],
        currentBalances: [],
        kizValues: [],
      };
      attachSourceDocument(created, safeSourceDocument);
      boxMap.set(key, created);
      return created;
    };

    operations.forEach((operation) => {
      const payload = recordFromJson(operation.payload);
      const boxCode = text(payload.boxCode);
      if (!boxCode) {
        return;
      }
      const sourceDocument = text(payload.sourceDocument);
      const box = ensureBox(boxCode, sourceDocument);
      const actor = operationActors.get(operation.id) ?? actorFallback(operation.deviceId);
      box.firstSeenAt = minIso(box.firstSeenAt, operation.createdAt);
      box.lastSeenAt = maxIso(box.lastSeenAt, operation.createdAt);
      box.operator = actor.name;
      box.deviceCode = actor.deviceCode;
      if (operation.operationType === 'receipt_open_box') {
        box.openedAt = maxIso(box.openedAt, operation.createdAt);
        if (box.status !== 'active') {
          box.status = 'receiving';
        }
      }
      if (operation.operationType === 'receipt_box_status') {
        const status = text(payload.status);
        if (status) {
          box.status = status;
        }
        if (status === 'active') {
          box.closedAt = maxIso(box.closedAt, operation.createdAt);
        }
        if (status === 'receiving') {
          box.openedAt = maxIso(box.openedAt, operation.createdAt);
        }
        if (status === 'deleted') {
          box.deletedAt = maxIso(box.deletedAt, operation.createdAt);
          const snapshotItems = snapshotItemsFromPayload(payload);
          if (snapshotItems.length > 0) {
            box.items = snapshotItems.map((item, index) =>
              snapshotToOnlineReceiptItem(item, {
                operationId: operation.id,
                index,
                createdAt: operation.createdAt.toISOString(),
                operatorName: actor.name,
                deviceCode: actor.deviceCode,
              }),
            );
          }
        }
      }
    });

    const operationByScanKey = new Map<string, (typeof operations)[number]>();
    const forcedReceiptOperationByMovementKey = new Map<string, (typeof operations)[number]>();
    operations
      .filter((operation) => operation.operationType === 'receipt_scan')
      .forEach((operation) => {
        const payload = recordFromJson(operation.payload);
        operationByScanKey.set(receiptScanKey(payload), operation);
        if (isReceiptAcceptedWithError(operation)) {
          forcedReceiptOperationByMovementKey.set(`${operation.operationKey}:accepted-with-error`, operation);
        }
      });

    movements.forEach((movement) => {
      if (!movement.box?.code) {
        return;
      }
      const sourceDocument = movement.sourceDocument ?? '';
      const box = ensureBox(movement.box.code, sourceDocument);
      if (box.status === 'deleted' && box.items.length > 0) {
        return;
      }
      const operation =
        (movement.idempotencyKey ? forcedReceiptOperationByMovementKey.get(movement.idempotencyKey) : undefined) ??
        operationByScanKey.get(
          receiptScanKey({
            sourceDocument,
            boxCode: movement.box.code,
            barcode: primaryBarcode(movement.sku),
            kiz: movement.productMarks[0]?.value ?? '',
          }),
        );
      const operationPayload = operation ? recordFromJson(operation.payload) : {};
      const acceptedWithError = operation ? isReceiptAcceptedWithError(operation) : false;
      const actor = operation ? operationActors.get(operation.id) ?? actorFallback(operation.deviceId) : null;
      box.firstSeenAt = minIso(box.firstSeenAt, movement.createdAt);
      box.lastSeenAt = maxIso(box.lastSeenAt, movement.createdAt);
      if (actor) {
        box.operator = actor.name;
        box.deviceCode = actor.deviceCode;
      }
      box.items.push({
        movementId: movement.id,
        skuId: movement.skuId,
        barcode: primaryBarcode(movement.sku),
        name: movement.sku.name,
        article: movement.sku.article ?? movement.sku.internalSku,
        color: movement.sku.color,
        size: movement.sku.size,
        quantity: movement.quantity,
        kiz: movement.productMarks[0]?.value ?? (acceptedWithError ? text(operationPayload.kiz) || null : null),
        kizId: movement.productMarks[0]?.id ?? null,
        hasError: acceptedWithError,
        errorMessage: acceptedWithError ? operation?.resolutionMessage ?? operation?.serverMessage ?? 'Принято с ошибкой' : null,
        duplicateBoxCode: acceptedWithError
          ? duplicateBoxCode(operation?.resolutionMessage ?? operation?.serverMessage ?? '')
          : null,
        status: movement.status,
        sourceDocument: sourceDocument,
        createdAt: movement.createdAt.toISOString(),
        operatorName: actor?.name ?? box.operator,
        deviceCode: actor?.deviceCode ?? box.deviceCode,
      });
    });

    boxes.forEach((box) => {
      const sourceDocument =
        sourceDocuments.find((document) =>
          operations.some((operation) => {
            const payload = recordFromJson(operation.payload);
            return text(payload.sourceDocument) === document && normalizeBoxCode(text(payload.boxCode)) === box.code;
          }),
        ) ?? movements.find((movement) => movement.boxId === box.id)?.sourceDocument ?? '';
      const onlineBox = ensureBox(box.code, sourceDocument);
      onlineBox.boxId = box.id;
      onlineBox.status = box.status;
      onlineBox.currentBalances = box.balances.map((balance) => ({
        balanceId: balance.id,
        skuId: balance.skuId,
        barcode: primaryBarcode(balance.sku),
        name: balance.sku.name,
        quantity: balance.quantity,
        status: balance.status,
      }));
      onlineBox.kizValues = box.productMarks
        .filter((mark) => mark.status === StockStatus.AVAILABLE)
        .map((mark) => ({
          id: mark.id,
          skuId: mark.skuId,
          value: mark.value,
          status: mark.status,
        }));
    });

    const allBoxes = [...boxMap.values()]
      .map((box) => ({
        ...box,
        sourceDocument: box.sourceDocument || box.sourceDocuments[0] || '',
        firstSeenAt: box.firstSeenAt,
        lastSeenAt: box.lastSeenAt,
        openedAt: box.openedAt,
        closedAt: box.closedAt,
        deletedAt: box.deletedAt,
        totalQuantity: box.currentBalances.reduce((sum, item) => sum + item.quantity, 0) || box.items.reduce((sum, item) => sum + item.quantity, 0),
        kizCount: box.kizValues.length || box.items.filter((item) => Boolean(item.kiz)).length,
        items: box.items.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      }));
    const receiptBoxes = allBoxes
      .filter((box) => !['deleted', 'archived'].includes(box.status))
      .sort(compareOnlineReceiptBoxes);
    const currentBatchDate = receiptBoxes[0]
      ? receiptDateFromBoxCode(receiptBoxes[0].boxCode, onlineReceiptActivityDate(receiptBoxes[0]))
      : null;
    const resultBoxes = currentBatchDate
      ? receiptBoxes.filter(
          (box) => receiptDateFromBoxCode(box.boxCode, onlineReceiptActivityDate(box)) === currentBatchDate,
        )
      : [];
    const activeBoxCodes = new Set(resultBoxes.map((box) => box.boxCode));
    const deletedBoxes = allBoxes
      .filter((box) => box.status === 'deleted' && !activeBoxCodes.has(box.boxCode))
      .sort((left, right) => (right.deletedAt ?? right.lastSeenAt ?? '').localeCompare(left.deletedAt ?? left.lastSeenAt ?? ''));

    const receipts = [...new Map(resultBoxes.map((box) => [box.sourceDocument || box.key, box])).keys()].map((sourceDocument) => {
      const sourceBoxes = resultBoxes.filter((box) => (box.sourceDocument || box.key) === sourceDocument);
      return {
        sourceDocument,
        boxes: sourceBoxes.length,
        quantity: sourceBoxes.reduce((sum, box) => sum + box.totalQuantity, 0),
        kizCount: sourceBoxes.reduce((sum, box) => sum + box.kizCount, 0),
        firstSeenAt: sourceBoxes.reduce<string | null>((value, box) => minIso(value, box.firstSeenAt), null),
        lastSeenAt: sourceBoxes.reduce<string | null>((value, box) => maxIso(value, box.lastSeenAt), null),
        operators: [...new Set(sourceBoxes.map((box) => box.operator).filter(Boolean))],
        devices: [...new Set(sourceBoxes.map((box) => box.deviceCode).filter(Boolean))],
      };
    });

    return {
      clientId,
      generatedAt: new Date().toISOString(),
      currentBatchDate,
      receipts,
      boxes: resultBoxes,
      deletedBoxes,
    };
  }

  async listReceiptBatches(filter: { clientId?: string }, user: AuthUser) {
    const clientId = stringField(filter.clientId, 'clientId');
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        clientId,
        type: MovementType.RECEIPT,
        quantity: { gt: 0 },
        box: { code: { startsWith: 'FFL_LKB', mode: Prisma.QueryMode.insensitive } },
      },
      select: {
        quantity: true,
        createdAt: true,
        box: { select: { code: true } },
        _count: { select: { productMarks: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50000,
    });
    const groups = new Map<string, { date: string; boxCodes: Set<string>; quantity: number; kizCount: number }>();
    for (const movement of movements) {
      const date = receiptDateFromBoxCode(movement.box?.code ?? '', movement.createdAt);
      const group = groups.get(date) ?? { date, boxCodes: new Set<string>(), quantity: 0, kizCount: 0 };
      if (movement.box?.code) group.boxCodes.add(movement.box.code);
      group.quantity += movement.quantity;
      group.kizCount += movement._count.productMarks;
      groups.set(date, group);
    }
    return [...groups.values()]
      .sort((left, right) => right.date.localeCompare(left.date))
      .map((group) => ({
        id: `${clientId}:${group.date}`,
        date: group.date,
        title: `${formatReceiptDate(group.date)} приемка`,
        boxes: group.boxCodes.size,
        quantity: group.quantity,
        kizCount: group.kizCount,
        boxCodes: [...group.boxCodes].sort((left, right) => left.localeCompare(right, 'ru', { numeric: true })),
      }));
  }

  async listGoodsArrivals(filter: { clientId?: string; periodFrom?: string; periodTo?: string }, user: AuthUser) {
    const clientId = stringField(filter.clientId, 'clientId');
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const rows = await this.prisma.auditLog.findMany({
      where: { entity: 'goods-arrival', entityId: clientId, action: 'warehouse.goods-arrival' },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    return rows
      .map(goodsArrivalFromAudit)
      .filter((row) => row.status !== 'CANCELLED')
      .filter((row) => !filter.periodFrom || row.arrivalDate >= filter.periodFrom)
      .filter((row) => !filter.periodTo || row.arrivalDate <= filter.periodTo);
  }

  async createGoodsArrival(dto: Record<string, unknown>, user: AuthUser) {
    const clientId = stringField(dto.clientId, 'clientId');
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    const arrivalDate = isoDateField(dto.arrivalDate, 'arrivalDate');
    const bagCount = nonNegativeInteger(dto.bagCount, 'bagCount');
    const boxCount = nonNegativeInteger(dto.boxCount, 'boxCount');
    if (bagCount + boxCount <= 0) {
      throw new BadRequestException('Укажите количество мешков или коробов больше нуля.');
    }
    const created = await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'warehouse.goods-arrival',
        entity: 'goods-arrival',
        entityId: clientId,
        payload: {
          clientId,
          arrivalDate,
          bagCount,
          boxCount,
          comment: optionalString(dto.comment) ?? null,
          status: 'ACTIVE',
          createdByName: user.name,
        },
      },
    });
    return goodsArrivalFromAudit(created);
  }

  async deleteGoodsArrival(id: string, user: AuthUser) {
    const existing = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!existing || existing.entity !== 'goods-arrival') throw new NotFoundException('Приход товара не найден.');
    const row = goodsArrivalFromAudit(existing);
    this.clientScopes.requireClientAccess(user, row.clientId, 'write');
    if (row.billingInvoiceId) throw new BadRequestException('Приход уже включен в счет. Сначала отмените счет или исправьте его в биллинге.');
    const updated = await this.prisma.auditLog.update({
      where: { id },
      data: { payload: { ...recordFromJson(existing.payload), status: 'CANCELLED', cancelledByUserId: user.id } },
    });
    return goodsArrivalFromAudit(updated);
  }

  async billGoodsArrivals(dto: Record<string, unknown>, user: AuthUser) {
    const clientId = stringField(dto.clientId, 'clientId');
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    const periodFrom = isoDateField(dto.periodFrom, 'periodFrom');
    const periodTo = isoDateField(dto.periodTo, 'periodTo');
    if (periodFrom > periodTo) throw new BadRequestException('Начало периода не может быть позже окончания.');
    const arrivals = (await this.listGoodsArrivals({ clientId, periodFrom, periodTo }, user)).filter((row) => !row.billingInvoiceId);
    const bagCount = arrivals.reduce((sum, row) => sum + row.bagCount, 0);
    const boxCount = arrivals.reduce((sum, row) => sum + row.boxCount, 0);
    if (bagCount + boxCount <= 0) throw new BadRequestException('За выбранный период нет невыставленных приходов товара.');

    const services = await this.ensurePprServices();
    const rows = [
      bagCount > 0
        ? { serviceId: services.bags.id, description: 'ПРР: услуги грузчика, мешки', unit: BillingUnit.PIECE, quantity: bagCount }
        : null,
      boxCount > 0
        ? { serviceId: services.boxes.id, description: 'ПРР: услуги грузчика, короба', unit: BillingUnit.BOX, quantity: boxCount }
        : null,
    ].filter((row): row is NonNullable<typeof row> => Boolean(row));
    const invoice = await this.billing.createManualInvoice(
      { clientId, periodFrom, periodTo, comment: `ПРР за период ${periodFrom} - ${periodTo}`, rows },
      user,
    );
    for (const arrival of arrivals) {
      const audit = await this.prisma.auditLog.findUnique({ where: { id: arrival.id } });
      if (!audit) continue;
      await this.prisma.auditLog.update({
        where: { id: arrival.id },
        data: { payload: { ...recordFromJson(audit.payload), billingInvoiceId: invoice.id, billedAt: new Date().toISOString() } },
      });
    }
    return invoice;
  }

  async goodsArrivalSummary(clientIdValue: unknown, user: AuthUser) {
    const clientId = stringField(clientIdValue, 'clientId');
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const latestPaid = await this.prisma.billingInvoice.findFirst({
      where: {
        clientId,
        status: 'PAID',
        items: { some: { charge: { service: { code: { in: ['PPR_BAGS', 'PPR_BOXES'] } } } } },
      },
      orderBy: [{ paidAt: 'desc' }, { updatedAt: 'desc' }],
      select: { paidAt: true, periodTo: true },
    });
    const monthStart = new Date();
    monthStart.setDate(1);
    const periodFrom = toIsoDate(latestPaid?.paidAt ?? latestPaid?.periodTo ?? monthStart);
    const periodTo = toIsoDate(new Date());
    const arrivals = await this.listGoodsArrivals({ clientId, periodFrom, periodTo }, user);
    const bagCount = arrivals.reduce((sum, row) => sum + row.bagCount, 0);
    const boxCount = arrivals.reduce((sum, row) => sum + row.boxCount, 0);
    const services = await this.ensurePprServices();
    const prices = await this.prisma.clientBillingService.findMany({
      where: { clientId, serviceId: { in: [services.bags.id, services.boxes.id] }, isActive: true },
      select: { serviceId: true, priceRub: true, taxMode: true },
    });
    const priceByService = new Map(prices.map((price) => [price.serviceId, price]));
    const bagPrice = pprPrice(priceByService.get(services.bags.id));
    const boxPrice = pprPrice(priceByService.get(services.boxes.id));
    return {
      clientId,
      periodFrom,
      periodTo,
      bagCount,
      boxCount,
      bagPriceRub: bagPrice,
      boxPriceRub: boxPrice,
      estimatedRub: roundMoney(bagCount * bagPrice + boxCount * boxPrice),
      pricesConfigured: bagPrice > 0 || boxPrice > 0,
    };
  }

  private async ensurePprServices() {
    const [bags, boxes] = await Promise.all([
      this.prisma.billingService.upsert({
        where: { code: 'PPR_BAGS' },
        update: { name: 'ПРР: услуги грузчика, мешки', unit: BillingUnit.PIECE, isActive: true },
        create: { code: 'PPR_BAGS', name: 'ПРР: услуги грузчика, мешки', unit: BillingUnit.PIECE, isActive: true },
      }),
      this.prisma.billingService.upsert({
        where: { code: 'PPR_BOXES' },
        update: { name: 'ПРР: услуги грузчика, короба', unit: BillingUnit.BOX, isActive: true },
        create: { code: 'PPR_BOXES', name: 'ПРР: услуги грузчика, короба', unit: BillingUnit.BOX, isActive: true },
      }),
    ]);
    return { bags, boxes };
  }

  async openOnlineReceiptBox(dto: Record<string, unknown>, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    const clientId = stringField(dto.clientId, 'clientId');
    const boxCode = requireFflBoxCode(stringField(dto.boxCode, 'boxCode'));
    const sourceDocument = optionalString(dto.sourceDocument) || `WEB-RECEIPT-${dateStamp()}-${boxCode}`;
    this.clientScopes.requireClientAccess(user, clientId, 'write');

    let box: { id: string; code: string; status: string };
    try {
      box = await this.prisma.$transaction(async (tx) => {
        const existingBox = await tx.box.findFirst({
          where: { code: boxCode },
          select: { id: true, clientId: true, status: true },
        });

        if (existingBox) {
          throw new BadRequestException(
            existingBox.status === 'deleted'
              ? `Номер короба ${boxCode} уже использовался и был удален. Восстановите его или отсканируйте новый уникальный номер.`
              : `Короб ${boxCode} уже был пропикан. Повторное использование номера запрещено.`,
          );
        }

        return tx.box.create({ data: { clientId, code: boxCode, status: 'receiving' } });
      });
    } catch (caught) {
      if (isPrismaUniqueConflict(caught)) {
        throw new BadRequestException(`Короб ${boxCode} уже был пропикан. Повторное использование номера запрещено.`);
      }
      throw caught;
    }
    await this.recordReceiptAdminOperation('receipt_open_box', user, {
      clientId,
      boxCode,
      sourceDocument,
      status: 'receiving',
      comment: optionalString(dto.comment) || 'Короб открыт из онлайн-приемки WMS.',
    });

    return { boxId: box.id, boxCode, status: box.status, sourceDocument };
  }

  async closeOnlineReceiptBox(dto: Record<string, unknown>, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    return this.setOnlineReceiptBoxStatus(dto, user, 'active');
  }

  async closeOpenOnlineReceiptBoxes(dto: Record<string, unknown>, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    const clientId = stringField(dto.clientId, 'clientId');
    this.clientScopes.requireClientAccess(user, clientId, 'write');

    const requestedBatchDate = optionalString(dto.batchDate);
    const candidateBoxes = await this.prisma.box.findMany({
      where: { clientId, status: 'receiving' },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    });
    const boxes = requestedBatchDate
      ? candidateBoxes.filter((box) => receiptDateFromBoxCode(box.code, new Date()) === requestedBatchDate)
      : candidateBoxes;
    if (boxes.length === 0) {
      return { closed: 0, boxes: [] };
    }

    const comment = optionalString(dto.comment) || 'Все открытые короба закрыты из онлайн-приемки WMS.';
    await this.prisma.$transaction(async (tx) => {
      await tx.box.updateMany({
        where: { id: { in: boxes.map((box) => box.id) } },
        data: { status: 'active' },
      });

      for (const box of boxes) {
        await this.recordReceiptAdminOperation(
          'receipt_box_status',
          user,
          {
            clientId,
            boxCode: box.code,
            status: 'active',
            comment,
          },
          tx,
        );
      }
    });

    return { closed: boxes.length, boxes: boxes.map((box) => box.code), status: 'active' };
  }

  async finishOnlineReceipt(dto: Record<string, unknown>, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    const clientId = stringField(dto.clientId, 'clientId');
    this.clientScopes.requireClientAccess(user, clientId, 'write');

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true },
    });
    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }

    const todayStart = moscowDayStartUtc(new Date());
    const requestedBatchDate = optionalString(dto.batchDate);
    const candidateBoxes = await this.prisma.box.findMany({
      where: {
        clientId,
        status: { notIn: ['deleted', 'archived'] },
        OR: [
          { status: 'receiving' },
          {
            movements: {
              some: {
                clientId,
                type: MovementType.RECEIPT,
                createdAt: { gte: todayStart },
              },
            },
          },
        ],
      },
      select: { id: true, code: true, status: true },
      orderBy: { code: 'asc' },
    });
    const boxes = requestedBatchDate
      ? candidateBoxes.filter((box) => receiptDateFromBoxCode(box.code, new Date()) === requestedBatchDate)
      : candidateBoxes;
    if (boxes.length === 0) {
      throw new BadRequestException('Нет открытых или сегодняшних коробов приемки для завершения.');
    }

    const boxIds = boxes.map((box) => box.id);
    const [movementGroups, balanceGroups, kizCount] = await Promise.all([
      this.prisma.stockMovement.groupBy({
        by: ['boxId', 'skuId', 'status'],
        where: {
          clientId,
          type: MovementType.RECEIPT,
          boxId: { in: boxIds },
        },
        _sum: { quantity: true },
      }),
      this.prisma.stockBalance.groupBy({
        by: ['boxId', 'skuId', 'status'],
        where: {
          clientId,
          boxId: { in: boxIds },
        },
        _sum: { quantity: true },
      }),
      this.prisma.productMark.count({
        where: {
          clientId,
          boxId: { in: boxIds },
          status: StockStatus.AVAILABLE,
        },
      }),
    ]);

    const balanceByKey = new Map(
      balanceGroups.map((row) => [receiptBalanceKey(row.boxId, row.skuId, row.status), row._sum.quantity ?? 0]),
    );
    const verificationErrors = movementGroups
      .map((row) => {
        const expected = row._sum.quantity ?? 0;
        const actual = balanceByKey.get(receiptBalanceKey(row.boxId, row.skuId, row.status)) ?? 0;
        return actual >= expected
          ? null
          : {
              boxId: row.boxId,
              skuId: row.skuId,
              status: row.status,
              expected,
              actual,
            };
      })
      .filter(isVerificationError);

    if (verificationErrors.length > 0) {
      throw new BadRequestException({
        message: 'Приемку нельзя завершить: не все строки попали в остатки.',
        errors: verificationErrors.slice(0, 20),
      });
    }

    const closedBoxes = boxes.filter((box) => box.status === 'receiving');
    const totalQuantity = balanceGroups.reduce((sum, row) => sum + (row._sum.quantity ?? 0), 0);
    const finishedAt = new Date();
    const comment = optionalString(dto.comment) || 'Приемка завершена из онлайн-приемки WMS.';
    await this.prisma.$transaction(async (tx) => {
      if (closedBoxes.length > 0) {
        await tx.box.updateMany({
          where: { id: { in: closedBoxes.map((box) => box.id) } },
          data: { status: 'active' },
        });
      }

      for (const box of closedBoxes) {
        await this.recordReceiptAdminOperation(
          'receipt_box_status',
          user,
          {
            clientId,
            boxCode: box.code,
            status: 'active',
            comment,
          },
          tx,
        );
      }

      await this.recordReceiptAdminOperation(
        'receipt_finish',
        user,
        {
          clientId,
          status: 'finished',
          boxes: boxes.length,
          closedBoxes: closedBoxes.length,
          quantity: totalQuantity,
          kizCount,
          finishedAt: finishedAt.toISOString(),
          comment,
        },
        tx,
      );

      await tx.clientNotification.create({
        data: {
          clientId,
          title: 'Приемка товара завершена',
          body: `Приемка завершена. Коробов: ${boxes.length}, единиц: ${totalQuantity}, КИЗ: ${kizCount}.`,
          severity: 'SUCCESS',
          createdByUserId: user.id,
        },
      });
    });

    const telegram = await this.telegram.notifyClient(
      clientId,
      [
        'LOGOFF WMS: приемка товара завершена.',
        `Клиент: ${client.name}`,
        `Коробов: ${boxes.length}`,
        `Единиц: ${totalQuantity}`,
        `КИЗ: ${kizCount}`,
      ].join('\n'),
    );

    return {
      finished: true,
      finishedAt: finishedAt.toISOString(),
      boxes: boxes.length,
      closedBoxes: closedBoxes.length,
      quantity: totalQuantity,
      kizCount,
      telegram,
    };
  }

  async deleteOnlineReceiptBox(dto: Record<string, unknown>, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    const clientId = stringField(dto.clientId, 'clientId');
    const boxCode = requireFflBoxCode(stringField(dto.boxCode, 'boxCode'));
    this.clientScopes.requireClientAccess(user, clientId, 'write');

    await this.prisma.$transaction(async (tx) => {
      const box = await tx.box.findUnique({
        where: { clientId_code: { clientId, code: boxCode } },
        include: {
          balances: {
            include: {
              sku: {
                include: {
                  barcodes: {
                    select: { value: true, isPrimary: true },
                  },
                },
              },
            },
          },
          productMarks: true,
        },
      });
      if (!box) {
        throw new NotFoundException(`Короб ${boxCode} не найден.`);
      }

      const snapshotItems = snapshotItemsFromBox(box);

      await removeOnlineReceiptBoxData(tx, box.id);
      await this.recordReceiptAdminOperation(
        'receipt_box_status',
        user,
        {
          clientId,
          boxCode,
          sourceDocument: optionalString(dto.sourceDocument),
          status: 'deleted',
          snapshotStatus: box.status,
          snapshotItems,
          comment: optionalString(dto.comment) || 'Короб удален администратором.',
        },
        tx,
      );
    });

    return { boxCode, status: 'deleted' };
  }

  async restoreOnlineReceiptBox(dto: Record<string, unknown>, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    const clientId = stringField(dto.clientId, 'clientId');
    const boxCode = requireFflBoxCode(stringField(dto.boxCode, 'boxCode'));
    this.clientScopes.requireClientAccess(user, clientId, 'write');

    const existingBox = await this.prisma.box.findUnique({
      where: { clientId_code: { clientId, code: boxCode } },
      select: { id: true, status: true },
    });
    if (existingBox && existingBox.status !== 'deleted') {
      throw new BadRequestException(`Короб ${boxCode} уже есть в активных остатках.`);
    }

    const deletedOperation = await this.findLatestDeletedReceiptBoxOperation(clientId, boxCode);
    if (!deletedOperation) {
      throw new NotFoundException(`Нет данных удаления для короба ${boxCode}.`);
    }

    const payload = recordFromJson(deletedOperation.payload);
    const sourceDocument = optionalString(payload.sourceDocument) || `RESTORE-RECEIPT-${dateStamp()}-${boxCode}`;
    const snapshotItems = snapshotItemsFromPayload(payload);
    const restoreItems = snapshotItems.length
      ? snapshotItems
      : await this.restoreItemsFromReceiptOperations(clientId, boxCode, deletedOperation.createdAt);

    if (restoreItems.length === 0) {
      throw new BadRequestException(`У короба ${boxCode} нет сохраненного состава для восстановления.`);
    }

    if (existingBox?.status === 'deleted') {
      await this.prisma.$transaction((tx) => removeOnlineReceiptBoxData(tx, existingBox.id));
    }

    for (const [index, item] of restoreItems.entries()) {
      await this.stockOperations.receiveIntoBox(
        {
          clientId,
          boxCode,
          barcode: item.barcode,
          skuId: item.skuId,
          kiz: item.kiz,
          quantity: item.quantity,
          status: item.status ?? StockStatus.AVAILABLE,
          sourceDocument: item.sourceDocument || sourceDocument,
          idempotencyKey: `online-receipt-restore:${deletedOperation.id}:${index}`,
          comment: `Восстановление удаленного короба ${boxCode}.`,
        },
        user,
      );
    }

    await this.setOnlineReceiptBoxStatus(
      {
        clientId,
        boxCode,
        sourceDocument,
        comment: `Короб ${boxCode} восстановлен из онлайн-приемки.`,
      },
      user,
      text(payload.snapshotStatus) || 'active',
    );

    return { boxCode, status: text(payload.snapshotStatus) || 'active', restoredItems: restoreItems.length };
  }

  async addOnlineReceiptItem(dto: Record<string, unknown>, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    const clientId = stringField(dto.clientId, 'clientId');
    const boxCode = requireFflBoxCode(stringField(dto.boxCode, 'boxCode'));
    const barcode = optionalString(dto.barcode);
    const skuId = optionalString(dto.skuId);
    const quantity = positiveInteger(dto.quantity ?? 1, 'quantity');
    const kiz = optionalString(dto.kiz);
    const sourceDocument = optionalString(dto.sourceDocument) || `WEB-RECEIPT-${dateStamp()}-${boxCode}`;
    validateReceiptProductBarcode(barcode);
    validateReceiptKiz(kiz);
    this.clientScopes.requireClientAccess(user, clientId, 'write');

    await this.prisma.box.upsert({
      where: { clientId_code: { clientId, code: boxCode } },
      update: { status: 'receiving' },
      create: { clientId, code: boxCode, status: 'receiving' },
    });

    const result = await this.stockOperations.receiveIntoBox(
      {
        clientId,
        boxCode,
        barcode,
        skuId,
        kiz,
        quantity,
        status: StockStatus.AVAILABLE,
        sourceDocument,
        idempotencyKey: `online-receipt-add:${clientId}:${boxCode}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        comment: optionalString(dto.comment) || `Онлайн-приемка WMS: ${user.name}`,
      },
      user,
    );

    await this.recordReceiptAdminOperation('receipt_scan', user, {
      clientId,
      boxCode,
      barcode,
      skuId,
      kiz,
      quantity,
      status: StockStatus.AVAILABLE,
      sourceDocument,
      comment: optionalString(dto.comment) || 'Строка добавлена администратором в онлайн-приемке.',
    });

    return result;
  }

  async updateOnlineReceiptItem(id: string, dto: Record<string, unknown>, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    const quantity = dto.quantity === undefined ? undefined : positiveInteger(dto.quantity, 'quantity');
    const kiz = dto.kiz === undefined ? undefined : optionalString(dto.kiz) ?? '';
    validateReceiptKiz(kiz || undefined);

    return this.prisma.$transaction(async (tx) => {
      const movement = await tx.stockMovement.findUnique({
        where: { id },
        include: { box: true, productMarks: true },
      });
      if (!movement || movement.type !== MovementType.RECEIPT || !movement.boxId || !movement.box) {
        throw new NotFoundException('Строка приемки не найдена.');
      }
      this.clientScopes.requireClientAccess(user, movement.clientId, 'write');

      if (quantity !== undefined && quantity !== movement.quantity) {
        await this.adjustBalanceQuantity(tx, {
          clientId: movement.clientId,
          skuId: movement.skuId,
          boxId: movement.boxId,
          palletId: movement.palletId,
          status: movement.status,
          delta: quantity - movement.quantity,
        });
        await tx.stockMovement.update({ where: { id }, data: { quantity } });
      }

      if (kiz !== undefined) {
        const existingMark = movement.productMarks[0];
        if (existingMark && kiz) {
          await tx.productMark.update({ where: { id: existingMark.id }, data: { value: kiz } });
        } else if (existingMark && !kiz) {
          await tx.productMark.delete({ where: { id: existingMark.id } });
        } else if (!existingMark && kiz) {
          await tx.productMark.create({
            data: {
              clientId: movement.clientId,
              skuId: movement.skuId,
              boxId: movement.boxId,
              stockMovementId: movement.id,
              value: kiz,
              sourceDocument: movement.sourceDocument,
              status: movement.status,
            },
          });
        }
      }

      await this.recordReceiptAdminOperation(
        'receipt_scan',
        user,
        {
          clientId: movement.clientId,
          boxCode: movement.box.code,
          quantity: quantity ?? movement.quantity,
          kiz,
          sourceDocument: movement.sourceDocument,
          status: movement.status,
          comment: optionalString(dto.comment) || 'Строка приемки изменена администратором.',
        },
        tx,
      );

      return { id, updated: true };
    });
  }

  async deleteOnlineReceiptItem(id: string, dto: Record<string, unknown>, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    return this.prisma.$transaction(async (tx) => {
      const movement = await tx.stockMovement.findUnique({
        where: { id },
        include: { box: true, productMarks: true },
      });
      if (!movement || movement.type !== MovementType.RECEIPT || !movement.boxId || !movement.box) {
        throw new NotFoundException('Строка приемки не найдена.');
      }
      this.clientScopes.requireClientAccess(user, movement.clientId, 'write');

      await this.adjustBalanceQuantity(tx, {
        clientId: movement.clientId,
        skuId: movement.skuId,
        boxId: movement.boxId,
        palletId: movement.palletId,
        status: movement.status,
        delta: -movement.quantity,
      });
      await tx.productMark.deleteMany({ where: { stockMovementId: movement.id } });
      await tx.stockMovement.delete({ where: { id } });

      await this.recordReceiptAdminOperation(
        'receipt_scan',
        user,
        {
          clientId: movement.clientId,
          boxCode: movement.box.code,
          quantity: -movement.quantity,
          sourceDocument: movement.sourceDocument,
          status: movement.status,
          comment: optionalString(dto.comment) || 'Строка приемки удалена администратором.',
        },
        tx,
      );

      return { id, deleted: true };
    });
  }

  private async setOnlineReceiptBoxStatus(dto: Record<string, unknown>, user: AuthUser, status: string) {
    const clientId = stringField(dto.clientId, 'clientId');
    const boxCode = requireFflBoxCode(stringField(dto.boxCode, 'boxCode'));
    this.clientScopes.requireClientAccess(user, clientId, 'write');

    const box = await this.prisma.box.upsert({
      where: { clientId_code: { clientId, code: boxCode } },
      update: { status },
      create: { clientId, code: boxCode, status },
    });
    await this.recordReceiptAdminOperation('receipt_box_status', user, {
      clientId,
      boxCode,
      sourceDocument: optionalString(dto.sourceDocument),
      status,
      comment: optionalString(dto.comment) || (status === 'active' ? 'Короб закрыт из онлайн-приемки WMS.' : 'Короб открыт из онлайн-приемки WMS.'),
    });

    return { boxId: box.id, boxCode, status };
  }

  private async adjustBalanceQuantity(
    tx: Prisma.TransactionClient,
    input: {
      clientId: string;
      skuId: string;
      boxId: string;
      palletId?: string | null;
      status: StockStatus;
      delta: number;
    },
  ) {
    if (input.delta === 0) {
      return;
    }

    const balance = await tx.stockBalance.findFirst({
      where: {
        clientId: input.clientId,
        skuId: input.skuId,
        boxId: input.boxId,
        status: input.status,
      },
    });

    if (!balance && input.delta < 0) {
      throw new BadRequestException('В коробе нет такого остатка для удаления.');
    }

    if (!balance) {
      await tx.stockBalance.create({
        data: {
          balanceKey: this.balances.balanceKey(input),
          clientId: input.clientId,
          skuId: input.skuId,
          boxId: input.boxId,
          palletId: input.palletId,
          status: input.status,
          quantity: input.delta,
        },
      });
      return;
    }

    const nextQuantity = balance.quantity + input.delta;
    if (nextQuantity < 0) {
      throw new BadRequestException('Нельзя удалить больше товара, чем сейчас числится в коробе.');
    }
    if (nextQuantity === 0) {
      await tx.stockBalance.delete({ where: { id: balance.id } });
      return;
    }
    await tx.stockBalance.update({ where: { id: balance.id }, data: { quantity: nextQuantity } });
  }

  private findLatestDeletedReceiptBoxOperation(clientId: string, boxCode: string) {
    return this.prisma.tsdOperation.findFirst({
      where: {
        operationType: 'receipt_box_status',
        payload: {
          path: ['clientId'],
          equals: clientId,
        },
      },
      orderBy: { createdAt: 'desc' },
    }).then((operation) => {
      if (!operation) {
        return null;
      }
      const payload = recordFromJson(operation.payload);
      if (normalizeBoxCode(text(payload.boxCode)) === boxCode && text(payload.status) === 'deleted') {
        return operation;
      }
      return this.findDeletedReceiptBoxOperationByScan(clientId, boxCode);
    });
  }

  private async findDeletedReceiptBoxOperationByScan(clientId: string, boxCode: string) {
    const operations = await this.prisma.tsdOperation.findMany({
      where: {
        operationType: 'receipt_box_status',
        payload: {
          path: ['clientId'],
          equals: clientId,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return (
      operations.find((operation) => {
        const payload = recordFromJson(operation.payload);
        return normalizeBoxCode(text(payload.boxCode)) === boxCode && text(payload.status) === 'deleted';
      }) ?? null
    );
  }

  private async restoreItemsFromReceiptOperations(clientId: string, boxCode: string, deletedAt: Date) {
    const operations = await this.prisma.tsdOperation.findMany({
      where: {
        operationType: 'receipt_scan',
        createdAt: { lte: deletedAt },
        payload: {
          path: ['clientId'],
          equals: clientId,
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 3000,
    });

    return operations
      .map((operation): ReceiptRestoreItem | null => {
        const payload = recordFromJson(operation.payload);
        if (normalizeBoxCode(text(payload.boxCode)) !== boxCode) {
          return null;
        }
        const quantity = Number(payload.quantity ?? 1);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return null;
        }
        return {
          skuId: optionalString(payload.skuId),
          barcode: optionalString(payload.barcode),
          quantity: Math.trunc(quantity),
          kiz: optionalString(payload.kiz),
          status: normalizeStockStatus(payload.status) ?? StockStatus.AVAILABLE,
          sourceDocument: optionalString(payload.sourceDocument),
        } satisfies ReceiptRestoreItem;
      })
      .filter(isReceiptRestoreItem);
  }

  private async recordReceiptAdminOperation(
    operationType: string,
    user: AuthUser,
    payload: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const deviceId = user.deviceCode || `WEB:${user.email}`;
    await tx.tsdOperation.create({
      data: {
        deviceId,
        operationKey: `${operationType}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        operationType,
        payload: compactJson(payload),
        status: 'ACCEPTED',
        serverMessage: optionalString(payload.comment) || 'Операция онлайн-приемки WMS.',
      },
    });
  }

  private async resolveTsdActors(deviceIds: string[]) {
    const codes = [...new Set(deviceIds.map((value) => text(value)).filter(Boolean))];
    const actors = new Map<string, TsdActor>();
    if (codes.length === 0) {
      return actors;
    }

    const devices = await this.prisma.tsdDevice.findMany({
      where: { code: { in: codes } },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
    devices.forEach((device) => {
      actors.set(device.code, {
        deviceCode: device.code,
        deviceName: device.name,
        name: device.user.name,
        userEmail: device.user.email,
      });
    });

    const userCodes = codes.filter((code) => code.startsWith('USER:') && !actors.has(code));
    if (userCodes.length > 0) {
      const emails = userCodes.map((code) => code.slice(5));
      const users = await this.prisma.user.findMany({
        where: { email: { in: emails } },
        select: { email: true, name: true },
      });
      users.forEach((userRow) => {
        const code = `USER:${userRow.email}`;
        actors.set(code, {
          deviceCode: code,
          deviceName: 'ТСД по логину',
          name: userRow.name,
          userEmail: userRow.email,
        });
      });
    }

    return actors;
  }

  upsertBox(dto: UpsertBoxDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');

    return this.prisma.box.upsert({
      where: {
        clientId_code: {
          clientId: dto.clientId,
          code: dto.code.trim(),
        },
      },
      update: {
        zoneId: dto.zoneId,
        palletId: dto.palletId,
      },
      create: {
        clientId: dto.clientId,
        code: dto.code.trim(),
        zoneId: dto.zoneId,
        palletId: dto.palletId,
      },
      include: {
        zone: true,
        pallet: true,
      },
    });
  }

  listPallets(clientId: string | undefined, user: AuthUser) {
    return this.prisma.pallet.findMany({
      where: { clientId: this.clientScopes.resolveClientFilter(user, clientId) },
      include: {
        client: true,
        zone: true,
        boxes: true,
        _count: { select: { balances: true } },
      },
      orderBy: { code: 'asc' },
      take: 200,
    });
  }

  upsertPallet(dto: UpsertPalletDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');

    return this.prisma.pallet.upsert({
      where: {
        clientId_code: {
          clientId: dto.clientId,
          code: dto.code.trim(),
        },
      },
      update: {
        zoneId: dto.zoneId,
      },
      create: {
        clientId: dto.clientId,
        code: dto.code.trim(),
        zoneId: dto.zoneId,
      },
      include: {
        zone: true,
      },
    });
  }
}

type TsdActor = {
  deviceCode: string;
  deviceName: string;
  name: string;
  userEmail?: string;
};

type OnlineReceiptBoxBuilder = {
  key: string;
  boxId: string | null;
  boxCode: string;
  sourceDocument: string;
  status: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  openedAt: string | null;
  closedAt: string | null;
  deletedAt: string | null;
  operator: string | null;
  deviceCode: string | null;
  sourceDocuments: string[];
  items: OnlineReceiptItem[];
  currentBalances: Array<{
    balanceId: string;
    skuId: string;
    barcode: string;
    name: string;
    quantity: number;
    status: StockStatus;
  }>;
  kizValues: Array<{
    id: string;
    skuId: string;
    value: string;
    status: StockStatus;
  }>;
};

type OnlineReceiptItem = {
  movementId: string;
  skuId: string;
  barcode: string;
  name: string;
  article: string;
  color: string | null;
  size: string | null;
  quantity: number;
  kiz: string | null;
  kizId: string | null;
  hasError: boolean;
  errorMessage: string | null;
  duplicateBoxCode: string | null;
  status: StockStatus;
  sourceDocument: string;
  createdAt: string;
  operatorName: string | null;
  deviceCode: string | null;
};

type ReceiptRestoreItem = {
  skuId?: string;
  barcode?: string;
  name?: string;
  article?: string;
  color?: string | null;
  size?: string | null;
  quantity: number;
  kiz?: string;
  status?: StockStatus;
  sourceDocument?: string;
};

function attachSourceDocument(box: OnlineReceiptBoxBuilder, sourceDocument: string) {
  if (!sourceDocument) {
    return;
  }
  if (!box.sourceDocument) {
    box.sourceDocument = sourceDocument;
  }
  if (!box.sourceDocuments.includes(sourceDocument)) {
    box.sourceDocuments.push(sourceDocument);
  }
}

function snapshotItemsFromBox(box: {
  balances: Array<{
    skuId: string;
    status: StockStatus;
    quantity: number;
    sku: {
      name: string;
      article: string | null;
      internalSku: string;
      color: string | null;
      size: string | null;
      barcodes: Array<{ value: string; isPrimary: boolean }>;
    };
  }>;
  productMarks: Array<{ skuId: string; value: string; status: StockStatus; sourceDocument: string | null }>;
}) {
  const marksBySku = new Map<string, typeof box.productMarks>();
  box.productMarks
    .filter((mark) => mark.status === StockStatus.AVAILABLE)
    .forEach((mark) => {
      const list = marksBySku.get(mark.skuId) ?? [];
      list.push(mark);
      marksBySku.set(mark.skuId, list);
    });

  return box.balances.flatMap((balance) => {
    const base = {
      skuId: balance.skuId,
      barcode: primaryBarcode(balance.sku),
      name: balance.sku.name,
      article: balance.sku.article ?? balance.sku.internalSku,
      color: balance.sku.color,
      size: balance.sku.size,
      status: balance.status,
    };
    const marks = marksBySku.get(balance.skuId) ?? [];
    if (marks.length > 0) {
      return marks.map((mark) => ({
        ...base,
        quantity: 1,
        kiz: mark.value,
        sourceDocument: mark.sourceDocument ?? undefined,
      }));
    }
    return [
      {
        ...base,
        quantity: balance.quantity,
      },
    ];
  });
}

function snapshotItemsFromPayload(payload: Record<string, unknown>) {
  const items = Array.isArray(payload.snapshotItems) ? payload.snapshotItems : [];
  return items
    .map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item): ReceiptRestoreItem | null => {
      const quantity = Number(item.quantity ?? 1);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return null;
      }
      return {
        skuId: optionalString(item.skuId),
        barcode: optionalString(item.barcode),
        name: optionalString(item.name),
        article: optionalString(item.article),
        color: optionalString(item.color) ?? null,
        size: optionalString(item.size) ?? null,
        quantity: Math.trunc(quantity),
        kiz: optionalString(item.kiz),
        status: normalizeStockStatus(item.status) ?? StockStatus.AVAILABLE,
        sourceDocument: optionalString(item.sourceDocument),
      } satisfies ReceiptRestoreItem;
    })
    .filter(isReceiptRestoreItem);
}

function isReceiptRestoreItem(item: ReceiptRestoreItem | null): item is ReceiptRestoreItem {
  return Boolean(item);
}

function snapshotToOnlineReceiptItem(
  item: ReceiptRestoreItem,
  meta: { operationId: string; index: number; createdAt: string; operatorName: string | null; deviceCode: string | null },
): OnlineReceiptItem {
  return {
    movementId: `deleted:${meta.operationId}:${meta.index}`,
    skuId: item.skuId ?? '',
    barcode: item.barcode ?? '',
    name: item.name ?? item.barcode ?? item.skuId ?? 'Товар',
    article: item.article ?? '',
    color: item.color ?? null,
    size: item.size ?? null,
    quantity: item.quantity,
    kiz: item.kiz ?? null,
    kizId: null,
    hasError: false,
    errorMessage: null,
    duplicateBoxCode: null,
    status: item.status ?? StockStatus.AVAILABLE,
    sourceDocument: item.sourceDocument ?? '',
    createdAt: meta.createdAt,
    operatorName: meta.operatorName,
    deviceCode: meta.deviceCode,
  };
}

function normalizeStockStatus(value: unknown) {
  const status = text(value);
  return Object.values(StockStatus).includes(status as StockStatus) ? (status as StockStatus) : null;
}

function canReadOnlineReceipt(user: AuthUser) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes('warehouse:read');
}

function recordFromJson(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringFromPayload(payload: Prisma.JsonValue | null | undefined, key: string) {
  return text(recordFromJson(payload)[key]);
}

function stringField(value: unknown, field: string) {
  const result = text(value);
  if (!result) {
    throw new BadRequestException(`Поле ${field} обязательно.`);
  }
  return result;
}

function optionalString(value: unknown) {
  const result = text(value);
  return result || undefined;
}

function positiveInteger(value: unknown, field: string) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`Поле ${field} должно быть положительным целым числом.`);
  }
  return parsed;
}

function nonNegativeInteger(value: unknown, field: string) {
  const parsed = value == null || value === '' ? 0 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException(`Поле ${field} должно быть целым числом от 0.`);
  }
  return parsed;
}

function isoDateField(value: unknown, field: string) {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(new Date(`${result}T00:00:00.000Z`).getTime())) {
    throw new BadRequestException(`Поле ${field} должно содержать дату в формате ГГГГ-ММ-ДД.`);
  }
  return result;
}

function goodsArrivalFromAudit(row: { id: string; payload: Prisma.JsonValue | null; createdAt: Date; userId: string | null }) {
  const payload = recordFromJson(row.payload);
  return {
    id: row.id,
    clientId: text(payload.clientId),
    arrivalDate: text(payload.arrivalDate),
    bagCount: Number(payload.bagCount) || 0,
    boxCount: Number(payload.boxCount) || 0,
    comment: text(payload.comment) || null,
    status: text(payload.status) || 'ACTIVE',
    billingInvoiceId: text(payload.billingInvoiceId) || null,
    createdByName: text(payload.createdByName) || null,
    createdByUserId: row.userId,
    createdAt: row.createdAt.toISOString(),
  };
}

function formatReceiptDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function pprPrice(value?: { priceRub: Prisma.Decimal; taxMode: string } | null) {
  const price = Number(value?.priceRub ?? 0);
  return value?.taxMode === 'ADD_6_PERCENT' ? roundMoney((price / 94) * 100) : roundMoney(price);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function text(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function normalizeBoxCode(value: string) {
  return value.trim().toLocaleUpperCase('ru-RU');
}

function isPrismaUniqueConflict(value: unknown) {
  return Boolean(value && typeof value === 'object' && 'code' in value && value.code === 'P2002');
}

function requireFflBoxCode(value: string) {
  const boxCode = normalizeBoxCode(value);
  if (!isFflBoxCode(boxCode)) {
    throw new BadRequestException('Номер короба должен начинаться с FFL. Отсканируйте корректный ШК короба.');
  }
  return boxCode;
}

function validateReceiptProductBarcode(value: string | undefined) {
  if (!value) {
    return;
  }
  if (isFflBoxCode(value)) {
    throw new BadRequestException('В поле ШК товара отсканирован номер короба. Отсканируйте ШК товара.');
  }
  if (value.length > 13) {
    throw new BadRequestException('ШК товара не должен быть длиннее 13 символов. Возможно, отсканирован КИЗ.');
  }
}

function validateReceiptKiz(value: string | undefined) {
  if (!value) {
    return;
  }
  if (isFflBoxCode(value)) {
    throw new BadRequestException('В поле КИЗ отсканирован номер короба. Отсканируйте КИЗ товара.');
  }
  if (value.length <= 20) {
    throw new BadRequestException('КИЗ должен быть длиннее 20 символов. Возможно, отсканирован ШК товара.');
  }
}

function isFflBoxCode(value: string) {
  return value.trim().toLocaleUpperCase('ru-RU').startsWith('FFL');
}

function primaryBarcode(sku: { barcodes: Array<{ value: string; isPrimary: boolean }> }) {
  return sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? '';
}

function receiptScanKey(payload: Record<string, unknown>) {
  return [
    text(payload.sourceDocument),
    normalizeBoxCode(text(payload.boxCode)),
    text(payload.barcode),
    text(payload.kiz),
  ].join('|');
}

function isReceiptAcceptedWithError(operation: {
  status: TsdOperationStatus;
  reviewReason: TsdReviewReason | null;
  reviewAction: string | null;
  reviewComment: string | null;
}) {
  return Boolean(
    operation.status === TsdOperationStatus.ACCEPTED &&
    operation.reviewReason === TsdReviewReason.RECEIPT_FAILED &&
    operation.reviewAction === 'APPLY_INVENTORY_ADJUSTMENT' &&
    operation.reviewComment?.startsWith('[RECEIPT_ERROR_ACCEPTED]')
  );
}

function duplicateBoxCode(message: string) {
  return message.match(/короб(?:е)?\s+([A-ZА-Я0-9_-]+)/iu)?.[1] ?? null;
}

function receiptBalanceKey(boxId: string | null, skuId: string, status: StockStatus) {
  return `${boxId ?? ''}|${skuId}|${status}`;
}

function isVerificationError(
  value: { boxId: string | null; skuId: string; status: StockStatus; expected: number; actual: number } | null,
): value is { boxId: string | null; skuId: string; status: StockStatus; expected: number; actual: number } {
  return Boolean(value);
}

function moscowDayStartUtc(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
    year: 'numeric',
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(byType.get('year'));
  const month = Number(byType.get('month'));
  const day = Number(byType.get('day'));
  return new Date(Date.UTC(year, month - 1, day) - 3 * 60 * 60 * 1000);
}

function compareOnlineReceiptBoxes(
  left: { firstSeenAt: string | null; lastSeenAt: string | null; openedAt: string | null; closedAt: string | null; boxCode: string },
  right: { firstSeenAt: string | null; lastSeenAt: string | null; openedAt: string | null; closedAt: string | null; boxCode: string },
) {
  const leftDate = onlineReceiptActivityDate(left);
  const rightDate = onlineReceiptActivityDate(right);
  const today = moscowDateKey(new Date());
  const leftToday = moscowDateKey(leftDate) === today ? 1 : 0;
  const rightToday = moscowDateKey(rightDate) === today ? 1 : 0;
  if (leftToday !== rightToday) {
    return rightToday - leftToday;
  }
  const byDate = rightDate.getTime() - leftDate.getTime();
  return byDate || left.boxCode.localeCompare(right.boxCode, 'ru-RU');
}

function onlineReceiptActivityDate(value: {
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  openedAt: string | null;
  closedAt: string | null;
}) {
  return dateFromIso(value.lastSeenAt) ?? dateFromIso(value.closedAt) ?? dateFromIso(value.openedAt) ?? dateFromIso(value.firstSeenAt) ?? new Date(0);
}

function dateFromIso(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function moscowDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
    year: 'numeric',
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year') ?? ''}-${byType.get('month') ?? ''}-${byType.get('day') ?? ''}`;
}

function minIso(current: string | null, value: Date | string | null | undefined) {
  const next = iso(value);
  if (!next) {
    return current;
  }
  return !current || next < current ? next : current;
}

function maxIso(current: string | null, value: Date | string | null | undefined) {
  const next = iso(value);
  if (!next) {
    return current;
  }
  return !current || next > current ? next : current;
}

function iso(value: Date | string | null | undefined) {
  if (!value) {
    return '';
  }
  return value instanceof Date ? value.toISOString() : value;
}

function actorFallback(deviceId: string): TsdActor {
  return {
    deviceCode: deviceId,
    deviceName: deviceId,
    name: deviceId.startsWith('WEB:') ? deviceId.slice(4) : deviceId,
  };
}

function compactJson(payload: Record<string, unknown>) {
  const result: Record<string, Prisma.InputJsonValue> = {};
  Object.entries(payload).forEach(([key, value]) => {
    const jsonValue = toInputJsonValue(value);
    if (jsonValue === undefined) {
      return;
    }
    result[key] = jsonValue;
  });
  return result as Prisma.InputJsonValue;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return value as Prisma.InputJsonValue;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => toInputJsonValue(item))
      .filter((item): item is Prisma.InputJsonValue => item !== undefined) as Prisma.InputJsonArray;
  }
  if (typeof value === 'object') {
    const objectValue: Record<string, Prisma.InputJsonValue> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      const jsonItem = toInputJsonValue(item);
      if (jsonItem !== undefined) {
        objectValue[key] = jsonItem;
      }
    });
    return objectValue as Prisma.InputJsonObject;
  }
  return undefined;
}

function dateStamp() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
}

async function removeOnlineReceiptBoxData(tx: Prisma.TransactionClient, boxId: string) {
  await tx.productMark.deleteMany({ where: { boxId } });
  await tx.stockBalance.deleteMany({ where: { boxId } });
  await tx.stockMovement.deleteMany({ where: { boxId } });
  await tx.box.delete({ where: { id: boxId } });
}
