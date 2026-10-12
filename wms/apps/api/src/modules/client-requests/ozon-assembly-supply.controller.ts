import {Body,Controller,Get,Param,Post,Res,StreamableFile} from '@nestjs/common';
import type {Response} from 'express';
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
 // FIX: download does not send or recreate any Ozon cargoes.
 @Get('cargo-mapping.xlsx') async cargoMapping(@Param('id') id:string,@CurrentUser() user:AuthUser,@Res({passthrough:true}) response:Response){
  const file=await this.service.cargoMappingFile(id,user);
  response.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  response.setHeader('Content-Disposition',`attachment; filename="${file.fileName}"`);
  response.setHeader('Cache-Control','no-store');return new StreamableFile(file.buffer);
 }
 @Post('bind') bind(@Param('id') id:string,@Body() body:{connectionId:string;orderId:string},@CurrentUser() user:AuthUser){return this.service.bind(id,body,user);}
 @Post('mapping') map(@Param('id') id:string,@Body() body:{mapping:Record<string,string>},@CurrentUser() user:AuthUser){return this.service.map(id,body.mapping,user);}
 @Post('refresh') refresh(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.refresh(id,user);}
 @Post('upload') upload(@Param('id') id:string,@Body() body:{confirm:boolean},@CurrentUser() user:AuthUser){return this.service.upload(id,body.confirm,user);}
 @Post('status') status(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.status(id,user);}
 @Post('labels') labels(@Param('id') id:string,@Body() body:{supplyId:string},@CurrentUser() user:AuthUser){return this.service.labels(id,body.supplyId,user);}
}
