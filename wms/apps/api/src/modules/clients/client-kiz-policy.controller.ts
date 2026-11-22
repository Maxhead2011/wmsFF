import { requireSettingsEditor } from '../../common/client-fulfillment-policy';
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ClientKizPolicyService } from './client-kiz-policy.service';

@Controller('clients/:clientId/kiz-policy')
@RequirePermissions('clients:read')
export class ClientKizPolicyController {
  constructor(private readonly policy: ClientKizPolicyService) {}
  @Get('fulfillment')
  fulfillment(@Param('clientId') id: string, @CurrentUser() user: AuthUser) {
    return this.policy.fulfillment(id,user);
  }
  @Put('fulfillment')
  @RequirePermissions('clients:write')
  saveFulfillment(@Param('clientId') id: string, @Body('rule') rule: unknown, @Body('enabled') enabled: unknown, @CurrentUser() user: AuthUser) {
    requireSettingsEditor(user.roleCodes);
    return this.policy.saveFulfillment(id,rule,enabled,user);
  }
  @Get()
  get(@Param('clientId') id: string, @CurrentUser() user: AuthUser) { return this.policy.get(id, user); }
  @Put()
  @RequirePermissions('clients:write')
  save(@Param('clientId') id: string, @Body('required') required: unknown, @CurrentUser() user: AuthUser) {
    requireSettingsEditor(user.roleCodes);
    return this.policy.save(id, required, user);
  }
}
