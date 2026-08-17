import { IsArray, IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateBillingInvoiceDto {
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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  chargeIds?: string[];

  @IsOptional()
  @IsString()
  comment?: string;
}
