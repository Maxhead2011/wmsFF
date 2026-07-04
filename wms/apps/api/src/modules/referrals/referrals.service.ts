import { Injectable } from '@nestjs/common';
import { BillingChargeSource, BillingChargeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ReferralReportDto } from './dto/referral-report.dto';

const EXCLUDED_SERVICE_CODES = ['LOGISTICS_DELIVERY', 'STORAGE_LITER_DAY', 'PRR', 'LOADING', 'UNLOADING', 'LOADING_UNLOADING'];
const EXCLUDED_SERVICE_WORDS = [
  'LOGISTICS',
  'STORAGE',
  'DELIVERY',
  'PRR',
  'ПРР',
  'ХРАНЕН',
  'ЛОГИСТ',
  'ДОСТАВ',
  'ПОГРУЗ',
  'РАЗГРУЗ',
  'LOADING',
  'UNLOADING',
];

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(query: ReferralReportDto, user: AuthUser) {
    const now = new Date();
    const period = buildPeriod(query, now);
    const assignments = await this.prisma.userReferralClient.findMany({
      where: {
        userId: user.id,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
      include: {
        client: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ client: { name: 'asc' } }],
    });

    if (assignments.length === 0) {
      return emptyReport(period);
    }

    const assignmentsByClientId = new Map(assignments.map((assignment) => [assignment.clientId, assignment]));
    const charges = await this.prisma.billingCharge.findMany({
      where: {
        clientId: { in: assignments.map((assignment) => assignment.clientId) },
        status: BillingChargeStatus.APPROVED,
        serviceDate: { gte: period.periodFrom, lte: period.periodTo },
        source: { notIn: [BillingChargeSource.LOGISTICS, BillingChargeSource.STORAGE] },
        OR: [
          { serviceId: null },
          {
            service: {
              is: {
                code: { notIn: EXCLUDED_SERVICE_CODES },
              },
            },
          },
        ],
      },
      include: {
        client: { select: { id: true, code: true, name: true } },
        service: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }],
    });

    const byClient = new Map<string, ReturnType<typeof createClientRow>>();
    for (const assignment of assignments) {
      byClient.set(assignment.clientId, createClientRow(assignment));
    }

    charges.forEach((charge) => {
      if (isExcludedReferralCharge(charge)) {
        return;
      }

      const assignment = assignmentsByClientId.get(charge.clientId);
      const row = byClient.get(charge.clientId);
      if (!assignment || !row) {
        return;
      }
      if (!isChargeInsideAssignment(charge.serviceDate, assignment)) {
        return;
      }

      const totalRub = decimalToNumber(charge.totalRub);
      const quantity = decimalToNumber(charge.quantity);
      row.servicesRub += totalRub;
      row.referralRub += (totalRub * Number(assignment.percent)) / 100;
      row.chargesCount += 1;
      row.latestServiceAt = latestDate(row.latestServiceAt, charge.serviceDate.toISOString());

      const serviceKey = charge.service?.id ?? 'manual';
      const serviceRow = row.services.get(serviceKey) ?? {
        serviceId: charge.service?.id ?? null,
        serviceCode: charge.service?.code ?? null,
        serviceName: charge.service?.name ?? charge.description,
        quantity: 0,
        totalRub: 0,
        chargesCount: 0,
      };
      serviceRow.quantity += quantity;
      serviceRow.totalRub += totalRub;
      serviceRow.chargesCount += 1;
      row.services.set(serviceKey, serviceRow);
    });

    const clients = Array.from(byClient.values()).map((row) => ({
      client: row.client,
      percent: row.percent,
      startsAt: row.startsAt,
      expiresAt: row.expiresAt,
      termMonths: row.termMonths,
      servicesRub: roundMoney(row.servicesRub),
      referralRub: roundMoney(row.referralRub),
      chargesCount: row.chargesCount,
      latestServiceAt: row.latestServiceAt,
      services: Array.from(row.services.values())
        .map((service) => ({
          ...service,
          quantity: roundQuantity(service.quantity),
          totalRub: roundMoney(service.totalRub),
        }))
        .sort((left, right) => right.totalRub - left.totalRub || left.serviceName.localeCompare(right.serviceName, 'ru')),
    }));

    const totals = clients.reduce(
      (acc, client) => ({
        clientsCount: acc.clientsCount + 1,
        servicesRub: acc.servicesRub + client.servicesRub,
        referralRub: acc.referralRub + client.referralRub,
        chargesCount: acc.chargesCount + client.chargesCount,
      }),
      { clientsCount: 0, servicesRub: 0, referralRub: 0, chargesCount: 0 },
    );

    return {
      generatedAt: now.toISOString(),
      periodFrom: period.periodFrom.toISOString(),
      periodTo: period.periodTo.toISOString(),
      totals: {
        ...totals,
        servicesRub: roundMoney(totals.servicesRub),
        referralRub: roundMoney(totals.referralRub),
      },
      clients,
    };
  }
}

function isExcludedReferralCharge(charge: {
  description: string;
  source: BillingChargeSource;
  service: { code: string; name: string } | null;
}) {
  if (charge.source === BillingChargeSource.LOGISTICS || charge.source === BillingChargeSource.STORAGE) {
    return true;
  }

  const values = [charge.service?.code, charge.service?.name, charge.description]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLocaleUpperCase('ru-RU'));

  return values.some((value) => EXCLUDED_SERVICE_CODES.includes(value) || EXCLUDED_SERVICE_WORDS.some((word) => value.includes(word)));
}

function isChargeInsideAssignment(chargeDate: Date, assignment: { startsAt: Date; expiresAt: Date | null }) {
  if (chargeDate < assignment.startsAt) {
    return false;
  }

  return !assignment.expiresAt || chargeDate <= assignment.expiresAt;
}

function createClientRow(assignment: {
  client: { id: string; code: string; name: string };
  percent: Prisma.Decimal | number | string;
  startsAt: Date;
  expiresAt: Date | null;
  termMonths: number | null;
}) {
  return {
    client: assignment.client,
    percent: Number(assignment.percent),
    startsAt: assignment.startsAt.toISOString(),
    expiresAt: assignment.expiresAt?.toISOString() ?? null,
    termMonths: assignment.termMonths,
    servicesRub: 0,
    referralRub: 0,
    chargesCount: 0,
    latestServiceAt: null as string | null,
    services: new Map<
      string,
      {
        serviceId: string | null;
        serviceCode: string | null;
        serviceName: string;
        quantity: number;
        totalRub: number;
        chargesCount: number;
      }
    >(),
  };
}

function emptyReport(period: { periodFrom: Date; periodTo: Date }) {
  return {
    generatedAt: new Date().toISOString(),
    periodFrom: period.periodFrom.toISOString(),
    periodTo: period.periodTo.toISOString(),
    totals: {
      clientsCount: 0,
      servicesRub: 0,
      referralRub: 0,
      chargesCount: 0,
    },
    clients: [],
  };
}

function buildPeriod(query: ReferralReportDto, now: Date) {
  const periodFrom = query.periodFrom ? new Date(query.periodFrom) : new Date(now.getFullYear(), now.getMonth(), 1);
  const periodTo = query.periodTo ? endOfDay(new Date(query.periodTo)) : endOfDay(now);

  return { periodFrom, periodTo };
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  return value == null ? 0 : Number(value);
}

function latestDate(current: string | null, candidate: string) {
  return !current || candidate > current ? candidate : current;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}
