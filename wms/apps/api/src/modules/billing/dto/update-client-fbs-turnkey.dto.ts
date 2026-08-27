import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ClientFbsPrimaryServiceDto {
  @IsString()
  serviceId!: string;

  @IsNumber()
  @Min(0.001)
  @Max(1000)
  quantityMultiplier!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  matchKeywords?: string;
}

export class UpdateClientFbsTurnkeyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  unitPriceRub!: number;

  @IsBoolean()
  fixedPlusLogisticsEnabled!: boolean;

  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  fixedPlusLogisticsUnitPriceRub!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  fixedPlusLogisticsDestination!: string;

  @IsOptional()
  @IsBoolean()
  tieredLogisticsEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  logisticsFreeItemsLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  logisticsCubicMeterLiters?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  logisticsCubicMeterPriceRub?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  logisticsPalletPriceRub?: number;

  @IsOptional()
  @IsBoolean()
  primaryProcessingEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  primaryWhiteUnitPriceRub?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  primaryGrayUnitPriceRub?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  primaryReturnUnitPriceRub?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique((service: ClientFbsPrimaryServiceDto) => service.serviceId)
  @ValidateNested({ each: true })
  @Type(() => ClientFbsPrimaryServiceDto)
  primaryServices?: ClientFbsPrimaryServiceDto[];
}
