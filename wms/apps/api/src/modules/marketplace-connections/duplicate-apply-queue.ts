import { ConflictException, ForbiddenException, HttpException, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { WarehouseAuthScopeService } from '../auth/warehouse-auth-scope.service';

export const duplicateApplyQueueEnabled = () => process.env.WMS_DUPLICATE_APPLY_QUEUE_ENABLED === 'true';
const prefix = 'marketplace.duplicates.apply.';
export type ApplyBody = { group?: unknown; revision?: unknown; previewKey?: unknown; confirmationKey?: unknown };
export type ApplyJob = { version: 1; id: string; clientId: string; userId: string; warehouseId: string | null;
  groupId: string; name: string; body: ApplyBody; status: 'WAITING' | 'APPLIED' | 'FAILED'; message: string;
  createdAt: string; updatedAt: string; attempts: number };
export const applyJobDto = (job: ApplyJob) => ({ id: job.id, groupId: job.groupId, name: job.name, status: job.status,
  message: job.message, createdAt: job.createdAt, updatedAt: job.updatedAt });
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const applyJobKey = (clientId: string, userId: string, body: ApplyBody) => prefix + clientId + '.' +
  createHash('sha256').update(JSON.stringify({userId, body})).digest('hex');

// FIX: durable requests survive HTTP timeouts/restarts; settings and completion commit together.
export async function completeDuplicateApply(tx: Prisma.TransactionClient, key: string) {
  const row = await tx.systemSetting.findUnique({where:{key}});
  const job = row?.value as unknown as ApplyJob;
  if (!job || job.status !== 'WAITING') throw new ConflictException('Запрос применения уже обработан.');
  await tx.systemSetting.update({where:{key},data:{value:json({...job,status:'APPLIED',updatedAt:new Date().toISOString(),
    message:'Настройки применены. Остатки переданы в очередь пересчёта и проверки WB.'})}});
}
export class DuplicateApplyQueue {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(DuplicateApplyQueue.name);
  constructor(private readonly db: PrismaService,
    private readonly apply: (clientId: string, body: ApplyBody, user: AuthUser, key: string) => Promise<unknown>) {}
  start() { if (!duplicateApplyQueueEnabled() || this.timer) return;
    this.timer=setInterval(()=>{void this.tick().catch(e=>this.logger.error(e instanceof Error ? e.message : 'Ошибка очереди применения'));},5000);this.timer.unref(); }
  stop() { if(this.timer) clearInterval(this.timer);this.timer=undefined; }
  async existing(clientId: string, user: AuthUser, body: ApplyBody) {
    const row=await this.db.systemSetting.findUnique({where:{key:applyJobKey(clientId,user.id,body)}});
    return row && (row.value as unknown as ApplyJob).status !== 'FAILED' ? applyJobDto(row.value as unknown as ApplyJob) : null;
  }
  async list(clientId: string) {
    if (!duplicateApplyQueueEnabled()) return [];
    const scope={key:{startsWith:prefix+clientId+'.'}};
    const [waiting,recent]=await Promise.all([
      this.db.systemSetting.findMany({where:{...scope,value:{path:['status'],equals:'WAITING'}},orderBy:{createdAt:'asc'}}),
      this.db.systemSetting.findMany({where:scope,orderBy:{updatedAt:'desc'},take:30}),
    ]);
    return [...new Map([...waiting,...recent].map(r=>[r.key,r])).values()].map(r=>applyJobDto(r.value as unknown as ApplyJob));
  }
  async enqueue(clientId: string, body: ApplyBody, user: AuthUser) {
    const group=body.group as {id:string;name:string};const key=applyJobKey(clientId,user.id,body);
    return this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'marketplace.duplicates.groups.'+clientId}))`;
      const old=await tx.systemSetting.findUnique({where:{key}});if(old && (old.value as unknown as ApplyJob).status !== 'FAILED')return applyJobDto(old.value as unknown as ApplyJob);
      const setting=await tx.systemSetting.findUnique({where:{key:'marketplace.duplicates.groups.'+clientId}});
      if((setting?.updatedAt.toISOString()??null)!==body.revision)throw new ConflictException('Группы изменились. Повторите предпросмотр.');
      const waiting=await tx.systemSetting.findMany({where:{key:{startsWith:prefix+clientId+'.'},value:{path:['status'],equals:'WAITING'}}});
      if(waiting.some(r=>(r.value as unknown as ApplyJob).groupId===group.id))throw new ConflictException('Для этой группы уже ожидает применения другой запрос. Дождитесь результата.');
      const now=new Date().toISOString();const job:ApplyJob={version:1,id:key,clientId,userId:user.id,warehouseId:user.activeWarehouseId??null,
        groupId:group.id,name:group.name,body:JSON.parse(JSON.stringify(body)),status:'WAITING',
        message:'Ожидает завершения отправки WB. Настройки будут проверены и применены автоматически.',createdAt:now,updatedAt:now,attempts:0};
      await tx.systemSetting.upsert({where:{key},create:{key,value:json(job),updatedByUserId:user.id},update:{value:json(job),updatedByUserId:user.id}});
      await tx.auditLog.create({data:{userId:user.id,action:'duplicate.stock.groups.queued',entity:'Client',entityId:clientId,payload:json({requestId:key,groupId:group.id})}});
      return applyJobDto(job);
    });
  }
  private async user(job: ApplyJob): Promise<AuthUser> {
    const user=await this.db.user.findUnique({where:{id:job.userId},include:{roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}},
      clientScopes:{include:{client:{select:{isDemo:true,relabelingEnabled:true}}}},warehouseScopes:{include:{warehouse:{select:{isActive:true}}}}}});
    if(!user||user.status!=='ACTIVE'||user.isDemo)throw new ForbiddenException('Доступ автора запроса отозван.');
    const roleCodes=user.roles.map(r=>r.role.code),permissionCodes=[...new Set(user.roles.flatMap(r=>r.role.permissions.map(p=>p.permission.code)))];
    if(!permissionCodes.some(p=>['system:admin','clients:write','client-requests:write'].includes(p)))throw new ForbiddenException('Нет разрешения применять настройки.');
    const scope=await new WarehouseAuthScopeService(this.db).resolve({...user,roleCodes,permissionCodes,activeWarehouseId:job.warehouseId});
    return {id:user.id,email:user.email,name:user.name,isDemo:false,roleCodes,permissionCodes,...scope,
      warehouseIds:user.warehouseScopes.filter(w=>w.canRead&&w.warehouse.isActive).map(w=>w.warehouseId)};
  }
  async tick() {
    if(!duplicateApplyQueueEnabled()||this.busy)return;this.busy=true;
    try {
      await this.db.$transaction(async tx=>{
        // A database lock serializes workers across replicas without a fragile process lease.
        const lock=await tx.$queryRaw<Array<{acquired:boolean}>>`SELECT pg_try_advisory_xact_lock(hashtext('duplicate.apply.worker')) AS acquired`;
        if(!lock[0]?.acquired)return;
        const rows=await tx.systemSetting.findMany({where:{key:{startsWith:prefix},value:{path:['status'],equals:'WAITING'}},orderBy:{updatedAt:'asc'},take:1});
        if(!rows.length)return;const row=rows[0],job=row.value as unknown as ApplyJob;
        try { const user=await this.user(job);await this.apply(job.clientId,job.body,user,row.key); }
        catch(e) {
          const code=(e as {code?:string;meta?:{code?:string}})?.meta?.code;
          const transient=code==='55P03'||code==='57014'||['P2028','P1001','P1002'].includes((e as {code?:string})?.code??'')||!(e instanceof HttpException);
          const retry=transient&&Date.now()-Date.parse(job.createdAt)<86400000;
          // Never overwrite a success committed immediately before a connection error.
          const current=await this.db.systemSetting.findUnique({where:{key:row.key}});
          if((current?.value as unknown as ApplyJob)?.status!=='WAITING')return;
          const message=retry?'Ожидает завершения отправки WB. Повторная попытка выполняется автоматически.':
            e instanceof HttpException?e.message:'Не удалось применить настройки. Обновите список и повторите предпросмотр.';
          await this.db.systemSetting.update({where:{key:row.key},data:{value:json({...job,status:retry?'WAITING':'FAILED',message,attempts:job.attempts+1,updatedAt:new Date().toISOString()})}});
          if(!retry)await this.db.auditLog.create({data:{userId:job.userId,action:'duplicate.stock.groups.apply_failed',entity:'Client',entityId:job.clientId,payload:json({requestId:row.key,message})}});
        }
      },{timeout:60000,maxWait:5000});
    } finally {this.busy=false;}
  }
}
