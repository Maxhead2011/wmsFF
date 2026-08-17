import { ClientRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PackageClientRequestPlaceDto } from '../../stock/dto/fulfill-client-request.dto';

export class ClientRequestPhysicalStockSourceDto {
  @IsString()
  requestItemId!: string;

  @IsOptional()
  @IsString()
  boxCode?: string;

  @IsOptional()
  @IsBoolean()
  noBox?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class UpdateClientRequestStatusDto {
  @IsEnum(ClientRequestStatus)
  status!: ClientRequestStatus;

  @IsOptional()
  @IsString()
  managerComment?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  boxes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pallets?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  packedUnits?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageClientRequestPlaceDto)
  packages?: PackageClientRequestPlaceDto[];

  /** Явное решение менеджера пропустить ограничение веса упаковочного места. */
  @IsOptional()
  @IsBoolean()
  allowOverweightPackages?: boolean;

  /**
   * Фактические источники указываются менеджером только после неудачного
   * штатного закрытия. Можно подтвердить физический короб либо отсутствие
   * короба; складская операция зафиксирует расхождение отдельным движением.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ClientRequestPhysicalStockSourceDto)
  stockSources?: ClientRequestPhysicalStockSourceDto[];
}
