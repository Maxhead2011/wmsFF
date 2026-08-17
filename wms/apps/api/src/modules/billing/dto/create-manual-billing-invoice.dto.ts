import { BillingPriceTaxMode, BillingUnit } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateManualBillingInvoiceLineDto {
  @IsOptional()
  @IsString()
  invoiceItemId?: string;

  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(BillingUnit)
  unit?: BillingUnit;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPriceRub?: number;

  @IsOptional()
  @IsEnum(BillingPriceTaxMode)
  taxMode?: BillingPriceTaxMode;

  @IsOptional()
  @IsDateString()
  serviceDate?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class CreateManualBillingInvoiceDto {
  @IsString()
  clientId!: string;

  @IsDateString()
  periodFrom!: string;

  @IsDateString()
  periodTo!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsUUID('4')
  paymentBankAccountId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateManualBillingInvoiceLineDto)
  rows!: CreateManualBillingInvoiceLineDto[];

  @IsOptional()
  @IsString()
  comment?: string;
}
