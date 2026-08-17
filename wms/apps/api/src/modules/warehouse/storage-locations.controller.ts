import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { StorageLocationsService } from './storage-locations.service';

@ApiTags('storage-locations')
@Controller('warehouse/storage-locations')
@RequirePermissions('warehouse:read')
export class StorageLocationsController {
  constructor(private readonly storage: StorageLocationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('query') query?: string,
    @Query('sync') sync?: string,
  ) {
    return this.storage.listLayout(warehouseId, query, sync !== 'false', user);
  }

  @Post('sync-google')
  @RequirePermissions('warehouse:write')
  syncGoogle(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.storage.syncGoogleSheet(
      typeof body.warehouseId === 'string' ? body.warehouseId : user.activeWarehouseId || undefined,
      true,
      typeof body.clientId === 'string' ? body.clientId : undefined,
      user,
    );
  }

  @Post('zones')
  @RequirePermissions('warehouse:write')
  createZone(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.storage.createZone(body, user);
  }

  @Post('pallets')
  @RequirePermissions('warehouse:write')
  createPallet(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.storage.createPallet(body, user);
  }

  @Patch('pallets/:id')
  @RequirePermissions('warehouse:write')
  updatePallet(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.storage.updatePallet(id, body, user);
  }

  @Delete('pallets/:id')
  @RequirePermissions('warehouse:write')
  deletePallet(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.storage.deletePallet(id, user);
  }

  @Post('pallets/:id/boxes')
  @RequirePermissions('warehouse:write')
  addBox(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.storage.addBox(id, body, user);
  }

  @Post('pallets/boxes/relocate')
  @RequirePermissions('warehouse:write')
  relocateBox(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.storage.relocateBox(body, user);
  }

  @Delete('pallets/:id/boxes/:boxCode')
  @RequirePermissions('warehouse:write')
  removeBox(
    @Param('id') id: string,
    @Param('boxCode') boxCode: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.storage.removeBox(id, boxCode, user);
  }
}
