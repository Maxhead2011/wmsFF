import { Injectable } from '@nestjs/common';
import {
  BillingChargeSource,
  BillingChargeStatus,
  BillingInvoiceSource,
  BillingInvoiceStatus,
  BillingPriceTaxMode,
  BillingUnit,
  ClientLogisticsInvoiceMode,
  ClientNotificationEvent,
  ClientRequestEventType,
  ClientRequestStatus,
  ClientRequestType,
  ClientStorageBillingMode,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { isClientNotificationEnabled } from '../client-notifications/client-notification-preferences';
import { LogisticsService } from '../logistics/logistics.service';

@Injectable()
export class RequestBillingAutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly logistics: LogisticsService,
  ) {}

  async generateForDoneRequest(requestId: string, user: AuthUser) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      include: {
        client: true,
        items: true,
        packages: {
          include: {
            items: {
              include: {
                sku: {
                  select: {
                    id: true,
                    internalSku: true,
                    name: true,
                    volumeLiters: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!request || request.type !== ClientRequestType.OUTBOUND || request.status !== ClientRequestStatus.DONE) {
      return { status: 'SKIPPED', reason: 'REQUEST_NOT_DONE_OUTBOUND' as const };
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'write');

    if (request.client.isDemo) {
      return { status: 'SKIPPED', reason: 'DEMO_CLIENT' as const };
    }

    await this.ensureItemProcessingCharge(request, user);
    await this.ensureOnShipmentStorageCharge(request, user);

    const logisticsMode = request.client.logisticsInvoiceMode;
    let logisticsChargeId: string | null = null;
    if (logisticsMode !== ClientLogisticsInvoiceMode.DISABLED) {
      logisticsChargeId = await this.ensureLogisticsChargeOrManualReview(request, user);
    }

    const mainInvoice = await this.createRequestInvoice({
      request,
      source: BillingInvoiceSource.REQUEST_DONE,
      sourceKey: mainInvoiceSourceKey(request.id),
      includeLogistics: logisticsMode === ClientLogisticsInvoiceMode.SAME_INVOICE,
      comment:
        logisticsMode === ClientLogisticsInvoiceMode.SAME_INVOICE && logisticsChargeId
          ? 'Автоматический счет по выполненной заявке с логистикой.'
          : 'Автоматический счет по выполненной заявке.',
      user,
    });

    const logisticsInvoice =
      logisticsMode === ClientLogisticsInvoiceMode.SEPARATE && logisticsChargeId
        ? await this.createRequestInvoice({
            request,
            source: BillingInvoiceSource.LOGISTICS,
            sourceKey: logisticsInvoiceSourceKey(request.id),
            onlyChargeIds: [logisticsChargeId],
            includeLogistics: true,
            comment: 'Автоматический счет логистики по выполненной заявке.',
            user,
          })
        : null;

    return {
      status: 'APPLIED',
      requestId: request.id,
      mainInvoiceId: mainInvoice?.id ?? null,
      logisticsInvoiceId: logisticsInvoice?.id ?? null,
    };
  }

  private async ensureItemProcessingCharge(
    request: DoneRequestPayload,
    user: AuthUser,
  ) {
    const sourceKey = itemProcessingSourceKey(request.id);
    const existing = await this.prisma.billingCharge.findFirst({
      where: { sourceKey },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }

    const quantity = request.packages.reduce(
      (sum, pack) => sum + pack.items.reduce((packSum, item) => packSum + item.quantity, 0),
      0,
    );
    if (quantity <= 0) {
      return null;
    }

    const service = await this.prisma.billingService.upsert({
      where: { code: ITEM_PROCESSING_SERVICE.code },
      update: {
        name: ITEM_PROCESSING_SERVICE.name,
        unit: ITEM_PROCESSING_SERVICE.unit,
        isActive: true,
      },
      create: ITEM_PROCESSING_SERVICE,
    });

    const clientPrice = await this.prisma.clientBillingService.findUnique({
      where: {
        clientId_serviceId: {
          clientId: request.clientId,
          serviceId: service.id,
        },
      },
    });
    if (!clientPrice?.isActive) {
      return null;
    }

    const priceRub = decimalToNumber(clientPrice.priceRub);
    if (priceRub == null || priceRub <= 0) {
      return null;
    }

    const unitPriceRub = applyTaxMode(priceRub, clientPrice.taxMode);
    const totalRub = roundMoney(quantity * unitPriceRub);
    const charge = await this.prisma.billingCharge.create({
      data: {
        clientId: request.clientId,
        serviceId: service.id,
        requestId: request.id,
        description: `Обработка товара по заявке ${request.title}`,
        unit: BillingUnit.PIECE,
        quantity,
        unitPriceRub,
        totalRub,
        status: BillingChargeStatus.APPROVED,
        serviceDate: request.updatedAt,
        source: BillingChargeSource.MANUAL,
        sourceKey,
        metadata: {
          requestId: request.id,
          itemProcessing: true,
          packedPieces: quantity,
          taxMode: clientPrice.taxMode,
          priceBeforeTaxRub: priceRub,
        },
        comment: 'Автоматически создано при закрытии заявки.',
        createdByUserId: user.id,
        approvedByUserId: user.id,
        approvedAt: new Date(),
      },
      select: { id: true },
    });

    return charge.id;
  }

  private async ensureOnShipmentStorageCharge(
    request: DoneRequestPayload,
    user: AuthUser,
  ) {
    if (
      request.client.storageBillingMode !== ClientStorageBillingMode.ON_SHIPMENT ||
      !request.client.storageAccountingEnabled
    ) {
      return null;
    }

    const sourceKey = storageOnShipmentSourceKey(request.id);
    const existing = await this.prisma.billingCharge.findFirst({
      where: { sourceKey },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }

    const storageService = await this.ensureStorageService();
    const unitPriceRub =
      decimalToNumber(request.client.storagePriceRubPerLiterDay) ?? decimalToNumber(storageService.defaultPriceRub);
    if (unitPriceRub == null) {
      return null;
    }

    const periodFrom = startOfDayUtc(request.createdAt);
    const periodTo = endOfDayUtc(request.updatedAt);
    const days = countInclusiveDays(periodFrom, periodTo);
    const details = calculateShipmentStorageDetails(request, days);
    if (details.literDays <= 0) {
      return null;
    }

    const totalRub = roundMoney(details.literDays * unitPriceRub);
    const charge = await this.prisma.billingCharge.create({
      data: {
        clientId: request.clientId,
        serviceId: storageService.id,
        requestId: request.id,
        description: `Хранение до отгрузки по заявке ${request.title}`,
        unit: BillingUnit.LITER_DAY,
        quantity: details.literDays,
        unitPriceRub,
        totalRub,
        status: BillingChargeStatus.APPROVED,
        serviceDate: request.updatedAt,
        source: BillingChargeSource.STORAGE,
        sourceKey,
        metadata: {
          requestId: request.id,
          periodFrom: formatDateKey(periodFrom),
          periodTo: formatDateKey(periodTo),
          days,
          totalLiters: details.totalLiters,
          literDays: details.literDays,
          skippedWithoutVolume: details.skippedWithoutVolume,
          skuTotals: details.skuTotals,
        },
        comment: 'Автоматически создано при закрытии заявки.',
        createdByUserId: user.id,
        approvedByUserId: user.id,
        approvedAt: new Date(),
      },
      select: { id: true },
    });

    return charge.id;
  }

  private async ensureLogisticsChargeOrManualReview(
    request: DoneRequestPayload,
    user: AuthUser,
  ) {
    const sourceKey = logisticsChargeSourceKey(request.id);
    const existing = await this.prisma.billingCharge.findFirst({
      where: { sourceKey },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }

    const counts = countPackages(request.packages);
    if (!request.destinationCity || (counts.boxes <= 0 && counts.pallets <= 0)) {
      await this.createManualLogisticsReview(request, user, 'Не указан город назначения или нет упаковочных мест.');
      return null;
    }

    const quoteInput =
      counts.pallets > 0
        ? { destination: request.destinationCity, pallets: counts.pallets, quoteDate: request.updatedAt.toISOString() }
        : { destination: request.destinationCity, boxes: counts.boxes, quoteDate: request.updatedAt.toISOString() };

    try {
      const quote = await this.logistics.quote(quoteInput);
      if (quote.requiresManualReview || quote.estimatedTotalRub == null) {
        await this.createManualLogisticsReview(
          request,
          user,
          quote.note ?? 'Тариф требует ручной проверки.',
          quote.tariffSet.id,
        );
        return null;
      }

      const service = await this.ensureDeliveryBillingService();
      const totalRub = roundMoney(quote.estimatedTotalRub);
      const charge = await this.prisma.billingCharge.create({
        data: {
          clientId: request.clientId,
          serviceId: service.id,
          requestId: request.id,
          description: `Доставка Москва -> ${quote.route.destination}`,
          unit: BillingUnit.SERVICE,
          quantity: 1,
          unitPriceRub: totalRub,
          totalRub,
          status: BillingChargeStatus.APPROVED,
          serviceDate: request.updatedAt,
          source: BillingChargeSource.LOGISTICS,
          sourceKey,
          metadata: {
            requestId: request.id,
            route: quote.route,
            boxes: counts.boxes,
            pallets: counts.pallets,
            billedBy: counts.pallets > 0 ? 'PALLETS' : 'BOXES',
            tariffSetId: quote.tariffSet.id,
            tariffSetName: quote.tariffSet.name,
            tier: quote.tier,
          },
          comment: 'Автоматически создано при закрытии заявки.',
          createdByUserId: user.id,
          approvedByUserId: user.id,
          approvedAt: new Date(),
        },
        select: { id: true },
      });

      return charge.id;
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : 'Тариф логистики не найден.';
      await this.createManualLogisticsReview(request, user, reason);
      return null;
    }
  }

  private async createRequestInvoice(input: {
    request: DoneRequestPayload;
    source: BillingInvoiceSource;
    sourceKey: string;
    includeLogistics: boolean;
    onlyChargeIds?: string[];
    comment: string;
    user: AuthUser;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.billingInvoice.findFirst({
        where: { sourceKey: input.sourceKey },
        include: billingInvoiceInclude,
      });
      if (existing) {
        return existing;
      }

      const charges = await tx.billingCharge.findMany({
        where: {
          clientId: input.request.clientId,
          requestId: input.request.id,
          id: input.onlyChargeIds ? { in: input.onlyChargeIds } : undefined,
          status: BillingChargeStatus.APPROVED,
          source: input.includeLogistics ? undefined : { not: BillingChargeSource.LOGISTICS },
          invoiceItems: {
            none: {
              invoice: {
                status: {
                  not: BillingInvoiceStatus.CANCELLED,
                },
              },
            },
          },
        },
        orderBy: [{ serviceDate: 'asc' }, { createdAt: 'asc' }],
      });

      if (charges.length === 0) {
        return null;
      }

      const periodFrom = minDate(charges.map((charge) => charge.serviceDate)) ?? input.request.updatedAt;
      const periodTo = maxDate(charges.map((charge) => charge.serviceDate)) ?? input.request.updatedAt;
      const totalRub = roundMoney(charges.reduce((sum, charge) => sum + (decimalToNumber(charge.totalRub) ?? 0), 0));
      const number = await nextInvoiceNumber(tx, periodFrom);

      return tx.billingInvoice.create({
        data: {
          number,
          clientId: input.request.clientId,
          requestId: input.request.id,
          source: input.source,
          sourceKey: input.sourceKey,
          periodFrom,
          periodTo: endOfDayUtc(periodTo),
          totalRub,
          comment: input.comment,
          createdByUserId: input.user.id,
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
        include: billingInvoiceInclude,
      });
    });
  }

  private async createManualLogisticsReview(
    request: DoneRequestPayload,
    user: AuthUser,
    reason: string,
    tariffSetId?: string | null,
  ) {
    const existing = await this.prisma.clientRequestEvent.findFirst({
      where: {
        requestId: request.id,
        title: 'Требуется ручной расчет логистики',
      },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }

    const body = [
      'Основной счет по заявке формируется без логистики.',
      `Причина: ${reason}`,
      tariffSetId ? `Тарифный набор: ${tariffSetId}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    return this.prisma.$transaction(async (tx) => {
      const event = await tx.clientRequestEvent.create({
        data: {
          requestId: request.id,
          clientId: request.clientId,
          eventType: ClientRequestEventType.COMMENT,
          title: 'Требуется ручной расчет логистики',
          body,
          createdByUserId: user.id,
        },
        select: { id: true },
      });

      if (await isClientNotificationEnabled(tx, request.clientId, ClientNotificationEvent.MANUAL)) {
        await tx.clientNotification.create({
          data: {
            clientId: request.clientId,
            requestId: request.id,
            title: 'Требуется ручной расчет логистики',
            body,
            severity: 'WARNING',
            createdByUserId: user.id,
          },
        });
      }

      return event.id;
    });
  }

  private ensureStorageService() {
    return this.prisma.billingService.upsert({
      where: { code: STORAGE_SERVICE_CODE },
      update: {
        name: 'Хранение по литражу',
        unit: BillingUnit.LITER_DAY,
        isActive: true,
      },
      create: {
        code: STORAGE_SERVICE_CODE,
        name: 'Хранение по литражу',
        unit: BillingUnit.LITER_DAY,
        isActive: true,
      },
    });
  }

  private ensureDeliveryBillingService() {
    return this.prisma.billingService.upsert({
      where: { code: DELIVERY_SERVICE_CODE },
      update: {
        name: 'Доставка по заявке',
        unit: BillingUnit.SERVICE,
        isActive: true,
      },
      create: {
        code: DELIVERY_SERVICE_CODE,
        name: 'Доставка по заявке',
        unit: BillingUnit.SERVICE,
        isActive: true,
      },
    });
  }
}

const STORAGE_SERVICE_CODE = 'STORAGE_LITER_DAY';
const DELIVERY_SERVICE_CODE = 'LOGISTICS_DELIVERY';
const ITEM_PROCESSING_SERVICE = {
  code: 'ITEM_PROCESSING',
  name: 'Обработка товара',
  unit: BillingUnit.PIECE,
  isActive: true,
} satisfies Prisma.BillingServiceUncheckedCreateInput;

const billingInvoiceInclude = {
  client: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  request: {
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  items: {
    include: {
      charge: {
        select: {
          id: true,
          description: true,
          status: true,
        },
      },
    },
    orderBy: [{ serviceDate: 'asc' }, { id: 'asc' }],
  },
  payments: {
    orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
  },
} satisfies Prisma.BillingInvoiceInclude;

type DoneRequestPayload = Prisma.ClientRequestGetPayload<{
  include: {
    client: true;
    items: true;
    packages: {
      include: {
        items: {
          include: {
            sku: {
              select: {
                id: true;
                internalSku: true;
                name: true;
                volumeLiters: true;
              };
            };
          };
        };
      };
    };
  };
}>;

function countPackages(packages: Array<{ packageType: string | null }>) {
  return packages.reduce(
    (result, pack) => {
      if (isPalletPackage(pack.packageType)) {
        result.pallets += 1;
      } else {
        result.boxes += 1;
      }
      return result;
    },
    { boxes: 0, pallets: 0 },
  );
}

function calculateShipmentStorageDetails(request: DoneRequestPayload, days: number) {
  const skuTotals = new Map<string, { name: string; quantity: number; volumeLiters: number; totalLiters: number }>();
  let totalLiters = 0;
  let skippedWithoutVolume = 0;

  for (const pack of request.packages) {
    for (const item of pack.items) {
      const volumeLiters = decimalToNumber(item.sku?.volumeLiters);
      if (volumeLiters == null || volumeLiters <= 0) {
        skippedWithoutVolume += item.quantity;
        continue;
      }

      const key = item.sku?.id ?? item.requestItemId;
      const existing = skuTotals.get(key) ?? {
        name: item.sku?.name ?? item.sku?.internalSku ?? key,
        quantity: 0,
        volumeLiters,
        totalLiters: 0,
      };
      existing.quantity += item.quantity;
      existing.totalLiters = roundQuantity(existing.totalLiters + item.quantity * volumeLiters);
      skuTotals.set(key, existing);
      totalLiters = roundQuantity(totalLiters + item.quantity * volumeLiters);
    }
  }

  return {
    totalLiters,
    literDays: roundQuantity(totalLiters * days),
    skippedWithoutVolume,
    skuTotals: [...skuTotals.values()],
  };
}

async function nextInvoiceNumber(tx: Prisma.TransactionClient, periodFrom: Date) {
  const prefix = `INV-${periodFrom.getUTCFullYear()}${String(periodFrom.getUTCMonth() + 1).padStart(2, '0')}`;
  const count = await tx.billingInvoice.count({
    where: {
      number: {
        startsWith: prefix,
      },
    },
  });

  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

function mainInvoiceSourceKey(requestId: string) {
  return `request-done:${requestId}:main`;
}

function logisticsInvoiceSourceKey(requestId: string) {
  return `request-done:${requestId}:logistics`;
}

function itemProcessingSourceKey(requestId: string) {
  return `request-done:${requestId}:item-processing`;
}

function storageOnShipmentSourceKey(requestId: string) {
  return `request-done:${requestId}:storage-on-shipment`;
}

function logisticsChargeSourceKey(requestId: string) {
  return `request-done:${requestId}:logistics-charge`;
}

function isPalletPackage(packageType?: string | null) {
  return ['PALLET', 'PALLETTE', 'ПАЛЛЕТ', 'ПАЛЛЕТА'].includes((packageType ?? '').trim().toUpperCase());
}

function applyTaxMode(unitPriceRub: number, taxMode: BillingPriceTaxMode) {
  if (taxMode === BillingPriceTaxMode.ADD_6_PERCENT) {
    return roundMoney((unitPriceRub / 94) * 100);
  }

  return roundMoney(unitPriceRub);
}

function decimalToNumber(value?: Prisma.Decimal | number | string | null) {
  if (value == null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function startOfDayUtc(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function endOfDayUtc(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59, 999));
}

function countInclusiveDays(periodFrom: Date, periodTo: Date) {
  const start = startOfDayUtc(periodFrom).getTime();
  const end = startOfDayUtc(periodTo).getTime();
  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
}

function formatDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function minDate(values: Date[]) {
  return values.reduce<Date | null>((result, value) => (!result || value < result ? value : result), null);
}

function maxDate(values: Date[]) {
  return values.reduce<Date | null>((result, value) => (!result || value > result ? value : result), null);
}
