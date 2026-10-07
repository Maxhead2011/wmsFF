import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { BillingPeriodCloseService } from './billing-period-close.service';
import { BillingCloseQuery, CloseBillingPeriodDto, CreateInvoiceCorrectionDto, PreviewInvoiceCorrectionDto } from './dto/billing-period-close.dto';
@Controller('billing/period-close')
@RequirePermissions('billing:read')
export class BillingPeriodCloseController {
  constructor(private readonly periods: BillingPeriodCloseService) {}
  @Get('capabilities') capabilities() { return this.periods.capabilities(); }
  @Get() list(@Query() dto: BillingCloseQuery, @CurrentUser() user: AuthUser) { return this.periods.list(dto, user); }
  @Get('corrections') history(@Query() dto: BillingCloseQuery, @CurrentUser() user: AuthUser) { return this.periods.correctionHistory(dto, user); }
  @Post('preview') @RequirePermissions('billing:write') preview(@Body() dto: BillingCloseQuery, @CurrentUser() user: AuthUser) { return this.periods.preview(dto, user); }
  @Post() @RequirePermissions('billing:write') close(@Body() dto: CloseBillingPeriodDto, @CurrentUser() user: AuthUser) { return this.periods.close(dto, user); }
  @Post('corrections/preview') @RequirePermissions('billing:write') previewCorrection(@Body() dto: PreviewInvoiceCorrectionDto, @CurrentUser() user: AuthUser) { return this.periods.previewCorrection(dto, user); }
  @Post('corrections') @RequirePermissions('billing:write') correction(@Body() dto: CreateInvoiceCorrectionDto, @CurrentUser() user: AuthUser) { return this.periods.createCorrection(dto, user); }
}
