import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAnyPermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { MarketplaceAllocationService } from './marketplace-allocation.service';

// FIX: separate endpoints do not modify the legacy WB publication path.
@Controller('marketplace-connections/allocation')
@RequireAnyPermissions('clients:read', 'clients:write', 'client-requests:read', 'client-requests:write')
export class MarketplaceAllocationController {
  constructor(private readonly allocation: MarketplaceAllocationService) {}
  @Get('capabilities') capabilities() { return this.allocation.capabilities(); }
  @Get(':clientId') read(@Param('clientId') clientId: string, @CurrentUser() user: AuthUser) { return this.allocation.read(clientId, user); }
  @Put(':clientId')
  @RequireAnyPermissions('clients:write', 'client-requests:write')
  save(@Param('clientId') clientId: string, @Body() body: { draft?: unknown; revision?: unknown }, @CurrentUser() user: AuthUser) {
    return this.allocation.save(clientId, body, user);
  }
  @Post(':clientId/preview') preview(@Param('clientId') clientId: string,
    @Body() body: { draft?: unknown; search?: string; page?: number }, @CurrentUser() user: AuthUser) {
    return this.allocation.preview(clientId, body, user);
  }
  @Post(':clientId/catalog') catalog(@Param('clientId') clientId: string, @Body() body: { draft?: unknown }, @CurrentUser() user: AuthUser) {
    return this.allocation.catalog(clientId, body, user);
  }
  @Put(':clientId/binding')
  @RequireAnyPermissions('clients:write', 'client-requests:write')
  binding(@Param('clientId') clientId: string, @Body() body: { draft?: unknown; sourceBarcode?: string;
    wbProductId?: string; ozonProductId?: string; confirmed?: boolean; revision?: string | null }, @CurrentUser() user: AuthUser) {
    return this.allocation.confirmBinding(clientId, body, user);
  }
}
