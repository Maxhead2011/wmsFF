import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { MobileDeviceDto } from './dto/mobile-device.dto';
import { MobileLoginDto } from './dto/mobile-login.dto';
import { MobileEventListDto, MobileListDto } from './dto/mobile-list.dto';
import { MobileLogoutDto, MobileRefreshDto } from './dto/mobile-refresh.dto';
import { MobileAuthService } from './mobile-auth.service';
import { MobileService } from './mobile.service';

@ApiTags('mobile')
@Controller('mobile')
export class MobileController {
  constructor(
    private readonly auth: MobileAuthService,
    private readonly mobile: MobileService,
  ) {}

  @Public()
  @Post('auth/login')
  login(@Body() dto: MobileLoginDto, @Req() request: Request) {
    return this.auth.login(dto, { ip: request.ip, userAgent: request.headers['user-agent'] });
  }

  @Public()
  @Post('auth/refresh')
  refresh(@Body() dto: MobileRefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('auth/logout')
  @ApiBearerAuth()
  logout(@CurrentUser() user: AuthUser, @Body() dto: MobileLogoutDto) {
    return this.auth.logout(user, dto.allDevices === true);
  }

  @Get('auth/sessions')
  @ApiBearerAuth()
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user);
  }

  @Delete('auth/sessions/:id')
  @ApiBearerAuth()
  revokeSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.auth.revokeSession(user, id);
  }

  @Post('devices')
  @ApiBearerAuth()
  registerDevice(@CurrentUser() user: AuthUser, @Body() dto: MobileDeviceDto) {
    return this.mobile.registerDevice(user, dto);
  }

  @Get('bootstrap')
  @ApiBearerAuth()
  bootstrap(@CurrentUser() user: AuthUser) {
    return this.mobile.bootstrap(user);
  }

  @Get('dashboard')
  @ApiBearerAuth()
  dashboard(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.mobile.dashboard(user, clientId);
  }

  @Get('requests')
  @ApiBearerAuth()
  requests(@CurrentUser() user: AuthUser, @Query() query: MobileListDto) {
    return this.mobile.listRequests(user, query);
  }

  @Get('invoices')
  @ApiBearerAuth()
  invoices(@CurrentUser() user: AuthUser, @Query() query: MobileListDto) {
    return this.mobile.listInvoices(user, query);
  }

  @Get('online-receipts')
  @ApiBearerAuth()
  onlineReceipts(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    if (!clientId) throw new BadRequestException('Выберите клиента.');
    return this.mobile.onlineReceipts(user, clientId);
  }

  @Get('modules/:module')
  @ApiBearerAuth()
  nativeModule(@CurrentUser() user: AuthUser, @Param('module') module: string, @Query() query: MobileListDto) {
    return this.mobile.nativeModule(user, module, query);
  }

  @Get('notifications')
  @ApiBearerAuth()
  notifications(@CurrentUser() user: AuthUser, @Query() query: MobileListDto) {
    return this.mobile.listNotifications(user, query);
  }

  @Patch('notifications/:id/read')
  @ApiBearerAuth()
  markNotificationRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mobile.markNotificationRead(user, id);
  }

  @Patch('notifications/read-all')
  @ApiBearerAuth()
  markAllNotificationsRead(@CurrentUser() user: AuthUser, @Body('clientId') clientId?: string) {
    return this.mobile.markAllNotificationsRead(user, clientId);
  }

  @Get('events')
  @ApiBearerAuth()
  events(@CurrentUser() user: AuthUser, @Query() query: MobileEventListDto) {
    return this.mobile.events(user, query);
  }

  @Public()
  @Get('app-version')
  appVersion() {
    return this.mobile.appVersion();
  }
}
