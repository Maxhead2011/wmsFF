import {ConflictException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {clientKizFilter,clientKizIdentity,clientKizPrefixes} from './kiz-client-registry';
import {shipmentPrefixIds} from './kiz-shipment-prefix';

// FIX: request-local reads, built under the same identity locks and transaction as shipment.
// Never reused across operations, clients or transaction retries. Policy decisions stay in kiz-client-review.
export type ShipmentKizRead = {identity:string;request:any;units:any[];rows:any[];marks:any[];shipments:any[];historyUnits:any[];consumed:any[];claims:any[];tasks:any[];bindings:any[]};
export async function loadShipmentKizReads(tx:any,request:any,units:any[]):Promise<Map<string,ShipmentKizRead>> {
 const keys=[...new Set<string>(units.map(u=>clientKizIdentity(u.kiz)))].sort();
 if(keys.some(k=>!k))throw new ConflictException('Не удалось определить КИЗ поставки. Нужна проверка.');
 const result=new Map<string,ShipmentKizRead>();if(!keys.length)return result;
 // Same keys/hash as lockClientKiz; deterministic lock order prevents competing shipments interleaving.
 const locks=keys.map(k=>JSON.stringify(['kiz-client',request.clientId,k])).sort();
 await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(k,0))::text FROM unnest(${locks}::text[]) AS k ORDER BY k`);
 const current=await tx.clientRequest.findUnique({where:{id:request.id}});
 if(!current||current.clientId!==request.clientId||current.warehouseId!==request.warehouseId||['CANCELLED','REJECTED'].includes(current.status))throw new ConflictException('Заявка или клиент изменились. Повторите проверку КИЗ.');
 for(let start=0;start<keys.length;start+=20){
  const part=keys.slice(start,start+20),where=(field='kiz')=>({OR:part.map(k=>clientKizFilter(k,field))});
  // Bound memory; a saturated batch fails closed instead of treating omitted rows as absent.
  const take=10021;
  // FIX: own-WMS indexed range lookup; policy and transaction lifetime remain unchanged.
  const indexed=process.env.WMS_KIZ_SHIPMENT_PREFIX_ENABLED==='true';
  const ids=async(kind:'marks'|'shipments'|'history'|'tasks'|'bindings',legacy:any)=>indexed
   ? {id:{in:await shipmentPrefixIds(tx,request,part,kind,take)}}:legacy;
  const marksWhere=await ids('marks',{clientId:request.clientId,...where('value')});
  const shipmentsWhere=await ids('shipments',{clientId:request.clientId,...where()});
  const historyWhere=await ids('history',{state:{not:'RETURNED'},...where(),assembly:{request:{clientId:request.clientId,status:'DONE'}}});
  const tasksWhere=await ids('tasks',{clientId:request.clientId,...where(),status:{in:['IN_PROGRESS','COMPLETED','RETURN_REQUIRED']}});
  const bindingsWhere=await ids('bindings',{requestId:{not:request.id},activeMarkId:{not:null},...where(),assembly:{request:{clientId:request.clientId}}});
  const [marks,shipments,historyUnits,rows,tasks,bindings]=await Promise.all([
   tx.productMark.findMany({where:marksWhere,include:{box:true,sku:true},take}),
   tx.shippedKizHistory.findMany({where:shipmentsWhere,orderBy:{shippedAt:'desc'},take}),
   tx.fboAssemblyUnit.findMany({where:historyWhere,include:{assembly:{include:{request:true}}},take}),
   tx.kizReviewCase.findMany({where:{clientId:request.clientId,kizIdentity:{in:part}},take}),
   tx.fbsTsdAssembly.findMany({where:tasksWhere,take}),
   tx.fboAssemblyUnit.findMany({where:bindingsWhere,include:{assembly:{include:{request:true}}},take}),
  ]);
  if([marks,shipments,historyUnits,rows,tasks,bindings].some(a=>a.length>=take))throw new ConflictException('Слишком много записей истории КИЗ. Требуется разбор администратором.');
  for(const key of part){
   const prefixes=clientKizPrefixes(key),matches=(row:any,field='kiz')=>prefixes.some(prefix=>String(row[field]??'').startsWith(prefix));
   const ownRows=rows.filter((r:any)=>r.kizIdentity===key);
   result.set(key,{identity:key,request:current,units,rows:ownRows,marks:marks.filter((m:any)=>matches(m,'value')),
    shipments:shipments.filter((s:any)=>matches(s)).slice(0,501),historyUnits:historyUnits.filter((u:any)=>matches(u)).slice(0,501),
    consumed:ownRows.filter((r:any)=>r.status==='USED'&&r.taskId.startsWith('GUARD:')).slice(0,501),
    claims:ownRows.filter((r:any)=>r.status==='CLAIMED'&&r.taskId.startsWith('GUARD:')),
    tasks:tasks.filter((t:any)=>matches(t)),bindings:bindings.filter((u:any)=>matches(u))});
  }
 }
 return result;
}
