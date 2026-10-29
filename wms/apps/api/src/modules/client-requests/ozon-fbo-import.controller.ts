import { OzonLinkImportService, type OzonLinksInput } from './ozon-link-import.service';
import { Body, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OzonFboImportDto } from './dto/ozon-fbo-import.dto';
import { OzonFboImportService } from './ozon-fbo-import.service';
@Controller('ozon-fbo-import')
@RequirePermissions('client-requests:write')
export class OzonFboImportController {
  constructor(private readonly service: OzonFboImportService, private readonly links: OzonLinkImportService) {}
  @Get('link-connections') linkConnections(@Query('clientId') id:string,@CurrentUser() user:AuthUser){return this.links.connections(id,user);}
  @Post('links/preview') previewLinks(@Body() body:OzonLinksInput,@CurrentUser() user:AuthUser){return this.links.preview(body,user);}
  @Post('links/commit') commitLinks(@Body() body:OzonLinksInput,@CurrentUser() user:AuthUser){return this.links.commit(body,user);}
  @Get('capability') capability() { return { enabled: process.env.WMS_OZON_FBO_IMPORT_ENABLED === 'true' }; }
  // FIX: client-specific choices are authorized by the same service as preview/commit.
  @Get('warehouses') warehouses(@Query('clientId') clientId: string, @CurrentUser() user: AuthUser) { return this.service.warehouses(clientId,user); }
  @Get('requests') list(@Query('clientId') clientId: string, @CurrentUser() user: AuthUser, @Query('warehouseId') warehouseId?: string, @Query('view') view?: string, @Query('allClients') allClients?: string, @Query('beforeNumber') beforeNumber?: string) { return this.service.list(clientId,user,warehouseId,view,allClients,beforeNumber); }
  @Post('preview') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  preview(@UploadedFile() file: Express.Multer.File, @Body() dto: OzonFboImportDto, @CurrentUser() user: AuthUser) { return this.service.preview(file, dto, user); }
  @Post('commit') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  commit(@UploadedFile() file: Express.Multer.File, @Body() dto: OzonFboImportDto, @CurrentUser() user: AuthUser) { return this.service.commit(file, dto, user); }
}
