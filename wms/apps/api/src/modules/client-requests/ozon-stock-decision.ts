import { BadRequestException } from '@nestjs/common';

type Item = { skuId:string; barcode:string; name:string; quantity:number };

// FIX: validate the displayed snapshot against the request being created.
export function readOzonStockDecision(raw:string|undefined, items:Item[]) {
  if (raw === undefined) return null;
  const invalid = () => new BadRequestException('Проверка остатков не соответствует составу. Повторите сверку.');
  if (typeof raw !== 'string' || raw.length > 1_000_000) throw invalid();
  let value;
  try { value = JSON.parse(raw); } catch { throw invalid(); }
  if (!value || !['AS_IS','OPEN_CORRECTION'].includes(value.mode) || !Array.isArray(value.lines)) throw invalid();
  const demand = new Map<string,Item>();
  for(const item of items) {
    const previous = demand.get(item.skuId);
    demand.set(item.skuId,{...item,quantity:item.quantity+(previous?.quantity??0)});
  }
  const shortages = [];
  let availableForPlan = 0;
  for(const line of value.lines) {
    const item = demand.get(line?.skuId);
    if (!item || line.requestedQuantity !== item.quantity || !Number.isSafeInteger(line.availableQuantity) ||
        line.availableQuantity < 0 || line.shortageQuantity !== Math.max(0,item.quantity-line.availableQuantity)) throw invalid();
    demand.delete(item.skuId);
    availableForPlan += Math.min(item.quantity,line.availableQuantity);
    if(line.shortageQuantity) shortages.push({...item,available:line.availableQuantity,shortage:line.shortageQuantity});
  }
  if(demand.size) throw invalid();
  return {mode:String(value.mode),requested:items.reduce((n,i)=>n+i.quantity,0),availableForPlan,shortages};
}

// FIX: record a correction outcome only at the transition that actually happened.
export async function recordOzonCorrectionEvent(tx:Pick<import('@prisma/client').Prisma.TransactionClient,'clientRequestEvent'>,
  requestId:string, clientId:string, userId:string, state:'STARTED'|'FAILED'|'UNKNOWN'|'APPLIED', reference:string) {
  if(process.env.WMS_OZON_STOCK_DECISION_AUDIT_ENABLED!=='true') return;
  const title = {STARTED:'Сотрудник подтвердил отправку корректировки в Ozon',FAILED:'Ozon отклонил корректировку',
    UNKNOWN:'Результат отправки корректировки неизвестен',APPLIED:'Корректировка подтверждена Ozon и применена в ВМС'}[state];
  await tx.clientRequestEvent.create({data:{requestId,clientId,createdByUserId:userId,eventType:'COMMENT',title,body:reference}});
}
