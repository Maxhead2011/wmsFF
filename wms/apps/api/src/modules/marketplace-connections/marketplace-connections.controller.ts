import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { LogisticsService } from '../logistics/logistics.service';
import { ApplyFbsRelabelReconciliationDto } from './dto/apply-fbs-relabel-reconciliation.dto';
import { FbsOrderSelectionDto } from './dto/fbs-order-selection.dto';
import { FbsPassDto } from './dto/fbs-pass.dto';
import { FbsStockPublicationBulkDto } from './dto/fbs-stock-publication-bulk.dto';
import { FbsStockPublicationDto } from './dto/fbs-stock-publication.dto';
import { ReconcileFbsStockItemDto } from './dto/reconcile-fbs-stock-item.dto';
import { FbsStockSyncDto } from './dto/fbs-stock-sync.dto';
import { QuoteFbsCalculatorDto } from './dto/quote-fbs-calculator.dto';
import { UpdateFbsBillingSettingsDto } from './dto/update-fbs-billing-settings.dto';
import { UpdateFbsCargoPackingIgnoreDto } from './dto/update-fbs-cargo-packing-ignore.dto';
import { UpdateFbsWarehouseRoutesDto } from './dto/update-fbs-warehouse-routes.dto';
import { UpdateMarketplaceConnectionDto } from './dto/update-marketplace-connection.dto';
import { UpdateDbsIntegrationDto } from './dto/update-dbs-integration.dto';
import { UpsertDbsIntegrationDto } from './dto/upsert-dbs-integration.dto';
import { UpsertMarketplaceConnectionDto } from './dto/upsert-marketplace-connection.dto';
import {
  FBS_PRODUCT_REPORT_XLSX_MIME,
  FbsProductShipmentsReportService,
} from './fbs-product-shipments-report.service';
import { MarketplaceConnectionsService } from './marketplace-connections.service';

@ApiTags('marketplace-connections')
@RequirePermissions('clients:read')
@Controller(['marketplace-connections', 'marketplace-connection'])
export class MarketplaceConnectionsController {
  constructor(
    private readonly connections: MarketplaceConnectionsService,
    private readonly logistics: LogisticsService,
    private readonly productShipmentsReport: FbsProductShipmentsReportService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.connections.list(clientId, user);
  }

  @Get('dbs/integrations')
  listDbsIntegrations(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId?: string,
    @Query('marketplace') marketplace?: string,
  ) {
    return this.connections.listDbsIntegrations(clientId, marketplace, user);
  }

  @Post('dbs/integrations')
  @RequirePermissions('clients:write')
  createDbsIntegration(@Body() dto: UpsertDbsIntegrationDto, @CurrentUser() user: AuthUser) {
    return this.connections.createDbsIntegration(dto, user);
  }

  @Patch('dbs/integrations/:id')
  @RequirePermissions('clients:write')
  updateDbsIntegration(
    @Param('id') id: string,
    @Body() dto: UpdateDbsIntegrationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.updateDbsIntegration(id, dto, user);
  }

