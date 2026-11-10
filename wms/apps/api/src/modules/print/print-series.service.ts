import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { pdfSeries } from './pdf-series';
import {readRibbon,confirmRibbon} from '../../common/stock/fbs-ribbon-evidence';

type Page = { value: string; imageBase64: string };
type Body = { requestId?: unknown; stationId?: unknown; clientId?: unknown; widthMm?: unknown; heightMm?: unknown; pages?: unknown };
type Binding = { userId: string; warehouseId: string; seenAt: number };
const key = (id: string) => `print.series.agent.v1:${id}`;
function text(v: unknown) {
  if (typeof v !== 'string' || !v.trim() || v.length > 150) throw new BadRequestException('Неверный идентификатор.');
  return v.trim();
}

@Injectable()
export class PrintSeriesService {
  constructor(private readonly prisma: PrismaService, private readonly clients: ClientScopeService) {}
  private scope(user: AuthUser) {
    if (process.env.WMS_PRINT_SERIES_ENABLED !== 'true') throw new NotFoundException('Серийная печать не включена.');
    if (user.isDemo || !user.permissionCodes.some(p=>['system:admin','print:write'].includes(p))) throw new ForbiddenException();
    if (!user.activeWarehouseId) throw new BadRequestException('Выберите филиал.');
    return user.activeWarehouseId;
  }
  private async binding(stationId: string, user: AuthUser, agent = false, fresh = false) {
    const warehouseId=this.scope(user);
    const [station,setting]=await Promise.all([
      this.prisma.fbsPrintStation.findFirst({where:{id:stationId,enabled:true}}),
      this.prisma.systemSetting.findUnique({where:{key:key(stationId)}}),
    ]);
    const b=setting?.value as unknown as Binding | undefined;
    if (!station || !b || b.warehouseId!==warehouseId || agent && b.userId!==user.id) throw new ForbiddenException('Обновлённый агент этого филиала недоступен.');
    if(fresh && (!Number.isFinite(b.seenAt) || Date.now()-b.seenAt>120_000)) throw new ConflictException('Запустите обновлённый агент печати.');
    return b;
  }
  async heartbeat(stationId: string, user: AuthUser) {
    const warehouseId=this.scope(user); stationId=text(stationId);
    if(!await this.prisma.fbsPrintStation.findFirst({where:{id:stationId,enabled:true}})) throw new NotFoundException('Станция не найдена.');
    const prior=await this.prisma.systemSetting.findUnique({where:{key:key(stationId)}});
    const b=prior?.value as unknown as Binding | undefined;
    if(b && (b.userId!==user.id || b.warehouseId!==warehouseId)) throw new ForbiddenException('Станция закреплена за другим агентом.');
    if(prior) await this.prisma.systemSetting.update({where:{key:key(stationId)},data:{value:{...b!,seenAt:Date.now()}}});
    else await this.prisma.systemSetting.create({data:{key:key(stationId),value:{userId:user.id,warehouseId,seenAt:Date.now()}}});
    return {ready:true,version:1};
  }
  async stations(user: AuthUser) {
    const warehouseId=this.scope(user);
    const settings=await this.prisma.systemSetting.findMany({where:{key:{startsWith:'print.series.agent.v1:'}}});
    const ids=settings.filter(s=> {const b=s.value as unknown as Binding;return b.warehouseId===warehouseId && Date.now()-b.seenAt<120_000;}).map(s=>s.key.slice('print.series.agent.v1:'.length));
    return this.prisma.fbsPrintStation.findMany({where:{id:{in:ids},enabled:true},select:{id:true,name:true,printerName:true}});
  }
  // FIX: media belongs to the branch-bound station, including temporarily offline agents.
  async formats(user: AuthUser) {
    const warehouseId = this.scope(user);
    const settings = await this.prisma.systemSetting.findMany({where:{key:{startsWith:'print.series.agent.v1:'}}});
    const ids = settings.filter(s => (s.value as unknown as Binding)?.warehouseId === warehouseId).map(s => s.key.slice('print.series.agent.v1:'.length));
    return this.prisma.fbsPrintStation.findMany({where:{id:{in:ids},enabled:true},select:{id:true,name:true,printerName:true,printerModel:true,labelWidthMm:true,labelHeightMm:true,lastSeenAt:true}});
  }
  async setFormat(id: string, body: {widthMm?:unknown;heightMm?:unknown}, user: AuthUser) {
    id = text(id);
    await this.binding(id,user);
    const w=body.widthMm,h=body.heightMm;
    if(typeof w!=='number'||typeof h!=='number'||!Number.isInteger(w)||!Number.isInteger(h)||w<20||w>150||h<20||h>150) throw new BadRequestException('Ширина и длина должны быть целыми числами от 20 до 150 мм.');
    return this.prisma.$transaction(async tx => {
      const before=await tx.fbsPrintStation.findFirst({where:{id,enabled:true}});
      if(!before) throw new NotFoundException('Станция не найдена.');
      if(/TE[- ]?200/i.test(`${before.printerModel} ${before.printerName}`) && w>112) throw new BadRequestException('Для TSC TE200 ширина бумаги не должна превышать 112 мм. Для Ozon выберите ширину 70, длину 120 мм.');
      const saved=await tx.fbsPrintStation.update({where:{id},data:{labelWidthMm:w,labelHeightMm:h},select:{id:true,name:true,printerName:true,printerModel:true,labelWidthMm:true,labelHeightMm:true,lastSeenAt:true}});
      await tx.auditLog.create({data:{userId:user.id,action:'PRINT_STATION_MEDIA_UPDATED',entity:'FbsPrintStation',entityId:id,payload:{before:{widthMm:before.labelWidthMm,heightMm:before.labelHeightMm},after:{widthMm:w,heightMm:h}}}});
      return saved;
    });
  }
  async create(body: Body, user: AuthUser, verifiedRibbon?: unknown[]) {
    const warehouseId=this.scope(user),clientId=text(body.clientId),stationId=text(body.stationId),requestId=text(body.requestId);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new BadRequestException('Неверный номер операции.');
    this.clients.requireClientAccess(user,clientId,'read');
    if(!await this.prisma.warehouseClient.findFirst({where:{clientId,warehouseId}})) throw new ForbiddenException('Клиент недоступен в филиале.');
    const w=body.widthMm,h=body.heightMm;
    if(typeof w!=='number'||typeof h!=='number'||!Number.isInteger(w)||!Number.isInteger(h)||w<20||w>150||h<20||h>150) throw new BadRequestException('Размер этикетки — от 20 до 150 мм.');
    if(!Array.isArray(body.pages)||body.pages.length<1||body.pages.length>500) throw new BadRequestException('Серия — от 1 до 500 этикеток.');
    let total=0, pixels=0;
    const pages:Page[]=body.pages.map(p=> {
      const value=text(p?.value), imageBase64=p?.imageBase64;
      if(typeof imageBase64!=='string'||imageBase64.length>1_500_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) throw new BadRequestException('Неверное изображение этикетки.');
      total+=imageBase64.length;if(total>8_000_000)throw new BadRequestException('Серия слишком велика: уменьшите количество этикеток.');
      const b=Buffer.from(imageBase64,'base64');
      if(b.length<24||b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new BadRequestException('Ожидается PNG.');
      const pw=b.readUInt32BE(16),ph=b.readUInt32BE(20);
      if(pw<100||pw>2000||ph<100||ph>3000||Math.abs(pw/ph-w/h)>0.08)throw new BadRequestException('Неверный размер PNG.');
      pixels+=pw*ph;if(pixels>60_000_000)throw new BadRequestException("Серия слишком велика: уменьшите количество этикеток.");
      return {value,imageBase64};
    });
    // FIX: the UUID binds the entire series, including order, to one durable job.
    const payload={source:'SERIES_V1',warehouseId,clientId,requestedById:user.id,widthMm:w,heightMm:h,pages,...(verifiedRibbon?.length?{fbsRibbon:verifiedRibbon}:{})};
    const digest=createHash('sha256').update(JSON.stringify({stationId,...payload})).digest('hex');
    const id=`series:${requestId}`;
    const match=(job:any)=> {if(job.payload?.digest!==digest)throw new ConflictException('Номер операции уже использован для другой серии.');return {id:job.id,status:job.status,pages:pages.length};};
    const existing=await this.prisma.printJob.findUnique({where:{id}});if(existing)return match(existing);
    await this.binding(stationId,user,false,true);
    try {
      const job=await this.prisma.printJob.create({data:{id,printerCode:`SERIES:${stationId}`,labelType:'CUSTOM',status:'queued',tspl:'IMAGE/PNG-SERIES',payload:{...payload,digest} as Prisma.InputJsonValue}});
      return match(job);
    } catch(e) {
      if((e as {code?:string}).code!=='P2002')throw e;
      const job=await this.prisma.printJob.findUnique({where:{id}});if(!job)throw e;return match(job);
    }
  }
  // FIX: validate client/branch/station before rendering, then reuse atomic series creation.
  async createPdf(body: { requestId?: unknown; stationId?: unknown; clientId?: unknown; fileBase64?: unknown }, user: AuthUser) {
    const warehouseId = this.scope(user), clientId = text(body.clientId), stationId = text(body.stationId);
    const requestId = text(body.requestId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new BadRequestException('Неверный номер операции.');
    this.clients.requireClientAccess(user, clientId, 'read');
    if (!await this.prisma.warehouseClient.findFirst({ where: { clientId, warehouseId } })) throw new ForbiddenException();
    await this.binding(stationId, user);
    const station = await this.prisma.fbsPrintStation.findFirst({ where: { id: stationId, enabled: true } });
    if (!station || station.labelWidthMm !== 58 || station.labelHeightMm !== 40)
      throw new BadRequestException('Для ленты WB выберите принтер с этикетками 58 × 40 мм.');
    const pages = await pdfSeries(body.fileBase64, 58, 40);
    const ribbon=await readRibbon(this.prisma,clientId,user.id,Buffer.from(String(body.fileBase64),'base64'),warehouseId);
    if(ribbon.length)this.clients.requireClientAccess(user,clientId,'write');
    return this.create({ requestId, stationId, clientId, widthMm: 58, heightMm: 40, pages }, user,ribbon);
  }
  async claim(stationId: string,user: AuthUser) {
    await this.binding(stationId,user,true);
    // FIX: never reclaim sent/uncertain jobs; a lost ACK must not duplicate a whole series.
    return this.prisma.$transaction(async tx=> {
      const job=await tx.printJob.findFirst({where:{printerCode:`SERIES:${stationId}`,status:'queued'},orderBy:[{createdAt:'asc'},{id:'asc'}]});
      if(!job)return null;
      const claimed=await tx.printJob.updateMany({where:{id:job.id,status:'queued'},data:{status:'sent',attempts:{increment:1},processedAt:new Date()}});
      if(!claimed.count)return null;
      return {id:job.id,...job.payload as object};
    });
  }
  async finish(stationId:string,id:string,success:unknown,error:unknown,user:AuthUser) {
    await this.binding(stationId,user,true);
    if(typeof success!=='boolean')throw new BadRequestException('Неверный результат.');
    const job=await this.prisma.printJob.findFirst({where:{id,printerCode:`SERIES:${stationId}`}});
    if(!job)throw new NotFoundException();
    const status=success?'printed':'failed';if(job.status===status)return {id,status};
    if(job.status!=='sent')throw new ConflictException('Задание уже завершено.');
    // FIX: ACK and request stages commit together; retry cannot leave a printed job without its event.
    return this.prisma.$transaction(async tx=>{
      const at=new Date();
      const changed=await tx.printJob.updateMany({where:{id,status:'sent'},data:{status,processedAt:at,payload:{...job.payload as object,error:success?null:String(error??'Ошибка печати').slice(0,500)} as Prisma.InputJsonValue}});
      if(!changed.count){const latest=await tx.printJob.findUnique({where:{id}});if(latest?.status===status)return {id,status};throw new ConflictException('Результат изменился.');}
      if(success)await confirmRibbon(tx,job.payload,id,at);
      return {id,status};
    },{timeout:30_000});
  }
}
