import { BadRequestException, Body, Controller, Get, Param, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as XLSX from 'xlsx';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { YandexFbyService } from './yandex-fby.service';
import { FbyPreviewDto, FbyCreateDto, FbyBindDto } from './yandex-fby.dto';
@Controller('yandex-fby')
@RequirePermissions('client-requests:read')
export class YandexFbyController {
  constructor(private readonly service: YandexFbyService) {}
  @Get('accounts') accounts(@Query('clientId') clientId: string, @CurrentUser() user: AuthUser) { return this.service.accounts(clientId, user); }
  @Get('accounts/:id/warehouses') warehouses(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.warehouses(id, user); }
  @Get('accounts/:id/requests') list(@Param('id') id: string, @Query('view') view: string, @CurrentUser() user: AuthUser) { return this.service.list(id, user, view); }
  @Post('accounts/:id/preview') @RequirePermissions('client-requests:write')
  preview(@Param('id') id: string, @Body() body: FbyPreviewDto, @CurrentUser() user: AuthUser) { return this.service.preview(id, body, user); }
  @Post('accounts/:id/requests') @RequirePermissions('client-requests:write')
  create(@Param('id') id: string, @Body() body: FbyCreateDto, @CurrentUser() user: AuthUser) { return this.service.create(id, body, user); }
  @Post('accounts/:id/requests/:requestId/bind') @RequirePermissions('client-requests:write')
  bind(@Param('id') id: string, @Param('requestId') requestId: string, @Body() body: FbyBindDto, @CurrentUser() user: AuthUser) { return this.service.bind(id, requestId, body, user); }
  @Post('accounts/:id/requests/:requestId/refresh')
  refresh(@Param('id') id: string, @Param('requestId') requestId: string, @CurrentUser() user: AuthUser) { return this.service.refresh(id, requestId, user); }
  @Post('accounts/:id/file') @RequirePermissions('client-requests:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  parse(@Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: AuthUser) {
    if (!file?.buffer) throw new BadRequestException('Выберите файл Excel.');
    return this.service.parse(id, file.buffer, user);
  }
  @Get('accounts/:id/template')
  async template(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.service.warehouses(id, user);
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['ШК','Количество'],['04600000000000',1]]),'FBY');
    return new StreamableFile(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: 'attachment; filename="Yandex-FBY.xlsx"' });
  }
}
