import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAnyPermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DuplicateStockGroupsService } from './duplicate-stock-groups.service';
@Controller('marketplace-connections/duplicate-groups')
@RequireAnyPermissions('clients:read', 'clients:write', 'client-requests:read', 'client-requests:write')
export class DuplicateStockGroupsController {
  constructor(private readonly groups: DuplicateStockGroupsService) {}
  @Get('capabilities') capabilities() { return this.groups.capabilities(); }
  @Get(':clientId') read(@Param('clientId') id: string, @CurrentUser() user: AuthUser) { return this.groups.read(id, user); }
  @Post(':clientId/catalog') catalog(@Param('clientId') id: string, @Body() body: { search?: unknown; ids?: unknown; page?: unknown }, @CurrentUser() user: AuthUser) { return this.groups.catalog(id, body, user); }
  @Post(':clientId/preview') preview(@Param('clientId') id: string, @Body() body: { group?: unknown }, @CurrentUser() user: AuthUser) { return this.groups.preview(id, body, user); }
  @Put(':clientId')
  @RequireAnyPermissions('clients:write', 'client-requests:write')
  save(@Param('clientId') id: string, @Body() body: { group?: unknown; revision?: unknown; deleteId?: unknown }, @CurrentUser() user: AuthUser) { return this.groups.save(id, body, user); }
}
