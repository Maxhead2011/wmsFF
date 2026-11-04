import type { PrismaClient, Prisma } from '@prisma/client';

type Status = {supplierStatus:string; wbStatus:string};
type Reader = (key:string, ids:string[])=>Promise<Map<string,Status>>;
type Db = Pick<PrismaClient,'clientMarketplaceConnection'|'fbsOrderRequestLink'>;

// FIX: refresh the persisted picking snapshot by linked ID, independently of catalogue/history completeness.
export async function refreshLinkedWbStatuses(db:Db, read:Reader, category:(s:string,w:string)=>string,
  warn:(message:string)=>void, stopped=()=>false) {
  const connections=await db.clientMarketplaceConnection.findMany({where:{marketplace:'WILDBERRIES',isActive:true},
    select:{id:true,clientId:true,apiKey:true}});
  for(const c of connections){
    const scope:Prisma.FbsOrderRequestLinkWhereInput={clientId:c.clientId,connectionId:c.id,marketplace:'WILDBERRIES',
      syncStatus:'ACTIVE',request:{status:{notIn:['DONE','CANCELLED','REJECTED']}},
      OR:[{lastCategory:null},{lastCategory:{notIn:['cancelled','archive']}}]};
    let after:string|undefined;
    try {
      while(!stopped()){
        const rows=await db.fbsOrderRequestLink.findMany({where:{...scope,...(after?{id:{gt:after}}:{})},orderBy:{id:'asc'},take:500,
          select:{id:true,requestId:true,orderId:true,updatedAt:true,lastCategory:true,lastSupplierStatus:true,lastWbStatus:true}});
        if(!rows.length) break;
        after=rows[rows.length-1].id;
        const valid=rows.filter(row=>/^[1-9]\d*$/.test(row.orderId)&&Number.isSafeInteger(Number(row.orderId)));
        const result=valid.length?await read(c.apiKey,valid.map(row=>row.orderId)):new Map<string,Status>();
        for(const row of valid){
          const s=result.get(row.orderId);
          if(!s?.supplierStatus||!s.wbStatus||stopped()) continue;
          const next=category(s.supplierStatus,s.wbStatus);
          // A return to assembly needs the actual new supply ID from full synchronization.
          if(row.lastCategory==='shipped' && next==='active') continue;
          if(next===row.lastCategory&&s.supplierStatus===row.lastSupplierStatus&&s.wbStatus===row.lastWbStatus) continue;
          await db.fbsOrderRequestLink.updateMany({where:{...scope,id:row.id,requestId:row.requestId,updatedAt:row.updatedAt},
            data:{lastCategory:next,lastSupplierStatus:s.supplierStatus,lastWbStatus:s.wbStatus,lastSeenAt:new Date()}});
        }
        if(rows.length<500) break;
      }
    } catch {warn('WB linked status refresh failed for connection '+c.id);}
  }
}

export function startLinkedWbRefresh(run:(stopped:()=>boolean)=>Promise<void>,warn:(message:string)=>void){
  let stopped=false, running:Promise<void>|undefined;
  const schedule=(delay:number)=>{const t=setTimeout(()=>{running=run(()=>stopped).catch(()=>warn('WB linked status refresh failed'))
    .finally(()=>{if(!stopped) timer=schedule(60000);});},delay);t.unref?.();return t;};
  let timer=schedule(5000);
  return async()=>{stopped=true;clearTimeout(timer);await running;};
}
