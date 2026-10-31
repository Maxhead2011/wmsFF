import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ClientKizPolicyService } from './client-kiz-policy.service';

@Controller('clients/:clientId/kiz-policy')
@RequirePermissions('clients:read')
export class ClientKizPolicyController {
  constructor(private readonly policy: ClientKizPolicyService) {}
  @Get()
  get(@Param('clientId') id: string, @CurrentUser() user: AuthUser) { return this.policy.get(id, user); }
  @Put()
  @RequirePermissions('clients:write')
  save(@Param('clientId') id: string, @Body('required') required: unknown, @CurrentUser() user: AuthUser) {
    return this.policy.save(id, required, user);
  }
}
