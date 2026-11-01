import { IsBoolean } from 'class-validator';
import { ClientRequestPriority, ClientRequestType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateClientRequestItemDto {
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

export class FboExcelDecisionDto {
  @IsString()
  barcode!: string;
  @IsInt() @Min(1)
  originalQuantity!: number;
  @IsInt() @Min(0)
  finalQuantity!: number;
}

export class CreateClientRequestDto {
  @IsOptional() @IsArray() @ArrayMaxSize(1000)
  @ValidateNested({each:true}) @Type(()=>FboExcelDecisionDto)
  fboDecisions?: FboExcelDecisionDto[];

  @IsOptional()
  @IsBoolean()
  fboExcel?: boolean;
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsEnum(ClientRequestType)
  type!: ClientRequestType;

  @IsOptional()
  @IsEnum(ClientRequestPriority)
  priority?: ClientRequestPriority;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsString()
  destinationCity!: string;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsDateString()
  desiredDate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateClientRequestItemDto)
  items?: CreateClientRequestItemDto[];
}
