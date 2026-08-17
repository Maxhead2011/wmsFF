import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ServiceCenterService } from './service-center.service';
import type { TelegramNotificationSection } from '../client-notifications/telegram-notification.service';

@ApiTags('service')
@RequirePermissions('system:admin')
@Controller('service')
export class ServiceCenterController {
  constructor(private readonly serviceCenter: ServiceCenterService) {}

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
