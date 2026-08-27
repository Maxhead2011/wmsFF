import { Body, Controller, Delete, Get, Param, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { parseRequisitesDocument } from '../../common/documents/requisites-document-parser';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { UpsertOwnCompanyDto } from './dto/upsert-own-company.dto';
import { OwnCompaniesService } from './own-companies.service';

@ApiTags('own-companies')
@RequirePermissions('own-companies:read')
@Controller('own-companies')
export class OwnCompaniesController {
  constructor(private readonly ownCompanies: OwnCompaniesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.ownCompanies.list(user);
  }

  @Post()
  @RequirePermissions('own-companies:write')
  create(@Body() dto: UpsertOwnCompanyDto, @CurrentUser() user: AuthUser) {
    return this.ownCompanies.create(dto, user);
  }

  @Post('parse-requisites')
  @RequirePermissions('own-companies:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async parseRequisites(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    await this.ownCompanies.requireWriteScope(user);
    return parseRequisitesDocument(file);
  }

  @Put(':id')
  @RequirePermissions('own-companies:write')
  update(@Param('id') id: string, @Body() dto: UpsertOwnCompanyDto, @CurrentUser() user: AuthUser) {
    return this.ownCompanies.update(id, dto, user);
  }

  @Post(':id/assets/:kind')
  @RequirePermissions('own-companies:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadAsset(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ownCompanies.uploadAsset(id, kind, file, user);
  }

  @Delete(':id/assets/:kind')
  @RequirePermissions('own-companies:write')
  deleteAsset(@Param('id') id: string, @Param('kind') kind: string, @CurrentUser() user: AuthUser) {
    return this.ownCompanies.deleteAsset(id, kind, user);
  }
}
