import {Body,Controller,Get,Param,Post} from '@nestjs/common';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {RequirePermissions} from '../auth/decorators/require-permissions.decorator';
import type {AuthUser} from '../auth/auth.types';
import {OzonAssemblySupplyService} from './ozon-assembly-supply.service';
// FIX: all external writes are explicit actions on one scoped customer assembly.
@Controller('ozon-fbo-import/requests/:id/supply')
@RequirePermissions('client-requests:write')
export class OzonAssemblySupplyController {
 constructor(private readonly service:OzonAssemblySupplyService){}
 @Get() view(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.view(id,user);}
 @Post('bind') bind(@Param('id') id:string,@Body() body:{connectionId:string;orderId:string},@CurrentUser() user:AuthUser){return this.service.bind(id,body,user);}
 @Post('mapping') map(@Param('id') id:string,@Body() body:{mapping:Record<string,string>},@CurrentUser() user:AuthUser){return this.service.map(id,body.mapping,user);}
 @Post('refresh') refresh(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.refresh(id,user);}
 @Post('upload') upload(@Param('id') id:string,@Body() body:{confirm:boolean},@CurrentUser() user:AuthUser){return this.service.upload(id,body.confirm,user);}
 @Post('status') status(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.status(id,user);}
 @Post('labels') labels(@Param('id') id:string,@Body() body:{supplyId:string},@CurrentUser() user:AuthUser){return this.service.labels(id,body.supplyId,user);}
}
