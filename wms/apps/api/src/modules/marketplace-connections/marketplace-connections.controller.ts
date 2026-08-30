import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../auth/decorators/require-permissions.decorator';
import { LogisticsService } from '../logistics/logistics.service';
import { ApplyFbsRelabelReconciliationDto } from './dto/apply-fbs-relabel-reconciliation.dto';
import {
  ApplyFbsSupplyReconciliationDto,
  FbsSupplyReconciliationPreviewDto,
} from './dto/fbs-supply-reconciliation.dto';
import { FbsOrderSelectionDto } from './dto/fbs-order-selection.dto';
import { FbsCancelledOrdersReportDto } from './dto/fbs-cancelled-orders-report.dto';
import { FbsPassDto } from './dto/fbs-pass.dto';
import { FbsStockPublicationBulkDto } from './dto/fbs-stock-publication-bulk.dto';
import { FbsStockPublicationDto } from './dto/fbs-stock-publication.dto';
import { RefreshFbsStockMonitorDto, RepairFbsStockMonitorDto, UpdateFbsStockMonitorConfigDto } from './dto/fbs-stock-monitoring.dto';
import {
  CreateFbsStockIntegrationKeyDto,
  SyncFbsStockAllocationDto,
  UpdateFbsStockAllocationDto,
} from './dto/fbs-stock-allocation.dto';
import { ReconcileFbsStockItemDto } from './dto/reconcile-fbs-stock-item.dto';
import { FbsStockSyncDto } from './dto/fbs-stock-sync.dto';
import { FbsSupplyRequestAuditDto } from './dto/fbs-supply-request-audit.dto';
import { FbsSupplyRequestDto } from './dto/fbs-supply-request.dto';
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
import {
  FBS_PENALTIES_REPORT_XLSX_MIME,
  FbsPenaltiesReportService,
} from './fbs-penalties-report.service';
import { FBS_DEADLINE_REPORT_XLSX_MIME } from './fbs-deadline-report-xlsx';
import { FBS_CANCELLED_REPORT_XLSX_MIME } from './fbs-cancelled-report-xlsx';
import { FbsStockMonitoringService } from './fbs-stock-monitoring.service';
import { MarketplaceConnectionsService } from './marketplace-connections.service';

@ApiTags('marketplace-connections')
@RequirePermissions('clients:read')
@Controller(['marketplace-connections', 'marketplace-connection'])
export class MarketplaceConnectionsController {
  constructor(
    private readonly connections: MarketplaceConnectionsService,
    private readonly logistics: LogisticsService,
    private readonly productShipmentsReport: FbsProductShipmentsReportService,
    // ADDED: read-only WB Finance report for the 13th FBS tile.
    private readonly penaltiesReport: FbsPenaltiesReportService,
    private readonly stockMonitoring: FbsStockMonitoringService,
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

  // FIX: explicit live audit of every WB supply routed to the user's active branch.
  @Get('fbs/delivery-recovery')
  @RequirePermissions()
  checkFbsBranchDeliveryRecovery(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId: string,
  ) {
    return this.connections.checkFbsBranchDeliveryRecovery(clientId, user);
  }

  @Post('fbs/delivery-recovery/request')
  @RequirePermissions()
  createFbsDeliveryRecoveryRequest(
    @Body() dto: FbsOrderSelectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.createFbsDeliveryRecoveryRequest(dto, user);
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

  @Get('fbs/penalties-report')
  @RequirePermissions()
  penalties(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId?: string,
    @Query('connectionId') connectionId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    // ADDED: client scope is checked again inside the report service.
    return this.penaltiesReport.report(
      { clientId, connectionId, dateFrom, dateTo, search },
      user,
    );
  }

  @Get('fbs/penalties-report.xlsx')
  @RequirePermissions()
  async penaltiesXlsx(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
    @Query('clientId') clientId?: string,
    @Query('connectionId') connectionId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    const file = await this.penaltiesReport.export(
      { clientId, connectionId, dateFrom, dateTo, search },
      user,
    );
    response.setHeader('Content-Type', FBS_PENALTIES_REPORT_XLSX_MIME);
    response.setHeader('Content-Length', String(file.buffer.length));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="fbs-penalties.xlsx"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
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

  // ADDED: read-only audit monitor; it never changes WB or WMS stock.
  @Get('fbs/stock-monitor')
  @RequirePermissions()
  listFbsStockMonitor(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId?: string,
    @Query('connectionId') connectionId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
    @Query('system') system?: string,
    @Query('product') product?: string,
    @Query('q') q?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sort') sort?: string,
    @Query('direction') direction?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.stockMonitoring.list({
      clientId,
      connectionId,
      warehouseId,
      status,
      system,
      product,
      q,
      dateFrom,
      dateTo,
      sort,
      direction,
      page,
      pageSize,
    }, user);
  }

  // FIX: generate and close the complete workbook before response streaming.
  @Get('fbs/stock-monitor/wms-stocks.xlsx')
  @RequirePermissions('stock:read')
  async exportFbsStockMonitorWmsStocks(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
    @Query('clientId') clientId?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    // FIX: the Excel export obeys the same warehouse filter as the report screen.
    const file = await this.stockMonitoring.exportWmsStocks(clientId, user, warehouseId);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.size));
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    const stream = createReadStream(file.filePath);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      void file.cleanup();
    };
    stream.once('close', cleanup);
    stream.once('error', cleanup);
    return new StreamableFile(stream);
  }

