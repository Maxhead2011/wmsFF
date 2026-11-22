import { requireSettingsEditor } from '../../common/client-fulfillment-policy';
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ProductDisplayService } from './product-display.service';

@Controller('clients/:clientId/product-display')
@RequirePermissions('clients:read')
export class ProductDisplayController {
  constructor(private readonly display: ProductDisplayService) {}
  @Get()
  get(@Param('clientId') id: string, @CurrentUser() user: AuthUser) {
    return this.display.get(id, user);
  }
  @Put()
  @RequirePermissions('clients:write')
  save(@Param('clientId') id: string, @Body('fields') fields: unknown, @CurrentUser() user: AuthUser) {
    requireSettingsEditor(user.roleCodes);
    return this.display.save(id, fields, user);
  }
}
