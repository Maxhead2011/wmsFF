import { IsOptional, IsString, Length } from 'class-validator';

export class LoginTsdDeviceDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  login?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  password?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  installationCode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  secret?: string;
}
