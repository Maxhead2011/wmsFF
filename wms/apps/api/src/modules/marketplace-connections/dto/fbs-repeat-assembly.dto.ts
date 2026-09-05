import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsOptional, IsString, Length, ValidateNested } from 'class-validator';

class RepeatAssemblyOrderDto {
  @IsString() @Length(1, 100) connectionId!: string;
  @IsString() @Length(1, 100) id!: string;
  // FIX: stale screens/retries must refer to the exact previous physical attempt.
  @IsOptional() @IsString() @Length(1, 100) assemblyId?: string;
}

export class PreviewFbsRepeatAssemblyDto {
  @IsString() @Length(1, 100) clientId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => RepeatAssemblyOrderDto)
  orders!: RepeatAssemblyOrderDto[];
}

export class CreateFbsRepeatAssemblyDto extends PreviewFbsRepeatAssemblyDto {
  @IsString() @Length(64, 64) previewToken!: string;
  @Equals(true, { message: 'Подтвердите дополнительное физическое списание товара.' })
  confirmAdditionalStockConsumption!: boolean;
}
