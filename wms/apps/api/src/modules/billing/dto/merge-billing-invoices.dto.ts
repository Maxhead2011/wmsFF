import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';

import { BillingMergePeriodDto } from './billing-merge-period.dto';

export class MergeBillingInvoicesDto extends BillingMergePeriodDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  invoiceIds!: string[];

  @IsOptional()
  @IsBoolean()
  aggregateSameItems?: boolean;

  @IsOptional()
  @IsBoolean()
  excludeZeroTotalItems?: boolean;
}