  @Get('fbs/stock-monitor/events/:eventId')
  @RequirePermissions()
  getFbsStockMonitorEvent(@Param('eventId') eventId: string, @CurrentUser() user: AuthUser) {
    return this.stockMonitoring.detail(eventId, user);
  }

  @Get('fbs/stock-monitor/config/:connectionId')
  @RequirePermissions()
  getFbsStockMonitorConfig(@Param('connectionId') connectionId: string, @CurrentUser() user: AuthUser) {
    return this.stockMonitoring.getConfig(connectionId, user);
  }

  @Put('fbs/stock-monitor/config/:connectionId')
  @RequirePermissions('clients:write')
  updateFbsStockMonitorConfig(
    @Param('connectionId') connectionId: string,
    @Body() dto: UpdateFbsStockMonitorConfigDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stockMonitoring.updateConfig(connectionId, dto, user);
  }

  @Post('fbs/stock-monitor/refresh')
  @RequirePermissions()
  refreshFbsStockMonitor(@Body() dto: RefreshFbsStockMonitorDto, @CurrentUser() user: AuthUser) {
    return this.stockMonitoring.refresh(dto, user);
  }

  // ADDED: preview is read-only and obtains live WB/WMS values before the
  // operator sees the confirmation dialog.
  @Post('fbs/stock-monitor/events/:eventId/repair-preview')
  @RequirePermissions()
  previewFbsStockMonitorRepair(@Param('eventId') eventId: string, @CurrentUser() user: AuthUser) {
    return this.stockMonitoring.previewRepair(eventId, user);
  }

