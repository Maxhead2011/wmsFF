import { FboRouteDto } from './dto/fbo-route.dto';
import { onlinePlanView } from './online-plan-view';
import { Body, Query, Controller, Get, Param, Post, Res, StreamableFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { FboTwoStageService } from './fbo-two-stage.service';
import { FboActionDto } from './dto/fbo-action.dto';
import { TsdAuditInterceptor } from './tsd-audit.interceptor';
@ApiTags('tsd')
@ApiBearerAuth()
@Controller('tsd/requests/:id/fbo')
@UseInterceptors(TsdAuditInterceptor)
export class FboTwoStageController {
  constructor(private readonly fbo: FboTwoStageService) {}

  @Get()
  @RequirePermissions('stock:read')
  async plan(@Param('id') id: string, @CurrentUser() user: AuthUser, @Query() route:FboRouteDto = {}) {
    return onlinePlanView(await this.fbo.plan(id, user, route as Record<string, unknown>),route.view,route.offset);
  }

  @Post('actions')
  @RequirePermissions('stock:write')
  action(@Param('id') id: string, @Body() dto: FboActionDto, @CurrentUser() user: AuthUser) {
    return this.fbo.act(id, dto, user);
  }

  @Get('wb-packages.xlsx')
  @RequirePermissions('stock:read')
  async file(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const file = await this.fbo.wbFile(id, user);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    return new StreamableFile(file.content);
  }
}
