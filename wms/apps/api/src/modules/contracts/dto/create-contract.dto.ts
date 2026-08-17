import { IsDateString, IsOptional, IsString, IsUrl, IsUUID, Length, Matches } from 'class-validator';

export class CreateContractDto {
  @IsUUID()
  clientId!: string;

  @IsOptional()
  @IsDateString()
  contractDate?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  contractNumber?: string;

  @IsOptional()
  @IsUrl({ require_tld: true, require_protocol: true })
  @Length(8, 300)
  wmsUrl?: string;

  @IsString()
  @Length(1, 200)
  wmsLogin!: string;

  @IsString()
  @Length(1, 200)
  @Matches(/\S/, { message: 'Пароль WMS не может быть пустым.' })
  wmsPassword!: string;
}
