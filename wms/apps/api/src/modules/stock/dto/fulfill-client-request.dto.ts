import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class PackageClientRequestItemDto {
  @IsString()
  requestItemId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class PackageClientRequestPlaceDto {
  @IsOptional()
  @IsString()
  packageCode?: string;

  @IsOptional()
  @IsString()
  packageType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  weightGrams?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lengthCm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  widthCm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  heightCm?: number;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageClientRequestItemDto)
  items!: PackageClientRequestItemDto[];
}

export class FulfillClientRequestDto {
  @IsString()
  requestId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  boxes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pallets?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  packedUnits?: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageClientRequestPlaceDto)
  packages?: PackageClientRequestPlaceDto[];

  @IsOptional()
  @IsBoolean()
  allowOverweightPackages?: boolean;
}
