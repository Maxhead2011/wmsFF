import { fetchClients, type AuthSession } from '../../lib/api';
import { submitPreparedSeries, type SeriesPayload } from '../../lib/printSeries';
export type LabelStation={id:string;name:string;printerName:string;labelWidthMm:number;labelHeightMm:number};
export function compatibleLabelStations(formats:LabelStation[],online:{id:string}[],width:number,height:number){return formats.filter(s=>online.some(o=>o.id===s.id)&&s.labelWidthMm===width&&s.labelHeightMm===height);}
// FIX: prepare one immutable series; no partial jobs and no warehouse/order operations.
export function labelAgentPayload(clientId:string,stationId:string,widthMm:number,heightMm:number,images:string[]):Omit<SeriesPayload,'requestId'>{
  if(!clientId||!stationId)throw new Error('Выберите клиента и принтер.');
  if(![widthMm,heightMm].every(n=>Number.isInteger(n)&&n>=20&&n<=150))throw new Error('Агент поддерживает целые размеры от 20 до 150 мм.');
  if(!images.length||images.length>100||images.some(s=>!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)))throw new Error('Не удалось подготовить весь комплект этикеток.');
  return {clientId,stationId,widthMm,heightMm,pages:images.map((s,i)=>({value:`Этикетка ${i+1}`,imageBase64:s.slice(s.indexOf(',')+1)}))};
}
export async function openLabelAgent(session:AuthSession,width:number,height:number,render:()=>Promise<string[]>){
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Печать через агент');dialog.style.cssText='width:min(560px,90vw);max-height:85vh;overflow:auto;padding:24px;border:1px solid #d8cbe9;border-radius:18px;background:white;color:#334454;font:16px/1.5 system-ui';
  function add<K extends keyof HTMLElementTagNameMap>(tag:K,text:string){const el=document.createElement(tag);el.textContent=text;dialog.append(el);return el;}
  add('h2','Печать через тихий агент');add('p',`${width} × ${height} мм · весь комплект одним заданием`);
  const clientLabel=add('label','Клиент'),client=document.createElement('select');client.setAttribute('aria-label','Клиент для печати');clientLabel.append(client);
  const stationLabel=add('label','Принтер'),station=document.createElement('select');station.setAttribute('aria-label','Принтер агента');stationLabel.append(station);
  for(const el of [client,station])el.style.cssText='display:block;width:100%;padding:12px;margin:8px 0 16px;border:1px solid #ccdbe1;border-radius:10px;font:inherit';
  const status=add('p','Загружаю подключённые принтеры…');status.setAttribute('role','status');
  const send=add('button','Отправить на печать'),close=add('button','Отмена');for(const b of [send,close]){b.type='button';b.style.cssText='padding:12px 18px;margin:6px;border:1px solid #d8cbe9;border-radius:12px;font:inherit;background:#f3edf8;cursor:pointer';}send.disabled=true;
  let busy=false,disposed=false,prepared:Omit<SeriesPayload,'requestId'>|null=null;
  const cleanup=()=>{disposed=true;dialog.remove();};dialog.addEventListener('close',cleanup,{once:true});dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});close.onclick=()=>{if(!busy){dialog.close();cleanup();}};
  document.body.append(dialog);dialog.showModal();
  const get=async(path:string)=>{const r=await fetch('/api/v1/print/series/'+path,{headers:{Authorization:`Bearer ${session.accessToken}`}});const data=await r.json();if(!r.ok)throw new Error(data.message||'Агент недоступен.');return data;};
  try{
    const [clients,online,formats]=await Promise.all([fetchClients(session.accessToken),get('stations'),get('formats')]);if(disposed)return;
    client.append(new Option('Выберите клиента',''));clients.forEach(c=>client.append(new Option(`${c.code} · ${c.name}`,c.id)));
    const available=compatibleLabelStations(formats,online,width,height);station.append(new Option('Выберите принтер',''));available.forEach(s=>station.append(new Option(`${s.name} · ${s.printerName}`,s.id)));
    status.textContent=available.length?'Выберите клиента и принтер. Печать начнётся только после отправки.':'Нет подключённого агента с таким размером этикетки. Проверьте формат в разделе «Принтеры».';
    client.onchange=station.onchange=()=>{send.disabled=!client.value||!station.value;};
  }catch(e){if(!disposed)status.textContent=e instanceof Error?e.message:'Не удалось загрузить принтеры.';}
  send.onclick=async()=>{
    if(busy||!client.value||!station.value)return;busy=true;send.disabled=true;client.disabled=true;station.disabled=true;close.disabled=true;status.textContent='Подготавливаю и отправляю весь комплект…';
    try{prepared??=labelAgentPayload(client.value,station.value,width,height,await render());const result=await submitPreparedSeries(session.accessToken,prepared);status.textContent=`Задание ${result.id}: ${result.status==='printed'?'напечатано':'передано в очередь агента'}. Этикеток: ${result.pages}.`;send.hidden=true;close.textContent='Закрыть';}
    catch(e){const message=e instanceof Error?e.message:'Не получено подтверждение отправки.';status.textContent=message;send.textContent='Повторить то же задание';send.disabled=message.includes('Серия завершилась с ошибкой');if(!prepared){client.disabled=false;station.disabled=false;}}
    finally{busy=false;close.disabled=false;}
  };
}

// FIX: media configured on branch printers is available even without a product template.
export function labelFormatOptions(templates:{id:string;name:string;widthMm:number;heightMm:number;isActive:boolean}[],stations:LabelStation[]){
  const result=templates.filter(t=>t.isActive).map(t=>({id:t.id,name:t.name,widthMm:t.widthMm,heightMm:t.heightMm}));
  for(const s of stations)if(!result.some(f=>f.widthMm===s.labelWidthMm&&f.heightMm===s.labelHeightMm))result.push({id:'station:'+s.id,name:s.name,widthMm:s.labelWidthMm,heightMm:s.labelHeightMm});
  return result;
}
