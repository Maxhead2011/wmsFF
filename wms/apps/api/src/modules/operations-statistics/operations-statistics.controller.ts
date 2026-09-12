import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { OperationsStatisticsDto } from './operations-statistics.dto';
import { OperationsStatisticsService } from './operations-statistics.service';

@Controller('operations-statistics')
@RequirePermissions('stock:read')
export class OperationsStatisticsController {
  constructor(@Inject(OperationsStatisticsService) private readonly statistics: OperationsStatisticsService) {}
  @Get() report(@Query() query: OperationsStatisticsDto, @CurrentUser() user: AuthUser) { return this.statistics.report(query, user); }
}
