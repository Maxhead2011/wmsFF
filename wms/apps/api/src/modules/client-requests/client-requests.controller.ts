import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
import { ClientRequestFilesService } from './client-request-files.service';
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
import { PreviewClientRequestAvailabilityDto } from './dto/preview-client-request-availability.dto';
import { UpdateClientRequestDto } from './dto/update-client-request.dto';
import { UpdateClientRequestStatusDto } from './dto/update-client-request-status.dto';

@ApiTags('client-requests')
@RequirePermissions('client-requests:read')
@Controller('client-requests')
export class ClientRequestsController {
  constructor(
    private readonly clientRequests: ClientRequestsService,
    private readonly documents: ClientRequestDocumentService,
    private readonly pdf: ClientRequestPdfService,
    private readonly files: ClientRequestFilesService,
    private readonly history: ClientRequestHistoryService,
    private readonly marketplaceFiles: ClientRequestMarketplaceFilesService,
    private readonly xlsx: ClientRequestXlsxService,
    private readonly pickInstructions: PickInstructionService,
  ) {}

  @Get()
  list(@Query() query: ListClientRequestsDto, @CurrentUser() user: AuthUser) {
    return this.clientRequests.list(query, user);
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
}

function contentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^\x20-\x7E]+/g, '_').replace(/"/g, '');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
