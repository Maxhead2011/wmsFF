import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum FbsSyncConflictResolutionAction {
  RETURN_TO_STOCK = 'RETURN_TO_STOCK',
  MANAGER_CONFIRMED = 'MANAGER_CONFIRMED',
}

// FIX: an explicit physical outcome never implies receipt into available stock.
export enum FbsPickedDisposition {
  SHIP_WITH_WB_LABEL = 'SHIP_WITH_WB_LABEL',
  AWAIT_RETURN_RECEIPT = 'AWAIT_RETURN_RECEIPT',
}

export class ResolveFbsSyncConflictDto {
  @IsEnum(FbsSyncConflictResolutionAction)
  action!: FbsSyncConflictResolutionAction;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @IsOptional()
  @IsEnum(FbsPickedDisposition)
  pickedDisposition?: FbsPickedDisposition;

  // FIX: scans are required by the service only for physically picked returns in our WMS.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  returnBoxCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  returnBarcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  returnKiz?: string;
}
