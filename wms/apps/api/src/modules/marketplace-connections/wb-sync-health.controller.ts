import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { WbSyncHealthService } from './wb-sync-health.service';
@Controller('wb-sync-health')
@RequirePermissions('clients:read')
export class WbSyncHealthController {
  constructor(private readonly health: WbSyncHealthService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.health.list(user); }
}
