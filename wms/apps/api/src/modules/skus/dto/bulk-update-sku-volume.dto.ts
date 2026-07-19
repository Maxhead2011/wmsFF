import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class BulkUpdateSkuVolumeDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  sourceVolumeFrom!: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  sourceVolumeTo!: number;

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
