import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {PrismaService} from '../../common/prisma/prisma.service';
import {ClientScopeService} from '../auth/client-scope.service';
import type {AuthUser} from '../auth/auth.types';
import {assertWarehouseAccess} from './client-request-warehouse-scope';
import {ADMIN_REMOVED,REMOVAL_ACTION,canRemoveRequests,removalBlockers} from './request-removal-policy';

@Injectable()
export class ClientRequestRemovalService {
 constructor(private readonly db:PrismaService,private readonly scopes:ClientScopeService){}
 capability(user:AuthUser){return {enabled:canRemoveRequests(user)};}
 private authorize(user:AuthUser){if(!canRemoveRequests(user))throw new ForbiddenException('Удаление доступно администратору и собственнику.');}
 private async inspect(tx:Prisma.TransactionClient,id:string,user:AuthUser){
  const r=await tx.clientRequest.findUnique({where:{id},include:{items:true,fbsOrderLinks:true,ozonShipment:true,_count:{select:{deliveryRequests:true}}}});
  if(!r)throw new NotFoundException('Заявка не найдена.');
  this.scopes.requireClientAccess(user,r.clientId,'write');assertWarehouseAccess(user,r,'write');
  const tasks=await tx.fbsTsdAssembly.findMany({where:{requestId:id}});
  const units=await tx.fboAssemblyUnit.count({where:{requestId:id,state:{not:'RETURNED'}}});
  const packages=await tx.clientRequestPackage.count({where:{requestId:id,items:{some:{quantity:{gt:0}}}}});
  const movements=await tx.stockMovement.count({where:{sourceDocument:id,type:{in:['PICK','PACK','SHIP']}}});
  const scans=await tx.tsdOperation.count({where:{status:'ACCEPTED',payload:{path:['requestId'],equals:id},operationType:{in:['move_scan','assembly_stage','box_search_scan']}}});
  const printed=await tx.fbsPrintJob.count({where:{requestId:id}});
  const activeWaves=await tx.pickWaveRequest.count({where:{requestId:id,wave:{status:{notIn:['CANCELLED','DONE']}}}});
  const physical=units+packages+movements+scans+printed+tasks.filter(t=>t.boxId||t.barcode||t.sourceBarcode||t.kiz||t.relabelConfirmedAt||t.completedAt||t.cargoPackedAt||t.marketplaceSubmittedAt||t.workerUserId||t.startedAt||t.sourceBoxPending||!['WAITING_STOCK','RESERVED','RELEASED','CANCELLED'].includes(t.status)).length;
  const blockers=removalBlockers({...r,physical,activeWaves,deliveries:r._count.deliveryRequests});
  const externalOrders=r.fbsOrderLinks.map(l=>({marketplace:l.marketplace,orderId:l.orderId,supplyId:l.lastSupplyId}));
  const snapshot={id:r.id,number:r.number,title:r.title,status:r.status,clientId:r.clientId,warehouseId:r.warehouseId,updatedAt:r.updatedAt.toISOString(),quantity:r.items.reduce((n,i)=>n+i.quantity,0),externalOrders,ozonLinked:!!r.ozonShipment,blockers};
  const revision=createHash('sha256').update(JSON.stringify({snapshot,items:r.items,tasks,links:r.fbsOrderLinks})).digest('hex');
  return {r,tasks,preview:{...snapshot,revision,allowed:!blockers.length}};
 }
 async preview(id:string,user:AuthUser){this.authorize(user);return this.db.$transaction(async tx=>(await this.inspect(tx,id,user)).preview,{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000});}
 // FIX: all guards are repeated under the request row lock and one serializable transaction.
 async remove(id:string,input:{reason:string;number:number;revision:string;confirmed:boolean},user:AuthUser){
  this.authorize(user);
  const reason=typeof input.reason==='string'?input.reason.trim():'';
  if(reason.length<5||reason.length>2000||input.confirmed!==true||!Number.isInteger(input.number)||!input.revision)throw new BadRequestException('Укажите причину (5–2000 символов), номер заявки и подтвердите действие.');
  try{return await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${id} FOR UPDATE`;
   const {r,tasks,preview}=await this.inspect(tx,id,user);
   const previous=await tx.auditLog.findFirst({where:{action:REMOVAL_ACTION,entity:'ClientRequest',entityId:id},select:{id:true}});
   if(previous&&r.status==='CANCELLED')return {id,number:r.number,removed:true,alreadyRemoved:true};
   if(input.number!==r.number)throw new BadRequestException('Номер подтверждения не совпадает с заявкой.');
   if(!preview.allowed)throw new ConflictException(preview.blockers.join(' '));
   if(preview.revision!==input.revision)throw new ConflictException('Заявка изменилась. Повторите предпросмотр удаления.');
   // Same per-order locks as manual and scheduled FBS creation, without waiting on another transaction.
   for(const key of [...new Set(r.fbsOrderLinks.map(l=>`fbs-assembly:${r.clientId}:${l.connectionId}:${l.orderId}`))].sort()){
    const rows=await tx.$queryRaw<Array<{locked:boolean}>>`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked`;
    if(!rows[0]?.locked)throw new ConflictException('Заказы обрабатываются другой операцией. Повторите позже.');
   }
   await tx.clientRequest.update({where:{id},data:{status:'CANCELLED',assignedToUserId:null,managerComment:[r.managerComment,`Удалена администратором: ${reason}`].filter(Boolean).join('\n')}});
   await tx.fbsOrderRequestLink.updateMany({where:{requestId:id},data:{syncStatus:ADMIN_REMOVED,syncIssue:reason}});
   // Preserve task ownership as a tombstone: no stock/KIZ writes and no new AUTO task for this order.
   await tx.fbsTsdAssembly.updateMany({where:{requestId:id},data:{status:'CANCELLED',reservedBoxId:null,reservedBoxCode:null,reservedAt:null}});
   await tx.clientRequestEvent.create({data:{requestId:id,clientId:r.clientId,eventType:'STATUS_CHANGED',title:'Заявка удалена администратором',body:reason,statusFrom:r.status,statusTo:'CANCELLED',createdByUserId:user.id}});
   await tx.auditLog.create({data:{userId:user.id,action:REMOVAL_ACTION,entity:'ClientRequest',entityId:id,payload:{reason,before:JSON.parse(JSON.stringify({request:r,tasks})),preview,externalCancellation:false}}});
   return {id,number:r.number,removed:true,alreadyRemoved:false};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:20000});}
  catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2034')throw new ConflictException('Заявка изменилась во время удаления. Обновите предпросмотр.');throw e;}
 }
}
