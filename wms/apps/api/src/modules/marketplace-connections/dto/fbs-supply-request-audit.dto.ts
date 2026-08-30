import { IsString, Length } from 'class-validator';

// ADDED: read-only WB supply/request audit for one accessible WMS client.
export class FbsSupplyRequestAuditDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;
}
