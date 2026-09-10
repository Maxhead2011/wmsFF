import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsIn, IsString, Length, ValidateNested } from 'class-validator';
import type { ReshipmentMode } from '../fbs-reshipment';

export class CheckFbsReshipmentDto {
  @IsString() @Length(1, 100) clientId!: string;
}
class ReshipmentOrderDto {
  @IsString() @Length(1, 100) id!: string;
  @IsString() @Length(1, 100) connectionId!: string;
}
export class PreviewFbsReshipmentDto extends CheckFbsReshipmentDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => ReshipmentOrderDto) orders!: ReshipmentOrderDto[];
  @IsIn(['SAME_ITEM', 'NEW_ITEM']) mode!: ReshipmentMode;
}
export class CreateFbsReshipmentDto extends PreviewFbsReshipmentDto {
  @IsString() @Length(64, 64) previewToken!: string;
  // FIX: confirms the preview's mode; NEW_ITEM explicitly means extra consumption.
  @Equals(true) confirm!: boolean;
}
export class ResumeFbsReshipmentDto extends CheckFbsReshipmentDto {
  @IsString() @Length(1, 100) runId!: string;
}
