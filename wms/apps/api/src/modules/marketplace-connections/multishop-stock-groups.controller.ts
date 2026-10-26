import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { MultishopStockGroupsService, ShopConfiguration } from './multishop-stock-groups.service';
import { MultishopStockSyncService } from './multishop-stock-sync.service';

// FIX: all group and product access remains scoped to the authenticated client.
@Controller('marketplace-connections/multishop')
@RequirePermissions('clients:read')
export class MultishopStockGroupsController {
  constructor(private readonly groups: MultishopStockGroupsService, private readonly sync: MultishopStockSyncService) {}
  @Get('capabilities')
  capabilities() { return this.groups.capabilities(); }
  @Get(':clientId')
  read(@Param('clientId') clientId: string, @CurrentUser() user: AuthUser) { return this.groups.read(clientId, user); }
  @Put(':clientId')
  save(@Param('clientId') clientId: string, @Body() body: { revision: string | null; config: ShopConfiguration }, @CurrentUser() user: AuthUser) {
    return this.groups.save(clientId, body, user);
  }
  @Get(':clientId/products')
  products(@Param('clientId') clientId: string, @Query('q') query: string, @Query('page') page: string, @CurrentUser() user: AuthUser) {
    return this.groups.products(clientId, query, Number(page), user);
  }
  @Get(':clientId/sync')
  status(@Param('clientId') clientId: string, @CurrentUser() user: AuthUser) { return this.sync.status(clientId, user); }
  @Get(':clientId/preview')
  preview(@Param('clientId') clientId: string, @CurrentUser() user: AuthUser) { return this.sync.preview(clientId, user); }
  @Put(':clientId/activate')
  activate(@Param('clientId') clientId: string, @Body() body: { revision: string }, @CurrentUser() user: AuthUser) { return this.sync.activate(clientId, body, user); }
  @Put(':clientId/stop')
  stop(@Param('clientId') clientId: string, @CurrentUser() user: AuthUser) { return this.sync.stop(clientId, user); }
}
