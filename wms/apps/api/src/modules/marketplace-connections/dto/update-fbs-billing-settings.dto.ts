import { FbsDeliveryDestination } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

class FbsAdditionalServiceDto {
  @IsString()
  serviceId!: string;

  @IsNumber()
  @Min(0.001)
  @Max(1000)
  quantityMultiplier!: number;
}

export class UpdateFbsBillingSettingsDto {
  @IsEnum(FbsDeliveryDestination)
  defaultDeliveryDestination!: FbsDeliveryDestination;

  @IsNumber()
  @Min(0)
  pickupPointBasePriceRub!: number;

  @IsNumber()
  @Min(0)
  vnukovoBasePriceRub!: number;

  @IsInt()
  @Min(1)
  @Max(100000)
  baseIncludedItems!: number;

  @IsInt()
  @Min(1)
  @Max(100000)
  extraBlockItems!: number;

  @IsNumber()
  @Min(0)
  extraBlockPriceRub!: number;

  @IsInt()
  @Min(1)
  @Max(100000)
  boxCapacityItems!: number;

  @IsNumber()
  @Min(0)
  fbsProcessingPriceRub!: number;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== '')
  @IsString()
  boxFormationServiceId?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== '')
  @IsString()
  boxMaterialServiceId?: string | null;

  @IsBoolean()
  palletsEnabled!: boolean;

  @IsInt()
  @Min(1)
  @Max(100000)
  boxesPerPallet!: number;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== '')
  @IsString()
  palletServiceId?: string | null;

  @IsArray()
  @ArrayUnique((service: FbsAdditionalServiceDto) => service.serviceId)
  @ValidateNested({ each: true })
  @Type(() => FbsAdditionalServiceDto)
  additionalServices!: FbsAdditionalServiceDto[];
}
