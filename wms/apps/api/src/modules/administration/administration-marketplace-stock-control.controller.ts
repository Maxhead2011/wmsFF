import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { MarketplaceStockControlService } from '../marketplace-connections/marketplace-stock-control.service';

// FIX: a dedicated admin-only boundary; demo administration cannot change client publication.
@ApiTags('administration')
@ApiBearerAuth()
@RequirePermissions('system:admin')
@Controller('administration/marketplace-stock-control')
export class AdministrationMarketplaceStockControlController {
  constructor(private readonly control: MarketplaceStockControlService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) { return this.control.list(user); }

  @Put(':clientId/reserve')
  // FIX: service checks writable client assignment; other administration remains restricted.
  @RequirePermissions('stock:read')
  updateReserve(@Param('clientId') clientId: string, @Body() body: { reserve?: unknown; expectedUpdatedAt?: unknown }, @CurrentUser() user: AuthUser) {
    return this.control.updateReserve(clientId, body, user);
  }

  @Put(':clientId/skus/:skuId')
  @RequirePermissions('stock:read')
  updateSkuRule(@Param('clientId') clientId: string, @Param('skuId') skuId: string, @Body() body: { reserve?: unknown; blocked?: unknown; expectedUpdatedAt?: unknown }, @CurrentUser() user: AuthUser) {
    return this.control.updateFineRule(clientId, skuId, body, user);
  }

  @Put(':clientId/analysis')
  updateAnalysis(@Param('clientId') clientId: string, @Body() body: { maxShareChange?: unknown; expectedUpdatedAt?: unknown }, @CurrentUser() user: AuthUser) {
    return this.control.updateFineRule(clientId, null, body, user);
  }

  @Put(':clientId')
  update(@Param('clientId') clientId: string, @Body() body: { enabled?: unknown; expectedEnabled?: unknown }, @CurrentUser() user: AuthUser) {
    return this.control.update(clientId, body, user);
  }
}