  // ADDED: the confirmed operation remains client-scoped and idempotent.
  @Post('fbs/stock-monitor/events/:eventId/repair')
  @RequirePermissions()
  repairFbsStockMonitor(
    @Param('eventId') eventId: string,
    @Body() dto: RepairFbsStockMonitorDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stockMonitoring.repair(eventId, dto, user);
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

  // ADDED: Optional multi-warehouse allocation; disabled policies do not affect legacy stock sync.
  @Get('fbs/stocks/allocation')
  @RequirePermissions()
  listFbsStockAllocation(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId: string,
    @Query('connectionId') connectionId: string,
  ) {
    return this.connections.listFbsStockAllocation(clientId, connectionId, user);
  }

  @Put('fbs/stocks/allocation')
  @RequirePermissions()
  updateFbsStockAllocation(
    @Body() dto: UpdateFbsStockAllocationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.updateFbsStockAllocation(dto, user);
  }

  @Post('fbs/stocks/allocation/sync')
  @RequirePermissions()
  syncFbsStockAllocation(
    @Body() dto: SyncFbsStockAllocationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.syncFbsStockAllocation(dto, user);
  }

  @Post('fbs/stocks/allocation/api-keys')
  @RequirePermissions()
  createFbsStockIntegrationKey(
    @Body() dto: CreateFbsStockIntegrationKeyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.createFbsStockIntegrationKey(dto, user);
  }

  @Delete('fbs/stocks/allocation/api-keys/:keyId')
  @RequirePermissions()
  revokeFbsStockIntegrationKey(
    @Param('keyId') keyId: string,
    @Query('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.revokeFbsStockIntegrationKey(clientId, keyId, user);
  }

  @Post('fbs/stocks/allocation/changes/:changeId/acknowledge')
  @RequirePermissions()
  acknowledgeFbsStockAllocationChange(
    @Param('changeId') changeId: string,
    @Body() dto: { clientId: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.acknowledgeFbsStockAllocationChange(dto.clientId, changeId, user);
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

  // ADDED: safe recovery for mixed/partially unavailable online-request orders.
  @Post('fbs/orders/repair-move-to-new-supply')
  @RequirePermissions()
  repairFbsOrdersMove(@Body() dto: FbsOrderSelectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.repairFbsOrdersMove(dto, user);
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

  @Post('fbs/supplies/request')
  @RequirePermissions()
  createFbsRequestFromSupply(@Body() dto: FbsSupplyRequestDto, @CurrentUser() user: AuthUser) {
    return this.connections.createFbsRequestFromSupply(dto, user);
  }

  // ADDED: read-only check of WB supplies that have orders but no complete WMS request.
  @Post('fbs/supplies/request-audit')
  @RequirePermissions()
  auditFbsSupplyRequests(
    @Body() dto: FbsSupplyRequestAuditDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.auditFbsSupplyRequests(dto, user);
  }

  // ADDED: two-step, client-scoped repair for supplies merged manually in WB.
  @Post('fbs/supplies/reconciliation/preview')
  @RequirePermissions('stock:read')
  previewFbsSupplyReconciliation(
    @Body() dto: FbsSupplyReconciliationPreviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.previewFbsSupplyReconciliation(dto, user);
  }

  @Post('fbs/supplies/reconciliation/apply')
  @RequirePermissions('stock:write')
  applyFbsSupplyReconciliation(
    @Body() dto: ApplyFbsSupplyReconciliationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.applyFbsSupplyReconciliation(dto, user);
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

  @Get('fbs/requests/:requestId/route')
  @RequirePermissions('stock:read')
  getFbsRequestRoute(@Param('requestId') requestId: string, @CurrentUser() user: AuthUser) {
    // ADDED: Always built from live WMS balances; no frontend route cache.
    return this.connections.getFbsRequestRoute(requestId, user);
  }

  @Post('fbs/requests/:requestId/route/rebuild')
  @RequirePermissions('stock:write')
  rebuildFbsRequestRoute(@Param('requestId') requestId: string, @CurrentUser() user: AuthUser) {
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

  @Post('fbs/orders/deadline-report.xlsx')
  @RequirePermissions()
  async exportFbsDeadlineSelectedOrders(
    @Body() dto: FbsOrderSelectionDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.connections.exportFbsDeadlineSelectedOrders(dto, user);
    response.setHeader('Content-Type', FBS_DEADLINE_REPORT_XLSX_MIME);
    response.setHeader('Content-Length', String(file.buffer.length));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="fbs-selected-deadlines.xlsx"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    return new StreamableFile(file.buffer);
  }

  // ADDED: protected XLSX download for the existing cancelled-orders report.
  @Post('fbs/orders/cancelled-report.xlsx')
  @RequirePermissions('clients:read')
  async exportFbsCancelledOrders(
    @Body() dto: FbsCancelledOrdersReportDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.connections.exportFbsCancelledOrders(dto, user);
    response.setHeader('Content-Type', FBS_CANCELLED_REPORT_XLSX_MIME);
    response.setHeader('Content-Length', String(file.buffer.length));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="fbs-cancelled-orders.xlsx"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
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
  // FIX: клиентский API-менеджер может подключать только кабинет из своего client scope.
  @RequireAnyPermissions('clients:write', 'marketplace-api:write')
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
  @RequireAnyPermissions('clients:write', 'marketplace-api:write')
  create(@Body() dto: UpsertMarketplaceConnectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.create(dto, user);
  }

  @Patch(':id')
  @RequireAnyPermissions('clients:write', 'marketplace-api:write')
  update(@Param('id') id: string, @Body() dto: UpdateMarketplaceConnectionDto, @CurrentUser() user: AuthUser) {
    return this.connections.update(id, dto, user);
  }

  @Delete(':id')
  @RequireAnyPermissions('clients:write', 'marketplace-api:write')
  delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.connections.delete(id, user);
  }

  @Post(':id/sync-products')
  @RequireAnyPermissions('clients:write', 'marketplace-api:write')
  syncProducts(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.connections.syncProducts(id, user);
  }

  @Post(':id/check')
  @RequireAnyPermissions('clients:write', 'marketplace-api:write')
  checkConnection(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.connections.checkConnection(id, user);
  }
}
