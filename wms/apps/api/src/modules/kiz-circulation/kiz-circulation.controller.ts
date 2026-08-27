import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import {
  CheckKizCirculationItemsDto,
  CreateKizCirculationBatchDto,
  ImportKizCirculationItemsDto,
  SetKizCirculationSignatureDto,
  SubmitKizCirculationBatchDto,
  SyncKizCirculationDto,
  UpdateKizCirculationItemDto,
  UpsertKizTrueApiConnectionDto,
} from './dto/kiz-circulation.dto';
import { KizCirculationService } from './kiz-circulation.service';

@Controller('kiz-circulation')
// FIX: доступ выдаётся отдельным правом; принадлежность clientId проверяет сервис.
@RequirePermissions('kiz-circulation:read')
export class KizCirculationController {
  constructor(private readonly service: KizCirculationService) {}

  @Get('overview')
  overview(@Query('clientId') clientId: string, @CurrentUser() user: AuthUser) {
    return this.service.overview(clientId, user);
  }

  @Put('connections/:clientId')
  @RequirePermissions('kiz-circulation:write')
  upsertConnection(
    @Param('clientId') clientId: string,
    @Body() dto: UpsertKizTrueApiConnectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.upsertConnection(clientId, dto, user);
  }

  @Post('sync/:clientId')
  @RequirePermissions('kiz-circulation:write')
  sync(
    @Param('clientId') clientId: string,
    @Body() dto: SyncKizCirculationDto,
    @CurrentUser() user: AuthUser,
  ) {
    // FIX: выбранный в интерфейсе период доходит до фактической выборки отгрузок.
    return this.service.sync(clientId, dto, user);
  }

  @Post('items/import')
  @RequirePermissions('kiz-circulation:write')
  importItems(@Body() dto: ImportKizCirculationItemsDto, @CurrentUser() user: AuthUser) {
    return this.service.importItems(dto, user);
  }

  @Patch('items/:itemId')
  @RequirePermissions('kiz-circulation:write')
  updateItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateKizCirculationItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateItem(itemId, dto, user);
  }

  @Post('items/check')
  @RequirePermissions('kiz-circulation:write')
  checkItems(@Body() dto: CheckKizCirculationItemsDto, @CurrentUser() user: AuthUser) {
    return this.service.checkItems(dto, user);
  }

  @Post('batches')
  @RequirePermissions('kiz-circulation:write')
  createBatch(@Body() dto: CreateKizCirculationBatchDto, @CurrentUser() user: AuthUser) {
    return this.service.createBatch(dto, user);
  }

  @Post('batches/:batchId/signature')
  @RequirePermissions('kiz-circulation:write')
  setSignature(
    @Param('batchId') batchId: string,
    @Body() dto: SetKizCirculationSignatureDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setSignature(batchId, dto.signature, user);
  }

  @Post('batches/:batchId/submit')
  @RequirePermissions('kiz-circulation:write')
  submit(
    @Param('batchId') batchId: string,
    @Body() dto: SubmitKizCirculationBatchDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.submit(batchId, dto.confirmation, user);
  }

  @Post('batches/:batchId/refresh')
  @RequirePermissions('kiz-circulation:write')
  refresh(@Param('batchId') batchId: string, @CurrentUser() user: AuthUser) {
    return this.service.refreshBatch(batchId, user);
  }
}
