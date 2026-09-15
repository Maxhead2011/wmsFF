import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsNotEmpty, IsString, IsUUID, ValidateIf } from 'class-validator';

// FIX: read-only preview accepts a bounded JSON selection instead of an oversized URL.
export class PreviewFbsInvoicesDto {
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  // Omitted means all eligible invoices; explicit empty/null must not widen selection.
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  invoiceIds?: string[];
}
