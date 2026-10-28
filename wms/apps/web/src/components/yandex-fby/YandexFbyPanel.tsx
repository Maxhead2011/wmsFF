import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { updateClientRequestStatus, cancelClientRequest, fetchClients, fetchFbyAccounts, fetchFbyWarehouses, fetchFbyRequests, previewFby, createFby, bindFby, refreshFby, parseFbyFile, downloadFbyTemplate, fetchFboPlan,
  type AuthSession, type ClientSummary, type FbyAccount, type FbyRequest, type FbyPreview, type FbyInput, type FboPlan } from '../../lib/api';
import { FboProgress } from '../client-requests/FboProgress';
import './yandex-fby.css';

export function YandexFbyPanel({session}:{session:AuthSession}) {
 const token=session.accessToken, epoch=useRef(0);
 const writable=!session.user.isDemo&&session.user.permissionCodes.some(p=>p==='system:admin'||p==='client-requests:write');
 const [clients,setClients]=useState<ClientSummary[]>([]),[clientId,setClientId]=useState('');
 const [accounts,setAccounts]=useState<FbyAccount[]>([]),[accountId,setAccountId]=useState('');
 const [warehouses,setWarehouses]=useState<{id:string;name:string}[]>([]),[warehouseId,setWarehouseId]=useState('');
 const [rows,setRows]=useState<FbyRequest[]>([]),[view,setView]=useState('active'),[revision,setRevision]=useState(0);
 const [mode,setMode]=useState('remote'),[reference,setReference]=useState(''),[text,setText]=useState(''),[destination,setDestination]=useState(''),[title,setTitle]=useState('');
 const [mappings,setMappings]=useState<Record<string,string>>({}),[preview,setPreview]=useState<FbyPreview|null>(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const [binding,setBinding]=useState<FbyRequest|null>(null),[plan,setPlan]=useState<FboPlan|null>(null);
 const [confirmation,setConfirmation]=useState<{request:FbyRequest;action:'DONE'|'CANCELLED'}|null>(null);
 const [key,setKey]=useState(()=>crypto.randomUUID());
 useEffect(()=>{let active=true;fetchClients(token).then(v=>{if(active)setClients(v)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[token]);
 useEffect(()=>{let active=true;epoch.current++;setAccounts([]);setAccountId('');setRows([]);setPreview(null);setBinding(null);setPlan(null);setConfirmation(null);setBusy(false);
  if(clientId)fetchFbyAccounts(token,clientId).then(v=>{if(active){setAccounts(v);setAccountId(v[0]?.id??'')}}).catch(e=>{if(active)setError(e.message)});
  return()=>{active=false};},[token,clientId]);
 useEffect(()=>{let active=true;epoch.current++;setPreview(null);setBinding(null);setPlan(null);setConfirmation(null);setMappings({});setReference('');setText('');setKey(crypto.randomUUID());setWarehouseId('');setWarehouses([]);setBusy(false);
  if(accountId)fetchFbyWarehouses(token,accountId).then(v=>{if(active){setWarehouses(v);setWarehouseId(v.find(w=>w.id===session.user.activeWarehouseId)?.id??v[0]?.id??'')}}).catch(e=>{if(active)setError(e.message)});
  return()=>{active=false};},[token,accountId,session.user.activeWarehouseId]);
 useEffect(()=>{let active=true;setRows([]);if(!accountId)return;setLoading(true);
  fetchFbyRequests(token,accountId,view).then(v=>{if(active)setRows(v)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false};},[token,accountId,view,revision]);
 useEffect(()=>{setPreview(null)},[mode,reference,text,destination,title,warehouseId]);
 async function run<T>(action:()=>Promise<T>,done:(result:T)=>void){const generation=epoch.current;setBusy(true);setError('');setNotice('');try{const result=await action();if(generation===epoch.current)done(result)}catch(e){if(generation===epoch.current)setError(e instanceof Error?e.message:'Не удалось выполнить действие.')}finally{if(generation===epoch.current)setBusy(false)}}
 function input():FbyInput {
  const items=mode==='local'?text.split(/\r?\n/).filter(s=>s.trim()).map((s,i)=>{const values=s.split(/[;\t]/);if(values.length!==2||!values[0].trim()||!/^\d+$/.test(values[1].trim()))throw new Error(`Строка ${i+1}: укажите ШК; количество.`);return{barcode:values[0].trim(),quantity:Number(values[1])}}):undefined;
  return {warehouseId,title,destination,...(mode==='remote'?{reference,mappings:Object.entries(mappings).filter(([,barcode])=>barcode.trim()).map(([offerId,barcode])=>({offerId,barcode:barcode.trim()}))}:{items})};
 }
 const disabled=busy||!writable||!accountId;
 return <section className="yandex-fby" aria-label="Поставки Яндекс Маркет FBY">
  <h2>Яндекс Маркет · FBY</h2>
  <div className="fby-selectors"><label>Клиент<select disabled={busy} value={clientId} onChange={e=>setClientId(e.target.value)}><option value="">Выберите клиента</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
  <label>Кабинет<select disabled={busy} value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Выберите кабинет</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.client.name} · {a.accountName||'Яндекс'} · {a.sellerId}</option>)}</select></label></div>
  {clientId&&!accounts.length&&<p>Нужен активный кабинет Яндекса в настройках клиента с доступом к поставкам FBY.</p>}
  {error&&<p role="alert" className="error-message">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {confirmation&&createPortal(<ConfirmDialog title={confirmation.action==='DONE'?'Подтвердить сдачу':'Отменить сборку'} message={`Сборка №${confirmation.request.number}`} isBusy={busy} onCancel={()=>setConfirmation(null)} onConfirm={()=>void run(()=>confirmation.action==='DONE'?updateClientRequestStatus(token,confirmation.request.id,{status:'DONE'}):cancelClientRequest(token,confirmation.request.id),()=>{setConfirmation(null);setRevision(v=>v+1);setNotice('Статус сборки сохранён.')})}/>,document.body)}
  <div className="fby-columns"><section className="fby-card"><h3>{binding?`Привязать поставку к сборке №${binding.number}`:'Создать сборку'}</h3>
   <div className="fby-actions">{[['remote','Из кабинета Яндекса'],['local','Excel / вручную']].map(([v,label])=><button className="icon-text-button" disabled={disabled||!!binding} aria-pressed={mode===v} key={v} onClick={()=>setMode(v)}>{label}</button>)}</div>
   <fieldset disabled={disabled}>
    <label>Филиал<select disabled={!!binding} value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}><option value="">Выберите филиал</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
    {mode==='remote'?<label>Номер или ссылка на поставку<input value={reference} onChange={e=>{setReference(e.target.value);setMappings({})}} placeholder="Номер из кабинета Яндекс Маркета"/></label>:<>
     <label>Название сборки<input value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Место отгрузки<input value={destination} onChange={e=>setDestination(e.target.value)}/></label>
     <div className="fby-actions"><label className="icon-text-button">Выбрать Excel<input type="file" accept=".xlsx,.xls" onChange={e=>{const f=e.target.files?.[0];if(f)void run(()=>parseFbyFile(token,accountId,f),v=>setText(v.map(r=>`${r.barcode}; ${r.quantity}`).join('\n')));e.target.value=''}}/></label>
     <button className="icon-text-button" onClick={()=>void run(()=>downloadFbyTemplate(token,accountId),blob=>{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Yandex-FBY.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)})}>Скачать шаблон</button></div>
     <label>Товары — ШК; количество<textarea rows={6} value={text} onChange={e=>setText(e.target.value)} placeholder={'04600000000000; 10\n04600000000001; 5'}/></label>
    </>}
    <button className="icon-text-button" onClick={()=>void run(()=>previewFby(token,accountId,input()),setPreview)}>Проверить состав и остатки</button>
   </fieldset>
   {preview&&<><p>{preview.destination||'Место отгрузки не задано'}{preview.desiredDate?' · '+new Date(preview.desiredDate).toLocaleString('ru-RU'):''}</p>
    <div className="fby-table"><table><thead><tr><th>Товар / артикул Яндекса</th><th>ШК ВМС</th><th>Нужно</th><th>Доступно / резерв</th></tr></thead><tbody>{preview.lines.map((l,i)=>{const stock=preview.availability?.lines.find(a=>a.barcode===l.barcode);return <tr key={l.offerId??i}><td>{l.name} {l.size}<small>{l.offerId}</small></td><td>{l.offerId?<input aria-label={`ШК ${l.offerId}`} disabled={disabled} value={mappings[l.offerId]??l.barcode} onChange={e=>{const value=e.target.value;setMappings(m=>({...m,[l.offerId!]:value}));setPreview(p=>p?{...p,canCreate:false,previewHash:""}:null)}}/>:l.barcode}{!l.resolved&&<small>Укажите ШК товара этого клиента</small>}</td><td>{l.quantity}</td><td>{stock?`${stock.availableQuantity} / ${stock.reservedQuantity}`:'—'}</td></tr>})}</tbody></table></div>
    {!preview.canCreate&&<p>Для создания проверьте сопоставления, место отгрузки и свободные остатки.</p>}
    <button className="icon-text-button" disabled={disabled||!preview.previewHash||(!binding&&!preview.canCreate)||preview.lines.some(l=>!l.resolved)} onClick={()=>void run(()=>binding?bindFby(token,accountId,binding.id,{...input(),previewHash:preview.previewHash}):createFby(token,accountId,{...input(),previewHash:preview.previewHash,idempotencyKey:key}),()=>{setNotice(binding?'Поставка привязана.':'Сборка создана.');setRevision(v=>v+1);setPreview(null);setBinding(null);setKey(crypto.randomUUID())})}>{binding?'Привязать поставку':'Создать сборку'}</button>
   </>}
   {binding&&<button className="icon-text-button" onClick={()=>{setBinding(null);setPreview(null)}}>Отменить привязку</button>}
   {plan&&<section><h3>Выполнение сборки</h3><FboProgress plan={plan} accessToken={token}/><button className="icon-text-button" onClick={()=>setPlan(null)}>Закрыть</button></section>}
  </section><section className="fby-card"><h3>Сборки FBY</h3><div className="fby-actions"><button className="icon-text-button" aria-pressed={view==='active'} onClick={()=>setView('active')}>Активные</button><button className="icon-text-button" aria-pressed={view==='closed'} onClick={()=>setView('closed')}>Завершённые</button><button className="icon-text-button" onClick={()=>setRevision(v=>v+1)}>Обновить</button></div>
   {loading&&<p>Загружаю…</p>}{!loading&&!rows.length&&<p>Сборок нет.</p>}{rows.map(r=><article className="fby-request" key={r.id}><strong>№{r.number} · {r.title}</strong><p>{r.items.reduce((s,i)=>s+i.quantity,0)} шт. · {r.destinationCity}</p><p>{r.status} · {r.yandexFbyShipment.remoteNumber?`Яндекс №${r.yandexFbyShipment.remoteNumber}`:'Поставка ещё не привязана'}</p><div className="fby-actions">
    <button className="icon-text-button" disabled={busy} onClick={()=>void run(()=>fetchFboPlan(token,r.id),setPlan)}>Выполнение</button>
    {r.yandexFbyShipment.remoteNumber?<button className="icon-text-button" disabled={busy} onClick={()=>void run(()=>refreshFby(token,accountId,r.id),v=>setNotice(`${v.status}. ${v.matches?'Состав совпадает.':'Есть расхождения: '+v.differences.map(d=>`${d.offerId}: сборка ${d.assemblyQuantity}, Яндекс ${d.yandexQuantity}`).join('; ')} Состав сборки сохранён.`))}>Сверить с Яндексом</button>:view==='active'&&<button className="icon-text-button" disabled={disabled} onClick={()=>{setBinding(r);setWarehouseId(r.warehouseId);setMode('remote');setPreview(null);setReference('');setMappings({})}}>Привязать поставку</button>}
    {r.status==='PACKED'&&writable&&<button className="icon-text-button" disabled={busy} onClick={()=>setConfirmation({request:r,action:'DONE'})}>Отметить сданной</button>}
    {r.status==='SUBMITTED'&&writable&&<button className="icon-text-button" disabled={busy} onClick={()=>setConfirmation({request:r,action:'CANCELLED'})}>Отменить сборку</button>}
   </div></article>)}{rows.length===200&&<p>Показаны последние 200 сборок.</p>}
  </section></div>
 </section>;
}
