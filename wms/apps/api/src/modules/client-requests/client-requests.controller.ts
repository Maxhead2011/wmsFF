import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PickInstructionService } from '../stock/pick-instruction.service';
import { FulfillmentWaveService } from '../stock/fulfillment-wave.service';
import { MarketplaceConnectionsService } from '../marketplace-connections/marketplace-connections.service';
import { UpdatePickWaveBalanceReviewDto } from '../stock/dto/update-pick-wave-balance-review.dto';
import { ClientRequestFilesService } from './client-request-files.service';
import { ClientRequestEmergencyService } from './client-request-emergency.service';
import { ClientRequestHistoryService } from './client-request-history.service';
import { ClientRequestMarketplaceFilesService } from './client-request-marketplace-files.service';
import { ClientRequestDocumentService } from './client-request-document.service';
import { ClientRequestPdfService } from './client-request-pdf.service';
import { ClientRequestXlsxService } from './client-request-xlsx.service';
import { ClientRequestsService } from './client-requests.service';
import { CreateClientRequestCommentDto } from './dto/create-client-request-comment.dto';
import { CreateClientRequestDto } from './dto/create-client-request.dto';
import { ImportOutboundRequestXlsxDto } from './dto/import-outbound-request-xlsx.dto';
import { ListClientRequestsDto } from './dto/list-client-requests.dto';
import { MergeFbsRequestTailsDto } from './dto/merge-fbs-request-tails.dto';
import { PreviewClientRequestAvailabilityDto } from './dto/preview-client-request-availability.dto';
import { UpdateClientRequestDto } from './dto/update-client-request.dto';
import { UpdateClientRequestBoxSelectionDto } from './dto/update-client-request-box-selection.dto';
import { UpdateClientRequestStatusDto } from './dto/update-client-request-status.dto';
import { ResolveFbsSynchronizationDto } from './dto/resolve-fbs-synchronization.dto';

@ApiTags('client-requests')
@RequirePermissions('client-requests:read')
@Controller('client-requests')
export class ClientRequestsController {
  constructor(
    private readonly clientRequests: ClientRequestsService,
    private readonly documents: ClientRequestDocumentService,
    private readonly pdf: ClientRequestPdfService,
    private readonly files: ClientRequestFilesService,
    private readonly emergency: ClientRequestEmergencyService,
    private readonly marketplaceFiles: ClientRequestMarketplaceFilesService,
    private readonly history: ClientRequestHistoryService,
    private readonly xlsx: ClientRequestXlsxService,
    private readonly pickInstructions: PickInstructionService,
    private readonly waves: FulfillmentWaveService,
    private readonly marketplace: MarketplaceConnectionsService,
  ) {}

  @Get()
  list(@Query() query: ListClientRequestsDto, @CurrentUser() user: AuthUser) {
    return this.clientRequests.list(query, user);
  }

  @Get('box-overlaps')
  @RequirePermissions('system:admin')
  boxOverlaps(@CurrentUser() user: AuthUser) {
    return this.pickInstructions.getActiveRequestBoxOverlaps(user);
  }

  @Get('balance-reviews/pending')
  listBalanceReviews(@CurrentUser() user: AuthUser) {
    return this.waves.listBalanceReviews(user);
  }

  @Get('balance-reviews/:waveId')
  getBalanceReview(@Param('waveId') waveId: string, @CurrentUser() user: AuthUser) {
    return this.waves.getBalanceReview(waveId, user);
  }

  @Patch('balance-reviews/:waveId')
  @RequirePermissions('client-requests:write')
  saveBalanceReview(
    @Param('waveId') waveId: string,
    @Body() dto: UpdatePickWaveBalanceReviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.waves.saveBalanceReview(waveId, dto, user);
  }

  @Post('balance-reviews/:waveId/submit')
  @RequirePermissions('client-requests:write')
  submitBalanceReview(@Param('waveId') waveId: string, @CurrentUser() user: AuthUser) {
    return this.waves.submitBalanceReview(waveId, user);
  }

  @Post('fbs/merge-tails')
  @RequirePermissions('client-requests:write')
  mergeFbsRequestTails(
    @Body() dto: MergeFbsRequestTailsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.mergeFbsRequestTails(dto, user);
  }

  @Post('fbs/merge-tails/preview')
  @RequirePermissions('client-requests:write')
  previewFbsRequestTails(
    @Body() dto: MergeFbsRequestTailsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.marketplace.previewFbsRequestTails(dto, user);
  }

  @Get(':id/manual-box-selection')
  @RequirePermissions('stock:write')
  getManualBoxSelection(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.clientRequests.getManualBoxSelection(id, user);
  }

  @Get(':id/fbs-box-search')
  @RequirePermissions('stock:write')
  getFbsBoxSearch(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.clientRequests.getFbsBoxSearch(id, user);
  }

