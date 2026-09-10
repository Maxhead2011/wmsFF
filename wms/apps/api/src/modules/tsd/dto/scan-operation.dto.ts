import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';

export class ScanOperationDto {
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @IsString()
  @IsNotEmpty()
  operationKey!: string;

  // FIX: closing a received box is a separate, idempotent outbox operation.
  @IsIn(['receipt_scan', 'receipt_close', 'move_scan', 'inventory_scan', 'assembly_stage'])
  operationType!: 'receipt_scan' | 'receipt_close' | 'move_scan' | 'inventory_scan' | 'assembly_stage';

  @IsObject()
  payload!: Record<string, unknown>;
}

export class SyncTsdOperationsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScanOperationDto)
  operations!: ScanOperationDto[];

  @IsOptional()
  @IsString()
  deviceClock?: string;
}
