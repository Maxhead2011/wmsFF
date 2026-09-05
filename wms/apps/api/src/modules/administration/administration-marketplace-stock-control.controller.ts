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

  @Put(':clientId')
  update(@Param('clientId') clientId: string, @Body() body: { enabled?: unknown; expectedEnabled?: unknown }, @CurrentUser() user: AuthUser) {
    return this.control.update(clientId, body, user);
  }
}
