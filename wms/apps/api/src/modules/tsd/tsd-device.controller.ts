import { Body, Controller, Delete, Get, Param, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { MarketplaceConnectionsService } from '../marketplace-connections/marketplace-connections.service';
import { ResolveFbsSyncConflictDto } from '../marketplace-connections/dto/resolve-fbs-sync-conflict.dto';
import { StockOperationsService } from '../stock/stock-operations.service';
import { StorageLocationsService } from '../warehouse/storage-locations.service';
import { CreateTsdDeviceDto } from './dto/create-tsd-device.dto';
import { LoginTsdDeviceDto } from './dto/login-tsd-device.dto';
import { TsdAssemblyService } from './tsd-assembly.service';
import { TsdDeviceService } from './tsd-device.service';
import { TsdReceiptService } from './tsd-receipt.service';
import { TsdAuditInterceptor } from './tsd-audit.interceptor';
import { SkuCollectionService } from '../inventory/sku-collection.service';
import { ScanSkuCollectionPickDto, ScanSkuCollectionReceiptDto } from '../inventory/dto/sku-collection.dto';

@ApiTags('tsd')
@UseInterceptors(TsdAuditInterceptor)
@Controller('tsd')
export class TsdDeviceController {
  constructor(
    private readonly devices: TsdDeviceService,
    private readonly assembly: TsdAssemblyService,
    private readonly receipts: TsdReceiptService,
    private readonly marketplace: MarketplaceConnectionsService,
    private readonly storageLocations: StorageLocationsService,
    private readonly stockOperations: StockOperationsService,
    private readonly skuCollections: SkuCollectionService,
  ) {}

  @Get('sku-collections')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  listSkuCollections(@CurrentUser() user: AuthUser) {
    return this.skuCollections.list(user);
  }

  @Get('sku-collections/:id')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  getSkuCollection(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.skuCollections.get(id, user);
  }

  @Post('sku-collections/:id/pick')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  pickSkuCollection(
    @Param('id') id: string,
    @Body() dto: ScanSkuCollectionPickDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.skuCollections.pick(id, dto, user);
  }

  @Post('sku-collections/:id/receive')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  receiveSkuCollection(
    @Param('id') id: string,
    @Body() dto: ScanSkuCollectionReceiptDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.skuCollections.receive(id, dto, user);
  }

  @Get('storage-pallet/current')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  currentStoragePallet(
    @Query('deviceCode') deviceCode: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.storageLocations.getCurrentTsdPallet(deviceCode || user.deviceCode, user);
  }

  @Post('storage-pallet/open')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  openStoragePallet(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.storageLocations.openTsdPallet(body, user);
  }

  @Post('storage-pallet/:id/scan-box')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanStoragePalletBox(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.storageLocations.scanTsdPalletBox(id, body, user);
  }

  @Post('storage-pallet/:id/restore-box')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  restoreStoragePalletBox(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.storageLocations.restoreTsdPalletBox(id, body, user);
  }

  @Post('storage-pallet/:id/close')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  closeStoragePallet(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.storageLocations.closeTsdPallet(id, user);
  }

  @Delete('storage-pallet/:id')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  deleteStoragePallet(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.storageLocations.deleteTsdPallet(id, user);
  }

  @Get('clients')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  listClients(@CurrentUser() user: AuthUser) {
    return this.devices.listClientsForDevice(user);
  }

  @Get('transfers/source')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  inspectTransferSource(
    @Query('boxCode') boxCode: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stockOperations.inspectTsdTransferSource(boxCode, user);
  }

  @Post('transfers/item')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  inspectTransferItem(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stockOperations.inspectTsdTransferItem(body, user);
  }

  @Post('transfers/execute')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  executeTransfer(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stockOperations.executeTsdTransfer(body, user);
  }

  @Post('transfers/execute-batch')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  executeTransferBatch(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stockOperations.executeTsdTransferBatch(body, user);
  }

  @Get('fbs/next')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  getNextFbsAssembly(
    @Query('deviceCode') deviceCode: string | undefined,
    @Query('requestId') requestId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.getNextFbsTsdAssembly(deviceCode, user, requestId);
  }

  @Get('fbs/requests')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  listFbsAssemblyRequests(
    @Query('deviceCode') deviceCode: string | undefined,
    @Query('archive') archive: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.listFbsTsdRequests(deviceCode, user, archive);
  }

  @Get('fbs/cargo')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  getFbsCargoPacking(
    @Query('deviceCode') deviceCode: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.getFbsCargoPackingQueue(deviceCode, user);
  }

  @Post('fbs/cargo/open')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  openFbsCargoPacking(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.marketplace.openFbsCargoPacking(body, user);
  }

  @Post('fbs/cargo/:id/scan-order')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanFbsCargoOrder(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.scanFbsCargoOrder(id, body, user);
  }

  @Post('fbs/cargo/:id/undo-last')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  undoLastFbsCargoOrder(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.marketplace.undoLastFbsCargoOrder(id, user);
  }

  @Post('fbs/cargo/:id/cancel')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  cancelFbsCargoPacking(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.marketplace.cancelFbsCargoPacking(id, user);
  }

  @Post('fbs/cargo/:id/close')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  closeFbsCargoPacking(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.marketplace.closeFbsCargoPacking(id, user);
  }

  @Post('fbs/tasks/:id/scan-box')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanFbsBox(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.scanFbsTsdBox(id, body, user);
  }

  @Post('fbs/tasks/:id/scan')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanFbsCode(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.scanFbsTsdCode(id, body, user);
  }

  @Post('fbs/tasks/:id/scan-barcode')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanFbsBarcode(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.scanFbsTsdBarcode(id, body, user);
  }

  @Post('fbs/tasks/:id/scan-kiz')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanFbsKiz(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.scanFbsTsdKiz(id, body, user);
  }

  @Post('fbs/tasks/:id/undo-kiz')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  undoFbsKiz(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.marketplace.undoFbsTsdKiz(id, user);
  }

  @Post('fbs/tasks/:id/complete')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  completeFbsAssembly(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.marketplace.completeFbsTsdAssembly(id, user);
  }

  @Post('fbs/tasks/:id/release')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  releaseFbsAssembly(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.marketplace.releaseFbsTsdAssembly(id, user);
  }

  @Get('requests')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  listAssemblyRequests(@CurrentUser() user: AuthUser) {
    return this.assembly.listActiveRequests(user);
  }

  @Get('requests/active')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  listActiveAssemblyRequests(@CurrentUser() user: AuthUser) {
    return this.assembly.listActiveRequests(user);
  }

  @Get('requests/:id')
  @ApiBearerAuth()
  @RequirePermissions('stock:read')
  getAssemblyRequest(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assembly.getRequestPlan(id, user);
  }

  @Post('requests/:id/fbs-kiz-conflicts/:taskId/resolve')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  resolveFbsKizConflict(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.resolveFbsKizConflict(id, taskId, user);
  }

  @Post('requests/:id/fbs-sync-conflicts/:taskId/resolve')
  @ApiBearerAuth()
  @RequirePermissions('client-requests:write')
  resolveFbsSyncConflict(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() body: ResolveFbsSyncConflictDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.resolveFbsSyncConflict(id, taskId, body, user);
  }

  @Post('requests/:id/fbs-assembly/:taskId/reset')
  @ApiBearerAuth()
  @RequirePermissions('client-requests:write')
  resetFbsAssemblyOrder(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.resetFbsAssemblyOrder(id, taskId, user);
  }

  @Post('requests/:id/fbs-assembly/:taskId/packed-without-source')
  @ApiBearerAuth()
  @RequirePermissions('client-requests:write')
  markFbsAssemblyPackedWithoutSource(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.markFbsAssemblyPackedWithoutSource(id, taskId, user);
  }

  @Post('requests/:id/fbs-rescan/:taskId/restore-from-wb')
  @ApiBearerAuth()
  @RequirePermissions('client-requests:write')
  restoreFbsRescanFromWildberries(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.restoreFbsRescanFromWildberries(id, taskId, user);
  }

  @Get('requests/:id/outgoing-boxes.xlsx')
  @ApiBearerAuth()
  @RequirePermissions('stock:read')
  async downloadOutgoingBoxes(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.assembly.getOutgoingBoxesXlsx(id, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.content);
  }

  @Get('requests/:id/outgoing-contents.xlsx')
  @ApiBearerAuth()
  @RequirePermissions('stock:read')
  async downloadOutgoingContents(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.assembly.getOutgoingContentsXlsx(id, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.content);
  }

  @Get('requests/:id/movements.xlsx')
  @ApiBearerAuth()
  @RequirePermissions('stock:read')
  async downloadMovements(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.assembly.getMovementsXlsx(id, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.content);
  }

  @Get('requests/:id/box-search')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  getBoxSearch(@Param('id') id: string, @Query() query: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    if (hasScanPayload(query)) {
      return this.assembly.handleStageAction(id, 'box-search', 'scan', mergeActionPayload(undefined, query), user);
    }
    return this.assembly.getRequestStage(id, 'box-search', user);
  }

  @Post('requests/:id/box-search/scan')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanBoxSearch(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'box-search', 'scan', mergeActionPayload(body, query), user);
  }

  @Get('requests/:id/box-search/scan')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanBoxSearchByGet(@Param('id') id: string, @Query() query: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.assembly.handleStageAction(id, 'box-search', 'scan', mergeActionPayload(undefined, query), user);
  }

  @Post('requests/:id/box-search/scan/:code')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanBoxSearchByPostPath(
    @Param('id') id: string,
    @Param('code') code: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'box-search', 'scan', mergeActionPayload(body, query, { code }), user);
  }

  @Get('requests/:id/box-search/scan/:code')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanBoxSearchByGetPath(
    @Param('id') id: string,
    @Param('code') code: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'box-search', 'scan', mergeActionPayload(undefined, query, { code }), user);
  }

  @Post('requests/:id/box-search/:code')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanBoxSearchByLegacyPostPath(
    @Param('id') id: string,
    @Param('code') code: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'box-search', 'scan', mergeActionPayload(body, query, { code }), user);
  }

  @Get('requests/:id/box-search/:code')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanBoxSearchByLegacyGetPath(
    @Param('id') id: string,
    @Param('code') code: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'box-search', 'scan', mergeActionPayload(undefined, query, { code }), user);
  }

  @Get('requests/:id/relabel')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  getRelabel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assembly.getRequestStage(id, 'relabel', user);
  }

  @Post('requests/:id/relabel/scan-source')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanRelabelSource(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'relabel', 'scan-source', mergeActionPayload(body, query), user);
  }

  @Post('requests/:id/relabel/scan-target')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanRelabelTarget(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'relabel', 'scan-target', mergeActionPayload(body, query), user);
  }

  @Get('requests/:id/moves')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  getMoves(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assembly.getRequestStage(id, 'moves', user);
  }

  @Post('requests/:id/moves/target-box')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanMoveTargetBox(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'moves', 'target-box', mergeActionPayload(body, query), user);
  }

  @Post('requests/:id/moves/scan-item')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanMoveItem(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'moves', 'scan-item', mergeActionPayload(body, query), user);
  }

  @Post('requests/:id/moves/finish')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  finishMoves(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'moves', 'finish', mergeActionPayload(body, query), user);
  }

  @Get('requests/:id/boxless-packing')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  getBoxlessPacking(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assembly.getRequestStage(id, 'boxless-packing', user);
  }

  @Post('requests/:id/boxless-packing/open-box')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  openBoxlessBox(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'boxless-packing', 'open-box', mergeActionPayload(body, query), user);
  }

  @Post('requests/:id/boxless-packing/scan-item')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanBoxlessItem(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'boxless-packing', 'scan-item', mergeActionPayload(body, query), user);
  }

  @Post('requests/:id/boxless-packing/close-box')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  closeBoxlessBox(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'boxless-packing', 'close-box', mergeActionPayload(body, query), user);
  }

  @Post('requests/:id/boxless-packing/finish')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  finishBoxlessPacking(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'boxless-packing', 'finish', mergeActionPayload(body, query), user);
  }

  @Get('sku-by-barcode')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  findSkuByBarcode(
    @Query('clientId') clientId: string | undefined,
    @Query('barcode') barcode: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.findSkuByBarcode({ clientId, barcode }, user);
  }

  @Get('receipts/check-kiz')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  checkReceiptKiz(
    @Query('clientId') clientId: string | undefined,
    @Query('kiz') kiz: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.receipts.checkKiz(clientId, kiz, user);
  }

  @Post('receipts/open-box')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  openReceiptBox(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.receipts.openBox(body, user);
  }

  @Get('devices')
  @ApiBearerAuth()
  @RequirePermissions('users:read')
  listDevices() {
    return this.devices.listDevices();
  }

  @Post('monitor/heartbeat')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  monitorHeartbeat(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.devices.recordMonitorHeartbeat(body, user);
  }

  @Post('monitor/error')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  monitorError(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.devices.recordMonitorError(body, user);
  }

  @Post('monitor/error/:id/screenshot')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  @UseInterceptors(FileInterceptor('screenshot', { limits: { fileSize: 750 * 1024 } }))
  uploadMonitorErrorScreenshot(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.devices.attachMonitorErrorScreenshot(id, file, user);
  }

  @Post('devices')
  @ApiBearerAuth()
  @RequirePermissions('users:write')
  createDevice(@Body() dto: CreateTsdDeviceDto) {
    return this.devices.createDevice(dto);
  }

  @Post('login')
  @Public()
  login(@Body() dto: LoginTsdDeviceDto) {
    return this.devices.login(dto);
  }
}

function mergeActionPayload(
  body: unknown,
  query: Record<string, unknown> | undefined,
  extra: Record<string, unknown> | undefined = undefined,
) {
  const payload: Record<string, unknown> = {
    ...(query ?? {}),
    ...(extra ?? {}),
  };

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return {
      ...payload,
      ...(body as Record<string, unknown>),
    };
  }

  if (typeof body === 'string' && body.trim()) {
    return {
      ...payload,
      scan: body.trim(),
    };
  }

  return payload;
}

function hasScanPayload(query: Record<string, unknown> | undefined) {
  if (!query) {
    return false;
  }
  const ignored = new Set(['deviceCode', 'device', 'token', 'stage', 'action', 'ts', 'timestamp']);
  return Object.keys(query).some((key) => !ignored.has(key) && query[key] != null && String(query[key]).trim() !== '');
}

function contentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^\x20-\x7E]+/g, '_').replace(/"/g, '');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
