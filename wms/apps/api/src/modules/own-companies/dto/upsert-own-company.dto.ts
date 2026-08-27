import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

export class UpsertOwnCompanyBankAccountDto {
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @IsString()
  bankName!: string;

  @IsString()
  bankBik!: string;

  @IsOptional()
  @IsString()
  bankInn?: string;

  @IsOptional()
  @IsString()
  bankKpp?: string;

  @IsString()
  bankAccount!: string;

  @IsOptional()
  @IsString()
  correspondentAccount?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class UpsertOwnCompanyDto {
  @IsOptional()
  @IsUUID('4')
  warehouseId?: string | null;

  @IsString()
  shortName!: string;

  @IsString()
  fullName!: string;

  @IsString()
  inn!: string;

  @IsOptional()
  @IsString()
  kpp?: string;

  @IsOptional()
  @IsString()
  ogrn?: string;

  @IsOptional()
  @IsString()
  legalAddress?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankBik?: string;

  @IsOptional()
  @IsString()
  bankAccount?: string;

  @IsOptional()
  @IsString()
  correspondentAccount?: string;

  @IsOptional()
  @IsString()
  paymentCode?: string;

  @IsOptional()
  @IsString()
  paymentPurposeCode?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertOwnCompanyBankAccountDto)
  bankAccounts?: UpsertOwnCompanyBankAccountDto[];
}
