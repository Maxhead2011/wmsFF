import { ClientRequestStatus, ClientRequestType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class ListClientRequestsDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsEnum(ClientRequestStatus)
  status?: ClientRequestStatus;

  @IsOptional()
  @IsEnum(ClientRequestType)
  type?: ClientRequestType;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  archive?: boolean;

  @IsOptional()
  @IsString()
  boxCode?: string;
}
