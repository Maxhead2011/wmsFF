import type {KizReviewCase} from '../../lib/api';
  const scanDate=(value?:string|null)=>value?new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК':'Время скана не сохранено';

export function ReceiptScanTimeline({row}:{row:KizReviewCase}) {
  const info=row.snapshot.receiptInfo;
  const firstBox=info?.firstScanBox;
  const repeatBox=info?.repeatScanBox ?? (info?.localDuplicate ? info.currentBoxCode : null);
  return <section className="kiz-scan-timeline">
      <strong>{!firstBox?'Короб первого скана неизвестен':!repeatBox?'Короб повторного скана неизвестен':firstBox===repeatBox?'Повтор в том же коробе':'Повтор в другом коробе'}</strong>
      <p><b>Первый скан</b> · {scanDate(info?.firstScanAt)}<br/>Короб: {firstBox??'не сохранён'} · {info?.firstScanWorker??'Сотрудник не сохранён'}</p>
      <p><b>Повторный скан</b> · {scanDate(info?.repeatScanAt)}<br/>Короб: {repeatBox??'не сохранён'} · {info?.repeatScanWorker??'Сотрудник не сохранён'}</p>
      {info?.firstReceivedAt&&<p>Первая регистрация прихода в ВМС · {scanDate(info.firstReceivedAt)} · короб {info.firstBoxCode??'не сохранён'}</p>}
    </section>;
}

// FIX: the server exposes the narrowly scoped physical-presence exception.
export function KizReviewCard({row,disabled,onDecision,onInspect}:{row:KizReviewCase;disabled:boolean;
  onDecision:(resolution:'REUSE'|'RELABEL'|'REJECT'|'CLOSE')=>void;onInspect:()=>void}) {
  const blocked=disabled||!row.active||row.status!=='OPEN';
  const scope=row.snapshot.scope;
  return <details className="kiz-queue kiz-review-case">
    <summary>
    <h4>{row.snapshot.productName} · {scope==='RECEIPT'?'Приёмка':scope==='UNIT'?'Единица на складе':`${scope?scope+' · ':''}заявка №${String(row.snapshot.requestNumber).padStart(6,'0')}`}</h4>
      <span>{row.createdAt && scanDate(row.createdAt)+' · '}{row.status==='APPROVED'?'Решение принято':row.active?'Требует проверки':row.status==='CLOSED'?'Закрыто':'Неактуально'}</span>
    </summary>
    <div className="kiz-review-case__body">
    {scope==='RECEIPT'&&<ReceiptScanTimeline row={row}/>}
    <p>{scope?'Сотрудник':'Сборщик'}: {row.snapshot.workerName??'не указан'}{(!scope||scope==='FBS')&&<> · заказ WB {row.snapshot.orderId}</>} · короб {row.snapshot.boxCode??'не указан'}</p>
    <p>КИЗ: {row.kizIdentity} · ШК: {row.snapshot.barcode??'—'}</p>
    {row.snapshot.receiptDuplicateUnconfirmed&&<p role="status">Повторный скан на ТСД. При передаче обращения первая единица ещё не была зарегистрирована в WMS. Наличие двух физических товаров с одинаковым КИЗом не подтверждено.</p>}
    <p>{row.decision==='RELABEL'?(row.physicalReuseAllowed?'WB сообщает о прежней продаже. После физической проверки можно разрешить этот КИЗ либо переклейку.':'Подтверждено использование: нужна переклейка.'):'История использования требует проверки администратора.'}</p>
    {scope!=='UNIT'&&<p>Зарегистрировано в ВМС: {new Date(row.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК · обращений с ТСД: {row.attempts}</p>}
    {scope==='RECEIPT'&&<p>Товар отложен. Решение не добавляет повторный приход. Возврат оформляется отдельно.</p>}
    {!row.active&&row.status!=='CLOSED'&&<p>Задание изменилось или единица уже принята. Нужно новое обращение из текущей сборки.</p>}
    {row.status==='APPROVED'&&<p>Разрешено: {row.resolution==='RELABEL'?'переклейка':'использование'}. {row.decidedByName} · {row.reason}</p>}
    {row.status==='CLOSED'&&<p>Закрыто · {row.reason} · {row.decidedByName}{row.decidedAt?' · '+scanDate(row.decidedAt):''}</p>}
    <button className="secondary-button" type="button" onClick={onInspect}>Посмотреть историю КИЗа</button>
    <div className="kiz-review-actions"><button type="button" disabled={blocked||scope==='RECEIPT'||(row.decision==='RELABEL'&&!row.physicalReuseAllowed)} onClick={()=>onDecision('REUSE')}>Разрешить использовать</button>
    <button type="button" disabled={blocked||(!scope&&row.decision!=='RELABEL')} onClick={()=>onDecision('RELABEL')}>Разрешить переклейку</button>
    {scope&&scope!=='UNIT'&&<button type="button" disabled={blocked} onClick={()=>onDecision('REJECT')}>Отказать</button>}
    {scope==='RECEIPT'&&<button type="button" disabled={blocked} onClick={()=>onDecision('CLOSE')}>Закрыть обращение</button>}
    </div>
  </div></details>;
}
