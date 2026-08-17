import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class MergeFbsLogisticsDayDto {
  @IsDateString()
  date!: string;

  @IsNumber()
  @Min(0)
  amountRub!: number;
}

export class MergeFbsInvoicesDto {
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  invoiceIds?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MergeFbsLogisticsDayDto)
  logisticsDays!: MergeFbsLogisticsDayDto[];

  @IsOptional()
  @IsBoolean()
  includePrimaryProcessing?: boolean;

  @IsOptional()
  @IsBoolean()
  aggregateSameItems?: boolean;

  @IsOptional()
  @IsBoolean()
  excludeZeroTotalItems?: boolean;
}
