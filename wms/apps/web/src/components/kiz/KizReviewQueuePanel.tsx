import {useCallback,useEffect,useRef,useState} from 'react';
import {decideKizReview,fetchKizReviewQueue,type AuthSession,type KizReviewCase} from '../../lib/api';

export function KizReviewQueuePanel({session,onInspect}:{session:AuthSession;onInspect:(kiz:string)=>void}) {
  const [items,setItems]=useState<KizReviewCase[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true);
  const [selected,setSelected]=useState<{row:KizReviewCase;resolution:'REUSE'|'RELABEL'}|null>(null);
  const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[saving,setSaving]=useState(false);
  const live=useRef(true),lock=useRef(false),generation=useRef(0);
  const load=useCallback(async(next?:string)=>{
    const current=++generation.current;
    try {const response=await fetchKizReviewQueue(session.accessToken,next);
      if(!live.current||current!==generation.current)return;
      setItems(previous=>next?[...previous,...response.items.filter(r=>!previous.some(p=>p.id===r.id))]:response.items);
      setCursor(response.nextCursor);setError('');
    }catch(e){if(live.current&&current===generation.current)setError(e instanceof Error?e.message:'Не удалось загрузить обращения.');}
    finally{if(live.current&&current===generation.current)setLoading(false);}
  },[session.accessToken]);
  useEffect(()=>{live.current=true;void load();return()=>{live.current=false;generation.current++;};},[load]);
  useEffect(()=>{if(selected)return;const timer=window.setInterval(()=>{if(!document.hidden&&!lock.current)void load();},30000);return()=>window.clearInterval(timer);},[load,selected]);
  return <section className="kiz-queue">
    <h3>Обращения сборщиков</h3>
    <p>Проблемные КИЗы поступают сюда автоматически. Решение действует только для указанного задания.</p>
    <button type="button" disabled={saving} onClick={()=>void load()}>Обновить обращения</button>
    {loading&&<p>Загружаю обращения…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!loading&&!error&&!items.length&&<p>Обращений на проверку нет.</p>}
    {items.map(row=><KizReviewCard key={row.id} row={row} disabled={saving} onInspect={()=>onInspect(row.kizIdentity)}
      onDecision={resolution=>{setSelected({row,resolution});setReason('');setConfirmed(false);setNotice('');}}/>)}
    {cursor&&<button type="button" onClick={()=>void load(cursor)}>Показать ещё</button>}
    {selected&&<form className="kiz-queue" onSubmit={async e=>{
      e.preventDefault();if(lock.current)return;lock.current=true;setSaving(true);setError('');
      try{await decideKizReview(session.accessToken,selected.row.id,selected.resolution,reason.trim(),confirmed);
        if(!live.current)return;setSelected(null);setNotice('Решение сохранено. Сборщик может повторить сканирование старого КИЗа.');await load();
      }catch(e){if(live.current)setError(e instanceof Error?e.message:'Решение не подтверждено. Повторите отправку.');}
      finally{lock.current=false;if(live.current)setSaving(false);}
    }}>
      <h4>{selected.resolution==='REUSE'?'Разрешить использовать':'Разрешить переклейку'} · заказ {selected.row.snapshot.orderId}</h4>
      <p>КИЗ: {selected.row.kizIdentity}</p>
      <label>Основание решения<textarea required minLength={5} maxLength={1000} value={reason} disabled={saving} onChange={e=>setReason(e.target.value)}/></label>
      <label><input type="checkbox" required checked={confirmed} disabled={saving} onChange={e=>setConfirmed(e.target.checked)}/>
        {selected.resolution==='REUSE'?'Проверено: единица физически на складе, КИЗ не погашен и допускает повторное использование.':'Подтверждаю наличие этой единицы для замены старого КИЗа на новый без пересчёта всего короба.'}</label>
      <button type="submit" disabled={saving||!confirmed||reason.trim().length<5}>{saving?'Сохраняю…':'Подтвердить решение'}</button>
      <button type="button" disabled={saving} onClick={()=>setSelected(null)}>Отмена</button>
    </form>}
  </section>;
}
// FIX: both administrator actions stay visible; confirmed usage can only be relabeled.
export function KizReviewCard({row,disabled,onDecision,onInspect}:{row:KizReviewCase;disabled:boolean;
  onDecision:(resolution:'REUSE'|'RELABEL')=>void;onInspect:()=>void}) {
  const blocked=disabled||!row.active||row.status!=='OPEN';
  return <article className="kiz-queue">
    <h4>{row.snapshot.productName} · заявка №{String(row.snapshot.requestNumber).padStart(6,'0')}</h4>
    <p>Сборщик: {row.snapshot.workerName??'не указан'} · заказ WB {row.snapshot.orderId} · короб {row.snapshot.boxCode??'не указан'}</p>
    <p>КИЗ: {row.kizIdentity} · ШК: {row.snapshot.barcode??'—'}</p>
    <p>{row.decision==='RELABEL'?'Подтверждено использование: нужна переклейка.':'История использования требует проверки администратора.'}</p>
    <p>Первое обращение: {new Date(row.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} · сканирований: {row.attempts}</p>
    {!row.active&&<p>Задание изменилось или единица уже принята. Нужно новое обращение из текущей сборки.</p>}
    {row.status==='APPROVED'&&<p>Разрешено: {row.resolution==='RELABEL'?'переклейка':'использование'}. {row.decidedByName} · {row.reason}</p>}
    <button type="button" onClick={onInspect}>Посмотреть историю КИЗа</button>
    <button type="button" disabled={blocked||row.decision==='RELABEL'} onClick={()=>onDecision('REUSE')}>Разрешить использовать</button>
    <button type="button" disabled={blocked||row.decision!=='RELABEL'} onClick={()=>onDecision('RELABEL')}>Разрешить переклейку</button>
  </article>;
}
