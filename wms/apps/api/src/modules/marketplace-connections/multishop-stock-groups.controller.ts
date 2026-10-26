import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { MultishopStockGroupsService, ShopConfiguration } from './multishop-stock-groups.service';

// FIX: all group and product access remains scoped to the authenticated client.
@Controller('marketplace-connections/multishop')
@RequirePermissions('clients:read')
export class MultishopStockGroupsController {
  constructor(private readonly groups: MultishopStockGroupsService) {}
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
}
