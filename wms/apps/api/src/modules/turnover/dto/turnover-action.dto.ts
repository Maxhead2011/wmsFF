import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';

export enum TurnoverActionKind {
  ADD = 'ADD',
  WRITE_OFF = 'WRITE_OFF',
  TRANSFER = 'TRANSFER',
  UTILIZE = 'UTILIZE',
  HOLD = 'HOLD',
}

export class TurnoverActionDto {
  @IsString()
  clientId!: string;

  @ValidateIf((dto: TurnoverActionDto) => !dto.barcode)
  @IsString()
  skuId?: string;

  @ValidateIf((dto: TurnoverActionDto) => !dto.skuId)
  @IsString()
  barcode?: string;

  @IsEnum(TurnoverActionKind)
  action!: TurnoverActionKind;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  sourceBoxCode?: string;

  @IsOptional()
  @IsString()
  targetBoxCode?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  kiz?: string;

  @IsOptional()
  @IsString()
  photoFileName?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
