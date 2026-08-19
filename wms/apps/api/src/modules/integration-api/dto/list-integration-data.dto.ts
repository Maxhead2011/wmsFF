import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ClientRequestStatus, StockStatus } from '@prisma/client';

export class ListIntegrationDataDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ description: 'Вернуть записи, обновлённые после указанного момента.' })
  @IsOptional()
  @IsDateString()
  updatedSince?: string;

  @ApiPropertyOptional({ description: 'Точный UUID последней записи предыдущей страницы.' })
  @IsOptional()
  @IsString()
  afterId?: string;
}

export class ListIntegrationStocksDto extends ListIntegrationDataDto {
  @ApiPropertyOptional({ enum: StockStatus })
  @IsOptional()
  @IsEnum(StockStatus)
  status?: StockStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  barcode?: string;
}

export class ListIntegrationRequestsDto extends ListIntegrationDataDto {
  @ApiPropertyOptional({ enum: ClientRequestStatus })
  @IsOptional()
  @IsEnum(ClientRequestStatus)
  status?: ClientRequestStatus;
}
