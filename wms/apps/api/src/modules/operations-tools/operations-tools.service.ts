import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { warehouseScopeWhere } from '../client-requests/client-request-warehouse-scope';
import { physicalKizIdentity } from '../../common/kiz-physical-identity';
import { receiptRules, receiptAllows } from '../warehouse/receipt-channel-policy';

export function exactRequestNumber(q:string):number|undefined {
  if(!/^№?0*\d{1,10}$/.test(q))return undefined;
  const n=Number(q.replace(/^№/,''));return Number.isSafeInteger(n)&&n>0&&n<=2147483647?n:undefined;
}
@Injectable()
export class OperationsToolsService {
  constructor(private readonly db:PrismaService,private readonly scopes:ClientScopeService){}
  enabled(){if(process.env.WMS_OPERATIONS_TOOLS_ENABLED!=='true')throw new NotFoundException();}
  private scope(user:AuthUser,write=false){
    this.enabled();return {clientId:this.scopes.resolveClientFilter(user),...warehouseScopeWhere(user,write?'write':'read')};
  }
  async requests(value:string,user:AuthUser) {
    const q=(value??'').trim();if(!q||q.length>128)throw new BadRequestException('Введите номер заявки.');
    const number=exactRequestNumber(q);
    const rows=await this.db.clientRequest.findMany({where:{...this.scope(user),OR:[{id:q},...(number===undefined?[]:[{number}])]},take:21,select:{id:true,number:true,title:true,status:true}});
    return {rows:rows.slice(0,20).map(r=>({kind:'request',id:r.id,label:`№${r.number} · ${r.title}`,detail:r.status})),truncated:rows.length>20};
  }
  async readiness(id:string,user:AuthUser) {
    const r=await this.db.clientRequest.findFirst({where:{id,...this.scope(user)},select:{id:true,number:true,title:true,status:true,clientId:true,warehouseId:true,
      items:{select:{quantity:true}},fboAssembly:{select:{phase:true}},ozonShipment:{select:{integration:true}},_count:{select:{files:true}}}});
    if(!r)throw new NotFoundException('Заявка не найдена.');
    const [units,boxes,charges]=await Promise.all([
      this.db.fboAssemblyUnit.groupBy({by:['state'],where:{requestId:id},_count:true}),
      this.db.fboAssemblyBox.findMany({where:{requestId:id},select:{confirmedAt:true,closedAt:true}}),
      user.permissionCodes.includes('billing:read')||user.permissionCodes.includes('system:admin')?this.db.billingCharge.count({where:{requestId:id,status:{not:'CANCELLED'}}}):Promise.resolve(null),
    ]);
    const needed=r.items.reduce((s,i)=>s+i.quantity,0),picked=units.filter(u=>u.state!=='RETURNED').reduce((s,u)=>s+u._count,0),packed=units.find(u=>u.state==='PACKED')?._count??0;
    const integration=r.ozonShipment?.integration as any;
    const supplyIds=Array.isArray(integration?.supplies)?integration.supplies.map((s:any)=>String(s.id)):[];
    const accepted=supplyIds.length>0&&supplyIds.every((id:string)=>integration.operations?.[id]?.state==='SUCCESS');
    const confirmed=boxes.length>0&&boxes.every(b=>b.closedAt&&b.confirmedAt);
    const step=(key:string,label:string,state:string,detail:string)=>({key,label,state,detail});
    return {id:r.id,number:r.number,title:r.title,status:r.status,observedAt:new Date().toISOString(),steps:[
      step('pick','Отбор',r.fboAssembly?(needed>0&&picked>=needed?'complete':'pending'):'unknown',r.fboAssembly?`${picked} из ${needed} шт.`:'Смотрите фактическое выполнение заданий ФБС.'),
      step('pack','Упаковка',r.fboAssembly?(needed>0&&packed>=needed?'complete':'pending'):'unknown',r.fboAssembly?`${packed} из ${needed} шт.`:'Проверяется в онлайн-выполнении.'),
      step('confirm','Подтверждение коробов',confirmed?'complete':r.fboAssembly?'pending':'unknown',`${boxes.filter(b=>b.confirmedAt&&b.closedAt).length} из ${boxes.length} коробов`),
      step('marketplace','Грузоместа маркетплейса',r.ozonShipment?(accepted?'complete':'pending'):'unknown',r.ozonShipment?(accepted?'Ozon подтвердил все грузоместа.':'Проверьте передачу грузомест Ozon.'):'Проверьте статус передачи в разделе маркетплейса.'),
      step('documents','Документы','unknown',confirmed?'Можно сформировать файлы по подтверждённым коробам.':`В заявке ${r._count.files} файлов; готовность отгрузочных документов не подтверждена.`),
      step('billing','Начисления',charges===null?'unknown':charges>0?'complete':'pending',charges===null?'Нет доступа к начислениям.':charges>0?`Есть ${charges} начислений; это не подтверждение оплаты.`:'Начисления ещё не найдены.'),
    ]};
  }
  async search(value:string,user:AuthUser) {
    const q=(value??'').trim();if(!q||q.length>512)throw new BadRequestException('Введите точный номер, ШК или КИЗ (до 512 символов).');
    const scope=this.scope(user),number=exactRequestNumber(q),identity=physicalKizIdentity(q);
    // FIX: authorization filters precede limits and exact matching. IDs remain strings.
    const [requests,boxes,pallets,balances,marks]=await Promise.all([
      this.db.clientRequest.findMany({where:{...scope,OR:[{id:q},...(number===undefined?[]:[{number}])]},take:21,select:{id:true,number:true,title:true,status:true}}),
      this.db.box.findMany({where:{...scope,code:q},take:21,select:{id:true,code:true,status:true}}),
      this.db.storagePallet.findMany({where:{...scope,code:q},take:21,select:{id:true,code:true,status:true}}),
      this.db.stockBalance.findMany({where:{...scope,quantity:{gt:0},sku:{barcodes:{some:{value:q}}}},take:21,orderBy:{id:'asc'},select:{id:true,quantity:true,status:true,sku:{select:{name:true,size:true}},box:{select:{code:true}},warehouse:{select:{name:true}}}}),
      this.db.productMark.findMany({where:{clientId:scope.clientId,...(scope.warehouseId?{OR:[{box:{warehouseId:scope.warehouseId}},{boxId:null,stockMovement:{warehouseId:scope.warehouseId}}]}:{}),
        AND:[identity?{OR:[identity,']d2'+identity,']D2'+identity].map(prefix=>({value:{startsWith:prefix}}))}:{value:q}]},take:21,select:{id:true,value:true,status:true,sku:{select:{name:true}},box:{select:{code:true}}}}),
    ]);
    const rows=[...requests.slice(0,20).map(r=>({kind:'request',id:r.id,label:`№${r.number} · ${r.title}`,detail:r.status})),
      ...boxes.slice(0,20).map(b=>({kind:'box',id:b.id,label:b.code,detail:b.status})),...pallets.slice(0,20).map(p=>({kind:'pallet',id:p.id,label:p.code,detail:p.status})),
      ...balances.slice(0,20).map(b=>({kind:'balance',id:b.id,label:`${b.sku.name} · ${b.sku.size??''}`,detail:`${b.quantity} шт. · ${b.status} · ${b.box?.code??'Без короба'} · ${b.warehouse?.name??'Филиал не указан'}`})),
      ...marks.filter(m=>!identity||physicalKizIdentity(m.value)===identity).slice(0,20).map(m=>({kind:'mark',id:m.id,label:m.sku.name,detail:`${m.status} · ${m.box?.code??'Без короба'}`}))];
    return {rows,truncated:[requests,boxes,pallets,balances,marks].some(a=>a.length>20)};
  }
  async box(id:string,user:AuthUser) {
    const scope=this.scope(user);const box=await this.db.box.findFirst({where:{id,...scope},select:{id:true,clientId:true,warehouseId:true,code:true,zone:{select:{name:true}},storagePlacement:{select:{pallet:{select:{code:true}}}}}});
    if(!box)throw new NotFoundException('Короб не найден.');
    const rules=await receiptRules(this.db,box.clientId,box.warehouseId,[id]),rule=rules.get(id);
    const [tasks,history]=await Promise.all([
      this.db.fbsTsdAssembly.findMany({where:{clientId:box.clientId,...(scope.warehouseId?{stockWarehouseId:scope.warehouseId}:{}),OR:[{boxId:id},{reservedBoxId:id}],status:{in:['RESERVED','IN_PROGRESS','WAITING_STOCK','RESCAN_REQUIRED']}},take:30,select:{requestId:true,orderId:true,itemCount:true,status:true}}),
      this.db.stockMovement.findMany({where:{boxId:id,...scope},orderBy:{createdAt:'desc'},take:30,select:{type:true,status:true,quantity:true,createdAt:true,sourceDocument:true}}),
    ]);
    return {code:box.code,zone:box.zone?.name,pallet:box.storagePlacement?.pallet.code,receiptApproved:rule?.stockAvailable!==false,fbsAllowed:receiptAllows(rule,'fbs'),fboAllowed:receiptAllows(rule,'fbo'),tasks,history};
  }
  private sqlScope(user:AuthUser) {
    const scope=this.scope(user),f=scope.clientId;
    const client=typeof f==='string'?Prisma.sql`r."clientId"=${f}`:f&&'in'in f?(f.in.length?Prisma.sql`r."clientId" IN (${Prisma.join(f.in)})`:Prisma.sql`FALSE`):f&&'notIn'in f&&f.notIn.length?Prisma.sql`r."clientId" NOT IN (${Prisma.join(f.notIn)})`:Prisma.sql`TRUE`;
    return Prisma.sql`${client} AND ${scope.warehouseId?Prisma.sql`r."warehouseId"=${scope.warehouseId}`:Prisma.sql`TRUE`}`;
  }
  async attention(user:AuthUser) {
    return this.db.$queryRaw(Prisma.sql`SELECT q."key",q."requestId",r.number,r.title,q.cause,q.label,q."reasonCode",q.attempts,q."lastAttemptAt",q."nextAttemptAt",q."updatedAt",q."assignedToId",u.name AS "assignedToName"
      FROM "WmsReconciliationCase" q JOIN "ClientRequest" r ON r.id=q."requestId" AND r."clientId"=q."clientId"
      LEFT JOIN "User" u ON u.id=q."assignedToId" WHERE q."resolvedAt" IS NULL AND ${this.sqlScope(user)}
      ORDER BY q."createdAt",q."key" LIMIT 100`);
  }
  async take(key:string,user:AuthUser) {
    const rows=await this.db.$queryRaw<Array<{requestId:string;clientId:string}>>(Prisma.sql`SELECT q."requestId",q."clientId" FROM "WmsReconciliationCase" q JOIN "ClientRequest" r ON r.id=q."requestId" AND r."clientId"=q."clientId" WHERE q."key"=${key} AND ${this.sqlScope(user)}`);
    if(!rows.length)throw new NotFoundException();this.scopes.requireClientAccess(user,rows[0].clientId,'write');
    const r=await this.db.clientRequest.findFirst({where:{id:rows[0].requestId,...this.scope(user,true)},select:{id:true}});if(!r)throw new NotFoundException();
    await this.db.$transaction(async tx=>{
      const n=await tx.$executeRaw(Prisma.sql`UPDATE "WmsReconciliationCase" SET "assignedToId"=${user.id},"updatedAt"=NOW() WHERE "key"=${key} AND "resolvedAt" IS NULL AND ("assignedToId" IS NULL OR "assignedToId"=${user.id})`);
      if(!n)throw new BadRequestException('Случай уже взят другим сотрудником или закрыт.');
      await tx.auditLog.create({data:{userId:user.id,action:'RECONCILIATION_ASSIGNED',entity:'WmsReconciliationCase',entityId:key,payload:{requestId:r.id}}});
    });return {ok:true};
  }
}
