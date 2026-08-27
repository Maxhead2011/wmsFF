import { MarketplaceType } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';

export class UpsertDbsIntegrationDto {
  @IsString()
  clientId!: string;

  @IsEnum(MarketplaceType)
  marketplace!: MarketplaceType;

  @IsString()
  @Length(2, 180)
  senderName!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(2, 160)
  contactName?: string;

  @IsString()
  @Length(5, 40)
  phone!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsEmail()
  @Length(3, 180)
  email?: string;

  @IsString()
  @Length(2, 120)
  city!: string;

  @IsString()
  @Length(5, 500)
  address!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(3, 20)
  postalCode?: string;

  @IsString()
  @Length(2, 80)
  deliveryProvider!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(2, 160)
  deliveryServiceName?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(8, 500)
  deliveryApiUrl?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(1, 180)
  deliveryAccountId?: string;

  @IsString()
  @Length(8, 4000)
  deliveryApiKey!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(4, 4000)
  deliveryApiSecret?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
