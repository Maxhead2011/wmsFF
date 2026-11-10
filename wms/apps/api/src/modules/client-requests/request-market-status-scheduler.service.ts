import {Injectable,Logger,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {PrismaService} from '../../common/prisma/prisma.service';
import type {AuthUser} from '../auth/auth.types';
import {RequestMarketStatusService} from './request-market-status.service';
import {claimMarketSlot,finishMarketSlot,marketStatusScheduleEnabled,marketStatusSlot} from './market-status-schedule';

// FIX: bounded server job with durable per-request slots; no browser/desktop automation dependency.
@Injectable()
export class RequestMarketStatusScheduler implements OnModuleInit,OnModuleDestroy {
 private timer?:NodeJS.Timeout;private running=false;private stopped=false;private cursor='';
 private readonly log=new Logger(RequestMarketStatusScheduler.name);
 constructor(private readonly db:PrismaService,private readonly statuses:RequestMarketStatusService){}
 onModuleInit(){if(marketStatusScheduleEnabled())this.schedule();}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(!this.stopped){this.timer=setTimeout(()=>void this.tick(),30000);this.timer.unref?.();}}
 async tick(){
  if(this.running||this.stopped||!marketStatusScheduleEnabled())return;this.running=true;
  try {
   const slot=marketStatusSlot();if(!slot)return;
   const rows=await this.db.clientRequest.findMany({where:{type:'OUTBOUND',client:{isDemo:false},warehouseId:{not:null},
    ...(this.cursor?{id:{gt:this.cursor}}:{}),yandexFbyShipment:null,lamodaAssembly:null,
    // FIX: missed local FBS stages must not exclude confirmed marketplace handovers.
    OR:[{status:process.env.WMS_FBS_ACTION_STATUS_ENABLED==='true'?{in:['SUBMITTED','IN_REVIEW','APPROVED','IN_WORK','PACKED']}:'PACKED',
      fbsOrderLinks:{some:{marketplace:{in:['WILDBERRIES','OZON']}}}},
      {status:'PACKED',ozonShipment:{isNot:null}},{status:'PACKED',fboAssembly:{isNot:null}}]},select:{id:true,clientId:true,warehouseId:true},orderBy:{id:'asc'},take:100});
   if(!rows.length)this.cursor='';
   let checked=0;
   for(const r of rows){
    if(this.stopped||!marketStatusScheduleEnabled()||marketStatusSlot()!==slot)break;
    this.cursor=r.id;const claim=await claimMarketSlot(this.db,r.id,slot);if(!claim)continue;
    let success=false,code='ERROR';
    try {
     const user:AuthUser={id:undefined as unknown as string,email:'',name:'Автоматическая сверка статусов',roleCodes:[],permissionCodes:['client-requests:write','client-requests:status'],clientScopeMode:'LIMITED',clientIds:[r.clientId],writableClientIds:[r.clientId],activeWarehouseId:r.warehouseId!,warehouseIds:[r.warehouseId!],writableWarehouseIds:[r.warehouseId!]};
     const result=await this.statuses.check(r.id,user);success=true;code=result.needsAttention?'ATTENTION':result.status;
    } catch(e){code=String((e as any)?.getStatus?.()??'INTERNAL');}
    await finishMarketSlot(this.db,r.id,claim,success,code);
    this.log.log(JSON.stringify({event:'request_market_schedule',requestId:r.id,slot,result:code,success}));
    if(++checked>=10)break;
   }
  } catch {this.log.warn('Marketplace schedule failed; durable leases retained.');}
  finally{this.running=false;if(marketStatusScheduleEnabled())this.schedule();}
 }
}
