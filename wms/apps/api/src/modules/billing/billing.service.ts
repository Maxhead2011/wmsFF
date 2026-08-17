import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingChargeSource,
  BillingChargeStatus,
  BillingInvoiceSource,
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
import { LogisticsService } from '../logistics/logistics.service';
import { MarketplaceConnectionsService } from '../marketplace-connections/marketplace-connections.service';
import { OwnCompaniesService } from '../own-companies/own-companies.service';
import { CreateBillingAdvanceDto } from './dto/create-billing-advance.dto';
import { CreateBillingChargeDto } from './dto/create-billing-charge.dto';
import { CreateBillingInvoiceDto } from './dto/create-billing-invoice.dto';
import { CreateBillingPaymentDto } from './dto/create-billing-payment.dto';
import { CreateIncomingPaymentDto } from './dto/create-incoming-payment.dto';
import { CreateBillingServiceDto } from './dto/create-billing-service.dto';
import { CreateManualBillingInvoiceDto } from './dto/create-manual-billing-invoice.dto';
import { GenerateStorageChargeDto } from './dto/generate-storage-charge.dto';
import { ListBillingChargesDto } from './dto/list-billing-charges.dto';
import { ListBillingInvoicesDto } from './dto/list-billing-invoices.dto';
import { ListBillingReconciliationDto } from './dto/list-billing-reconciliation.dto';
import { ListBillingServiceHistoryDto } from './dto/list-billing-service-history.dto';
import { MergeBillingInvoicesDto } from './dto/merge-billing-invoices.dto';
import { MergeFbsInvoicesDto } from './dto/merge-fbs-invoices.dto';
import { UpdateBillingChargeStatusDto } from './dto/update-billing-charge-status.dto';
import { UpdateBillingInvoiceStatusDto } from './dto/update-billing-invoice-status.dto';
import { UpdateClientFbsTurnkeyDto } from './dto/update-client-fbs-turnkey.dto';
import { UpdateFbsLogisticsTripDto } from './dto/update-fbs-logistics-trip.dto';
import { UpdateInvoicePaymentAccountDto } from './dto/update-invoice-payment-account.dto';
import { UpsertClientBillingServiceDto } from './dto/upsert-client-billing-service.dto';

