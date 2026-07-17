import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CreateSkuDto } from './create-sku.dto';

export class UpdateSkuDto extends PartialType(CreateSkuDto) {
  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  weightGrams?: number;

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
