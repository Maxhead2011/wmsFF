import { InventoryLineDecision, InventorySessionType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export enum InventoryResolutionAction {
  APPLY_ACTUAL = 'APPLY_ACTUAL',
  DELETE_FROM_BOX = 'DELETE_FROM_BOX',
  ACCEPT_AS_IS = 'ACCEPT_AS_IS',
  LEAVE_FOR_LATER = 'LEAVE_FOR_LATER',
}

export class StartInventoryDto {
  @IsEnum(InventorySessionType)
  type!: InventorySessionType;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class OpenInventoryBoxDto {
  @IsString()
  @MaxLength(160)
  boxCode!: string;
}

export class CountInventoryItemDto {
  @IsString()
  @MaxLength(220)
  barcode!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class SetInventoryCountDto {
  @IsUUID()
  lineId!: string;

  @IsInt()
  @Min(0)
  countedQuantity!: number;
}

export class InventoryDecisionDto {
  @IsOptional()
  @IsEnum(InventoryLineDecision)
  decision?: InventoryLineDecision;

  @IsOptional()
  @IsEnum(InventoryResolutionAction)
  action?: InventoryResolutionAction;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class CompleteInventoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
