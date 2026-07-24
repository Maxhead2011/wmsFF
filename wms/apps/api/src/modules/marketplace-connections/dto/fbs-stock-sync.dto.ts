import { IsString, Length } from 'class-validator';

export class FbsStockSyncDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  @IsString()
  @Length(1, 100)
  connectionId!: string;

  @IsString()
  @Length(1, 100)
  warehouseId!: string;
}
