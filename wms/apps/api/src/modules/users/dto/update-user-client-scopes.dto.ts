import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';

export class UserClientScopeDto {
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsBoolean()
  canRead?: boolean;

  @IsOptional()
  @IsBoolean()
  canWrite?: boolean;
}

export class UpdateUserClientScopesDto {
  @IsOptional()
  @IsBoolean()
  allClients?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserClientScopeDto)
  scopes!: UserClientScopeDto[];
}
