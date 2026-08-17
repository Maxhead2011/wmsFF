import { StockStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';

export class TransferBetweenBoxesDto {
  @IsString()
  clientId!: string;

  @ValidateIf((dto: TransferBetweenBoxesDto) => !dto.barcode)
  @IsString()
  skuId?: string;

  @ValidateIf((dto: TransferBetweenBoxesDto) => !dto.skuId)
  @IsString()
  barcode?: string;

  @IsString()
  fromBoxCode!: string;

  @IsString()
  toBoxCode!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsEnum(StockStatus)
  status?: StockStatus;

  @IsString()
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
