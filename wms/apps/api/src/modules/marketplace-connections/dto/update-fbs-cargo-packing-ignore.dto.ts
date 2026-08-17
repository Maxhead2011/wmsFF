import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateFbsCargoPackingIgnoreDto {
  @IsBoolean()
  ignored!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
