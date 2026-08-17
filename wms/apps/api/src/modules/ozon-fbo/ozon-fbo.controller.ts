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
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { OzonFboService } from './ozon-fbo.service';

@ApiTags('ozon-fbo')
@RequirePermissions()
@Controller('ozon-fbo')
export class OzonFboController {
  constructor(private readonly fbo: OzonFboService) {}

  @Get('overview')
  overview(@Query('clientId') clientId: string, @CurrentUser() user: AuthUser) {
    return this.fbo.overview(clientId, user);
  }

  @Get('clusters')
  clusters(@Query('connectionId') connectionId: string, @CurrentUser() user: AuthUser) {
    return this.fbo.listClusters(connectionId, user);
  }

  @Get('dropoff-warehouses')
  dropoffs(
    @Query('connectionId') connectionId: string,
    @Query('search') search: string,
    @Query('supplyType') supplyType: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fbo.listDropoffWarehouses(connectionId, search, supplyType, user);
  }

  @Post('plans/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  importPlan(
    @Body() body: { clientId?: string; connectionId?: string; title?: string },
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fbo.importPlan(body, file, user);
  }

  @Get('plans/:id')
  getPlan(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.fbo.getPlan(id, user);
  }

  @Patch('plans/:id/clusters/:clusterId')
  mapCluster(
    @Param('id') id: string,
    @Param('clusterId') clusterId: string,
    @Body() body: { clusterId?: string; macrolocalClusterId?: string; clusterName?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.fbo.mapCluster(id, clusterId, body, user);
  }

  @Patch('plans/:id/dropoff')
  setDropoff(
    @Param('id') id: string,
    @Body() body: { warehouseId?: string; name?: string; type?: string; deliveryType?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.fbo.setDropoff(id, body, user);
  }

  @Post('plans/:id/draft')
  createDraft(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.fbo.createDraft(id, user);
  }

  @Post('plans/:id/draft/refresh')
  refreshDraft(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.fbo.refreshDraft(id, user);
  }

  @Post('plans/:id/timeslots')
  timeslots(
    @Param('id') id: string,
    @Body() body: { dateFrom?: string; dateTo?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.fbo.loadTimeslots(id, body, user);
  }

  @Post('plans/:id/book-slot')
  bookSlot(
    @Param('id') id: string,
    @Body() body: { from?: string; to?: string; confirm?: boolean },
    @CurrentUser() user: AuthUser,
  ) {
    return this.fbo.bookSlot(id, body, user);
  }

  @Post('plans/:id/supply/refresh')
  refreshSupply(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.fbo.refreshSupply(id, user);
  }

  @Post('plans/:id/order/refresh')
  refreshOrder(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.fbo.refreshOrder(id, user);
  }

  @Post('plans/:id/boxes/generate')
  generateBoxes(
    @Param('id') id: string,
    @Body() body: { maxUnitsPerBox?: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.fbo.generateBoxes(id, body, user);
  }

  @Post('boxes/:id/scan')
  scanBox(@Param('id') id: string, @Body() body: { code?: string }, @CurrentUser() user: AuthUser) {
    return this.fbo.scanBox(id, body.code ?? '', user);
  }

  @Post('boxes/:id/close')
  closeBox(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.fbo.closeBox(id, user);
  }

  @Post('plans/:id/cargoes/upload')
  uploadCargoes(@Param('id') id: string, @Body() body: { confirm?: boolean }, @CurrentUser() user: AuthUser) {
    return this.fbo.uploadCargoes(id, body, user);
  }

  @Post('plans/:id/cargoes/refresh')
  refreshCargoes(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.fbo.refreshCargoes(id, user);
  }

  @Get('plans/:id/assembly.xlsx')
  async assemblyXlsx(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.fbo.exportAssembly(id, user);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Length', String(file.buffer.length));
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    return new StreamableFile(file.buffer);
  }
}
