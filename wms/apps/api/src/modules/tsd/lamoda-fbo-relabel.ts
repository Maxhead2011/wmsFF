import { ConflictException } from '@nestjs/common';
import type { LamodaPlanLine } from '../lamoda/lamoda-policy';
import type { Prisma } from '@prisma/client';

export type LamodaRelabelLabel = { skuId:string; barcode:string; article:string; name:string; size:string|null };
type Card = { skuId:string|null; barcode:string|null; remoteSku:string; externalSku:string|null; name:string; size:string|null; linkState:string; isPresent:boolean };

// FIX: freeze the marketplace identity; never print a warehouse alias or guess a size.
export function lamodaRelabelLabels(lines:LamodaPlanLine[], cards:Card[]):LamodaRelabelLabel[] {
  const labels = new Map<string,LamodaRelabelLabel>();
  for (const line of lines) {
    const matches=cards.filter(p=>p.isPresent&&p.linkState==='CONFIRMED'&&p.skuId&&p.barcode===line.barcode&&
      (!line.remoteSku||p.remoteSku===line.remoteSku)&&(!line.article||[p.externalSku,p.remoteSku].includes(line.article)));
    if(matches.length!==1) throw new ConflictException('Переклейка Lamoda: подтвердите однозначное соответствие каждой строки.');
    const p=matches[0];
    if(!/^\d{8,14}$/.test(p.barcode??'')) throw new ConflictException('В карточке Lamoda нет корректного товарного ШК.');
    const label={skuId:p.skuId!,barcode:p.barcode!,article:p.remoteSku,name:p.name,size:p.size};
    const old=labels.get(label.skuId);
    if(old && JSON.stringify(old)!==JSON.stringify(label)) throw new ConflictException('Один складской товар связан с разными этикетками Lamoda. Уточните соответствия.');
    labels.set(label.skuId,label);
  }
  return [...labels.values()];
}

export function assertLamodaRelabelScan(expected:string, scanned:string|undefined, printStatus:string|null) {
  if(printStatus!=='PRINTED') throw new ConflictException('Дождитесь подтверждения печати этикетки Lamoda.');
  if(scanned?.trim()!==expected) throw new ConflictException('Отсканирован не тот ШК Lamoda. Проверьте товар и размер.');
}

export function assertLamodaRelabelPacked(required:boolean, confirmedAt:Date|null|undefined) {
  if(required&&!confirmedAt) throw new ConflictException('Сначала напечатайте этикетку Lamoda и подтвердите переклейку сканированием нового ШК.');
}

export async function readLamodaRelabelLabels(tx:Prisma.TransactionClient, assembly:{planId:string;relabelLabels?:unknown}) {
  if(Array.isArray(assembly.relabelLabels)) return assembly.relabelLabels as LamodaRelabelLabel[];
  const plan=await tx.lamodaPlan.findUniqueOrThrow({where:{id:assembly.planId}});
  const cards=await tx.lamodaProduct.findMany({where:{accountId:plan.accountId,isPresent:true,linkState:'CONFIRMED'}});
  return lamodaRelabelLabels(plan.items as unknown as LamodaPlanLine[],cards);
}

// FIX: administrative bulk recovery has no physical label scan; use normal unit packing.
export async function assertLamodaRelabelRecovery(tx:Prisma.TransactionClient, request:{id:string;client:{relabelingEnabled:boolean}}) {
  if(process.env.WMS_LAMODA_ENABLED!=='true')return;
  const binding=await tx.lamodaFboAssembly.findUnique({where:{requestId:request.id}});
  if(binding&&(binding.relabelLabels||request.client.relabelingEnabled&&process.env.WMS_LAMODA_FBO_RELABEL_ENABLED==='true'))
    throw new ConflictException('Товар Lamoda с переклейкой упаковывается только через поштучное сканирование.');
}
