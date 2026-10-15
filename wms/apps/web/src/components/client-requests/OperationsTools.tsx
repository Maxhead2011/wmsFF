import { useEffect, useRef, useState } from 'react';
import type { ClientRequestSummary } from '../../lib/api';

type Row = {kind:string;id:string;label:string;detail:string};
type Check = {id:string;number:number;title:string;steps:Array<{key:string;label:string;state:string;detail:string}>};
type Case = {key:string;requestId:string;number:number;label:string;reasonCode:string|null;assignedToName:string|null;assignedToId:string|null;nextAttemptAt:string};
const reasons:Record<string,string>={MISSING_WAREHOUSE:'Не определён филиал',MISSING_PHYSICAL_EVIDENCE:'Не подтверждено физическое списание',PACKING_SHORTAGE:'Не сходится остаток упаковки',REVIEW_REQUIRED:'Требуется проверка'};
const base=import.meta.env.VITE_API_URL??'/api/v1';

// FIX: no polling or stock recalculation; each tool reads only on explicit action.
export function OperationsTools({token,userId,permissions,onOpen}:{token:string;userId:string;permissions:string[];onOpen?:(r:ClientRequestSummary)=>void}) {
 const [enabled,setEnabled]=useState(false),[tab,setTab]=useState('readiness'),[query,setQuery]=useState('');
 const [rows,setRows]=useState<Row[]>([]),[check,setCheck]=useState<Check|null>(null),[cases,setCases]=useState<Case[]>([]);
 const [box,setBox]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[searched,setSearched]=useState(false),[truncated,setTruncated]=useState(false);
 const epoch=useRef(0);
 const allow=(p:string)=>permissions.includes('system:admin')||permissions.includes(p);
 async function api(path:string,method='GET') {
  const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(typeof body?.message==='string'?body.message:`Не удалось загрузить данные (${response.status}).`);}
  return response.json();
 }
 useEffect(()=>{let active=true;epoch.current++;setEnabled(false);setRows([]);setCheck(null);setCases([]);setBox(null);setError('');setBusy(false);setSearched(false);
  if(allow('client-requests:read'))void api('/operations-tools/capabilities').then(()=>{if(active)setEnabled(true);}).catch(()=>{});
  return()=>{active=false;epoch.current++;};
 },[token,userId]);
 async function act(work:()=>Promise<void>){const n=epoch.current;setBusy(true);setError('');try{await work();}catch(e){if(n===epoch.current)setError(e instanceof Error?e.message:'Ошибка загрузки.');}finally{if(n===epoch.current)setBusy(false);}}
 async function readiness(id:string){const n=epoch.current;const data=await api('/operations-tools/readiness/'+encodeURIComponent(id));if(n===epoch.current){setCheck(data);setBox(null);}}
 async function search(){const n=epoch.current;const data=await api('/operations-tools/'+(tab==='readiness'?'requests':'search')+'?q='+encodeURIComponent(query));if(n!==epoch.current)return;
  setRows(tab==='readiness'?data.rows.filter((r:Row)=>r.kind==='request'):data.rows);setTruncated(data.truncated);setSearched(true);setCheck(null);setBox(null);
  if(tab==='readiness'&&data.rows.filter((r:Row)=>r.kind==='request').length===1)await readiness(data.rows.find((r:Row)=>r.kind==='request').id);
 }
 async function attention(){const n=epoch.current;const data=await api('/operations-tools/attention');if(n===epoch.current){setCases(data);setSearched(true);}}
 async function open(id:string){const n=epoch.current;const data=await api('/client-requests/'+encodeURIComponent(id));if(n===epoch.current)onOpen?.(data);}
 if(!enabled)return null;
 return <details className="operations-tools" style={{border:'1px solid var(--border-color, #d8dfe5)',borderRadius:14,padding:16,marginBottom:16}}>
  <summary style={{fontWeight:700,cursor:'pointer'}}>Проверки и поиск</summary>
  <div role="tablist" aria-label="Инструменты заявок" style={{display:'flex',flexWrap:'wrap',gap:8,margin:'12px 0'}}>
   {[['readiness','Готовность заявки'],['search','Точный поиск'],['attention','Требует внимания']].map(([id,label])=><button type="button" role="tab" aria-selected={tab===id} key={id} disabled={busy||(id==='search'&&!allow('stock:read'))} onClick={()=>{setTab(id);setRows([]);setCheck(null);setBox(null);setSearched(false);setError('');}}>{label}</button>)}
  </div>
  {tab!=='attention'?<form onSubmit={e=>{e.preventDefault();void act(search);}} style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   <label style={{flex:'1 1 240px'}}>{tab==='readiness'?'Номер заявки':'Точный номер заявки, короба, палеты, ШК или КИЗ'}<input value={query} onChange={e=>setQuery(e.target.value)} maxLength={512} style={{width:'100%'}}/></label>
   <button disabled={busy||!query.trim()||(tab==='search'&&!allow('stock:read'))}>Проверить</button>
  </form>:<><p>Случаи фоновой сверки. Исправление выполняется через существующий экран заявки с обычными проверками.</p><button type="button" disabled={busy} onClick={()=>void act(attention)}>Обновить список</button></>}
  {busy&&<p role="status">Загрузка…</p>}{error&&<p role="alert">{error}</p>}
  {!busy&&searched&&!error&&((tab==='attention'&&!cases.length)||(tab!=='attention'&&!rows.length))&&<p>По выбранным условиям ничего не найдено.</p>}
  {truncated&&tab!=='attention'&&<p>Показаны первые 20 результатов каждого типа. Уточните идентификатор.</p>}
  {rows.map(r=><div key={r.kind+':'+r.id} style={{padding:'10px 0',borderBottom:'1px solid #d8dfe5'}}><strong>{r.label}</strong><p>{r.detail}</p>
   {r.kind==='request'&&<button disabled={busy} onClick={()=>void act(()=>readiness(r.id))}>Готовность</button>}
   {r.kind==='request'&&onOpen&&<button disabled={busy} onClick={()=>void act(()=>open(r.id))}>Онлайн-выполнение</button>}
   {r.kind==='box'&&<button disabled={busy} onClick={()=>void act(async()=>{const n=epoch.current;const value=await api('/operations-tools/boxes/'+encodeURIComponent(r.id));if(n===epoch.current){setBox(value);setCheck(null);}})}>Доступность и история</button>}
  </div>)}
  {check&&<section aria-label="Готовность заявки"><h3>№{check.number} · {check.title}</h3>{check.steps.map(s=><p key={s.key}><strong>{s.state==='complete'?'✓':s.state==='pending'?'○':'—'} {s.label}</strong> · {s.detail}</p>)}<p>Сведения из WMS на момент проверки. Статус маркетплейса здесь не обновляется.</p></section>}
  {box&&<section aria-label="Доступность короба"><h3>{box.code}</h3><p>Приёмка: {box.receiptApproved?'доступна':'на согласовании'} · ФБС: {box.fbsAllowed?'разрешено':'недоступно'} · ФБО: {box.fboAllowed?'разрешено':'недоступно'}</p><p>Палета: {box.pallet??'не указана'} · Зона: {box.zone??'не указана'}</p><h4>Задания ФБС (до 30)</h4>{box.tasks.map((t:any,i:number)=><p key={i}>{t.orderId} · {t.itemCount} шт. · {t.status}</p>)}<h4>Последние движения (до 30)</h4>{box.history.map((h:any,i:number)=><p key={i}>{new Date(h.createdAt).toLocaleString('ru')} · {h.type} · {h.quantity} шт. · {h.status}</p>)}</section>}
  {tab==='attention'&&cases.map(c=><article key={c.key} style={{padding:'12px 0',borderBottom:'1px solid #d8dfe5'}}><strong>№{c.number} · {c.label}</strong><p>{c.reasonCode?reasons[c.reasonCode]??'Требуется проверка':'Ожидает сверки'} · Ответственный: {c.assignedToName??'не назначен'}</p><p>Повторная проверка не раньше {new Date(c.nextAttemptAt).toLocaleString('ru')}</p>
   {allow('client-requests:write')&&!c.assignedToId&&<button disabled={busy} onClick={()=>void act(async()=>{const n=epoch.current;await api('/operations-tools/attention/'+encodeURIComponent(c.key)+'/take','POST');if(n===epoch.current)await attention();})}>Взять в работу</button>}
   {onOpen&&<button disabled={busy} onClick={()=>void act(()=>open(c.requestId))}>Открыть заявку</button>}
  </article>)}
  {tab==='attention'&&cases.length===100&&<p>Показаны первые 100 случаев.</p>}
 </details>;
}
