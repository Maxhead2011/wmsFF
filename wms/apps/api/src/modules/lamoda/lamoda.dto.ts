import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
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
export class LamodaImportShipmentDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) reference!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) warehouseId!: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
}
// FIX: explicit lower quantities are validated before the serializable creation check.
export class LamodaQuantityDto {
  @IsString() @IsNotEmpty() @MaxLength(200) skuId!: string;
  @IsInt() @Min(0) quantity!: number;
}
export class LamodaAssemblyDto {
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => LamodaQuantityDto)
  quantities?: LamodaQuantityDto[];
}
export class LamodaSubmissionPriceDto {
  @IsString() @IsNotEmpty() @MaxLength(200) skuId!:string;
  @IsInt() @Min(1) priceMinor!:number;
}
export class LamodaSubmissionDto {
  @IsString() @IsNotEmpty() @MaxLength(200) externalShipmentId!:string;
  @IsIn(['BYKOVO','SOFINO']) warehouseCode!:string;
  @IsString() @MaxLength(10) plannedDate!:string;
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({each:true}) @Type(()=>LamodaSubmissionPriceDto)
  prices!:LamodaSubmissionPriceDto[];
}
