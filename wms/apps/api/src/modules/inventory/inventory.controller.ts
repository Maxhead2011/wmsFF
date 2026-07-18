import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import {
  CompleteInventoryDto,
  CountInventoryItemDto,
  InventoryDecisionDto,
  OpenInventoryBoxDto,
  SetInventoryCountDto,
  StartInventoryDto,
} from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@RequirePermissions('stock:read')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.inventory.dashboard(user);
  }

  @Get('sessions')
  list(@Query('type') type: string | undefined, @CurrentUser() user: AuthUser) {
    return this.inventory.listSessions(type, user);
  }

  @Get('sessions/:id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inventory.getSession(id, user);
  }

  @Post('sessions')
  @RequirePermissions('stock:write')
  start(@Body() dto: StartInventoryDto, @CurrentUser() user: AuthUser) {
    return this.inventory.startSession(dto, user);
  }

  @Post('sessions/:id/boxes/open')
  @RequirePermissions('stock:write')
  openBox(@Param('id') id: string, @Body() dto: OpenInventoryBoxDto, @CurrentUser() user: AuthUser) {
    return this.inventory.openBox(id, dto.boxCode, user);
  }

  @Post('boxes/:id/scan')
  @RequirePermissions('stock:write')
  scan(@Param('id') id: string, @Body() dto: CountInventoryItemDto, @CurrentUser() user: AuthUser) {
    return this.inventory.scanItem(id, dto, user);
  }

  @Patch('boxes/:id/count')
  @RequirePermissions('stock:write')
  setCount(@Param('id') id: string, @Body() dto: SetInventoryCountDto, @CurrentUser() user: AuthUser) {
    return this.inventory.setCount(id, dto, user);
  }

  @Post('boxes/:id/finish')
  @RequirePermissions('stock:write')
  finishBox(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inventory.finishBox(id, user);
  }

  @Post('sessions/:id/review')
  @RequirePermissions('stock:write')
  review(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inventory.sendToReview(id, user);
  }

  @Patch('lines/:id/decision')
  @RequirePermissions('stock:write')
  decide(@Param('id') id: string, @Body() dto: InventoryDecisionDto, @CurrentUser() user: AuthUser) {
    return this.inventory.decideLine(id, dto, user);
  }

  @Post('sessions/:id/complete')
  @RequirePermissions('stock:write')
  complete(@Param('id') id: string, @Body() dto: CompleteInventoryDto, @CurrentUser() user: AuthUser) {
    return this.inventory.completeSession(id, dto.comment, user);
  }

  @Post('sessions/:id/cancel')
  @RequirePermissions('stock:write')
  cancel(@Param('id') id: string, @Body() dto: CompleteInventoryDto, @CurrentUser() user: AuthUser) {
    return this.inventory.cancelSession(id, dto.comment, user);
  }
}
