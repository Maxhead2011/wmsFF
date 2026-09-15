import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { KizDuplicateService } from './kiz-duplicate.service';

@Controller('print/kiz-duplicates')
@RequirePermissions('print:write')
export class KizDuplicateController {
  constructor(private readonly service: KizDuplicateService) {}
  @Get('clients') clients(@CurrentUser() user: AuthUser) { return this.service.clients(user); }
  @Get('stations') stations(@CurrentUser() user: AuthUser) { return this.service.stations(user); }
  @Post('lookup') lookup(@Body() body: Parameters<KizDuplicateService['lookup']>[0], @CurrentUser() user: AuthUser) { return this.service.lookup(body ?? {}, user); }
  @Post('jobs') create(@Body() body: Parameters<KizDuplicateService['create']>[0], @CurrentUser() user: AuthUser) { return this.service.create(body ?? {}, user); }
  @Get('jobs') history(@CurrentUser() user: AuthUser) { return this.service.history(user); }
  @Get('jobs/:id') status(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.status(id, user); }
  @Post('jobs/:id/verify') verify(@Param('id') id: string, @Body() body: { kiz?: unknown }, @CurrentUser() user: AuthUser) { return this.service.verify(id, body?.kiz, user); }
  @Post('stations/:id/heartbeat') heartbeat(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.heartbeat(id, user); }
  @Post('stations/:id/claim') claim(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.claim(id, user); }
  @Post('stations/:stationId/jobs/:id/result') finish(@Param('stationId') stationId: string, @Param('id') id: string, @Body() body: { success?: unknown; error?: unknown }, @CurrentUser() user: AuthUser) { return this.service.finish(stationId, id, body?.success, body?.error, user); }
}
