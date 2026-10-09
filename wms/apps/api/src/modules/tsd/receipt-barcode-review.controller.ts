import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ReceiptBarcodeReviewService } from './receipt-barcode-review.service';

export class BarcodeDecisionDto {
  @IsIn(['CONFIRM', 'CORRECT', 'REJECT']) action!: 'CONFIRM' | 'CORRECT' | 'REJECT';
  @IsOptional() @IsString() @MaxLength(128) barcode?: string;
  @IsString() @MinLength(1) @MaxLength(2000) comment!: string;
}
@Controller('tsd/receipt-barcode-review')
@RequirePermissions('stock:write')
export class ReceiptBarcodeReviewController {
  constructor(private readonly review: ReceiptBarcodeReviewService) {}
  @Get('summary') summary(@CurrentUser() user: AuthUser) { return this.review.summary(user); }
  @Get() list(@CurrentUser() user: AuthUser) { return this.review.list(user); }
  @Post(':id/resolve') resolve(@Param('id') id: string, @Body() dto: BarcodeDecisionDto, @CurrentUser() user: AuthUser) {
    return this.review.resolve(id, dto, user);
  }
}
