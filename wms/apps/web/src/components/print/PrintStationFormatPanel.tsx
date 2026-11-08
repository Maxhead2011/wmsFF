import { useEffect, useState } from 'react';
import type { AuthSession } from '../../lib/api';

type Station = {id:string;name:string;printerName:string;labelWidthMm:number;labelHeightMm:number};
const presets = ['40x30','50x30','58x40','60x40','70x120'];
async function request(token:string,path:string,body?:unknown) {
  const response = await fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/print/series/${path}`, {method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data = await response.json();
  if(!response.ok) throw new Error(Array.isArray(data.message)?data.message.join(', '):data.message || 'Не удалось сохранить формат.');
  return data;
}
export function StationFormat({station,token}:{station:Station;token:string}) {
  const [width,setWidth]=useState(station.labelWidthMm);
  const [height,setHeight]=useState(station.labelHeightMm);
  const [custom,setCustom]=useState(!presets.includes(`${station.labelWidthMm}x${station.labelHeightMm}`));
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const format=`${width}x${height}`;
  return <form className="print-card" onSubmit={async event=>{event.preventDefault();setBusy(true);setMessage('');try {await request(token,`stations/${encodeURIComponent(station.id)}/format`,{widthMm:width,heightMm:height});setMessage('Сохранено. Обновлённый агент применит формат перед следующим заданием.');}catch(e){setMessage(e instanceof Error?e.message:'Ошибка сохранения.');}finally{setBusy(false);}}}>
    <h4>{station.name} · {station.printerName}</h4>
    <fieldset disabled={busy} style={{display:'flex',flexWrap:'wrap',gap:16}}>
      <label>Формат этикетки <select value={!custom&&presets.includes(format)?format:'custom'} onChange={e=>{setCustom(e.target.value==='custom');if(e.target.value!=='custom'){const [w,h]=e.target.value.split('x').map(Number);setWidth(w);setHeight(h);}}}>
        {presets.map(p=><option key={p} value={p}>{p.replace('x',' × ')} мм</option>)}<option value="custom">Свой размер</option>
      </select></label>
      <label>Ширина, мм <input type="number" min={20} max={150} required value={width} onChange={e=>setWidth(Number(e.target.value))}/></label>
      <label>Длина по подаче, мм <input type="number" min={20} max={150} required value={height} onChange={e=>setHeight(Number(e.target.value))}/></label>
      <button type="submit">{busy?'Сохраняю…':'Сохранить формат'}</button>
    </fieldset>
    <p role="status">{message}</p>
  </form>;
}
// FIX: paper dimensions are explicit and configurable per Windows print station.
export function PrintStationFormatPanel({session}:{session:AuthSession}) {
  const [stations,setStations]=useState<Station[]>([]);
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;request(session.accessToken,'formats').then(data=>{if(active)setStations(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[session.accessToken]);
  return <section style={{gridColumn:'1 / -1'}}><h3>Формат бумаги на станциях Windows</h3><p>Для Ozon: ширина 70 мм, длина 120 мм. Размер должен совпадать с установленной бумагой. Изображение размещается целиком с сохранением пропорций.</p>{error&&<p role="alert">{error}</p>}{stations.map(s=><StationFormat key={`${s.id}:${session.accessToken}`} station={s} token={session.accessToken}/>)}</section>;
}
