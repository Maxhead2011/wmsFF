import { UserStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Length, ValidateIf } from 'class-validator';

export class UpdateUserProfileDto {
  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(1, 200)
  email?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Length(1, 200)
  password?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsBoolean()
  analyticsEnabled?: boolean;
}