type MergeInvoiceRow = {
  chargeId: string | null;
  description: string;
  unit: BillingUnit;
  quantity: Prisma.Decimal | number | string;
  unitPriceRub: Prisma.Decimal | number | string;
  totalRub: Prisma.Decimal | number | string;
  serviceDate: Date;
};

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly telegram?: TelegramNotificationService,
    private readonly logistics?: LogisticsService,
    private readonly marketplaceConnections?: MarketplaceConnectionsService,
    private readonly ownCompanies?: OwnCompaniesService,
  ) {}

  async listServices(user: AuthUser) {
    await this.ensureStandardBillingServices();
    await this.ensureNomenclatureBillingServices();
    return this.prisma.billingService.findMany({
      where: user.isDemo ? undefined : { code: { not: { startsWith: 'DEMO-' } } },
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
    await this.ensureNomenclatureBillingServices();
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { isDemo: true },
    });
    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }

    const services = await this.prisma.billingService.findMany({
      where: {
        isActive: true,
        code: client.isDemo ? undefined : { not: { startsWith: 'DEMO-' } },
      },
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
          status: isClientBillingUser(user)
            ? {
                notIn: [
                  BillingInvoiceStatus.CANCELLED,
                  BillingInvoiceStatus.DRAFT,
                ],
              }
            : { not: BillingInvoiceStatus.CANCELLED },
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

  async applyAdvance(id: string, user: AuthUser) {
    const advance = await this.prisma.billingPayment.findFirst({
      where: { id, invoiceId: null },
      include: billingAdvanceInclude,
    });
    if (!advance) {
      throw new NotFoundException('Авансовый платёж не найден.');
    }
    this.clientScopes.requireClientAccess(user, advance.clientId, 'write');
    if (advance.status !== BillingPaymentStatus.RECORDED) {
      throw new BadRequestException('Этот аванс уже погашен или отменён.');
    }

    const comment = [advance.comment, ADVANCE_REDEEMED_COMMENT].filter(Boolean).join('\n');
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.billingPayment.update({
        where: { id: advance.id },
        data: { status: BillingPaymentStatus.CANCELLED, comment },
        include: billingAdvanceInclude,
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'billing.advance.redeem',
          entity: 'billing-advance',
          entityId: advance.id,
          payload: {
            amountRub: decimalToNumber(advance.amountRub) ?? 0,
            invoicesTouched: false,
          },
        },
      });
      return result;
    });

    return { advance: updated, invoicesTouched: false };
  }

  async restoreAdvance(id: string, user: AuthUser) {
    const advance = await this.prisma.billingPayment.findFirst({
      where: { id, invoiceId: null },
      include: billingAdvanceInclude,
    });
    if (!advance) {
      throw new NotFoundException('Авансовый платёж не найден.');
    }
    this.clientScopes.requireClientAccess(user, advance.clientId, 'write');
    if (
      advance.status !== BillingPaymentStatus.CANCELLED ||
      !advance.comment?.includes(ADVANCE_REDEEMED_COMMENT)
    ) {
      throw new BadRequestException('Отменить можно только погашение аванса.');
    }

    const comment =
      advance.comment
        .split('\n')
        .filter((line) => line.trim() !== ADVANCE_REDEEMED_COMMENT)
        .join('\n') || null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.billingPayment.update({
        where: { id: advance.id },
        data: { status: BillingPaymentStatus.RECORDED, comment },
        include: billingAdvanceInclude,
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'billing.advance.redeem.undo',
          entity: 'billing-advance',
          entityId: advance.id,
          payload: {
            amountRub: decimalToNumber(advance.amountRub) ?? 0,
            invoicesTouched: false,
          },
        },
      });
      return result;
    });

    return { advance: updated, invoicesTouched: false };
  }

  private async applyAdvanceToInvoicesLegacy(id: string, user: AuthUser) {
    const advance = await this.prisma.billingPayment.findFirst({
      where: { id, invoiceId: null },
      select: {
        id: true,
        clientId: true,
        amountRub: true,
        paidAt: true,
        method: true,
        reference: true,
        comment: true,
        status: true,
      },
    });
    if (!advance) {
      throw new NotFoundException('Авансовый платеж не найден.');
    }
    this.clientScopes.requireClientAccess(user, advance.clientId, 'write');
    if (advance.status !== BillingPaymentStatus.RECORDED) {
      throw new BadRequestException('Этот аванс уже отменён или был зачтён в счета.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const invoices = await tx.billingInvoice.findMany({
        where: {
          clientId: advance.clientId,
          status: { in: [BillingInvoiceStatus.DRAFT, BillingInvoiceStatus.ISSUED] },
          NOT: [
            { comment: { startsWith: FBS_MERGED_SOURCE_COMMENT_PREFIX } },
            { comment: { startsWith: INVOICE_MERGED_SOURCE_COMMENT_PREFIX } },
          ],
        },
        select: {
          id: true,
          number: true,
          status: true,
          totalRub: true,
          paidRub: true,
          issuedAt: true,
          dueDate: true,
          periodFrom: true,
        },
        orderBy: [{ dueDate: 'asc' }, { periodFrom: 'asc' }, { createdAt: 'asc' }],
      });

      let remainingAdvanceRub = roundMoney(decimalToNumber(advance.amountRub) ?? 0);
      const appliedInvoices = [];
      for (const invoice of invoices) {
        if (remainingAdvanceRub <= 0.009) {
          break;
        }
        const invoiceRemainingRub = roundMoney(
          (decimalToNumber(invoice.totalRub) ?? 0) - (decimalToNumber(invoice.paidRub) ?? 0),
        );
        if (invoiceRemainingRub <= 0.009) {
          continue;
        }
        const amountRub = roundMoney(Math.min(remainingAdvanceRub, invoiceRemainingRub));
        const nextPaidRub = roundMoney((decimalToNumber(invoice.paidRub) ?? 0) + amountRub);
        const totalRub = decimalToNumber(invoice.totalRub) ?? 0;
        const nextStatus = nextPaidRub >= totalRub ? BillingInvoiceStatus.PAID : BillingInvoiceStatus.ISSUED;
        await tx.billingPayment.create({
          data: {
            invoiceId: invoice.id,
            clientId: advance.clientId,
            amountRub,
            paidAt: advance.paidAt,
            method: 'Зачёт аванса',
            reference: advance.reference,
            comment: `Зачтено из аванса ${advance.id}.`,
            createdByUserId: user.id,
          },
        });
        await tx.billingInvoice.update({
          where: { id: invoice.id },
          data: {
            paidRub: nextPaidRub,
            status: nextStatus,
            issuedAt: invoice.issuedAt ?? new Date(),
            paidAt: nextStatus === BillingInvoiceStatus.PAID ? advance.paidAt : null,
          },
        });
        appliedInvoices.push({ id: invoice.id, number: invoice.number, amountRub });
        remainingAdvanceRub = roundMoney(remainingAdvanceRub - amountRub);
      }

      if (appliedInvoices.length === 0) {
        throw new BadRequestException('Нет выставленных счетов, в которые можно зачесть этот аванс.');
      }

      const appliedComment = [
        advance.comment,
        `${ADVANCE_APPLIED_COMMENT_PREFIX} Зачтено ${formatRub(
          roundMoney((decimalToNumber(advance.amountRub) ?? 0) - remainingAdvanceRub),
        )} руб. в счета: ${appliedInvoices.map((invoice) => invoice.number).join(', ')}.`,
      ].filter(Boolean).join('\n');
      await tx.billingPayment.update({
        where: { id: advance.id },
        data: { status: BillingPaymentStatus.CANCELLED, comment: appliedComment },
      });

      if (remainingAdvanceRub > 0.009) {
        await tx.billingPayment.create({
          data: {
            invoiceId: null,
            clientId: advance.clientId,
            amountRub: remainingAdvanceRub,
            paidAt: advance.paidAt,
            method: advance.method,
            reference: advance.reference,
            comment: `Остаток после зачёта аванса ${advance.id}: ${advance.comment ?? ''}`.trim(),
            createdByUserId: user.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'billing.advance.apply',
          entity: 'billing-advance',
          entityId: advance.id,
          payload: {
            appliedInvoices,
            remainingAdvanceRub,
          },
        },
      });

      return { appliedInvoices, remainingAdvanceRub };
    });

    void this.telegram?.notifyClient(
      advance.clientId,
      [
        'LOGOFF WMS: аванс зачтён в счета.',
        `Зачтено: ${formatRub(result.appliedInvoices.reduce((sum, invoice) => sum + invoice.amountRub, 0))} руб.`,
        `Счета: ${result.appliedInvoices.map((invoice) => invoice.number).join(', ')}.`,
      ].join('\n'),
    );

    return result;
  }

  async getClientFbsTurnkey(clientId: string, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const clientExists = await this.prisma.client.count({ where: { id: clientId } });
    if (!clientExists) {
      throw new NotFoundException('Клиент не найден.');
    }
    const settings = await this.prisma.clientFbsBillingSettings.findUnique({
      where: { clientId },
      select: {
        turnkeyEnabled: true,
        turnkeyUnitPriceRub: true,
        fixedPlusLogisticsEnabled: true,
        fixedPlusLogisticsUnitPriceRub: true,
        fixedPlusLogisticsDestination: true,
        tieredLogisticsEnabled: true,
        logisticsFreeItemsLimit: true,
        logisticsCubicMeterLiters: true,
        logisticsCubicMeterPriceRub: true,
        logisticsPalletPriceRub: true,
        primaryProcessingEnabled: true,
        primaryWhiteUnitPriceRub: true,
        primaryGrayUnitPriceRub: true,
        primaryReturnUnitPriceRub: true,
        additionalServices: {
          select: {
            serviceId: true,
            quantityMultiplier: true,
            matchKeywords: true,
          },
        },
      },
    });
    return {
      clientId,
      enabled: settings?.turnkeyEnabled ?? false,
      unitPriceRub: Number(settings?.turnkeyUnitPriceRub ?? 0),
      fixedPlusLogisticsEnabled: settings?.fixedPlusLogisticsEnabled ?? false,
      fixedPlusLogisticsUnitPriceRub: Number(
        settings?.fixedPlusLogisticsUnitPriceRub ?? 0,
      ),
      fixedPlusLogisticsDestination:
        settings?.fixedPlusLogisticsDestination ?? 'Внуково',
      tieredLogisticsEnabled: settings?.tieredLogisticsEnabled ?? false,
      logisticsFreeItemsLimit: settings?.logisticsFreeItemsLimit ?? 20,
      logisticsCubicMeterLiters: settings?.logisticsCubicMeterLiters ?? 1000,
      logisticsCubicMeterPriceRub: Number(settings?.logisticsCubicMeterPriceRub ?? 1500),
      logisticsPalletPriceRub: Number(settings?.logisticsPalletPriceRub ?? 2500),
      primaryProcessingEnabled: settings?.primaryProcessingEnabled ?? false,
      primaryWhiteUnitPriceRub: Number(settings?.primaryWhiteUnitPriceRub ?? 0),
      primaryGrayUnitPriceRub: Number(settings?.primaryGrayUnitPriceRub ?? 0),
      primaryReturnUnitPriceRub: Number(settings?.primaryReturnUnitPriceRub ?? 0),
      primaryServices: (settings?.additionalServices ?? []).map((selection) => ({
        serviceId: selection.serviceId,
        quantityMultiplier: Number(selection.quantityMultiplier),
        matchKeywords: selection.matchKeywords ?? '',
      })),
    };
  }

  async updateClientFbsTurnkey(clientId: string, dto: UpdateClientFbsTurnkeyDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    const [client, currentSettings] = await Promise.all([
      this.prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.clientFbsBillingSettings.findUnique({
        where: { clientId },
        select: {
          primaryProcessingEnabled: true,
          primaryWhiteUnitPriceRub: true,
          primaryGrayUnitPriceRub: true,
          primaryReturnUnitPriceRub: true,
          tieredLogisticsEnabled: true,
          logisticsFreeItemsLimit: true,
          logisticsCubicMeterLiters: true,
          logisticsCubicMeterPriceRub: true,
          logisticsPalletPriceRub: true,
        },
      }),
    ]);
    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }
    if (dto.enabled && dto.fixedPlusLogisticsEnabled) {
      throw new BadRequestException(
        'Нельзя одновременно включить «FBS под ключ» и «Фикс + логистика».',
      );
    }
    if (dto.enabled && dto.tieredLogisticsEnabled) {
      throw new BadRequestException(
        'Ступенчатую логистику нельзя включить одновременно с тарифом «FBS под ключ»: в нём логистика уже включена.',
      );
    }
    if (dto.enabled && dto.unitPriceRub <= 0) {
      throw new BadRequestException(
        'Для тарифа «FBS под ключ» укажите фиксированную цену больше нуля.',
      );
    }
    if (
      dto.fixedPlusLogisticsEnabled &&
      dto.fixedPlusLogisticsUnitPriceRub <= 0
    ) {
      throw new BadRequestException(
        'Для тарифа «Фикс + логистика» укажите фиксированную цену обработки больше нуля.',
      );
    }
    const primaryProcessingEnabled =
      dto.primaryProcessingEnabled ??
      currentSettings?.primaryProcessingEnabled ??
      false;
    const primaryWhiteUnitPriceRub = Number(
      dto.primaryWhiteUnitPriceRub ??
        currentSettings?.primaryWhiteUnitPriceRub ??
        0,
    );
    const primaryGrayUnitPriceRub = Number(
      dto.primaryGrayUnitPriceRub ??
        currentSettings?.primaryGrayUnitPriceRub ??
        0,
    );
    const primaryReturnUnitPriceRub = Number(
      dto.primaryReturnUnitPriceRub ??
        currentSettings?.primaryReturnUnitPriceRub ??
        0,
    );
    if (
      primaryProcessingEnabled &&
      requiresDetailedPrimaryProcessingRates(client) &&
      (primaryWhiteUnitPriceRub <= 0 ||
        primaryGrayUnitPriceRub <= 0 ||
        primaryReturnUnitPriceRub <= 0)
    ) {
      throw new BadRequestException(
        'Для первичной обработки укажите три положительные цены: «в белую», «в серую» и «возврат».',
      );
    }
    const requestedDestination = dto.fixedPlusLogisticsDestination.trim();
    if (dto.fixedPlusLogisticsEnabled && !requestedDestination) {
      throw new BadRequestException(
        'Для тарифа «Фикс + логистика» выберите город доставки.',
      );
    }
    let fixedPlusLogisticsDestination = requestedDestination || 'Внуково';
    if (dto.fixedPlusLogisticsEnabled && this.logistics) {
      const { destinations } = await this.logistics.listFbsCalculatorDestinations();
      const normalizedDestination = normalizeFbsDestination(requestedDestination);
      const matchedDestination = destinations.find(
        (destination) =>
          normalizeFbsDestination(destination) === normalizedDestination,
      );
      if (!matchedDestination) {
        throw new BadRequestException(
          `Для города «${requestedDestination}» нет активного тарифа логистики WMS.`,
        );
      }
      fixedPlusLogisticsDestination = matchedDestination;
    }
    const tieredLogisticsEnabled =
      dto.tieredLogisticsEnabled ?? currentSettings?.tieredLogisticsEnabled ?? false;
    const logisticsFreeItemsLimit =
      dto.logisticsFreeItemsLimit ?? currentSettings?.logisticsFreeItemsLimit ?? 20;
    const logisticsCubicMeterLiters =
      dto.logisticsCubicMeterLiters ?? currentSettings?.logisticsCubicMeterLiters ?? 1000;
    const logisticsCubicMeterPriceRub = Number(
      dto.logisticsCubicMeterPriceRub ?? currentSettings?.logisticsCubicMeterPriceRub ?? 1500,
    );
    const logisticsPalletPriceRub = Number(
      dto.logisticsPalletPriceRub ?? currentSettings?.logisticsPalletPriceRub ?? 2500,
    );
    if (
      tieredLogisticsEnabled &&
      (logisticsCubicMeterLiters <= 0 ||
        logisticsCubicMeterPriceRub <= 0 ||
        logisticsPalletPriceRub <= 0)
    ) {
      throw new BadRequestException(
        'Для ступенчатой логистики укажите положительный объём куба и цены за куб и паллету.',
      );
    }
    const requestedPrimaryServices = dto.primaryServices;
    if (requestedPrimaryServices) {
      const serviceIds = requestedPrimaryServices.map((selection) => selection.serviceId);
      const available = serviceIds.length > 0
        ? await this.prisma.clientBillingService.findMany({
            where: {
              clientId,
              serviceId: { in: serviceIds },
              isActive: true,
              priceRub: { gt: 0 },
              service: { isActive: true, unit: BillingUnit.PIECE },
            },
            select: { serviceId: true },
          })
        : [];
      const availableIds = new Set(available.map((row) => row.serviceId));
      if (serviceIds.some((serviceId) => !availableIds.has(serviceId))) {
        throw new BadRequestException(
          'Для первичной обработки можно выбрать только активные штучные услуги с положительной ценой клиента.',
        );
      }
    }
    const settings = await this.prisma.clientFbsBillingSettings.upsert({
        where: { clientId },
        update: {
        turnkeyEnabled: dto.enabled,
        turnkeyUnitPriceRub: dto.unitPriceRub,
        fixedPlusLogisticsEnabled: dto.fixedPlusLogisticsEnabled,
        fixedPlusLogisticsUnitPriceRub: dto.fixedPlusLogisticsUnitPriceRub,
        fixedPlusLogisticsDestination,
        tieredLogisticsEnabled,
        logisticsFreeItemsLimit,
        logisticsCubicMeterLiters,
        logisticsCubicMeterPriceRub,
        logisticsPalletPriceRub,
        ...(dto.primaryProcessingEnabled === undefined
          ? {}
          : { primaryProcessingEnabled: dto.primaryProcessingEnabled }),
        ...(dto.primaryWhiteUnitPriceRub === undefined
          ? {}
          : { primaryWhiteUnitPriceRub: dto.primaryWhiteUnitPriceRub }),
        ...(dto.primaryGrayUnitPriceRub === undefined
          ? {}
          : { primaryGrayUnitPriceRub: dto.primaryGrayUnitPriceRub }),
        ...(dto.primaryReturnUnitPriceRub === undefined
          ? {}
          : { primaryReturnUnitPriceRub: dto.primaryReturnUnitPriceRub }),
      },
        create: {
        clientId,
        turnkeyEnabled: dto.enabled,
        turnkeyUnitPriceRub: dto.unitPriceRub,
        fixedPlusLogisticsEnabled: dto.fixedPlusLogisticsEnabled,
        fixedPlusLogisticsUnitPriceRub: dto.fixedPlusLogisticsUnitPriceRub,
        fixedPlusLogisticsDestination,
        tieredLogisticsEnabled,
        logisticsFreeItemsLimit,
        logisticsCubicMeterLiters,
        logisticsCubicMeterPriceRub,
        logisticsPalletPriceRub,
        primaryProcessingEnabled: dto.primaryProcessingEnabled ?? false,
        primaryWhiteUnitPriceRub: dto.primaryWhiteUnitPriceRub ?? 0,
        primaryGrayUnitPriceRub: dto.primaryGrayUnitPriceRub ?? 0,
        primaryReturnUnitPriceRub: dto.primaryReturnUnitPriceRub ?? 0,
      },
        select: {
          id: true,
        turnkeyEnabled: true,
        turnkeyUnitPriceRub: true,
        fixedPlusLogisticsEnabled: true,
        fixedPlusLogisticsUnitPriceRub: true,
        fixedPlusLogisticsDestination: true,
        tieredLogisticsEnabled: true,
        logisticsFreeItemsLimit: true,
        logisticsCubicMeterLiters: true,
        logisticsCubicMeterPriceRub: true,
        logisticsPalletPriceRub: true,
        primaryProcessingEnabled: true,
        primaryWhiteUnitPriceRub: true,
        primaryGrayUnitPriceRub: true,
        primaryReturnUnitPriceRub: true,
        },
    });
    if (requestedPrimaryServices) {
      await this.prisma.clientFbsAdditionalService.deleteMany({ where: { settingsId: settings.id } });
      if (requestedPrimaryServices.length > 0) {
        await this.prisma.clientFbsAdditionalService.createMany({
            data: requestedPrimaryServices.map((selection) => ({
              settingsId: settings.id,
              serviceId: selection.serviceId,
              quantityMultiplier: selection.quantityMultiplier,
              matchKeywords: selection.matchKeywords?.trim() || null,
            })),
        });
      }
    }
    const marketplaceWithPrimaryProcessing = this.marketplaceConnections as
      | (MarketplaceConnectionsService & {
          cancelFbsPrimaryDraftBilling?: (clientId: string) => Promise<unknown>;
        })
      | undefined;
    if (
      dto.primaryProcessingEnabled === false &&
      marketplaceWithPrimaryProcessing?.cancelFbsPrimaryDraftBilling
    ) {
      await marketplaceWithPrimaryProcessing.cancelFbsPrimaryDraftBilling(clientId);
    }
    const recalculation = this.marketplaceConnections
      ? await this.marketplaceConnections.recalculateFbsDraftBilling(clientId)
      : { recalculatedCharges: 0, recalculatedInvoices: 0 };
    return {
      clientId,
      enabled: settings.turnkeyEnabled,
      unitPriceRub: Number(settings.turnkeyUnitPriceRub),
      fixedPlusLogisticsEnabled: settings.fixedPlusLogisticsEnabled,
      fixedPlusLogisticsUnitPriceRub: Number(
        settings.fixedPlusLogisticsUnitPriceRub,
      ),
      fixedPlusLogisticsDestination:
        settings.fixedPlusLogisticsDestination,
      tieredLogisticsEnabled: settings.tieredLogisticsEnabled,
      logisticsFreeItemsLimit: settings.logisticsFreeItemsLimit,
      logisticsCubicMeterLiters: settings.logisticsCubicMeterLiters,
      logisticsCubicMeterPriceRub: Number(settings.logisticsCubicMeterPriceRub),
      logisticsPalletPriceRub: Number(settings.logisticsPalletPriceRub),
      primaryProcessingEnabled: settings.primaryProcessingEnabled,
      primaryWhiteUnitPriceRub: Number(settings.primaryWhiteUnitPriceRub),
      primaryGrayUnitPriceRub: Number(settings.primaryGrayUnitPriceRub),
      primaryReturnUnitPriceRub: Number(settings.primaryReturnUnitPriceRub),
      primaryServices: (requestedPrimaryServices ?? []).map((selection) => ({
        ...selection,
        matchKeywords: selection.matchKeywords?.trim() ?? '',
      })),
      recalculation,
      updatedByUserId: user.id,
    };
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

  async updateFbsLogisticsTrip(
    chargeId: string,
    dto: UpdateFbsLogisticsTripDto,
    user: AuthUser,
  ) {
    const charge = await this.prisma.billingCharge.findUnique({
      where: { id: chargeId },
      include: {
        invoiceItems: {
          where: { invoice: { status: { not: BillingInvoiceStatus.CANCELLED } } },
          select: {
            id: true,
            invoice: { select: { id: true, number: true, status: true } },
          },
        },
      },
    });
    if (!charge) {
      throw new NotFoundException('Начисление биллинга не найдено.');
    }
    this.clientScopes.requireClientAccess(user, charge.clientId, 'write');
    if (charge.status !== BillingChargeStatus.DRAFT) {
      throw new BadRequestException('Изменить количество выездов можно только в черновом начислении.');
    }
    const lockedInvoice = charge.invoiceItems.find(
      (item) => item.invoice.status !== BillingInvoiceStatus.DRAFT,
    );
    if (lockedInvoice) {
      throw new BadRequestException(
        `Счёт №${lockedInvoice.invoice.number} уже не является черновиком. Выезд изменить нельзя.`,
      );
    }

    const metadata = asRecord(charge.metadata);
    const logisticsTrip = asRecord(metadata?.logisticsTrip);
    if (metadata?.kind !== 'FBS' || !logisticsTrip) {
      throw new BadRequestException('Настройка выезда доступна только для автоматического начисления FBS.');
    }
    if (logisticsTrip.automaticPrimary === true && !dto.extraTrip) {
      throw new BadRequestException('Это основной выезд клиента за день, его нельзя убрать из расчёта.');
    }
    const totalWithoutLogisticsRub = finiteMetadataNumber(
      logisticsTrip.totalWithoutLogisticsRub,
      'В начислении нет суммы без логистики. Обновите FBS и повторите.',
    );
    const totalWithLogisticsRub = finiteMetadataNumber(
      logisticsTrip.totalWithLogisticsRub,
      'В начислении нет суммы с логистикой. Обновите FBS и повторите.',
    );
    const automaticPrimary = logisticsTrip.automaticPrimary === true;
    const charged = automaticPrimary || dto.extraTrip;
    const totalRub = charged ? totalWithLogisticsRub : totalWithoutLogisticsRub;
    const quantity = Math.max(1, Number(charge.quantity) || 1);
    const unitPriceRub = roundMoney(totalRub / quantity);
    const nextMetadata = {
      ...metadata,
      logisticsTrip: {
        ...logisticsTrip,
        extraTripOverride: dto.extraTrip,
        charged,
        changedManuallyAt: new Date().toISOString(),
        changedManuallyByUserId: user.id,
      },
    } as Prisma.InputJsonValue;
    const invoiceIds = [...new Set(
      charge.invoiceItems.map((item) => item.invoice.id).filter(Boolean),
    )];

    return this.prisma.$transaction(async (tx) => {
      await tx.billingCharge.update({
        where: { id: chargeId },
        data: {
          unitPriceRub,
          totalRub,
          metadata: nextMetadata,
          comment: dto.extraTrip
            ? 'В биллинге явно указан отдельный выезд FBS.'
            : 'Логистика объединена с основным выездом клиента за этот день.',
        },
      });
      if (invoiceIds.length > 0) {
        await tx.billingInvoiceItem.updateMany({
          where: { chargeId, invoiceId: { in: invoiceIds } },
          data: { unitPriceRub, totalRub },
        });
        for (const invoiceId of invoiceIds) {
          const items = await tx.billingInvoiceItem.findMany({
            where: { invoiceId },
            select: { totalRub: true },
          });
          await tx.billingInvoice.update({
            where: { id: invoiceId },
            data: {
              totalRub: roundMoney(
                items.reduce((sum, item) => sum + Number(item.totalRub), 0),
              ),
            },
          });
        }
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: dto.extraTrip
            ? 'FBS_LOGISTICS_EXTRA_TRIP_ENABLED'
            : 'FBS_LOGISTICS_EXTRA_TRIP_DISABLED',
          entity: 'BillingCharge',
          entityId: chargeId,
          payload: {
            clientId: charge.clientId,
            billingDay: logisticsTrip.billingDay ?? null,
            groupKey: logisticsTrip.groupKey ?? null,
            totalRub,
            invoiceIds,
          },
        },
      });
      return tx.billingCharge.findUniqueOrThrow({
        where: { id: chargeId },
        include: billingChargeInclude,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
    const hideDraftInvoices = isClientBillingUser(user);
    if (
      hideDraftInvoices &&
      query.status === BillingInvoiceStatus.DRAFT
    ) {
      return Promise.resolve([]);
    }
    const where: Prisma.BillingInvoiceWhereInput = {
      clientId: this.clientScopes.resolveClientFilter(user, query.clientId),
      ...billingInvoiceWarehouseWhere(user),
      client: isBillingAdministrator(user) ? { isDemo: false } : undefined,
      status:
        query.status ??
        (hideDraftInvoices
          ? { not: BillingInvoiceStatus.DRAFT }
          : undefined),
      NOT: query.status
        ? undefined
        : [
            {
              status: BillingInvoiceStatus.CANCELLED,
              comment: { startsWith: FBS_MERGED_SOURCE_COMMENT_PREFIX },
            },
            {
              status: BillingInvoiceStatus.CANCELLED,
              comment: { startsWith: INVOICE_MERGED_SOURCE_COMMENT_PREFIX },
            },
          ],
      periodFrom: query.periodFrom ? { gte: parseDate(query.periodFrom) } : undefined,
      periodTo: query.periodTo ? { lte: parseDate(query.periodTo, 'endOfDay') } : undefined,
    };

    return this.prisma.billingInvoice.findMany({
      where,
      include: billingInvoiceInclude,
      orderBy: [{ periodFrom: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async listClientPaymentAccounts(clientId: string, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    if (!this.ownCompanies) {
      return { company: null, bankAccounts: [] };
    }
    return this.ownCompanies.listPaymentAccountsForClient(clientId, user.activeWarehouseId);
  }

  async updateInvoicePaymentAccount(
    invoiceId: string,
    dto: UpdateInvoicePaymentAccountDto,
    user: AuthUser,
  ) {
    const invoice = await this.prisma.billingInvoice.findUnique({
      where: { id: invoiceId },
      include: billingInvoiceInclude,
    });
    if (!invoice) {
      throw new NotFoundException('Счёт не найден.');
    }
    this.clientScopes.requireClientAccess(user, invoice.clientId, 'write');
    if (invoice.status === BillingInvoiceStatus.PAID || invoice.payments.length > 0) {
      throw new BadRequestException('Нельзя менять расчётный счёт после регистрации оплаты.');
    }
    const paymentAccount = await this.paymentAccountSnapshot(
      invoice.clientId,
      dto.paymentBankAccountId,
      user.activeWarehouseId,
    );
    const updated = await this.prisma.billingInvoice.update({
      where: { id: invoice.id },
      data: paymentAccount,
      include: billingInvoiceInclude,
    });
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'billing.invoice.payment-account.update',
        entity: 'billing-invoice',
        entityId: invoice.id,
        payload: {
          paymentBankAccountId: updated.paymentBankAccountId,
          paymentBankAccount: updated.paymentBankAccount,
          paymentBankName: updated.paymentBankName,
        },
      },
    });
    return updated;
  }

  async listInvoicesForCombinedPdf(query: ListBillingInvoicesDto, user: AuthUser) {
    const resolvedClientFilter = this.clientScopes.resolveClientFilter(user, query.clientId);
    const clientId =
      typeof resolvedClientFilter === 'string'
        ? resolvedClientFilter
        : resolvedClientFilter && 'in' in resolvedClientFilter && resolvedClientFilter.in.length === 1
          ? resolvedClientFilter.in[0]
          : undefined;

    if (!clientId) {
      throw new BadRequestException('Выберите одного клиента, счета которого нужно объединить.');
    }

    const client = await this.prisma.client.findFirst({
      where: {
        id: clientId,
        isDemo: isBillingAdministrator(user) ? false : undefined,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });
    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }

    const invoices = await this.prisma.billingInvoice.findMany({
      where: {
        clientId,
        status:
          isClientBillingUser(user) &&
          query.status === BillingInvoiceStatus.DRAFT
            ? { in: [] }
            : query.status ??
              (isClientBillingUser(user)
                ? { not: BillingInvoiceStatus.DRAFT }
                : undefined),
        NOT: [
          {
            status: BillingInvoiceStatus.CANCELLED,
            comment: { startsWith: FBS_MERGED_SOURCE_COMMENT_PREFIX },
          },
          {
            status: BillingInvoiceStatus.CANCELLED,
            comment: { startsWith: INVOICE_MERGED_SOURCE_COMMENT_PREFIX },
          },
        ],
        periodFrom: query.periodFrom ? { gte: parseDate(query.periodFrom) } : undefined,
        periodTo: query.periodTo ? { lte: parseDate(query.periodTo, 'endOfDay') } : undefined,
      },
      select: {
        id: true,
        totalRub: true,
        paidRub: true,
      },
      orderBy: [{ periodFrom: 'desc' }, { createdAt: 'desc' }],
    });

    const selectedInvoices = query.unpaidOnly
      ? invoices.filter((invoice) => Number(invoice.totalRub) - Number(invoice.paidRub) > 0.005)
      : invoices;

    if (selectedInvoices.length === 0) {
      throw new BadRequestException('У выбранного клиента нет счетов для формирования общего PDF.');
    }

    return {
      client,
      invoiceIds: selectedInvoices.map((invoice) => invoice.id),
    };
  }

  async recheckInvoice(invoiceId: string, user: AuthUser) {
    const invoice = await this.prisma.billingInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: {
          select: {
            id: true,
            code: true,
            name: true,
            fbsBillingSettings: {
              select: {
                primaryProcessingEnabled: true,
                primaryWhiteUnitPriceRub: true,
                primaryGrayUnitPriceRub: true,
                primaryReturnUnitPriceRub: true,
              },
            },
          },
        },
        items: {
          include: {
            charge: {
              select: {
                id: true,
                status: true,
                sourceKey: true,
                metadata: true,
                totalRub: true,
                quantity: true,
                unitPriceRub: true,
                service: {
                  select: { id: true, code: true, name: true },
                },
              },
            },
          },
          orderBy: [{ serviceDate: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Счет биллинга не найден.');
    }
    this.clientScopes.requireClientAccess(user, invoice.clientId, 'read');

    const checks: InvoiceRecheckCheck[] = [];
    const addCheck = (
      code: string,
      label: string,
      status: InvoiceRecheckStatus,
      message: string,
    ) => checks.push({ code, label, status, message });
    const invoiceTotalRub = decimalToNumber(invoice.totalRub) ?? 0;
    const calculatedTotalRub = roundMoney(
      invoice.items.reduce(
        (sum, item) => sum + (decimalToNumber(item.totalRub) ?? 0),
        0,
      ),
    );
    addCheck(
      'TOTAL_MATCH',
      'Сумма счета',
      Math.abs(invoiceTotalRub - calculatedTotalRub) < 0.01 ? 'OK' : 'ERROR',
      Math.abs(invoiceTotalRub - calculatedTotalRub) < 0.01
        ? `Итог ${formatRub(invoiceTotalRub)} ₽ совпадает с суммой строк.`
        : `В счете ${formatRub(invoiceTotalRub)} ₽, по строкам ${formatRub(calculatedTotalRub)} ₽.`,
    );

    const serviceRows = invoice.items.filter(
      (item) => !item.description.startsWith(FBS_ORDER_DETAIL_PREFIX),
    );
    const zeroCostRows = serviceRows.filter(
      (item) =>
        (decimalToNumber(item.unitPriceRub) ?? 0) <= 0 ||
        (decimalToNumber(item.totalRub) ?? 0) <= 0,
    );
    addCheck(
      'ZERO_COST_ROWS',
      'Нулевые услуги',
      zeroCostRows.length === 0 ? 'OK' : 'WARNING',
      zeroCostRows.length === 0
        ? 'Услуг с нулевой ценой или суммой нет.'
        : `Найдено строк с нулевой ценой или суммой: ${zeroCostRows.length}.`,
    );

    const cancelledChargeRows = serviceRows.filter(
      (item) => item.charge?.status === BillingChargeStatus.CANCELLED,
    );
    addCheck(
      'CANCELLED_CHARGES',
      'Связанные начисления',
      cancelledChargeRows.length === 0 ? 'OK' : 'ERROR',
      cancelledChargeRows.length === 0
        ? 'Отмененных начислений в составе счета нет.'
        : `В состав попало отмененных начислений: ${cancelledChargeRows.length}.`,
    );

    const duplicateChargeIds = duplicateValues(
      serviceRows
        .map((item) => item.chargeId)
        .filter((value): value is string => Boolean(value)),
    );
    addCheck(
      'DUPLICATE_CHARGES',
      'Дубли начислений',
      duplicateChargeIds.length === 0 ? 'OK' : 'ERROR',
      duplicateChargeIds.length === 0
        ? 'Одно начисление не повторяется в нескольких строках.'
        : `Повторно использованных начислений: ${duplicateChargeIds.length}.`,
    );

    const unbilledCharges = await this.prisma.billingCharge.findMany({
      where: {
        clientId: invoice.clientId,
        status: { in: [BillingChargeStatus.DRAFT, BillingChargeStatus.APPROVED] },
        totalRub: { gt: 0 },
        serviceDate: { gte: invoice.periodFrom, lte: invoice.periodTo },
        invoiceItems: {
          none: {
            invoice: { status: { not: BillingInvoiceStatus.CANCELLED } },
          },
        },
      },
      select: {
        id: true,
        description: true,
        quantity: true,
        unitPriceRub: true,
        totalRub: true,
        service: { select: { code: true, name: true } },
      },
      orderBy: [{ serviceDate: 'asc' }, { description: 'asc' }],
      take: 200,
    });
    addCheck(
      'UNBILLED_CHARGES',
      'Начисления за период',
      unbilledCharges.length === 0 ? 'OK' : 'WARNING',
      unbilledCharges.length === 0
        ? 'Все готовые начисления за период уже привязаны к счетам.'
        : `За период найдено начислений вне счетов: ${unbilledCharges.length}.`,
    );

    const fbsOrderRows = invoice.items.filter((item) =>
      item.description.startsWith(FBS_ORDER_DETAIL_PREFIX),
    );
    const fbsOrderItemCount = fbsOrderRows.reduce(
      (sum, item) => sum + Math.max(0, decimalToNumber(item.quantity) ?? 0),
      0,
    );
    const fbsProcessingRows = serviceRows.filter((item) => {
      const metadata = asRecord(item.charge?.metadata);
      return (
        metadata?.kind === 'FBS' ||
        item.description === 'Обработка заказов по FBS' ||
        item.charge?.sourceKey?.startsWith('fbs-calculator:')
      );
    });
    const isFbsInvoice =
      Boolean(invoice.sourceKey?.includes('fbs-')) ||
      fbsOrderRows.length > 0 ||
      fbsProcessingRows.length > 0;
    let fbsPrimaryRows = 0;
    let fbsPrimaryQuantity = 0;
    let fbsLogisticsRows = 0;
    let canAddPrimaryProcessing = false;
    let addPrimaryProcessingReason: string | null = null;

    if (isFbsInvoice) {
      const fbsProcessingQuantity = fbsProcessingRows.reduce(
        (sum, item) => sum + Math.max(0, decimalToNumber(item.quantity) ?? 0),
        0,
      );
      addCheck(
        'FBS_PROCESSING',
        'Обработка FBS',
        fbsProcessingRows.length > 0 ? 'OK' : 'ERROR',
        fbsProcessingRows.length > 0
          ? `Начислено строк: ${fbsProcessingRows.length}, товаров: ${formatQuantity(fbsProcessingQuantity)}.`
          : 'Не найдено начисление обработки заказов FBS.',
      );
      if (fbsOrderRows.length > 0) {
        addCheck(
          'FBS_ORDER_DETAILS',
          'Заказы FBS',
          fbsOrderItemCount === fbsProcessingQuantity ? 'OK' : 'ERROR',
          fbsOrderItemCount === fbsProcessingQuantity
            ? `Перечислено заказов: ${fbsOrderRows.length}, товаров: ${formatQuantity(fbsOrderItemCount)}.`
            : `В заказах ${formatQuantity(fbsOrderItemCount)} товаров, в обработке FBS ${formatQuantity(fbsProcessingQuantity)}.`,
        );
      } else {
        addCheck(
          'FBS_ORDER_DETAILS',
          'Заказы FBS',
          'WARNING',
          'В счете нет строк с номерами заказов FBS.',
        );
      }

      const primarySettings = invoice.client.fbsBillingSettings;
      const primaryRates = primarySettings
        ? [
            decimalToNumber(primarySettings.primaryWhiteUnitPriceRub) ?? 0,
            decimalToNumber(primarySettings.primaryGrayUnitPriceRub) ?? 0,
            decimalToNumber(primarySettings.primaryReturnUnitPriceRub) ?? 0,
          ]
        : [0, 0, 0];
      const primaryRateConfigured = primaryRates.every((value) => value > 0);
      const mainPrimaryRows = serviceRows.filter((item) => {
        const metadata = asRecord(item.charge?.metadata);
        const processingType = textMetadataValue(metadata?.processingType);
        return (
          item.description.startsWith('Первичная обработка —') ||
          item.description.startsWith('Первичная обработка FBS —') ||
          (metadata?.kind === 'FBS_PRIMARY_PROCESSING' &&
            ['WHITE', 'GRAY', 'RETURN'].includes(processingType ?? ''))
        );
      });
      fbsPrimaryRows = mainPrimaryRows.length;
      fbsPrimaryQuantity = mainPrimaryRows.reduce(
        (sum, item) => sum + Math.max(0, decimalToNumber(item.quantity) ?? 0),
        0,
      );
      if (primarySettings?.primaryProcessingEnabled) {
        addCheck(
          'FBS_PRIMARY_RATES',
          'Тарифы первичной обработки',
          primaryRateConfigured ? 'OK' : 'ERROR',
          primaryRateConfigured
            ? `Настроены тарифы: в белую ${formatRub(primaryRates[0])} ₽, в серую ${formatRub(primaryRates[1])} ₽, возврат ${formatRub(primaryRates[2])} ₽.`
            : 'Первичная обработка включена, но не заполнены все три цены: в белую, в серую и возврат.',
        );
        addCheck(
          'FBS_PRIMARY_PROCESSING',
          'Первичная обработка',
          mainPrimaryRows.length > 0 &&
            (fbsOrderItemCount === 0 || fbsPrimaryQuantity === fbsOrderItemCount)
            ? 'OK'
            : 'ERROR',
          mainPrimaryRows.length === 0
            ? 'В счете нет строк первичной обработки.'
            : fbsOrderItemCount > 0 && fbsPrimaryQuantity !== fbsOrderItemCount
              ? `Первичная обработка выставлена на ${formatQuantity(fbsPrimaryQuantity)} из ${formatQuantity(fbsOrderItemCount)} товаров.`
              : `Первичная обработка выставлена на ${formatQuantity(fbsPrimaryQuantity)} товаров.`,
        );
        const primaryProcessingMissing =
          mainPrimaryRows.length === 0 ||
          (fbsOrderItemCount > 0 && fbsPrimaryQuantity !== fbsOrderItemCount);
        const supportedInvoice = isMergedFbsInvoiceSourceKey(
          invoice.sourceKey,
          invoice.clientId,
        );
        canAddPrimaryProcessing =
          primaryProcessingMissing &&
          primaryRateConfigured &&
          invoice.status === BillingInvoiceStatus.DRAFT &&
          supportedInvoice;
        if (primaryProcessingMissing && !canAddPrimaryProcessing) {
          addPrimaryProcessingReason = !primaryRateConfigured
            ? 'Сначала заполните все три тарифа первичной обработки.'
            : invoice.status !== BillingInvoiceStatus.DRAFT
              ? 'Добавление доступно только для черновика счета.'
              : 'Автоматическое добавление доступно в объединенном счете по заказам FBS.';
        }
      } else {
        addCheck(
          'FBS_PRIMARY_PROCESSING',
          'Первичная обработка',
          'OK',
          'Для клиента автоматическая первичная обработка отключена.',
        );
      }

      fbsLogisticsRows = serviceRows.filter((item) => {
        const metadata = asRecord(item.charge?.metadata);
        return (
          metadata?.kind === FBS_DAILY_LOGISTICS_METADATA_KIND ||
          item.description.startsWith('Логистика FBS')
        );
      }).length;
      addCheck(
        'FBS_LOGISTICS',
        'Логистика FBS',
        fbsLogisticsRows > 0 ? 'OK' : 'WARNING',
        fbsLogisticsRows > 0
          ? `В счете строк логистики: ${fbsLogisticsRows}.`
          : 'Логистика FBS в счете не найдена; проверьте, был ли выезд.',
      );
    }

    const status: InvoiceRecheckStatus = checks.some((check) => check.status === 'ERROR')
      ? 'ERROR'
      : checks.some((check) => check.status === 'WARNING')
        ? 'WARNING'
        : 'OK';

    return {
      invoiceId: invoice.id,
      number: invoice.number,
      checkedAt: new Date().toISOString(),
      status,
      kind: isFbsInvoice ? 'FBS' : 'STANDARD',
      summary: {
        invoiceItems: invoice.items.length,
        serviceRows: serviceRows.length,
        zeroCostRows: zeroCostRows.length,
        invoiceTotalRub,
        calculatedTotalRub,
        unbilledCharges: unbilledCharges.length,
        fbsOrders: fbsOrderRows.length,
        fbsItems: fbsOrderItemCount,
        fbsPrimaryRows,
        fbsPrimaryQuantity,
        fbsLogisticsRows,
      },
      checks,
      actions: {
        addPrimaryProcessing: {
          available: canAddPrimaryProcessing,
          reason: addPrimaryProcessingReason,
        },
      },
      unbilledServices: unbilledCharges.map((charge) => ({
        chargeId: charge.id,
        serviceCode: charge.service?.code ?? null,
        name: charge.service?.name ?? charge.description,
        description: charge.description,
        quantity: decimalToNumber(charge.quantity) ?? 0,
        unitPriceRub: decimalToNumber(charge.unitPriceRub) ?? 0,
        totalRub: decimalToNumber(charge.totalRub) ?? 0,
      })),
    };
  }

  async addInvoicePrimaryProcessing(invoiceId: string, user: AuthUser) {
    const invoice = await this.prisma.billingInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        clientId: true,
        status: true,
        sourceKey: true,
      },
    });
    if (!invoice) {
      throw new NotFoundException('Счет биллинга не найден.');
    }
    this.clientScopes.requireClientAccess(user, invoice.clientId, 'write');
    if (invoice.status !== BillingInvoiceStatus.DRAFT) {
      throw new BadRequestException(
        'Первичную обработку можно автоматически добавить только в черновик счета.',
      );
    }
    const supportedInvoice = isMergedFbsInvoiceSourceKey(
      invoice.sourceKey,
      invoice.clientId,
    );
    if (!supportedInvoice) {
      throw new BadRequestException(
        'Автоматическое добавление доступно в объединенном счете по заказам FBS.',
      );
    }
    if (!this.marketplaceConnections) {
      throw new BadRequestException('Модуль расчета заказов временно недоступен.');
    }

    const settings = await this.prisma.clientFbsBillingSettings.findUnique({
      where: { clientId: invoice.clientId },
      select: {
        primaryProcessingEnabled: true,
        primaryWhiteUnitPriceRub: true,
        primaryGrayUnitPriceRub: true,
        primaryReturnUnitPriceRub: true,
      },
    });
    if (!settings?.primaryProcessingEnabled) {
      throw new BadRequestException(
        'Для клиента не включена автоматическая первичная обработка.',
      );
    }
    const rates = [
      decimalToNumber(settings.primaryWhiteUnitPriceRub) ?? 0,
      decimalToNumber(settings.primaryGrayUnitPriceRub) ?? 0,
      decimalToNumber(settings.primaryReturnUnitPriceRub) ?? 0,
    ];
    if (rates.some((value) => value <= 0)) {
      throw new BadRequestException(
        'Сначала заполните все три тарифа первичной обработки: в белую, в серую и возврат.',
      );
    }

    await this.marketplaceConnections.recalculateFbsDraftBilling(invoice.clientId);
    const preview = await this.getFbsMergePreview(invoice.clientId, user);
    if (
      !preview.primaryProcessing.available ||
      preview.primaryProcessing.totalRub <= 0
    ) {
      throw new BadRequestException(
        'Не удалось рассчитать строки первичной обработки. Перепроверьте состав заказов и типы поставки.',
      );
    }

    return this.mergeFbsInvoices(
      {
        clientId: invoice.clientId,
        includePrimaryProcessing: true,
        logisticsDays: preview.logisticsDays.map((day) => ({
          date: day.date,
          amountRub: day.currentAmountRub ?? day.suggestedAmountRub,
        })),
      },
      user,
    );
  }

  async getFbsMergePreview(clientId: string, user: AuthUser, invoiceIds?: string[]) {
    const selection = await this.loadFbsMergeSelection(clientId, user, invoiceIds);
    return selection.preview;
  }

  async mergeFbsInvoices(dto: MergeFbsInvoicesDto, user: AuthUser) {
    const selection = await this.loadFbsMergeSelection(dto.clientId, user, dto.invoiceIds);
    const includePrimaryProcessing =
      dto.includePrimaryProcessing === true ||
      selection.preview.primaryProcessing.included;
    const providedDays = new Map<string, number>();
    for (const row of dto.logisticsDays ?? []) {
      const date = dateKey(parseDate(row.date));
      if (providedDays.has(date)) {
        throw new BadRequestException(`Стоимость логистики за ${date} указана несколько раз.`);
      }
      providedDays.set(date, roundMoney(row.amountRub));
    }
    const availableDays = new Set(selection.preview.logisticsDays.map((row) => row.date));
    const unexpectedDay = [...providedDays.keys()].find((date) => !availableDays.has(date));
    if (unexpectedDay) {
      throw new BadRequestException(
        `Дата ${unexpectedDay} не относится к объединяемым FBS-поставкам.`,
      );
    }

    const primaryInvoices = includePrimaryProcessing
      ? selection.primaryInvoices
      : [];
    const selectedInvoices = [...selection.invoices, ...primaryInvoices];
    const sourceInvoices = [
      ...selection.invoices.filter(
        (invoice) => !isMergedFbsInvoiceSourceKey(invoice.sourceKey, dto.clientId),
      ),
      ...primaryInvoices,
    ];
    const periodDates = selectedInvoices.flatMap((invoice) => [
      invoice.periodFrom,
      invoice.periodTo,
    ]);
    const periodFrom = minDateValue(periodDates);
    const periodTo = maxDateValue(periodDates);
    const number =
      selection.target?.number ?? (await this.nextInvoiceNumber(periodFrom));
    const mergedSourceKey =
      selection.target?.sourceKey ?? fbsMergedInvoiceSourceKey(dto.clientId, number);
    const sourceNumbers = sourceInvoices.map((invoice) => invoice.number);
    const mergedComment = includePrimaryProcessing
      ? 'Объединенный черновик FBS. Включена первичная обработка товара без коробов и паллет. Логистика рассчитана отдельным выездом по каждому дню.'
      : 'Объединенный черновик FBS. Логистика рассчитана отдельным выездом по каждому дню.';

    return this.prisma.$transaction(async (tx) => {
      const dailyLogisticsService = await tx.billingService.upsert({
        where: { code: FBS_DAILY_LOGISTICS_SERVICE_CODE },
        update: {
          name: 'Логистика FBS — один выезд за день',
          unit: BillingUnit.SERVICE,
          isActive: true,
        },
        create: {
          code: FBS_DAILY_LOGISTICS_SERVICE_CODE,
          name: 'Логистика FBS — один выезд за день',
          unit: BillingUnit.SERVICE,
          defaultPriceRub: 0,
          isActive: true,
        },
      });

      const itemRows = new Map<string, MergeInvoiceRow>();
      for (const invoice of selectedInvoices) {
        for (const item of invoice.items) {
          const charge = item.charge;
          if (!charge) {
            if (item.description.startsWith(FBS_ORDER_DETAIL_PREFIX)) {
              continue;
            }
            itemRows.set(`item:${item.id}`, {
              chargeId: null,
              description: item.description,
              unit: item.unit,
              quantity: item.quantity,
              unitPriceRub: item.unitPriceRub,
              totalRub: item.totalRub,
              serviceDate: item.serviceDate,
            });
            continue;
          }
          const metadata = asRecord(charge.metadata);
          if (metadata?.kind === FBS_DAILY_LOGISTICS_METADATA_KIND) {
            continue;
          }

          let totalRub = decimalToNumber(charge.totalRub) ?? 0;
          let unitPriceRub = decimalToNumber(charge.unitPriceRub) ?? 0;
          if (metadata?.kind === 'FBS') {
            const logisticsTrip = asRecord(metadata.logisticsTrip);
            const processingTotalRub = optionalMetadataNumber(
              logisticsTrip?.totalWithoutLogisticsRub,
            );
            if (processingTotalRub !== undefined) {
              totalRub = roundMoney(processingTotalRub);
              const quantity = Math.max(
                0.001,
                decimalToNumber(charge.quantity) ?? 1,
              );
              unitPriceRub = roundMoney(totalRub / quantity);
              await tx.billingCharge.update({
                where: { id: charge.id },
                data: {
                  unitPriceRub,
                  totalRub,
                  metadata: {
                    ...metadata,
                    logisticsTrip: {
                      ...(logisticsTrip ?? {}),
                      charged: false,
                      manualDailyPricing: true,
                      mergedInvoiceSourceKey: mergedSourceKey,
                    },
                  } as Prisma.InputJsonValue,
                },
              });
            }
          }
          itemRows.set(`charge:${charge.id}`, {
            chargeId: charge.id,
            description: charge.description,
            unit: charge.unit,
            quantity: charge.quantity,
            unitPriceRub,
            totalRub,
            serviceDate: charge.serviceDate,
          });
        }
      }

      for (const order of selection.preview.orders) {
        itemRows.set(`fbs-order:${order.orderId}`, {
          chargeId: null,
          description: `${FBS_ORDER_DETAIL_PREFIX}${order.orderId}`,
          unit: BillingUnit.PIECE,
          quantity: order.itemCount,
          unitPriceRub: 0,
          totalRub: 0,
          serviceDate: parseDate(order.date),
        });
      }

      for (const day of selection.preview.logisticsDays) {
        const amountRub = providedDays.has(day.date)
          ? providedDays.get(day.date)!
          : roundMoney(day.currentAmountRub ?? day.suggestedAmountRub);
        const serviceDate = parseDate(day.date);
        const charge = await tx.billingCharge.upsert({
          where: {
            sourceKey: fbsMergedLogisticsSourceKey(mergedSourceKey, day.date),
          },
          update: {
            serviceId: dailyLogisticsService.id,
            description: fbsDailyLogisticsDescription(day.date),
            unit: BillingUnit.SERVICE,
            quantity: 1,
            unitPriceRub: amountRub,
            totalRub: amountRub,
            status: BillingChargeStatus.DRAFT,
            serviceDate,
            source: BillingChargeSource.LOGISTICS,
            metadata: fbsDailyLogisticsMetadata(day, mergedSourceKey),
            comment: 'Стоимость одного общего выезда за выбранный день.',
          },
          create: {
            clientId: dto.clientId,
            serviceId: dailyLogisticsService.id,
            description: fbsDailyLogisticsDescription(day.date),
            unit: BillingUnit.SERVICE,
            quantity: 1,
            unitPriceRub: amountRub,
            totalRub: amountRub,
            status: BillingChargeStatus.DRAFT,
            serviceDate,
            source: BillingChargeSource.LOGISTICS,
            sourceKey: fbsMergedLogisticsSourceKey(mergedSourceKey, day.date),
            metadata: fbsDailyLogisticsMetadata(day, mergedSourceKey),
            comment: 'Стоимость одного общего выезда за выбранный день.',
            createdByUserId: user.id,
          },
        });
        itemRows.set(`charge:${charge.id}`, {
          chargeId: charge.id,
          description: charge.description,
          unit: charge.unit,
          quantity: charge.quantity,
          unitPriceRub: charge.unitPriceRub,
          totalRub: charge.totalRub,
          serviceDate: charge.serviceDate,
        });
      }

      const rows = prepareMergedInvoiceRows([...itemRows.values()], {
        aggregateSameItems: dto.aggregateSameItems === true,
        excludeZeroTotalItems: dto.excludeZeroTotalItems === true,
      });
      const totalRub = roundMoney(
        rows.reduce(
          (sum, row) => sum + (decimalToNumber(row.totalRub) ?? 0),
          0,
        ),
      );
      assertPositiveInvoiceTotal(totalRub);

      const mergedInvoice = await tx.billingInvoice.upsert({
        where: { sourceKey: mergedSourceKey },
        update: {
          warehouseId: selection.warehouseId,
          periodFrom,
          periodTo,
          status: BillingInvoiceStatus.DRAFT,
          totalRub,
          comment: mergedComment,
          items: {
            deleteMany: {},
            create: rows,
          },
        },
        create: {
          number,
          clientId: dto.clientId,
          warehouseId: selection.warehouseId,
          periodFrom,
          periodTo,
          status: BillingInvoiceStatus.DRAFT,
          source: BillingInvoiceSource.MANUAL,
          sourceKey: mergedSourceKey,
          totalRub,
          comment: mergedComment,
          createdByUserId: user.id,
          items: { create: rows },
        },
        include: billingInvoiceInclude,
      });

      if (sourceInvoices.length > 0) {
        await tx.billingInvoice.updateMany({
          where: { id: { in: sourceInvoices.map((invoice) => invoice.id) } },
          data: {
            status: BillingInvoiceStatus.CANCELLED,
            comment: `${FBS_MERGED_SOURCE_COMMENT_PREFIX} ${number}.`,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'billing.fbs-invoices.merge',
          entity: 'billing-invoice',
          entityId: mergedInvoice.id,
          payload: {
            clientId: dto.clientId,
            mergedInvoiceNumber: number,
            sourceInvoiceNumbers: sourceNumbers,
            includePrimaryProcessing,
            aggregateSameItems: dto.aggregateSameItems === true,
            excludeZeroTotalItems: dto.excludeZeroTotalItems === true,
            primaryProcessingTotalRub: includePrimaryProcessing
              ? selection.preview.primaryProcessing.totalRub
              : 0,
            logisticsDays: selection.preview.logisticsDays.map((day) => ({
              date: day.date,
              amountRub: providedDays.has(day.date)
                ? providedDays.get(day.date)
                : day.currentAmountRub ?? day.suggestedAmountRub,
              shipments: day.shipments,
              orders: day.orders,
            })),
          },
        },
      });
      return mergedInvoice;
    });
  }

  async mergeInvoices(dto: MergeBillingInvoicesDto, user: AuthUser) {
    const invoiceIds = [...new Set(dto.invoiceIds)];
    if (invoiceIds.length < 2) {
      throw new BadRequestException('Для объединения выберите минимум два счёта.');
    }

    const invoices = await this.prisma.billingInvoice.findMany({
      where: {
        id: { in: invoiceIds },
        ...billingInvoiceWarehouseWhere(user),
      },
      include: billingInvoiceInclude,
      orderBy: [{ periodFrom: 'asc' }, { createdAt: 'asc' }],
    });
    if (invoices.length !== invoiceIds.length) {
      throw new BadRequestException('Один или несколько выбранных счетов не найдены.');
    }

    const clientId = invoices[0].clientId;
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    if (invoices.some((invoice) => invoice.clientId !== clientId)) {
      throw new BadRequestException('Объединять можно только счета одного клиента.');
    }
    if (
      invoices.some(
        (invoice) =>
          invoice.status !== BillingInvoiceStatus.DRAFT ||
          (decimalToNumber(invoice.paidRub) ?? 0) > 0 ||
          invoice.payments.length > 0,
      )
    ) {
      throw new BadRequestException(
        'Объединять можно только неоплаченные счета в статусе «Черновик».',
      );
    }

    const warehouseId = resolveMergedInvoiceWarehouseId(invoices, user);

    const periodFrom = minDateValue(invoices.map((invoice) => invoice.periodFrom));
    const periodTo = maxDateValue(invoices.map((invoice) => invoice.periodTo));
    const dueDates = invoices
      .map((invoice) => invoice.dueDate)
      .filter((date): date is Date => Boolean(date));
    const dueDate = dueDates.length ? maxDateValue(dueDates) : null;
    const rows = new Map<string, (typeof invoices)[number]['items'][number]>();
    invoices.forEach((invoice) => {
      invoice.items.forEach((item) => {
        const key = item.chargeId ? `charge:${item.chargeId}` : `item:${item.id}`;
        if (!rows.has(key)) {
          rows.set(key, item);
        }
      });
    });
    if (rows.size === 0) {
      throw new BadRequestException('В выбранных счетах нет строк для объединения.');
    }

    const items = prepareMergedInvoiceRows(
      [...rows.values()].map((item) => ({
        chargeId: item.chargeId,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unitPriceRub: item.unitPriceRub,
        totalRub: item.totalRub,
        serviceDate: item.serviceDate,
      })),
      {
        aggregateSameItems: dto.aggregateSameItems === true,
        excludeZeroTotalItems: dto.excludeZeroTotalItems === true,
      },
    );
    if (items.length === 0) {
      throw new BadRequestException(
        'После применения выбранных параметров в счёте не осталось строк с ненулевой суммой.',
      );
    }
    const totalRub = roundMoney(
      items.reduce((sum, item) => sum + (decimalToNumber(item.totalRub) ?? 0), 0),
    );
    assertPositiveInvoiceTotal(totalRub);
    const number = await this.nextInvoiceNumber(periodFrom);
    const sourceNumbers = invoices.map((invoice) => invoice.number);

    return this.prisma.$transaction(async (tx) => {
      const mergedInvoice = await tx.billingInvoice.create({
        data: {
          number,
          clientId,
          warehouseId,
          periodFrom,
          periodTo,
          dueDate,
          status: BillingInvoiceStatus.DRAFT,
          source: BillingInvoiceSource.MANUAL,
          sourceKey: `invoice-merged:${clientId}:${number}`,
          totalRub,
          comment: `Объединённый черновик из счетов: ${sourceNumbers.join(', ')}.`,
          createdByUserId: user.id,
          items: {
            create: items.map((item) => ({
              chargeId: item.chargeId,
              description: item.description,
              unit: item.unit,
              quantity: item.quantity,
              unitPriceRub: item.unitPriceRub,
              totalRub: item.totalRub,
              serviceDate: item.serviceDate,
            })),
          },
        },
        include: billingInvoiceInclude,
      });

      await tx.billingInvoice.updateMany({
        where: { id: { in: invoiceIds } },
        data: {
          status: BillingInvoiceStatus.CANCELLED,
          comment: `${INVOICE_MERGED_SOURCE_COMMENT_PREFIX} ${number}.`,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'billing.invoices.merge',
          entity: 'billing-invoice',
          entityId: mergedInvoice.id,
          payload: {
            clientId,
            mergedInvoiceNumber: number,
            sourceInvoiceIds: invoiceIds,
            sourceInvoiceNumbers: sourceNumbers,
            totalRub,
            aggregateSameItems: dto.aggregateSameItems === true,
            excludeZeroTotalItems: dto.excludeZeroTotalItems === true,
          },
        },
      });
      return mergedInvoice;
    });
  }

  private async loadFbsMergeSelection(clientId: string, user: AuthUser, invoiceIds?: string[]) {
    if (!clientId) {
      throw new BadRequestException('Выберите клиента для объединения FBS-счетов.');
    }
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, code: true, name: true },
    });
    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }
    const [drafts, primaryProcessingSettings] = await Promise.all([
      this.prisma.billingInvoice.findMany({
        where: {
          clientId,
          ...billingInvoiceWarehouseWhere(user),
          status: BillingInvoiceStatus.DRAFT,
          paidRub: { lte: 0 },
          payments: { none: {} },
        },
        include: fbsMergeInvoiceInclude,
        orderBy: [{ periodFrom: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.clientFbsBillingSettings.findUnique({
        where: { clientId },
        select: { primaryProcessingEnabled: true },
      }),
    ]);
    const allInvoices = drafts.filter(isFbsMergeInvoice);
    const allPrimaryInvoices = drafts.filter(isFbsPrimaryProcessingInvoice);
    const target = allInvoices.find(
      (invoice) => isMergedFbsInvoiceSourceKey(invoice.sourceKey, clientId),
    );
    const allSourceInvoices = allInvoices.filter(
      (invoice) => !isMergedFbsInvoiceSourceKey(invoice.sourceKey, clientId),
    );
    const requestedInvoiceIds = [...new Set(invoiceIds ?? [])];
    const allowedInvoicesById = new Map(
      [...allSourceInvoices, ...allPrimaryInvoices].map((invoice) => [invoice.id, invoice]),
    );
    if (requestedInvoiceIds.some((id) => !allowedInvoicesById.has(id))) {
      throw new BadRequestException(
        'Один или несколько выбранных счетов нельзя объединить: они уже обработаны, относятся к другому клиенту или не являются FBS-черновиками.',
      );
    }
    const selectedInvoiceIds = new Set(requestedInvoiceIds);
    const sourceInvoices = requestedInvoiceIds.length
      ? allSourceInvoices.filter((invoice) => selectedInvoiceIds.has(invoice.id))
      : allSourceInvoices;
    const primaryInvoices = requestedInvoiceIds.length
      ? allPrimaryInvoices.filter((invoice) => selectedInvoiceIds.has(invoice.id))
      : allPrimaryInvoices;
    const invoices = target ? [target, ...sourceInvoices] : sourceInvoices;
    if (!target && sourceInvoices.length === 0) {
      throw new BadRequestException(
        primaryInvoices.length > 0
          ? 'Для объединения выберите хотя бы один основной FBS-счёт вместе со счетами первичной обработки.'
          : 'У выбранного клиента нет доступных FBS-черновиков для объединения.',
      );
    }
    const orderDates = new Map<string, string>();
    for (const invoice of invoices) {
      for (const item of invoice.items) {
        const metadata = asRecord(item.charge?.metadata);
        if (metadata?.kind !== 'FBS') {
          continue;
        }
        const serviceDate = dateKey(item.charge?.serviceDate ?? item.serviceDate);
        for (const orderId of metadataStringArray(metadata.orderIds)) {
          const currentDate = orderDates.get(orderId);
          if (!currentDate || serviceDate < currentDate) {
            orderDates.set(orderId, serviceDate);
          }
        }
      }
    }
    const orderIds = [...orderDates.keys()];
    const [links, assemblies] = orderIds.length
      ? await Promise.all([
          this.prisma.fbsOrderRequestLink.findMany({
            where: { clientId, orderId: { in: orderIds } },
            select: { orderId: true, lastItemCount: true },
          }),
          this.prisma.fbsTsdAssembly.findMany({
            where: { clientId, orderId: { in: orderIds } },
            select: { orderId: true, itemCount: true },
          }),
        ])
      : [[], []];
    const linkCounts = new Map(
      links.map((row) => [
        row.orderId,
        Math.max(1, row.lastItemCount ?? 1),
      ]),
    );
    const assemblyCounts = new Map(
      assemblies.map((row) => [row.orderId, Math.max(1, row.itemCount)]),
    );
    const orders = orderIds
      .map((orderId) => ({
        orderId,
        itemCount: linkCounts.get(orderId) ?? assemblyCounts.get(orderId) ?? 1,
        date: orderDates.get(orderId)!,
      }))
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) ||
          left.orderId.localeCompare(right.orderId, 'ru-RU', { numeric: true }),
      );
    const warehouseId = resolveMergedInvoiceWarehouseId(
      [...invoices, ...primaryInvoices],
      user,
    );
    return {
      client,
      invoices,
      primaryInvoices,
      target,
      warehouseId,
      preview: buildFbsMergePreview(
        client,
        invoices,
        primaryInvoices,
        target?.id ?? null,
        orders,
        requestedInvoiceIds.length === 0 &&
          (primaryProcessingSettings?.primaryProcessingEnabled ?? false),
      ),
    };
  }

  private async paymentAccountSnapshot(
    clientId: string,
    bankAccountId?: string,
    warehouseId?: string | null,
  ) {
    if (!this.ownCompanies) {
      return {};
    }
    let resolvedBankAccountId = bankAccountId;
    if (!resolvedBankAccountId) {
      const accounts = await this.ownCompanies.listPaymentAccountsForClient(clientId, warehouseId);
      resolvedBankAccountId =
        accounts.bankAccounts.find((account: any) => account.isDefault)?.id ??
        accounts.bankAccounts[0]?.id;
    }
    if (!resolvedBankAccountId) {
      return {};
    }
    const seller = await this.ownCompanies.findSellerForClient(
      clientId,
      resolvedBankAccountId,
      warehouseId,
    );
    return {
      paymentBankAccountId: resolvedBankAccountId,
      paymentBankName: seller.bankName || null,
      paymentBankBik: seller.bankBik || null,
      paymentBankInn: seller.bankInn || null,
      paymentBankKpp: seller.bankKpp || null,
      paymentBankAccount: seller.bankAccount || null,
      paymentCorrespondentAccount: seller.correspondentAccount || null,
    };
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
    assertPositiveInvoiceTotal(totalRub);
    const number = await this.nextInvoiceNumber(periodFrom);
    const paymentAccount = await this.paymentAccountSnapshot(
      dto.clientId,
      dto.paymentBankAccountId,
      user.activeWarehouseId,
    );

    // Русский комментарий: счет фиксирует снимок начислений, чтобы дальнейшая правка услуги не меняла уже выставленный документ.
    return this.prisma.billingInvoice.create({
      data: {
        number,
        clientId: dto.clientId,
        warehouseId: user.activeWarehouseId,
        periodFrom,
        periodTo,
        dueDate: dto.dueDate ? parseDate(dto.dueDate, 'endOfDay') : undefined,
        totalRub,
        comment: normalizeText(dto.comment),
        ...paymentAccount,
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

      const totalRub = applyTaxMode(row.quantity * baseUnitPriceRub, taxMode);
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
    assertPositiveInvoiceTotal(totalRub);
    const number = await this.nextInvoiceNumber(periodFrom);
    const paymentAccount = await this.paymentAccountSnapshot(
      dto.clientId,
      dto.paymentBankAccountId,
      user.activeWarehouseId,
    );

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
          warehouseId: user.activeWarehouseId,
          periodFrom,
          periodTo,
          dueDate: dto.dueDate ? parseDate(dto.dueDate, 'endOfDay') : undefined,
          totalRub,
          comment: normalizeText(dto.comment),
          ...paymentAccount,
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
    const clientChanged = invoice.clientId !== dto.clientId;
    if (clientChanged) {
      this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
      if (
        invoice.source !== BillingInvoiceSource.MANUAL ||
        invoice.sourceKey ||
        invoice.requestId
      ) {
        throw new BadRequestException(
          'Клиента можно менять только у вручную созданного счета, не связанного с заявкой или автоматическим начислением.',
        );
      }
      const targetClient = await this.prisma.client.findUnique({
        where: { id: dto.clientId },
        select: { id: true },
      });
      if (!targetClient) {
        throw new NotFoundException('Новый клиент счета не найден.');
      }
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
        totalRub: applyTaxMode(row.quantity * baseUnitPriceRub, taxMode),
        serviceDate: row.serviceDate ? parseDate(row.serviceDate) : periodTo,
        comment: normalizeText(row.comment),
        metadata: { priceBeforeTaxRub: baseUnitPriceRub, taxMode },
      };
    });
    const totalRub = roundMoney(rows.reduce((sum, row) => sum + row.totalRub, 0));
    assertPositiveInvoiceTotal(totalRub);
    const paymentAccount = dto.paymentBankAccountId
      ? await this.paymentAccountSnapshot(
          dto.clientId,
          dto.paymentBankAccountId,
          user.activeWarehouseId,
        )
      : clientChanged
        ? emptyInvoicePaymentAccount()
        : {};

    return this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const existingItem = row.invoiceItemId ? existingItems.get(row.invoiceItemId) : null;
        let chargeId = existingItem?.chargeId ?? null;
        const chargeData = {
          clientId: dto.clientId,
          requestId: clientChanged ? null : invoice.requestId,
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

      const updatedInvoice = await tx.billingInvoice.update({
        where: { id: invoice.id },
        data: {
          clientId: dto.clientId,
          requestId: clientChanged ? null : invoice.requestId,
          periodFrom,
          periodTo,
          dueDate: dto.dueDate ? parseDate(dto.dueDate, 'endOfDay') : null,
          totalRub,
          comment: normalizeText(dto.comment),
          ...paymentAccount,
        },
        include: billingInvoiceInclude,
      });
      if (clientChanged) {
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'billing.invoice.client.update',
            entity: 'billing-invoice',
            entityId: invoice.id,
            payload: {
              invoiceNumber: invoice.number,
              previousClientId: invoice.clientId,
              clientId: dto.clientId,
            },
          },
        });
      }
      return updatedInvoice;
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
    if (
      dto.status === BillingInvoiceStatus.ISSUED ||
      dto.status === BillingInvoiceStatus.PAID
    ) {
      assertPositiveInvoiceTotal(totalRub);
    }
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

  async createIncomingPayment(dto: CreateIncomingPaymentDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    const invoiceIds = dto.allocations.map((allocation) => allocation.invoiceId);
    if (new Set(invoiceIds).size !== invoiceIds.length) {
      throw new BadRequestException('Один счёт нельзя указывать в приходе денежных средств дважды.');
    }
    const allocatedTotal = roundMoney(
      dto.allocations.reduce((sum, allocation) => sum + allocation.amountRub, 0),
    );
    if (Math.abs(allocatedTotal - roundMoney(dto.totalRub)) > 0.009) {
      throw new BadRequestException(
        `Распределено ${formatRub(allocatedTotal)} руб., а сумма прихода составляет ${formatRub(dto.totalRub)} руб.`,
      );
    }
    const paidAt = dto.paidAt ? parseDate(dto.paidAt) : new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const [client, invoices] = await Promise.all([
        tx.client.findUnique({
          where: { id: dto.clientId },
          select: { id: true, code: true, name: true },
        }),
        tx.billingInvoice.findMany({
          where: {
            id: { in: invoiceIds },
          },
          select: {
            id: true,
            number: true,
            clientId: true,
            status: true,
            totalRub: true,
            paidRub: true,
            issuedAt: true,
            comment: true,
          },
        }),
      ]);
      if (!client) {
        throw new NotFoundException('Клиент прихода денежных средств не найден.');
      }
      if (invoices.length !== invoiceIds.length) {
        throw new BadRequestException('Один или несколько выбранных счетов не найдены.');
      }
      if (invoices.some((invoice) => invoice.clientId !== dto.clientId)) {
        throw new BadRequestException('Один или несколько выбранных счетов не принадлежат клиенту.');
      }
      const mergedSource = invoices.find((invoice) => {
        const comment = invoice.comment?.trim() ?? '';
        return (
          comment.startsWith(FBS_MERGED_SOURCE_COMMENT_PREFIX) ||
          comment.startsWith(INVOICE_MERGED_SOURCE_COMMENT_PREFIX)
        );
      });
      if (mergedSource) {
        throw new BadRequestException(
          `Счёт №${mergedSource.number} уже вошёл в объединённый счёт — выберите объединённый счёт.`,
        );
      }

      const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      const updatedInvoices = [];
      for (const allocation of dto.allocations) {
        const invoice = invoicesById.get(allocation.invoiceId)!;
        if (invoice.status === BillingInvoiceStatus.CANCELLED) {
          throw new BadRequestException(`Счёт №${invoice.number} отменён — оплату по нему принять нельзя.`);
        }
        const totalRub = decimalToNumber(invoice.totalRub) ?? 0;
        const paidRub = decimalToNumber(invoice.paidRub) ?? 0;
        const remainingRub = roundMoney(totalRub - paidRub);
        if (remainingRub <= 0) {
          throw new BadRequestException(`Счёт №${invoice.number} уже полностью оплачен.`);
        }
        if (allocation.amountRub > remainingRub + 0.009) {
          throw new BadRequestException(
            `По счёту №${invoice.number} осталось ${formatRub(remainingRub)} руб., распределено ${formatRub(allocation.amountRub)} руб.`,
          );
        }

        const nextPaidRub = roundMoney(paidRub + allocation.amountRub);
        const nextStatus = nextPaidRub >= totalRub
          ? BillingInvoiceStatus.PAID
          : BillingInvoiceStatus.ISSUED;
        await tx.billingPayment.create({
          data: {
            invoiceId: invoice.id,
            clientId: dto.clientId,
            amountRub: allocation.amountRub,
            paidAt,
            method: normalizeText(dto.method),
            reference: normalizeText(dto.reference),
            comment: normalizeText(dto.comment),
            createdByUserId: user.id,
          },
        });
        updatedInvoices.push(
          await tx.billingInvoice.update({
            where: { id: invoice.id },
            data: {
              paidRub: nextPaidRub,
              status: nextStatus,
              issuedAt: invoice.issuedAt ?? new Date(),
              paidAt: nextStatus === BillingInvoiceStatus.PAID ? paidAt : null,
            },
            include: billingInvoiceInclude,
          }),
        );

        if (await isClientNotificationEnabled(tx, dto.clientId, ClientNotificationEvent.BILLING_PAYMENT_RECORDED)) {
          await tx.clientNotification.create({
            data: {
              clientId: dto.clientId,
              title: 'Оплата по счету принята',
              body: `Счет № ${invoice.number}: ${formatRub(allocation.amountRub)} руб. Оплачено ${formatRub(nextPaidRub)} из ${formatRub(totalRub)} руб.`,
              severity: nextStatus === BillingInvoiceStatus.PAID ? 'SUCCESS' : 'INFO',
              createdByUserId: user.id,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'billing.payment.incoming.create',
          entity: 'client',
          entityId: dto.clientId,
          payload: {
            totalRub: allocatedTotal,
            paidAt: paidAt.toISOString(),
            method: normalizeText(dto.method),
            reference: normalizeText(dto.reference),
            allocations: dto.allocations.map((allocation) => ({
              invoiceId: allocation.invoiceId,
              amountRub: allocation.amountRub,
            })),
          },
        },
      });
      return { client, invoices: updatedInvoices };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    void this.telegram?.notifyClient(
      dto.clientId,
      [
        'LOGOFF WMS: зарегистрирован приход денежных средств.',
        `Сумма: ${formatRub(allocatedTotal)} руб.`,
        ...dto.allocations.map((allocation) => {
          const invoice = result.invoices.find((item) => item.id === allocation.invoiceId);
          return `Счёт №${invoice?.number ?? allocation.invoiceId}: ${formatRub(allocation.amountRub)} руб.`;
        }),
      ].join('\n'),
    );

    return {
      client: result.client,
      totalRub: allocatedTotal,
      paidAt: paidAt.toISOString(),
      invoices: result.invoices,
    };
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

  private async ensureNomenclatureBillingServices() {
    const nomenclatureServices = await this.prisma.nomenclatureItem.findMany({
      where: {
        OR: [
          { itemType: { equals: 'Услуга', mode: 'insensitive' } },
          { itemType: { equals: 'Service', mode: 'insensitive' } },
        ],
      },
      select: {
        internalSku: true,
        name: true,
        unit: true,
      },
    });

    const desiredServices = nomenclatureServices.map((item) => ({
      code: nomenclatureBillingServiceCode(item.internalSku),
      name: item.name,
      unit: nomenclatureBillingUnit(item.unit),
    }));
    const currentServices = desiredServices.length
      ? await this.prisma.billingService.findMany({
          where: { code: { in: desiredServices.map((service) => service.code) } },
          select: { code: true, name: true, unit: true, isActive: true },
        })
      : [];
    const currentByCode = new Map(currentServices.map((service) => [service.code, service]));

    await Promise.all(
      desiredServices.map((service) => {
        const current = currentByCode.get(service.code);
        if (
          current &&
          current.name === service.name &&
          current.unit === service.unit &&
          current.isActive
        ) {
          return Promise.resolve(current);
        }
        return this.prisma.billingService.upsert({
          where: { code: service.code },
          update: {
            name: service.name,
            unit: service.unit,
            isActive: true,
          },
          create: {
            code: service.code,
            name: service.name,
            unit: service.unit,
            isActive: true,
          },
        });
      }),
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
const FBS_DAILY_LOGISTICS_SERVICE_CODE = 'FBS_DAILY_LOGISTICS';
const FBS_DAILY_LOGISTICS_METADATA_KIND = 'FBS_DAILY_LOGISTICS';
const FBS_MERGED_SOURCE_COMMENT_PREFIX = 'Объединено в FBS-счёт';
const INVOICE_MERGED_SOURCE_COMMENT_PREFIX = 'Объединено в счёт';
const ADVANCE_APPLIED_COMMENT_PREFIX = '[ADVANCE_APPLIED]';
const ADVANCE_REDEEMED_COMMENT = '[ADVANCE_REDEEMED]';
const FBS_ORDER_DETAIL_PREFIX = 'FBS-заказ №';

function emptyInvoicePaymentAccount() {
  return {
    paymentBankAccountId: null,
    paymentBankName: null,
    paymentBankBik: null,
    paymentBankInn: null,
    paymentBankKpp: null,
    paymentBankAccount: null,
    paymentCorrespondentAccount: null,
  };
}

function isBillingAdministrator(user: AuthUser) {
  return (
    user.permissionCodes.includes('system:admin') ||
    user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER')
  );
}

function isClientBillingUser(user: AuthUser) {
  return (
    user.roleCodes.includes('CLIENT') &&
    !user.permissionCodes.includes('system:admin')
  );
}

function branchScopedInvoiceWarehouseId(user: AuthUser) {
  if (
    !user.activeWarehouseId ||
    user.roleCodes.includes('CLIENT') ||
    user.permissionCodes.includes('system:admin')
  ) {
    return null;
  }
  return user.activeWarehouseId;
}

function billingInvoiceWarehouseWhere(user: AuthUser): Prisma.BillingInvoiceWhereInput {
  const warehouseId = branchScopedInvoiceWarehouseId(user);
  if (!warehouseId) return {};
  return {
    OR: [
      { warehouseId },
      { warehouseId: null, request: { warehouseId } },
    ],
  };
}

function resolveMergedInvoiceWarehouseId(
  invoices: Array<{ warehouseId: string | null }>,
  user: AuthUser,
) {
  const scopedWarehouseId = branchScopedInvoiceWarehouseId(user);
  const explicitWarehouseIds = [
    ...new Set(
      invoices
        .map((invoice) => invoice.warehouseId?.trim() ?? '')
        .filter(Boolean),
    ),
  ];
  const hasUnscopedInvoices = invoices.some((invoice) => !invoice.warehouseId);

  if (
    explicitWarehouseIds.length > 1 ||
    (!scopedWarehouseId && explicitWarehouseIds.length > 0 && hasUnscopedInvoices)
  ) {
    throw new BadRequestException(
      'Нельзя объединить счета разных филиалов. Выберите счета одного филиала.',
    );
  }
  if (
    scopedWarehouseId &&
    explicitWarehouseIds.some((warehouseId) => warehouseId !== scopedWarehouseId)
  ) {
    throw new BadRequestException('Один или несколько счетов относятся к другому филиалу.');
  }

  return scopedWarehouseId ?? explicitWarehouseIds[0] ?? null;
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

const fbsMergeInvoiceInclude = {
  items: {
    include: {
      charge: true,
    },
    orderBy: [{ serviceDate: 'asc' }, { id: 'asc' }],
  },
  payments: true,
} satisfies Prisma.BillingInvoiceInclude;

type FbsMergeInvoice = Prisma.BillingInvoiceGetPayload<{
  include: typeof fbsMergeInvoiceInclude;
}>;

type FbsMergeOrder = {
  orderId: string;
  itemCount: number;
  date: string;
};

type FbsMergeLogisticsDay = {
  date: string;
  shipments: number;
  orders: number;
  itemCount: number;
  currentAmountRub: number | null;
  suggestedAmountRub: number;
};

type InvoiceRecheckStatus = 'OK' | 'WARNING' | 'ERROR';

type InvoiceRecheckCheck = {
  code: string;
  label: string;
  status: InvoiceRecheckStatus;
  message: string;
};

type FbsMergePreview = {
  client: {
    id: string;
    code: string;
    name: string;
  };
  draftInvoices: number;
  sourceInvoiceNumbers: string[];
  existingMergedInvoiceId: string | null;
  processingTotalRub: number;
  primaryProcessing: {
    available: boolean;
    included: boolean;
    invoices: number;
    shipments: number;
    itemCount: number;
    totalRub: number;
  };
  orders: FbsMergeOrder[];
  logisticsDays: FbsMergeLogisticsDay[];
};

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

function requiresDetailedPrimaryProcessingRates(client: { code: string; name: string }) {
  const identity = `${client.code} ${client.name}`
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е');
  return identity.includes('лукин');
}

function decimalToNumber(value: Prisma.Decimal | string | number | null | undefined) {
  return value == null ? undefined : Number(value);
}

function prepareMergedInvoiceRows(
  sourceRows: MergeInvoiceRow[],
  options: {
    aggregateSameItems: boolean;
    excludeZeroTotalItems: boolean;
  },
) {
  const rows = options.excludeZeroTotalItems
    ? sourceRows.filter((row) => roundMoney(decimalToNumber(row.totalRub) ?? 0) !== 0)
    : [...sourceRows];

  if (!options.aggregateSameItems) {
    return sortMergedInvoiceRows(rows);
  }

  const grouped = new Map<string, MergeInvoiceRow>();
  for (const row of rows) {
    const normalizedDescription = row.description.trim().replace(/\s+/g, ' ');
    const unitPriceRub = roundMoney(decimalToNumber(row.unitPriceRub) ?? 0);
    const key = [
      normalizedDescription.toLocaleLowerCase('ru-RU'),
      row.unit,
      unitPriceRub.toFixed(2),
    ].join('|');
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...row,
        description: normalizedDescription,
        quantity: roundQuantity(decimalToNumber(row.quantity) ?? 0),
        unitPriceRub,
        totalRub: roundMoney(decimalToNumber(row.totalRub) ?? 0),
      });
      continue;
    }

    existing.quantity = roundQuantity(
      (decimalToNumber(existing.quantity) ?? 0) + (decimalToNumber(row.quantity) ?? 0),
    );
    existing.totalRub = roundMoney(
      (decimalToNumber(existing.totalRub) ?? 0) + (decimalToNumber(row.totalRub) ?? 0),
    );
    existing.chargeId = existing.chargeId === row.chargeId ? existing.chargeId : null;
    if (row.serviceDate.getTime() < existing.serviceDate.getTime()) {
      existing.serviceDate = row.serviceDate;
    }
  }

  return sortMergedInvoiceRows([...grouped.values()]);
}

function sortMergedInvoiceRows(rows: MergeInvoiceRow[]) {
  return rows.sort(
    (left, right) =>
      left.serviceDate.getTime() - right.serviceDate.getTime() ||
      left.description.localeCompare(right.description, 'ru-RU'),
  );
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertPositiveInvoiceTotal(totalRub: number) {
  if (!Number.isFinite(totalRub) || totalRub <= 0) {
    throw new BadRequestException(
      'Счет с нулевой суммой не создается и не выставляется. Сначала укажите положительную стоимость услуг.',
    );
  }
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

function finiteMetadataNumber(value: unknown, message: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException(message);
  }
  return roundMoney(parsed);
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

function formatQuantity(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
}

function duplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  });
  return [...duplicates];
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

function normalizeFbsDestination(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function fbsMergedInvoiceSourceKey(clientId: string, invoiceNumber: string) {
  return `fbs-merged:${clientId}:${invoiceNumber}`;
}

function isMergedFbsInvoiceSourceKey(sourceKey: string | null, clientId: string) {
  return sourceKey?.startsWith(`fbs-merged:${clientId}:`) === true;
}

function fbsMergedLogisticsSourceKey(mergedInvoiceSourceKey: string, date: string) {
  return `${mergedInvoiceSourceKey}:logistics:${date}`;
}

function fbsDailyLogisticsDescription(date: string) {
  return `Логистика FBS за ${date} — один выезд`;
}

function fbsDailyLogisticsMetadata(
  day: FbsMergeLogisticsDay,
  mergedInvoiceSourceKey: string,
): Prisma.InputJsonValue {
  return {
    kind: FBS_DAILY_LOGISTICS_METADATA_KIND,
    billingDay: day.date,
    shipments: day.shipments,
    orders: day.orders,
    itemCount: day.itemCount,
    mergedInvoiceSourceKey,
  };
}

function isFbsMergeInvoice(invoice: FbsMergeInvoice) {
  if (isMergedFbsInvoiceSourceKey(invoice.sourceKey, invoice.clientId)) {
    return true;
  }
  if (!invoice.sourceKey?.startsWith(`fbs-invoice:${invoice.clientId}:`)) {
    return false;
  }
  return invoice.items.some((item) => {
    const kind = asRecord(item.charge?.metadata)?.kind;
    return kind === 'FBS' || kind === FBS_DAILY_LOGISTICS_METADATA_KIND;
  });
}

function isFbsPrimaryProcessingInvoice(invoice: FbsMergeInvoice) {
  if (!invoice.sourceKey?.startsWith(`fbs-primary-invoice:${invoice.clientId}:`)) {
    return false;
  }
  return invoice.items.some(
    (item) =>
      asRecord(item.charge?.metadata)?.kind === 'FBS_PRIMARY_PROCESSING',
  );
}

function buildFbsMergePreview(
  client: { id: string; code: string; name: string },
  invoices: FbsMergeInvoice[],
  primaryInvoices: FbsMergeInvoice[],
  existingMergedInvoiceId: string | null,
  orders: FbsMergeOrder[],
  primaryProcessingEnabled: boolean,
): FbsMergePreview {
  const sourceInvoices = invoices.filter(
    (invoice) => !isMergedFbsInvoiceSourceKey(invoice.sourceKey, client.id),
  );
  const logisticsDays = new Map<
    string,
    {
      shipmentKeys: Set<string>;
      orderIds: Set<string>;
      suggestedAmountRub: number;
      currentAmountRub: number | null;
    }
  >();
  let processingTotalRub = 0;
  let primaryProcessingIncluded = false;
  let primaryProcessingTotalRub = 0;
  const primaryChargeIds = new Set<string>();
  const primaryShipments = new Map<string, number>();
  const fbsShipmentKeys = new Set<string>();

  for (const invoice of [...invoices, ...primaryInvoices]) {
    const isMergedInvoice = isMergedFbsInvoiceSourceKey(
      invoice.sourceKey,
      client.id,
    );
    for (const item of invoice.items) {
      const charge = item.charge;
      const metadata = asRecord(charge?.metadata);
      if (
        !charge ||
        metadata?.kind !== 'FBS_PRIMARY_PROCESSING' ||
        primaryChargeIds.has(charge.id)
      ) {
        continue;
      }
      primaryChargeIds.add(charge.id);
      primaryProcessingIncluded ||= isMergedInvoice;
      primaryProcessingTotalRub = roundMoney(
        primaryProcessingTotalRub + (decimalToNumber(charge.totalRub) ?? 0),
      );
      const shipmentKey =
        textMetadataValue(metadata.shipmentKey) ?? charge.sourceKey ?? charge.id;
      primaryShipments.set(
        shipmentKey,
        Math.max(
          primaryShipments.get(shipmentKey) ?? 0,
          optionalMetadataNumber(metadata.quantity) ??
            decimalToNumber(charge.quantity) ??
            0,
        ),
      );
    }
  }

  for (const invoice of invoices) {
    for (const item of invoice.items) {
      const charge = item.charge;
      if (!charge) {
        continue;
      }
      const metadata = asRecord(charge.metadata);
      if (metadata?.kind === FBS_DAILY_LOGISTICS_METADATA_KIND) {
        const billingDay = textMetadataValue(metadata.billingDay) ?? dateKey(charge.serviceDate);
        const current = logisticsDays.get(billingDay) ?? {
          shipmentKeys: new Set<string>(),
          orderIds: new Set<string>(),
          suggestedAmountRub: 0,
          currentAmountRub: null,
        };
        current.currentAmountRub = decimalToNumber(charge.totalRub) ?? 0;
        logisticsDays.set(billingDay, current);
        continue;
      }
      if (metadata?.kind !== 'FBS') {
        continue;
      }

      const logisticsTrip = asRecord(metadata.logisticsTrip);
      const billingDay =
        textMetadataValue(logisticsTrip?.billingDay) ?? dateKey(charge.serviceDate);
      const day = logisticsDays.get(billingDay) ?? {
        shipmentKeys: new Set<string>(),
        orderIds: new Set<string>(),
        suggestedAmountRub: 0,
        currentAmountRub: null,
      };
      const shipmentKey = textMetadataValue(metadata.shipmentKey) ?? charge.sourceKey ?? charge.id;
      fbsShipmentKeys.add(shipmentKey);
      day.shipmentKeys.add(shipmentKey);
      metadataStringArray(metadata.orderIds).forEach((orderId) => day.orderIds.add(orderId));
      if (logisticsTrip?.charged === true) {
        day.suggestedAmountRub = roundMoney(
          day.suggestedAmountRub +
            (optionalMetadataNumber(logisticsTrip.logisticsRub) ?? 0),
        );
      }
      logisticsDays.set(billingDay, day);
      processingTotalRub = roundMoney(
        processingTotalRub +
          (optionalMetadataNumber(logisticsTrip?.totalWithoutLogisticsRub) ??
            decimalToNumber(charge.totalRub) ??
            0),
      );
    }
  }

  const orderCounts = new Map(orders.map((order) => [order.orderId, order.itemCount]));
  const allFbsItemCount = orders.reduce((sum, order) => sum + order.itemCount, 0);
  const primaryProcessingAvailable =
    primaryProcessingEnabled || primaryChargeIds.size > 0;
  return {
    client,
    draftInvoices: sourceInvoices.length,
    sourceInvoiceNumbers: sourceInvoices.map((invoice) => invoice.number),
    existingMergedInvoiceId,
    processingTotalRub,
    primaryProcessing: {
      available: primaryProcessingAvailable,
      included: primaryProcessingIncluded,
      invoices: primaryInvoices.length,
      shipments: primaryProcessingEnabled
        ? fbsShipmentKeys.size
        : primaryShipments.size,
      itemCount: primaryProcessingEnabled
        ? allFbsItemCount
        : [...primaryShipments.values()].reduce(
            (sum, quantity) => sum + quantity,
            0,
          ),
      totalRub: primaryProcessingTotalRub,
    },
    orders,
    logisticsDays: [...logisticsDays.entries()]
      .map(([date, day]) => ({
        date,
        shipments: day.shipmentKeys.size,
        orders: day.orderIds.size,
        itemCount: [...day.orderIds].reduce(
          (sum, orderId) => sum + (orderCounts.get(orderId) ?? 1),
          0,
        ),
        currentAmountRub: day.currentAmountRub,
        suggestedAmountRub: roundMoney(day.suggestedAmountRub),
      }))
      .sort((left, right) => left.date.localeCompare(right.date)),
  };
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function minDateValue(values: Date[]) {
  if (values.length === 0) {
    throw new BadRequestException('Не удалось определить начало периода FBS-счёта.');
  }
  return new Date(Math.min(...values.map((value) => value.getTime())));
}

function maxDateValue(values: Date[]) {
  if (values.length === 0) {
    throw new BadRequestException('Не удалось определить окончание периода FBS-счёта.');
  }
  return new Date(Math.max(...values.map((value) => value.getTime())));
}

function optionalMetadataNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function textMetadataValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function metadataStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function nomenclatureBillingServiceCode(internalSku: string) {
  const normalized = internalSku
    .trim()
    .toLocaleUpperCase('ru-RU')
    .replace(/[^A-ZА-ЯЁ0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `NOM_${normalized}`;
}

function nomenclatureBillingUnit(unit: string | null) {
  const normalized = unit?.trim().toLocaleLowerCase('ru-RU') ?? '';
  if (/^(шт|piece|штук)/.test(normalized)) return BillingUnit.PIECE;
  if (/(короб|box)/.test(normalized)) return BillingUnit.BOX;
  if (/(паллет|поддон|pallet)/.test(normalized)) return BillingUnit.PALLET;
  if (/(литро.?\s*ден|liter.?\s*day)/.test(normalized)) return BillingUnit.LITER_DAY;
  if (/(литр|liter)/.test(normalized)) return BillingUnit.LITER;
  if (/(ден|day)/.test(normalized)) return BillingUnit.DAY;
  if (/(час|hour)/.test(normalized)) return BillingUnit.HOUR;
  return BillingUnit.SERVICE;
}
