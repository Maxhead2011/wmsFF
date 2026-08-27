import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, RefreshCw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  downloadTurnoverKizReportXlsx,
  fetchTurnoverKizReport,
  type AuthSession,
  type ClientSummary,
  type TurnoverKizReport,
  type TurnoverKizReportRow,
} from '../../lib/api';
import './kiz-report.css';

const PAGE_SIZE = 50;

// ADDED: isolated client-facing KIZ shipment report with WB status snapshots.
export function KizReportSection({
  session,
  clients,
  clientId,
  onClientChange,
}: {
  session: AuthSession;
  clients: ClientSummary[];
  clientId: string;
  onClientChange: (clientId: string) => void;
}) {
  const [dateFrom, setDateFrom] = useState(dateInput(daysAgo(90)));
  const [dateTo, setDateTo] = useState(dateInput(new Date()));
  const [search, setSearch] = useState('');
  const [report, setReport] = useState<TurnoverKizReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setReport(null);
    setError('');
  }, [clientId]);

  async function load(page = 1) {
    if (!clientId) {
      setError('Выберите клиента, чтобы сформировать отчёт.');
      return;
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setError('Дата начала не может быть позже даты окончания.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const next = await fetchTurnoverKizReport(session.accessToken, {
        clientId,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: search.trim() || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setReport(next);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function download() {
    if (!clientId) {
      setError('Выберите клиента, чтобы скачать отчёт.');
      return;
    }

    setDownloading(true);
    setError('');
    try {
      const blob = await downloadTurnoverKizReportXlsx(session.accessToken, {
        clientId,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: search.trim() || undefined,
      });
      const client = clients.find((item) => item.id === clientId);
      downloadBlob(blob, `kiz-report-${safeFileName(client?.code || client?.name || 'client')}-${dateInput(new Date())}.xlsx`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="turnover-kiz-report" aria-label="Отчёты по КИЗам">
      <header className="turnover-kiz-report__heading">
        <div>
          <h2>Отчёты по КИЗам</h2>
          <p>Фактическая история маркированных товаров: приёмка, поставка, заявка, заказ, стикер и отгрузка.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => void download()} disabled={!clientId || downloading}>
          <Download size={17} aria-hidden="true" />
          <span>{downloading ? 'Формирую Excel…' : 'Скачать весь отчёт Excel'}</span>
        </button>
      </header>

      <form
        className="turnover-kiz-report__filters"
        onSubmit={(event) => {
          event.preventDefault();
          void load(1);
        }}
      >
        <label>
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => onClientChange(event.target.value)}>
            <option value="">Выберите клиента</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        <label>
          <span>Отгружено с</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          <span>по</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label className="turnover-kiz-report__search">
          <span>Поиск в отчёте</span>
          <span>
            <Search size={16} aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="КИЗ, заказ, поставка, товар, ШК"
            />
          </span>
        </label>
        <button className="turnover-kiz-report__submit" type="submit" disabled={!clientId || loading}>
          <RefreshCw className={loading ? 'is-spinning' : ''} size={17} aria-hidden="true" />
          <span>{loading ? 'Формирую…' : 'Сформировать таблицу'}</span>
        </button>
      </form>

      {error ? <p className="form-error turnover-kiz-report__error">{error}</p> : null}

      {!report && !loading ? (
        <div className="turnover-kiz-report__empty">
          <FileSpreadsheet size={30} aria-hidden="true" />
          <strong>Отчёт ещё не сформирован</strong>
          <span>Выберите клиента и период, затем нажмите «Сформировать таблицу».</span>
        </div>
      ) : null}

      {report ? (
        <>
          <div className="turnover-kiz-report__summary" aria-live="polite">
            <strong>{formatNumber(report.pagination.total)}</strong>
            <span>отгруженных КИЗов найдено</span>
            <small>Статусы WB — последний снимок синхронизации WMS</small>
          </div>

          <div className="turnover-kiz-report__table-wrap">
            <table className="turnover-kiz-report__table">
              <thead>
                <tr>
                  <th>Даты</th>
                  <th>Поставка / заявка</th>
                  <th>Заказ WB</th>
                  <th>Костюм</th>
                  <th>Характеристики</th>
                  <th>КИЗ</th>
                  <th>Стикер WB</th>
                  <th>Статусы WB</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((row) => <KizReportTableRow key={row.id} row={row} />)}
                {!loading && report.items.length === 0 ? (
                  <tr><td colSpan={8}>За выбранный период отгруженные КИЗы не найдены.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {report.pagination.pages > 1 ? (
            <nav className="turnover-kiz-report__pagination" aria-label="Страницы отчёта">
              <button type="button" onClick={() => void load(report.pagination.page - 1)} disabled={loading || report.pagination.page <= 1}>
                <ChevronLeft size={17} aria-hidden="true" />
                Назад
              </button>
              <span>Страница {report.pagination.page} из {report.pagination.pages}</span>
              <button type="button" onClick={() => void load(report.pagination.page + 1)} disabled={loading || report.pagination.page >= report.pagination.pages}>
                Далее
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            </nav>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function KizReportTableRow({ row }: { row: TurnoverKizReportRow }) {
  return (
    <tr>
      <td>
        <strong>{formatDateTime(row.shippedAt)}</strong>
        <span>приёмка: {formatDateTime(row.arrivalAt)}</span>
      </td>
      <td>
        <strong>{row.supplyId || 'Без поставки'}</strong>
        <span>WMS №{String(row.requestNumber).padStart(6, '0')}</span>
        <small title={row.requestTitle}>{row.requestTitle}</small>
      </td>
      <td><strong className="turnover-kiz-report__order">{row.orderId || '—'}</strong></td>
      <td>
        <strong>{row.productName}</strong>
        <span>{row.article || row.internalSku}</span>
        <small>ШК {row.barcode || '—'}</small>
      </td>
      <td>
        <strong>{[row.color, row.size].filter(Boolean).join(' · ') || '—'}</strong>
        <span>{row.sourceBoxCode || 'Без короба'}</span>
      </td>
      <td><code>{printableKiz(row.kiz)}</code></td>
      <td>
        <strong className="turnover-kiz-report__sticker">{row.stickerPartB || '—'}</strong>
        <span>{row.stickerBarcode || 'Стикер не сохранён'}</span>
      </td>
      <td>
        <div className="turnover-kiz-report__statuses">
          <span>{row.wbSupplierStatus || 'supplierStatus —'}</span>
          <span>{row.wbStatus || 'wbStatus —'}</span>
          {row.wbCategory ? <small>{row.wbCategory}</small> : null}
        </div>
        <small>обновлено: {formatDateTime(row.wbStatusUpdatedAt)}</small>
      </td>
    </tr>
  );
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function dateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('ru-RU') : 'нет данных';
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function printableKiz(value: string) {
  return value.replaceAll('\u001d', '<GS>');
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'client';
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось сформировать отчёт по КИЗам.';
}
