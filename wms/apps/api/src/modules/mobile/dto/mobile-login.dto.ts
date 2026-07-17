import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class MobileLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  login!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  installationId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}
