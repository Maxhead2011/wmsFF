import React, { useEffect, useRef, useState } from 'react';
import { fetchFbsProductReserve, saveFbsProductReserve, type AuthSession, type FbsProductReserveRow, type FbsSafetyReserveRule } from '../../lib/api';
export function validProductReserve(mode: string, value: number, lowStock?: { threshold: number; reserveUnits: number }) {
 return Number.isSafeInteger(value) && value >= 0 && value <= (mode === 'PERCENT' ? 100 : 1000000) &&
  (!lowStock || (Number.isSafeInteger(lowStock.threshold) && lowStock.threshold >= 1 && lowStock.threshold <= 1000000 && Number.isSafeInteger(lowStock.reserveUnits) && lowStock.reserveUnits >= 0 && lowStock.reserveUnits <= 1000000));
}
// FIX: place individual settings in the product cell; saving never enables a blocked SKU or publishes stock.
export function FbsProductReserve({ session, clientId, connectionId, skuId, onSaved }: {
 session: AuthSession; clientId: string; connectionId: string; skuId: string; onSaved: () => Promise<unknown>;
}) {
 const [row,setRow]=useState<FbsProductReserveRow|null>(null),[mode,setMode]=useState('INHERIT'),[value,setValue]=useState(0);
 const [low,setLow]=useState<FbsSafetyReserveRule['lowStock']>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const u=session.user;const allowed=!u.isDemo&&(u.roleCodes.includes('CLIENT') ? u.permissionCodes.includes('stock:read')&&u.clientIds.includes(clientId)&&u.writableClientIds.includes(clientId) : u.permissionCodes.includes('system:admin'));
 async function load(){setBusy(true);setError('');try{const result=await fetchFbsProductReserve(session.accessToken,clientId,connectionId,skuId);if(!alive.current)return;setRow(result.row);setMode(result.row.reserveOverride?.mode??'INHERIT');setValue(result.row.reserveOverride?.value??0);setLow(result.row.reserveOverride?.lowStock);}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Не удалось загрузить резерв.')}finally{if(alive.current)setBusy(false)}}
 async function save(){if(!row||busy)return;setBusy(true);setError('');setMessage('');try{await saveFbsProductReserve(session.accessToken,clientId,row,mode==='INHERIT'?null:{mode:mode as FbsSafetyReserveRule['mode'],value:mode==='NONE'?0:value,...(mode!=='NONE'&&low?{lowStock:low}:{})});if(!alive.current)return;await onSaved();if(!alive.current)return;await load();if(alive.current)setMessage('Резерв сохранён. Для увеличения остатка WB нажмите «Обновить продажу».');}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Не удалось сохранить резерв.')}finally{if(alive.current)setBusy(false)}}
 if(!allowed||!connectionId)return null;
 return <details className="fbs-product-reserve" onToggle={e=>{if(e.currentTarget.open&&!row&&!busy)void load()}}>
  <summary aria-label={`Страховой резерв товара ${skuId}`}>Страховой резерв товара</summary>
  {busy&&!row?<p>Загружаю настройку…</p>:row?<div>
   <label>Резерв товара<select aria-label="Резерв товара" value={mode} disabled={busy} onChange={e=>setMode(e.target.value)}>
    <option value="INHERIT">Как у клиента</option><option value="NONE">Без резерва</option><option value="UNITS">В штуках</option><option value="PERCENT">В процентах</option>
   </select></label>
   {(mode==='UNITS'||mode==='PERCENT')&&<label>Величина резерва<input aria-label="Величина резерва" type="number" min={0} max={mode==='PERCENT'?100:1000000} step={1} value={value} disabled={busy} onChange={e=>setValue(Number(e.target.value))}/></label>}
   {(mode==='UNITS'||mode==='PERCENT')&&<><label><input type="checkbox" checked={!!low} disabled={busy} onChange={e=>setLow(e.target.checked?{threshold:5,reserveUnits:1}:undefined)}/>Отдельный резерв при малом остатке</label>{low&&<><label>При остатке меньше<input type="number" min={1} step={1} value={low.threshold} disabled={busy} onChange={e=>setLow({...low,threshold:Number(e.target.value)})}/></label><label>Оставлять, шт.<input type="number" min={0} step={1} value={low.reserveUnits} disabled={busy} onChange={e=>setLow({...low,reserveUnits:Number(e.target.value)})}/></label></>}</>}
   <button type="button" disabled={busy||!validProductReserve(mode,mode==='NONE'||mode==='INHERIT'?0:value,mode==='NONE'||mode==='INHERIT'?undefined:low)} onClick={()=>void save()}>Сохранить резерв товара</button>
  </div>:null}
  {error&&<p role="alert">{error} <button type="button" disabled={busy} onClick={()=>void load()}>Повторить загрузку</button></p>}
  {message&&<p role="status">{message}</p>}
 </details>;
}
