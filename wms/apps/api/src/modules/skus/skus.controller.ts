import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { BulkUpdateSkuVolumeDto } from './dto/bulk-update-sku-volume.dto';
import { CreateArticleMappingDto } from './dto/create-article-mapping.dto';
import { CreateNomenclatureItemDto } from './dto/create-nomenclature-item.dto';
import { CreateSkuDto } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import { SkusService } from './skus.service';

@ApiTags('skus')
@RequirePermissions('skus:read')
@Controller('skus')
export class SkusController {
  constructor(private readonly skus: SkusService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
    @Query('draftsOnly') draftsOnly?: string,
  ) {
    return this.skus.list({ clientId, search, draftsOnly: draftsOnly === 'true' }, user);
  }

  @Get('nomenclature')
  listNomenclature(@Query('search') search?: string) {
    return this.skus.listNomenclature({ search });
  }

  @Post('nomenclature')
  @RequirePermissions('skus:write')
  createNomenclature(@Body() dto: CreateNomenclatureItemDto, @CurrentUser() user: AuthUser) {
    return this.skus.createNomenclature(dto, user);
  }

  @Patch('nomenclature/:id')
  @RequirePermissions('skus:write')
  updateNomenclature(
    @Param('id') id: string,
    @Body() dto: CreateNomenclatureItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.skus.updateNomenclature(id, dto, user);
  }

  @Post('nomenclature/import-xlsx')
  @RequirePermissions('skus:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Excel-файл общей номенклатуры' })
  @UseInterceptors(FileInterceptor('file'))
  importNomenclatureXlsx(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.skus.importNomenclatureWorkbook(file, user);
  }

  @Get('article-mappings')
  listArticleMappings(@CurrentUser() user: AuthUser, @Query('clientId') clientId: string) {
    return this.skus.listArticleMappings(clientId, user);
  }

  @Post('article-mappings')
  createArticleMapping(@Body() dto: CreateArticleMappingDto, @CurrentUser() user: AuthUser) {
    return this.skus.createArticleMapping(dto, user);
  }

  @Post('article-mappings/import-xlsx')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Excel-файл соответствий артикула на складе и артикула продавца' })
  @UseInterceptors(FileInterceptor('file'))
  importArticleMappingsXlsx(
    @UploadedFile() file: Express.Multer.File,
    @Query('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.skus.importArticleMappingsWorkbook(clientId, file, user);
  }

  @Delete('article-mappings/:id')
  deleteArticleMapping(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.skus.deleteArticleMapping(id, user);
  }

  @Get('bulk-volume')
  listBulkVolume(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId?: string,
    @Query('sourceVolumeFrom') sourceVolumeFrom?: string,
    @Query('sourceVolumeTo') sourceVolumeTo?: string,
  ) {
    return this.skus.listBulkVolume({ clientId, sourceVolumeFrom, sourceVolumeTo }, user);
  }

  @Patch('bulk-volume')
  @RequirePermissions('skus:write')
  updateBulkVolume(@Body() dto: BulkUpdateSkuVolumeDto, @CurrentUser() user: AuthUser) {
    return this.skus.updateBulkVolume(dto, user);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.skus.get(id, user);
  }

  @Patch(':id')
  @RequirePermissions('skus:write')
  update(@Param('id') id: string, @Body() dto: UpdateSkuDto, @CurrentUser() user: AuthUser) {
    return this.skus.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('skus:write')
  delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.skus.delete(id, user);
  }

  @Post()
  @RequirePermissions('skus:write')
  create(@Body() dto: CreateSkuDto, @CurrentUser() user: AuthUser) {
    return this.skus.create(dto, user);
  }

  @Post('import-xlsx')
  @RequirePermissions('skus:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Excel-файл общей номенклатуры' })
  @UseInterceptors(FileInterceptor('file'))
  importXlsx(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    return this.skus.importNomenclatureWorkbook(file, user);
  }
}
