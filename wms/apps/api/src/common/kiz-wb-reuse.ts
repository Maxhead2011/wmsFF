import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { physicalKizIdentity } from './kiz-physical-identity';
import { KizCirculationCryptoService } from '../modules/kiz-circulation/kiz-circulation-crypto.service';
import { officialTrueApiBase } from '../modules/kiz-circulation/kiz-circulation.policy';

export const kizReuseEnabled = () => process.env.WMS_KIZ_REUSE_EVIDENCE_ENABLED === 'true';
// FIX: keep the planned-size exception independent of the published relabel module version.
export const pendingSizeKizRelabel = (task: {requiresKiz: boolean; relabelRequired: boolean;
  sourceSkuId: string | null; relabelConfirmedAt: Date | null}) =>
  process.env.WMS_FBS_KIZ_RELABEL_ENABLED === 'true' && task.requiresKiz &&
  task.relabelRequired && Boolean(task.sourceSkuId) && !task.relabelConfirmedAt;
export type ReuseDecision = 'ALLOW' | 'REVIEW' | 'RELABEL';
export type OrderEvidence = { verified: boolean; supplierStatus?: string; wbStatus?: string;
  containsKiz?: boolean; supplyAccepted?: boolean | null };
const cancelled = new Set(['canceled', 'canceled_by_client', 'declined_by_client', 'defect']);
// FIX: order cancellation, label printing and local SHIPPING never prove a sale of this serial.
export function decideKizReuse(orders: OrderEvidence[], circulation: string | null): ReuseDecision {
  if (['RETIRED', 'WRITTEN_OFF'].includes(circulation ?? '')) return 'RELABEL';
  if (orders.some(o => o.verified && o.containsKiz &&
      (o.wbStatus === 'sold' || (o.supplyAccepted === true && cancelled.has(o.wbStatus ?? ''))))) return 'RELABEL';
  if (circulation === 'INTRODUCED' && orders.length > 0 && orders.every(o => o.verified &&
      o.supplierStatus === 'cancel' && cancelled.has(o.wbStatus ?? '') &&
      o.containsKiz === false && o.supplyAccepted === false)) return 'ALLOW';
  return 'REVIEW';
}
export const kizReuseMessage = (decision: ReuseDecision) => decision === 'RELABEL'
  ? 'Нужна переклейка: использование этого КИЗа подтверждено. Нужен новый КИЗ.'
  : decision === 'REVIEW' ? 'КИЗ связан с прежним заказом. Нужна проверка администратора; переклейка пока не подтверждена.'
  : 'Прежний заказ отменён до передачи, КИЗ не погашен. Можно продолжить сборку.';

function identity(value: string) {
  return physicalKizIdentity(value.replace(/^\]d2/i, '').replace(/<GS>/gi, '\u001d').replace(/^\(01\)(\d{14})\(21\)/, '01$121')
    .replace(/^(01\d{14})\u001d21/, '$121'));
}
type History = { orderId: string | null; requestId: string; at: Date | null; event: string;
  connectionId?: string; supplyId?: string; worker?: string };
const record = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};

