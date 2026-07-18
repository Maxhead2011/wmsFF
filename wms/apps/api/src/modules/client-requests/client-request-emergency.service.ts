import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingChargeSource,
  BillingInvoiceStatus,
  ClientRequestEventType,
  ClientRequestStatus,
  ClientRequestType,
  LogisticsDeliveryStatus,
  MovementType,
  Prisma,
  StockStatus,
} from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryLockService } from '../../common/inventory/inventory-lock.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { RequestBillingAutomationService } from '../billing/request-billing-automation.service';
import { LogisticsService } from '../logistics/logistics.service';
import { clientRequestPackageInclude } from './client-request-packages.include';

const xlsxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const maxFileSizeBytes = 10 * 1024 * 1024;
const emergencyPackageComment = 'Фактический короб из аварийного Excel';
const emergencyItemComment = 'Добавлено автоматически по фактическому составу аварийной упаковки.';
const emergencyFilePrefix = 'Аварийная упаковка - ';
const emergencyMovementPrefix = 'emergency-box-list:';
const emergencyRollbackPrefix = 'emergency-box-list-rollback:';
const blockedEmergencyStatuses = new Set<ClientRequestStatus>([
  ClientRequestStatus.DONE,
  ClientRequestStatus.CANCELLED,
  ClientRequestStatus.REJECTED,
]);

