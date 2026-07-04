import { ClientRequestType } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class PreviewClientRequestAvailabilityItemDto {
  @IsOptional()
  @IsString()
  skuId?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class PreviewClientRequestAvailabilityDto {
  @IsString()
  clientId!: string;

  @IsEnum(ClientRequestType)
  type!: ClientRequestType;

  @IsOptional()
  @IsString()
  excludeRequestId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => PreviewClientRequestAvailabilityItemDto)
  items?: PreviewClientRequestAvailabilityItemDto[];
}
