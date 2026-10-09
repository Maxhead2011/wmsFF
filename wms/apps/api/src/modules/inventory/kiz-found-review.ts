import {BadRequestException, ConflictException, ForbiddenException, NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {AuthUser} from '../auth/auth.types';
import {ClientScopeService} from '../auth/client-scope.service';
import {storageBoxTransferKizIdentity} from '../stock/stock-operations.service';

// FIX: isolated adapter for the deployed KizReviewCase model (source parity is not yet complete).
type Db = any;
export const foundReviewEnabled=()=>process.env.WMS_KIZ_FOUND_REVIEW_ENABLED==='true';
const json=(x:any)=>JSON.parse(JSON.stringify(x));
const identity=(value:string)=>{const p=storageBoxTransferKizIdentity(value);return p?`01${p.gtin}21${p.serial}`:'';};
const context=(m:any)=>createHash('sha256').update(JSON.stringify([m.id,m.clientId,m.skuId,m.boxId,m.status,m.updatedAt])).digest('hex');
const key=(m:any)=>`FOUND:${m.id}:${context(m)}`;
const prefixes=(s:string)=>[s,']d2'+s,']D2'+s,`(01)${s.slice(2,16)}(21)${s.slice(18)}`,s.slice(0,16)+'\u001d'+s.slice(16),s.slice(0,16)+'<GS>'+s.slice(16)];
const include={box:true,sku:true,stockMovement:true};
const fail=(message:string):never=>{throw new ConflictException(message);};
export type FoundAction={action:string;markId?:string;id?:string;reason?:string;confirmed?:boolean;boxCode?:string;releaseBindings?:boolean};

export class KizFoundReview {
  constructor(private db:Db,private clients:ClientScopeService,private inspect:(db:Db,client:string,kiz:string)=>Promise<any>){ }
  guard(user:AuthUser,write=false){
    if(!foundReviewEnabled()||user.isDemo||!user.roleCodes.some(r=>['ADMIN','OWNER','SUPER_ADMIN'].includes(r)))throw new ForbiddenException('Разбор доступен администратору и собственнику.');
    if(!user.activeWarehouseId)throw new BadRequestException('Выберите филиал.');
    if(!user.permissionCodes.includes('system:admin')&&((user.warehouseIds&&!user.warehouseIds.includes(user.activeWarehouseId))||(write&&user.writableWarehouseIds&&!user.writableWarehouseIds.includes(user.activeWarehouseId))))throw new ForbiddenException('Нет доступа к филиалу.');
  }
  async scopedMark(db:Db,id:string,user:AuthUser){
    const mark=await db.productMark.findFirst({where:{id,clientId:this.clients.resolveClientFilter(user),OR:[{box:{warehouseId:user.activeWarehouseId}},{boxId:null,stockMovement:{warehouseId:user.activeWarehouseId}}]},include});
    if(!mark)throw new NotFoundException('КИЗ не найден в выбранном филиале.');
    return mark;
  }
  async list(user:AuthUser){
    this.guard(user);
    const rows=await this.db.kizReviewCase.findMany({where:{warehouseId:user.activeWarehouseId,clientId:this.clients.resolveClientFilter(user),taskId:{startsWith:'FOUND:'},status:{in:['OPEN','APPROVED']},updatedAt:{gte:new Date(Date.now()-7*86400000)}},orderBy:{updatedAt:'desc'},take:100});
    return rows.map((r:any)=>this.view(r,user));
  }
  view(row:any,user:AuthUser){const history=(row.evidence?.history??[]).filter((h:any)=>h.request?.warehouseId===user.activeWarehouseId);return {...row,evidence:{...row.evidence,history,orders:(row.evidence?.orders??[]).filter((o:any)=>history.some((h:any)=>h.orderId===o.orderId))}};}
  async audit(tx:Db,user:AuthUser,row:any,action:string,payload:any){
    await tx.auditLog.create({data:{userId:user.id,action,entity:'KizReviewCase',entityId:row.id,payload:json(payload)}});
  }
  async act(dto:FoundAction,user:AuthUser){
    this.guard(user,true);
    if(!['OPEN','REUSE','RELABEL','RETURN','REJECT'].includes(dto.action)||dto.confirmed!==true)throw new BadRequestException('Подтвердите физическое наличие и выбранное действие.');
    const reason=(dto.reason??'').trim();
    if(reason.length<5||reason.length>1000)throw new BadRequestException('Укажите основание: 5–1000 символов.');
    const old=dto.action==='OPEN'?null:await this.db.kizReviewCase.findFirst({where:{id:dto.id??'',warehouseId:user.activeWarehouseId,clientId:this.clients.resolveClientFilter(user),taskId:{startsWith:'FOUND:'}}});
    if(dto.action!=='OPEN'&&!old)throw new NotFoundException('Обращение не найдено.');
    const initial=await this.scopedMark(this.db,dto.action==='OPEN'?dto.markId??'':old.snapshot.markId,user);
    this.clients.requireClientAccess(user,initial.clientId,'write');
    const evidence=dto.action==='REJECT'?old.evidence:await this.inspect(this.db,initial.clientId,initial.value);
    return this.db.$transaction(async(tx:Db)=>{
      // FIX: serialize case creation, decisions and stock return on the actual mark, not browser state.
      await tx.$queryRaw`SELECT id FROM "ProductMark" WHERE id=${initial.id} FOR UPDATE`;
      const mark=await this.scopedMark(tx,initial.id,user);
      if(dto.action==='RETURN'&&old){
        const completed=await tx.kizReviewCase.findUnique({where:{id:old.id}});
        if(completed?.snapshot?.returned&&completed.context===context(mark)&&completed.snapshot.boxCode===dto.boxCode?.trim())return completed;
      }
      if(context(mark)!==context(initial))fail('Единица изменилась. Повторите проверку.');
      const serial=identity(mark.value);
      if(!serial)fail('КИЗ не распознан.');
      const same=await tx.productMark.findMany({where:{OR:prefixes(serial).map(p=>({value:{startsWith:p}}))},select:{id:true,value:true}});
      if(same.filter((m:any)=>identity(m.value)===serial).length!==1)fail('Обнаружен дубль КИЗа. Требуется разбор дублей.');
      if(dto.action==='OPEN'){
        if(mark.status!=='SHIPPING'||mark.boxId)fail('Этот сценарий предназначен для найденного после отгрузки товара без короба.');
        const saved=await tx.kizReviewCase.findUnique({where:{taskId_kizIdentity:{taskId:key(mark),kizIdentity:serial}}});
        if(saved){
          if(saved.status==='REJECTED')fail('Обращение отклонено. Проверьте его историю.');
          return tx.kizReviewCase.update({where:{id:saved.id},data:{attempts:{increment:1}}});
        }
        const row=await tx.kizReviewCase.create({data:{taskId:key(mark),requestId:'',clientId:mark.clientId,warehouseId:user.activeWarehouseId,kizIdentity:serial,kiz:mark.value,context:context(mark),decision:evidence.decision,status:'OPEN',evidence:json(evidence),snapshot:json({scope:'FOUND',markId:mark.id,skuId:mark.skuId,productName:mark.sku.name,workerName:user.name,workerId:user.id,boxCode:null,returned:false,foundReason:reason})}});
        await this.audit(tx,user,row,'KIZ_PHYSICALLY_FOUND',{markId:mark.id,kizIdentity:serial,reason,context:row.context});
        return row;
      }
      const row=await tx.kizReviewCase.findUnique({where:{id:old.id}});
      if(!row||row.context!==context(mark)||!['OPEN','APPROVED'].includes(row.status))fail('Обращение или единица изменились. Обновите данные.');
      if(dto.action==='REJECT'){
        if(row.snapshot.returned||row.resolution)fail('Решение уже применено. Отклонение не отменяет возврат или разрешение.');
        const saved=await tx.kizReviewCase.update({where:{id:row.id},data:{status:'REJECTED',reason,decidedById:user.id,decidedByName:user.name,decidedAt:new Date()}});
        await this.audit(tx,user,row,'KIZ_FOUND_REJECTED',{reason});return saved;
      }
      if(dto.action==='REUSE'&&evidence.decision==='RELABEL')fail('Есть подтверждение продажи или погашения. Доступна переклейка.');
      const upgrade=dto.action==='RELABEL'&&row.resolution==='REUSE';
      if(['REUSE','RELABEL'].includes(dto.action)&&row.resolution&&row.resolution!==dto.action&&!upgrade)fail('Уже принято другое решение.');
      if(['REUSE','RELABEL'].includes(dto.action)&&row.resolution===dto.action)return row;
      let current=mark;
      let snapshot={...row.snapshot};
      if(dto.action==='RETURN'){
        if(snapshot.returned){if(snapshot.boxCode!==dto.boxCode?.trim())fail('Возврат уже выполнен в другой короб.');return row;}
        if(mark.status!=='SHIPPING'||mark.boxId)fail('Единица уже учтена или находится в сборке.');
        const shipments=(await tx.shippedKizHistory.findMany({where:{clientId:mark.clientId,warehouseId:user.activeWarehouseId,OR:prefixes(serial).map(p=>({kiz:{startsWith:p}}))}})).filter((h:any)=>identity(h.kiz)===serial);
        if(!shipments.length)fail('Нет подтверждённой истории отгрузки этой единицы. Нужен разбор складских движений.');
        const pending=await tx.stockMovement.aggregate({where:{clientId:mark.clientId,warehouseId:user.activeWarehouseId,skuId:mark.skuId,sourceDocument:{in:[...new Set(shipments.map((h:any)=>h.requestId))]},status:{in:['PACKING','SHIPPING']}},_sum:{quantity:true}});
        if((pending._sum.quantity??0)>0)fail('По прежней отгрузке остался внутренний резерв. Сначала необходимо сверить его движения.');
        const box=await tx.box.findFirst({where:{code:dto.boxCode?.trim()??'',clientId:mark.clientId,warehouseId:user.activeWarehouseId,status:{notIn:['archived','deleted']}}});
        if(!box)fail('Отсканируйте действующий короб этого клиента в выбранном филиале.');
        await tx.$queryRaw`SELECT id FROM "Box" WHERE id=${box.id} FOR UPDATE`;
        const freshBox=await tx.box.findUnique({where:{id:box.id}});
        if(!freshBox||freshBox.clientId!==mark.clientId||freshBox.warehouseId!==user.activeWarehouseId||['archived','deleted'].includes(freshBox.status))fail('Короб изменился.');
        await this.checkBindings(tx,mark,serial,user,row,dto.releaseBindings===true,false);
        const movement=await tx.stockMovement.create({data:{warehouseId:user.activeWarehouseId,clientId:mark.clientId,skuId:mark.skuId,boxId:box.id,palletId:box.palletId??null,type:'RETURN',status:'AVAILABLE',quantity:1,sourceDocument:row.id,idempotencyKey:`kiz-found:${row.id}:return`,comment:`Физический возврат КИЗа: ${reason}`}});
        const balanceKey=[mark.clientId,mark.skuId,box.id,box.palletId??'no-pallet','AVAILABLE'].join(':');
        await tx.stockBalance.upsert({where:{balanceKey},create:{balanceKey,warehouseId:user.activeWarehouseId,clientId:mark.clientId,skuId:mark.skuId,boxId:box.id,palletId:box.palletId??null,status:'AVAILABLE',quantity:1},update:{quantity:{increment:1}}});
        current=await tx.productMark.update({where:{id:mark.id},data:{boxId:box.id,status:'AVAILABLE',stockMovementId:movement.id},include});
        snapshot={...snapshot,returned:true,boxCode:box.code,boxId:box.id,movementId:movement.id,returnedBy:user.name,returnedAt:new Date().toISOString()};
        await this.audit(tx,user,row,'KIZ_FOUND_RETURNED',{reason,before:mark,boxId:box.id,movementId:movement.id});
      }
      const resolution=['REUSE','RELABEL'].includes(dto.action)?dto.action:row.resolution;
      // FIX: authorization alone does not mutate stock or detach an existing assembly.
      // Only an explicitly confirmed physical return may activate the one-use permission.
      if(snapshot.returned&&resolution){
        if(resolution==='REUSE'&&evidence.decision==='RELABEL')fail('Проверка обнаружила погашение КИЗа. Требуется новое решение о переклейке.');
        await this.checkBindings(tx,current,serial,user,row,dto.releaseBindings===true,true);
        const permissionKey=`UNIT:${mark.id}`;
        await tx.$queryRaw`SELECT id FROM "KizReviewCase" WHERE "taskId"=${permissionKey} FOR UPDATE`;
        const previous=await tx.kizReviewCase.findUnique({where:{taskId_kizIdentity:{taskId:permissionKey,kizIdentity:serial}}});
        if(previous?.status==='CLAIMED')fail('Разрешение уже использует сборщик. Сначала завершите разбор текущей сборки.');
        const unit={clientId:mark.clientId,warehouseId:user.activeWarehouseId,requestId:'',kiz:mark.value,kizIdentity:serial,taskId:`UNIT:${mark.id}`,context:context(current),status:'APPROVED',decision:evidence.decision,resolution,reason,decidedById:user.id,decidedByName:user.name,decidedAt:new Date(),usedAt:null,evidence:json(evidence),snapshot:json({scope:'UNIT',markId:mark.id,skuId:mark.skuId,boxId:current.boxId,boxCode:snapshot.boxCode,productName:mark.sku.name,foundCaseId:row.id})};
        await tx.kizReviewCase.upsert({where:{taskId_kizIdentity:{taskId:unit.taskId,kizIdentity:serial}},create:unit,update:unit});
      }
      const saved=await tx.kizReviewCase.update({where:{id:row.id},data:{context:context(current),snapshot:json(snapshot),status:resolution?'APPROVED':'OPEN',resolution,reason,decidedById:user.id,decidedByName:user.name,decidedAt:new Date(),decision:evidence.decision,evidence:json(evidence)}});
      await this.audit(tx,user,row,'KIZ_FOUND_DECISION',{action:dto.action,reason,resolution,returned:snapshot.returned,releaseBindings:dto.releaseBindings===true});
      return saved;
    });
  }
  async checkBindings(tx:Db,mark:any,serial:string,user:AuthUser,row:any,confirmed:boolean,release:boolean){
    const links=(await tx.fbsTsdAssembly.findMany({where:{OR:prefixes(serial).map(p=>({kiz:{startsWith:p}}))}})).filter((t:any)=>identity(t.kiz)===serial);
    const fbo=await tx.fboAssemblyUnit.findFirst({where:{OR:[{activeMarkId:mark.id},{kiz:mark.value,state:{in:['PICKED','PACKED']},assembly:{phase:{not:'COMPLETED'}}}]}});
    if(fbo)fail('Единица занята сборкой ФБО. Сначала подтвердите возврат из этой сборки.');
    for(const t of links){
      const request=await tx.clientRequest.findUnique({where:{id:t.requestId}});
      if(!request||t.clientId!==mark.clientId||request.warehouseId!==user.activeWarehouseId||!['DONE','CANCELLED','REJECTED'].includes(request.status)||!['COMPLETED','RELEASED','WB_ACCOUNTED','RETURN_REQUIRED'].includes(t.status))fail(`КИЗ занят действующей сборкой. Оформите возврат из неё, чтобы снять резерв.`);
    }
    if(release&&links.length&&!confirmed)fail(`Подтвердите освобождение прежних привязок: ${links.map((t:any)=>t.orderId).join(', ')}.`);
    if(release)for(const t of links){
      await this.audit(tx,user,row,'KIZ_FOUND_BINDING_ARCHIVED',{before:t,physicalReturn:row.id});
      const result=await tx.fbsTsdAssembly.updateMany({where:{id:t.id,kiz:t.kiz,status:t.status,updatedAt:t.updatedAt},data:{kiz:null}});
      if(result.count!==1)fail('Прежняя сборка изменилась. Обновите проверку.');
    }
  }
}
