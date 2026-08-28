import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { LogisticsService } from '../logistics/logistics.service';
import { FbsOrderSelectionDto } from './dto/fbs-order-selection.dto';
import { FbsPassDto } from './dto/fbs-pass.dto';
import { FbsStockPublicationDto } from './dto/fbs-stock-publication.dto';
import { FbsStockSyncDto } from './dto/fbs-stock-sync.dto';
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

  @Get('fbs/active-clients')
  @RequirePermissions()
  listFbsActiveClients(@CurrentUser() user: AuthUser) {
    return this.connections.listFbsActiveClients(user);
  }

  @Get('fbs/cargo-packings')
  @RequirePermissions()
  listFbsCargoPackings(@CurrentUser() user: AuthUser, @Query('clientId') clientId: string) {
    return this.connections.listFbsCargoPackings(clientId, user);
  }

  @Get('fbs/stocks')
  @RequirePermissions()
  listFbsStocks(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId: string,
    @Query('connectionId') connectionId?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.connections.listFbsStocks(clientId, connectionId, warehouseId, user);
  }

  @Put('fbs/stocks/publication')
  @RequirePermissions()
  updateFbsStockPublication(@Body() dto: FbsStockPublicationDto, @CurrentUser() user: AuthUser) {
    return this.connections.updateFbsStockPublication(dto, user);
  }

  @Post('fbs/stocks/sync')
  @RequirePermissions()
  syncFbsStocks(@Body() dto: FbsStockSyncDto, @CurrentUser() user: AuthUser) {
    return this.connections.syncFbsStocks(dto, user);
  }

  @Post('fbs/orders/assemble')
  @RequirePermissions()
  assembleFbsOrders(@Body() dto: FbsOrderSelectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.assembleFbsOrders(dto, user);
  }

  @Post('fbs/orders/reship')
  @RequirePermissions()
  reshipFbsOrders(@Body() dto: FbsOrderSelectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.reshipFbsOrders(dto, user);
  }

  @Post('fbs/orders/move-to-new-supply')
  @RequirePermissions()
  moveFbsOrdersToNewSupply(@Body() dto: FbsOrderSelectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.moveFbsOrdersToNewSupply(dto, user);
  }

  @Post('fbs/orders/cancel')
  @RequirePermissions()
  cancelFbsOrders(@Body() dto: FbsOrderSelectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.cancelFbsOrders(dto, user);
  }

  @Post('fbs/supplies/deliver')
  @RequirePermissions()
  deliverFbsSupplies(@Body() dto: FbsOrderSelectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.deliverFbsSupplies(dto, user);
  }

  @Post('fbs/supplies/change-destination')
  @RequirePermissions()
  changeFbsSuppliesDestination(@Body() dto: FbsOrderSelectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.changeFbsSuppliesDestination(dto, user);
  }

  @Post('fbs/orders/request')
  @RequirePermissions()
  createFbsRequest(@Body() dto: FbsOrderSelectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.createFbsRequest(dto, user);
  }

  @Post('fbs/requests/:requestId/online-refresh')
  @RequirePermissions('stock:write')
  refreshFbsOnlineRequest(
    @Param('requestId') requestId: string,
    @CurrentUser() user: AuthUser,
  ) {
    // FIX: единое действие сверяет WB и перестраивает маршрут заявки.
    return this.connections.refreshFbsOnlineRequest(requestId, user);
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

  @Post('fbs/orders/cargo-place-stickers.pdf')
  @RequirePermissions()
  async getFbsCargoPlaceStickersPdf(
    @Body() dto: FbsOrderSelectionDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.connections.getFbsCargoPlaceStickersPdf(dto, user);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.buffer.length));
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    return new StreamableFile(file.buffer);
  }

  @Post('fbs/orders/supply-stickers.pdf')
  @RequirePermissions()
  async getFbsSupplyStickersPdf(
    @Body() dto: FbsOrderSelectionDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.connections.getFbsSupplyStickersPdf(dto, user);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.buffer.length));
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    return new StreamableFile(file.buffer);
  }

  @Get('fbs/requests/:requestId/pick-list.pdf')
  @RequirePermissions()
  async getFbsRequestPickListPdf(
    @Param('requestId') requestId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.connections.getFbsRequestPickListPdf(requestId, user);
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

  @Get('fbs/passes')
  @RequirePermissions()
  listFbsPasses(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId: string,
    @Query('connectionId') connectionId?: string,
  ) {
    return this.connections.listFbsPasses(clientId, connectionId, user);
  }

  @Post('fbs/passes')
  @RequirePermissions()
  createFbsPass(@Body() dto: FbsPassDto, @CurrentUser() user: AuthUser) {
    return this.connections.createFbsPass(dto, user);
  }

  @Put('fbs/passes/:passId')
  @RequirePermissions()
  updateFbsPass(
    @Param('passId') passId: string,
    @Body() dto: FbsPassDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.updateFbsPass(passId, dto, user);
  }

  @Delete('fbs/passes/:passId')
  @RequirePermissions()
  deleteFbsPass(
    @Param('passId') passId: string,
    @Query('clientId') clientId: string,
    @Query('connectionId') connectionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.deleteFbsPass(passId, clientId, connectionId, user);
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
