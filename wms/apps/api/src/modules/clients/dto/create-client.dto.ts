import { ClientKind, ClientLogisticsInvoiceMode, ClientStockBalanceMode, ClientStorageBillingMode } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, Length, ValidateIf } from 'class-validator';

export class CreateClientDto {
  @IsEnum(ClientKind)
  clientKind!: ClientKind;

  @IsString()
  @Length(2, 200)
  name!: string;

  @IsString()
  @Length(2, 200)
  legalName!: string;

  @IsString()
  @Length(10, 12)
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
  actualAddress?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  telegramChatId?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsEmail()
  email?: string;

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
  @IsBoolean()
  storageAccountingEnabled?: boolean;

  @IsOptional()
  @IsEnum(ClientLogisticsInvoiceMode)
  logisticsInvoiceMode?: ClientLogisticsInvoiceMode;

  @IsOptional()
  @IsEnum(ClientStorageBillingMode)
  storageBillingMode?: ClientStorageBillingMode;

  @IsOptional()
  @IsBoolean()
  storesWithoutBoxes?: boolean;

  @IsOptional()
  @IsEnum(ClientStockBalanceMode)
  stockBalanceMode?: ClientStockBalanceMode;

  @IsOptional()
  @IsBoolean()
  onlineReceiptVisibleToClient?: boolean;

  @IsOptional()
  @IsBoolean()
  fbsCalculatorEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  relabelingEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  factoryEnabled?: boolean;

  @IsOptional()
  @IsString()
  factoryName?: string;

  @IsOptional()
  @IsString()
  factoryCode?: string;

  @IsOptional()
  @IsString()
  fulfillmentManagerUserId?: string;

  @IsOptional()
  @IsString()
  ownCompanyId?: string;
}