// FIX: read-only, client-scoped evidence shared by picker validation and administrator lookup.
// No stock/mark restoration is performed here; existing lease/reservation transactions remain mandatory.
export async function inspectKizReuse(db: PrismaService, clientId: string, kiz: string, excludedId = '') {
  const serial = identity(kiz);
  const separated = serial.slice(0,16) + '\u001d' + serial.slice(16);
  const prefixes = [serial, ']d2' + serial, ']D2' + serial, separated, ']d2' + separated,
    '(01)' + serial.slice(2,16) + '(21)' + serial.slice(18), separated.replace('\u001d','<GS>')];
  const filter = { OR: prefixes.map(prefix => ({ kiz: { startsWith: prefix } })) };
  const checkedAt = new Date().toISOString();
  if (!serial) return { decision: 'REVIEW' as ReuseDecision, checkedAt, history: [], orders: [], circulation: null };
  const [tasks, attempts, shipments, prints] = await Promise.all([
    db.fbsTsdAssembly.findMany({ where: { clientId, marketplace: 'WILDBERRIES', id: { not: excludedId }, ...filter }, take: 101 }),
    db.fbsAssemblyAttemptHistory.findMany({ where: { clientId, ...filter }, take: 101 }),
    db.shippedKizHistory.findMany({ where: { clientId, ...filter }, take: 101 }),
    db.fbsWebKizStickerPrint.findMany({ where: { clientId, ...filter }, take: 101 }),
  ]);
  const exact = (row: { kiz: string | null }) => identity(row.kiz ?? '') === serial;
  const history: History[] = [
    ...tasks.filter(exact).map(t => ({ orderId: t.orderId, requestId: t.requestId, at: t.completedAt,
      event: t.wbMetaStatus === 'ACCEPTED' ? 'КИЗ принят WB; время завершения сборки' : 'Привязка в ВМС',
      connectionId: t.connectionId, supplyId: t.supplyId ?? undefined, worker: t.workerName ?? undefined })),
    ...attempts.filter(exact).map(t => { const s=record(t.taskSnapshot); return { orderId:t.orderId, requestId:t.requestId,
      at:t.completedAt, event:'Архивная сборка', connectionId:s.connectionId as string, supplyId:s.supplyId as string, worker:s.workerName as string }; }),
    ...shipments.filter(exact).map(t => ({ orderId:t.orderId, requestId:t.requestId, at:t.shippedAt, event:'Отгрузка в учёте ВМС', supplyId:t.supplyId ?? undefined })),
    ...prints.filter(exact).map(t => ({ orderId:t.orderId, requestId:t.requestId, at:t.printedAt, event:'Печать этикетки' })),
  ].sort((a,b) => (a.at?.getTime() ?? Infinity)-(b.at?.getTime() ?? Infinity));
  const requests=await db.clientRequest.findMany({ where:{clientId,id:{in:[...new Set(history.map(h=>h.requestId))]}},select:{id:true,number:true,status:true,warehouseId:true} });
  const detailed=history.map(h=>({...h,request:requests.find(r=>r.id===h.requestId) ?? null}));
  const truncated=[tasks,attempts,shipments,prints].some(rows=>rows.length>100);
  if (!history.length && !truncated) return {decision:'ALLOW' as ReuseDecision,checkedAt,history:detailed,orders:[],circulation:null};
  // Remote calls are bounded; absent or incomplete replies are uncertainty, never permission.
  const json=async(url:string,token:string,body?:unknown)=>{
    const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{Authorization:token,'Content-Type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(6000)});
    if(!r.ok)throw new Error('Remote check failed');return r.json();
  };
  const orderIds=[...new Set(history.map(h=>h.orderId).filter((v):v is string=>!!v))];
  const orders: Array<OrderEvidence & {orderId:string}> = [];
  // Limit network work on the scanner path; larger histories remain reviewable in the report.
  await Promise.all(orderIds.slice(0,5).map(async orderId => {
    try {
      const h=history.find(h=>h.orderId===orderId && h.connectionId);
      const link=await db.fbsOrderRequestLink.findFirst({where:{clientId,marketplace:'WILDBERRIES',orderId},select:{connectionId:true,lastSupplyId:true}});
      const connectionId=h?.connectionId ?? link?.connectionId;
      const connection=connectionId ? await db.clientMarketplaceConnection.findFirst({where:{id:connectionId,clientId,marketplace:'WILDBERRIES',isActive:true},select:{apiKey:true}}) : null;
      if(!connection)throw new Error('No connection');
      const [statuses,metadata]=await Promise.all([
        json('https://marketplace-api.wildberries.ru/api/v3/orders/status',connection.apiKey,{orders:[Number(orderId)]}),
        json('https://marketplace-api.wildberries.ru/api/marketplace/v3/orders/meta',connection.apiKey,{orders:[Number(orderId)]}),
      ]);
      const status=statuses.orders?.find((o:any)=>String(o.id)===orderId);
      const meta=metadata.orders?.find((o:any)=>String(o.id)===orderId);
      if(!status || !meta || !Array.isArray(meta.meta?.sgtin?.value))throw new Error('Incomplete evidence');
      // FIX: an order can move between supplies; a null receipt on only the first one is not proof.
      const supplyIds=[...new Set([...history.filter(h=>h.orderId===orderId).map(h=>h.supplyId),link?.lastSupplyId].filter((id):id is string=>!!id))];
      if(supplyIds.length>5)throw new Error('Too many supplies to verify');
      const supplies=await Promise.all(supplyIds.map(id=>json('https://marketplace-api.wildberries.ru/api/v3/supplies/'+encodeURIComponent(id),connection.apiKey)));
      orders.push({orderId,verified:true,supplierStatus:status.supplierStatus,wbStatus:status.wbStatus,
        containsKiz:meta.meta.sgtin.value.some((k:unknown)=>typeof k==='string' && identity(k)===serial),
        supplyAccepted:supplies.some(s=>!!s.scanDt) ? true : supplies.length && supplies.every(s=>Object.hasOwn(s,'scanDt') && s.scanDt===null) ? false : null});
    } catch { orders.push({orderId,verified:false}); }
  }));
  let circulation:string|null=null;
  try {
    const c=await db.kizTrueApiConnection.findUnique({where:{clientId}});
    if(c?.isActive && (!c.tokenExpiresAt || c.tokenExpiresAt>new Date())) {
      const token=new KizCirculationCryptoService(new ConfigService()).decrypt(c.apiTokenEncrypted);
      const rows=await json(officialTrueApiBase(c.apiBaseUrl)+'/cises/info?pg='+encodeURIComponent(c.productGroup),'Bearer '+token,[serial]);
      const row=Array.isArray(rows) ? rows.find((r:any)=>identity(r.cisInfo?.requestedCis ?? r.cisInfo?.cis ?? '')===serial) : null;
      if(row && !row.errorMessage)circulation=typeof row.cisInfo.status==='string'?row.cisInfo.status.toUpperCase():null;
    }
  } catch { /* FIX: missing marking-system evidence must not masquerade as INTRODUCED. */ }
  let decision: ReuseDecision=truncated || orderIds.length>5 ? 'REVIEW' : decideKizReuse(orders,circulation);
  // FIX: do not steal a still-stored task binding or erase immutable history to bypass the unique KIZ constraint.
  if (decision === 'ALLOW' && tasks.some(exact)) decision = 'REVIEW';
  return {decision:decision as ReuseDecision,checkedAt,history:detailed,orders,circulation};
}
