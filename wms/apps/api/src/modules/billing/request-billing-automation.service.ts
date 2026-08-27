import { Injectable } from '@nestjs/common';
import {
  BillingChargeSource,
  BillingChargeStatus,
  BillingInvoiceSource,
  BillingInvoiceStatus,
  ClientLogisticsInvoiceMode,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

type ApprovedCharge = Prisma.BillingChargeGetPayload<{
  select: {
    id: true;
    clientId: true;
    requestId: true;
    description: true;
    unit: true;
    quantity: true;
    unitPriceRub: true;
    totalRub: true;
    serviceDate: true;
    source: true;
  };
}>;

@Injectable()
export class RequestBillingAutomationService {
  constructor(private readonly prisma: PrismaService) {}

  async generateForDoneRequest(requestId: string, user: AuthUser) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        clientId: true,
        warehouseId: true,
        title: true,
        updatedAt: true,
        client: {
          select: { logisticsInvoiceMode: true },
        },
      },
    });
    if (!request) {
      return { status: 'FAILED' as const, created: 0 };
    }

    const charges = await this.prisma.billingCharge.findMany({
      where: {
        requestId,
        status: BillingChargeStatus.APPROVED,
        invoiceItems: {
          none: {
            invoice: {
              status: { not: BillingInvoiceStatus.CANCELLED },
            },
          },
        },
      },
      select: {
        id: true,
        clientId: true,
        requestId: true,
        description: true,
        unit: true,
        quantity: true,
        unitPriceRub: true,
        totalRub: true,
        serviceDate: true,
        source: true,
      },
      orderBy: [{ serviceDate: 'asc' }, { createdAt: 'asc' }],
    });
    if (!charges.length) {
      return { status: 'APPLIED' as const, created: 0 };
    }

    const logisticsCharges = charges.filter((charge) => charge.source === BillingChargeSource.LOGISTICS);
    const serviceCharges = charges.filter((charge) => charge.source !== BillingChargeSource.LOGISTICS);
    let mainInvoiceId: string | undefined;
    let logisticsInvoiceId: string | undefined;
    const mode = request.client.logisticsInvoiceMode;

    if (mode === ClientLogisticsInvoiceMode.SAME_INVOICE) {
      const invoice = await this.createDraftInvoice({
        request,
        charges,
        prefix: 'USL',
        source: BillingInvoiceSource.REQUEST_DONE,
        sourceKey: `request:${request.id}:all-services`,
        user,
      });
      if (invoice) {
        mainInvoiceId = invoice.id;
      }
    } else {
      const serviceInvoice = await this.createDraftInvoice({
        request,
        charges: serviceCharges,
        prefix: 'USL',
        source: BillingInvoiceSource.REQUEST_DONE,
        sourceKey: `request:${request.id}:services`,
        user,
      });
      if (serviceInvoice) {
        mainInvoiceId = serviceInvoice.id;
      }

      if (mode !== ClientLogisticsInvoiceMode.DISABLED) {
        const logisticsInvoice = await this.createDraftInvoice({
          request,
          charges: logisticsCharges,
          prefix: 'LOG',
          source: BillingInvoiceSource.LOGISTICS,
          sourceKey: `request:${request.id}:logistics`,
          user,
        });
        if (logisticsInvoice) {
          logisticsInvoiceId = logisticsInvoice.id;
        }
      }
    }

    return {
      status: 'APPLIED' as const,
      created: [mainInvoiceId, logisticsInvoiceId].filter(Boolean).length,
      mainInvoiceId,
      logisticsInvoiceId,
    };
  }

  private async createDraftInvoice(input: {
    request: { id: string; clientId: string; warehouseId: string | null; title: string; updatedAt: Date };
    charges: ApprovedCharge[];
    prefix: 'USL' | 'LOG';
    source: BillingInvoiceSource;
    sourceKey: string;
    user: AuthUser;
  }) {
    if (!input.charges.length) {
      return null;
    }

    const existing = await this.prisma.billingInvoice.findUnique({
      where: { sourceKey: input.sourceKey },
      select: { id: true },
    });
    if (existing) {
      return null;
    }

    const periodFrom = minDate(input.charges.map((charge) => charge.serviceDate)) ?? input.request.updatedAt;
    const periodTo = maxDate(input.charges.map((charge) => charge.serviceDate)) ?? input.request.updatedAt;
    const totalRub = roundMoney(input.charges.reduce((sum, charge) => sum + decimalToNumber(charge.totalRub), 0));
    if (totalRub <= 0) {
      return null;
    }
    const number = await this.nextInvoiceNumber(input.prefix, periodTo);

    return this.prisma.billingInvoice.create({
      data: {
        number,
        clientId: input.request.clientId,
        warehouseId: input.request.warehouseId,
        requestId: input.request.id,
        periodFrom,
        periodTo,
        status: BillingInvoiceStatus.DRAFT,
        source: input.source,
        sourceKey: input.sourceKey,
        totalRub,
        comment: `Автоматический черновик по заявке ${input.request.title}`,
        createdByUserId: input.user.id,
        items: {
          create: input.charges.map((charge) => ({
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
      select: { id: true },
    });
  }

  private async nextInvoiceNumber(prefix: 'USL' | 'LOG', date: Date) {
    const datePrefix = `${prefix}-${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const count = await this.prisma.billingInvoice.count({
      where: { number: { startsWith: datePrefix } },
    });
    return `${datePrefix}-${String(count + 1).padStart(4, '0')}`;
  }
}

function decimalToNumber(value: Prisma.Decimal | string | number | null | undefined) {
  return value == null ? 0 : Number(value);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function minDate(dates: Date[]) {
  return dates.reduce<Date | null>((current, date) => (!current || date < current ? date : current), null);
}

function maxDate(dates: Date[]) {
  return dates.reduce<Date | null>((current, date) => (!current || date > current ? date : current), null);
}
