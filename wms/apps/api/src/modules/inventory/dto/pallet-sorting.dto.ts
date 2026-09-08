import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class StartPalletSortingDto {
  @IsUUID() id!: string;
  @IsString() @MaxLength(160) code!: string;
}

export class PalletSortingActionDto {
  @IsUUID() operationId!: string;
  @IsInt() @Min(1) version!: number;
  @IsIn(['SCAN_SOURCE', 'ARCHIVE_MISSING', 'BEGIN_FORMING', 'OPEN_TARGET', 'MOVE', 'CLOSE_TARGET', 'COMPLETE'])
  action!: string;
  @IsOptional() @IsString() @MaxLength(160) code?: string;
  @IsOptional() @IsString() @MaxLength(160) sourceBoxCode?: string;
  @IsOptional() @IsString() @MaxLength(160) palletCode?: string;
  @IsOptional() @IsString() @MaxLength(32) barcode?: string;
  @IsOptional() @IsString() @MaxLength(300) kiz?: string;
  @IsOptional() @IsString() @MaxLength(64) fingerprint?: string;
  @IsOptional() @IsBoolean() confirmWriteOff?: boolean;
  // ADDED: separate consent for a +1 found-unit receipt, not a shortage write-off.
  @IsOptional() @IsBoolean() confirmRestore?: boolean;
  @IsOptional() @IsString() @MaxLength(64) restoreFingerprint?: string;
}
