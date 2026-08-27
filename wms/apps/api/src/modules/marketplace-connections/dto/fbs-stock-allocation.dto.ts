import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class FbsStockAllocationShareDto {
  @IsString()
  @Length(1, 100)
  warehouseId!: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  warehouseName?: string;

  @IsInt()
  @Min(0)
  @Max(100)
  percent!: number;

  @IsBoolean()
  isPrimary!: boolean;
}

export class UpdateFbsStockAllocationDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  @IsString()
  @Length(1, 100)
  connectionId!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(0)
  @Max(1000)
  lowStockThreshold = 10;

  @IsInt()
  @Min(7)
  @Max(90)
  recommendationDays = 30;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FbsStockAllocationShareDto)
  shares!: FbsStockAllocationShareDto[];
}

export class CreateFbsStockIntegrationKeyDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  @IsString()
  @Length(1, 100)
  name!: string;
}

export class SyncFbsStockAllocationDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  @IsString()
  @Length(1, 100)
  connectionId!: string;
}

export class ExternalFbsStockAllocationDto {
  @IsString()
  @Length(1, 100)
  connectionId!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(0)
  @Max(1000)
  lowStockThreshold = 10;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  externalReference?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FbsStockAllocationShareDto)
  shares!: FbsStockAllocationShareDto[];
}

export class ExternalFbsStockItemDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  skuId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  barcode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  article?: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  requestedAmount!: number;
}

export class ExternalFbsStocksDto {
  @IsString()
  @Length(1, 100)
  connectionId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  externalReference?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ExternalFbsStockItemDto)
  items!: ExternalFbsStockItemDto[];
}
