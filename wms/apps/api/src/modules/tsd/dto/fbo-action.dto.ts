import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
export class FboActionDto {
    // FIX: identifies the original packing receipt; never select a unit by barcode alone.
    @IsOptional()
    @IsString()
    @MaxLength(100)
    undoOperationId?: string;
    @IsOptional()
    @IsString()
    @MaxLength(200)
    direction?: string;
    @IsIn(['START', 'PICK_UNIT', 'PICK_BOX', 'FINISH_PICK', 'OPEN_BOX', 'PACK_UNIT', 'PACK_PRODUCT', 'UNDO_PACK_UNIT', 'PACK_BOX', 'CLOSE_BOX', 'CANCEL_EMPTY_BOX', 'SORTED', 'CONFIRM_BOX', 'FINISH'])
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
