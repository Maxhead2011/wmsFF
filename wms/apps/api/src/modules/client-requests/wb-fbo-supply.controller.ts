import {Body,Controller,Get,Param,Post} from '@nestjs/common';
import {IsString,MaxLength} from 'class-validator';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {RequirePermissions} from '../auth/decorators/require-permissions.decorator';
import type {AuthUser} from '../auth/auth.types';
import {WbFboSupplyService} from './wb-fbo-supply.service';
class BindWbFboDto {@IsString() @MaxLength(100) connectionId!:string;@IsString() @MaxLength(2000) input!:string;}
@Controller('client-requests/:id/wb-fbo-supply')
@RequirePermissions('client-requests:read')
export class WbFboSupplyController {
 constructor(private readonly service:WbFboSupplyService){}
 @Get() view(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.view(id,user);}
 @Post('bind') @RequirePermissions('client-requests:write') bind(@Param('id') id:string,@Body() body:BindWbFboDto,@CurrentUser() user:AuthUser){return this.service.bind(id,body.connectionId,body.input,user);}
 @Post('refresh') refresh(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.refresh(id,user);}
 @Post('gate') @RequirePermissions('client-requests:write') gate(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.gate(id,user);}
}
