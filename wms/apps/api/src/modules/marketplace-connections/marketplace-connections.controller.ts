import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { UpdateMarketplaceConnectionDto } from './dto/update-marketplace-connection.dto';
import { UpsertMarketplaceConnectionDto } from './dto/upsert-marketplace-connection.dto';
import { MarketplaceConnectionsService } from './marketplace-connections.service';

@ApiTags('marketplace-connections')
@RequirePermissions('clients:read')
@Controller('marketplace-connections')
export class MarketplaceConnectionsController {
  constructor(private readonly connections: MarketplaceConnectionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.connections.list(clientId, user);
  }

  @Get('fbs/orders')
  @RequirePermissions()
  listFbsOrders(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.connections.listFbsOrders(clientId, user, refresh === 'true' || refresh === '1');
  }

  @Post('fbs/connections')
  @RequirePermissions()
  createFbsConnection(@Body() dto: UpsertMarketplaceConnectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.createFbsConnection(dto, user);
  }

  @Post()
  @RequirePermissions('clients:write')
  create(@Body() dto: UpsertMarketplaceConnectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('clients:write')
  update(@Param('id') id: string, @Body() dto: UpdateMarketplaceConnectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('clients:write')
  delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.connections.delete(id, user);
  }

  @Post(':id/sync-products')
  @RequirePermissions('clients:write')
  syncProducts(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.connections.syncProducts(id, user);
  }
}
