import {dispatchKey} from './wb-fbo-dispatch';
import {StockOperationsService} from '../stock/stock-operations.service';
import {BadGatewayException,BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {PrismaService} from '../../common/prisma/prisma.service';
import {ClientScopeService} from '../auth/client-scope.service';
import type {AuthUser} from '../auth/auth.types';
import {assertWarehouseAccess} from './client-request-warehouse-scope';
import {assertRequestNotRemoved} from './request-removal-policy';
import {readFbsAttemptHistory} from '../../common/shipment-history/fbs-attempt-history';
// FIX: extract an ID, never fetch an arbitrary pasted URL.
export function wbFboSupplyId(input:string) {
 let value=input?.trim();
 if(!value)throw new BadRequestException('Укажите номер или ссылку на поставку WB.');
 if(!/^\d+$/.test(value)){
  let u:URL;try{u=new URL(value);}catch{throw new BadRequestException('Некорректная ссылка WB.');}
  if(u.protocol!=='https:'||u.hostname!=='seller.wildberries.ru'||u.username||u.password||u.port||u.searchParams.getAll('supplyId').length!==1)throw new BadRequestException('Нужна ссылка кабинета WB с supplyId.');
  value=u.searchParams.get('supplyId')||'';
 }
 if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value)))throw new BadRequestException('Некорректный номер поставки WB.');
 return value;
}
export const wbFboStatuses:Record<number,string>={1:'Не запланировано',2:'Запланировано',3:'Отгрузка разрешена',4:'Идёт приёмка',5:'Принято',6:'Отгружено на воротах WB'};
type Binding={connectionId:string;supplyId:string;linkedAt:string;linkedBy:string;checkedAt:string;statusId:number;status:string;warehouse:string;date:string|null;quantity:number;acceptedQuantity:number;gate?:{at:string;userId:string};lastError?:string;attemptedAt?:string};
const key=(id:string)=>'wb-fbo-tracking:v1:'+id;
@Injectable()
export class WbFboSupplyService {
 constructor(private readonly db:PrismaService,private readonly scopes:ClientScopeService,private readonly stock?:StockOperationsService){}
 private async load(id:string,user:AuthUser,mode:'read'|'write',db:any=this.db,allowOther=false){
  if(process.env.WMS_MARKETPLACE_WORKSPACES_ENABLED!=='true')throw new NotFoundException();
  if(mode==='write'&&(user.isDemo||!user.permissionCodes.some(p=>p==='system:admin'||p==='client-requests:write')))throw new ForbiddenException();
  const r=await db.clientRequest.findUnique({where:{id},include:{ozonShipment:{select:{requestId:true}},lamodaAssembly:{select:{requestId:true}},yandexFbyShipment:{select:{id:true}},fboAssembly:{select:{phase:true}},items:{select:{quantity:true}},_count:{select:{fbsOrderLinks:true}}}});
  if(!r)throw new NotFoundException('Заявка не найдена.');
  this.scopes.requireClientAccess(user,r.clientId,mode);assertWarehouseAccess(user,r,mode);
  if(r.type!=='OUTBOUND'||(!allowOther&&(r.ozonShipment||r.lamodaAssembly||r.yandexFbyShipment))||r._count.fbsOrderLinks||/^(FBS|DBS)/i.test(r.title.trim())||r.comment?.toLocaleLowerCase('ru-RU').includes('создано из fbs-заказов:')||(await readFbsAttemptHistory(db,{requestId:id})).length)throw new BadRequestException('Привязка доступна только для ФБО WB.');
  if(mode==='write'){await assertRequestNotRemoved(db,id);if(['CANCELLED','REJECTED'].includes(r.status))throw new ConflictException('Заявка отменена.');}
  return r;
 }
 private async stored(db:any,id:string):Promise<Binding|null>{return (await db.systemSetting.findUnique({where:{key:key(id)}}))?.value??null;}
 private async connection(id:string,clientId:string){const c=await this.db.clientMarketplaceConnection.findFirst({where:{id,clientId,marketplace:'WILDBERRIES',isActive:true}});if(!c)throw new BadRequestException('Действующее подключение WB этого клиента не найдено.');return c;}
 // FIX: fixed read endpoint, bounded timeout, no marketplace writes or raw response logging.
 async remote(c:{apiKey:string},id:string){
  let response:Response;try{response=await fetch('https://supplies-api.wildberries.ru/api/v1/supplies/'+id+'?isPreorderID=false',{headers:{Authorization:c.apiKey},signal:AbortSignal.timeout(20000),redirect:'error'});}catch{throw new BadGatewayException('Нет ответа WB. Повторите проверку.');}
  if(response.status===429)throw new BadGatewayException('WB временно ограничил запросы (HTTP 429). Повторите проверку поставки позже.');
  if(!response.ok)throw new BadGatewayException(response.status===403?'Нет доступа к поставкам WB у этого API-ключа.':`WB: HTTP ${response.status}.`);
  let data:any;try{data=await response.json();}catch{throw new BadGatewayException('Некорректный ответ WB.');}
  if(!Number.isInteger(data.statusID)||!wbFboStatuses[data.statusID]||!Number.isSafeInteger(data.quantity)||data.quantity<0||!Number.isSafeInteger(data.acceptedQuantity)||data.acceptedQuantity<0)throw new BadGatewayException('WB не подтвердил статус и количество поставки.');
  return {statusId:data.statusID,status:wbFboStatuses[data.statusID],warehouse:String(data.warehouseName??''),date:typeof data.supplyDate==='string'?data.supplyDate:null,quantity:data.quantity,acceptedQuantity:data.acceptedQuantity,checkedAt:new Date().toISOString()};
 }
 // FIX: after picking closes, use one physical unit per record, excluding returns.
 private async bindingQuantity(db:any,r:{id:string;items:{quantity:number}[];fboAssembly?:{phase:string}|null}){
  const plannedQuantity=r.items.reduce((sum,line)=>sum+line.quantity,0);
  if(process.env.WMS_WB_FBO_ACTUAL_BINDING_ENABLED!=='true'||!r.fboAssembly||
     !['PACKING','CONTROL','COMPLETED'].includes(r.fboAssembly.phase)){
   return {plannedQuantity,bindingQuantity:plannedQuantity,quantityBasis:'plan' as const};
  }
  const groups:{state:string;_count:number}[]=await db.fboAssemblyUnit.groupBy({by:['state'],where:{requestId:r.id,state:{not:'RETURNED'}},_count:true});
  const picked=groups.reduce((sum,group)=>sum+group._count,0);
  const packed=groups.find(group=>group.state==='PACKED')?._count??0;
  return {plannedQuantity,bindingQuantity:picked>0&&picked===packed?packed:null,quantityBasis:'actual' as const};
 }
 async view(id:string,user:AuthUser){const r=await this.load(id,user,'read',this.db,true);return {dispatch:(await this.db.systemSetting.findUnique({where:{key:dispatchKey(id)}}))?.value??null,binding:await this.stored(this.db,id),...await this.bindingQuantity(this.db,r),canWrite:!user.isDemo&&user.permissionCodes.some(p=>p==='system:admin'||p==='client-requests:write'),canGate:['PACKED','DONE'].includes(r.status)&&r.fboAssembly?.phase==='COMPLETED',connections:await this.db.clientMarketplaceConnection.findMany({where:{clientId:r.clientId,marketplace:'WILDBERRIES',isActive:true},select:{id:true,accountName:true,sellerId:true}})};}
 private async event(tx:any,r:any,user:AuthUser,title:string,body:string){await tx.clientRequestEvent.create({data:{requestId:r.id,clientId:r.clientId,eventType:'COMMENT',title,body,createdByUserId:user.id}});await tx.auditLog.create({data:{userId:user.id,action:'WB_FBO_TRACKING',entity:'ClientRequest',entityId:r.id,payload:{title,body}}});}
 async bind(id:string,connectionId:string,input:string,user:AuthUser){
  const r=await this.load(id,user,'write'),supplyId=wbFboSupplyId(input),c=await this.connection(connectionId,r.clientId),snapshot=await this.remote(c,supplyId);
  await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${id} FOR UPDATE`;
   const fresh=await this.load(id,user,'write',tx);
   const {bindingQuantity,quantityBasis}=await this.bindingQuantity(tx,fresh);
   if(bindingQuantity===null)throw new ConflictException('Для привязки по факту завершите упаковку всех отобранных единиц.');
   if(snapshot.quantity!==bindingQuantity)throw new ConflictException(`В WB ${snapshot.quantity} шт., ${quantityBasis==='actual'?'отобрано и упаковано':'в заявке'} ${bindingQuantity} шт. Проверьте поставку.`);
   const claim='wb-fbo-supply-owner:v1:'+connectionId+':'+supplyId;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${claim}))`;
   const old=await this.stored(tx,id),owner=await tx.systemSetting.findUnique({where:{key:claim}});
   if(owner&&(owner.value as any).requestId!==id)throw new ConflictException('Поставка WB уже привязана к другой заявке.');
   if(old){if(old.connectionId===connectionId&&old.supplyId===supplyId)return;throw new ConflictException('Заявка уже привязана. Изменение привязки требует разбора.');}
   await tx.systemSetting.create({data:{key:claim,value:{requestId:id},updatedByUserId:user.id}});
   await tx.systemSetting.create({data:{key:key(id),value:{connectionId,supplyId,linkedAt:new Date().toISOString(),linkedBy:user.id,...snapshot},updatedByUserId:user.id}});
   await this.event(tx,fresh,user,'Привязана поставка ФБО WB',`WB №${supplyId} · ${snapshot.quantity} шт. · ${snapshot.warehouse}`);
  });return this.view(id,user);
 }
 async refresh(id:string,user:AuthUser){
  const r=await this.load(id,user,'read');if(user.isDemo)throw new ForbiddenException();
  const before=await this.stored(this.db,id);if(!before)throw new ConflictException('Сначала привяжите поставку WB.');
  // FIX: shared fresh read avoids polling the same supply repeatedly across viewers.
  if(Date.now()-Date.parse(before.attemptedAt??before.checkedAt)<30000)return this.view(id,user);
  let snapshot:Awaited<ReturnType<WbFboSupplyService['remote']>>|undefined,error:string|undefined;
  try{snapshot=await this.remote(await this.connection(before.connectionId,r.clientId),before.supplyId);}catch(e){error=e instanceof Error?e.message:'Ошибка проверки WB';}
  await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${id} FOR UPDATE`;
   const fresh=await this.load(id,user,'read',tx),current=await this.stored(tx,id);
   if(!current||current.checkedAt!==before.checkedAt||current.attemptedAt!==before.attemptedAt)return;
   const next={...current,...snapshot,attemptedAt:new Date().toISOString(),lastError:error??''};
   await tx.systemSetting.update({where:{key:key(id)},data:{value:next,updatedByUserId:user.id}});
   if(snapshot&&current.statusId!==snapshot.statusId)await this.event(tx,fresh,user,'Обновлён статус поставки WB',`WB №${current.supplyId}: ${snapshot.status}. Принято ${snapshot.acceptedQuantity} из ${snapshot.quantity} шт.`);
  });
  const latest=await this.stored(this.db,id),dispatch=await this.db.systemSetting.findUnique({where:{key:dispatchKey(id)}});
  if(r.status==='PACKED'&&r.fboAssembly?.phase==='COMPLETED'&&snapshot&&latest&&latest.quantity===r.items.reduce((n:number,i:any)=>n+i.quantity,0)&&[4,5,6].includes(latest.statusId)&&dispatch&&this.stock&&!user.isDemo&&user.permissionCodes.some(p=>p==='system:admin'||p==='client-requests:write')){
   await this.load(id,user,'write');
   // FIX: reuse idempotent stock shipment, never change quantities directly from a remote snapshot.
   await this.stock.shipClientRequest({requestId:id,idempotencyKey:`ship-request:${id}`,comment:`Сдано: WB №${latest.supplyId}, ${latest.status}.`},user);
  }
  return this.view(id,user);
 }
 async gate(id:string,user:AuthUser){
  await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${id} FOR UPDATE`;
   const r=await this.load(id,user,'write',tx,true);
   if(await tx.systemSetting.findUnique({where:{key:dispatchKey(id)}}))return;
   if(r.status!=='PACKED'||r.fboAssembly?.phase!=='COMPLETED')throw new ConflictException('Сначала завершите упаковку и проверку коробов.');
   await tx.systemSetting.create({data:{key:dispatchKey(id),value:{at:new Date().toISOString(),userId:user.id},updatedByUserId:user.id}});
   await this.event(tx,r,user,'Отгружено — загружено в автомобиль','Ручное подтверждение загрузки. Сдача маркетплейсу подтверждается отдельно.');
  });return this.view(id,user);
 }
}
