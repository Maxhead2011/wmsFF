import { BadRequestException } from '@nestjs/common';

// FIX: identify the physical unit without losing punctuation or case in its serial.
export function kizIdentity(value: string): string | null {
  const raw=value.trim().replace(/^\]d2/i,'').replace(/<GS>/gi,'\x1d').replace(/^\(01\)(\d{14})\(21\)/, (_,gtin:string)=>`01${gtin}21`);
  const match=/^(01\d{14}21[^\x1d\r\n]{13})(?:$|\x1d91|91)/.exec(raw);
  return match?.[1] ?? null;
}
export function scanPeriod(dateFrom: string, dateTo: string) {
  for (const s of [dateFrom,dateTo]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0,10)!==s) throw new BadRequestException('Укажите корректные даты.');
  }
  const from=new Date(dateFrom+'T00:00:00+03:00'), until=new Date(Date.parse(dateTo+'T00:00:00+03:00')+86400000);
  if (until<=from || +until-+from>31*86400000) throw new BadRequestException('Выберите период от 1 до 31 дня.');
  return {from,until};
}
type Print = {assemblyId:string;requestId:string;orderId:string;kiz:string;status:string;printedAt:Date|null};
export function withoutConfirmedPrint(scan:{assemblyId:string;requestId:string;orderId:string;kiz:string;at:Date}, jobs:Print[]) {
  const key=kizIdentity(scan.kiz);
  return !jobs.some(j=>j.assemblyId===scan.assemblyId && j.requestId===scan.requestId && j.orderId===scan.orderId &&
    key!==null && kizIdentity(j.kiz)===key && j.status==='PRINTED' && j.printedAt!==null && j.printedAt>=scan.at);
}

// FIX: mutually exclusive scopes; request/supply inspections cover the entire attempt.
export function inspectionScope(input:{dateFrom?:string;dateTo?:string;requestNumber?:string;supplyId?:string}) {
  const kinds=Number(Boolean(input.dateFrom||input.dateTo))+Number(Boolean(input.requestNumber))+Number(Boolean(input.supplyId));
  if(kinds!==1) throw new BadRequestException('Выберите период, заявку ВМС или поставку WB.');
  if(input.requestNumber) {
    if(!/^\d{1,9}$/.test(input.requestNumber)||Number(input.requestNumber)<1) throw new BadRequestException('Укажите номер заявки ВМС.');
    return {kind:'request' as const,number:Number(input.requestNumber),label:`заявка №${Number(input.requestNumber)}`};
  }
  if(input.supplyId) {
    if(!/^WB-GI-\d+$/.test(input.supplyId)) throw new BadRequestException('Укажите номер поставки WB-GI-…');
    return {kind:'supply' as const,supplyId:input.supplyId,label:`поставка ${input.supplyId}`};
  }
  return {kind:'period' as const,...scanPeriod(input.dateFrom??'',input.dateTo??''),label:`${input.dateFrom}–${input.dateTo}, МСК`};
}
