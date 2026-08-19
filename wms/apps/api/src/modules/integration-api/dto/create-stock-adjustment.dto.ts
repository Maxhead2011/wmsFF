import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class CreateIntegrationStockAdjustmentDto {
  @ApiPropertyOptional({ description: 'UUID SKU. Передайте skuId или barcode.' })
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional({ description: 'Штрихкод товара. Передайте skuId или barcode.' })
  @ValidateIf((dto: CreateIntegrationStockAdjustmentDto) => !dto.skuId)
  @IsString()
  @MaxLength(200)
  barcode?: string;

  @ApiProperty({ description: 'Фактический короб WMS.' })
  @IsString()
  @MaxLength(120)
  boxCode!: string;

  @ApiProperty({ minimum: 0, maximum: 1_000_000 })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  countedQuantity!: number;

  @ApiPropertyOptional({ enum: StockStatus, default: StockStatus.AVAILABLE })
  @IsOptional()
  @IsEnum(StockStatus)
  status?: StockStatus;

  @ApiProperty({ description: 'Уникальный ключ операции во внешней системе.' })
  @IsString()
  @MaxLength(180)
  idempotencyKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
