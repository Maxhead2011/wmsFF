import { IsIn, IsOptional, IsString, IsInt, Min, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
export class FboActionDto {
    // FIX: terminals send string values; validate the converted physical unit count.
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    confirmedQuantity?: number;
    @IsIn(['START', 'PICK_UNIT', 'PICK_BOX', 'FINISH_PICK', 'OPEN_BOX', 'PACK_UNIT', 'PACK_BOX', 'CLOSE_BOX', 'CANCEL_EMPTY_BOX', 'SORTED', 'CONFIRM_BOX', 'FINISH'])
    action!: string;
    @IsString()
    @MinLength(8)
    @MaxLength(100)
    operationId!: string;
    @IsOptional()
    @IsString()
    @MaxLength(100)
    palletCode?: string;
    @IsOptional()
    @IsString()
    @MaxLength(100)
    sourceBoxCode?: string;
    @IsOptional()
    @IsString()
    @MaxLength(100)
    targetBoxCode?: string;
    @IsOptional()
    @IsString()
    @MaxLength(100)
    barcode?: string;
    @IsOptional()
    @IsString()
    @MaxLength(1024)
    kiz?: string;
}
