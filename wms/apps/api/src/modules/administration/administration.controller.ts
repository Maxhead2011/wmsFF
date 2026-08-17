import { Body, Controller, Get, Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAnyPermissions } from '../auth/decorators/require-permissions.decorator';
import { AdministrationService } from './administration.service';
import { PhantomStockService } from './phantom-stock.service';
import { AdministrationTechnicalWorkService } from './administration-technical-work.service';

@ApiTags('administration')
@ApiBearerAuth()
@RequireAnyPermissions('system:admin', 'administration:demo')
@Controller('administration')
export class AdministrationController {
  constructor(
    private readonly administration: AdministrationService,
    private readonly technicalWork: AdministrationTechnicalWorkService,
    private readonly phantomStock: PhantomStockService,
  ) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.administration.overview(user);
  }

  // ADDED: Central technical-work registry. Every returned action maps to a real server repair.
  @Get('technical-work')
  technicalWorkOverview(@CurrentUser() user: AuthUser) {
    return this.technicalWork.overview(user);
  }

  @Post('technical-work/diagnose')
  diagnoseTechnicalWork(
    @Body() body: { category?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.technicalWork.diagnose(body.category, user);
  }

  @Post('technical-work/apply')
  applyTechnicalWork(
    @Body() body: {
      issueId?: string;
      action?: string;
      confirmation?: string;
      comment?: string;
    },
    @CurrentUser() user: AuthUser,
  ) {
    return this.technicalWork.apply(body, user);
  }

  // ADDED: Bulk endpoint keeps one category and one whitelisted action per run.
  @Post('technical-work/apply-bulk')
  applyTechnicalWorkBulk(
    @Body() body: {
      category?: string;
      issueIds?: unknown;
      action?: string;
      confirmation?: string;
      comment?: string;
    },
    @CurrentUser() user: AuthUser,
  ) {
    return this.technicalWork.applyBulk(body, user);
  }

  // ADDED: Physical scan preview never changes placement.
  @Post('technical-work/pallet-sorts/scan-preview')
  previewPalletSortScan(
    @Body() body: { palletCode?: string; boxCodes?: unknown },
    @CurrentUser() user: AuthUser,
  ) {
    return this.technicalWork.previewPalletSortScan(body, user);
  }

  // ADDED: Apply revalidates the exact pallet and boxes scanned by the operator.
  @Post('technical-work/pallet-sorts/scan-apply')
  applyPalletSortScan(
    @Body() body: { palletCode?: string; boxCodes?: unknown; confirmation?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.technicalWork.applyPalletSortScan(body, user);
  }

  @Get('settings')
  settings(@CurrentUser() user: AuthUser) {
    return this.administration.listSettings(user);
  }

  @Patch('settings/:key')
  updateSetting(
    @Param('key') key: string,
    @Body() body: { value?: unknown; reason?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.updateSetting(key, body.value, body.reason, user);
  }

  @Get('users/workspaces')
  workspaceVisibility(@CurrentUser() user: AuthUser) {
    return this.administration.listWorkspaceVisibility(user);
  }

  @Put('users/:userId/workspaces')
  updateWorkspaceVisibility(
    @Param('userId') userId: string,
    @Body() body: { overrides?: Record<string, boolean>; reason?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.updateWorkspaceVisibility(
      userId,
      body.overrides,
      body.reason,
      user,
    );
  }

  @Post('marketplaces/diagnostics')
  marketplaceDiagnostics(
    @Body() body: { clientId?: string; connectionId?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.diagnoseMarketplaceConnections(body, user);
  }

  @Post('performance/optimize')
  optimizePerformance(@CurrentUser() user: AuthUser) {
    return this.administration.optimizePerformance(user);
  }

  @Get('fbs-request-errors/requests')
  fbsRequestErrors(@CurrentUser() user: AuthUser) {
    return this.administration.listFbsRequestErrors(user);
  }

  @Post('fbs-request-errors/check')
  checkFbsRequestErrors(
    @Body() body: { requestId?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.checkFbsRequestErrors(body.requestId, user);
  }

  @Post('fbs-request-errors/repair')
  repairFbsRequestErrors(
    @Body() body: { requestId?: string; confirmation?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.repairFbsRequestErrors(body.requestId, body.confirmation, user);
  }

  @Get('tsd-workloads')
  tsdWorkloads(@CurrentUser() user: AuthUser) {
    return this.administration.listTsdWorkloads(user);
  }

  @Get('tsd-monitor')
  tsdMonitor(
    @Query('statisticsDate') statisticsDate: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.listTsdMonitor(user, statisticsDate);
  }

  @Post('tsd-monitor/devices/:deviceCode/action')
  tsdMonitorAction(
    @Param('deviceCode') deviceCode: string,
    @Body() body: { action?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.issueTsdMonitorAction(deviceCode, body.action, user);
  }

  @Post('tsd-workloads/release')
  releaseTsdWorkload(
    @Body() body: { kind?: string; workloadId?: string; requestId?: string; deviceCode?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.releaseTsdWorkload(body, user);
  }

  @Post('tsd-workloads/disconnect-request')
  disconnectTsdRequest(
    @Body() body: { requestId?: string; deviceCode?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.disconnectTsdRequest(body, user);
  }

  @Get('phantom-stocks')
  phantomStocks() {
    return this.phantomStock.overview();
  }

  @Post('phantom-stocks/fix-all')
  fixAllPhantomStocks(@CurrentUser() user: AuthUser) {
    return this.phantomStock.fixAll(user);
  }

  @Post('phantom-stocks/:balanceId/fix')
  fixPhantomStock(@Param('balanceId') balanceId: string, @CurrentUser() user: AuthUser) {
    return this.phantomStock.fix(balanceId, user);
  }

  @Post('stocks/compare-file')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  compareStockFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('clientId') clientId: string | undefined,
    @Query('warehouseId') warehouseId: string | undefined,
    @Query('connectionId') connectionId: string | undefined,
    @Query('marketplaceWarehouseId') marketplaceWarehouseId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.compareWbStockFile(file, clientId, warehouseId, connectionId, marketplaceWarehouseId, user);
  }

  @Post('stocks/compare-wb')
  compareStockFromWb(
    @Body() body: { clientId?: string; warehouseId?: string; connectionId?: string; marketplaceWarehouseId?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.compareWbStockApi(
      body.clientId,
      body.warehouseId,
      body.connectionId,
      body.marketplaceWarehouseId,
      user,
    );
  }

  @Get('audit')
  audit(
    @Query('search') search: string | undefined,
    @Query('take') take: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.listAudit(search, take, user);
  }

  @Post('assistant/preview')
  assistantPreview(
    @Body() body: { prompt?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.previewAssistantChange(body.prompt, user);
  }

  @Post('assistant/apply')
  assistantApply(
    @Body() body: { previewId?: string; confirmation?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.administration.applyAssistantChange(
      body.previewId,
      body.confirmation,
      user,
    );
  }

  @Get('documentation')
  documentation(@CurrentUser() user: AuthUser) {
    return this.administration.documentation(user);
  }
}
