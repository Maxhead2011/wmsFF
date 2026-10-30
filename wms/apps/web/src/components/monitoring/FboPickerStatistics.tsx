import type { TsdMonitoring } from '../../lib/api';

// FIX: keep picking and packing separate, including unfinished FBO requests.
export function FboPickerStatistics({ statistics, period }: {
  statistics: NonNullable<TsdMonitoring['fboPickerStatistics']>;
  period: string;
}) {
  const time = (value: string) => new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  return <section className="tsd-picker-statistics">
    <header className="tsd-picker-statistics__header">
      <div><h3>ФБО — отбор и упаковка</h3>
        <p>{period}. Включая незавершённые заявки. Возвращённые единицы исключены.</p>
        <p>Время первого и последнего действия указано по Москве; это не длительность непрерывной работы.</p>
      </div>
      <div className="tsd-picker-statistics__totals">
        <span>{statistics.summary.workers} сотрудников</span>
        <span>{statistics.summary.requests} заявок</span>
        <span>Отобрано: {statistics.summary.pickedUnits}</span>
        <span>Упаковано: {statistics.summary.packedUnits}</span>
      </div>
    </header>
    <div className="tsd-picker-statistics__grid">
      {statistics.workers.map(worker => <article className="tsd-picker-card" key={worker.workerId}>
        <header><strong>{worker.workerName}</strong></header>
        <div className="tsd-picker-card__metrics">
          <span><small>Заявок</small><b>{worker.requests}</b></span>
          <span><small>Отобрано</small><b>{worker.pickedUnits} ед.</b></span>
          <span><small>Упаковано</small><b>{worker.packedUnits} ед.</b></span>
        </div>
        <details className="tsd-picker-card__orders"><summary>Действия по заявкам</summary>
          <div className="tsd-picker-card__order-list">{worker.requestDetails.map(request =>
            <div className="tsd-picker-order" key={request.requestId}>
              <div><strong>Заявка №{String(request.requestNumber).padStart(6, '0')}</strong>
                <span>{request.clientName} · {request.title}</span>
                <small>Отобрано: {request.pickedUnits} · Упаковано: {request.packedUnits}</small></div>
              <div><span>Первое: {time(request.firstActionAt)}</span><span>Последнее: {time(request.lastActionAt)}</span></div>
            </div>)}</div>
        </details>
      </article>)}
    </div>
    {!statistics.workers.length ? <p>За выбранный период действий ФБО нет.</p> : null}
  </section>;
}
