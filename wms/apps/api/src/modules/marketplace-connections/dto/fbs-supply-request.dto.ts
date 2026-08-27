import { IsString, Length } from 'class-validator';

// ADDED: explicit payload for creating a WMS request by a known WB supply id.
export class FbsSupplyRequestDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  @IsString()
  @Length(1, 100)
  supplyId!: string;
}
