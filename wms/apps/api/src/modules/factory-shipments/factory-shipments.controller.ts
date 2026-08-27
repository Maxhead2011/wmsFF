import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateFactoryShipmentDto, ReconcileFactoryShipmentDto, ScanFactoryShipmentDto } from './dto/factory-shipments.dto';
import { FactoryShipmentsService } from './factory-shipments.service';

@ApiTags('factory-shipments')
@Controller('factory-shipments')
export class FactoryShipmentsController {
  constructor(private readonly service: FactoryShipmentsService) {}
  @Get() @RequirePermissions('factory-shipments:read')
  list(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) { return this.service.list(user, clientId); }
  @Get('app/bootstrap') @RequirePermissions('factory-shipments:scan')
  bootstrap(@CurrentUser() user: AuthUser) { return this.service.bootstrap(user); }
  @Get(':id') @RequirePermissions('factory-shipments:read')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.get(id, user); }
  @Post() @RequirePermissions('factory-shipments:write')
  create(@Body() dto: CreateFactoryShipmentDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }
  @Post(':id/scan') @RequirePermissions('factory-shipments:scan')
  scan(@Param('id') id: string, @Body() dto: ScanFactoryShipmentDto, @CurrentUser() user: AuthUser) { return this.service.scan(id, dto, user); }
  @Post(':id/ship') @RequirePermissions('factory-shipments:write')
  ship(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.ship(id, user); }
  @Post(':id/reconcile') @RequirePermissions('factory-shipments:write')
  reconcile(@Param('id') id: string, @Body() dto: ReconcileFactoryShipmentDto, @CurrentUser() user: AuthUser) { return this.service.reconcile(id, dto, user); }
}
