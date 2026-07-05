import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
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
    return this.skus.list({ clientId, search, draftsOnly: draftsOnly === 'true' || draftsOnly === '1' }, user);
  }

  @Get('nomenclature')
  listNomenclature(@Query('search') search?: string) {
    return this.skus.listNomenclature({ search });
  }

  @Post('nomenclature')
  @RequirePermissions('skus:write')
  createNomenclature(@Body() dto: CreateNomenclatureItemDto) {
    return this.skus.createNomenclature(dto);
  }

  @Post('nomenclature/import-xlsx')
  @RequirePermissions('skus:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Excel-файл общей номенклатуры' })
  @UseInterceptors(FileInterceptor('file'))
  importNomenclatureXlsx(@UploadedFile() file: Express.Multer.File) {
    return this.skus.importNomenclatureWorkbook(file);
  }

  @Get('article-mappings')
  listArticleMappings(@CurrentUser() user: AuthUser, @Query('clientId') clientId: string) {
    return this.skus.listArticleMappings(clientId, user);
  }

  @Post('article-mappings')
  @RequirePermissions('skus:write')
  createArticleMapping(@Body() dto: CreateArticleMappingDto, @CurrentUser() user: AuthUser) {
    return this.skus.createArticleMapping(dto, user);
  }

  @Post('article-mappings/import-xlsx')
  @RequirePermissions('skus:write')
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

  @Get('drafts/template.xlsx')
  downloadDraftTemplate(@Res({ passthrough: true }) response: Response) {
    const file = this.skus.buildDraftTemplateWorkbook();
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));

    return new StreamableFile(file.content);
  }

  @Post('drafts/import-xlsx')
  @RequirePermissions('skus:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Excel-файл дозаполнения товаров после приемки' })
  @UseInterceptors(FileInterceptor('file'))
  importDraftsXlsx(
    @UploadedFile() file: Express.Multer.File,
    @Query('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.skus.importDraftWorkbook(clientId, file, user);
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
  importXlsx(@UploadedFile() file: Express.Multer.File) {
    return this.skus.importNomenclatureWorkbook(file);
  }
}

function contentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^\x20-\x7E]+/g, '_').replace(/"/g, '');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
