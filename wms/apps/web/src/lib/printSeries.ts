export type SeriesPage = {value:string;imageBase64:string};
export type SeriesPayload = {requestId:string;stationId:string;clientId:string;widthMm:number;heightMm:number;pages:SeriesPage[]};
// FIX: prepare all pages before the single POST; preserve the request ID on explicit retry.
export async function preparePrintSeries(values:string[], options:Omit<SeriesPayload,'pages'|'requestId'>, render:(value:string)=>Promise<string>):Promise<SeriesPayload> {
  if(!values.length || values.length>500)throw new Error('Серия — от 1 до 500 этикеток.');
  const pages:SeriesPage[]=[];
  for(const value of values) pages.push({value,imageBase64:(await render(value)).replace(/^data:image\/png;base64,/, '')});
  return {...options,requestId:crypto.randomUUID(),pages};
}
export async function sendPrintSeries(accessToken:string,payload:SeriesPayload) {
  const response=await fetch('/api/v1/print/series/jobs',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify(payload)});
  const data=await response.json();
  if(!response.ok)throw new Error(typeof data.message==='string'?data.message:'Не удалось отправить серию. Повторите отправку этой же серии.');
  return data as {id:string;status:string;pages:number};
}

// FIX: after an ambiguous network response, an explicit retry reuses the original UUID.
export async function submitPreparedSeries(accessToken:string, input:Omit<SeriesPayload,'requestId'>) {
  const encoded=new TextEncoder().encode(JSON.stringify(input));
  if(encoded.byteLength>8_000_000)throw new Error('Серия слишком велика. Уменьшите количество этикеток.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoded))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const key='wms-print-series:'+hash;
  const requestId=sessionStorage.getItem(key)||crypto.randomUUID();
  sessionStorage.setItem(key,requestId);
  const result=await sendPrintSeries(accessToken,{...input,requestId});
  sessionStorage.removeItem(key);
  if(result.status==='failed')throw new Error('Серия завершилась с ошибкой. Проверьте уже вышедшие этикетки. Повторное нажатие создаст новое задание.');
  return result;
}
