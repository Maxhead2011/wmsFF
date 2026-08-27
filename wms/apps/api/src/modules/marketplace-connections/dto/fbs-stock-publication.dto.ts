import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

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

  /**
   * Maximum quantity to expose on WB. Null (or an omitted value on a newly
   * created publication) means all currently sellable WMS stock.
  */
  @IsOptional()
  @Transform(({ value }) => (value == null ? value : Number(value)))
  @IsInt()
  @Min(0)
  saleLimit?: number | null;

  /**
   * Manual WB quantity for a product produced by relabeling. Null restores
   * ordinary automatic calculation from the target SKU's own stock only.
   */
  @IsOptional()
  @Transform(({ value }) => (value == null ? value : Number(value)))
  @IsInt()
  @Min(0)
  relabelManualAmount?: number | null;
}
