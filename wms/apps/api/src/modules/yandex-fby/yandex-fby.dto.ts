import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
export class FbyItemDto {
  @IsString() @MaxLength(150) barcode!: string;
  @IsInt() @Min(1) quantity!: number;
}
export class FbyMappingDto {
  @IsString() @MaxLength(255) offerId!: string;
  @IsString() @MaxLength(150) barcode!: string;
}
export class FbyPreviewDto {
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsString() @MaxLength(2000) reference?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => FbyItemDto) items?: FbyItemDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => FbyMappingDto) mappings?: FbyMappingDto[];
  @IsOptional() @IsString() @MaxLength(250) destination?: string;
  @IsOptional() @IsString() @MaxLength(250) title?: string;
}
export class FbyCreateDto extends FbyPreviewDto {
  @IsUUID() idempotencyKey!: string;
  @IsString() @MaxLength(64) previewHash!: string;
}
export class FbyBindDto extends FbyPreviewDto {
  @IsString() @MaxLength(64) previewHash!: string;
}
