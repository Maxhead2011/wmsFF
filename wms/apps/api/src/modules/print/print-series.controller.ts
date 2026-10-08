import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { PrintSeriesService } from './print-series.service';

// FIX: isolated opt-in queue; old agents cannot claim a multi-page job.
@Controller('print/series')
@RequirePermissions('print:write')
export class PrintSeriesController {
  constructor(private readonly service:PrintSeriesService) {}
  @Get('stations') stations(@CurrentUser() u:AuthUser) {return this.service.stations(u);}
  @Post('jobs') create(@Body() b:Parameters<PrintSeriesService['create']>[0],@CurrentUser() u:AuthUser) {return this.service.create(b??{},u);}
  @Post('stations/:id/heartbeat') heartbeat(@Param('id') id:string,@CurrentUser() u:AuthUser) {return this.service.heartbeat(id,u);}
  @Post('stations/:id/claim') claim(@Param('id') id:string,@CurrentUser() u:AuthUser) {return this.service.claim(id,u);}
  @Post('stations/:station/jobs/:id/result') finish(@Param('station') station:string,@Param('id') id:string,@Body() b:{success?:unknown;error?:unknown},@CurrentUser() u:AuthUser) {return this.service.finish(station,id,b?.success,b?.error,u);}
}
