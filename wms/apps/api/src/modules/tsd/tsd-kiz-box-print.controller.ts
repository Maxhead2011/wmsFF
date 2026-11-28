import {Body,Controller,Get,Param,Post} from '@nestjs/common';
import {IsString,MaxLength,MinLength,IsUUID} from 'class-validator';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import type {AuthUser} from '../auth/auth.types';
import {TsdKizBoxPrintService} from './tsd-kiz-box-print.service';
class Lookup { @IsString() @MinLength(1) @MaxLength(1024) kiz!:string; }
class Print extends Lookup { @IsString() @MinLength(1) @MaxLength(160) stationId!:string; @IsUUID() printId!:string; }
@Controller('tsd/kiz-box-print')
export class TsdKizBoxPrintController {
 constructor(private readonly service:TsdKizBoxPrintService){}
 @Get('stations') stations(@CurrentUser() u:AuthUser){return this.service.stations(u);}
 @Post('lookup') lookup(@Body() b:Lookup,@CurrentUser() u:AuthUser){return this.service.lookup(b.kiz,u);}
 @Post('jobs') create(@Body() b:Print,@CurrentUser() u:AuthUser){return this.service.create(b,u);}
 @Get('jobs/:id') status(@Param('id') id:string,@CurrentUser() u:AuthUser){return this.service.status(id,u);}
}
