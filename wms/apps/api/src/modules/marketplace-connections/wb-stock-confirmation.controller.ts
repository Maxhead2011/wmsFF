import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAnyPermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { WbStockConfirmationService, type ConfirmationQuery } from './wb-stock-confirmation.service';
@Controller('marketplace-connections/stock-confirmation')
@RequireAnyPermissions('clients:read', 'clients:write', 'client-requests:read', 'client-requests:write')
export class WbStockConfirmationController {
  constructor(private readonly confirmations: WbStockConfirmationService) {}
  @Get('capabilities') capabilities() { return this.confirmations.capabilities(); }
  @Get() list(@Query() query: ConfirmationQuery, @CurrentUser() user: AuthUser) { return this.confirmations.list(query,user); }
}
