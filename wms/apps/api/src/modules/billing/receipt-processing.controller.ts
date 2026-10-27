import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { runBillingMutation } from './billing-mutation';
import { normalizeReceiptProfile, receiptPricingKey, receiptProcessingEnabled } from './receipt-processing';
import { ConflictException } from '@nestjs/common';
// FIX: pricing is separate per client and opt-in; existing tariff tables and invoices are never modified.
@Controller('billing/receipt-processing')
@RequirePermissions('billing:read')
export class ReceiptProcessingController{
 constructor(private readonly prisma:PrismaService,private readonly scopes:ClientScopeService){}
 @Get(':clientId')
 async get(@CurrentUser() user:AuthUser,@Param('clientId') clientId:string){
  this.scopes.requireClientAccess(user,clientId,'read');
  if(!receiptProcessingEnabled())return {enabled:false};
  const pricing=(await this.prisma.systemSetting.findUnique({where:{key:receiptPricingKey(clientId)}}))?.value??{revision:0};
  const services=await this.prisma.billingService.findMany({where:{isActive:true,unit:'PIECE',code:{notIn:['FBS_PROCESSING','BOX_60_40_40','BOX_ASSEMBLY','PALLET','PALLET_ASSEMBLY']}},select:{id:true,name:true,code:true}});
  return {enabled:true,pricing,services,canWrite:!user.isDemo&&user.roleCodes.some(r=>['ADMIN','OWNER'].includes(r))&&user.permissionCodes.some(p=>['billing:write','system:admin'].includes(p))};
 }
 @Post(':clientId')
 @RequirePermissions('billing:write')
 async save(@CurrentUser() user:AuthUser,@Param('clientId') clientId:string,@Body() body:any){
  if(!receiptProcessingEnabled())throw new NotFoundException('Виды прихода не включены.');
  this.scopes.requireClientAccess(user,clientId,'write');
  if(user.isDemo||!user.roleCodes.some(r=>['ADMIN','OWNER'].includes(r)))throw new ForbiddenException('Настройки меняет администратор.');
  if(!body||!Number.isSafeInteger(body.revision)||body.revision<0)throw new BadRequestException('Укажите версию настроек.');
  return runBillingMutation(this.prisma,async tx=>{
   const key=receiptPricingKey(clientId),saved=await tx.systemSetting.findUnique({where:{key}}),previous=saved?.value as any;
   if((previous?.revision??0)!==body.revision)throw new ConflictException('Настройки уже изменены. Обновите страницу.');
   const services=await tx.billingService.findMany({where:{isActive:true,unit:'PIECE',code:{notIn:['FBS_PROCESSING','BOX_60_40_40','BOX_ASSEMBLY','PALLET','PALLET_ASSEMBLY']}},select:{id:true}});
   const next={revision:body.revision+1,WHITE:normalizeReceiptProfile(body.WHITE,services.map(s=>s.id)),GRAY:normalizeReceiptProfile(body.GRAY,services.map(s=>s.id)),changedAt:new Date().toISOString(),changedByName:user.name};
   await tx.systemSetting.upsert({where:{key},create:{key,value:next,updatedByUserId:user.id},update:{value:next,updatedByUserId:user.id}});
   await tx.auditLog.create({data:{userId:user.id,action:'RECEIPT_PROCESSING_PRICING_CHANGED',entity:'Client',entityId:clientId,payload:{previous:previous??null,next}}});
   return next;
  });
 }
}
