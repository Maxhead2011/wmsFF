import { IsIn, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';
// FIX: preserve terminal route hints and allow explicitly requested browser projections.
export class FboRouteDto {
 @IsOptional() @IsString() @MaxLength(200) sourceBoxCode?:string;
 @IsOptional() @IsString() @MaxLength(200) palletCode?:string;
 @IsOptional() @IsIn(['summary','history']) view?:string;
 @IsOptional() @IsNumberString() @MaxLength(16) offset?:string;
}
