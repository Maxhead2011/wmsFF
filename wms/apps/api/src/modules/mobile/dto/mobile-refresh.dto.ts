import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class MobileRefreshDto {
  @IsString()
  @MinLength(20)
  @MaxLength(300)
  refreshToken!: string;
}

export class MobileLogoutDto {
  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}
