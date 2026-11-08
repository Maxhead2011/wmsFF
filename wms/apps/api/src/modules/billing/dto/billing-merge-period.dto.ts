import { IsDateString, IsOptional, Matches } from 'class-validator';
import { BadRequestException } from '@nestjs/common';

// FIX: optional dates preserve existing API callers. A supplied range needs both ends.
export class BillingMergePeriodDto {
  @IsOptional()
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  periodFrom?: string;

  @IsOptional()
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  periodTo?: string;
}

export function billingMergePeriodWhere(period: BillingMergePeriodDto) {
  if (period.periodFrom === undefined && period.periodTo === undefined) return {};
  const { periodFrom, periodTo } = period;
  if (!periodFrom || !periodTo || !isDateKey(periodFrom) || !isDateKey(periodTo) || periodFrom > periodTo) {
    throw new BadRequestException('Укажите корректный период объединения — дату начала и окончания.');
  }
  // Invoice periods use UTC calendar dates, including a 23:59:59.999 end of day.
  return {
    periodFrom: { gte: new Date(`${periodFrom}T00:00:00.000Z`) },
    periodTo: { lte: new Date(`${periodTo}T23:59:59.999Z`) },
  };
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function invoiceWithinMergePeriod(
  invoice: { periodFrom: Date; periodTo: Date },
  range: ReturnType<typeof billingMergePeriodWhere>,
) {
  return (!range.periodFrom || invoice.periodFrom >= range.periodFrom.gte) &&
    (!range.periodTo || invoice.periodTo <= range.periodTo.lte);
}
