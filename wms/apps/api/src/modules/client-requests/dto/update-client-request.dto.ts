import { ClientRequestPriority, ClientRequestType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CreateClientRequestItemDto } from './create-client-request.dto';

export class UpdateClientRequestDto {
  @IsOptional()
  @IsEnum(ClientRequestType)
  type?: ClientRequestType;

  @IsOptional()
  @IsEnum(ClientRequestPriority)
  priority?: ClientRequestPriority;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  destinationCity?: string;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsDateString()
  desiredDate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateClientRequestItemDto)
  items?: CreateClientRequestItemDto[];
}