const emergencyRequestInclude = {
  items: {
    include: {
      sku: {
        include: {
          barcodes: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.ClientRequestInclude;

const emergencyBoxInclude = {
  balances: {
    where: { quantity: { gt: 0 } },
    include: {
      sku: {
        include: {
          barcodes: true,
        },
      },
    },
    orderBy: [{ skuId: 'asc' }, { status: 'asc' }],
  },
} satisfies Prisma.BoxInclude;

type EmergencyRequest = Prisma.ClientRequestGetPayload<{ include: typeof emergencyRequestInclude }>;
type EmergencyBox = Prisma.BoxGetPayload<{ include: typeof emergencyBoxInclude }>;
type EmergencyBalance = EmergencyBox['balances'][number];

type RequestLine = {
  id: string;
  skuId: string | null;
  label: string;
  remaining: number;
  barcodes: Set<string>;
  relabelSourceBarcode: string | null;
  relabelTargetBarcode: string | null;
};

type PackageAllocation = {
  requestItemId: string;
  skuId: string;
  barcode: string | null;
  quantity: number;
};

type EmergencyPackagePlan = {
  box: EmergencyBox;
  items: PackageAllocation[];
};

type EmergencyPackingWarning = {
  code: 'SHORTAGE' | 'RELABEL_DIFFERENCE' | 'EXCESS' | 'UNLISTED_ITEM' | 'EMPTY_BOX';
  message: string;
  quantity: number;
  boxCode?: string;
  skuId?: string;
  barcode?: string | null;
};

type StoredEmergencyPackage = {
  id: string;
  packageCode: string;
  packageType: string | null;
  weightGrams: number | null;
  lengthCm: string | null;
  widthCm: string | null;
  heightCm: string | null;
  comment: string | null;
  metadata: Prisma.JsonValue | null;
  createdByUserId: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    requestItemId: string;
    skuId: string | null;
    barcode: string | null;
    quantity: number;
  }>;
};

type EmergencyClosureSnapshot = {
  version: 1;
  closedAt: string;
  previousStatus: ClientRequestStatus;
  previousManagerComment: string | null;
  previousAssignedToUserId: string | null;
  previousPackages: StoredEmergencyPackage[];
  previousBoxStatuses: Array<{ id: string; status: string }>;
  previousMarkStatuses: Array<{ id: string; status: StockStatus }>;
  previousInvoiceIds: string[];
  previousChargeIds: string[];
  previousDeliveryIds: string[];
  createdPackageIds: string[];
  createdMovementIds: string[];
  autoAddedRequestItemIds: string[];
  sourceFileId: string;
};

@Injectable()
export class ClientRequestEmergencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly logistics?: LogisticsService,
    private readonly billingAutomation?: RequestBillingAutomationService,
    private readonly inventoryLock?: InventoryLockService,
  ) {}

  async closeFromPackedXlsx(requestId: string, file: Express.Multer.File | undefined, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    validateFile(file);
    requireEmergencyAccess(user);
    const boxCodes = parseEmergencyBoxCodes(file!.buffer);
    if (boxCodes.length === 0) {
      throw new BadRequestException('В файле не найдены номера коробов, начинающиеся с FFL.');
    }

    const requestAccess = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: { id: true, clientId: true },
    });
    if (!requestAccess) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }
    this.clientScopes.requireClientAccess(user, requestAccess.clientId, 'write');

    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.clientRequest.findUnique({
        where: { id: requestId },
        include: emergencyRequestInclude,
      });
      if (!request) {
        throw new NotFoundException('Клиентская заявка не найдена.');
      }
      validateRequest(request);

      const existingEmergencyPackage = await tx.clientRequestPackage.findFirst({
        where: {
          requestId: request.id,
          comment: emergencyPackageComment,
        },
        select: { id: true },
      });
      if (existingEmergencyPackage) {
        const packages = await tx.clientRequestPackage.findMany({
          where: { requestId: request.id },
          select: {
            id: true,
            items: {
              select: { quantity: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        });
        const packedUnits = countPackageUnits(packages);

        return {
          status: 'ALREADY_APPLIED' as const,
          requestId: request.id,
          boxes: packages.length,
          pallets: calculatePalletCount(packages.length),
          packedUnits,
          rows: boxCodes.length,
          wbFilesReady: true,
          warnings: [] as EmergencyPackingWarning[],
          shortageQuantity: 0,
          excessQuantity: 0,
        };
      }

      const boxes = await loadBoxes(tx, request.clientId, boxCodes);
      const [previousPackages, previousMarkStatuses, previousInvoiceIds, previousChargeIds, previousDeliveryIds] =
        await Promise.all([
          tx.clientRequestPackage.findMany({
            where: { requestId: request.id },
            include: { items: true },
            orderBy: { createdAt: 'asc' },
          }),
          tx.productMark.findMany({
            where: { boxId: { in: boxes.map((box) => box.id) } },
            select: { id: true, status: true },
          }),
          tx.billingInvoice.findMany({ where: { requestId: request.id }, select: { id: true } }),
          tx.billingCharge.findMany({ where: { requestId: request.id }, select: { id: true } }),
          tx.logisticsDeliveryRequest.findMany({ where: { requestId: request.id }, select: { id: true } }),
        ]);
      const actualRequestItems = await ensureRequestItemsForActualStock(tx, request, boxes);
      const packagePlan = buildPackagePlan(actualRequestItems.items, boxes, boxCodes, actualRequestItems.warnings);
      const plan = packagePlan.plan;
      const packedAt = new Date();
      const closureToken = `${packedAt.getTime()}`;

      await tx.clientRequestPackage.deleteMany({ where: { requestId: request.id } });
      const packages = [];
      const createdMovementIds: string[] = [];
      for (const packagePlan of plan) {
        packages.push(
          await tx.clientRequestPackage.create({
            data: {
              requestId: request.id,
              clientId: request.clientId,
              packageCode: packagePlan.box.code,
              packageType: 'BOX',
              comment: emergencyPackageComment,
              createdByUserId: user.id,
              items: {
                create: packagePlan.items,
              },
            },
            include: clientRequestPackageInclude,
          }),
        );

        for (const balance of packagePlan.box.balances) {
          await tx.stockBalance.delete({ where: { id: balance.id } });
          const movement = await tx.stockMovement.create({
            data: {
              clientId: request.clientId,
              skuId: balance.skuId,
              boxId: packagePlan.box.id,
              palletId: balance.palletId,
              type: MovementType.SHIP,
              status: balance.status,
              quantity: -balance.quantity,
              sourceDocument: request.id,
              idempotencyKey: `${emergencyMovementPrefix}${request.id}:${closureToken}:${packagePlan.box.id}:${balance.id}:out`,
              comment: `Аварийная упаковка заявки ${request.title}: короб ${packagePlan.box.code}`,
            },
            select: { id: true },
          });
          createdMovementIds.push(movement.id);
        }

        await tx.productMark.updateMany({
          where: { boxId: packagePlan.box.id },
          data: { status: StockStatus.SHIPPING },
        });
        await tx.box.update({
          where: { id: packagePlan.box.id },
          data: { status: 'shipped' },
        });
      }

      const packedUnits = countPackageUnits(packages);
      await tx.clientRequest.update({
        where: { id: request.id },
        data: {
          status: ClientRequestStatus.PACKED,
          assignedToUserId: user.id,
          managerComment: `Аварийно упаковано по списку коробов: ${packages.length} коробов, ${packedUnits} шт.${
            packagePlan.warnings.length > 0 ? ` Расхождений: ${packagePlan.warnings.length}.` : ''
          }`,
        },
      });
      const sourceFile = await tx.clientRequestFile.create({
        data: {
          requestId: request.id,
          clientId: request.clientId,
          fileName: `${emergencyFilePrefix}${safeFileName(file!.originalname)}`,
          mimeType: file!.mimetype || xlsxMimeType,
          sizeBytes: file!.size,
          content: Uint8Array.from(file!.buffer),
          uploadedByUserId: user.id,
        },
        select: { id: true },
      });

      const closureSnapshot: EmergencyClosureSnapshot = {
        version: 1,
        closedAt: packedAt.toISOString(),
        previousStatus: request.status,
        previousManagerComment: request.managerComment,
        previousAssignedToUserId: request.assignedToUserId,
        previousPackages: previousPackages.map(storePackage),
        previousBoxStatuses: boxes.map((box) => ({ id: box.id, status: box.status })),
        previousMarkStatuses,
        previousInvoiceIds: previousInvoiceIds.map((entry) => entry.id),
        previousChargeIds: previousChargeIds.map((entry) => entry.id),
        previousDeliveryIds: previousDeliveryIds.map((entry) => entry.id),
        createdPackageIds: packages.map((entry) => entry.id),
        createdMovementIds,
        autoAddedRequestItemIds: actualRequestItems.createdItemIds,
        sourceFileId: sourceFile.id,
      };
      if (packages[0]) {
        await tx.clientRequestPackage.update({
          where: { id: packages[0].id },
          data: {
            metadata: {
              emergencyClosure: closureSnapshot as unknown as Prisma.InputJsonValue,
            },
          },
        });
      }
      const events: Prisma.ClientRequestEventCreateManyInput[] = [
          {
            requestId: request.id,
            clientId: request.clientId,
            eventType: ClientRequestEventType.STATUS_CHANGED,
            title: 'Заявка аварийно упакована',
            body: `Коробов: ${packages.length}, единиц: ${packedUnits}.`,
            statusFrom: request.status,
            statusTo: ClientRequestStatus.PACKED,
            createdByUserId: user.id,
            createdAt: packedAt,
          },
          {
            requestId: request.id,
            clientId: request.clientId,
            eventType: ClientRequestEventType.FILE_UPLOADED,
            title: 'Загружен аварийный список коробов',
            body: safeFileName(file!.originalname),
            createdByUserId: user.id,
            createdAt: packedAt,
          },
        ];
      if (packagePlan.warnings.length > 0) {
        events.push({
          requestId: request.id,
          clientId: request.clientId,
          eventType: ClientRequestEventType.COMMENT,
          title: 'Расхождения аварийной упаковки',
          body: packagePlan.warnings.map((warning) => warning.message).slice(0, 12).join('\n'),
          createdByUserId: user.id,
          createdAt: packedAt,
        });
      }
      await tx.clientRequestEvent.createMany({
        data: events,
      });

      return {
        status: 'APPLIED' as const,
        requestId: request.id,
        boxes: packages.length,
        pallets: calculatePalletCount(packages.length),
        packedUnits,
        rows: boxCodes.length,
        wbFilesReady: true,
        warnings: packagePlan.warnings,
        shortageQuantity: packagePlan.shortageQuantity,
        excessQuantity: packagePlan.excessQuantity,
      };
    });

    let logistics: unknown;
    try {
      logistics = await this.logistics?.ensurePackedRequestBilling(result.requestId, user);
    } catch (caught) {
      logistics = { status: 'FAILED', message: exceptionMessage(caught) };
    }

    let billing: unknown;
    try {
      billing = await this.billingAutomation?.generateForDoneRequest(result.requestId, user);
    } catch (caught) {
      billing = { status: 'FAILED', message: exceptionMessage(caught) };
    }

    return { ...result, logistics, billing };
  }

  async rollbackPackedXlsx(requestId: string, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    requireEmergencyAccess(user);
    const requestAccess = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: { id: true, clientId: true },
    });
    if (!requestAccess) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }
    this.clientScopes.requireClientAccess(user, requestAccess.clientId, 'write');

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.clientRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          clientId: true,
          title: true,
          type: true,
          status: true,
          managerComment: true,
          assignedToUserId: true,
        },
      });
      if (!request) {
        throw new NotFoundException('Клиентская заявка не найдена.');
      }
      if (request.type !== ClientRequestType.OUTBOUND) {
        throw new BadRequestException('Отмена аварийного закрытия доступна только для заявки на отгрузку.');
      }
      if (request.status !== ClientRequestStatus.PACKED) {
        throw new BadRequestException('Отменить аварийное закрытие можно только пока заявка находится в статусе «Упакована».');
      }

      const activePackages = await tx.clientRequestPackage.findMany({
        where: { requestId: request.id, comment: emergencyPackageComment },
        select: { id: true, metadata: true },
        orderBy: { createdAt: 'asc' },
      });
      if (activePackages.length === 0) {
        throw new BadRequestException('У заявки нет активного аварийного закрытия.');
      }

      const snapshot = readClosureSnapshot(activePackages);
      const emergencyEvent = await tx.clientRequestEvent.findFirst({
        where: {
          requestId: request.id,
          eventType: ClientRequestEventType.STATUS_CHANGED,
          statusTo: ClientRequestStatus.PACKED,
          title: 'Заявка аварийно упакована',
        },
        select: { statusFrom: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      const closedAt = snapshot ? new Date(snapshot.closedAt) : emergencyEvent?.createdAt ?? new Date(0);
      const movementWhere: Prisma.StockMovementWhereInput = snapshot?.createdMovementIds.length
        ? { id: { in: snapshot.createdMovementIds } }
        : {
            sourceDocument: request.id,
            type: MovementType.SHIP,
            quantity: { lt: 0 },
            idempotencyKey: { startsWith: `${emergencyMovementPrefix}${request.id}:` },
            createdAt: { gte: closedAt },
          };
      const movements = await tx.stockMovement.findMany({
        where: movementWhere,
        select: {
          id: true,
          clientId: true,
          skuId: true,
          boxId: true,
          palletId: true,
          status: true,
          quantity: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (movements.length === 0) {
        throw new BadRequestException('Не найдены складские движения аварийного закрытия. Откат остановлен без изменений.');
      }

      const financialRollback = await rollbackEmergencyFinancialArtifacts(tx, request.id, snapshot, closedAt);
      let restoredUnits = 0;
      for (const movement of movements) {
        const quantity = Math.abs(movement.quantity);
        restoredUnits += quantity;
        const balanceKey = stockBalanceKey(movement);
        await tx.stockBalance.upsert({
          where: { balanceKey },
          update: { quantity: { increment: quantity } },
          create: {
            balanceKey,
            clientId: movement.clientId,
            skuId: movement.skuId,
            boxId: movement.boxId,
            palletId: movement.palletId,
            status: movement.status,
            quantity,
          },
        });
        await tx.stockMovement.create({
          data: {
            clientId: movement.clientId,
            skuId: movement.skuId,
            boxId: movement.boxId,
            palletId: movement.palletId,
            type: MovementType.INVENTORY_ADJUSTMENT,
            status: movement.status,
            quantity,
            sourceDocument: request.id,
            idempotencyKey: `${emergencyRollbackPrefix}${request.id}:${movement.id}`,
            comment: `Отмена аварийного закрытия заявки ${request.title}`,
          },
        });
      }

      await restoreProductMarks(tx, snapshot, movements);
      await restoreBoxStatuses(tx, snapshot, movements);
      await tx.clientRequestPackage.deleteMany({ where: { requestId: request.id } });
      if (snapshot) {
        await restorePackages(tx, request.id, request.clientId, snapshot.previousPackages);
      }

      const autoAddedItemIds = snapshot?.autoAddedRequestItemIds ?? (
        await tx.clientRequestItem.findMany({
          where: { requestId: request.id, comment: emergencyItemComment },
          select: { id: true },
        })
      ).map((item) => item.id);
      if (autoAddedItemIds.length > 0) {
        await tx.clientRequestItem.deleteMany({ where: { id: { in: autoAddedItemIds } } });
      }

      if (snapshot?.sourceFileId) {
        await tx.clientRequestFile.deleteMany({ where: { id: snapshot.sourceFileId, requestId: request.id } });
      } else {
        const legacyFile = await tx.clientRequestFile.findFirst({
          where: {
            requestId: request.id,
            fileName: { startsWith: emergencyFilePrefix },
            createdAt: { gte: closedAt },
          },
          select: { id: true },
          orderBy: { createdAt: 'desc' },
        });
        if (legacyFile) {
          await tx.clientRequestFile.delete({ where: { id: legacyFile.id } });
        }
      }

      const restoredStatus = snapshot?.previousStatus ?? emergencyEvent?.statusFrom ?? ClientRequestStatus.IN_WORK;
      await tx.clientRequest.update({
        where: { id: request.id },
        data: {
          status: restoredStatus,
          managerComment: snapshot?.previousManagerComment ?? null,
          assignedToUserId: snapshot?.previousAssignedToUserId ?? null,
        },
      });
      await tx.clientRequestEvent.create({
        data: {
          requestId: request.id,
          clientId: request.clientId,
          eventType: ClientRequestEventType.STATUS_CHANGED,
          title: 'Аварийное закрытие отменено',
          body: `Восстановлено ${restoredUnits} шт. в ${new Set(movements.map((movement) => movement.boxId).filter(Boolean)).size} коробах.`,
          statusFrom: ClientRequestStatus.PACKED,
          statusTo: restoredStatus,
          createdByUserId: user.id,
        },
      });

      return {
        status: 'REVERSED' as const,
        requestId: request.id,
        restoredStatus,
        restoredBoxes: new Set(movements.map((movement) => movement.boxId).filter(Boolean)).size,
        restoredUnits,
        removedPackages: activePackages.length,
        restoredPackages: snapshot?.previousPackages.length ?? 0,
        removedAutoItems: autoAddedItemIds.length,
        ...financialRollback,
      };
    });
  }
}

async function rollbackEmergencyFinancialArtifacts(
  tx: Prisma.TransactionClient,
  requestId: string,
  snapshot: EmergencyClosureSnapshot | null,
  closedAt: Date,
) {
  const generatedInvoiceKeys = [
    `request:${requestId}:all-services`,
    `request:${requestId}:services`,
    `request:${requestId}:logistics`,
  ];
  const invoices = await tx.billingInvoice.findMany({
    where: {
      requestId,
      sourceKey: { in: generatedInvoiceKeys },
      ...(snapshot
        ? { id: { notIn: snapshot.previousInvoiceIds } }
        : { createdAt: { gte: closedAt } }),
    },
    select: {
      id: true,
      number: true,
      status: true,
      payments: { select: { id: true } },
    },
  });
  const blockingInvoice = invoices.find(
    (invoice) =>
      invoice.payments.length > 0 ||
      !new Set<BillingInvoiceStatus>([BillingInvoiceStatus.DRAFT, BillingInvoiceStatus.CANCELLED]).has(invoice.status),
  );
  if (blockingInvoice) {
    throw new BadRequestException(
      `Счет ${blockingInvoice.number} уже выставлен или оплачен. Сначала отмените его в биллинге; складской откат не выполнен.`,
    );
  }
  if (invoices.length > 0) {
    await tx.billingInvoice.deleteMany({ where: { id: { in: invoices.map((invoice) => invoice.id) } } });
  }

  const deliveries = (
    await tx.logisticsDeliveryRequest.findMany({
      where: {
        requestId,
        ...(snapshot
          ? { id: { notIn: snapshot.previousDeliveryIds } }
          : { createdAt: { gte: closedAt } }),
      },
      select: {
        id: true,
        status: true,
        tripId: true,
        billingChargeId: true,
        comment: true,
      },
    })
  ).filter((delivery) => delivery.comment?.startsWith('Автоматически создано после упаковки заявки'));
  const blockingDelivery = deliveries.find(
    (delivery) =>
      delivery.tripId ||
      !new Set<LogisticsDeliveryStatus>([
        LogisticsDeliveryStatus.REQUESTED,
        LogisticsDeliveryStatus.QUOTED,
        LogisticsDeliveryStatus.CANCELLED,
      ]).has(delivery.status),
  );
  if (blockingDelivery) {
    throw new BadRequestException(
      'Автоматическая заявка на логистику уже передана в рейс. Сначала отмените рейс; складской откат не выполнен.',
    );
  }
  const deliveryChargeIds = deliveries
    .map((delivery) => delivery.billingChargeId)
    .filter((id): id is string => Boolean(id));
  if (deliveries.length > 0) {
    await tx.logisticsDeliveryRequest.updateMany({
      where: { id: { in: deliveries.map((delivery) => delivery.id) } },
      data: { billingChargeId: null },
    });
    await tx.logisticsDeliveryRequest.deleteMany({ where: { id: { in: deliveries.map((delivery) => delivery.id) } } });
  }

  const logisticsCharges = await tx.billingCharge.findMany({
    where: {
      requestId,
      source: BillingChargeSource.LOGISTICS,
      OR: [
        ...(deliveryChargeIds.length > 0 ? [{ id: { in: deliveryChargeIds } }] : []),
        snapshot
          ? { id: { notIn: snapshot.previousChargeIds } }
          : { createdAt: { gte: closedAt } },
      ],
    },
    select: {
      id: true,
      invoiceItems: { select: { id: true } },
      deliveryRequests: { select: { id: true } },
    },
  });
  const removableCharges = logisticsCharges.filter(
    (charge) => charge.invoiceItems.length === 0 && charge.deliveryRequests.length === 0,
  );
  if (removableCharges.length > 0) {
    await tx.billingCharge.deleteMany({ where: { id: { in: removableCharges.map((charge) => charge.id) } } });
  }

  return {
    removedInvoices: invoices.length,
    removedDeliveryRequests: deliveries.length,
    removedBillingCharges: removableCharges.length,
  };
}

async function restoreProductMarks(
  tx: Prisma.TransactionClient,
  snapshot: EmergencyClosureSnapshot | null,
  movements: Array<{ boxId: string | null }>,
) {
  if (snapshot?.previousMarkStatuses.length) {
    const idsByStatus = new Map<StockStatus, string[]>();
    snapshot.previousMarkStatuses.forEach((mark) => {
      idsByStatus.set(mark.status, [...(idsByStatus.get(mark.status) ?? []), mark.id]);
    });
    for (const [status, ids] of idsByStatus) {
      await tx.productMark.updateMany({ where: { id: { in: ids } }, data: { status } });
    }
    return;
  }

  const boxIds = uniqueStrings(movements.map((movement) => movement.boxId));
  if (boxIds.length > 0) {
    await tx.productMark.updateMany({
      where: { boxId: { in: boxIds }, status: StockStatus.SHIPPING },
      data: { status: StockStatus.AVAILABLE },
    });
  }
}

async function restoreBoxStatuses(
  tx: Prisma.TransactionClient,
  snapshot: EmergencyClosureSnapshot | null,
  movements: Array<{ boxId: string | null }>,
) {
  if (snapshot?.previousBoxStatuses.length) {
    for (const box of snapshot.previousBoxStatuses) {
      await tx.box.update({ where: { id: box.id }, data: { status: box.status } });
    }
    return;
  }

  const boxIds = uniqueStrings(movements.map((movement) => movement.boxId));
  if (boxIds.length > 0) {
    await tx.box.updateMany({ where: { id: { in: boxIds } }, data: { status: 'active' } });
  }
}

async function restorePackages(
  tx: Prisma.TransactionClient,
  requestId: string,
  clientId: string,
  packages: StoredEmergencyPackage[],
) {
  for (const packagePlace of packages) {
    await tx.clientRequestPackage.create({
      data: {
        id: packagePlace.id,
        requestId,
        clientId,
        packageCode: packagePlace.packageCode,
        packageType: packagePlace.packageType,
        weightGrams: packagePlace.weightGrams,
        lengthCm: packagePlace.lengthCm,
        widthCm: packagePlace.widthCm,
        heightCm: packagePlace.heightCm,
        comment: packagePlace.comment,
        metadata:
          packagePlace.metadata === null
            ? Prisma.JsonNull
            : (packagePlace.metadata as Prisma.InputJsonValue),
        createdByUserId: packagePlace.createdByUserId,
        createdAt: new Date(packagePlace.createdAt),
        items: {
          create: packagePlace.items.map((item) => ({
            id: item.id,
            requestItemId: item.requestItemId,
            skuId: item.skuId,
            barcode: item.barcode,
            quantity: item.quantity,
          })),
        },
      },
    });
  }
}

function storePackage(
  packagePlace: Prisma.ClientRequestPackageGetPayload<{ include: { items: true } }>,
): StoredEmergencyPackage {
  return {
    id: packagePlace.id,
    packageCode: packagePlace.packageCode,
    packageType: packagePlace.packageType,
    weightGrams: packagePlace.weightGrams,
    lengthCm: packagePlace.lengthCm?.toString() ?? null,
    widthCm: packagePlace.widthCm?.toString() ?? null,
    heightCm: packagePlace.heightCm?.toString() ?? null,
    comment: packagePlace.comment,
    metadata: packagePlace.metadata,
    createdByUserId: packagePlace.createdByUserId,
    createdAt: packagePlace.createdAt.toISOString(),
    items: packagePlace.items.map((item) => ({
      id: item.id,
      requestItemId: item.requestItemId,
      skuId: item.skuId,
      barcode: item.barcode,
      quantity: item.quantity,
    })),
  };
}

function readClosureSnapshot(packages: Array<{ metadata: Prisma.JsonValue | null }>): EmergencyClosureSnapshot | null {
  for (const packagePlace of packages) {
    if (!isJsonObject(packagePlace.metadata)) {
      continue;
    }
    const value = packagePlace.metadata.emergencyClosure;
    if (isJsonObject(value) && value.version === 1 && typeof value.closedAt === 'string') {
      return value as unknown as EmergencyClosureSnapshot;
    }
  }
  return null;
}

function stockBalanceKey(input: {
  clientId: string;
  skuId: string;
  boxId: string | null;
  palletId: string | null;
  status: StockStatus;
}) {
  return [input.clientId, input.skuId, input.boxId ?? 'no-box', input.palletId ?? 'no-pallet', input.status].join(':');
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isJsonObject(value: Prisma.JsonValue | null | undefined): value is Prisma.JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function loadBoxes(tx: Prisma.TransactionClient, clientId: string, boxCodes: string[]) {
  const boxes = await tx.box.findMany({
    where: {
      clientId,
      OR: boxCodes.map((code) => ({ code: { equals: code, mode: Prisma.QueryMode.insensitive } })),
    },
    include: emergencyBoxInclude,
  });
  const boxByCode = new Map(boxes.map((box) => [normalizeCode(box.code), box]));
  const missing = boxCodes.filter((code) => !boxByCode.has(normalizeCode(code)));
  if (missing.length > 0) {
    throw new BadRequestException(`Короба не найдены у клиента: ${missing.slice(0, 12).join(', ')}.`);
  }

  return boxCodes.map((code) => boxByCode.get(normalizeCode(code))!);
}

async function ensureRequestItemsForActualStock(
  tx: Prisma.TransactionClient,
  request: EmergencyRequest,
  boxes: EmergencyBox[],
) {
  const items = [...request.items];
  const warnings: EmergencyPackingWarning[] = [];
  const createdItemIds: string[] = [];
  const balancesBySku = new Map<string, EmergencyBalance[]>();

  for (const box of boxes) {
    for (const balance of box.balances) {
      const current = balancesBySku.get(balance.skuId) ?? [];
      current.push(balance);
      balancesBySku.set(balance.skuId, current);
    }
  }

  for (const balances of balancesBySku.values()) {
    const sample = balances[0];
    if (!sample || items.some((item) => requestItemMatchesBalance(item, sample))) {
      continue;
    }

    const quantity = balances.reduce((sum, balance) => sum + balance.quantity, 0);
    const barcode = primaryBarcode(sample);
    const created = await tx.clientRequestItem.create({
      data: {
        requestId: request.id,
        skuId: sample.skuId,
        barcode,
        name: sample.sku.name,
        quantity,
        comment: emergencyItemComment,
      },
      include: {
        sku: {
          include: {
            barcodes: true,
          },
        },
      },
    });
    items.push(created);
    createdItemIds.push(created.id);
    warnings.push({
      code: 'UNLISTED_ITEM',
      message: `В фактических коробах найден товар ${sample.sku.name} (${barcode ?? sample.sku.internalSku}), которого не было в заявке: ${quantity} шт. Позиция добавлена в фактическую упаковку и списана.`,
      quantity,
      skuId: sample.skuId,
      barcode,
    });
  }

  return { items, warnings, createdItemIds };
}

function requestItemMatchesBalance(item: EmergencyRequest['items'][number], balance: EmergencyBalance) {
  if (item.skuId === balance.skuId) {
    return true;
  }

  const itemBarcodes = new Set<string>();
  if (item.barcode) {
    itemBarcodes.add(normalizeCode(item.barcode));
  }
  item.sku?.barcodes.forEach((barcode) => itemBarcodes.add(normalizeCode(barcode.value)));
  const relabel = parseRelabelComment(item.comment);
  if (relabel.sourceBarcode) {
    itemBarcodes.add(normalizeCode(relabel.sourceBarcode));
  }
  if (relabel.targetBarcode) {
    itemBarcodes.add(normalizeCode(relabel.targetBarcode));
  }
  return balance.sku.barcodes.some((barcode) => itemBarcodes.has(normalizeCode(barcode.value)));
}

function buildPackagePlan(
  items: EmergencyRequest['items'],
  boxes: EmergencyBox[],
  boxCodes: string[],
  initialWarnings: EmergencyPackingWarning[] = [],
) {
  const requestLines = buildRequestLines(items);
  const warnings = [...initialWarnings];
  const plan: EmergencyPackagePlan[] = [];
  let excessQuantity = initialWarnings.reduce(
    (sum, warning) => sum + (warning.code === 'UNLISTED_ITEM' ? warning.quantity : 0),
    0,
  );

  boxes.forEach((box, boxIndex) => {
    if (box.balances.length === 0) {
      warnings.push({
        code: 'EMPTY_BOX',
        message: `Короб ${boxCodes[boxIndex]} пуст или уже был списан. Короб включен в фактическую упаковку без товара.`,
        quantity: 0,
        boxCode: box.code,
      });
      plan.push({ box, items: [] });
      return;
    }

    const packageItems = new Map<string, PackageAllocation>();
    for (const balance of box.balances) {
      excessQuantity += allocateBalance(requestLines, balance, packageItems, warnings, box.code);
    }
    plan.push({ box, items: [...packageItems.values()] });
  });

  let shortageQuantity = 0;
  for (const line of requestLines) {
    if (line.remaining > 0) {
      shortageQuantity += line.remaining;
      const relabelDifference = Boolean(line.relabelSourceBarcode || line.relabelTargetBarcode);
      warnings.push({
        code: relabelDifference ? 'RELABEL_DIFFERENCE' : 'SHORTAGE',
        message: relabelDifference
          ? `По перемаркировке ${line.relabelSourceBarcode ?? 'исходный ШК'} → ${line.relabelTargetBarcode ?? 'новый ШК'} не сопоставлено ${line.remaining} шт. Возможно, товар уже перемаркирован. Повторное списание не выполнялось; заявка упакована по фактическим коробам.`
          : `В выбранных коробах не хватает ${line.remaining} шт. по позиции ${line.label}. Заявка все равно упакована по фактическому списку коробов.`,
        quantity: line.remaining,
        skuId: line.skuId ?? undefined,
      });
    }
  }

  return { plan, warnings, shortageQuantity, excessQuantity };
}

function allocateBalance(
  requestLines: RequestLine[],
  balance: EmergencyBalance,
  packageItems: Map<string, PackageAllocation>,
  warnings: EmergencyPackingWarning[],
  boxCode: string,
) {
  let remaining = balance.quantity;
  const balanceBarcodes = new Set(balance.sku.barcodes.map((barcode) => normalizeCode(barcode.value)));
  const candidates = requestLines.filter(
    (line) =>
      (line.skuId === balance.skuId || [...line.barcodes].some((barcode) => balanceBarcodes.has(barcode))),
  );

  for (const line of candidates.filter((candidate) => candidate.remaining > 0)) {
    if (remaining <= 0) {
      break;
    }
    const quantity = Math.min(remaining, line.remaining);
    line.remaining -= quantity;
    remaining -= quantity;
    addPackageAllocation(packageItems, line, balance, quantity);
  }

  if (remaining <= 0) {
    return 0;
  }

  const fallbackLine = candidates[0];
  if (fallbackLine) {
    addPackageAllocation(packageItems, fallbackLine, balance, remaining);
  }
  warnings.push({
    code: 'EXCESS',
    message: `В коробе ${boxCode} на ${remaining} шт. больше товара ${balance.sku.name} (${primaryBarcode(balance) ?? balance.sku.internalSku}), чем в заявке. Фактический излишек списан вместе с коробом.`,
    quantity: remaining,
    boxCode,
    skuId: balance.skuId,
    barcode: primaryBarcode(balance),
  });
  return remaining;
}

function addPackageAllocation(
  packageItems: Map<string, PackageAllocation>,
  line: RequestLine,
  balance: EmergencyBalance,
  quantity: number,
) {
  const barcode = preferredBarcode(line, balance);
  const key = `${line.id}:${balance.skuId}:${barcode ?? ''}`;
  const current = packageItems.get(key) ?? {
    requestItemId: line.id,
    skuId: balance.skuId,
    barcode,
    quantity: 0,
  };
  current.quantity += quantity;
  packageItems.set(key, current);
}

function buildRequestLines(items: EmergencyRequest['items']): RequestLine[] {
  return items.map((item) => {
    const relabel = parseRelabelComment(item.comment);
    const barcodes = new Set<string>();
    if (item.barcode) {
      barcodes.add(normalizeCode(item.barcode));
    }
    item.sku?.barcodes.forEach((barcode) => barcodes.add(normalizeCode(barcode.value)));
    if (relabel.sourceBarcode) {
      barcodes.add(normalizeCode(relabel.sourceBarcode));
    }
    if (relabel.targetBarcode) {
      barcodes.add(normalizeCode(relabel.targetBarcode));
    }

    return {
      id: item.id,
      skuId: item.skuId,
      label: item.name ?? item.sku?.name ?? item.sku?.internalSku ?? item.barcode ?? item.id,
      remaining: item.quantity,
      barcodes,
      relabelSourceBarcode: relabel.sourceBarcode,
      relabelTargetBarcode: relabel.targetBarcode,
    };
  });
}

function preferredBarcode(line: RequestLine, balance: EmergencyBalance) {
  if (line.relabelTargetBarcode) {
    return line.relabelTargetBarcode;
  }
  const matching = balance.sku.barcodes.find((barcode) => line.barcodes.has(normalizeCode(barcode.value)));
  return matching?.value ?? primaryBarcode(balance) ?? null;
}

function parseRelabelComment(comment?: string | null) {
  let sourceBarcode: string | null = null;
  let targetBarcode: string | null = null;

  comment?.split(';').forEach((part) => {
    const [rawKey, ...rawValue] = part.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.join(':').trim();
    if (key === 'перемаркировка из' && value) {
      sourceBarcode = value;
    } else if (key === 'перемаркировка в' && value) {
      targetBarcode = value;
    }
  });

  return { sourceBarcode, targetBarcode };
}

function primaryBarcode(balance: EmergencyBalance) {
  return balance.sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? balance.sku.barcodes[0]?.value ?? null;
}

function countPackageUnits(packages: Array<{ items: Array<{ quantity: number }> }>) {
  return packages.reduce(
    (packageTotal, packagePlace) =>
      packageTotal + packagePlace.items.reduce((itemTotal, item) => itemTotal + item.quantity, 0),
    0,
  );
}

function parseEmergencyBoxCodes(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    return [];
  }
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  const seen = new Set<string>();
  const result: string[] = [];

  for (const row of matrix) {
    const code = row.map((cell) => String(cell ?? '').trim()).find(isBoxCode);
    if (!code) {
      continue;
    }
    const normalized = normalizeCode(code);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(code.trim());
    }
  }

  return result;
}

function validateFile(file: Express.Multer.File | undefined): asserts file is Express.Multer.File {
  if (!file?.buffer?.length) {
    throw new BadRequestException('Файл не передан.');
  }
  if (file.size > maxFileSizeBytes) {
    throw new BadRequestException('Файл больше 10 МБ.');
  }
}

function validateRequest(request: EmergencyRequest) {
  if (request.type !== ClientRequestType.OUTBOUND) {
    throw new BadRequestException('Аварийная упаковка доступна только для заявок на отгрузку.');
  }
  if (blockedEmergencyStatuses.has(request.status)) {
    throw new BadRequestException('Нельзя аварийно упаковать закрытую, отмененную или отклоненную заявку.');
  }
  if (request.items.length === 0) {
    throw new BadRequestException('В заявке нет товаров для сверки с коробами.');
  }
}

function requireEmergencyAccess(user: AuthUser) {
  const allowed =
    user.permissionCodes.includes('system:admin') ||
    user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER');
  if (!allowed) {
    throw new ForbiddenException('Аварийная упаковка доступна только владельцу или администратору.');
  }
}

function calculatePalletCount(boxes: number) {
  const fullPallets = Math.floor(boxes / 16);
  return fullPallets + (boxes % 16 > 4 ? 1 : 0);
}

function isBoxCode(value: string) {
  return /^FFL[_\w-]*$/iu.test(value.trim());
}

function normalizeCode(value: string) {
  return value.trim().toLocaleUpperCase('ru-RU');
}

function safeFileName(value?: string) {
  const normalized = normalizeUploadedFileName(value);
  return normalized.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'emergency.xlsx';
}

function normalizeUploadedFileName(value?: string | null) {
  const normalized = value?.trim() ?? '';
  if (!/[ÃÐÑ]/.test(normalized)) {
    return normalized;
  }

  const decoded = Buffer.from(normalized, 'latin1').toString('utf8');
  return decoded.includes('�') ? normalized : decoded;
}

function exceptionMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось автоматически подготовить биллинг заявки.';
}
