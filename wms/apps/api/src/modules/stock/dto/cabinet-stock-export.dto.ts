import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsDefined, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

class ExportFilters {
  @IsString() @MaxLength(1000) search!: string;
  @IsIn(['skus', 'stock', 'requests', 'invoices']) section!: string;
  @IsIn(['all_filtered_rows']) scope!: string;
}
class ExportRow {
  @IsString() @MaxLength(500) barcode!: string;
  @IsOptional() @IsString() @MaxLength(4000) internalSku?: string;
  @IsString() @MaxLength(4000) name!: string;
  @IsOptional() @IsString() @MaxLength(500) status?: string;
  @IsOptional() @IsString() @MaxLength(4000) article?: string;
  @IsOptional() @IsString() @MaxLength(500) color?: string;
  @IsOptional() @IsString() @MaxLength(500) size?: string;
  @IsInt() @Min(1) @Max(1000000000) quantity!: number;
  @IsOptional() @IsDateString() updatedAt?: string;
}
// FIX: accept only the bounded exported snapshot, never actor/IP supplied by the browser.
export class CabinetStockExportDto {
  @IsString() @MaxLength(100) clientId!: string;
  @IsString() @MaxLength(255) fileName!: string;
  @IsDateString() generatedAt!: string;
  @IsDefined() @ValidateNested() @Type(() => ExportFilters) filters!: ExportFilters;
  @IsArray() @ArrayMaxSize(20000) @ValidateNested({ each: true }) @Type(() => ExportRow) rows!: ExportRow[];
}
