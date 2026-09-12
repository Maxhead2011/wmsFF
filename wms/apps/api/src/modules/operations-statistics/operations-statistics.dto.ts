import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
export class OperationsStatisticsDto {
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(['WILDBERRIES', 'OZON']) marketplace?: 'WILDBERRIES' | 'OZON';
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo!: string;
}
