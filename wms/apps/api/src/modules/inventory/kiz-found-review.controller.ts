import {Body,Controller,Get,Post} from '@nestjs/common';
import {IsBoolean,IsIn,IsOptional,IsString,MaxLength,MinLength} from 'class-validator';
import {PrismaService} from '../../common/prisma/prisma.service';
import {ClientScopeService} from '../auth/client-scope.service';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import type {AuthUser} from '../auth/auth.types';
import {KizFoundReview} from './kiz-found-review';
class FoundDto {
  @IsIn(['OPEN','REUSE','RELABEL','RETURN','REJECT']) action!:string;
  @IsOptional() @IsString() @MaxLength(100) id?:string;
  @IsOptional() @IsString() @MaxLength(100) markId?:string;
  @IsString() @MinLength(5) @MaxLength(1000) reason!:string;
  @IsBoolean() confirmed!:boolean;
  @IsOptional() @IsString() @MaxLength(200) boxCode?:string;
  @IsOptional() @IsBoolean() releaseBindings?:boolean;
}
// FIX: separate opt-in controller; the published evidence provider is loaded only for an authorized action.
@Controller('inventory/kiz-found')
export class KizFoundReviewController {
  constructor(private prisma:PrismaService,private clients:ClientScopeService){}
  private service(){return new KizFoundReview(this.prisma,this.clients,(db,client,kiz)=>require('../../common/kiz-wb-reuse').inspectKizReuse(db,client,kiz));}
  @Get() list(@CurrentUser() user:AuthUser){return this.service().list(user);}
  @Post() async act(@Body() dto:FoundDto,@CurrentUser() user:AuthUser){const s=this.service();return s.view(await s.act(dto,user),user);}
}
