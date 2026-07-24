import { IsBoolean, IsString, Length } from 'class-validator';

export class FbsStockPublicationDto {
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

  @IsBoolean()
  enabled!: boolean;
}
