import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { lamodaResources, type LamodaResource } from './lamoda-client';
// FIX: DTO classes preserve ValidationPipe checks at runtime (interfaces do not).
export class LamodaCreateAccountDto {
  @IsString() @IsNotEmpty() @MaxLength(200) clientId!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) sellerId!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) oauthClientId!: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) secret!: string;
  @IsBoolean() fboEnabled!: boolean;
  @IsBoolean() fbsEnabled!: boolean;
}
export class LamodaUpdateAccountDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(2000) secret?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class LamodaSyncDto {
  @IsIn(lamodaResources) kind!: LamodaResource;
}
export class LamodaLinkDto {
  @IsString() @IsNotEmpty() @MaxLength(200) skuId!: string;
}
export class LamodaImportDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) warehouseId!: string;
  @IsOptional() @IsString() @MaxLength(200) remoteShipmentId?: string;
}
