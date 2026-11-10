import {Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
export const marketStatusScheduleEnabled=()=>process.env.WMS_MARKET_STATUS_SCHEDULE_ENABLED==='true';
// FIX: timezone is explicit, independent of container/host timezone. No catch-up burst of old slots.
export function marketStatusSlot(now=new Date()):string|null {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const get=(type:string)=>parts.find(p=>p.type===type)!.value;
 const hour=[8,12,15,18,21].filter(h=>h<=Number(get('hour'))).at(-1);
 return hour===undefined?null:`${get('year')}-${get('month')}-${get('day')}T${String(hour).padStart(2,'0')}:00+03:00`;
}
const settingKey=(id:string)=>`request.market-schedule.v1:${id}`;
export async function claimMarketSlot(db:any,id:string,slot:string,now=Date.now()) {
 return db.$transaction(async(tx:any)=>{
  const key=settingKey(id);await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`);
  const old=(await tx.systemSetting.findUnique({where:{key}}))?.value??{};
  if(old.leaseUntil>now||old.slot===slot&&(old.done||old.nextAt>now))return null;
  const value={slot,token:randomUUID(),leaseUntil:now+10*60000,attempts:old.slot===slot?(old.attempts??0)+1:1};
  await tx.systemSetting.upsert({where:{key},create:{key,value},update:{value}});return value;
 });
}
export async function finishMarketSlot(db:any,id:string,claim:any,success:boolean,code:string,now=Date.now()) {
 return db.$transaction(async(tx:any)=>{
  const key=settingKey(id);await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`);
  const old=(await tx.systemSetting.findUnique({where:{key}}))?.value;
  if(old?.token!==claim.token)return;
  await tx.systemSetting.update({where:{key},data:{value:{...old,token:null,leaseUntil:0,done:success,nextAt:now+Math.min(60,5*2**Math.min(old.attempts-1,4))*60000,checkedAt:new Date(now).toISOString(),result:code}}});
 });
}
