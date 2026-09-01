import { Body, Controller, Get, Param, Patch, Post, Query, Res, StreamableFile, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ResolveTsdReviewDto } from './dto/resolve-tsd-review.dto';
import { ListTsdOperationHistoryDto } from './dto/list-tsd-operation-history.dto';
import { ScanOperationDto, SyncTsdOperationsDto } from './dto/scan-operation.dto';
import { TsdReviewService } from './tsd-review.service';
import { TsdSyncService } from './tsd-sync.service';
import { TsdAuditInterceptor } from './tsd-audit.interceptor';

@ApiTags('tsd')
@RequirePermissions('stock:write')
@UseInterceptors(TsdAuditInterceptor)
@Controller('tsd')
export class TsdSyncController {
  constructor(
    private readonly sync: TsdSyncService,
    private readonly review: TsdReviewService,
  ) {}

  @Get('review')
  @RequirePermissions('stock:write')
  listReviewQueue(@CurrentUser() user: AuthUser) {
    return this.sync.listReviewQueue(user);
  }

  @Get('review/history')
  @RequirePermissions('stock:write')
  listReviewHistory(@CurrentUser() user: AuthUser) {
    return this.review.listReviewHistory(user);
  }

  @Get('history')
  @RequirePermissions('stock:write')
  listOperationHistory(
    @Query() query: ListTsdOperationHistoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.review.listOperationHistory(user, query);
  }

  @Get('history/:id')
  @RequirePermissions('stock:write')
  getOperationHistoryItem(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.review.getOperationHistoryItem(id, user);
  }

  @Get('history/:id/screenshot')
  @RequirePermissions('stock:write')
  async getOperationScreenshot(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const screenshot = await this.review.getOperationScreenshot(id, user);
    response.setHeader('Content-Type', screenshot.mimeType);
    response.setHeader('Content-Length', String(screenshot.content.length));
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('Content-Disposition', `inline; filename="tsd-${id}.jpg"`);
    return new StreamableFile(screenshot.content);
  }

  @Get('review/receipts')
  @RequirePermissions('stock:write')
  listReceiptReviewDashboard(@CurrentUser() user: AuthUser) {
    return this.review.listReceiptReviewDashboard(user);
  }

  @Get('review/receipts.xlsx')
  @RequirePermissions('stock:write')
  async downloadReceiptReviewBoxes(
    @Query('clientId') clientId: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.review.getReceiptReviewBoxesXlsx(user, clientId);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));
    return new StreamableFile(file.content);
  }

  @Post('operations')
  acceptOperation(@Body() operation: ScanOperationDto, @CurrentUser() user: AuthUser) {
    return this.sync.acceptOperation(operation, user);
  }

  @Post('sync')
  syncOperations(@Body() dto: SyncTsdOperationsDto, @CurrentUser() user: AuthUser) {
    return this.sync.syncOperations(dto, user);
  }

  @Patch('review/:id')
  @RequirePermissions('stock:write')
  resolveReviewOperation(
    @Param('id') id: string,
    @Body() dto: ResolveTsdReviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.review.resolveReviewOperation(id, dto, user);
  }
}

function contentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^\x20-\x7E]+/g, '_').replace(/"/g, '');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
