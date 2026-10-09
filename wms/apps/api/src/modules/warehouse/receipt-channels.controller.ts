import { ModuleRef } from '@nestjs/core';
import { MarketplaceConnectionsService } from '../marketplace-connections/marketplace-connections.service';
import { BadRequestException, Body, Controller, Get, Logger, Post, Query, ForbiddenException, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { RequireAnyPermissions } from '../auth/decorators/require-permissions.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { assignReceiptBox, receiptChannelChange, receiptChannelsEnabled, receiptDocuments, requireReceiptChannelAdmin, receiptApprovalEntries, receiptApprovalEnabled, changeReceiptApproval } from './receipt-channel-policy';

@Controller('warehouse/receipt-channels')
@RequireAnyPermissions('warehouse:read','stock:read','client-requests:read')
export class ReceiptChannelsController {
  private readonly logger = new Logger(ReceiptChannelsController.name);
  constructor(private readonly prisma:PrismaService,private readonly scopes:ClientScopeService,private readonly modules:ModuleRef){}
  @Get()
  async list(@CurrentUser() user:AuthUser,@Query('clientId') clientId:string,@Query('from') from?:string,@Query('to') to?:string,@Query('summary') summary?:string,@Query('receiptId') receiptId?:string){
    if(typeof clientId!=='string'||!clientId.trim())throw new BadRequestException('Выберите клиента.');
    this.scopes.requireClientAccess(user,clientId,'read');
    const warehouseIds=await this.readWarehouses(user,clientId);
    if(!receiptChannelsEnabled())return {enabled:false,rows:[]};
    const since=from&&/^\d{4}-\d{2}-\d{2}$/.test(from)?new Date(from+'T00:00:00+03:00'):new Date(Date.now()-30*86400000);
    const until=to&&/^\d{4}-\d{2}-\d{2}$/.test(to)?new Date(to+'T23:59:59+03:00'):new Date();
    if(!Number.isFinite(since.getTime())||!Number.isFinite(until.getTime())||since>until)throw new BadRequestException('Проверьте период приёмок.');
    const [groups,saved]=await Promise.all([Promise.all(warehouseIds.map(w=>receiptDocuments(this.prisma,clientId,w,since,undefined,true))),this.prisma.systemSetting.findMany({where:{key:{startsWith:`receipt.channels.v1:${clientId}:`}},select:{value:true}})]);
    const docs=groups.flat(), approvals=(await Promise.all(warehouseIds.map(w=>receiptApprovalEntries(this.prisma,clientId,w,docs)))).flat();
    const approvalById=new Map(approvals.map(a=>[a.doc.id,a.approval]));
    const rules=new Map(saved.map(s=>{const r=s.value as any;return [r.id,r] as const;}));
    return {enabled:true,canManageDirections:user.roleCodes.some(r=>['ADMIN','OWNER'].includes(r)),rows:docs.filter(d=>(!receiptId||d.id===receiptId)&&(d.current||new Date(d.date)<=until)).map(d=>({...d,...(summary==='1'&&process.env.WMS_MENU_READS_ENABLED==='true'?{boxCount:d.boxes.length,boxes:[]}:{}),approvalEnabled:approvalById.has(d.id),approval:approvalById.get(d.id)??{available:true,revision:0},fbs:rules.get(d.id)?.fbs??true,fbo:rules.get(d.id)?.fbo??true,revision:rules.get(d.id)?.revision??0}))};
  }
  // FIX: the client can confirm only its own receipt; disabling remains an administrator action.
  @Post('approval')
  async approval(@CurrentUser() user:AuthUser,@Body() body:any){
    if(!body||typeof body.clientId!=='string'||typeof body.warehouseId!=='string'||typeof body.id!=='string'||!/^[a-f0-9]{32}$/.test(body.id)||typeof body.save!=='boolean')throw new BadRequestException('Укажите клиента, филиал и приёмку.');
    this.scopes.requireClientAccess(user,body.clientId,'write');
    if(!(await this.readWarehouses(user,body.clientId)).includes(body.warehouseId))throw new ForbiddenException('Нет доступа к приёмке этого филиала.');
    if(user.roleCodes.some(r=>['ADMIN','OWNER'].includes(r)))requireReceiptChannelAdmin(user);
    const result=await this.prisma.$transaction(tx=>changeReceiptApproval(tx,body,user,body.save),{isolationLevel:body.save?'ReadCommitted':'RepeatableRead',timeout:60000});
    if(body.save)this.refresh(body.clientId);return result;
  }
  @Get('history')
  async history(@CurrentUser() user:AuthUser,@Query('clientId') clientId:string,@Query('warehouseId') warehouseId:string,@Query('id') id:string){
    await this.readReceipt(user,clientId,warehouseId,id);
    return this.prisma.auditLog.findMany({where:{entity:'Receipt',entityId:id,action:'RECEIPT_STOCK_ACCESS_CHANGED',AND:[{payload:{path:['clientId'],equals:clientId}},{payload:{path:['warehouseId'],equals:warehouseId}}]},select:{createdAt:true,payload:true},orderBy:{createdAt:'desc'},take:100});
  }
  @Get('file.xlsx')
  async file(@CurrentUser() user:AuthUser,@Query('clientId') clientId:string,@Query('warehouseId') warehouseId:string,@Query('id') id:string,@Res() response:Response){
    const doc=await this.readReceipt(user,clientId,warehouseId,id);
    const boxes=new Map(doc.boxes.map(b=>[b.id,b.code]));
    const rows=await this.prisma.stockMovement.findMany({where:{clientId,warehouseId,type:'RECEIPT',quantity:{gt:0},OR:doc.boxes.map(b=>({boxId:b.id,sourceDocument:b.receiptDocument?.startsWith('BOX:')?null:b.receiptDocument})),createdAt:{gte:new Date(doc.date.slice(0,4)+'-01-01T00:00:00Z'),lt:new Date((Number(doc.date.slice(0,4))+1)+'-01-01T00:00:00Z')}},include:{sku:{include:{barcodes:true}}},orderBy:{createdAt:'asc'}});
    const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Приёмка');
    sheet.columns=[{header:'Дата приёмки (МСК)',key:'date',width:23},{header:'Короб',key:'box',width:24},{header:'Товар',key:'name',width:45},{header:'Артикул',key:'article',width:28},{header:'Размер',key:'size',width:16},{header:'Штрихкод',key:'barcode',width:20},{header:'Принято, шт.',key:'quantity',width:16}];
    for(const r of rows)sheet.addRow({date:r.createdAt.toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}),box:boxes.get(r.boxId!),name:r.sku.name,article:r.sku.article,size:r.sku.size,barcode:r.sku.barcodes[0]?.value??'',quantity:r.quantity});
    sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
    response.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');response.setHeader('Content-Disposition',`attachment; filename="receipt-${id}.xlsx"`);response.send(Buffer.from(await workbook.xlsx.writeBuffer()));
  }
  private async readWarehouses(user:AuthUser,clientId:string){
    if(user.activeWarehouseId)return [user.activeWarehouseId];
    if(user.roleCodes.some(r=>['ADMIN','OWNER'].includes(r)))throw new BadRequestException('Выберите филиал.');
    if(!receiptApprovalEnabled())return [];
    const scopes=await this.prisma.systemSetting.findMany({where:{key:{startsWith:`receipt.approval.scope.v1:${clientId}:`}},select:{value:true}});
    return scopes.map(s=>String((s.value as any).warehouseId));
  }
  private async readReceipt(user:AuthUser,clientId:string,warehouseId:string,id:string){
    if(!clientId||!warehouseId||!id)throw new BadRequestException('Укажите приёмку.');
    this.scopes.requireClientAccess(user,clientId,'read');
    if(!(await this.readWarehouses(user,clientId)).includes(warehouseId))throw new ForbiddenException('Нет доступа к филиалу.');
    const doc=(await receiptDocuments(this.prisma,clientId,warehouseId,undefined,undefined,true)).find(d=>d.id===id);if(!doc)throw new NotFoundException('Приёмка не найдена.');return doc;
  }
  @Post('assign-box')
  @RequirePermissions('warehouse:write')
  async assign(@CurrentUser() user:AuthUser,@Body() body:any){
    if(!body||typeof body.clientId!=='string'||typeof body.id!=='string'||typeof body.boxCode!=='string'||!body.boxCode.trim()||typeof body.save!=='boolean')throw new BadRequestException('Укажите приёмку и короб.');
    const warehouseId=requireReceiptChannelAdmin(user);this.scopes.requireClientAccess(user,body.clientId,'write');
    const result=await this.prisma.$transaction(tx=>assignReceiptBox(tx,body.clientId,warehouseId,body.id,body.boxCode,user.id,body.save),{isolationLevel:'Serializable',timeout:30000});
    if(body.save)this.refresh(body.clientId);return result;
  }
  @Post('preview')
  @RequirePermissions('warehouse:write')
  preview(@CurrentUser() user:AuthUser,@Body() body:any){return this.change(user,body,false);}
  @Post()
  @RequirePermissions('warehouse:write')
  save(@CurrentUser() user:AuthUser,@Body() body:any){return this.change(user,body,true);}
  private async change(user:AuthUser,body:any,save:boolean){
    if(!body||typeof body.clientId!=='string'||!body.clientId.trim()||typeof body.id!=='string'||!/^[a-f0-9]{32}$/.test(body.id))throw new BadRequestException('Укажите клиента и приёмку.');
    const warehouseId=requireReceiptChannelAdmin(user);this.scopes.requireClientAccess(user,body.clientId,'write');
    const result=await this.prisma.$transaction(async tx=>{
      // FIX: serialize policy changes with each other; serializable scans retry stale reads.
      if(save)await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',`receipt-channels:${body.clientId}:${warehouseId}`);
      return receiptChannelChange(tx,body.clientId,warehouseId,body.id,body.fbs,body.fbo,body.revision,save,user.id);
    },{isolationLevel:save?'Serializable':'RepeatableRead',timeout:30000});
    if(save)this.refresh(body.clientId);return result;
  }
  private refresh(clientId:string){
    // FIX: schedule recalculation immediately; the existing periodic stock sync retries failures.
    // FIX: a failed background sync must not misreport a committed save as failed.
    void Promise.resolve().then(()=>this.modules.get(MarketplaceConnectionsService,{strict:false}).refreshReceiptChannelStocks(clientId))
      .catch(()=>this.logger.warn(`Receipt directions saved for ${clientId}; periodic WB stock synchronization will retry.`));
  }
}
