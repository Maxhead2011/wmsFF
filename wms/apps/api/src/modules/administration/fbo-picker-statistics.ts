import type {Prisma} from '@prisma/client';
import type {AuthUser} from '../auth/auth.types';
import {warehouseScopeWhere} from '../client-requests/client-request-warehouse-scope';
type Db=Pick<Prisma.TransactionClient,'fboAssemblyUnit'|'clientRequest'|'user'>;
type Detail={requestId:string;requestNumber:number;title:string;clientName:string;pickedUnits:number;packedUnits:number;firstActionAt:string;lastActionAt:string};
// FIX: current physical unit records, not scan retries; each stage uses its own actor/date.
export async function fboPickerStatistics(db:Db,user:AuthUser,period:{from:Date;to:Date}) {
 if(process.env.WMS_FBO_PICKER_STATISTICS_ENABLED!=='true')return undefined;
 const scope={client:{isDemo:Boolean(user.isDemo)},...warehouseScopeWhere(user)};
 const where={state:{not:'RETURNED'},assembly:{request:scope}};
 const [picked,packed]=await Promise.all([
  db.fboAssemblyUnit.groupBy({by:['requestId','pickedByUserId'],where:{...where,pickedAt:{gte:period.from,lt:period.to}},_count:{_all:true},_min:{pickedAt:true},_max:{pickedAt:true}}),
  db.fboAssemblyUnit.groupBy({by:['requestId','packedByUserId'],where:{...where,packedByUserId:{not:null},packedAt:{gte:period.from,lt:period.to}},_count:{_all:true},_min:{packedAt:true},_max:{packedAt:true}}),
 ]);
 const events=[...picked.map(r=>({requestId:r.requestId,actor:r.pickedByUserId,picked:r._count._all,packed:0,first:r._min.pickedAt,last:r._max.pickedAt})),...packed.map(r=>({requestId:r.requestId,actor:r.packedByUserId!,picked:0,packed:r._count._all,first:r._min.packedAt,last:r._max.packedAt}))];
 const requestIds=[...new Set(events.map(e=>e.requestId))],actors=[...new Set(events.map(e=>e.actor))];
 const [requests,users]=await Promise.all([
  requestIds.length?db.clientRequest.findMany({where:{...scope,id:{in:requestIds}},select:{id:true,number:true,title:true,client:{select:{name:true}}}}):[],
  actors.length?db.user.findMany({where:{id:{in:actors},isDemo:Boolean(user.isDemo)},select:{id:true,name:true}}):[],
 ]);
 const requestMap=new Map(requests.map(r=>[r.id,r])),names=new Map(users.map(u=>[u.id,u.name]));
 const workers=new Map<string,{workerId:string;workerName:string;details:Map<string,Detail>}>();
 for(const event of events){
  const request=requestMap.get(event.requestId);if(!request||!event.first||!event.last)continue;
  const worker=workers.get(event.actor)??{workerId:event.actor,workerName:names.get(event.actor)||'Сотрудник не определён',details:new Map<string,Detail>()};
  const first=event.first.toISOString(),last=event.last.toISOString();
  const detail=worker.details.get(request.id)??{requestId:request.id,requestNumber:request.number,title:request.title,clientName:request.client.name,pickedUnits:0,packedUnits:0,firstActionAt:first,lastActionAt:last};
  detail.pickedUnits+=event.picked;detail.packedUnits+=event.packed;
  if(first<detail.firstActionAt)detail.firstActionAt=first;if(last>detail.lastActionAt)detail.lastActionAt=last;
  worker.details.set(request.id,detail);workers.set(event.actor,worker);
 }
 const rows=[...workers.values()].map(w=>({workerId:w.workerId,workerName:w.workerName,requests:w.details.size,pickedUnits:[...w.details.values()].reduce((s,d)=>s+d.pickedUnits,0),packedUnits:[...w.details.values()].reduce((s,d)=>s+d.packedUnits,0),requestDetails:[...w.details.values()].sort((a,b)=>b.lastActionAt.localeCompare(a.lastActionAt))})).sort((a,b)=>(b.pickedUnits+b.packedUnits)-(a.pickedUnits+a.packedUnits)||a.workerName.localeCompare(b.workerName,'ru-RU'));
 return {summary:{workers:rows.length,requests:new Set(rows.flatMap(w=>w.requestDetails.map(d=>d.requestId))).size,pickedUnits:rows.reduce((s,w)=>s+w.pickedUnits,0),packedUnits:rows.reduce((s,w)=>s+w.packedUnits,0)},workers:rows};
}
