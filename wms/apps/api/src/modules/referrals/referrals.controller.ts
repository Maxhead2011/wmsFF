import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ReferralReportDto } from './dto/referral-report.dto';
import { ReferralsService } from './referrals.service';

@ApiTags('referrals')
@ApiBearerAuth()
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('report')
  @RequirePermissions('referrals:read')
  report(@Query() query: ReferralReportDto, @CurrentUser() user: AuthUser) {
    return this.referrals.report(query, user);
  }
}
