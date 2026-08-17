import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateSkuDto {
  @IsString()
  clientId!: string;

  @IsString()
  @Length(1, 100)
  internalSku!: string;

  @IsOptional()
  @IsString()
  clientSku?: string;

  @IsOptional()
  @IsString()
  article?: string;

  @IsString()
  @Length(1, 300)
  name!: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  photoUrls?: string[];

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  weightGrams?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  lengthCm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  widthCm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  heightCm?: number;

  @IsOptional()
  @IsBoolean()
  needsChestnyZnak?: boolean;

  @IsOptional()
  @IsBoolean()
  isUnmarked?: boolean;

  @IsOptional()
  @IsBoolean()
  needsLabel?: boolean;

  @IsOptional()
  @IsBoolean()
  needsRelabel?: boolean;
}
