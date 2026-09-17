import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { WarehouseAuthScopeService } from '../auth/warehouse-auth-scope.service';
import { assertWarehouseAccess } from '../client-requests/client-request-warehouse-scope';
import { kizIdentity, scanPeriod, withoutConfirmedPrint } from './unprinted-kiz.policy';
import type { CreateKizSearchDto, UnprintedKizQuery } from './unprinted-kiz.controller';

const record=(value:unknown):Record<string,unknown>=>value && typeof value==='object' && !Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown)=>typeof value==='string'?value:'';
const CREATED='KIZ_SEARCH_CREATED';
const userInclude={roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}},clientScopes:{include:{client:{select:{isDemo:true,relabelingEnabled:true}}}},warehouseScopes:{include:{warehouse:{select:{isActive:true}}}}} as const;
type Db=Prisma.TransactionClient;

@Injectable()
export class UnprintedKizService {
  constructor(private readonly prisma:PrismaService,private readonly scopes:ClientScopeService) {}
  private enabled(user:AuthUser) {
    if (!user.permissionCodes.includes('system:admin')) throw new ForbiddenException('Нет доступа к сервисному меню.');
    if (process.env.WMS_UNPRINTED_KIZ_SEARCH!=='true') throw new NotFoundException('Поиск неотгруженных КИЗ выключен.');
  }
  private async check(db:Db,input:UnprintedKizQuery,user:AuthUser,write=false) {
    this.enabled(user); scanPeriod(input.dateFrom,input.dateTo);
    this.scopes.requireClientAccess(user,input.clientId,write?'write':'read');
    assertWarehouseAccess(user,{warehouseId:input.warehouseId},write?'write':'read');
    const client=await db.client.findFirst({where:{id:input.clientId,isDemo:Boolean(user.isDemo)},select:{id:true}});
    const warehouse=await db.warehouse.findFirst({where:{id:input.warehouseId,isActive:true},select:{id:true}});
    if(!client||!warehouse) throw new NotFoundException('Клиент или филиал недоступен.');
  }
  async report(input:UnprintedKizQuery,user:AuthUser) {
    return this.prisma.$transaction(async db=>{
      await db.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await this.check(db,input,user);
      return {rows:await this.rows(db,input),checkedAt:new Date().toISOString(),timezone:'Europe/Moscow'};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
  }
  private async rows(db:Db,input:UnprintedKizQuery) {
    const period=scanPeriod(input.dateFrom,input.dateTo);
    const audits=await db.auditLog.findMany({where:{entity:'FbsTsdAssembly',action:{in:['FBS_KIZ_SCAN_ACCEPTED','FBS_WB_KIZ_REPLACED_AFTER_PRODUCT_PICK']},
      createdAt:{gte:period.from,lt:period.until},payload:{path:['clientId'],equals:input.clientId}},orderBy:[{createdAt:'desc'},{id:'asc'}],take:5001});
    if(audits.length>5000) throw new BadRequestException('За период более 5000 сканирований. Сократите период проверки.');
    const ids=audits.map(a=>a.entityId).filter((x):x is string=>!!x);
    const requestIds=[...new Set(audits.map(a=>text(record(a.payload).requestId)).filter(Boolean))];
    const [requests,tasks,attempts,jobs,shipments,markers]=await Promise.all([
      db.clientRequest.findMany({where:{id:{in:requestIds},clientId:input.clientId,warehouseId:input.warehouseId},select:{id:true,number:true}}),
      db.fbsTsdAssembly.findMany({where:{id:{in:ids},clientId:input.clientId,marketplace:'WILDBERRIES'},select:{id:true,requestId:true,orderId:true,skuId:true,barcode:true,productName:true,kiz:true,connectionId:true}}),
      db.fbsAssemblyAttemptHistory.findMany({where:{clientId:input.clientId,requestId:{in:requestIds}},select:{id:true,requestId:true,orderId:true,kiz:true,taskSnapshot:true}}),
      db.fbsPrintJob.findMany({where:{assemblyId:{in:ids}},select:{id:true,assemblyId:true,requestId:true,orderId:true,kiz:true,status:true,printedAt:true}}),
      db.shippedKizHistory.findMany({where:{clientId:input.clientId,assemblyId:{in:ids}},select:{assemblyId:true,kiz:true,shippedAt:true}}),
      db.auditLog.findMany({where:{action:CREATED,entity:'ClientRequest'},select:{entityId:true,payload:true}}),
    ]);
    const acknowledgements=await db.auditLog.findMany({where:{action:'FBS_TWO_LABELS_PRINTED',entity:'FbsPrintJob',entityId:{in:jobs.map(j=>j.id)}},select:{entityId:true,createdAt:true}});
    // FIX: a later failed retry must not erase a previously acknowledged successful print.
    const confirmed=[...jobs,...acknowledgements.flatMap(a=>{const j=jobs.find(j=>j.id===a.entityId);return j?[{...j,status:'PRINTED',printedAt:a.createdAt}]:[];})];
    const searches=await db.clientRequest.findMany({where:{id:{in:markers.map(m=>m.entityId).filter((x):x is string=>!!x)},clientId:input.clientId,warehouseId:input.warehouseId},select:{id:true,number:true,status:true}});
    const actors=await db.user.findMany({where:{id:{in:audits.map(a=>a.userId).filter((x):x is string=>!!x)}},select:{id:true,name:true}});
    const boxes=await db.box.findMany({where:{clientId:input.clientId,warehouseId:input.warehouseId,code:{in:audits.map(a=>text(record(a.payload).boxCode)).filter(Boolean)}},select:{code:true}});
    const archived=attempts.map(a=>{const s=record(a.taskSnapshot);return {id:text(s.id)||a.id,requestId:a.requestId,orderId:a.orderId,skuId:text(s.skuId),barcode:text(s.barcode),productName:text(s.productName),connectionId:text(s.connectionId),kiz:a.kiz};});
    const seen=new Set<string>();
    return audits.flatMap(a=>{
      const p=record(a.payload),requestId=text(p.requestId),orderId=text(p.orderId),raw=text(p.kiz)||text(p.scannedKiz),kiz=kizIdentity(raw),assemblyId=a.entityId??'';
      const request=requests.find(r=>r.id===requestId);
      if(!request||!assemblyId||!kiz||!orderId) return [];
      const task=[...tasks,...archived].find(t=>t.id===assemblyId && t.requestId===requestId && t.orderId===orderId && kizIdentity(t.kiz??'')===kiz);
      const key=[assemblyId,requestId,orderId,kiz].join('|');
      if(seen.has(key)) return [];seen.add(key);
      if(!withoutConfirmedPrint({assemblyId,requestId,orderId,kiz,at:a.createdAt},confirmed)) return [];
      const search=searches.find(r=>markers.some(m=>m.entityId===r.id && Array.isArray(record(m.payload).targets) && (record(m.payload).targets as unknown[]).some(target=>{
        const t=record(target);return t.sourceAuditId===a.id || (['SUBMITTED','IN_WORK'].includes(r.status) && text(t.kiz)===kiz);
      })));
      const shipped=shipments.find(s=>s.assemblyId===assemblyId && kizIdentity(s.kiz)===kiz);
      const boxCode=text(p.boxCode);
      const reason=search?`Уже в заявке поиска №${search.number}`:shipped?'Есть запись отгрузки WMS':!task?.skuId?'Привязка КИЗ к сборке изменилась':!boxes.some(b=>b.code===boxCode)?'Исходный короб не найден в филиале':'';
      return [{id:a.id,assemblyId,requestId,requestNumber:request.number,orderId,connectionId:task?.connectionId??'',kiz,scannedAt:a.createdAt.toISOString(),
        workerName:text(p.workerName)||actors.find(u=>u.id===a.userId)?.name||'Не установлен',boxCode:boxCode||'Без короба',skuId:task?.skuId??'',barcode:task?.barcode??'',productName:task?.productName??'',
        printState:jobs.filter(j=>j.assemblyId===assemblyId && j.requestId===requestId && kizIdentity(j.kiz)===kiz).map(j=>j.status).join(', ')||'Нет записи печати',searchRequestNumber:search?.number??null,shippedAt:shipped?.shippedAt.toISOString()??null,blockedReason:reason}];
    });
  }
  private async eligible(db:Db,input:UnprintedKizQuery,id?:string) {
    const users=await db.user.findMany({where:{status:'ACTIVE',...(id?{id}:{})},include:userInclude});
    const result:Array<{id:string;name:string}>=[];
    for(const u of users) {
      const roleCodes=u.roles.map(r=>r.role.code),permissionCodes=[...new Set(u.roles.flatMap(r=>r.role.permissions.map(p=>p.permission.code)))];
      if(roleCodes.includes('CLIENT') || (!permissionCodes.includes('system:admin') && !['stock:read','stock:write'].every(p=>permissionCodes.includes(p)))) continue;
      try {
        const scope=await new WarehouseAuthScopeService(db as PrismaService).resolve({...u,activeWarehouseId:input.warehouseId,roleCodes,permissionCodes});
        const auth={...u,...scope,roleCodes,permissionCodes,warehouseIds:u.warehouseScopes.filter(w=>w.canRead).map(w=>w.warehouseId),writableWarehouseIds:u.warehouseScopes.filter(w=>w.canWrite).map(w=>w.warehouseId)};
        this.scopes.requireClientAccess(auth,input.clientId,'write');assertWarehouseAccess(auth,{warehouseId:input.warehouseId},'write');
        result.push({id:u.id,name:u.name});
      } catch(e) {if(!(e instanceof ForbiddenException || e instanceof NotFoundException)) throw e;}
    }
    return result;
  }
  async assignees(input:UnprintedKizQuery,user:AuthUser) {
    await this.check(this.prisma,input,user);
    return this.eligible(this.prisma,input);
  }
  async create(input:CreateKizSearchDto,user:AuthUser) {
    this.enabled(user);
    if(process.env.WMS_TSD_KIZ_SEARCH!=='true') throw new ConflictException('Поиск КИЗ на ТСД ещё не включён.');
    return this.prisma.$transaction(async db=>{
      await this.check(db,input,user,true);
      // FIX: serialize creators for this client/branch; retries return the same request.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`unprinted-kiz:${input.clientId}:${input.warehouseId}`}))::text`;
      const fingerprint=createHash('sha256').update(JSON.stringify({clientId:input.clientId,warehouseId:input.warehouseId,dateFrom:input.dateFrom,dateTo:input.dateTo,assignedToUserId:input.assignedToUserId,scanIds:[...input.scanIds].sort()})).digest('hex');
      const previous=await db.auditLog.findFirst({where:{action:CREATED,payload:{path:['operationKey'],equals:input.operationId}}});
      if(previous) {
        if(previous.userId!==user.id || record(previous.payload).fingerprint!==fingerprint) throw new ConflictException('Ключ операции уже использован. Обновите список.');
        return db.clientRequest.findUniqueOrThrow({where:{id:previous.entityId!},select:{id:true,number:true}});
      }
      if(!(await this.eligible(db,input,input.assignedToUserId)).length) throw new BadRequestException('Сотрудник не имеет доступа к поиску для этого клиента и филиала.');
      const report=await this.rows(db,input),selected=report.filter(r=>input.scanIds.includes(r.id));
      if(selected.length!==input.scanIds.length || selected.some(r=>r.blockedReason)) throw new ConflictException('Список изменился: появилась печать, отгрузка или другая заявка поиска. Повторите проверку.');
      if(new Set(selected.map(r=>r.kiz)).size!==selected.length) throw new BadRequestException('Один физический КИЗ выбран несколько раз. Оставьте одну строку.');
      const targets=selected.map(r=>({itemId:randomUUID(),boxCode:r.boxCode,kiz:r.kiz,order:r.orderId,firstWorker:r.workerName,sourceAuditId:r.id,sourceRequestId:r.requestId,assemblyId:r.assemblyId}));
      const request=await db.clientRequest.create({data:{clientId:input.clientId,warehouseId:input.warehouseId,type:'OTHER',status:'SUBMITTED',assignedToUserId:input.assignedToUserId,createdByUserId:user.id,
        title:`Поиск ${selected.length} КИЗ без печати · ${input.dateFrom}–${input.dateTo}`,
        comment:'Сканируйте исходный короб, затем КИЗ. Найденный товар отложите отдельно. Поиск не изменяет остатки и привязки к заказам.',
        items:{create:selected.map((r,i)=>({id:targets[i].itemId,skuId:r.skuId,barcode:r.barcode,quantity:1,name:r.productName,comment:`Короб: ${r.boxCode}\nЗаказ WB: ${r.orderId}\nКИЗ: ${r.kiz}\nПервый сборщик: ${r.workerName}`}))}},select:{id:true,number:true}});
      await db.auditLog.create({data:{userId:user.id,action:CREATED,entity:'ClientRequest',entityId:request.id,payload:{operationKey:input.operationId,fingerprint,oneOff:true,assignedToUserId:input.assignedToUserId,sourceRequestNumbers:[...new Set(selected.map(r=>r.requestNumber))],targets}}});
      await db.clientRequestEvent.create({data:{requestId:request.id,clientId:input.clientId,eventType:'CREATED',createdByUserId:user.id,title:'Создана заявка поиска КИЗ без подтверждённой печати',body:`Период сканирования: ${input.dateFrom}–${input.dateTo}, МСК. ${selected.length} единиц.`}});
      return request;
    },{timeout:30000});
  }
}
