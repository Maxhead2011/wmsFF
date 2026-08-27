import { MarketplaceType } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Length, ValidateIf } from 'class-validator';

export class UpsertMarketplaceConnectionDto {
  @IsString()
  clientId!: string;

  @IsEnum(MarketplaceType)
  marketplace!: MarketplaceType;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(2, 120)
  accountName?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(2, 120)
  sellerId?: string;

  @IsString()
  @Length(8, 4000)
  apiKey!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(1, 500)
  comment?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  fbsExecutionWarehouseId?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  fbsDropoffWarehouseId?: string;

  @IsOptional()
  @IsBoolean()
  fbsAutoRouteNewWarehouses?: boolean;
}
