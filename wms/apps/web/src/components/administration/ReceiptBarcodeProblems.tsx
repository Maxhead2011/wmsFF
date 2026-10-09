import './receipt-barcode-problems.css';
import { useEffect, useRef, useState } from 'react';
import { fetchReceiptBarcodeProblems, resolveReceiptBarcodeProblem, type AuthSession, type ReceiptBarcodeProblem } from '../../lib/api';

export function ReceiptBarcodeProblems({session, onCount}: {session: AuthSession; onCount?: (value: number) => void}) {
  const [items,setItems]=useState<ReceiptBarcodeProblem[]>([]),[pending,setPending]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<string|null>(null),[action,setAction]=useState<'CONFIRM'|'CORRECT'|'REJECT'>('CONFIRM'),[barcode,setBarcode]=useState(''),[comment,setComment]=useState(''),[confirmed,setConfirmed]=useState(false);
  const inFlight=useRef(false);
  async function load(){const data=await fetchReceiptBarcodeProblems(session.accessToken);setItems(data.items);setPending(data.pending);onCount?.(data.pending);}
  async function run(task:()=>Promise<void>){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{await task();}catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить действие');}finally{inFlight.current=false;setBusy(false);}}
  useEffect(()=>{setItems([]);setSelected(null);void run(load);},[session.accessToken,session.user.activeWarehouseId]);
  const item=items.find(i=>i.id===selected);
  return <section className="admin-section receipt-barcode-problems"><h2>Проблемы приёмки</h2><h3>Подозрительные ШК · ожидают проверки: {pending}</h3>
    <p>Позиции на проверке не доступны для заказов. Проверьте этикетку и фактический товар в указанном коробе. Показаны ожидающие обращения и решения за последние 7 дней.</p>
    {error&&<p role="alert">{error}</p>}<button className="admin-button" disabled={busy} onClick={()=>void run(load)}>Обновить</button>
    {!error&&!busy&&!items.length&&<p>Обращений нет.</p>}
    {pending>200&&<p>Показаны первые 200 обращений. После обработки появятся следующие.</p>}
    {items.map(i=><article key={i.id} className="admin-card"><strong>{i.client?.name||i.payload.clientId} · {i.payload.boxCode||'Без короба'}</strong>
      <p>Приёмка: {i.payload.sourceDocument||'Не указана'} · Количество: {i.payload.quantity} шт.</p>
      <p>Первый скан: <code>{i.payload.firstBarcodeScan||i.payload.barcode}</code> · Повторный: <code>{i.payload.secondBarcodeScan||'Не передан старой версией ТСД'}</code></p>
      <p>{i.payload.barcodeReviewReason} · {i.payload.actorName||i.deviceId} · {new Date(i.payload.originalScannedAt||i.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК</p>
      <p>{i.status==='NEEDS_REVIEW'?'Ожидает проверки':i.resolutionMessage}</p>
      {i.reviewedBy&&<p>Решил: {i.reviewedBy.name} · {i.reviewComment}</p>}
      {i.status==='NEEDS_REVIEW'&&<button className="admin-button" disabled={busy} onClick={()=>{setSelected(i.id);setAction('CONFIRM');setBarcode('');setComment('');setConfirmed(false);}}>Разобрать</button>}
    </article>)}
    {item&&<form className="admin-card" onSubmit={e=>{e.preventDefault();if(!confirmed||!comment.trim())return;void run(async()=>{await resolveReceiptBarcodeProblem(session.accessToken,item.id,{action,barcode:action==='CORRECT'?barcode:undefined,comment});setSelected(null);await load();});}}>
      <h3>Решение по коробу {item.payload.boxCode||'Без короба'} · ШК {item.payload.barcode}</h3>
      <fieldset disabled={busy}><label>Действие <select value={action} onChange={e=>{setAction(e.target.value as typeof action);setConfirmed(false);}}>
        <option value="CONFIRM">Подтвердить ШК и принять</option><option value="CORRECT">Исправить ШК — существующая карточка</option><option value="REJECT">Отклонить ошибочный скан</option></select></label>
        {action==='CORRECT'&&<label>Правильный ШК товара <input required value={barcode} onChange={e=>{setBarcode(e.target.value);setConfirmed(false);}}/></label>}
        <label>Основание решения <textarea required maxLength={2000} value={comment} onChange={e=>setComment(e.target.value)}/></label>
        <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Проверены этикетка, короб и физическое количество</label>
        <button className="admin-button" disabled={!confirmed||!comment.trim()}>Подтвердить решение</button><button className="admin-button" type="button" onClick={()=>setSelected(null)}>Отмена</button>
      </fieldset></form>}
  </section>;
}
