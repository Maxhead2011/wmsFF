import { InventoryLineDecision, InventorySessionType } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

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
  @MaxLength(14, { message: 'В поле ШК товара отсканирован КИЗ. При инвентаризации сканируйте только ШК товара.' })
  barcode!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  kiz?: string;

  @IsOptional()
  @IsBoolean()
  requireKiz?: boolean;

  // ADDED: opt-in physical barcode/KIZ counting; legacy barcode-only clients stay unchanged.
  @IsOptional()
  @IsBoolean()
  captureKiz?: boolean;
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

export class ResolveInventoryBoxDto {
  @IsIn([InventoryResolutionAction.APPLY_ACTUAL, InventoryResolutionAction.ACCEPT_AS_IS])
  action!: InventoryResolutionAction.APPLY_ACTUAL | InventoryResolutionAction.ACCEPT_AS_IS;

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
