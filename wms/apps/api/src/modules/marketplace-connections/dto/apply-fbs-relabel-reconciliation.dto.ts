import { IsOptional, IsString, Length } from 'class-validator';

export class ApplyFbsRelabelReconciliationDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  @IsString()
  @Length(1, 200)
  issueId!: string;

  @IsString()
  @Length(10, 40)
  dateFrom!: string;

  @IsString()
  @Length(10, 40)
  dateTo!: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  barcode?: string;
}
