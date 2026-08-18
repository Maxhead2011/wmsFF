import { KizCirculationOperation, MarketplaceType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpsertKizTrueApiConnectionDto {
  @Transform(trimmed)
  @Matches(/^\d{10}(?:\d{2})?$/)
  inn!: string;

  @IsOptional()
  @Transform(trimmed)
  @Matches(/^\d{9}$/)
  kpp?: string;

  @IsOptional()
  @Transform(trimmed)
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  fiasId?: string;

  @Transform(trimmed)
  @Matches(/^[a-z][a-z0-9_-]{1,49}$/)
  productGroup!: string;

  @Transform(trimmed)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  apiBaseUrl!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(12_000)
  apiToken?: string;

  @IsOptional()
  @IsDateString()
  tokenExpiresAt?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(255)
  certificateSubject?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(128)
  certificateThumbprint?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class KizCirculationClientDto {
  @Transform(trimmed)
  @IsString()
  @Length(1, 80)
  clientId!: string;
}

export class CheckKizCirculationItemsDto extends KizCirculationClientDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  itemIds!: string[];
}

export class UpdateKizCirculationItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productCostKopecks?: number;

  @IsOptional()
  @Transform(trimmed)
  @Matches(/^[a-z][a-z0-9_-]{1,49}$/)
  productGroup?: string;

  @IsOptional()
  @IsBoolean()
  excluded?: boolean;
}

export class ImportKizCirculationItemsDto extends KizCirculationClientDto {
  @IsEnum(KizCirculationOperation)
  operation!: KizCirculationOperation;

  @IsOptional()
  @IsEnum(MarketplaceType)
  marketplace?: MarketplaceType;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  codes!: string[];

  @IsOptional()
  @IsDateString()
  eventAt?: string;
}

export class CreateKizCirculationBatchDto extends KizCirculationClientDto {
  @IsEnum(KizCirculationOperation)
  operation!: KizCirculationOperation;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30_000)
  @IsString({ each: true })
  itemIds!: string[];

  @IsDateString()
  actionDate!: string;

  @Transform(trimmed)
  @IsString()
  @Length(1, 60)
  documentType!: string;

  @Transform(trimmed)
  @IsString()
  @Length(1, 255)
  documentNumber!: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(1, 255)
  primaryDocumentCustomName?: string;

  @IsOptional()
  @IsBoolean()
  paid?: boolean;
}

export class SetKizCirculationSignatureDto {
  @Transform(trimmed)
  @IsString()
  @Length(16, 4_000_000)
  signature!: string;
}

export class SubmitKizCirculationBatchDto {
  @Transform(trimmed)
  @IsString()
  confirmation!: string;
}
