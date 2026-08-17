import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreatePickWaveDto } from './dto/create-pick-wave.dto';
import { FulfillClientRequestDto } from './dto/fulfill-client-request.dto';
import { ListStorageOverviewDto } from './dto/list-storage-overview.dto';
import { ListPickWavesDto } from './dto/list-pick-waves.dto';
import { ListStockBalancesDto } from './dto/list-stock-balances.dto';
import { PickClientRequestDto } from './dto/pick-client-request.dto';
import { RunPickWaveDto } from './dto/run-pick-wave.dto';
import { TransferBetweenBoxesDto } from './dto/transfer-between-boxes.dto';
import { TransferWholeBoxDto } from './dto/transfer-whole-box.dto';
import { UpdateStorageTariffDto } from './dto/update-storage-tariff.dto';
import { FulfillmentWaveService } from './fulfillment-wave.service';
import { PickInstructionService } from './pick-instruction.service';
import { PickWaveDocumentService } from './pick-wave-document.service';
import { StockBalancesService } from './stock-balances.service';
import { StockOperationsService } from './stock-operations.service';
import { StorageOverviewService } from './storage-overview.service';

@ApiTags('stock')
@RequirePermissions('stock:read')
@Controller('stock')
export class StockController {
  constructor(
    private readonly balances: StockBalancesService,
    private readonly operations: StockOperationsService,
    private readonly waves: FulfillmentWaveService,
    private readonly waveDocuments: PickWaveDocumentService,
    private readonly pickInstructions: PickInstructionService,
    private readonly storageOverview: StorageOverviewService,
  ) {}

  @Get('balances')
  listBalances(@Query() query: ListStockBalancesDto, @CurrentUser() user: AuthUser) {
    return this.balances.list(query, user);
  }

  @Get('storage')
  listStorage(@Query() query: ListStorageOverviewDto, @CurrentUser() user: AuthUser) {
    return this.storageOverview.getOverview(query, user);
  }

  @Get('storage.xlsx')
  async downloadStorageOverviewXlsx(
    @Query() query: ListStorageOverviewDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.storageOverview.getOverviewXlsx(query, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.content);
  }

  @Patch('storage/:clientId/tariff')
  @RequirePermissions('stock:write')
  updateStorageTariff(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateStorageTariffDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.storageOverview.updateTariff(clientId, dto, user);
  }

  @Post('transfers/box-to-box')
  @RequirePermissions('stock:write')
  transferBetweenBoxes(@Body() dto: TransferBetweenBoxesDto, @CurrentUser() user: AuthUser) {
    return this.operations.transferBetweenBoxes(dto, user);
  }

  @Post('transfers/whole-box')
  @RequirePermissions('stock:write')
  transferWholeBox(@Body() dto: TransferWholeBoxDto, @CurrentUser() user: AuthUser) {
    return this.operations.transferWholeBox(dto, user);
  }

  @Post('transfers/box-to-box/import-xlsx')
  @RequirePermissions('stock:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  importBoxTransfersXlsx(
    @UploadedFile() file: Express.Multer.File,
    @Query('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.operations.importBoxTransfersXlsx(clientId, file, user);
  }

  @Post('transfers/box-to-box/preview-xlsx')
  @RequirePermissions('stock:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  previewBoxTransfersXlsx(
    @UploadedFile() file: Express.Multer.File,
    @Query('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.operations.previewBoxTransfersXlsx(clientId, file, user);
  }

  @Post('transfers/box-to-box/commit-xlsx')
  @RequirePermissions('stock:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  commitBoxTransfersXlsx(
    @UploadedFile() file: Express.Multer.File,
    @Query('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.operations.commitBoxTransfersXlsx(clientId, file, user);
  }

  @Get('transfers/box-to-box/batches')
  @RequirePermissions('stock:write')
  listBoxTransferBatches(@Query('clientId') clientId: string, @CurrentUser() user: AuthUser) {
    return this.operations.listBoxTransferBatches(clientId, user);
  }

  @Get('transfers/box-to-box/batches/:id/file')
  @RequirePermissions('stock:write')
  async downloadBoxTransferBatchFile(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.operations.getBoxTransferBatchFile(id, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));
    return new StreamableFile(file.content);
  }

  @Delete('transfers/box-to-box/batches/:id')
  @RequirePermissions('stock:write')
  reverseBoxTransferBatch(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.operations.reverseBoxTransferBatch(id, user);
  }

  @Post('fulfillment/pick-request')
  @RequirePermissions('stock:write')
  pickClientRequest(@Body() dto: PickClientRequestDto, @CurrentUser() user: AuthUser) {
    return this.operations.pickClientRequest(dto, user);
  }

  @Get('fulfillment/waves')
  @RequirePermissions('stock:write')
  listPickWaves(@Query() query: ListPickWavesDto, @CurrentUser() user: AuthUser) {
    return this.waves.listWaves(query, user);
  }

  @Post('fulfillment/waves')
  @RequirePermissions('stock:write')
  createPickWave(@Body() dto: CreatePickWaveDto, @CurrentUser() user: AuthUser) {
    return this.waves.createWave(dto, user);
  }

  @Post('fulfillment/waves/:id/pick')
  @RequirePermissions('stock:write')
  runPickWave(@Param('id') id: string, @Body() dto: RunPickWaveDto, @CurrentUser() user: AuthUser) {
    return this.waves.runWave(id, dto, user);
  }

  @Post('fulfillment/waves/:id/cancel')
  @RequirePermissions('stock:write')
  cancelPickWave(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.waves.cancelWave(id, user);
  }

  @Get('fulfillment/waves/:id/document')
  @RequirePermissions('stock:write')
  getPickWaveDocument(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.waveDocuments.getWaveDocument(id, user);
  }

  @Get('fulfillment/waves/:id/document.xlsx')
  @RequirePermissions('stock:write')
  async downloadPickWaveDocumentXlsx(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.waveDocuments.getWaveDocumentXlsx(id, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.content);
  }

  @Get('fulfillment/requests/:id/instruction')
  @RequirePermissions('stock:write')
  getPickInstruction(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.pickInstructions.getRequestInstruction(id, user);
  }

  @Get('fulfillment/requests/:id/instruction.xlsx')
  @RequirePermissions('stock:write')
  async downloadPickInstructionXlsx(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.pickInstructions.getRequestInstructionXlsx(id, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.content);
  }

  @Post('fulfillment/package-request')
  @RequirePermissions('stock:write')
  packageClientRequest(@Body() dto: FulfillClientRequestDto, @CurrentUser() user: AuthUser) {
    return this.operations.packageClientRequest(dto, user);
  }

  @Post('fulfillment/ship-request')
  @RequirePermissions('stock:write')
  shipClientRequest(@Body() dto: FulfillClientRequestDto, @CurrentUser() user: AuthUser) {
    return this.operations.shipClientRequest(dto, user);
  }
}

function contentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^\x20-\x7E]+/g, '_').replace(/"/g, '');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
