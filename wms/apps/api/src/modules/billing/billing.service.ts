import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingChargeSource,
  BillingChargeStatus,
  BillingInvoiceStatus,
  BillingPaymentStatus,
  BillingPriceTaxMode,
  BillingUnit,
  ClientNotificationEvent,
  MovementType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { isClientNotificationEnabled } from '../client-notifications/client-notification-preferences';
import { TelegramNotificationService } from '../client-notifications/telegram-notification.service';
import { CreateBillingAdvanceDto } from './dto/create-billing-advance.dto';
import { CreateBillingChargeDto } from './dto/create-billing-charge.dto';
import { CreateBillingInvoiceDto } from './dto/create-billing-invoice.dto';
import { CreateBillingPaymentDto } from './dto/create-billing-payment.dto';
import { CreateBillingServiceDto } from './dto/create-billing-service.dto';
import { CreateManualBillingInvoiceDto } from './dto/create-manual-billing-invoice.dto';
import { GenerateStorageChargeDto } from './dto/generate-storage-charge.dto';
import { ListBillingChargesDto } from './dto/list-billing-charges.dto';
import { ListBillingInvoicesDto } from './dto/list-billing-invoices.dto';
import { ListBillingReconciliationDto } from './dto/list-billing-reconciliation.dto';
import { ListBillingServiceHistoryDto } from './dto/list-billing-service-history.dto';
import { UpdateBillingChargeStatusDto } from './dto/update-billing-charge-status.dto';
import { UpdateBillingInvoiceStatusDto } from './dto/update-billing-invoice-status.dto';
import { UpsertClientBillingServiceDto } from './dto/upsert-client-billing-service.dto';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly telegram?: TelegramNotificationService,
  ) {}

  async listServices() {
    await this.ensureStandardBillingServices();
    return this.prisma.billingService.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  createService(dto: CreateBillingServiceDto, user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);

    // Русский комментарий: service code нужен для будущих автоматических начислений из операций склада/логистики.
    return this.prisma.billingService.create({
      data: {
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        unit: dto.unit ?? BillingUnit.SERVICE,
        defaultPriceRub: dto.defaultPriceRub,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async listClientServices(clientId: string, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    await this.ensureStandardClientBillingServices(clientId, user.id);

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

    return services.map((service) => {
      const clientPrice = service.clientPrices[0] ?? null;
      return {
        id: clientPrice?.id ?? null,
        clientId,
        service,
        priceRub: clientPrice?.priceRub ?? service.defaultPriceRub,
        taxMode: clientPrice?.taxMode ?? BillingPriceTaxMode.INCLUDED,
        isActive: clientPrice?.isActive ?? false,
        comment: clientPrice?.comment ?? null,
      };
    });
  }

  async upsertClientService(clientId: string, dto: UpsertClientBillingServiceDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    await this.ensureStandardBillingServices();

    const service = await this.prisma.billingService.findUnique({
      where: { id: dto.serviceId },
      select: { id: true },
    });
    if (!service) {
      throw new NotFoundException('Услуга биллинга не найдена.');
    }

    return this.prisma.clientBillingService.upsert({
      where: {
        clientId_serviceId: {
          clientId,
          serviceId: dto.serviceId,
        },
      },
      update: {
        priceRub: dto.priceRub,
        taxMode: dto.taxMode ?? BillingPriceTaxMode.INCLUDED,
        isActive: dto.isActive ?? true,
        comment: normalizeText(dto.comment) ?? null,
        updatedByUserId: user.id,
      },
      create: {
        clientId,
        serviceId: dto.serviceId,
        priceRub: dto.priceRub,
        taxMode: dto.taxMode ?? BillingPriceTaxMode.INCLUDED,
        isActive: dto.isActive ?? true,
        comment: normalizeText(dto.comment),
        updatedByUserId: user.id,
      },
      include: {
        service: true,
      },
    });
  }

  listCharges(query: ListBillingChargesDto, user: AuthUser) {
    const where: Prisma.BillingChargeWhereInput = {
      clientId: this.clientScopes.resolveClientFilter(user, query.clientId),
      status: query.status,
    };

    return this.prisma.billingCharge.findMany({
      where,
      include: billingChargeInclude,
      orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
  }

  async listServiceHistory(query: ListBillingServiceHistoryDto, user: AuthUser) {
    const periodFrom = query.periodFrom ? parseDate(query.periodFrom) : undefined;
    const periodTo = query.periodTo ? parseDate(query.periodTo, 'endOfDay') : undefined;
    if (periodFrom && periodTo && periodFrom > periodTo) {
      throw new BadRequestException('Дата начала периода не может быть позже даты окончания.');
    }

    const charges = await this.prisma.billingCharge.findMany({
      where: {
        clientId: this.clientScopes.resolveClientFilter(user, query.clientId),
        serviceDate:
          periodFrom || periodTo
            ? {
                gte: periodFrom,
                lte: periodTo,
              }
            : undefined,
      },
      include: billingChargeInclude,
      orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });

    return buildServiceHistory(charges, periodFrom, periodTo);
  }

  async listReconciliation(query: ListBillingReconciliationDto, user: AuthUser) {
    const periodFrom = query.periodFrom ? parseDate(query.periodFrom) : undefined;
    const periodTo = query.periodTo ? parseDate(query.periodTo, 'endOfDay') : undefined;
    if (periodFrom && periodTo && periodFrom > periodTo) {
      throw new BadRequestException('Дата начала периода не может быть позже даты окончания.');
    }

    const clientId = this.clientScopes.resolveClientFilter(user, query.clientId);
    const [invoices, advances] = await Promise.all([
      this.prisma.billingInvoice.findMany({
        where: {
          clientId,
          client: isBillingAdministrator(user) ? { isDemo: false } : undefined,
          status: { not: BillingInvoiceStatus.CANCELLED },
          periodFrom: periodFrom ? { gte: periodFrom } : undefined,
          periodTo: periodTo ? { lte: periodTo } : undefined,
        },
        include: billingReconciliationInvoiceInclude,
        orderBy: [{ dueDate: 'asc' }, { periodFrom: 'desc' }, { createdAt: 'desc' }],
        take: 500,
      }),
      this.prisma.billingPayment.findMany({
        where: {
          clientId,
          invoiceId: null,
          status: BillingPaymentStatus.RECORDED,
          client: isBillingAdministrator(user) ? { isDemo: false } : undefined,
        },
        include: billingAdvanceInclude,
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    return buildBillingReconciliation(invoices, advances, periodFrom, periodTo);
  }

  async listAdvances(clientId: string | undefined, user: AuthUser) {
    const payments = await this.prisma.billingPayment.findMany({
      where: {
        clientId: this.clientScopes.resolveClientFilter(user, clientId),
        invoiceId: null,
        client: isBillingAdministrator(user) ? { isDemo: false } : undefined,
      },
      include: billingAdvanceInclude,
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });

    return buildBillingAdvances(payments);
  }

  async createAdvance(dto: CreateBillingAdvanceDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    const client = await this.prisma.client.findUnique({
      where: { id: dto.clientId },
      select: { id: true, code: true, name: true },
    });
    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }

    const paidAt = dto.paidAt ? parseDate(dto.paidAt) : new Date();
    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.billingPayment.create({
        data: {
          invoiceId: null,
          clientId: dto.clientId,
          amountRub: roundMoney(dto.amountRub),
          paidAt,
          method: normalizeText(dto.method) ?? 'Банковский перевод',
          reference: normalizeText(dto.reference),
          comment: normalizeText(dto.comment),
          createdByUserId: user.id,
        },
        include: billingAdvanceInclude,
      });

      if (await isClientNotificationEnabled(tx, dto.clientId, ClientNotificationEvent.BILLING_PAYMENT_RECORDED)) {
        await tx.clientNotification.create({
          data: {
            clientId: dto.clientId,
            title: 'Аванс зачислен',
            body: `Зачислен аванс ${formatRub(dto.amountRub)} руб. без привязки к счету.`,
            severity: 'SUCCESS',
            createdByUserId: user.id,
          },
        });
      }

      return created;
    });

    void this.telegram?.notifyClient(
      dto.clientId,
      [
        'LOGOFF WMS: зачислен аванс.',
        `Сумма: ${formatRub(dto.amountRub)} руб.`,
        'Платеж не привязан к счету и уменьшает общий долг.',
      ].join('\n'),
    );

    return payment;
  }

  async cancelAdvance(id: string, user: AuthUser) {
    const payment = await this.prisma.billingPayment.findFirst({
      where: { id, invoiceId: null },
      select: { id: true, clientId: true, status: true },
    });
    if (!payment) {
      throw new NotFoundException('Авансовый платеж не найден.');
    }

    this.clientScopes.requireClientAccess(user, payment.clientId, 'write');
    if (payment.status === BillingPaymentStatus.CANCELLED) {
      throw new BadRequestException('Авансовый платеж уже отменен.');
    }

    return this.prisma.billingPayment.update({
      where: { id },
      data: { status: BillingPaymentStatus.CANCELLED },
      include: billingAdvanceInclude,
    });
  }

  async createCharge(dto: CreateBillingChargeDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');

    const [service] = await Promise.all([
      dto.serviceId
        ? this.prisma.billingService.findUnique({
            where: { id: dto.serviceId },
          })
        : Promise.resolve(null),
      this.ensureRequestBelongsToClient(dto.clientId, dto.requestId),
    ]);

    if (dto.serviceId && !service) {
      throw new NotFoundException('Услуга биллинга не найдена.');
    }

    const unit = dto.unit ?? service?.unit ?? BillingUnit.SERVICE;
    const unitPriceRub = dto.unitPriceRub ?? decimalToNumber(service?.defaultPriceRub);
    if (unitPriceRub == null) {
      throw new BadRequestException('Для начисления нужна цена за единицу.');
    }

    const description = normalizeText(dto.description) ?? service?.name;
    if (!description) {
      throw new BadRequestException('Для начисления нужно описание или выбранная услуга.');
    }

    const totalRub = roundMoney(dto.quantity * unitPriceRub);

    return this.prisma.billingCharge.create({
      data: {
        clientId: dto.clientId,
        serviceId: dto.serviceId,
        requestId: dto.requestId,
        description,
        unit,
        quantity: dto.quantity,
        unitPriceRub,
        totalRub,
        serviceDate: dto.serviceDate ? new Date(dto.serviceDate) : undefined,
        comment: normalizeText(dto.comment),
        createdByUserId: user.id,
      },
      include: billingChargeInclude,
    });
  }

  async generateStorageCharge(dto: GenerateStorageChargeDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');

    const periodFrom = parseDate(dto.periodFrom);
    const periodTo = parseDate(dto.periodTo, 'endOfDay');
    if (periodFrom > periodTo) {
      throw new BadRequestException('Дата начала периода не может быть позже даты окончания.');
    }

    const sourceKey = storageSourceKey(dto.clientId, periodFrom, periodTo);
    const existingCharge = await this.prisma.billingCharge.findFirst({
      where: { sourceKey },
      include: {
        ...billingChargeInclude,
        invoiceItems: {
          select: {
            id: true,
            invoice: { select: { id: true, number: true, status: true } },
          },
        },
      },
    });

    const storageService = await this.ensureStorageService();
    const client = await this.prisma.client.findUnique({
      where: { id: dto.clientId },
      select: { storageAccountingEnabled: true, storagePriceRubPerLiterDay: true },
    });
    if (client && !client.storageAccountingEnabled) {
      throw new BadRequestException('Для клиента отключен учет хранения.');
    }
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        clientId: dto.clientId,
        createdAt: { lte: periodTo },
      },
      select: {
        skuId: true,
        type: true,
        status: true,
        quantity: true,
        createdAt: true,
        sku: {
          select: {
            id: true,
            internalSku: true,
            name: true,
            volumeLiters: true,
            lengthCm: true,
            widthCm: true,
            heightCm: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const balances =
      movements.length === 0
        ? await this.prisma.stockBalance.findMany({
            where: {
              clientId: dto.clientId,
              quantity: { gt: 0 },
            },
            include: {
              sku: {
                select: {
                  id: true,
                  internalSku: true,
                  name: true,
                  volumeLiters: true,
                  lengthCm: true,
                  widthCm: true,
                  heightCm: true,
                },
              },
            },
          })
        : [];

    const unitPriceRub =
      dto.unitPriceRub ?? decimalToNumber(client?.storagePriceRubPerLiterDay) ?? decimalToNumber(storageService.defaultPriceRub);
    if (unitPriceRub == null) {
      throw new BadRequestException('Для хранения нужна цена за литро-день.');
    }

    const details =
      movements.length > 0
        ? calculateHistoricalStorageDetails(movements, periodFrom, periodTo)
        : calculateStorageDetails(balances, countInclusiveDays(periodFrom, periodTo));

    if (details.literDays <= 0) {
      throw new BadRequestException('Нет остатков с заполненным литражом для начисления хранения.');
    }

    const totalRub = roundMoney(details.literDays * unitPriceRub);
    const isApproved = dto.approve === true;
    const chargeData = {
      clientId: dto.clientId,
      serviceId: storageService.id,
      description: `Хранение по литражу ${formatDateKey(periodFrom)} - ${formatDateKey(periodTo)}`,
      unit: BillingUnit.LITER_DAY,
      quantity: details.literDays,
      unitPriceRub,
      totalRub,
      status: isApproved ? BillingChargeStatus.APPROVED : BillingChargeStatus.DRAFT,
      serviceDate: dto.serviceDate ? parseDate(dto.serviceDate) : periodTo,
      source: BillingChargeSource.STORAGE,
      sourceKey,
      metadata: {
        periodFrom: formatDateKey(periodFrom),
        periodTo: formatDateKey(periodTo),
        calculationMode: details.calculationMode,
        days: details.days,
        totalLiters: details.totalLiters,
        literDays: details.literDays,
        balancesCount: details.balancesCount,
        skippedWithoutVolume: details.skippedWithoutVolume,
        daily: details.daily,
        skuTotals: details.skuTotals,
      },
      comment: normalizeText(dto.comment),
      approvedByUserId: isApproved ? user.id : undefined,
      approvedAt: isApproved ? new Date() : undefined,
    } satisfies Prisma.BillingChargeUncheckedCreateInput;

    if (existingCharge) {
      const activeInvoiceItem = existingCharge.invoiceItems.find((item) => item.invoice.status !== BillingInvoiceStatus.CANCELLED);
      if (activeInvoiceItem) {
        throw new BadRequestException(`Начисление хранения уже включено в счет № ${activeInvoiceItem.invoice.number}.`);
      }

      return this.prisma.billingCharge.update({
        where: { id: existingCharge.id },
        data: chargeData,
        include: billingChargeInclude,
      });
    }

    // Русский комментарий: автоматическое хранение пишем одним начислением за период, а детализацию держим в metadata.
    return this.prisma.billingCharge.create({
      data: { ...chargeData, createdByUserId: user.id },
      include: billingChargeInclude,
    });
  }

  async updateChargeStatus(chargeId: string, dto: UpdateBillingChargeStatusDto, user: AuthUser) {
    const charge = await this.prisma.billingCharge.findUnique({
      where: { id: chargeId },
      select: { id: true, clientId: true },
    });

    if (!charge) {
      throw new NotFoundException('Начисление биллинга не найдено.');
    }

    this.clientScopes.requireClientAccess(user, charge.clientId, 'write');

    return this.prisma.billingCharge.update({
      where: { id: chargeId },
      data: {
        status: dto.status,
        approvedByUserId: dto.status === BillingChargeStatus.APPROVED ? user.id : null,
        approvedAt: dto.status === BillingChargeStatus.APPROVED ? new Date() : null,
      },
      include: billingChargeInclude,
    });
  }

  async getStorageChargeBreakdown(chargeId: string, user: AuthUser) {
    const charge = await this.prisma.billingCharge.findUnique({
      where: { id: chargeId },
      include: {
        client: { select: { id: true, code: true, name: true } },
        invoiceItems: {
          select: {
            id: true,
            invoice: { select: { id: true, number: true, status: true } },
          },
        },
      },
    });

    if (!charge) {
      throw new NotFoundException('Начисление не найдено.');
    }

    this.clientScopes.requireClientAccess(user, charge.clientId, 'read');
    if (charge.source !== BillingChargeSource.STORAGE) {
      throw new BadRequestException('Расшифровка доступна только для начислений хранения.');
    }

    return buildStorageChargeBreakdown(charge);
  }

  async deleteStorageChargeDay(chargeId: string, date: string, user: AuthUser) {
    const charge = await this.prisma.billingCharge.findUnique({
      where: { id: chargeId },
      include: {
        invoiceItems: {
          select: {
            id: true,
            invoice: { select: { id: true, number: true, status: true } },
          },
        },
      },
    });

    if (!charge) {
      throw new NotFoundException('Начисление не найдено.');
    }

    this.clientScopes.requireClientAccess(user, charge.clientId, 'write');
    if (charge.source !== BillingChargeSource.STORAGE) {
      throw new BadRequestException('Удалять дни можно только из начислений хранения.');
    }

    const activeInvoiceItem = charge.invoiceItems.find((item) => item.invoice.status !== BillingInvoiceStatus.CANCELLED);
    if (activeInvoiceItem) {
      throw new BadRequestException(`Начисление уже включено в счет № ${activeInvoiceItem.invoice.number}. Сначала отмените счет.`);
    }

    const metadata = asRecord(charge.metadata);
    const daily = Array.isArray(metadata?.daily) ? metadata.daily.filter(isStorageDailyRow) : [];
    const nextDaily = daily.filter((row) => row.date !== date);
    if (daily.length === nextDaily.length) {
      throw new NotFoundException('День в расшифровке не найден.');
    }

    const unitPriceRub = decimalToNumber(charge.unitPriceRub) ?? 0;
    const literDays = roundQuantity(nextDaily.reduce((sum, row) => sum + row.literDays, 0));
    const totalRub = roundMoney(literDays * unitPriceRub);
    const nextMetadata = {
      ...(metadata ?? {}),
      daily: nextDaily,
      days: nextDaily.length,
      literDays,
      totalLiters: nextDaily.length
        ? roundQuantity(nextDaily.reduce((sum, row) => sum + row.totalLiters, 0) / nextDaily.length)
        : 0,
    };

    await this.prisma.billingCharge.update({
      where: { id: charge.id },
      data: {
        quantity: literDays,
        totalRub,
        metadata: nextMetadata,
      },
    });

    return this.getStorageChargeBreakdown(chargeId, user);
  }

  listInvoices(query: ListBillingInvoicesDto, user: AuthUser) {
    const where: Prisma.BillingInvoiceWhereInput = {
      clientId: this.clientScopes.resolveClientFilter(user, query.clientId),
      client: isBillingAdministrator(user) ? { isDemo: false } : undefined,
      status: query.status,
      periodFrom: query.periodFrom ? { gte: parseDate(query.periodFrom) } : undefined,
      periodTo: query.periodTo ? { lte: parseDate(query.periodTo, 'endOfDay') } : undefined,
    };

    return this.prisma.billingInvoice.findMany({
      where,
      include: billingInvoiceInclude,
      orderBy: [{ periodFrom: 'desc' }, { createdAt: 'desc' }],
      take: 150,
    });
  }

  async createInvoice(dto: CreateBillingInvoiceDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');

    const periodFrom = parseDate(dto.periodFrom);
    const periodTo = parseDate(dto.periodTo, 'endOfDay');
    if (periodFrom > periodTo) {
      throw new BadRequestException('Дата начала периода не может быть позже даты окончания.');
    }

    const chargeIds = dto.chargeIds?.length ? [...new Set(dto.chargeIds)] : undefined;
    const charges = await this.prisma.billingCharge.findMany({
      where: {
        clientId: dto.clientId,
        id: chargeIds ? { in: chargeIds } : undefined,
        status: BillingChargeStatus.APPROVED,
        serviceDate: {
          gte: periodFrom,
          lte: periodTo,
        },
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

    if (chargeIds && charges.length !== chargeIds.length) {
      throw new BadRequestException('Не все выбранные начисления утверждены, входят в период или доступны для счета.');
    }

    if (charges.length === 0) {
      throw new BadRequestException('Для счета нет утвержденных начислений за выбранный период.');
    }

    const totalRub = roundMoney(charges.reduce((sum, charge) => sum + (decimalToNumber(charge.totalRub) ?? 0), 0));
    const number = await this.nextInvoiceNumber(periodFrom);

    // Русский комментарий: счет фиксирует снимок начислений, чтобы дальнейшая правка услуги не меняла уже выставленный документ.
    return this.prisma.billingInvoice.create({
      data: {
        number,
        clientId: dto.clientId,
        periodFrom,
        periodTo,
        dueDate: dto.dueDate ? parseDate(dto.dueDate, 'endOfDay') : undefined,
        totalRub,
        comment: normalizeText(dto.comment),
        createdByUserId: user.id,
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
  }

  async createManualInvoice(dto: CreateManualBillingInvoiceDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    if (!dto.rows?.length) {
      throw new BadRequestException('Для счета нужна хотя бы одна строка.');
    }

    await this.ensureStandardClientBillingServices(dto.clientId, user.id);
    const periodFrom = parseDate(dto.periodFrom);
    const periodTo = parseDate(dto.periodTo, 'endOfDay');
    if (periodFrom > periodTo) {
      throw new BadRequestException('Дата начала периода не может быть позже даты окончания.');
    }

    const serviceIds = [...new Set(dto.rows.map((row) => row.serviceId).filter((id): id is string => Boolean(id)))];
    const services = serviceIds.length
      ? await this.prisma.billingService.findMany({
          where: { id: { in: serviceIds } },
          include: {
            clientPrices: {
              where: {
                clientId: dto.clientId,
                isActive: true,
              },
              take: 1,
            },
          },
        })
      : [];
    const servicesById = new Map(services.map((service) => [service.id, service]));
    if (servicesById.size !== serviceIds.length) {
      throw new BadRequestException('Одна или несколько услуг счета не найдены.');
    }

    const rows = dto.rows.map((row) => {
      const service = row.serviceId ? servicesById.get(row.serviceId) : null;
      const clientPrice = service?.clientPrices[0] ?? null;
      const baseUnitPriceRub =
        row.unitPriceRub ?? decimalToNumber(clientPrice?.priceRub) ?? decimalToNumber(service?.defaultPriceRub);
      if (baseUnitPriceRub == null) {
        throw new BadRequestException('Для каждой строки счета нужна цена.');
      }

      const taxMode = row.taxMode ?? clientPrice?.taxMode ?? BillingPriceTaxMode.INCLUDED;
      const unitPriceRub = applyTaxMode(baseUnitPriceRub, taxMode);
      const description = normalizeText(row.description) ?? service?.name;
      if (!description) {
        throw new BadRequestException('Для каждой строки счета нужно описание или услуга.');
      }

      const totalRub = roundMoney(row.quantity * unitPriceRub);
      return {
        serviceId: row.serviceId,
        description,
        unit: row.unit ?? service?.unit ?? BillingUnit.SERVICE,
        quantity: row.quantity,
        unitPriceRub,
        totalRub,
        serviceDate: row.serviceDate ? parseDate(row.serviceDate) : periodTo,
        comment: normalizeText(row.comment),
        metadata: {
          priceBeforeTaxRub: baseUnitPriceRub,
          taxMode,
        },
      };
    });

    const totalRub = roundMoney(rows.reduce((sum, row) => sum + row.totalRub, 0));
    const number = await this.nextInvoiceNumber(periodFrom);

    const updated = await this.prisma.$transaction(async (tx) => {
      const charges: Array<{ id: string }> = [];
      for (const row of rows) {
        charges.push(
          await tx.billingCharge.create({
            data: {
              clientId: dto.clientId,
              serviceId: row.serviceId,
              description: row.description,
              unit: row.unit,
              quantity: row.quantity,
              unitPriceRub: row.unitPriceRub,
              totalRub: row.totalRub,
              status: BillingChargeStatus.APPROVED,
              serviceDate: row.serviceDate,
              source: BillingChargeSource.MANUAL,
              metadata: row.metadata,
              comment: row.comment,
              createdByUserId: user.id,
              approvedByUserId: user.id,
              approvedAt: new Date(),
            },
          }),
        );
      }

      return tx.billingInvoice.create({
        data: {
          number,
          clientId: dto.clientId,
          periodFrom,
          periodTo,
          dueDate: dto.dueDate ? parseDate(dto.dueDate, 'endOfDay') : undefined,
          totalRub,
          comment: normalizeText(dto.comment),
          createdByUserId: user.id,
          items: {
            create: rows.map((row, index) => ({
              chargeId: charges[index].id,
              description: row.description,
              unit: row.unit,
              quantity: row.quantity,
              unitPriceRub: row.unitPriceRub,
              totalRub: row.totalRub,
              serviceDate: row.serviceDate,
            })),
          },
        },
        include: billingInvoiceInclude,
      });
    });
    return updated;
  }

  async updateManualInvoice(invoiceId: string, dto: CreateManualBillingInvoiceDto, user: AuthUser) {
    if (!dto.rows?.length) {
      throw new BadRequestException('Для счета нужна хотя бы одна строка.');
    }

    const invoice = await this.prisma.billingInvoice.findUnique({
      where: { id: invoiceId },
      include: billingInvoiceInclude,
    });
    if (!invoice) {
      throw new NotFoundException('Счет не найден.');
    }
    this.clientScopes.requireClientAccess(user, invoice.clientId, 'write');
    if (invoice.clientId !== dto.clientId) {
      throw new BadRequestException('Клиента чернового счета менять нельзя.');
    }
    if (invoice.status !== BillingInvoiceStatus.DRAFT && invoice.status !== BillingInvoiceStatus.ISSUED) {
      throw new BadRequestException('Редактировать можно счет в статусе «Черновик» или «Выставлен».');
    }
    if ((decimalToNumber(invoice.paidRub) ?? 0) > 0 || invoice.payments.length > 0) {
      throw new BadRequestException('Нельзя редактировать счет, по которому уже есть оплата.');
    }

    await this.ensureStandardClientBillingServices(dto.clientId, user.id);
    const periodFrom = parseDate(dto.periodFrom);
    const periodTo = parseDate(dto.periodTo, 'endOfDay');
    if (periodFrom > periodTo) {
      throw new BadRequestException('Дата начала периода не может быть позже даты окончания.');
    }

    const serviceIds = [...new Set(dto.rows.map((row) => row.serviceId).filter((id): id is string => Boolean(id)))];
    const services = serviceIds.length
      ? await this.prisma.billingService.findMany({
          where: { id: { in: serviceIds } },
          include: {
            clientPrices: {
              where: { clientId: dto.clientId, isActive: true },
              take: 1,
            },
          },
        })
      : [];
    const servicesById = new Map(services.map((service) => [service.id, service]));
    if (servicesById.size !== serviceIds.length) {
      throw new BadRequestException('Одна или несколько услуг счета не найдены.');
    }

    const existingItems = new Map(invoice.items.map((item) => [item.id, item]));
    const requestedItemIds = new Set<string>();
    const rows = dto.rows.map((row) => {
      if (row.invoiceItemId) {
        if (requestedItemIds.has(row.invoiceItemId) || !existingItems.has(row.invoiceItemId)) {
          throw new BadRequestException('Одна из строк не принадлежит редактируемому счету.');
        }
        requestedItemIds.add(row.invoiceItemId);
      }

      const service = row.serviceId ? servicesById.get(row.serviceId) : null;
      const clientPrice = service?.clientPrices[0] ?? null;
      const baseUnitPriceRub =
        row.unitPriceRub ?? decimalToNumber(clientPrice?.priceRub) ?? decimalToNumber(service?.defaultPriceRub);
      if (baseUnitPriceRub == null) {
        throw new BadRequestException('Для каждой строки счета нужна цена.');
      }
      const taxMode = row.taxMode ?? clientPrice?.taxMode ?? BillingPriceTaxMode.INCLUDED;
      const unitPriceRub = applyTaxMode(baseUnitPriceRub, taxMode);
      const description = normalizeText(row.description) ?? service?.name;
      if (!description) {
        throw new BadRequestException('Для каждой строки счета нужно описание или услуга.');
      }

      return {
        invoiceItemId: row.invoiceItemId,
        serviceId: row.serviceId,
        description,
        unit: row.unit ?? service?.unit ?? BillingUnit.SERVICE,
        quantity: row.quantity,
        unitPriceRub,
        totalRub: roundMoney(row.quantity * unitPriceRub),
        serviceDate: row.serviceDate ? parseDate(row.serviceDate) : periodTo,
        comment: normalizeText(row.comment),
        metadata: { priceBeforeTaxRub: baseUnitPriceRub, taxMode },
      };
    });
    const totalRub = roundMoney(rows.reduce((sum, row) => sum + row.totalRub, 0));

    return this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const existingItem = row.invoiceItemId ? existingItems.get(row.invoiceItemId) : null;
        let chargeId = existingItem?.chargeId ?? null;
        const chargeData = {
          clientId: invoice.clientId,
          requestId: invoice.requestId,
          serviceId: row.serviceId,
          description: row.description,
          unit: row.unit,
          quantity: row.quantity,
          unitPriceRub: row.unitPriceRub,
          totalRub: row.totalRub,
          status: BillingChargeStatus.APPROVED,
          serviceDate: row.serviceDate,
          metadata: row.metadata,
          comment: row.comment,
          approvedByUserId: user.id,
          approvedAt: new Date(),
        };

        if (chargeId) {
          await tx.billingCharge.update({ where: { id: chargeId }, data: chargeData });
        } else {
          const charge = await tx.billingCharge.create({
            data: {
              ...chargeData,
              source: BillingChargeSource.MANUAL,
              createdByUserId: user.id,
            },
            select: { id: true },
          });
          chargeId = charge.id;
        }

        const itemData = {
          chargeId,
          description: row.description,
          unit: row.unit,
          quantity: row.quantity,
          unitPriceRub: row.unitPriceRub,
          totalRub: row.totalRub,
          serviceDate: row.serviceDate,
        };
        if (existingItem) {
          await tx.billingInvoiceItem.update({ where: { id: existingItem.id }, data: itemData });
        } else {
          await tx.billingInvoiceItem.create({ data: { invoiceId: invoice.id, ...itemData } });
        }
      }

      const removedItems = invoice.items.filter((item) => !requestedItemIds.has(item.id));
      if (removedItems.length > 0) {
        await tx.billingInvoiceItem.deleteMany({ where: { id: { in: removedItems.map((item) => item.id) } } });
        for (const removed of removedItems) {
          if (!removed.chargeId) {
            continue;
          }
          const linkedItems = await tx.billingInvoiceItem.count({ where: { chargeId: removed.chargeId } });
          if (linkedItems === 0) {
            await tx.billingCharge.update({
              where: { id: removed.chargeId },
              data: {
                status: BillingChargeStatus.CANCELLED,
                comment: 'Строка удалена при редактировании счета.',
              },
            });
          }
        }
      }

      return tx.billingInvoice.update({
        where: { id: invoice.id },
        data: {
          periodFrom,
          periodTo,
          dueDate: dto.dueDate ? parseDate(dto.dueDate, 'endOfDay') : null,
          totalRub,
          comment: normalizeText(dto.comment),
        },
        include: billingInvoiceInclude,
      });
    });
  }

  async updateInvoiceStatus(invoiceId: string, dto: UpdateBillingInvoiceStatusDto, user: AuthUser) {
    const invoice = await this.prisma.billingInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        number: true,
        clientId: true,
        status: true,
        totalRub: true,
        paidRub: true,
        issuedAt: true,
        paidAt: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Счет биллинга не найден.');
    }

    this.clientScopes.requireClientAccess(user, invoice.clientId, 'write');

    const paidRub = decimalToNumber(invoice.paidRub) ?? 0;
    const totalRub = decimalToNumber(invoice.totalRub) ?? 0;
    if (dto.status === BillingInvoiceStatus.CANCELLED && paidRub > 0) {
      throw new BadRequestException('Нельзя отменить счет с зафиксированными оплатами.');
    }

    if (dto.status === BillingInvoiceStatus.DRAFT && paidRub > 0) {
      throw new BadRequestException('Нельзя вернуть в черновик счет с оплатами.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.billingInvoice.update({
        where: { id: invoiceId },
        data: {
          status: dto.status,
          paidRub: dto.status === BillingInvoiceStatus.PAID ? totalRub : invoice.paidRub,
          issuedAt:
            dto.status === BillingInvoiceStatus.DRAFT
              ? null
              : dto.status === BillingInvoiceStatus.ISSUED || dto.status === BillingInvoiceStatus.PAID
                ? invoice.issuedAt ?? new Date()
                : invoice.issuedAt,
          paidAt: dto.status === BillingInvoiceStatus.PAID ? invoice.paidAt ?? new Date() : null,
        },
        include: billingInvoiceInclude,
      });

      if (
        invoice.status !== dto.status &&
        (await isClientNotificationEnabled(tx, invoice.clientId, ClientNotificationEvent.BILLING_INVOICE_STATUS_CHANGED))
      ) {
        await tx.clientNotification.create({
          data: {
            clientId: invoice.clientId,
            title: 'Статус счета изменен',
            body: `Счет № ${invoice.number}: ${billingInvoiceStatusLabel(invoice.status)} -> ${billingInvoiceStatusLabel(dto.status)}`,
            severity: dto.status === BillingInvoiceStatus.PAID ? 'SUCCESS' : 'INFO',
            createdByUserId: user.id,
          },
        });
      }

      return updated;
    });

    if (invoice.status !== dto.status) {
      void this.telegram?.notifyClient(
        invoice.clientId,
        [
          'LOGOFF WMS: изменен статус счета.',
          `Счет № ${invoice.number}`,
          `Статус: ${billingInvoiceStatusLabel(invoice.status)} -> ${billingInvoiceStatusLabel(dto.status)}`,
        ].join('\n'),
      );
    }

    return updated;
  }

  async createPayment(dto: CreateBillingPaymentDto, user: AuthUser) {
    const invoice = await this.prisma.billingInvoice.findUnique({
      where: { id: dto.invoiceId },
      select: {
        id: true,
        number: true,
        clientId: true,
        status: true,
        totalRub: true,
        paidRub: true,
        issuedAt: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Счет биллинга не найден.');
    }

    this.clientScopes.requireClientAccess(user, invoice.clientId, 'write');

    if (invoice.status === BillingInvoiceStatus.CANCELLED) {
      throw new BadRequestException('Нельзя принять оплату по отмененному счету.');
    }

    const totalRub = decimalToNumber(invoice.totalRub) ?? 0;
    const paidRub = decimalToNumber(invoice.paidRub) ?? 0;
    const remainingRub = roundMoney(totalRub - paidRub);
    if (dto.amountRub > remainingRub) {
      throw new BadRequestException('Сумма оплаты превышает остаток по счету.');
    }

    const paidAt = dto.paidAt ? parseDate(dto.paidAt) : new Date();
    const nextPaidRub = roundMoney(paidRub + dto.amountRub);
    const nextStatus = nextPaidRub >= totalRub ? BillingInvoiceStatus.PAID : BillingInvoiceStatus.ISSUED;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.billingPayment.create({
        data: {
          invoiceId: invoice.id,
          clientId: invoice.clientId,
          amountRub: dto.amountRub,
          paidAt,
          method: normalizeText(dto.method),
          reference: normalizeText(dto.reference),
          comment: normalizeText(dto.comment),
          createdByUserId: user.id,
        },
      });

      const updated = await tx.billingInvoice.update({
        where: { id: invoice.id },
        data: {
          paidRub: nextPaidRub,
          status: nextStatus,
          issuedAt: invoice.issuedAt ?? new Date(),
          paidAt: nextStatus === BillingInvoiceStatus.PAID ? paidAt : null,
        },
        include: billingInvoiceInclude,
      });

      if (await isClientNotificationEnabled(tx, invoice.clientId, ClientNotificationEvent.BILLING_PAYMENT_RECORDED)) {
        await tx.clientNotification.create({
          data: {
            clientId: invoice.clientId,
            title: 'Оплата по счету принята',
            body: `Счет № ${invoice.number}: ${formatRub(dto.amountRub)} руб. Оплачено ${formatRub(nextPaidRub)} из ${formatRub(totalRub)} руб.`,
            severity: nextStatus === BillingInvoiceStatus.PAID ? 'SUCCESS' : 'INFO',
            createdByUserId: user.id,
          },
        });
      }

      return updated;
    });

    void this.telegram?.notifyClient(
      invoice.clientId,
      [
        'LOGOFF WMS: получена оплата по счету.',
        `Счет № ${invoice.number}`,
        `Оплата: ${formatRub(dto.amountRub)} руб.`,
        `Оплачено: ${formatRub(nextPaidRub)} из ${formatRub(totalRub)} руб.`,
      ].join('\n'),
    );

    return updated;
  }

  private async ensureRequestBelongsToClient(clientId: string, requestId?: string) {
    if (!requestId) {
      return;
    }

    const request = await this.prisma.clientRequest.findFirst({
      where: {
        id: requestId,
        clientId,
      },
      select: { id: true },
    });

    if (!request) {
      throw new BadRequestException('Заявка не принадлежит выбранному клиенту.');
    }
  }

  private async ensureStandardBillingServices() {
    await Promise.all(
      STANDARD_BILLING_SERVICES.map((service) =>
        this.prisma.billingService.upsert({
          where: { code: service.code },
          update: {
            name: service.name,
            unit: service.unit,
            defaultPriceRub: service.defaultPriceRub,
            isActive: true,
          },
          create: service,
        }),
      ),
    );
  }

  private async ensureStandardClientBillingServices(clientId: string, userId?: string) {
    await this.ensureStandardBillingServices();
    const services = await this.prisma.billingService.findMany({
      where: {
        code: { in: STANDARD_BILLING_SERVICES.map((service) => service.code) },
      },
    });

    await Promise.all(
      services.map((service) =>
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
            taxMode: BillingPriceTaxMode.INCLUDED,
            isActive: true,
            updatedByUserId: userId,
          },
        }),
      ),
    );
  }

  private async nextInvoiceNumber(periodFrom: Date) {
    const prefix = `INV-${periodFrom.getUTCFullYear()}${String(periodFrom.getUTCMonth() + 1).padStart(2, '0')}`;
    const count = await this.prisma.billingInvoice.count({
      where: {
        number: {
          startsWith: prefix,
        },
      },
    });

    return `${prefix}-${String(count + 1).padStart(4, '0')}`;
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
}

const STORAGE_SERVICE_CODE = 'STORAGE_LITER_DAY';

function isBillingAdministrator(user: AuthUser) {
  return (
    user.permissionCodes.includes('system:admin') ||
    user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER')
  );
}

const STANDARD_BILLING_SERVICES = [
  {
    code: 'FBS_PROCESSING',
    name: 'Обработка заказа FBS',
    unit: BillingUnit.PIECE,
    defaultPriceRub: 0,
    isActive: true,
  },
  {
    code: 'BOX_60_40_40',
    name: 'Короб 60*40*40',
    unit: BillingUnit.PIECE,
    defaultPriceRub: 100,
    isActive: true,
  },
  {
    code: 'BOX_ASSEMBLY',
    name: 'Сборка короба',
    unit: BillingUnit.PIECE,
    defaultPriceRub: 40,
    isActive: true,
  },
  {
    code: 'PALLET',
    name: 'Паллет',
    unit: BillingUnit.PALLET,
    defaultPriceRub: 350,
    isActive: true,
  },
  {
    code: 'PALLET_ASSEMBLY',
    name: 'Сборка паллета',
    unit: BillingUnit.PALLET,
    defaultPriceRub: 250,
    isActive: true,
  },
] satisfies Prisma.BillingServiceUncheckedCreateInput[];

const billingChargeInclude = {
  client: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  service: true,
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
  approvedBy: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
} satisfies Prisma.BillingChargeInclude;

const billingInvoiceInclude = {
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
  items: {
    include: {
      charge: {
        select: {
          id: true,
          serviceId: true,
          description: true,
          status: true,
          sourceKey: true,
          metadata: true,
        },
      },
    },
    orderBy: [{ serviceDate: 'asc' }, { id: 'asc' }],
  },
  payments: {
    orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
  },
} satisfies Prisma.BillingInvoiceInclude;

const billingReconciliationInvoiceInclude = {
  client: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
} satisfies Prisma.BillingInvoiceInclude;

const billingAdvanceInclude = {
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
} satisfies Prisma.BillingPaymentInclude;

type BillingChargeWithRelations = Prisma.BillingChargeGetPayload<{ include: typeof billingChargeInclude }>;
type BillingInvoiceForReconciliation = Prisma.BillingInvoiceGetPayload<{
  include: typeof billingReconciliationInvoiceInclude;
}>;
type BillingAdvanceWithRelations = Prisma.BillingPaymentGetPayload<{
  include: typeof billingAdvanceInclude;
}>;

type ServiceHistoryGroup = {
  key: string;
  clientId: string;
  serviceId: string | null;
  serviceCode: string;
  serviceName: string;
  source: BillingChargeSource;
  unit: BillingUnit;
  chargesCount: number;
  quantity: number;
  totalRub: number;
  draftRub: number;
  approvedRub: number;
  cancelledRub: number;
  firstServiceDate: string;
  lastServiceDate: string;
  latestStatus: BillingChargeStatus;
  charges: BillingChargeWithRelations[];
};

function buildServiceHistory(charges: BillingChargeWithRelations[], periodFrom?: Date, periodTo?: Date) {
  const groups = new Map<string, ServiceHistoryGroup>();
  const totals = {
    chargesCount: charges.length,
    totalRub: 0,
    draftRub: 0,
    approvedRub: 0,
    cancelledRub: 0,
  };

  charges.forEach((charge) => {
    const totalRub = decimalToNumber(charge.totalRub) ?? 0;
    const quantity = decimalToNumber(charge.quantity) ?? 0;
    const key = [
      charge.clientId,
      charge.serviceId ?? 'manual',
      charge.source,
      charge.unit,
      charge.serviceId ? '' : charge.description,
    ].join(':');

    totals.totalRub = roundMoney(totals.totalRub + totalRub);
    if (charge.status === BillingChargeStatus.APPROVED) {
      totals.approvedRub = roundMoney(totals.approvedRub + totalRub);
    } else if (charge.status === BillingChargeStatus.CANCELLED) {
      totals.cancelledRub = roundMoney(totals.cancelledRub + totalRub);
    } else {
      totals.draftRub = roundMoney(totals.draftRub + totalRub);
    }

    const serviceName = charge.service?.name ?? charge.description;
    const serviceCode = charge.service?.code ?? sourceCode(charge.source);
    const serviceDate = charge.serviceDate.toISOString();
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        key,
        clientId: charge.clientId,
        serviceId: charge.serviceId,
        serviceCode,
        serviceName,
        source: charge.source,
        unit: charge.unit,
        chargesCount: 1,
        quantity,
        totalRub,
        draftRub: charge.status === BillingChargeStatus.DRAFT ? totalRub : 0,
        approvedRub: charge.status === BillingChargeStatus.APPROVED ? totalRub : 0,
        cancelledRub: charge.status === BillingChargeStatus.CANCELLED ? totalRub : 0,
        firstServiceDate: serviceDate,
        lastServiceDate: serviceDate,
        latestStatus: charge.status,
        charges: [charge],
      });
      return;
    }

    existing.chargesCount += 1;
    existing.quantity = roundQuantity(existing.quantity + quantity);
    existing.totalRub = roundMoney(existing.totalRub + totalRub);
    existing.draftRub = roundMoney(existing.draftRub + (charge.status === BillingChargeStatus.DRAFT ? totalRub : 0));
    existing.approvedRub = roundMoney(
      existing.approvedRub + (charge.status === BillingChargeStatus.APPROVED ? totalRub : 0),
    );
    existing.cancelledRub = roundMoney(
      existing.cancelledRub + (charge.status === BillingChargeStatus.CANCELLED ? totalRub : 0),
    );
    existing.firstServiceDate = serviceDate < existing.firstServiceDate ? serviceDate : existing.firstServiceDate;
    existing.lastServiceDate = serviceDate > existing.lastServiceDate ? serviceDate : existing.lastServiceDate;
    existing.latestStatus = serviceDate >= existing.lastServiceDate ? charge.status : existing.latestStatus;
    existing.charges.push(charge);
  });

  return {
    periodFrom: periodFrom?.toISOString() ?? null,
    periodTo: periodTo?.toISOString() ?? null,
    generatedAt: new Date().toISOString(),
    totals,
    groups: [...groups.values()].sort((left, right) => right.lastServiceDate.localeCompare(left.lastServiceDate)),
  };
}

function buildBillingAdvances(payments: BillingAdvanceWithRelations[]) {
  const clients = new Map<
    string,
    {
      client: { id: string; code: string; name: string };
      balanceRub: number;
      recordedCount: number;
      cancelledCount: number;
      latestPaidAt: string | null;
    }
  >();

  payments.forEach((payment) => {
    let client = clients.get(payment.clientId);
    if (!client) {
      client = {
        client: payment.client,
        balanceRub: 0,
        recordedCount: 0,
        cancelledCount: 0,
        latestPaidAt: null,
      };
      clients.set(payment.clientId, client);
    }

    const amountRub = decimalToNumber(payment.amountRub) ?? 0;
    if (payment.status === BillingPaymentStatus.RECORDED) {
      client.balanceRub = roundMoney(client.balanceRub + amountRub);
      client.recordedCount += 1;
      const paidAt = payment.paidAt.toISOString();
      client.latestPaidAt = !client.latestPaidAt || paidAt > client.latestPaidAt ? paidAt : client.latestPaidAt;
    } else {
      client.cancelledCount += 1;
    }
  });

  const summaries = [...clients.values()].sort(
    (left, right) => right.balanceRub - left.balanceRub || left.client.code.localeCompare(right.client.code),
  );

  return {
    totalBalanceRub: roundMoney(summaries.reduce((sum, client) => sum + client.balanceRub, 0)),
    clients: summaries,
    entries: payments.map((payment) => ({
      id: payment.id,
      clientId: payment.clientId,
      invoiceId: payment.invoiceId,
      amountRub: decimalToNumber(payment.amountRub) ?? 0,
      paidAt: payment.paidAt.toISOString(),
      method: payment.method,
      reference: payment.reference,
      comment: payment.comment,
      status: payment.status,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
      client: payment.client,
      createdBy: payment.createdBy,
    })),
  };
}

function buildBillingReconciliation(
  invoices: BillingInvoiceForReconciliation[],
  advances: BillingAdvanceWithRelations[],
  periodFrom?: Date,
  periodTo?: Date,
  now = new Date(),
) {
  const clients = new Map<
    string,
    {
      client: { id: string; code: string; name: string };
      invoicesCount: number;
      openInvoicesCount: number;
      paidInvoicesCount: number;
      overdueInvoicesCount: number;
      totalRub: number;
      paidRub: number;
      grossDebtRub: number;
      advanceRub: number;
      debtRub: number;
      creditRub: number;
      grossOverdueRub: number;
      overdueRub: number;
      nearestDueDate: string | null;
      latestInvoiceDate: string | null;
      invoices: Array<{
        id: string;
        number: string;
        status: BillingInvoiceStatus;
        periodFrom: string;
        periodTo: string;
        dueDate: string | null;
        issuedAt: string | null;
        paidAt: string | null;
        totalRub: number;
        paidRub: number;
        remainingRub: number;
        overdueDays: number;
      }>;
    }
  >();

  const totals = {
    invoicesCount: 0,
    openInvoicesCount: 0,
    paidInvoicesCount: 0,
    overdueInvoicesCount: 0,
    totalRub: 0,
    paidRub: 0,
    grossDebtRub: 0,
    advanceRub: 0,
    debtRub: 0,
    creditRub: 0,
    grossOverdueRub: 0,
    overdueRub: 0,
  };

  invoices.forEach((invoice) => {
    const totalRub = decimalToNumber(invoice.totalRub) ?? 0;
    const paidRub = decimalToNumber(invoice.paidRub) ?? 0;
    const remainingRub = roundMoney(Math.max(0, totalRub - paidRub));
    const overdueDays = calculateOverdueDays(invoice.dueDate, remainingRub, invoice.status, now);
    const isOpen = remainingRub > 0 && invoice.status !== BillingInvoiceStatus.PAID;
    const isOverdue = overdueDays > 0;
    const issuedOrCreatedAt = (invoice.issuedAt ?? invoice.createdAt).toISOString();
    const dueDate = invoice.dueDate?.toISOString() ?? null;

    let client = clients.get(invoice.clientId);
    if (!client) {
      client = {
        client: invoice.client,
        invoicesCount: 0,
        openInvoicesCount: 0,
        paidInvoicesCount: 0,
        overdueInvoicesCount: 0,
        totalRub: 0,
        paidRub: 0,
        grossDebtRub: 0,
        advanceRub: 0,
        debtRub: 0,
        creditRub: 0,
        grossOverdueRub: 0,
        overdueRub: 0,
        nearestDueDate: null,
        latestInvoiceDate: null,
        invoices: [],
      };
      clients.set(invoice.clientId, client);
    }

    client.invoicesCount += 1;
    client.openInvoicesCount += isOpen ? 1 : 0;
    client.paidInvoicesCount += invoice.status === BillingInvoiceStatus.PAID ? 1 : 0;
    client.overdueInvoicesCount += isOverdue ? 1 : 0;
    client.totalRub = roundMoney(client.totalRub + totalRub);
    client.paidRub = roundMoney(client.paidRub + paidRub);
    client.grossDebtRub = roundMoney(client.grossDebtRub + remainingRub);
    client.grossOverdueRub = roundMoney(client.grossOverdueRub + (isOverdue ? remainingRub : 0));
    client.nearestDueDate =
      isOpen && dueDate && (!client.nearestDueDate || dueDate < client.nearestDueDate) ? dueDate : client.nearestDueDate;
    client.latestInvoiceDate =
      !client.latestInvoiceDate || issuedOrCreatedAt > client.latestInvoiceDate ? issuedOrCreatedAt : client.latestInvoiceDate;
    client.invoices.push({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      periodFrom: invoice.periodFrom.toISOString(),
      periodTo: invoice.periodTo.toISOString(),
      dueDate,
      issuedAt: invoice.issuedAt?.toISOString() ?? null,
      paidAt: invoice.paidAt?.toISOString() ?? null,
      totalRub,
      paidRub,
      remainingRub,
      overdueDays,
    });

    totals.invoicesCount += 1;
    totals.openInvoicesCount += isOpen ? 1 : 0;
    totals.paidInvoicesCount += invoice.status === BillingInvoiceStatus.PAID ? 1 : 0;
    totals.overdueInvoicesCount += isOverdue ? 1 : 0;
    totals.totalRub = roundMoney(totals.totalRub + totalRub);
    totals.paidRub = roundMoney(totals.paidRub + paidRub);
    totals.grossDebtRub = roundMoney(totals.grossDebtRub + remainingRub);
    totals.grossOverdueRub = roundMoney(totals.grossOverdueRub + (isOverdue ? remainingRub : 0));
  });

  advances.forEach((advance) => {
    let client = clients.get(advance.clientId);
    if (!client) {
      client = {
        client: advance.client,
        invoicesCount: 0,
        openInvoicesCount: 0,
        paidInvoicesCount: 0,
        overdueInvoicesCount: 0,
        totalRub: 0,
        paidRub: 0,
        grossDebtRub: 0,
        advanceRub: 0,
        debtRub: 0,
        creditRub: 0,
        grossOverdueRub: 0,
        overdueRub: 0,
        nearestDueDate: null,
        latestInvoiceDate: null,
        invoices: [],
      };
      clients.set(advance.clientId, client);
    }
    client.advanceRub = roundMoney(client.advanceRub + (decimalToNumber(advance.amountRub) ?? 0));
  });

  const reconciledClients = [...clients.values()]
    .map((client) => {
      const debtRub = roundMoney(Math.max(0, client.grossDebtRub - client.advanceRub));
      const creditRub = roundMoney(Math.max(0, client.advanceRub - client.grossDebtRub));
      const overdueRub = roundMoney(Math.max(0, client.grossOverdueRub - client.advanceRub));
      totals.advanceRub = roundMoney(totals.advanceRub + client.advanceRub);
      totals.debtRub = roundMoney(totals.debtRub + debtRub);
      totals.creditRub = roundMoney(totals.creditRub + creditRub);
      totals.overdueRub = roundMoney(totals.overdueRub + overdueRub);

      return {
        ...client,
        debtRub,
        creditRub,
        overdueRub,
        invoices: client.invoices.sort((left, right) => {
          const leftDue = left.dueDate ?? '9999-12-31';
          const rightDue = right.dueDate ?? '9999-12-31';
          return leftDue.localeCompare(rightDue) || right.periodFrom.localeCompare(left.periodFrom);
        }),
      };
    })
    .sort(
      (left, right) =>
        right.debtRub - left.debtRub ||
        right.overdueRub - left.overdueRub ||
        left.client.code.localeCompare(right.client.code),
    );

  return {
    periodFrom: periodFrom?.toISOString() ?? null,
    periodTo: periodTo?.toISOString() ?? null,
    generatedAt: now.toISOString(),
    totals,
    clients: reconciledClients,
  };
}

function calculateOverdueDays(
  dueDate: Date | null,
  remainingRub: number,
  status: BillingInvoiceStatus,
  now: Date,
) {
  if (!dueDate || remainingRub <= 0 || status === BillingInvoiceStatus.PAID || status === BillingInvoiceStatus.CANCELLED) {
    return 0;
  }

  const dueDay = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (dueDay >= currentDay) {
    return 0;
  }

  return Math.max(1, Math.floor((currentDay - dueDay) / 86_400_000));
}

function normalizeText(value?: string) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function decimalToNumber(value: Prisma.Decimal | string | number | null | undefined) {
  return value == null ? undefined : Number(value);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function applyTaxMode(unitPriceRub: number, taxMode: BillingPriceTaxMode) {
  if (taxMode === BillingPriceTaxMode.ADD_6_PERCENT) {
    return roundMoney((unitPriceRub / 94) * 100);
  }

  return roundMoney(unitPriceRub);
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function parseDate(value: string, mode: 'startOfDay' | 'endOfDay' = 'startOfDay') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Некорректная дата.');
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (mode === 'endOfDay') {
      date.setUTCHours(23, 59, 59, 999);
    } else {
      date.setUTCHours(0, 0, 0, 0);
    }
  }

  return date;
}

function countInclusiveDays(periodFrom: Date, periodTo: Date) {
  const from = Date.UTC(periodFrom.getUTCFullYear(), periodFrom.getUTCMonth(), periodFrom.getUTCDate());
  const to = Date.UTC(periodTo.getUTCFullYear(), periodTo.getUTCMonth(), periodTo.getUTCDate());
  return Math.floor((to - from) / 86_400_000) + 1;
}

function buildStorageChargeBreakdown(charge: {
  id: string;
  clientId: string;
  description: string;
  quantity: Prisma.Decimal | number | string;
  unitPriceRub: Prisma.Decimal | number | string;
  totalRub: Prisma.Decimal | number | string;
  metadata: Prisma.JsonValue | null;
  invoiceItems?: Array<{ invoice: { status: BillingInvoiceStatus } }>;
}) {
  const metadata = asRecord(charge.metadata);
  const unitPriceRub = decimalToNumber(charge.unitPriceRub) ?? 0;
  const daily = Array.isArray(metadata?.daily) ? metadata.daily.filter(isStorageDailyRow) : [];

  return {
    chargeId: charge.id,
    description: charge.description,
    periodFrom: typeof metadata?.periodFrom === 'string' ? metadata.periodFrom : null,
    periodTo: typeof metadata?.periodTo === 'string' ? metadata.periodTo : null,
    unitPriceRub,
    quantity: decimalToNumber(charge.quantity) ?? 0,
    totalRub: decimalToNumber(charge.totalRub) ?? 0,
    canDeleteRows: !(charge.invoiceItems ?? []).some((item) => item.invoice.status !== BillingInvoiceStatus.CANCELLED),
    rows: daily.map((row) => ({
      date: row.date,
      document: 'Хранение по литражу',
      description: 'Автоматическое начисление хранения за день.',
      totalLiters: row.totalLiters,
      literDays: row.literDays,
      positions: row.positions,
      unitPriceRub,
      totalRub: roundMoney(row.literDays * unitPriceRub),
    })),
  };
}

function isStorageDailyRow(value: unknown): value is { date: string; totalLiters: number; literDays: number; positions: number } {
  const row = asRecord(value);
  return (
    typeof row?.date === 'string' &&
    typeof row.totalLiters === 'number' &&
    typeof row.literDays === 'number' &&
    typeof row.positions === 'number'
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function calculateStorageDetails(
  balances: Array<{ quantity: number; sku: StorageSkuVolumeSource }>,
  days: number,
) {
  let totalLiters = 0;
  let skippedWithoutVolume = 0;

  balances.forEach((balance) => {
    const volumeLiters = calculateSkuVolumeLiters(balance.sku);
    if (!volumeLiters || volumeLiters <= 0) {
      skippedWithoutVolume += 1;
      return;
    }

    totalLiters += balance.quantity * volumeLiters;
  });

  const roundedLiters = roundQuantity(totalLiters);
  return {
    calculationMode: 'SNAPSHOT',
    days,
    totalLiters: roundedLiters,
    literDays: roundQuantity(roundedLiters * days),
    balancesCount: balances.length,
    skippedWithoutVolume,
    daily: [],
    skuTotals: [],
  };
}

function calculateHistoricalStorageDetails(
  movements: Array<{
    skuId: string;
    type: MovementType;
    status: string;
    quantity: number;
    createdAt: Date;
    sku: {
      id: string;
      internalSku: string;
      name: string;
    } & StorageSkuVolumeSource;
  }>,
  periodFrom: Date,
  periodTo: Date,
) {
  const sorted = [...movements].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const quantities = new Map<string, HistoricalBalanceState>();
  const skuTotals = new Map<string, HistoricalSkuTotal>();
  const daily: Array<{ date: string; totalLiters: number; literDays: number; positions: number }> = [];
  let movementIndex = 0;
  let skippedWithoutVolume = 0;
  let literDays = 0;
  let totalLitersSum = 0;
  const days = listPeriodDays(periodFrom, periodTo);
  const periodStart = new Date(Date.UTC(periodFrom.getUTCFullYear(), periodFrom.getUTCMonth(), periodFrom.getUTCDate()));

  while (movementIndex < sorted.length && sorted[movementIndex].createdAt < periodStart) {
    const movement = sorted[movementIndex];
    if (isHistoricalStorageMovement(movement)) {
      applyHistoricalStorageMovement(quantities, movement);
      const volumeLiters = calculateSkuVolumeLiters(movement.sku) || null;
      if (!volumeLiters || volumeLiters <= 0) {
        skippedWithoutVolume += 1;
      }
    }
    movementIndex += 1;
  }

  days.forEach((day) => {
    const dayEnd = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999));

    let dayLiters = 0;
    let positions = 0;
    quantities.forEach((state) => {
      if (state.quantity <= 0 || !state.volumeLiters || state.volumeLiters <= 0) {
        return;
      }

      const rowLiters = state.quantity * state.volumeLiters;
      dayLiters += rowLiters;
      positions += 1;

      const skuTotal =
        skuTotals.get(state.skuId) ??
        ({
          skuId: state.skuId,
          internalSku: state.internalSku,
          name: state.name,
          volumeLiters: state.volumeLiters,
          literDays: 0,
        } satisfies HistoricalSkuTotal);
      skuTotal.literDays += rowLiters;
      skuTotals.set(state.skuId, skuTotal);
    });

    const roundedDayLiters = roundQuantity(dayLiters);
    totalLitersSum += roundedDayLiters;
    literDays += roundedDayLiters;
    daily.push({
      date: formatDateKey(day),
      totalLiters: roundedDayLiters,
      literDays: roundedDayLiters,
      positions,
    });

    while (movementIndex < sorted.length && sorted[movementIndex].createdAt <= dayEnd) {
      const movement = sorted[movementIndex];
      if (isHistoricalStorageMovement(movement)) {
        applyHistoricalStorageMovement(quantities, movement);
        const volumeLiters = calculateSkuVolumeLiters(movement.sku) || null;
        if (!volumeLiters || volumeLiters <= 0) {
          skippedWithoutVolume += 1;
        }
      }
      movementIndex += 1;
    }
  });

  return {
    calculationMode: 'LEDGER',
    days: days.length,
    totalLiters: roundQuantity(totalLitersSum / Math.max(days.length, 1)),
    literDays: roundQuantity(literDays),
    balancesCount: quantities.size,
    skippedWithoutVolume,
    daily,
    skuTotals: [...skuTotals.values()]
      .map((item) => ({
        skuId: item.skuId,
        internalSku: item.internalSku,
        name: item.name,
        volumeLiters: item.volumeLiters,
        literDays: roundQuantity(item.literDays),
      }))
      .sort((left, right) => right.literDays - left.literDays)
      .slice(0, 50),
  };
}

function isHistoricalStorageMovement(movement: { type: MovementType; quantity: number }) {
  if (movement.type === MovementType.PICK || movement.type === MovementType.PACK || movement.type === MovementType.MOVE) {
    return false;
  }
  if (movement.type === MovementType.SHIP) {
    return movement.quantity < 0;
  }
  return movement.quantity !== 0;
}

function applyHistoricalStorageMovement(
  quantities: Map<string, HistoricalBalanceState>,
  movement: {
    skuId: string;
    status: string;
    quantity: number;
    sku: {
      internalSku: string;
      name: string;
    } & StorageSkuVolumeSource;
  },
) {
  const volumeLiters = calculateSkuVolumeLiters(movement.sku) || null;
  const key = `${movement.skuId}:${movement.status}`;
  const current =
    quantities.get(key) ??
    ({
      skuId: movement.skuId,
      status: movement.status,
      internalSku: movement.sku.internalSku,
      name: movement.sku.name,
      volumeLiters,
      quantity: 0,
    } satisfies HistoricalBalanceState);
  current.quantity += movement.quantity;
  current.volumeLiters = volumeLiters || current.volumeLiters;
  quantities.set(key, current);
}

type HistoricalBalanceState = {
  skuId: string;
  status: string;
  internalSku: string;
  name: string;
  volumeLiters: number | null;
  quantity: number;
};

type HistoricalSkuTotal = {
  skuId: string;
  internalSku: string;
  name: string;
  volumeLiters: number;
  literDays: number;
};

type StorageSkuVolumeSource = {
  volumeLiters: Prisma.Decimal | string | number | null;
  lengthCm?: Prisma.Decimal | string | number | null;
  widthCm?: Prisma.Decimal | string | number | null;
  heightCm?: Prisma.Decimal | string | number | null;
};

function calculateSkuVolumeLiters(sku: StorageSkuVolumeSource) {
  const storedVolume = decimalToNumber(sku.volumeLiters);
  if (storedVolume && storedVolume > 0) {
    return roundQuantity(storedVolume);
  }

  const lengthCm = decimalToNumber(sku.lengthCm);
  const widthCm = decimalToNumber(sku.widthCm);
  const heightCm = decimalToNumber(sku.heightCm);
  if (!lengthCm || !widthCm || !heightCm || lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) {
    return 0;
  }

  return roundQuantity((lengthCm * widthCm * heightCm) / 1000);
}

function listPeriodDays(periodFrom: Date, periodTo: Date) {
  const days: Date[] = [];
  const cursor = new Date(Date.UTC(periodFrom.getUTCFullYear(), periodFrom.getUTCMonth(), periodFrom.getUTCDate()));
  const end = Date.UTC(periodTo.getUTCFullYear(), periodTo.getUTCMonth(), periodTo.getUTCDate());

  while (cursor.getTime() <= end) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

function storageSourceKey(clientId: string, periodFrom: Date, periodTo: Date) {
  return `storage:${clientId}:${formatDateKey(periodFrom)}:${formatDateKey(periodTo)}`;
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function billingInvoiceStatusLabel(status: BillingInvoiceStatus) {
  const labels: Record<BillingInvoiceStatus, string> = {
    [BillingInvoiceStatus.DRAFT]: 'черновик',
    [BillingInvoiceStatus.ISSUED]: 'выставлен',
    [BillingInvoiceStatus.PAID]: 'оплачен',
    [BillingInvoiceStatus.CANCELLED]: 'отменен',
  };

  return labels[status];
}

function formatRub(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value);
}

function sourceCode(source: BillingChargeSource) {
  if (source === BillingChargeSource.STORAGE) {
    return 'STORAGE';
  }

  if (source === BillingChargeSource.LOGISTICS) {
    return 'LOGISTICS';
  }

  return 'MANUAL';
}
