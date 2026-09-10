import { BillingInvoiceStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { BILLING_CATEGORIES, type BillingServiceCategory } from '../billing-period-policy';

export class ListBillingInvoicesDto {
  // ADDED: the same stable category policy is used by the registry and generation preview.
  @IsOptional()
  @IsIn(BILLING_CATEGORIES)
  serviceCategory?: BillingServiceCategory;
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsEnum(BillingInvoiceStatus)
  status?: BillingInvoiceStatus;

  @IsOptional()
  @IsDateString()
  periodFrom?: string;

  @IsOptional()
  @IsDateString()
  periodTo?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unpaidOnly?: boolean;
}