  @Post('dbs/integrations/:id/check')
  @RequirePermissions('clients:write')
  checkDbsIntegration(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.connections.checkDbsIntegration(id, user);
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

  @Get('fbs/packed-items')
  @RequirePermissions()
  listFbsPackedItems(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId?: string,
    @Query('marketplace') marketplace?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
    @Query('requiresKiz') requiresKiz?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.connections.listFbsPackedItems(
      { clientId, marketplace, dateFrom, dateTo, search, requiresKiz, page, pageSize },
      user,
    );
  }

  @Post('fbs/packed-items/reconcile')
  @RequirePermissions()
  reconcileFbsPackedItems(
    @Body() payload: { clientId?: string; assemblyIds?: string[] },
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.reconcileFbsPackedItems(payload, user);
  }

  @Get('fbs/product-shipments-report')
  @RequirePermissions()
  productShipments(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    return this.productShipmentsReport.report(
      { clientId, dateFrom, dateTo, search },
      user,
    );
  }

  @Get('fbs/product-shipments-report.xlsx')
  @RequirePermissions()
  async productShipmentsXlsx(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
    @Query('clientId') clientId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    const file = await this.productShipmentsReport.export(
      { clientId, dateFrom, dateTo, search },
      user,
    );
    response.setHeader('Content-Type', FBS_PRODUCT_REPORT_XLSX_MIME);
    response.setHeader('Content-Length', String(file.buffer.length));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="fbs-products.xlsx"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    return new StreamableFile(file.buffer);
  }

  @Get('fbs/relabel-reconciliation')
  @RequirePermissions()
  listFbsRelabelReconciliation(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('barcode') barcode?: string,
    @Query('refreshWb') refreshWb?: string,
  ) {
    return this.connections.listFbsRelabelReconciliation(
      clientId,
      dateFrom,
      dateTo,
      barcode,
      user,
      refreshWb !== 'false' && refreshWb !== '0',
    );
  }

  @Post('fbs/relabel-reconciliation/apply')
  @RequirePermissions()
  applyFbsRelabelReconciliation(
    @Body() dto: ApplyFbsRelabelReconciliationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.applyFbsRelabelReconciliation(dto, user);
  }

  @Get('fbs/active-clients')
  @RequirePermissions()
  listFbsActiveClients(
    @CurrentUser() user: AuthUser,
    @Query('marketplace') marketplace: string | undefined,
  ) {
    return this.connections.listFbsActiveClients(user, marketplace);
  }

  @Get('fbs/cargo-packings')
  @RequirePermissions()
  listFbsCargoPackings(@CurrentUser() user: AuthUser, @Query('clientId') clientId: string) {
    return this.connections.listFbsCargoPackings(clientId, user);
  }

  @Patch('fbs/cargo-packings/:planId/ignore')
  @RequirePermissions('clients:write')
  updateFbsCargoPackingIgnore(
    @Param('planId') planId: string,
    @Body() dto: UpdateFbsCargoPackingIgnoreDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.updateFbsCargoPackingIgnore(planId, dto, user);
  }

  @Get('fbs/stocks')
  @RequirePermissions()
  listFbsStocks(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId: string,
    @Query('connectionId') connectionId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.connections.listFbsStocks(
      clientId,
      connectionId,
      warehouseId,
      user,
      refresh === 'true' || refresh === '1',
    );
  }

  @Put('fbs/stocks/publication')
  @RequirePermissions()
  updateFbsStockPublication(@Body() dto: FbsStockPublicationDto, @CurrentUser() user: AuthUser) {
    return this.connections.updateFbsStockPublication(dto, user);
  }

  @Post('fbs/stocks/reconcile-item')
  @RequirePermissions()
  reconcileFbsStockItem(@Body() dto: ReconcileFbsStockItemDto, @CurrentUser() user: AuthUser) {
    return this.connections.reconcileFbsStockItem(dto, user);
  }

  @Put('fbs/stocks/publication/bulk')
  @RequirePermissions()
  updateFbsStockPublicationBulk(
    @Body() dto: FbsStockPublicationBulkDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.updateFbsStockPublicationBulk(dto, user);
  }

  @Post('fbs/stocks/sync')
  @RequirePermissions()
  syncFbsStocks(@Body() dto: FbsStockSyncDto, @CurrentUser() user: AuthUser) {
    return this.connections.syncFbsStocks(dto, user);
  }

  @Put('fbs/stocks/warehouse')
  @RequirePermissions()
  connectFbsStockWarehouse(@Body() dto: FbsStockSyncDto, @CurrentUser() user: AuthUser) {
    return this.connections.connectFbsStockWarehouse(dto, user);
  }

  @Get(':id/fbs-warehouse-routes')
  @RequirePermissions('clients:read')
  listFbsWarehouseRoutes(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.connections.listFbsWarehouseRoutes(id, user);
  }

  @Put(':id/fbs-warehouse-routes')
  @RequirePermissions('clients:write')
  updateFbsWarehouseRoutes(
    @Param('id') id: string,
    @Body() dto: UpdateFbsWarehouseRoutesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.updateFbsWarehouseRoutes(id, dto, user);
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

  @Post('fbs/orders/remove-cancelled')
  @RequirePermissions()
  removeCancelledFbsOrder(@Body() dto: FbsOrderSelectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.removeCancelledFbsOrder(dto, user);
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

  @Post('fbs/requests/:requestId/emergency-assembly')
  @RequirePermissions()
  enableFbsEmergencyAssembly(
    @Param('requestId') requestId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.enableFbsEmergencyAssembly(requestId, user);
  }

  @Post('fbs/requests/:requestId/repair-selection')
  @RequirePermissions('stock:write')
  repairFbsRequestSelection(
    @Param('requestId') requestId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.repairFbsRequestSelection(requestId, user);
  }

  @Get('fbs/requests/:requestId/supply-consistency')
  @RequirePermissions('stock:write')
  checkFbsRequestSupplyConsistency(
    @Param('requestId') requestId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.checkFbsRequestSupplyConsistency(requestId, user);
  }

  @Post('fbs/requests/:requestId/supply-consistency/repair')
  @RequirePermissions('stock:write')
  repairFbsRequestSupplyConsistency(
    @Param('requestId') requestId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.repairFbsRequestSupplyConsistency(requestId, user);
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
  @RequirePermissions('clients:write')
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

  @Post('fbs/web-order-assembly/scan')
  @RequirePermissions()
  scanWebOrderAssembly(
    @Body() body: { code?: unknown; stationId?: unknown; deviceCode?: unknown },
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.scanWebOrderAssembly(
      body?.code,
      user,
      body?.stationId,
      body?.deviceCode,
    );
  }

  @Get('fbs/sos/requests')
  @RequirePermissions()
  listSosWbRequests(@CurrentUser() user: AuthUser) {
    return this.connections.listSosWbRequests(user);
  }

  @Post('fbs/sos/claim')
  @RequirePermissions()
  claimSosWbOrder(
    @Body() body: { requestId?: unknown; barcode?: unknown; deviceCode?: unknown },
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.claimSosWbOrder(body ?? {}, user);
  }

  @Post('fbs/sos/tasks/:taskId/kiz')
  @RequirePermissions()
  acceptSosWbKiz(
    @Param('taskId') taskId: string,
    @Body() body: { kiz?: unknown; deviceCode?: unknown; confirmReplace?: unknown },
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.acceptSosWbKiz(taskId, body ?? {}, user);
  }

  @Post('fbs/sos/tasks/:taskId/release')
  @RequirePermissions()
  releaseSosWbOrder(
    @Param('taskId') taskId: string,
    @Body() body: { deviceCode?: unknown },
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.releaseSosWbOrder(taskId, body ?? {}, user);
  }

  @Get('fbs/web-order-assembly/history')
  @RequirePermissions()
  webOrderAssemblyHistory(@CurrentUser() user: AuthUser) {
    return this.connections.webOrderAssemblyHistory(user);
  }

  @Post('fbs/web-order-assembly/history/:id/reprint')
  @RequirePermissions()
  reprintWebOrderAssemblyHistory(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.reprintWebOrderAssemblyHistory(id, user);
  }

  @Delete('fbs/web-order-assembly/history/:id')
  @RequirePermissions()
  deleteWebOrderAssemblyHistory(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.deleteWebOrderAssemblyHistory(id, user);
  }

  @Get('fbs/print-stations')
  @RequirePermissions()
  listFbsPrintStations(@CurrentUser() user: AuthUser) {
    return this.connections.listFbsPrintStations(user);
  }

  @Post('fbs/print-stations')
  @RequirePermissions()
  createFbsPrintStation(
    @Body() body: {
      name?: string;
      printerName?: string;
      printerModel?: string;
      labelWidthMm?: number;
      labelHeightMm?: number;
    },
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.createFbsPrintStation(body ?? {}, user);
  }

  @Delete('fbs/print-stations/:stationId')
  @RequirePermissions()
  deleteFbsPrintStation(
    @Param('stationId') stationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.deleteFbsPrintStation(stationId, user);
  }

  @Post('fbs/print-stations/:stationId/heartbeat')
  @RequirePermissions()
  heartbeatFbsPrintStation(
    @Param('stationId') stationId: string,
    @Body() body: { error?: unknown },
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.heartbeatFbsPrintStation(stationId, body?.error, user);
  }

  @Post('fbs/print-stations/:stationId/claim')
  @RequirePermissions()
  claimFbsPrintJob(
    @Param('stationId') stationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.claimFbsPrintJob(stationId, user);
  }

  @Post('fbs/print-jobs/:jobId/result')
  @RequirePermissions()
  finishFbsPrintJob(
    @Param('jobId') jobId: string,
    @Body() body: { success?: boolean; error?: unknown },
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.finishFbsPrintJob(
      jobId,
      body?.success === true,
      body?.error,
      user,
    );
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

  @Post(':id/check')
  @RequirePermissions('clients:write')
  checkConnection(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.connections.checkConnection(id, user);
  }
}
