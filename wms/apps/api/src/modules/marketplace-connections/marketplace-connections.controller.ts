import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { LogisticsService } from '../logistics/logistics.service';
import { FbsOrderSelectionDto } from './dto/fbs-order-selection.dto';
import { QuoteFbsCalculatorDto } from './dto/quote-fbs-calculator.dto';
import { UpdateFbsBillingSettingsDto } from './dto/update-fbs-billing-settings.dto';
import { UpdateMarketplaceConnectionDto } from './dto/update-marketplace-connection.dto';
import { UpsertMarketplaceConnectionDto } from './dto/upsert-marketplace-connection.dto';
import { MarketplaceConnectionsService } from './marketplace-connections.service';

@ApiTags('marketplace-connections')
@RequirePermissions('clients:read')
@Controller('marketplace-connections')
export class MarketplaceConnectionsController {
  constructor(
    private readonly connections: MarketplaceConnectionsService,
    private readonly logistics: LogisticsService,
  ) {}

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

  @Post('fbs/orders/assemble')
  @RequirePermissions()
  assembleFbsOrders(@Body() dto: FbsOrderSelectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.assembleFbsOrders(dto, user);
  }

  @Post('fbs/orders/request')
  @RequirePermissions()
  createFbsRequest(@Body() dto: FbsOrderSelectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.createFbsRequest(dto, user);
  }

  @Post('fbs/orders/stickers.pdf')
  @RequirePermissions()
  async getFbsOrderStickersPdf(
    @Body() dto: FbsOrderSelectionDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.connections.getFbsOrderStickersPdf(dto, user);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.buffer.length));
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    return new StreamableFile(file.buffer);
  }

  @Post('fbs/connections')
  @RequirePermissions()
  createFbsConnection(@Body() dto: UpsertMarketplaceConnectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.createFbsConnection(dto, user);
  }

  @Get('fbs/calculator/destinations')
  @RequirePermissions()
  listFbsCalculatorDestinations() {
    return this.logistics.listFbsCalculatorDestinations();
  }

  @Post('fbs/calculator/quote')
  @RequirePermissions()
  quoteFbsCalculator(@Body() dto: QuoteFbsCalculatorDto) {
    return this.logistics.quoteFbsCalculator(dto);
  }

  @Get('fbs/billing-settings/:clientId')
  @RequirePermissions('billing:write')
  getFbsBillingSettings(@Param('clientId') clientId: string, @CurrentUser() user: AuthUser) {
    return this.connections.getFbsBillingSettings(clientId, user);
  }

  @Put('fbs/billing-settings/:clientId')
  @RequirePermissions('billing:write')
  updateFbsBillingSettings(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateFbsBillingSettingsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.updateFbsBillingSettings(clientId, dto, user);
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
