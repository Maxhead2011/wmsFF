import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum FbsSyncConflictResolutionAction {
  RETURN_TO_STOCK = 'RETURN_TO_STOCK',
  MANAGER_CONFIRMED = 'MANAGER_CONFIRMED',
}

export class ResolveFbsSyncConflictDto {
  @IsEnum(FbsSyncConflictResolutionAction)
  action!: FbsSyncConflictResolutionAction;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
