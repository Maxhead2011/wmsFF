import {useEffect,useState} from 'react';
import {LamodaBatchFields,batchKeys} from '../lamoda/LamodaBatchFields';
import type {LamodaBatchData,LamodaLabelDraft} from '../../lib/lamodaLabelPrint';
type View={enabled:boolean;saved:boolean;locked:boolean;drafts:LamodaLabelDraft[]};
export function LamodaRelabelDataForm({requestId,token,disabled,onReady,onSaved}:{requestId:string;token:string;disabled:boolean;onReady:(ready:boolean)=>void;onSaved:()=>Promise<void>}){
 const [view,setView]=useState<View|null>(null),[values,setValues]=useState<Record<string,LamodaBatchData>>({}),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const url='/api/v1/tsd/requests/'+encodeURIComponent(requestId)+'/fbo/lamoda-relabel/data';
 async function read(response:Response){const value=await response.json();if(!response.ok)throw new Error(Array.isArray(value.message)?value.message.join('; '):value.message||'Не удалось получить данные переклейки.');return value as View;}
 function accept(v:View){setView(v);setValues(Object.fromEntries(v.drafts.map(d=>[d.skuId,{skuId:d.skuId,composition:d.composition,manufacturer:d.manufacturer,origin:d.origin,manufacturedAt:d.manufacturedAt}])));setConfirmed(v.saved);onReady(!v.enabled||v.saved);}
 useEffect(()=>{let active=true;onReady(false);setView(null);setError('');fetch(url,{headers:{Authorization:`Bearer ${token}`}}).then(read).then(v=>{if(active)accept(v)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[url,token]);
 async function save(){setBusy(true);setError('');try{const result=await read(await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({confirmed,labelData:view!.drafts.map(d=>values[d.skuId])})}));accept(result);await onSaved();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 if(view&&!view.enabled)return null;
 return <section aria-label="Данные для переклейки Lamoda">{error&&<p role="alert">{error}</p>}{!view&&!error&&<p>Загружаю данные стикеров…</p>}
 {view&&<><LamodaBatchFields drafts={view.drafts} values={values} onChange={v=>{setValues(v);onReady(false)}} confirmed={confirmed} onConfirm={v=>{setConfirmed(v);if(!v)onReady(false)}} disabled={disabled||busy||view.locked}/>
 {view.locked?<p>Данные закреплены за напечатанными этикетками этой заявки.</p>:<button type="button" className="primary-button" disabled={disabled||busy||!confirmed||!view.drafts.every(d=>batchKeys.every(k=>values[d.skuId]?.[k]?.trim()))} onClick={()=>void save()}>{busy?'Сохраняю…':'Сохранить данные для переклейки'}</button>}
 {view.saved&&confirmed&&<p>Данные переклейки сохранены для этой заявки.</p>}</>}
 </section>;
}
