import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateFbsStockMonitorConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(86_400)
  allowedDelaySeconds!: number;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(3_600)
  retryIntervalSeconds!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxAttempts!: number;

  @IsIn(['ORDER_AND_STOCK_DELTA'])
  wbRule!: 'ORDER_AND_STOCK_DELTA';

  @IsIn(['ORDER_RESERVATION_OR_SELLABLE_DELTA'])
  wmsRule!: 'ORDER_RESERVATION_OR_SELLABLE_DELTA';
}

export class RefreshFbsStockMonitorDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  connectionId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eventIds?: string[];
}

// ADDED: confirmation requests carry a client-generated operation key so a
// repeated click or network retry cannot publish WB stock twice.
export class RepairFbsStockMonitorDto {
  @IsString()
  @MaxLength(160)
  idempotencyKey!: string;
}
