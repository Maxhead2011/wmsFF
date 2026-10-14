import {BadRequestException,ConflictException,Injectable,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import * as XLSX from 'xlsx';
import {PrismaService} from '../../common/prisma/prisma.service';
import {ClientScopeService} from '../auth/client-scope.service';
import type {AuthUser} from '../auth/auth.types';
import {OzonFboImportService} from './ozon-fbo-import.service';
import {OzonAssemblySupplyService} from './ozon-assembly-supply.service';
import {mergeSupplyOrders,supplyOrders,supplyDifferences,type SupplyIntegration} from './ozon-supply-policy';
export type OzonLinksInput={clientId:string;connectionId:string;links:string;warehouseId?:string;previewHash?:string};
// FIX: only exact seller order URLs are accepted; input never becomes a fetch URL.
export function ozonLinkIds(links:unknown){
 if(typeof links!=='string'||links.length>5000)throw new BadRequestException('Вставьте ссылки Ozon.');
 const values=links.trim().split(/\s+/).filter(Boolean);if(!values.length||values.length>10)throw new BadRequestException('Укажите от 1 до 10 ссылок.');
 const ids=values.map(v=>{const id=v.match(/^https:\/\/seller\.ozon\.ru\/app\/supply\/orders\/(\d+)(?:[?#].*)?$/)?.[1];if(!id||!Number.isSafeInteger(Number(id)))throw new BadRequestException('Нужна ссылка вида https://seller.ozon.ru/app/supply/orders/123.');return id;});
 return [...new Set(ids)].sort();
}
@Injectable()
export class OzonLinkImportService {
 constructor(private readonly db:PrismaService,private readonly scopes:ClientScopeService,private readonly importer:OzonFboImportService,private readonly supply:OzonAssemblySupplyService){}
 // FIX: cabinet users need no internal active branch; use the file-import resolver.
 private async access(clientId:string,user:AuthUser,warehouseId?:string){
  return this.importer.resolveWarehouse(clientId,user,'write',warehouseId);
 }
 async connections(clientId:string,user:AuthUser){
  const choices=await this.importer.warehouses(clientId,user);
  if(!choices.length)throw new BadRequestException('У клиента нет активного филиала.');
  return this.db.clientMarketplaceConnection.findMany({where:{clientId,marketplace:'OZON',isActive:true},select:{id:true,accountName:true,sellerId:true}});
 }
 private async existing(tx:any,keys:string[],clientId:string,warehouseId:string){
  const bindings=await tx.ozonFboOrderBinding.findMany({where:{externalOrderKey:{in:keys}}});
  const legacy=await tx.ozonFboShipment.findMany({where:{externalOrderKey:{in:keys}},select:{requestId:true}});
  const owners=new Set([...bindings,...legacy].map((v:any)=>v.requestId));if(!owners.size)return null;
  if(owners.size!==1)throw new ConflictException('Ссылки уже используются в разных сборках.');
  const request=await tx.clientRequest.findUniqueOrThrow({where:{id:[...owners][0]}}),shipment=await tx.ozonFboShipment.findUnique({where:{requestId:request.id}});
  if(request.clientId!==clientId||request.warehouseId!==warehouseId)throw new ConflictException('Поставка уже используется в другой сборке или филиале.');
  if(!shipment?.integration)throw new ConflictException('Существующая привязка требует сверки.');
  const actual=supplyOrders(shipment.integration).map((o:any)=>o.orderId).sort(),wanted=keys.map(k=>k.split(':').pop()).sort();
  if(JSON.stringify(actual)!==JSON.stringify(wanted))throw new ConflictException('Часть ссылок уже привязана. Откройте существующую сборку.');
  return {id:request.id,number:request.number};
 }
 private async prepare(body:OzonLinksInput,user:AuthUser){
  const warehouseId=await this.access(body?.clientId,user,body?.warehouseId),ids=ozonLinkIds(body.links);
  if(typeof body.connectionId!=='string')throw new BadRequestException('Выберите кабинет Ozon.');
  const c=await this.db.clientMarketplaceConnection.findFirst({where:{id:body.connectionId,clientId:body.clientId,marketplace:'OZON',isActive:true}});
  if(!c?.apiKey||!c.sellerId)throw new BadRequestException('Кабинет Ozon не настроен для клиента.');
  if(await this.db.ozonFboPlan.findFirst({where:{connectionId:c.id,ozonOrderId:{in:ids}}}))throw new ConflictException('Поставка уже используется в прежнем плане Ozon.');
  const snapshots:SupplyIntegration[]=[];for(const id of ids)snapshots.push(await this.supply.snapshot(c,id));
  if(snapshots.some(s=>!['DATA_FILLING','READY_TO_SUPPLY'].includes(s.state)))throw new ConflictException('Для сборки нужна действующая поставка в статусе заполнения данных или готовности к отгрузке.');
  if(new Set(snapshots.map(s=>s.place)).size!==1||new Set(snapshots.map(s=>s.date)).size!==1||!snapshots[0].place||!Number.isFinite(Date.parse(snapshots[0].date)))throw new ConflictException('В одной сборке должны совпадать точка сдачи и время отгрузки.');
  const integration=mergeSupplyOrders(snapshots[0],snapshots.flatMap(supplyOrders)),rows:any[][]=[['Направление / склад назначения Ozon','ШК','Поставка, шт','Артикул']];integration.mapping={};
  for(const order of supplyOrders(integration))for(const s of order.supplies){
   const duplicates=integration.supplies.filter(x=>x.name===s.name).length>1,name=duplicates?`${s.name} · ${order.orderNumber} / ${s.id}`:s.name;
   integration.mapping[name]=s.id;if(!s.items.length)throw new BadRequestException('Ozon вернул пустое направление.');
   for(const i of s.items)rows.push([name,i.barcode,i.quantity,i.offerId]);
  }
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Поставка');
  const file={buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'}),originalname:`Ozon-${ids.join('-')}.xlsx`,mimetype:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'} as Express.Multer.File;
  const dto={clientId:body.clientId,warehouseId,destinationCity:integration.place,desiredDate:integration.date,title:`ФБО Ozon · ${snapshots.map(s=>s.orderNumber).join(', ')}`};
  const p=await this.importer.preview(file,dto,user);if(supplyDifferences(p.directions,integration).length)throw new ConflictException('Не удалось однозначно сопоставить товары Ozon.');
  const keys=ids.map(id=>`${c.sellerId}:${id}`).sort();
  const previewHash=createHash('sha256').update(JSON.stringify([body.clientId,warehouseId,c.id,supplyOrders(integration).map(({checkedAt,...o})=>o),p.directions])).digest('hex');
  p.importKey=createHash('sha256').update(JSON.stringify(['ozon-links',body.clientId,warehouseId,keys])).digest('hex');
  return {p,file,dto,integration,keys,previewHash,warehouseId};
 }
 async preview(body:OzonLinksInput,user:AuthUser){const x=await this.prepare(body,user);return {previewHash:x.previewHash,totalQuantity:x.p.totalQuantity,directions:x.p.directions,items:x.p.items,place:x.integration.place,date:x.integration.date,orders:supplyOrders(x.integration).map(o=>({orderId:o.orderId,orderNumber:o.orderNumber,state:o.state})),existingRequest:await this.existing(this.db,x.keys,body.clientId,x.warehouseId)};}
 async commit(body:OzonLinksInput,user:AuthUser){
  const x=await this.prepare(body,user);if(!body.previewHash||body.previewHash!==x.previewHash)throw new ConflictException('Состав Ozon изменился. Получите состав заново и проверьте его.');
  for(let attempt=0;;attempt++){try{return await this.db.$transaction(async tx=>{
   for(const key of x.keys)await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`;
   const existing=await this.existing(tx,x.keys,body.clientId,x.warehouseId);if(existing)return {request:existing,existing:true};
   const made=await this.importer.createPrepared(tx,x.p,x.file,x.dto,user);if(made.existing)throw new ConflictException('Сборка уже существует. Требуется сверка привязки.');
   await tx.ozonFboShipment.update({where:{requestId:made.request.id},data:{integration:x.integration as any,externalOrderKey:x.keys[0]}});
   await tx.ozonFboOrderBinding.createMany({data:x.keys.map(externalOrderKey=>({externalOrderKey,requestId:made.request.id,orderId:externalOrderKey.split(':').pop()!}))});
   await tx.clientRequest.update({where:{id:made.request.id},data:{comment:`Состав получен из Ozon: ${supplyOrders(x.integration).map(o=>o.orderNumber).join(', ')}. ${x.p.totalQuantity} шт.`}});
   await tx.auditLog.create({data:{userId:user.id,action:'OZON_ASSEMBLY_CREATED_FROM_LINKS',entity:'ClientRequest',entityId:made.request.id,payload:{orderIds:supplyOrders(x.integration).map(o=>o.orderId),previewHash:x.previewHash,quantity:x.p.totalQuantity}}});
   return {request:made.request,existing:false};
  },{isolationLevel:'Serializable',timeout:30000});}catch(e){if(attempt>=2||!['P2034','P2002'].includes((e as any)?.code))throw e;}}
 }
}
