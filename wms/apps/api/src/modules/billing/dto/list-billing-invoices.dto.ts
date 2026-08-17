import { BillingInvoiceStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class ListBillingInvoicesDto {
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
