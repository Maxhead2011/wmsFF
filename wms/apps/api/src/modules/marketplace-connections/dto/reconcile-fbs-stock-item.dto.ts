import { IsString, Length } from 'class-validator';

export class ReconcileFbsStockItemDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  @IsString()
  @Length(1, 100)
  connectionId!: string;

  @IsString()
  @Length(1, 100)
  warehouseId!: string;

  @IsString()
  @Length(1, 100)
  skuId!: string;
}
