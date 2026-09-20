import { Equals, IsString, Length, Matches } from 'class-validator';

export class PreviewSizeSubstitutionDto {
  @IsString() @Length(1, 100) clientId!: string;
  @IsString() @Matches(/^\d{1,20}$/) orderId!: string;
}
export class CreateSizeSubstitutionDto extends PreviewSizeSubstitutionDto {
  @IsString() @Length(1, 100) taskId!: string;
  @IsString() @Length(1, 100) sourceSkuId!: string;
  @IsString() @Length(64, 64) previewToken!: string;
  @Equals(true) confirmRelabel!: boolean;
}
