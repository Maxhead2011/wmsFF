import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsString, IsUUID, Length, Max, Min, ValidateIf } from 'class-validator';

export class BulkUpdateSkuVolumeDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  // FIX: search can replace the range; the service validates the complete selection.
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  sourceVolumeFrom?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  sourceVolumeTo?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 200)
  search?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  skuIds!: string[];

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  newVolumeLiters!: number;
}
