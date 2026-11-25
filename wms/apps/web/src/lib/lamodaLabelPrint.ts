import { submitPreparedSeries } from './printSeries';
export type LamodaBatchData={skuId:string;composition:string;manufacturer:string;origin:string;manufacturedAt:string};
export type LamodaLabelDraft=LamodaBatchData&{model:string;size:string;barcode:string;article:string};
export type LamodaPreview = {clientId:string;skuId:string;barcode:string;article:string;widthMm:number;heightMm:number;imageBase64:string;pdfBase64:string};
type Sku = {id:string;barcodes?:{value:string;source?:string|null}[]};
// FIX: resolve confirmed Lamoda identity on the server, never substitute the warehouse barcode.
export async function previewLamodaLabel(token:string,clientId:string,sku:Sku,selectedBarcode?:string):Promise<LamodaPreview> {
 const query=new URLSearchParams({skuId:sku.id});
 if(selectedBarcode&&sku.barcodes?.some(b=>b.value===selectedBarcode&&b.source==='LAMODA'))query.set('barcode',selectedBarcode);
 const response=await fetch('/api/v1/print/lamoda/label?'+query,{headers:{Authorization:`Bearer ${token}`}});
 const data=await response.json();
 if(!response.ok)throw new Error(Array.isArray(data.message)?data.message.join('; '):data.message||'Не удалось подготовить этикетку Lamoda.');
 if(data.clientId!==clientId||data.skuId!==sku.id||data.widthMm!==58||data.heightMm!==40||!data.imageBase64||!data.pdfBase64)throw new Error('Данные этикетки Lamoda не соответствуют выбранному товару.');
 return data;
}
// FIX: prepare the entire series before printing; retries use the existing durable series UUID.
export async function printLamodaLabels(token:string,clientId:string,skus:Sku[],copies:Record<string,string|number>,station:string,barcodes:Record<string,string>,browserPrint:(pages:{imageBase64:string;copies:number}[],width:number,height:number)=>void) {
 if(station!=='LOCAL_BROWSER'&&!station.startsWith('AGENT:'))throw new Error('Для Lamoda выберите тихий агент или печать через браузер.');
 const counts=skus.map(s=>Number(copies[s.id]??1));
 if(!skus.length||counts.some(n=>!Number.isInteger(n)||n<1)||counts.reduce((a,b)=>a+b,0)>500)throw new Error('Выберите от 1 до 500 этикеток.');
 const labels:LamodaPreview[]=[];
 for(const sku of skus)labels.push(await previewLamodaLabel(token,clientId,sku,barcodes[sku.id]));
 if(station==='LOCAL_BROWSER') {browserPrint(labels.map((l,i)=>({imageBase64:l.imageBase64,copies:counts[i]})),58,40);return;}
 await submitPreparedSeries(token,{stationId:station.slice(6),clientId,widthMm:58,heightMm:40,pages:labels.flatMap((l,i)=>Array.from({length:counts[i]},()=>({value:l.barcode,imageBase64:l.imageBase64})))});
}
