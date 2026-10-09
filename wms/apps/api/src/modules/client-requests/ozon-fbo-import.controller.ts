import { Body, Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ImportOutboundRequestXlsxDto } from './dto/import-outbound-request-xlsx.dto';
import { OzonFboImportService } from './ozon-fbo-import.service';
@Controller('ozon-fbo-import')
@RequirePermissions('client-requests:write')
export class OzonFboImportController {
  constructor(private readonly service: OzonFboImportService) {}
  @Get('capability') capability() { return { enabled: process.env.WMS_OZON_FBO_IMPORT_ENABLED === 'true' }; }
  @Post('preview') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  preview(@UploadedFile() file: Express.Multer.File, @Body() dto: ImportOutboundRequestXlsxDto, @CurrentUser() user: AuthUser) { return this.service.preview(file, dto, user); }
  @Post('commit') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  commit(@UploadedFile() file: Express.Multer.File, @Body() dto: ImportOutboundRequestXlsxDto, @CurrentUser() user: AuthUser) { return this.service.commit(file, dto, user); }
}
