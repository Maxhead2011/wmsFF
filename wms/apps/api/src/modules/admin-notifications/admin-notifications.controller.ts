import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { AdminNotificationsService } from './admin-notifications.service';
class FeedQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) beforeId?: number;
}
// FIX: role and object scope are enforced by the service for every endpoint.
@ApiTags('admin-notifications')
@Controller('admin-notifications')
export class AdminNotificationsController {
  constructor(private readonly notifications: AdminNotificationsService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query() query: FeedQuery) { return this.notifications.list(user, query.beforeId); }
  @Post(':id/read') read(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) { return this.notifications.markRead(id, user); }
  @Post(':id/popup') popup(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) { return this.notifications.claimPopup(id, user); }
}
