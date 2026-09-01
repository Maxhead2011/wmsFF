import { AlertTriangle, Camera, ChevronLeft, ChevronRight, Clock3, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  fetchTsdOperationHistory,
  fetchTsdOperationHistoryItem,
  fetchTsdOperationScreenshot,
  type TsdOperationHistoryFilters,
  type TsdOperationHistoryItem,
  type TsdOperationHistoryPage,
} from '../../lib/api';
import { operationContextEntries, operationMatchesSearch, operationPrimaryTitle } from './tsdOperationHistory';
import './tsd-operation-history.css';

type Props = { accessToken: string };

const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function TsdOperationHistoryPanel({ accessToken }: Props) {
  const [filters, setFilters] = useState<TsdOperationHistoryFilters>({ page: 1, pageSize: 50 });
  const [draftSearch, setDraftSearch] = useState('');
  const [data, setData] = useState<TsdOperationHistoryPage | null>(null);
  const [selected, setSelected] = useState<TsdOperationHistoryItem | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load(next = filters) {
    setLoading(true);
    setError('');
    try {
      setData(await fetchTsdOperationHistory(accessToken, next));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить историю ТСД.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => () => {
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
  }, [screenshotUrl]);

  const visibleItems = useMemo(
    () => (data?.items ?? []).filter((item) => operationMatchesSearch(item.payload, draftSearch)),
    [data?.items, draftSearch],
  );

  async function openOperation(item: TsdOperationHistoryItem) {
    setSelected(item);
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    setScreenshotUrl(null);
    try {
      const detail = await fetchTsdOperationHistoryItem(accessToken, item.id);
      setSelected(detail);
      if (detail.hasScreenshot) {
        const blob = await fetchTsdOperationScreenshot(accessToken, detail.id);
        setScreenshotUrl(URL.createObjectURL(blob));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось открыть операцию ТСД.');
    }
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const next = { ...filters, search: draftSearch.trim(), page: 1 };
    setFilters(next);
    void load(next);
  }

  function movePage(page: number) {
    const next = { ...filters, page };
    setFilters(next);
    void load(next);
  }

  return (
    <div className="tsd-history">
      <header className="tsd-history__hero">
        <div>
          <span>Полный журнал доказательств</span>
          <h3>Каждое действие ТСД</h3>
          <p>Сотрудник, устройство, точное время, паллет, короб, товар, ШК/КИЗ, ответ WMS и ошибка.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={17} className={loading ? 'is-spinning' : ''} /> Обновить
        </button>
      </header>

      <form className="tsd-history__filters" onSubmit={applyFilters}>
        <label><span>С</span><input type="datetime-local" value={filters.dateFrom?.slice(0, 16) ?? ''} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /></label>
        <label><span>По</span><input type="datetime-local" value={filters.dateTo?.slice(0, 16) ?? ''} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /></label>
        <label><span>Результат</span><select value={filters.status ?? ''} onChange={(e) => setFilters({ ...filters, status: e.target.value as TsdOperationHistoryFilters['status'] })}><option value="">Все</option><option value="ACCEPTED">Успешно</option><option value="NEEDS_REVIEW">Нужен разбор</option><option value="REJECTED">Ошибка</option></select></label>
        <label className="tsd-history__search"><span>Поиск по всем данным</span><div><Search size={16} /><input value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} placeholder="Паллет, короб, товар, ШК, КИЗ, заказ…" /></div></label>
        <button type="submit">Показать</button>
      </form>

      {error ? <div className="tsd-history__error"><AlertTriangle size={18} />{error}</div> : null}
      <div className="tsd-history__summary"><strong>{data?.total ?? 0}</strong><span>операций найдено</span><small>На странице: {visibleItems.length}</small></div>

      <div className="tsd-history__table-wrap">
        <table className="tsd-history__table">
          <thead><tr><th>Время</th><th>Операция и данные</th><th>Сотрудник / ТСД</th><th>Результат</th></tr></thead>
          <tbody>
            {visibleItems.map((item) => {
              const context = operationContextEntries(item.payload).slice(0, 5);
              return <tr key={item.id} onClick={() => void openOperation(item)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') void openOperation(item); }}>
                <td><strong>{formatDateTime(item.createdAt)}</strong><span><Clock3 size={12} /> {duration(item.payload)}</span></td>
                <td><strong>{operationPrimaryTitle(item.operationType, item.payload)}</strong><div className="tsd-history__chips">{context.map(([label, value]) => <span key={`${label}-${value}`}><b>{label}</b>{value}</span>)}</div>{item.serverMessage ? <small>{item.serverMessage}</small> : null}</td>
                <td><strong>{item.actor?.name ?? 'Сотрудник не определён'}</strong><span>{item.device.name} · {item.device.code}</span></td>
                <td><span className={`tsd-history__status tsd-history__status--${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span>{item.hasScreenshot ? <span className="tsd-history__camera"><Camera size={13} /> есть снимок</span> : null}</td>
              </tr>;
            })}
          </tbody>
        </table>
        {!loading && visibleItems.length === 0 ? <p className="tsd-history__empty">За выбранный период операций нет.</p> : null}
      </div>

      {data && data.pageCount > 1 ? <footer className="tsd-history__pager"><button type="button" disabled={data.page <= 1} onClick={() => movePage(data.page - 1)}><ChevronLeft size={16} /> Назад</button><span>Страница {data.page} из {data.pageCount}</span><button type="button" disabled={data.page >= data.pageCount} onClick={() => movePage(data.page + 1)}>Дальше <ChevronRight size={16} /></button></footer> : null}

      {selected ? <OperationDialog item={selected} screenshotUrl={screenshotUrl} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function OperationDialog({ item, screenshotUrl, onClose }: { item: TsdOperationHistoryItem; screenshotUrl: string | null; onClose: () => void }) {
  const entries = operationContextEntries(item.payload);
  return <div className="tsd-history-modal" role="dialog" aria-modal="true" aria-label="Детали операции ТСД" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section>
      <header><div><span>{formatDateTime(item.createdAt)}</span><h3>{operationPrimaryTitle(item.operationType, item.payload)}</h3><p>{item.actor?.name ?? 'Сотрудник не определён'} · {item.device.name} / {item.device.code}</p></div><button type="button" onClick={onClose} aria-label="Закрыть"><X size={20} /></button></header>
      <div className="tsd-history-modal__result"><span className={`tsd-history__status tsd-history__status--${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span><strong>{item.serverMessage ?? item.resolutionMessage ?? 'Операция выполнена без сообщения сервера.'}</strong></div>
      {screenshotUrl ? <figure><img src={screenshotUrl} alt="Снимок экрана ТСД в момент ошибки" /><figcaption>Экран приложения ТСД в момент ошибки · {formatDateTime(item.screenshotCapturedAt)}</figcaption></figure> : item.hasScreenshot ? <p className="tsd-history-modal__loading">Загружаю снимок экрана…</p> : null}
      <div className="tsd-history-modal__facts">{entries.map(([label, value]) => <article key={`${label}-${value}`}><span>{label}</span><strong>{value}</strong></article>)}</div>
      <details open><summary>Полный технический пакет операции</summary><pre>{JSON.stringify({ id: item.id, operationKey: item.operationKey, operationType: item.operationType, status: item.status, actor: item.actor, device: item.device, createdAt: item.createdAt, updatedAt: item.updatedAt, payload: item.payload, serverMessage: item.serverMessage, reviewReason: item.reviewReason, resolutionMessage: item.resolutionMessage, reviewComment: item.reviewComment }, null, 2)}</pre></details>
    </section>
  </div>;
}

function formatDateTime(value: string | null) { return value ? dateTime.format(new Date(value)) : '—'; }
function statusLabel(status: TsdOperationHistoryItem['status']) { return status === 'ACCEPTED' ? 'Успешно' : status === 'NEEDS_REVIEW' ? 'Нужен разбор' : 'Ошибка'; }
function duration(payload: Record<string, unknown>) { const result = payload.result as Record<string, unknown> | undefined; return typeof result?.durationMs === 'number' ? `${result.durationMs} мс` : 'время ответа не записано'; }
