import { Body, Controller, Get, Inject, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { WmsStockAvailabilityService } from '../stock/wms-stock-availability.service';
import { FbsBoxReportDto, FbsShipmentReportDto, WmsAvailabilityReportDto } from './dto/fbs-stock-reports.dto';
import { ListTurnoverDto, TurnoverBoxDetailsDto, TurnoverStatisticsDto, TurnoverStockExportDto, TurnoverSuggestionsDto } from './dto/list-turnover.dto';
import { TurnoverKizReportDto } from './dto/turnover-kiz-report.dto';
import { TurnoverActionDto } from './dto/turnover-action.dto';
import { FbsStockReportsService } from './fbs-stock-reports.service';
import { TurnoverService } from './turnover.service';

@ApiTags('turnover')
@RequirePermissions('stock:read')
@Controller('turnover')
export class TurnoverController {
  constructor(
    @Inject(TurnoverService) private readonly turnover: TurnoverService,
    @Inject(FbsStockReportsService) private readonly fbsStockReports: FbsStockReportsService,
    @Inject(WmsStockAvailabilityService) private readonly stockAvailability: WmsStockAvailabilityService,
  ) {}

  // ADDED: isolated read-only reporting endpoints reuse real WMS relations and
  // do not mutate stock, FBS requests or TSD tasks.
  @Get('fbs-stock-reports/shipments')
  fbsShipments(@Query() query: FbsShipmentReportDto, @CurrentUser() user: AuthUser) {
    return this.fbsStockReports.shipments(query, user);
  }

  @Get('fbs-stock-reports/availability')
  async wmsAvailability(@Query() query: WmsAvailabilityReportDto, @CurrentUser() user: AuthUser) {
    const snapshot = await this.stockAvailability.snapshot(query.clientId, user, { warehouseId: query.warehouseId });
    return {
      totals: snapshot.totals,
      missingBarcodeCount: snapshot.missingBarcodeCount,
      generatedAt: snapshot.generatedAt,
    };
  }

  @Get('fbs-stock-reports/shipments.xlsx')
  async fbsShipmentsXlsx(
    @Query() query: FbsShipmentReportDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.fbsStockReports.exportShipments(query, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.size));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));
    const stream = createReadStream(file.filePath);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      void file.cleanup();
    };
    stream.once('close', cleanup);
    stream.once('error', cleanup);
    return new StreamableFile(stream);
  }

  @Get('fbs-stock-reports/boxes')
  fbsBoxes(@Query() query: FbsBoxReportDto, @CurrentUser() user: AuthUser) {
    return this.fbsStockReports.boxes(query, user);
  }

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

  // ADDED: таблица и Excel используют один и тот же проверенный источник истории отгрузок.
  @Get('kiz-report')
  kizReport(@Query() query: TurnoverKizReportDto, @CurrentUser() user: AuthUser) {
    return this.turnover.kizReport(query, user);
  }

  @Get('kiz-report.xlsx')
  async kizReportXlsx(
    @Query() query: TurnoverKizReportDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.turnover.getKizReportXlsx(query, user);
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