  @Get(':id/fbs-box-search.xlsx')
  @RequirePermissions('stock:write')
  async downloadFbsBoxSearchXlsx(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.clientRequests.getFbsBoxSearchXlsx(id, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));
    return new StreamableFile(file.content);
  }

  @Put(':id/manual-box-selection')
  @RequirePermissions('stock:write')
  saveManualBoxSelection(
    @Param('id') id: string,
    @Body() dto: UpdateClientRequestBoxSelectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.clientRequests.saveManualBoxSelection(id, dto, user);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.clientRequests.get(id, user);
  }

  @Get(':id/document')
  getDocument(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.documents.getRequestDocument(id, user);
  }

  @Get(':id/document.pdf')
  async getDocumentPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.pdf.getRequestPdf(id, user);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.buffer.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.buffer);
  }

  @Get(':id/items.xlsx')
  async downloadRequestItemsXlsx(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.documents.getRequestItemsXlsx(id, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.content);
  }

  @Get(':id/pick-instruction')
  @RequirePermissions('stock:write')
  getPickInstruction(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.pickInstructions.getRequestInstruction(id, user);
  }

  @Get(':id/pick-instruction.xlsx')
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

  @Post(':id/pick-instruction/refresh')
  @RequirePermissions('stock:write')
  refreshPickInstruction(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.pickInstructions.refreshRequestInstruction(id, user);
  }

  @Post(':id/sync-tsd')
  @RequirePermissions('stock:write')
  async syncToTsd(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const fbsResult = await this.marketplace.syncFbsRequestForTsd(id, user);
    if (fbsResult) {
      return fbsResult;
    }

    // The regular queue is read by the TSD on demand. Rebuilding the current
    // instruction here makes a newly created request immediately available on
    // the next list refresh without changing its workflow status.
    this.pickInstructions.invalidateRequestInstruction(id);
    const instruction = await this.pickInstructions.getRequestInstruction(id, user);
    return {
      mode: 'OUTBOUND',
      requestId: id,
      message: `Заявка подготовлена для ТСД: ${instruction.rows.length} строк. Обновите список заявок на устройстве.`,
    };
  }

  @Get(':id/marketplace/wb-products.xlsx')
  @RequirePermissions('stock:write')
  async downloadWbProductsTemplate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.marketplaceFiles.getWbProductsTemplate(id, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.content);
  }

  @Get(':id/marketplace/wb-packages.xlsx')
  @RequirePermissions('stock:write')
  async downloadWbPackagesTemplate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.marketplaceFiles.getWbPackagingTemplate(id, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.content);
  }

  @Post(':id/pick-instruction/manual')
  @RequirePermissions('stock:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Ручная складская инструкция XLSX, которая немедленно заменяет автоматический план заявки.' })
  @UseInterceptors(FileInterceptor('file'))
  uploadManualPickInstruction(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pickInstructions.uploadManualRequestInstruction(id, file, user);
  }

  @Get(':id/files')
  listFiles(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.files.listForRequest(id, user);
  }

  @Get(':id/timeline')
  getTimeline(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.history.getTimeline(id, user);
  }

  @Get(':id/files/:fileId')
  async downloadFile(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.files.getFileContent(id, fileId, user);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.sizeBytes));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(Buffer.from(file.content));
  }

  @Post()
  @RequirePermissions('client-requests:write')
  create(@Body() dto: CreateClientRequestDto, @CurrentUser() user: AuthUser) {
    return this.clientRequests.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('client-requests:write')
  update(@Param('id') id: string, @Body() dto: UpdateClientRequestDto, @CurrentUser() user: AuthUser) {
    return this.clientRequests.update(id, dto, user);
  }

  @Post('availability-preview')
  @RequirePermissions('client-requests:write')
  previewAvailability(@Body() dto: PreviewClientRequestAvailabilityDto, @CurrentUser() user: AuthUser) {
    return this.clientRequests.previewAvailability(dto, user);
  }

  @Post('outbound-xlsx/preview')
  @RequirePermissions('client-requests:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Excel-файл сборки: баркод товара и количество.' })
  @UseInterceptors(FileInterceptor('file'))
  previewOutboundXlsx(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ImportOutboundRequestXlsxDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.xlsx.previewOutboundRequest(file, dto, user);
  }

  @Post('outbound-xlsx/commit')
  @RequirePermissions('client-requests:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Создание outbound-заявки из Excel-файла сборки.' })
  @UseInterceptors(FileInterceptor('file'))
  createOutboundFromXlsx(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ImportOutboundRequestXlsxDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.xlsx.createOutboundRequest(file, dto, user);
  }

  @Post(':id/files')
  @RequirePermissions('client-requests:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Файл, который нужно приложить к клиентской заявке.' })
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.files.uploadToRequest(id, file, user);
  }

  @Post(':id/emergency-packed-xlsx')
  @RequirePermissions('stock:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Аварийная упаковка заявки: XLSX со списком фактических коробов FFL.' })
  @UseInterceptors(FileInterceptor('file'))
  emergencyPackedXlsx(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.emergency.closeFromPackedXlsx(id, file, user);
  }

  @Post(':id/emergency-packed-xlsx/rollback')
  @RequirePermissions('stock:write')
  rollbackEmergencyPackedXlsx(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.emergency.rollbackPackedXlsx(id, user);
  }

  @Post(':id/comments')
  @RequirePermissions('client-requests:write')
  addComment(
    @Param('id') id: string,
    @Body() dto: CreateClientRequestCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.history.addComment(id, dto, user);
  }

  @Post(':id/cancel')
  @RequirePermissions('client-requests:write')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.clientRequests.cancel(id, user);
  }

  @Patch(':id/status')
  @RequirePermissions('client-requests:status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateClientRequestStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.clientRequests.updateStatus(id, dto, user);
  }

  @Post(':id/fbs-synchronization/resolve')
  @RequirePermissions('client-requests:status')
  resolveFbsSynchronization(
    @Param('id') id: string,
    @Body() dto: ResolveFbsSynchronizationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.clientRequests.resolveFbsSynchronization(id, dto.action, dto.requestNumber, user);
  }
}

function contentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^\x20-\x7E]+/g, '_').replace(/"/g, '');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
