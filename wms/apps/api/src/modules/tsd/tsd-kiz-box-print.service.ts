import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {PrismaService} from '../../common/prisma/prisma.service';
import {ClientScopeService} from '../auth/client-scope.service';
import type {AuthUser} from '../auth/auth.types';
import {storageBoxTransferKizIdentity} from '../stock/stock-operations.service';
import {buildKizBoxLabel} from './tsd-kiz-box-label';
export const KIZ_BOX_PRINT_SOURCE='TSD_KIZ_BOX_LABELS';
// FIX: printing-only worker access; never elevate access to administrative KIZ decisions.
@Injectable()
export class TsdKizBoxPrintService {
 constructor(private readonly prisma:PrismaService,private readonly clients:ClientScopeService){}
 private scope(user:AuthUser){
  if(process.env.WMS_TSD_KIZ_BOX_PRINT_ENABLED!=='true'||user.isDemo)throw new ForbiddenException('Печать по КИЗ недоступна.');
  const wh=user.activeWarehouseId;if(!wh)throw new BadRequestException('Сначала выберите филиал.');
  if(!user.permissionCodes.includes('system:admin')&&!user.warehouseIds?.includes(wh))throw new ForbiddenException('Нет доступа к филиалу.');
  return wh;
 }
 private identity(value:string){const parsed=typeof value==='string'&&value.length<=1024?storageBoxTransferKizIdentity(value.trim()):null;
  if(!parsed)throw new BadRequestException('Отсканируйте КИЗ Data Matrix.');return {parsed,key:`01${parsed.gtin}21${parsed.serial}`};}
 async lookup(kiz:string,user:AuthUser,db:any=this.prisma){
  const warehouseId=this.scope(user),{parsed,key}=this.identity(kiz),clientId=this.clients.resolveClientFilter(user);
  const prefixes=[key,']d2'+key,']D2'+key,`(01)${parsed.gtin}(21)${parsed.serial}`,`01${parsed.gtin}\u001d21${parsed.serial}`,`]d201${parsed.gtin}\u001d21${parsed.serial}`,`01${parsed.gtin}<GS>21${parsed.serial}`,`]d201${parsed.gtin}<GS>21${parsed.serial}`];
  const records=await db.productMark.findMany({where:{clientId,AND:[{OR:prefixes.map(value=>({value:{startsWith:value}}))},{OR:[{box:{warehouseId}},{boxId:null,stockMovement:{warehouseId}}]}]},include:{box:{include:{pallet:true}}},take:51});
  if(records.length>50)throw new ConflictException('Найдено несколько привязок КИЗ. Обратитесь к администратору.');
  const marks=records.filter((m:any)=>{const p=storageBoxTransferKizIdentity(m.value);return p?.gtin===parsed.gtin&&p.serial===parsed.serial;});
  if(!marks.length)throw new NotFoundException('КИЗ не найден в системе.');
  if(marks.length!==1)throw new ConflictException('Найдено несколько привязок КИЗ. Обратитесь к администратору.');
  const m=marks[0],b=m.box;
  if(!b||b.status!=='active'||b.clientId!==m.clientId||b.warehouseId!==warehouseId)throw new ConflictException('КИЗ найден, но действующий короб не указан.');
  this.clients.requireClientAccess(user,m.clientId,'read');
  const placements=await db.storagePalletBox.findMany({where:{OR:[{boxId:b.id},{boxId:null,boxCode:b.code}],pallet:{clientId:m.clientId,warehouseId}},include:{pallet:true}});
  const codes=[...new Set(placements.map((p:any)=>p.pallet.code))];
  if(codes.length>1)throw new ConflictException('Найдено несколько размещений короба. Обратитесь к администратору.');
  const legacy=b.pallet?.clientId===m.clientId&&b.pallet?.warehouseId===warehouseId?b.pallet.code:null;
  const palletCode=codes[0]||legacy;
  if(!palletCode)throw new ConflictException('Короб найден, но паллет-сорт не указан.');
  return {identity:key,markId:m.id,clientId:m.clientId,warehouseId,boxId:b.id,boxCode:b.code,palletCode:String(palletCode)};
 }
 async stations(user:AuthUser){this.scope(user);return this.prisma.fbsPrintStation.findMany({where:{enabled:true,labelWidthMm:58,labelHeightMm:40,lastSeenAt:{gt:new Date(Date.now()-45000)}},select:{id:true,name:true,printerName:true},orderBy:{name:'asc'}});}
 private owned(job:any,user:AuthUser,kiz?:string,stationId?:string){
  if(!job||job.source!==KIZ_BOX_PRINT_SOURCE||job.requestedById!==user.id||job.requestId!==this.scope(user))throw new NotFoundException('Задание печати не найдено.');
  this.clients.requireClientAccess(user,job.assemblyId,'read');
  if(kiz&&job.kiz!==this.identity(kiz).key||stationId&&stationId!==job.stationId)throw new ConflictException('Идентификатор уже использован для другой печати.');
  return {printId:job.historyId,status:job.status,stationId:job.stationId,boxCode:job.stickerCode,palletCode:job.productName,error:job.errorMessage,printedAt:job.printedAt};
 }
 async create(body:{kiz:string;stationId:string;printId:string},user:AuthUser){
  this.scope(user);this.identity(body.kiz);
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.printId)||!body.stationId||body.stationId.length>160)throw new BadRequestException('Некорректное задание печати.');
  const existing=await this.prisma.fbsPrintJob.findUnique({where:{historyId:body.printId}});if(existing)return this.owned(existing,user,body.kiz,body.stationId);
  if(!(await this.stations(user)).some(s=>s.id===body.stationId))throw new ConflictException('Выбранный принтер недоступен или не настроен на 58 × 40 мм.');
  const found=await this.lookup(body.kiz,user),image=await buildKizBoxLabel(found.boxCode,'КОРОБ');
  try{return await this.prisma.$transaction(async tx=>{
   // FIX: reject changed placement rather than print a stale location.
   const now=await this.lookup(body.kiz,user,tx);if(JSON.stringify(now)!==JSON.stringify(found))throw new ConflictException('Размещение изменилось. Повторите сканирование.');
   const job=await tx.fbsPrintJob.create({data:{stationId:body.stationId,historyId:body.printId,assemblyId:found.clientId,requestId:found.warehouseId,
    orderId:`BOX:${found.boxCode}`,kiz:found.identity,warehouseName:found.warehouseId,productName:found.palletCode,stickerCode:found.boxCode,
    stickerMime:'image/png',stickerBase64:image,source:KIZ_BOX_PRINT_SOURCE,requestedById:user.id,requestedBy:user.name,deviceCode:user.deviceCode??null}});
   await tx.auditLog.create({data:{userId:user.id,action:'TSD_KIZ_BOX_LABELS_QUEUED',entity:'FbsPrintJob',entityId:job.id,payload:{...found,stationId:body.stationId,labels:2}}});
   return this.owned(job,user,body.kiz,body.stationId);
  });}catch(e:any){if(e.code!=='P2002')throw e;return this.owned(await this.prisma.fbsPrintJob.findUnique({where:{historyId:body.printId}}),user,body.kiz,body.stationId);}
 }
 async status(printId:string,user:AuthUser){this.scope(user);return this.owned(await this.prisma.fbsPrintJob.findUnique({where:{historyId:printId}}),user);}
}
