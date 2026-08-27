import { IsString, IsUUID, Length, Matches } from 'class-validator';

// ADDED: strict runtime validation for the manual WB supply reconciliation flow.
export class FbsSupplyReconciliationPreviewDto {
  @IsUUID()
  clientId!: string;

  @IsUUID()
  connectionId!: string;

  @IsString()
  @Length(1, 120)
  supplyId!: string;
}

export class ApplyFbsSupplyReconciliationDto extends FbsSupplyReconciliationPreviewDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/i, {
    message: 'fingerprint must be a 64-character SHA-256 value',
  })
  fingerprint!: string;
}
