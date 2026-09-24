import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile, UseInterceptors } from '@nestjs/common';
import { FboRouteDto } from './dto/fbo-route.dto';
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
  plan(@Param('id') id: string, @CurrentUser() user: AuthUser, @Query() route: FboRouteDto) {
    return this.fbo.plan(id, user, route);
  }

  @Post('actions')
  @RequirePermissions('stock:write')
  action(@Param('id') id: string, @Body() dto: FboActionDto, @CurrentUser() user: AuthUser) {
    return this.fbo.act(id, dto, user);
  }

  // FIX: both files are guarded by the same completed shipment check and user scope.
  @Get('wb-products.xlsx')
  @RequirePermissions('stock:read')
  async products(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const file = await this.fbo.wbFile(id, user, 'products');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    return new StreamableFile(file.content);
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
