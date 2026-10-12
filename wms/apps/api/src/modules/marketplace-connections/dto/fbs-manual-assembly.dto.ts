import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, IsUUID, Matches, ValidateNested } from 'class-validator';
export class PreviewFbsManualAssemblyDto {
  @IsUUID() clientId!: string;
  @IsUUID() connectionId!: string;
  @IsUUID() warehouseId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) @Matches(/^[1-9]\d{0,15}$/, { each: true }) orderIds!: string[];
}
class ManualAssemblyChoiceDto {
  @IsString() @Matches(/^[1-9]\d{0,15}$/) orderId!: string;
  @IsUUID() boxId!: string;
}
export class CreateFbsManualAssemblyDto {
  @IsUUID() token!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ManualAssemblyChoiceDto) choices!: ManualAssemblyChoiceDto[];
}
