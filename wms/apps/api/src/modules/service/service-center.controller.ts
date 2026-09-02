import { Body, Controller, Get, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ServiceCenterService } from './service-center.service';
import type { TelegramNotificationSection } from '../client-notifications/telegram-notification.service';
import { StorageOptimizationService } from './storage-optimization.service';

@ApiTags('service')
@RequirePermissions('system:admin')
@Controller('service')
export class ServiceCenterController {
  constructor(
    private readonly serviceCenter: ServiceCenterService,
    private readonly storageOptimization: StorageOptimizationService,
  ) {}

  @Get('clients/:clientId/storage-optimization')
  getStorageOptimization(@Param('clientId') clientId: string) {
    // FIX: report generation is read-only and scoped to the selected client.
    return this.storageOptimization.buildReport(clientId);
  }

  @Get('clients/:clientId/storage-optimization.xlsx')
  async downloadStorageOptimization(
    @Param('clientId') clientId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.storageOptimization.buildReportFile(clientId);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));
    return new StreamableFile(file.content);
  }

  @Get('clients/:clientId/stock-cleanup')
  getClientStockCleanupPreview(@Param('clientId') clientId: string) {
    return this.serviceCenter.getClientStockCleanupPreview(clientId);
  }

  @Post('clients/:clientId/stock-cleanup')
  purgeClientStock(
    @Param('clientId') clientId: string,
    @Body('confirmation') confirmation: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceCenter.purgeClientStock(clientId, confirmation, user);
  }

  @Get('clients/:clientId/requests-cleanup')
  getClientRequestsCleanupPreview(@Param('clientId') clientId: string) {
    return this.serviceCenter.getClientRequestsCleanupPreview(clientId);
  }

  @Post('clients/:clientId/requests-cleanup')
  purgeClientRequests(
    @Param('clientId') clientId: string,
    @Body('confirmation') confirmation: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceCenter.purgeClientRequests(clientId, confirmation, user);
  }

  @Get('maintenance')
  getMaintenanceMode() {
    return this.serviceCenter.getMaintenanceMode();
  }

  @Patch('maintenance')
  updateMaintenanceMode(
    @Body() payload: { enabled?: boolean; message?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceCenter.updateMaintenanceMode(payload, user);
  }

  @Get('sessions')
  listRecentSessions() {
    return this.serviceCenter.listRecentSessions();
  }

  @Post('sessions/:sessionId/close')
  closeSession(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.serviceCenter.closeSession(sessionId, user);
  }

  @Get('telegram')
  getTelegramSettings(@Query('clientId') clientId?: string) {
    return this.serviceCenter.getTelegramSettings(clientId);
  }

  @Get('telegram/groups')
  listTelegramGroups() {
    return this.serviceCenter.listTelegramGroups();
  }

  @Patch('telegram/global')
  updateTelegramGlobalSettings(
    @Body() payload: { enabled?: boolean; botToken?: string; fulfillmentChatIds?: string[]; sections?: TelegramNotificationSection[] },
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceCenter.updateTelegramGlobalSettings(payload, user);
  }

  @Patch('telegram/clients/:clientId')
  updateTelegramClientSettings(
    @Param('clientId') clientId: string,
    @Body() payload: { enabled?: boolean; chatId?: string; sections?: TelegramNotificationSection[] },
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceCenter.updateTelegramClientSettings(clientId, payload, user);
  }

  @Post('telegram/test/fulfillment')
  testTelegramFulfillment() {
    return this.serviceCenter.testTelegramFulfillment();
  }

  @Post('telegram/test/clients/:clientId')
  testTelegramClient(@Param('clientId') clientId: string) {
    return this.serviceCenter.testTelegramClient(clientId);
  }

  @Get('kiz')
  searchProductMarks(@Query('clientId') clientId?: string, @Query('search') search?: string) {
    return this.serviceCenter.searchProductMarks({ clientId, search });
  }
}

function contentDisposition(fileName: string) {
  const fallback = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
