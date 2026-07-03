import { ClientRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { PackageClientRequestPlaceDto } from '../../stock/dto/fulfill-client-request.dto';

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
  @Min(1)
  packedUnits?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageClientRequestPlaceDto)
  packages?: PackageClientRequestPlaceDto[];
}
