import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MobileDeviceDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  fcmToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}
