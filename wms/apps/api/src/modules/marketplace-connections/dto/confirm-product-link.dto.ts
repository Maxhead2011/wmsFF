import { IsDateString, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
// FIX: optimistic concurrency and an explicit audit reason for manual matching.
export class ConfirmProductLinkDto {
 @IsUUID() skuId!:string;
 @IsDateString() updatedAt!:string;
 @IsString() @MinLength(3) @MaxLength(1000) reason!:string;
}
