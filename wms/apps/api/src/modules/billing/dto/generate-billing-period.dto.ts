import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { BILLING_CATEGORIES, type BillingServiceCategory } from '../billing-period-policy';

// ADDED: explicit calendar dates and bounded category selection; no client-supplied prices.
export class PreviewBillingPeriodDto {
  @IsOptional() @IsUUID() clientId?: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) periodFrom!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) periodTo!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ArrayUnique()
  @IsIn(BILLING_CATEGORIES.filter(c => c !== 'OTHER'), { each: true }) categories!: BillingServiceCategory[];
  @IsOptional() @IsBoolean() excludeLukin?: boolean;
}
export class GenerateBillingPeriodDto extends PreviewBillingPeriodDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) previewHash!: string;
}
