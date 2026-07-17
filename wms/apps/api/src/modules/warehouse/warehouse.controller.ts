import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpsertBoxDto } from './dto/upsert-box.dto';
import { UpsertPalletDto } from './dto/upsert-pallet.dto';
import { WarehouseService } from './warehouse.service';

@ApiTags('warehouse')
@RequirePermissions('warehouse:read')
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Get('warehouses')
  listWarehouses() {
    return this.warehouse.listWarehouses();
  }

  @Post('warehouses')
  @RequirePermissions('warehouse:write')
  createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.warehouse.createWarehouse(dto);
  }

  @Get('zones')
  listZones(@Query('warehouseId') warehouseId?: string) {
    return this.warehouse.listZones(warehouseId);
  }

  @Post('zones')
  @RequirePermissions('warehouse:write')
  createZone(@Body() dto: CreateZoneDto) {
    return this.warehouse.createZone(dto);
  }

  @Get('boxes')
  listBoxes(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string, @Query('code') code?: string) {
    return this.warehouse.listBoxes({ clientId, code }, user);
  }

  @Get('online-receipts')
  @RequirePermissions()
  listOnlineReceipts(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.warehouse.listOnlineReceipts({ clientId }, user);
  }

  @Get('receipt-batches')
  @RequirePermissions()
  listReceiptBatches(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.warehouse.listReceiptBatches({ clientId }, user);
  }

  @Get('goods-arrivals')
  @RequirePermissions()
  listGoodsArrivals(
    @CurrentUser() user: AuthUser,
    @Query('clientId') clientId?: string,
    @Query('periodFrom') periodFrom?: string,
    @Query('periodTo') periodTo?: string,
  ) {
    return this.warehouse.listGoodsArrivals({ clientId, periodFrom, periodTo }, user);
  }

  @Get('goods-arrivals/summary')
  @RequirePermissions()
  goodsArrivalSummary(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.warehouse.goodsArrivalSummary(clientId, user);
  }

  @Post('goods-arrivals')
  @RequirePermissions('warehouse:write')
  createGoodsArrival(@Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.warehouse.createGoodsArrival(dto, user);
  }

  @Delete('goods-arrivals/:id')
  @RequirePermissions('warehouse:write')
  deleteGoodsArrival(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.warehouse.deleteGoodsArrival(id, user);
  }

  @Post('goods-arrivals/bill')
  @RequirePermissions('billing:write')
  billGoodsArrivals(@Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.warehouse.billGoodsArrivals(dto, user);
  }

  @Post('online-receipts/boxes/open')
  @RequirePermissions('warehouse:write')
  openOnlineReceiptBox(@Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.warehouse.openOnlineReceiptBox(dto, user);
  }

  @Post('online-receipts/boxes/close')
  @RequirePermissions('warehouse:write')
  closeOnlineReceiptBox(@Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.warehouse.closeOnlineReceiptBox(dto, user);
  }

  @Post('online-receipts/boxes/close-open')
  @RequirePermissions('warehouse:write')
  closeOpenOnlineReceiptBoxes(@Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.warehouse.closeOpenOnlineReceiptBoxes(dto, user);
  }

  @Post('online-receipts/finish')
  @RequirePermissions('warehouse:write')
  finishOnlineReceipt(@Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.warehouse.finishOnlineReceipt(dto, user);
  }

  @Delete('online-receipts/boxes')
  @RequirePermissions('warehouse:write')
  deleteOnlineReceiptBox(@Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.warehouse.deleteOnlineReceiptBox(dto, user);
  }

  @Post('online-receipts/boxes/restore')
  @RequirePermissions('warehouse:write')
  restoreOnlineReceiptBox(@Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.warehouse.restoreOnlineReceiptBox(dto, user);
  }

  @Post('online-receipts/items')
  @RequirePermissions('warehouse:write')
  addOnlineReceiptItem(@Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.warehouse.addOnlineReceiptItem(dto, user);
  }

  @Patch('online-receipts/items/:id')
  @RequirePermissions('warehouse:write')
  updateOnlineReceiptItem(@Param('id') id: string, @Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.warehouse.updateOnlineReceiptItem(id, dto, user);
  }

  @Delete('online-receipts/items/:id')
  @RequirePermissions('warehouse:write')
  deleteOnlineReceiptItem(@Param('id') id: string, @Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.warehouse.deleteOnlineReceiptItem(id, dto, user);
  }

  @Post('boxes')
  @RequirePermissions('warehouse:write')
  upsertBox(@Body() dto: UpsertBoxDto, @CurrentUser() user: AuthUser) {
    return this.warehouse.upsertBox(dto, user);
  }

  @Get('pallets')
  listPallets(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.warehouse.listPallets(clientId, user);
  }

  @Post('pallets')
  @RequirePermissions('warehouse:write')
  upsertPallet(@Body() dto: UpsertPalletDto, @CurrentUser() user: AuthUser) {
    return this.warehouse.upsertPallet(dto, user);
  }
}
