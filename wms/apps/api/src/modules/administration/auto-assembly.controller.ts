import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { AutoAssemblyService } from './auto-assembly.service';
@RequirePermissions('system:admin')
@Controller('administration/auto-assembly')
export class AutoAssemblyController {
  constructor(private readonly service: AutoAssemblyService) {}
  @Get() list(@Query('clientId') clientId: string, @CurrentUser() user: AuthUser) { return this.service.list(clientId, user); }
  @Put(':id') save(@Param('id') id: string, @Body() body: { config: unknown; version?: string | null }, @CurrentUser() user: AuthUser) { return this.service.save(id, body, user); }
  @Post(':id/preview') preview(@Param('id') id: string, @Body() body: { config: unknown }, @CurrentUser() user: AuthUser) { return this.service.preview(id, body.config, user); }
  @Post(':id/run') run(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.run(id, user); }
}
