import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ListTurnoverDto, TurnoverBoxDetailsDto, TurnoverStatisticsDto, TurnoverStockExportDto, TurnoverSuggestionsDto } from './dto/list-turnover.dto';
import { TurnoverActionDto } from './dto/turnover-action.dto';
import { TurnoverService } from './turnover.service';

@ApiTags('turnover')
@RequirePermissions('stock:read')
@Controller('turnover')
export class TurnoverController {
  constructor(private readonly turnover: TurnoverService) {}

  @Get('suggestions')
  suggestions(@Query() query: TurnoverSuggestionsDto, @CurrentUser() user: AuthUser) {
    return this.turnover.suggestions(query, user);
  }

  @Get('receipts.xlsx')
  async receiptPeriodXlsx(
    @Query() query: ListTurnoverDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.turnover.getReceiptPeriodXlsx(query, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.content);
  }

  @Get('stock.xlsx')
  async stockXlsx(
    @Query() query: TurnoverStockExportDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.turnover.getStockXlsx(query, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.content);
  }

  @Get('boxes/:boxCode')
  boxDetails(@Param('boxCode') boxCode: string, @Query() query: TurnoverBoxDetailsDto, @CurrentUser() user: AuthUser) {
    return this.turnover.boxDetails(boxCode, query, user);
  }

  @Get()
  list(@Query() query: ListTurnoverDto, @CurrentUser() user: AuthUser) {
    return this.turnover.list(query, user);
  }

  @Get('statistics')
  statistics(@Query() query: TurnoverStatisticsDto, @CurrentUser() user: AuthUser) {
    return this.turnover.statistics(query, user);
  }

  @Get('movements/:movementId/document')
  movementDocument(@Param('movementId') movementId: string, @CurrentUser() user: AuthUser) {
    return this.turnover.getReceiptDocument(movementId, user);
  }

  @Get('movements/:movementId/document.xlsx')
  async movementDocumentXlsx(
    @Param('movementId') movementId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.turnover.getReceiptDocumentXlsx(movementId, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.content);
  }

  @Post('actions')
  @RequirePermissions('stock:write')
  runAction(@Body() dto: TurnoverActionDto, @CurrentUser() user: AuthUser) {
    return this.turnover.runAction(dto, user);
  }
}

function contentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^\x20-\x7E]+/g, '_').replace(/"/g, '');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
