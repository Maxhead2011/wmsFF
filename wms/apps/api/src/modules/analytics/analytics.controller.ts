import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsDashboardQueryDto, AnalyticsSyncDto } from './dto/analytics-query.dto';
import { UpsertAnalyticsConnectionDto } from './dto/upsert-analytics-connection.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@RequirePermissions()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('clients')
  clients(@CurrentUser() user: AuthUser) {
    return this.analytics.listClients(user);
  }

  @Get('dashboard')
  dashboard(@Query() query: AnalyticsDashboardQueryDto, @CurrentUser() user: AuthUser) {
    return this.analytics.dashboard(query, user);
  }

  @Post('sync')
  sync(@Body() dto: AnalyticsSyncDto, @CurrentUser() user: AuthUser) {
    return this.analytics.sync(dto, user);
  }

  @Put('connections/:clientId')
  @RequirePermissions('system:admin')
  upsertConnection(
    @Param('clientId') clientId: string,
    @Body() dto: UpsertAnalyticsConnectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.analytics.upsertConnection(clientId, dto, user);
  }
}
