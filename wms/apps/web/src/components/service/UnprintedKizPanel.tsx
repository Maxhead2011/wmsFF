import { useRef, useState } from 'react';
import { checkUnprintedKiz, createUnprintedKizSearch, kizSearchAssignees, type UnprintedKizReport } from '../../lib/unprintedKiz';

const printLabel=(value:string)=>value.split(', ').map(s=>({QUEUED:'В очереди',CLAIMED:'Передано принтеру',FAILED:'Ошибка печати',PRINTED:'Напечатано'}[s]??s)).join(', ');
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
const dateTime=(value:string)=>new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'});
// FIX: mounted with a client/warehouse key; a previous client's rows cannot be submitted.
export function UnprintedKizPanel({accessToken,clientId,warehouseId}:{accessToken:string;clientId:string;warehouseId:string}) {
  const [dateFrom,setFrom]=useState(today),[dateTo,setTo]=useState(today);
  const [report,setReport]=useState<UnprintedKizReport|null>(null);
  const [assignees,setAssignees]=useState<Array<{id:string;name:string}>>([]),[assignee,setAssignee]=useState('');
  const [selected,setSelected]=useState<string[]>([]),[worker,setWorker]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const operation=useRef<{signature:string;id:string}|null>(null);
  const filter={clientId,warehouseId,dateFrom,dateTo};
  const visible=(report?.rows??[]).filter(r=>!worker||r.workerName===worker);
  const selectable=visible.filter(r=>!r.blockedReason);
  async function check() {
    setBusy(true);setError('');setMessage('');setReport(null);setSelected([]);operation.current=null;
    try {
      const [data,people]=await Promise.all([checkUnprintedKiz(accessToken,filter),kizSearchAssignees(accessToken,filter)]);
      setReport(data);setAssignees(people);setAssignee(current=>people.some(p=>p.id===current)?current:people[0]?.id??'');setWorker('');
    } catch(e) {setError(e instanceof Error?e.message:'Не удалось проверить КИЗ.');}
    finally {setBusy(false);}
  }
  async function create() {
    setBusy(true);setError('');setMessage('');
    const signature=JSON.stringify({...filter,assignedToUserId:assignee,scanIds:[...selected].sort()});
    if(operation.current?.signature!==signature) operation.current={signature,id:crypto.randomUUID()};
    try {
      const result=await createUnprintedKizSearch(accessToken,{...filter,scanIds:selected,assignedToUserId:assignee,operationId:operation.current.id});
      setMessage(`Создана заявка поиска №${result.number}. Сотрудник увидит её в «Поиск КИЗ» на ТСД.`);
      setReport(current=>current?{...current,rows:current.rows.map(r=>selected.includes(r.id)?{...r,searchRequestNumber:result.number,blockedReason:`Уже в заявке поиска №${result.number}`}:r)}:current);
      setSelected([]);operation.current=null;
    } catch(e) {setError(e instanceof Error?e.message:'Не удалось создать заявку. Повторите действие — повторная заявка не создастся.');}
    finally {setBusy(false);}
  }
  function dates(value:string,which:'from'|'to') {which==='from'?setFrom(value):setTo(value);setReport(null);setSelected([]);setMessage('');operation.current=null;}
  return <section className="service-card unprinted-kiz-panel">
    <h3>Поиск неотгруженных КИЗ</h3>
    <p>КИЗ, отсканированные за выбранный период, без подтверждённой печати этикетки через SOS WB 2. Даты и время — московские. Отсутствие печати само по себе не подтверждает наличие товара на складе.</p>
    {!clientId||!warehouseId?<p role="status">Выберите клиента и рабочий филиал.</p>:null}
    <div className="service-search-row">
      <label>С <input type="date" aria-label="Период с" value={dateFrom} disabled={busy} onChange={e=>dates(e.target.value,'from')}/></label>
      <label>По <input type="date" aria-label="Период по" value={dateTo} disabled={busy} onChange={e=>dates(e.target.value,'to')}/></label>
      <button type="button" className="primary-button" disabled={busy||!clientId||!warehouseId||!dateFrom||!dateTo} onClick={()=>void check()}>{busy?'Выполняется…':'Проверить неотгруженные КИЗ'}</button>
    </div>
    {error?<p className="service-message service-message--error" role="alert">{error}</p>:null}
    {message?<p className="service-message" role="status">{message}</p>:null}
    {report?<>
      <p>Без подтверждённой печати: {report.rows.length}. Проверено: {dateTime(report.checkedAt)}.</p>
      <div className="service-search-row">
        <label>Кто сканировал <select value={worker} disabled={busy} onChange={e=>{setWorker(e.target.value);setSelected([]);}}><option value="">Все сотрудники</option>{[...new Set(report.rows.map(r=>r.workerName))].map(w=><option key={w}>{w}</option>)}</select></label>
        <label>Кому поручить поиск <select aria-label="Исполнитель поиска" value={assignee} disabled={busy} onChange={e=>setAssignee(e.target.value)}><option value="">Выберите сотрудника</option>{assignees.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <button type="button" className="primary-button" disabled={busy||!assignee||selected.length===0||selected.length>500} onClick={()=>void create()}>Создать заявку на поиск ({selected.length})</button>
      </div>
      {!assignees.length?<p>Нет сотрудников с доступом к поиску в этом филиале.</p>:null}
      <div className="unprinted-kiz-table"><table className="data-table service-table service-table--wide">
        <thead><tr><th><input type="checkbox" aria-label="Выбрать все доступные" disabled={busy||!selectable.length} checked={selectable.length>0&&selectable.every(r=>selected.includes(r.id))} onChange={e=>setSelected(e.target.checked?selectable.map(r=>r.id):[])}/></th><th>Когда / кто</th><th>КИЗ / товар</th><th>Заявка / заказ WB</th><th>Из короба</th><th>Печать / поиск</th></tr></thead>
        <tbody>{visible.map(r=><tr key={r.id}><td><input type="checkbox" aria-label={`Выбрать заказ ${r.orderId}`} disabled={busy||!!r.blockedReason} checked={selected.includes(r.id)} onChange={e=>setSelected(current=>e.target.checked?[...current,r.id]:current.filter(id=>id!==r.id))}/></td><td>{dateTime(r.scannedAt)}<br/>{r.workerName}</td><td><code>{r.kiz}</code><br/>{r.productName}<br/>{r.barcode}</td><td>№{r.requestNumber}<br/>{r.orderId}</td><td>{r.boxCode}</td><td>{printLabel(r.printState)}<br/>{r.blockedReason||'Можно включить в поиск'}</td></tr>)}</tbody>
      </table></div>
      {!visible.length?<p role="status">За выбранный период подходящих сканирований нет.</p>:null}
    </>:null}
  </section>;
}
