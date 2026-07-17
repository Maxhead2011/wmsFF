import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PickWaveBalanceAllocationDto {
  @IsString()
  requestId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsBoolean()
  needsRelabel?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetBarcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class PickWaveBalanceDecisionDto {
  @IsString()
  lineId!: string;

  @IsInt()
  @Min(0)
  keepQuantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PickWaveBalanceAllocationDto)
  allocations!: PickWaveBalanceAllocationDto[];
}

export class UpdatePickWaveBalanceReviewDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => PickWaveBalanceDecisionDto)
  decisions!: PickWaveBalanceDecisionDto[];
}
