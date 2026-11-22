import { IsIn, IsString, IsUUID, Length } from 'class-validator';

export class CreateReturnBatchDto {
  @IsUUID() id!: string;
  @IsString() @Length(1, 100) clientId!: string;
}
export class ScanReturnDto {
  @IsUUID() id!: string;
  @IsIn(['WILDBERRIES', 'OZON']) marketplace!: string;
  @IsString() @Length(1, 500) returnCode!: string;
  @IsString() @Length(1, 100) barcode!: string;
  @IsIn(['NORMAL', 'INCOMPLETE', 'DAMAGED', 'WRONG_ITEM']) condition!: string;
  @IsString() @Length(1, 100) boxCode!: string;
}
export class MarkReturnDto {
  @IsUUID() unitId!: string;
  @IsString() @Length(1, 100) boxCode!: string;
  @IsString() @Length(1, 100) barcode!: string;
  @IsString() @Length(20, 500) kiz!: string;
}

export class CloseReturnBoxDto {
  @IsString() @Length(1, 100) boxCode!: string;
}
