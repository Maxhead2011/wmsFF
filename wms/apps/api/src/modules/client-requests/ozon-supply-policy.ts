import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { OzonDirection } from '../tsd/ozon-fbo-directions';

export type SupplySnapshot = { id: string; name: string; items: Array<{ barcode: string; offerId: string; quantity: number; quant: number }> };
export type SupplyIntegration = {
  connectionId: string; orderId: string; orderNumber: string; place: string; date: string; state: string;
  supplies: SupplySnapshot[]; mapping: Record<string, string>; checkedAt: string;
  operations: Record<string, { state: 'SENDING'|'UNKNOWN'|'ACCEPTED'|'SUCCESS'|'FAILED'; operationId?: string; error?: string; cargoes?: Array<{key:string;cargoId:string;barcode?:string}>; labelOperationId?: string; labelUrl?: string }>;
  frozenHash?: string;
};

// FIX: explicit mappings only; never silently change customer-file quantities.
export function supplyDifferences(directions: OzonDirection[], link: SupplyIntegration) {
  const errors: string[] = [];
  const used = new Set<string>();
  for (const d of directions) {
    const s = link.supplies.find(s => s.id === link.mapping[d.name]);
    if (!s) { errors.push(`«${d.name}»: выберите направление Ozon.`); continue; }
    if (used.has(s.id)) errors.push(`«${s.name}»: назначено нескольким направлениям файла.`);
    used.add(s.id);
    const expected = new Map<string,number>();
    for(const i of d.items) expected.set(i.barcode,(expected.get(i.barcode)??0)+i.quantity);
    const actual = new Map<string,number>();
    for(const i of s.items) actual.set(i.barcode,(actual.get(i.barcode)??0)+i.quantity);
    for(const barcode of new Set([...expected.keys(),...actual.keys()])) {
      if(expected.get(barcode)!==actual.get(barcode)) errors.push(`«${d.name}», ШК ${barcode}: файл ${expected.get(barcode)??0}, Ozon ${actual.get(barcode)??0}.`);
    }
  }
  for(const s of link.supplies) if(!used.has(s.id)) errors.push(`«${s.name}»: отсутствует соответствие в файле.`);
  return errors;
}

export function packedCargoes(directions: OzonDirection[], link: SupplyIntegration, assembly: any) {
  const errors=supplyDifferences(directions,link);
  if(errors.length) throw new ConflictException('Устраните расхождения с Ozon перед передачей коробов.');
  if(!assembly || !['CONTROL','COMPLETED'].includes(assembly.phase) || !assembly.boxes.length || assembly.boxes.some((b:any)=>!b.closedAt||!b.confirmedAt))
    throw new ConflictException('Сначала упакуйте, закройте и проверьте все короба.');
  const units=assembly.units.filter((u:any)=>u.state!=='RETURNED');
  if(units.some((u:any)=>u.state!=='PACKED'||!assembly.boxes.some((b:any)=>b.boxId===u.targetBoxId))) throw new ConflictException('Есть неупакованные единицы.');
  const result:Record<string,any[]>={};
  for(const d of directions){
    const supply=link.supplies.find(s=>s.id===link.mapping[d.name])!;
    const boxes=assembly.boxes.filter((b:any)=>b.direction===d.name);
    for(const i of d.items) if(units.filter((u:any)=>u.skuId===i.skuId&&boxes.some((b:any)=>b.boxId===u.targetBoxId)).length!==i.quantity)
      throw new ConflictException(`Количество в коробах «${d.name}» не совпадает с файлом.`);
    result[supply.id]=boxes.map((b:any)=>{
      const items=new Map<string,any>();
      for(const u of units.filter((u:any)=>u.targetBoxId===b.boxId)){
        const item=d.items.find(i=>i.skuId===u.skuId), matches=supply.items.filter(i=>i.barcode===item?.barcode);
        if(matches.length!==1||!matches[0].offerId) throw new ConflictException('Товар не сопоставлен однозначно с Ozon.');
        const p=matches[0],old=items.get(p.barcode);
        items.set(p.barcode,{barcode:p.barcode,offer_id:p.offerId,quantity:(old?.quantity??0)+1,quant:p.quant||1});
      }
      if(!items.size) throw new ConflictException('Пустой короб нельзя отправить.');
      return {key:b.id,value:{type:'BOX',items:[...items.values()].sort((a,b)=>a.barcode.localeCompare(b.barcode))}};
    }).sort((a:any,b:any)=>a.key.localeCompare(b.key));
  }
  if(assembly.boxes.some((b:any)=>!directions.some(d=>d.name===b.direction))) throw new ConflictException('Короб без направления.');
  return result;
}
export function cargoHash(cargoes:Record<string,any[]>) {return createHash('sha256').update(JSON.stringify(Object.entries(cargoes).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');}
export function assertSupplyMutable(integration: unknown, action: string) {
  if((integration as SupplyIntegration|null)?.frozenHash && action!=='FINISH') throw new ConflictException('Состав зафиксирован для Ozon. Изменение требует отдельной сверки грузомест.');
}
