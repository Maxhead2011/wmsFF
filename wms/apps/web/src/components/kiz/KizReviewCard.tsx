import type {KizReviewCase} from '../../lib/api';
// FIX: the server exposes the narrowly scoped physical-presence exception.
export function KizReviewCard({row,disabled,onDecision,onInspect}:{row:KizReviewCase;disabled:boolean;
  onDecision:(resolution:'REUSE'|'RELABEL')=>void;onInspect:()=>void}) {
  const blocked=disabled||!row.active||row.status!=='OPEN';
  return <details className="kiz-queue kiz-review-case">
    <summary>
    <h4>{row.snapshot.productName} · заявка №{String(row.snapshot.requestNumber).padStart(6,'0')}</h4>
      <span>{new Date(row.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} · {row.status==='APPROVED'?'Решение принято':row.active?'Требует проверки':'Неактуально'}</span>
    </summary>
    <div className="kiz-review-case__body">
    <p>Сборщик: {row.snapshot.workerName??'не указан'} · заказ WB {row.snapshot.orderId} · короб {row.snapshot.boxCode??'не указан'}</p>
    <p>КИЗ: {row.kizIdentity} · ШК: {row.snapshot.barcode??'—'}</p>
    <p>{row.decision==='RELABEL'?(row.physicalReuseAllowed?'WB сообщает о прежней продаже. После физической проверки можно разрешить этот КИЗ либо переклейку.':'Подтверждено использование: нужна переклейка.'):'История использования требует проверки администратора.'}</p>
    <p>Первое обращение: {new Date(row.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} · сканирований: {row.attempts}</p>
    {!row.active&&<p>Задание изменилось или единица уже принята. Нужно новое обращение из текущей сборки.</p>}
    {row.status==='APPROVED'&&<p>Разрешено: {row.resolution==='RELABEL'?'переклейка':'использование'}. {row.decidedByName} · {row.reason}</p>}
    <button type="button" onClick={onInspect}>Посмотреть историю КИЗа</button>
    <button type="button" disabled={blocked||(row.decision==='RELABEL'&&!row.physicalReuseAllowed)} onClick={()=>onDecision('REUSE')}>Разрешить использовать</button>
    <button type="button" disabled={blocked||row.decision!=='RELABEL'} onClick={()=>onDecision('RELABEL')}>Разрешить переклейку</button>
  </div></details>;
}
