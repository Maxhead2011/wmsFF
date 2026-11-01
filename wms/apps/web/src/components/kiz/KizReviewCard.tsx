import type {KizReviewCase} from '../../lib/api';
  const scanDate=(value?:string|null)=>value?new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК':'Время скана не сохранено';

export function ReceiptScanTimeline({row}:{row:KizReviewCase}) {
  const info=row.snapshot.receiptInfo;
  const firstBox=info?.firstScanBox;
  const repeatBox=info?.repeatScanBox ?? (info?.localDuplicate ? info.currentBoxCode : null);
  return <section className="kiz-scan-timeline">
      <strong>{!firstBox?'Короб первого скана неизвестен':!repeatBox?'Короб повторного скана неизвестен':firstBox===repeatBox?'Повтор в том же коробе':'Повтор в другом коробе'}</strong>
      <p className="kiz-scan-note">{row.snapshot.receiptDuplicateUnconfirmed ? 'При передаче обращения первая единица ещё не была зарегистрирована в ВМС. Наличие двух физических товаров с одинаковым КИЗом не подтверждено.' : firstBox && repeatBox ? 'ТСД сохранил оба сканирования.' : 'ТСД обнаружил повтор. Ниже показаны сведения, сохранённые при сканировании.'}</p>
      {[
        {label:'Первый скан', time:info?.firstScanAt, box:firstBox, worker:info?.firstScanWorker},
        {label:'Повторный скан', time:info?.repeatScanAt, box:repeatBox, worker:info?.repeatScanWorker},
      ].map(scan=><div className="kiz-scan-band" key={scan.label}>
        <div><strong>{scan.label}</strong><span>{scanDate(scan.time)}</span></div>
        <small>{scan.box ? 'Короб '+scan.box : 'Короб не сохранён'} · {scan.worker ?? 'Сотрудник не сохранён'}</small>
      </div>)}
      {info?.firstReceivedAt&&<p>Первая регистрация прихода в ВМС · {scanDate(info.firstReceivedAt)} · короб {info.firstBoxCode??'не сохранён'}</p>}
    </section>;
}

// FIX: the server exposes the narrowly scoped physical-presence exception.
export function KizReviewCard({row,disabled,onDecision,onInspect}:{row:KizReviewCase;disabled:boolean;
  onDecision:(resolution:'REUSE'|'RELABEL'|'REJECT'|'CLOSE')=>void;onInspect:()=>void}) {
  const blocked=disabled||!row.active||row.status!=='OPEN';
  const scope=row.snapshot.scope;
  const actions=(    <div className="kiz-review-actions"><button type="button" disabled={blocked||scope==='RECEIPT'||(row.decision==='RELABEL'&&!row.physicalReuseAllowed)} onClick={()=>onDecision('REUSE')}>Разрешить использовать</button>
    <button type="button" disabled={blocked||(!scope&&row.decision!=='RELABEL')} onClick={()=>onDecision('RELABEL')}>Разрешить переклейку</button>
    {scope&&scope!=='UNIT'&&<button type="button" disabled={blocked} onClick={()=>onDecision('REJECT')}>Отказать</button>}
    {scope==='RECEIPT'&&<button type="button" disabled={blocked} onClick={()=>onDecision('CLOSE')}>Закрыть обращение</button>}
    </div>);
  if(scope==='RECEIPT')return <details className="kiz-queue kiz-review-case kiz-receipt-card">
    <summary><strong>Приёмка · повторный скан КИЗа</strong><span className="kiz-receipt-status">{row.status==='CLOSED'?'Закрыто':row.status==='APPROVED'?'Решение принято':row.active?'Требует проверки':'Неактуально'}</span></summary>
    <ReceiptScanTimeline row={row}/>
    <div className="kiz-receipt-foot"><small>Зарегистрировано в ВМС · {scanDate(row.createdAt)}<br/>КИЗ · {row.kizIdentity}{row.snapshot.workerName && <> · Обращение от {row.snapshot.workerName}</>}</small>
      <button type="button" aria-label="Посмотреть историю КИЗа" onClick={onInspect}>История КИЗа ↗</button></div>
    {row.status==='CLOSED' || row.status==='APPROVED' ? <p>{row.resolution==='RELABEL'?'Разрешена переклейка':row.status==='CLOSED'?'Обращение закрыто':'Решение принято'} · {row.decidedByName} · {row.reason}</p> : <>
      <h3>Решение по обращению</h3>{actions}
      <small>Разрешение на переклейку и закрытие обращения не добавляют повторный приход.</small></>}
  </details>;
  return <details className="kiz-queue kiz-review-case">
    <summary>
    <h4>{row.snapshot.productName} · {scope==='UNIT'?'Единица на складе':`${scope?scope+' · ':''}заявка №${String(row.snapshot.requestNumber).padStart(6,'0')}`}</h4>
      <span>{row.createdAt && scanDate(row.createdAt)+' · '}{row.status==='APPROVED'?'Решение принято':row.active?'Требует проверки':row.status==='CLOSED'?'Закрыто':'Неактуально'}</span>
    </summary>
    <div className="kiz-review-case__body">
    <p>{scope?'Сотрудник':'Сборщик'}: {row.snapshot.workerName??'не указан'}{(!scope||scope==='FBS')&&<> · заказ WB {row.snapshot.orderId}</>} · короб {row.snapshot.boxCode??'не указан'}</p>
    <p>КИЗ: {row.kizIdentity} · ШК: {row.snapshot.barcode??'—'}</p>
    {row.snapshot.receiptDuplicateUnconfirmed&&<p role="status">Повторный скан на ТСД. При передаче обращения первая единица ещё не была зарегистрирована в WMS. Наличие двух физических товаров с одинаковым КИЗом не подтверждено.</p>}
    <p>{row.decision==='RELABEL'?(row.physicalReuseAllowed?'WB сообщает о прежней продаже. После физической проверки можно разрешить этот КИЗ либо переклейку.':'Подтверждено использование: нужна переклейка.'):'История использования требует проверки администратора.'}</p>
    {scope!=='UNIT'&&<p>Зарегистрировано в ВМС: {new Date(row.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК · обращений с ТСД: {row.attempts}</p>}
    {!row.active&&row.status!=='CLOSED'&&<p>Задание изменилось или единица уже принята. Нужно новое обращение из текущей сборки.</p>}
    {row.status==='APPROVED'&&<p>Разрешено: {row.resolution==='RELABEL'?'переклейка':'использование'}. {row.decidedByName} · {row.reason}</p>}
    {row.status==='CLOSED'&&<p>Закрыто · {row.reason} · {row.decidedByName}{row.decidedAt?' · '+scanDate(row.decidedAt):''}</p>}
    <button className="secondary-button" type="button" onClick={onInspect}>Посмотреть историю КИЗа</button>
    {actions}
  </div></details>;
}
