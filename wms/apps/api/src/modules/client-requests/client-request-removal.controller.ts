import {Body,Controller,Get,Param,Post} from '@nestjs/common';
import {IsBoolean,IsInt,IsString,Length,Min} from 'class-validator';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {RequirePermissions} from '../auth/decorators/require-permissions.decorator';
import type {AuthUser} from '../auth/auth.types';
import {ClientRequestRemovalService} from './client-request-removal.service';
export class RemoveClientRequestDto {
 @IsString() @Length(5,2000) reason!:string;
 @IsInt() @Min(1) number!:number;
 @IsString() @Length(64,64) revision!:string;
 @IsBoolean() confirmed!:boolean;
}
@Controller('client-request-removal')
@RequirePermissions('client-requests:write')
export class ClientRequestRemovalController {
 constructor(private readonly service:ClientRequestRemovalService){}
 @Get('capability') capability(@CurrentUser() user:AuthUser){return this.service.capability(user);}
 @Get(':id/preview') preview(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.preview(id,user);}
 @Post(':id') remove(@Param('id') id:string,@Body() body:RemoveClientRequestDto,@CurrentUser() user:AuthUser){return this.service.remove(id,body,user);}
}
