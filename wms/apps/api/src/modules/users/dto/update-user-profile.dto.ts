import { UserStatus } from '@prisma/client';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

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
  // FIX: archival must go through the role-checked deletion endpoint.
  @IsIn([UserStatus.ACTIVE, UserStatus.BLOCKED])
  status?: UserStatus;

  @IsOptional()
  @IsBoolean()
  analyticsEnabled?: boolean;

  @IsOptional()
  @IsUUID()
  warehouseId?: string | null;
}
