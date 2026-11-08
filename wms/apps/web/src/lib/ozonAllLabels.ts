import type {SeriesPayload} from './printSeries';
export type OzonPrintManifest={clientId:string;fingerprint:string;total:number;supplies:Array<{id:string;name:string;cargoIds:string[]}>};
export type OzonPrintPart=OzonPrintManifest&Pick<SeriesPayload,'widthMm'|'heightMm'|'pages'>;
// FIX: no queue write until every direction has been prepared and the manifest rechecked.
export async function prepareOzonAllLabels(manifest:OzonPrintManifest,stationId:string,part:(id:string)=>Promise<OzonPrintPart>,recheck:()=>Promise<OzonPrintManifest>,progress:(text:string)=>void) {
 const pages:SeriesPayload['pages']=[];let widthMm=0,heightMm=0;
 for(const supply of manifest.supplies){
  progress(`Подготовка: ${supply.name} · ${pages.length} из ${manifest.total}`);
  const next=await part(supply.id);
  if(next.fingerprint!==manifest.fingerprint||next.clientId!==manifest.clientId)throw new Error('Состав грузомест изменился. Подготовьте этикетки заново.');
  if(next.pages.length!==supply.cargoIds.length||new Set(next.pages.map(p=>p.value)).size!==supply.cargoIds.length||next.pages.some(p=>!supply.cargoIds.includes(p.value)))throw new Error('Комплект этикеток направления неполный. Печать не начата.');
  if(widthMm&&(widthMm!==next.widthMm||heightMm!==next.heightMm))throw new Error('В направлениях разные форматы этикеток.');
  widthMm=next.widthMm;heightMm=next.heightMm;pages.push(...next.pages);
 }
 if(!pages.length||pages.length!==manifest.total||new Set(pages.map(p=>p.value)).size!==pages.length)throw new Error('Комплект этикеток неполный. Печать не начата.');
 if((await recheck()).fingerprint!==manifest.fingerprint)throw new Error('Состав грузомест изменился. Подготовьте этикетки заново.');
 const input={stationId,clientId:manifest.clientId,widthMm,heightMm,pages};
 if(new TextEncoder().encode(JSON.stringify(input)).length>8_000_000)throw new Error('Комплект превышает допустимый размер очереди. Печать не начата.');
 return input;
}
