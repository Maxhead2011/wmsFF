import {Controller,Get,Post,Param} from '@nestjs/common';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {RequirePermissions} from '../auth/decorators/require-permissions.decorator';
import type {AuthUser} from '../auth/auth.types';
import {PrismaService} from '../../common/prisma/prisma.service';
import {ClientScopeService} from '../auth/client-scope.service';
import {MarketplaceConnectionsService} from '../marketplace-connections/marketplace-connections.service';
import {OzonAssemblySupplyService} from './ozon-assembly-supply.service';
import {WbFboSupplyService} from './wb-fbo-supply.service';
import {FboDeliverySyncService} from './fbo-delivery-sync.service';
import {RequestMarketStatusService} from './request-market-status.service';
// FIX: endpoint contract retained; scheduled checks reuse the service, never bypass controllers via HTTP.
@Controller('client-requests')
@RequirePermissions('client-requests:write','client-requests:status')
export class RequestMarketStatusController extends RequestMarketStatusService {
 constructor(db:PrismaService,scopes:ClientScopeService,connections:MarketplaceConnectionsService,ozon:OzonAssemblySupplyService,wb:WbFboSupplyService,delivery:FboDeliverySyncService){super(db,scopes,connections,ozon,wb,delivery);}
 @Get('market-status/targets') override targets(@CurrentUser() user:AuthUser){return super.targets(user);}
 @Post(':id/market-status') override check(@Param('id') id:string,@CurrentUser() user:AuthUser){return super.check(id,user);}
}
