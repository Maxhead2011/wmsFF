import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { receiptProcessingEnabled, receiptProcessingByBoxes, receiptProfileAmount, type BoxProcessing } from './receipt-processing';
export type ReceiptFboUnit={skuId:string;sourceBoxCode:string;selection?:BoxProcessing};
// FIX: only complete physical packing evidence can replace a primary processing charge.
export async function receiptFboPlan(tx:Prisma.TransactionClient,input:{request:{id:string;clientId:string};processedUnits:number}){
 if(!receiptProcessingEnabled())return null;
 await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(1179209295, hashtext(${input.request.id}))`;
 const saved=await tx.billingCharge.findMany({where:{requestId:input.request.id,sourceKey:{startsWith:`fulfillment-receipt-processing:${input.request.id}:`}}});
 if(saved.length)return {units:(saved[0].metadata as any).receiptUnits as ReceiptFboUnit[],existing:true};
 const prior=await tx.billingCharge.findFirst({where:{requestId:input.request.id,OR:['fulfillment-processing:','fulfillment-clothing-processing:','fulfillment-fbo-composition:'].map(p=>({sourceKey:{startsWith:p+input.request.id+':'}}))}});
 if(prior)return null;
 const units=await tx.fboAssemblyUnit.findMany({where:{requestId:input.request.id,state:'PACKED'},select:{skuId:true,sourceBoxCode:true}});
 const profiles=await receiptProcessingByBoxes(tx,input.request.clientId,units.map(u=>u.sourceBoxCode));
 if(!profiles.size)return null;
 if(units.length!==input.processedUnits)throw new ConflictException('Для расчёта по виду прихода не хватает фактического состава упаковки.');
 return {units:units.map(u=>({...u,selection:profiles.get(u.sourceBoxCode)})),existing:false};
}
export async function saveReceiptFboCharges(tx:Prisma.TransactionClient,input:{request:{id:string;clientId:string};user:{id:string};serviceDate:Date},plan:{units:ReceiptFboUnit[];existing:boolean}){
 if(plan.existing)return;
 const groups=new Map<string,{selection:BoxProcessing;quantity:number}>();
 for(const unit of plan.units){if(!unit.selection)continue;const key=unit.selection.receiptId;const group=groups.get(key);groups.set(key,{selection:unit.selection,quantity:(group?.quantity??0)+1});}
 for(const [id,{selection,quantity}] of groups){const amount=receiptProfileAmount(selection.profile);await tx.billingCharge.create({data:{clientId:input.request.clientId,requestId:input.request.id,description:(selection.kind==='WHITE'?'Белая обработка':'Серая обработка'),unit:'PIECE',quantity,unitPriceRub:amount.toDecimalPlaces(2),totalRub:amount.mul(quantity).toDecimalPlaces(2),status:'APPROVED',source:'MANUAL',serviceDate:input.serviceDate,sourceKey:`fulfillment-receipt-processing:${input.request.id}:${id}`,metadata:JSON.parse(JSON.stringify({packageBilling:true,receiptProcessing:selection,receiptUnits:plan.units})),createdByUserId:input.user.id,approvedByUserId:input.user.id,approvedAt:new Date()}});}
}
