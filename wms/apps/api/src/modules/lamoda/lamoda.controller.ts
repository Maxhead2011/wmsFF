import { Body, Controller, Get, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions, RequireAnyPermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { LamodaService } from './lamoda.service';
import { LamodaCreateAccountDto, LamodaUpdateAccountDto, LamodaSyncDto, LamodaLinkDto, LamodaImportDto, LamodaImportShipmentDto } from './lamoda.dto';
import { templateWorkbook } from './lamoda-policy';

@Controller('lamoda')
// FIX: service still requires CLIENT role and scoped access for customer plan operations.
@RequireAnyPermissions('marketplace-api:read', 'marketplace-api:write', 'client-requests:read')
export class LamodaController {
  constructor(private readonly service: LamodaService) {}
  @Get('accounts')
  accounts(@Query('clientId') clientId: string, @CurrentUser() user: AuthUser) { return this.service.accounts(clientId, user); }
  @Post('accounts')
  @RequirePermissions('marketplace-api:write')
  create(@Body() body: LamodaCreateAccountDto, @CurrentUser() user: AuthUser) { return this.service.create(body, user); }
  @Patch('accounts/:id')
  @RequirePermissions('marketplace-api:write')
  update(@Param('id') id: string, @Body() body: LamodaUpdateAccountDto, @CurrentUser() user: AuthUser) { return this.service.update(id, body, user); }
  @Get('accounts/:id')
  overview(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.overview(id, user); }
  @Get('accounts/:id/warehouses')
  warehouses(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.warehouses(id, user); }
  @Post('accounts/:id/check')
  @RequirePermissions('marketplace-api:write')
  check(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.check(id, user); }
  @Post('accounts/:id/sync')
  @RequirePermissions('marketplace-api:write')
  sync(@Param('id') id: string, @Body() body: LamodaSyncDto, @CurrentUser() user: AuthUser) { return this.service.sync(id, body.kind, user); }
  @Get('accounts/:id/products/:productId/candidates')
  candidates(@Param('id') id: string, @Param('productId') productId: string, @CurrentUser() user: AuthUser) { return this.service.candidates(id, productId, user); }
  @Post('accounts/:id/products/:productId/link')
  @RequirePermissions('marketplace-api:write')
  link(@Param('id') id: string, @Param('productId') productId: string, @Body() body: LamodaLinkDto, @CurrentUser() user: AuthUser) { return this.service.link(id, productId, body.skuId, user); }
  @Get('accounts/:id/template')
  async template(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.service.overview(id, user);
    return new StreamableFile(templateWorkbook(), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: 'attachment; filename="Lamoda-FBO.xlsx"' });
  }
  @Post('accounts/:id/plans/import')
  @RequireAnyPermissions('marketplace-api:write', 'client-requests:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importPlan(@Param('id') id: string, @Body() body: LamodaImportDto, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: AuthUser) {
    if (!file?.buffer) throw new BadRequestException('Выберите Excel-файл.');
    return this.service.importPlan(id, body, file.buffer, user);
  }
  @Post('accounts/:id/plans/:planId/availability')
  @RequireAnyPermissions('marketplace-api:write', 'client-requests:write')
  availability(@Param('id') id: string, @Param('planId') planId: string, @CurrentUser() user: AuthUser) { return this.service.availability(id, planId, user); }
  @Post('accounts/:id/plans/from-shipment')
  @RequireAnyPermissions('marketplace-api:write', 'client-requests:write')
  fromShipment(@Param('id') id:string,@Body() body:LamodaImportShipmentDto,@CurrentUser() user:AuthUser) { return this.service.importShipment(id,body,user); }
  @Post('accounts/:id/plans/:planId/assembly')
  @RequireAnyPermissions('marketplace-api:write', 'client-requests:write')
  assembly(@Param('id') id:string,@Param('planId') planId:string,@CurrentUser() user:AuthUser) { return this.service.createAssembly(id,planId,user); }
}
