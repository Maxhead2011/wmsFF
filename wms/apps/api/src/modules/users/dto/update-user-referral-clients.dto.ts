import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class UserReferralClientAssignmentDto {
  @IsString()
  clientId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  percent!: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 6, 12, 24])
  termMonths?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUserReferralClientsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserReferralClientAssignmentDto)
  assignments!: UserReferralClientAssignmentDto[];
}
