import {BadGatewayException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';

type State={until?:number;leaseUntil?:number;token?:string|null};
const positive=(n:number)=>Number.isFinite(n)&&n>0?n:0;
// FIX: honor the longest server deadline; Retry-After can be seconds or an HTTP date.
export function wbPauseDeadline(response:Response,now:number){
 const seconds=(name:string)=>positive(Number(response.headers.get(name)))*1000;
 const raw=response.headers.get('retry-after');
 const retry=raw?(/^\d+(?:\.\d+)?$/.test(raw.trim())?positive(Number(raw))*1000:positive(Date.parse(raw)-now)):0;
 const delay=Math.max(retry,seconds('x-ratelimit-retry'),seconds('x-ratelimit-reset'));
 return now+Math.max(response.status===429?60000:2000,delay);
}
function message(until:number,busy=false){
 const time=new Date(until).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',second:'2-digit'});
 return new BadGatewayException(busy
  ? 'Проверка поставки WB этого клиента уже выполняется. Повторите позже.'
  : 'WB ограничил частоту проверки поставок. Следующая проверка доступна после '+time+' МСК (через '+Math.max(1,Math.ceil((until-Date.now())/1000))+' сек.).');
}
// FIX: one durable gate per WMS client, shared by cabinet connections and manual/background calls.
// No DB transaction stays open while HTTP is in flight.
export async function wbFboPausedFetch(db:any,clientId:string|undefined,send:()=>Promise<Response>):Promise<Response>{
 if(!clientId)throw new BadGatewayException('Не определён клиент для проверки поставки WB.');
 const key='wb-fbo-http-pause:v1:'+clientId;
 const locked=<T>(fn:(tx:any,s:State)=>Promise<T>)=>db.$transaction(async(tx:any)=>{
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`);
  return fn(tx,(await tx.systemSetting.findUnique({where:{key}}))?.value??{});
 });
 const save=(tx:any,value:State)=>tx.systemSetting.upsert({where:{key},create:{key,value},update:{value}});
 const token=randomUUID();
 await locked(async(tx,s)=>{
  const now=Date.now();
  if((s.until??0)>now)throw message(s.until!);
  if((s.leaseUntil??0)>now)throw message(s.leaseUntil!,true);
  await save(tx,{...s,token,leaseUntil:now+60000});
 });
 let response:Response|undefined;
 try {response=await send();}
 finally {
  await locked(async(tx,s)=>{
   const now=Date.now();
   const limited=response?.status===429||response?.headers.get('x-ratelimit-remaining')==='0';
   const until=Math.max(s.until??0,response?(limited?wbPauseDeadline(response,now):now+2000):now+10000);
   await save(tx,{...s,until,...(s.token===token?{token:null,leaseUntil:0}:{})});
  });
 }
 if(response.status===429)throw message(wbPauseDeadline(response,Date.now()));
 return response;
}
