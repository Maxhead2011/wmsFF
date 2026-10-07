import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
export class BillingCloseQuery {
  @IsUUID() clientId!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) periodFrom!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) periodTo!: string;
}
export class CloseBillingPeriodDto extends BillingCloseQuery {
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) previewHash!: string;
}
export class PreviewInvoiceCorrectionDto {
  @IsUUID() invoiceId!: string;
  @IsString() @Matches(/^-?\d+(?:\.\d{1,2})?$/) amountRub!: string;
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
  @IsOptional() @IsIn(['ADJUSTMENT', 'LATE_WORK']) kind?: 'ADJUSTMENT' | 'LATE_WORK';
}
export class CreateInvoiceCorrectionDto extends PreviewInvoiceCorrectionDto {
  @IsUUID() operationKey!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) previewHash!: string;
}
