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
  UpdateKizCirculationItemDto,
  UpsertKizTrueApiConnectionDto,
} from './dto/kiz-circulation.dto';
import { KizCirculationService } from './kiz-circulation.service';

@Controller('kiz-circulation')
@RequirePermissions('system:admin')
export class KizCirculationController {
  constructor(private readonly service: KizCirculationService) {}

  @Get('overview')
  overview(@Query('clientId') clientId: string) {
    return this.service.overview(clientId);
  }

  @Put('connections/:clientId')
  upsertConnection(
    @Param('clientId') clientId: string,
    @Body() dto: UpsertKizTrueApiConnectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.upsertConnection(clientId, dto, user);
  }

  @Post('sync/:clientId')
  sync(@Param('clientId') clientId: string, @CurrentUser() user: AuthUser) {
    return this.service.sync(clientId, user);
  }

  @Post('items/import')
  importItems(@Body() dto: ImportKizCirculationItemsDto, @CurrentUser() user: AuthUser) {
    return this.service.importItems(dto, user);
  }

  @Patch('items/:itemId')
  updateItem(@Param('itemId') itemId: string, @Body() dto: UpdateKizCirculationItemDto) {
    return this.service.updateItem(itemId, dto);
  }

  @Post('items/check')
  checkItems(@Body() dto: CheckKizCirculationItemsDto) {
    return this.service.checkItems(dto);
  }

  @Post('batches')
  createBatch(@Body() dto: CreateKizCirculationBatchDto, @CurrentUser() user: AuthUser) {
    return this.service.createBatch(dto, user);
  }

  @Post('batches/:batchId/signature')
  setSignature(
    @Param('batchId') batchId: string,
    @Body() dto: SetKizCirculationSignatureDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setSignature(batchId, dto.signature, user);
  }

  @Post('batches/:batchId/submit')
  submit(
    @Param('batchId') batchId: string,
    @Body() dto: SubmitKizCirculationBatchDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.submit(batchId, dto.confirmation, user);
  }

  @Post('batches/:batchId/refresh')
  refresh(@Param('batchId') batchId: string) {
    return this.service.refreshBatch(batchId);
  }
}
