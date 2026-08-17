import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const FBS_WAREHOUSE_ROUTE_MODES = [
  'DEFAULT',
  'CENTRAL',
  'BRANCH',
  'EXCLUDED',
] as const;

export type FbsWarehouseRouteMode =
  (typeof FBS_WAREHOUSE_ROUTE_MODES)[number];

export class UpdateFbsWarehouseRouteItemDto {
  @IsString()
  @Length(1, 120)
  marketplaceWarehouseId!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(1, 240)
  marketplaceWarehouseName?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(1, 120)
  officeId?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(1, 240)
  officeName?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(1, 240)
  officeCity?: string;

  @IsIn(FBS_WAREHOUSE_ROUTE_MODES)
  mode!: FbsWarehouseRouteMode;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  executionWarehouseId?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  dropoffWarehouseId?: string;
}

export class UpdateFbsWarehouseRoutesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => UpdateFbsWarehouseRouteItemDto)
  items!: UpdateFbsWarehouseRouteItemDto[];
}
