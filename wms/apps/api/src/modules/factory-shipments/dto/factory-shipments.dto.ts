import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class FactoryShipmentItemDto {
  @IsString() skuId!: string;
  @Type(() => Number) @IsInt() @Min(1) plannedQty!: number;
}

export class CreateFactoryShipmentDto {
  @IsString() clientId!: string;
  @IsString() title!: string;
  @IsOptional() @IsString() comment?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => FactoryShipmentItemDto)
  items!: FactoryShipmentItemDto[];
}

export class ScanFactoryShipmentDto {
  @IsString() barcode!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) quantity?: number;
  @IsOptional() @IsString() deviceId?: string;
}

export class ReconcileFactoryShipmentDto {
  @IsString() requestId!: string;
}
