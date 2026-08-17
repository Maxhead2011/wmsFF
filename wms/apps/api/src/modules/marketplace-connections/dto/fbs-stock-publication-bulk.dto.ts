import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

/**
 * Changes the FBS sale status for several products at once.
 *
 * The status is stored per Wildberries connection and warehouse (in
 * FbsStockPublication), so one product can be sold from one FBS warehouse
 * while being stopped in another one.
 */
export class FbsStockPublicationBulkDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  @IsString()
  @Length(1, 100)
  connectionId!: string;

  @IsString()
  @Length(1, 100)
  warehouseId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  skuIds!: string[];

  @IsBoolean()
  enabled!: boolean;

  /** One requested WB amount applied to every selected SKU; null removes a cap. */
  @IsOptional()
  @Transform(({ value }) => (value == null ? value : Number(value)))
  @IsInt()
  @Min(0)
  saleLimit?: number | null;
}
