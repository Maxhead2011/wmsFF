import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SearchSkuCollectionDto {
  @IsUUID()
  clientId!: string;

  @IsString()
  @MaxLength(160)
  search!: string;
}

export class CreateSkuCollectionDto {
  @IsUUID()
  clientId!: string;

  @IsUUID()
  skuId!: string;
}

export class ScanSkuCollectionPickDto {
  @IsString()
  @MaxLength(160)
  sourceBoxCode!: string;

  @IsString()
  @MaxLength(160)
  barcode!: string;

  @IsString()
  @MaxLength(512)
  kiz!: string;
}

export class ScanSkuCollectionReceiptDto {
  @IsString()
  @MaxLength(160)
  targetBoxCode!: string;

  @IsString()
  @MaxLength(160)
  barcode!: string;

  @IsString()
  @MaxLength(512)
  kiz!: string;
}

// FIX: the source inventory and physical pair are required before a storage move.
export class CheckSkuSortingDto extends ScanSkuCollectionPickDto {
  @IsUUID()
  auditBoxId!: string;
}

export class MoveSkuSortingDto extends CheckSkuSortingDto {
  @IsString()
  @MaxLength(160)
  targetBoxCode!: string;
}

export class OpenSkuSortingSourceDto {
  @IsString()
  @MaxLength(160)
  sourceBoxCode!: string;

  @IsOptional()
  @IsBoolean()
  recount?: boolean;
}

export class ReadySkuSortingSourceDto extends OpenSkuSortingSourceDto {
  @IsUUID()
  auditBoxId!: string;
}
