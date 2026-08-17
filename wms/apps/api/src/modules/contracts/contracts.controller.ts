import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { RefreshContractDto } from './dto/refresh-contract.dto';

@ApiTags('contracts')
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.contracts.list(user);
  }

  @Get('clients')
  listClients(@CurrentUser() user: AuthUser) {
    return this.contracts.listAvailableClients(user);
  }

  @Post()
  @RequirePermissions('billing:write')
  create(@Body() dto: CreateContractDto, @CurrentUser() user: AuthUser) {
    return this.contracts.create(dto, user);
  }

  @Patch(':id/archive')
  @RequirePermissions('billing:write')
  archive(@Param('id') id: string, @Body() body: { archived?: boolean }, @CurrentUser() user: AuthUser) {
    return this.contracts.setArchived(id, body.archived !== false, user);
  }

  @Delete(':id')
  @RequirePermissions('billing:write')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.contracts.remove(id, user);
  }

  @Get(':id/requisites-check')
  @RequirePermissions('billing:write')
  checkRequisites(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.contracts.checkRequisites(id, user);
  }

  @Post(':id/requisites-refresh')
  @RequirePermissions('billing:write')
  refreshRequisites(
    @Param('id') id: string,
    @Body() dto: RefreshContractDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contracts.refreshRequisites(id, dto, user);
  }

  @Get(':id/pdf')
  async downloadOriginal(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.contracts.download(id, user, 'original');
    setPdfHeaders(response, file.fileName);
    return new StreamableFile(file.buffer);
  }

  @Get(':id/signed-pdf')
  async downloadSigned(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.contracts.download(id, user, 'signed');
    setPdfHeaders(response, file.fileName);
    return new StreamableFile(file.buffer);
  }

  @Post(':id/signed-pdf')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadSigned(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contracts.uploadSigned(id, file, user);
  }

  @Post(':id/additional-agreements')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadAdditionalAgreement(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contracts.uploadAdditionalAgreement(id, file, user);
  }

  @Get(':id/additional-agreements/:attachmentId/pdf')
  async downloadAdditionalAgreement(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.contracts.downloadAdditionalAgreement(id, attachmentId, user);
    setPdfHeaders(response, file.fileName);
    return new StreamableFile(file.buffer);
  }
}

function setPdfHeaders(response: Response, fileName: string) {
  const asciiName = fileName.replace(/[^\w.-]+/g, '_');
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
}
