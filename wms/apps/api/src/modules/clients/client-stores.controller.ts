import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ClientStoresService } from './client-stores.service';

// FIX: store metadata is scoped to the existing payer client; no new client/balance is created.
@Controller('clients/:clientId/stores')
@RequirePermissions('clients:read')
export class ClientStoresController {
  constructor(private readonly stores: ClientStoresService) {}
  @Get()
  get(@Param('clientId') clientId:string,@CurrentUser() user:AuthUser){return this.stores.get(clientId,user);}
  @Put()
  @RequirePermissions('clients:write')
  save(@Param('clientId') clientId:string,@Body('stores') stores:unknown,@CurrentUser() user:AuthUser){return this.stores.save(clientId,stores,user);}
  @Get('skus/:skuId')
  getSku(@Param('clientId') clientId:string,@Param('skuId') skuId:string,@CurrentUser() user:AuthUser){return this.stores.getSkuStores(clientId,skuId,user);}
  @Put('skus/:skuId')
  @RequirePermissions('clients:write')
  saveSku(@Param('clientId') clientId:string,@Param('skuId') skuId:string,@Body('storeIds') ids:unknown,
    @Body('expectedStoreIds') expected:unknown,@CurrentUser() user:AuthUser){return this.stores.saveSkuStores(clientId,skuId,ids,expected,user);}
}
