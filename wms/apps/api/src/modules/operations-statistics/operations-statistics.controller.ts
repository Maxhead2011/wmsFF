import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { OperationsStatisticsDto } from './operations-statistics.dto';
import { OperationsStatisticsService } from './operations-statistics.service';
import { StatisticsRefreshService } from './statistics-refresh.service';

@Controller('operations-statistics')
@RequirePermissions('stock:read')
export class OperationsStatisticsController {
  constructor(@Inject(OperationsStatisticsService) private readonly statistics: OperationsStatisticsService,
    @Inject(StatisticsRefreshService) private readonly refresh: StatisticsRefreshService) {}
  @Get() report(@Query() query: OperationsStatisticsDto, @CurrentUser() user: AuthUser) { return this.statistics.report(query, user); }
  // FIX: isolated report cache only; no shipment, inventory or assembly writes.
  @Post('refreshes') start(@Body() query: OperationsStatisticsDto, @CurrentUser() user: AuthUser) { return this.refresh.start(query, user); }
  @Get('refreshes/:id') progress(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.refresh.progress(id, user); }
}
