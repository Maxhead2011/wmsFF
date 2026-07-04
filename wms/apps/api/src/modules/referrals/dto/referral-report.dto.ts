import { IsOptional, IsString } from 'class-validator';

export class ReferralReportDto {
  @IsOptional()
  @IsString()
  periodFrom?: string;

  @IsOptional()
  @IsString()
  periodTo?: string;
}
