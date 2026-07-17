import { TsdReviewReason } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';

export class ResolveTsdReviewDto {
  @IsIn(['APPLY_INVENTORY_ADJUSTMENT', 'ACCEPT_RECEIPT_WITH_ERROR', 'REJECT'])
  action!: 'APPLY_INVENTORY_ADJUSTMENT' | 'ACCEPT_RECEIPT_WITH_ERROR' | 'REJECT';

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsEnum(TsdReviewReason)
  reason?: TsdReviewReason;
}
