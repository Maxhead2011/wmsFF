import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class AnalyticsDashboardQueryDto {
  @IsUUID()
  clientId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @IsIn(['all', 'deficient', 'actual', 'balanced', 'nonActual', 'nonLiquid', 'invalidData', 'outOfStock'])
  availability?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(500)
  limit = 100;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  offset = 0;
}

export class AnalyticsSyncDto {
  @IsUUID()
  clientId!: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @IsIn([7, 30, 90])
  periodDays = 30;
}
