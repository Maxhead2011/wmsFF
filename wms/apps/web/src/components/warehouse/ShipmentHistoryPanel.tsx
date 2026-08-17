import { RefreshCw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  fetchClients,
  fetchShippedKizHistory,
  syncShippedKizHistory,
  type AuthSession,
  type ClientSummary,
  type ShippedKizHistoryRow,
} from '../../lib/api';
import { useRememberedClientId } from '../../lib/rememberedClient';

export function ShipmentHistoryPanel({ session }: { session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [periodFrom, setPeriodFrom] = useState(dateInput(daysAgo(90)));
  const [periodTo, setPeriodTo] = useState(dateInput(new Date()));
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ShippedKizHistoryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    fetchClients(session.accessToken)
      .then((items) => {
        if (active) setClients(items);
      })
      .catch((caught: unknown) => {
        if (active) setMessage(errorMessage(caught));
      });
    void load();
    return () => {
      active = false;
    };
  }, [session.accessToken]);

  async function load() {
    setBusy(true);
    setMessage('');
    try {
      const nextRows = await fetchShippedKizHistory(session.accessToken, {
        clientId: clientId || undefined,
        periodFrom,
        periodTo,
        search: search || undefined,
      });
      setRows(nextRows);
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    setMessage('');
    try {
      const result = await syncShippedKizHistory(session.accessToken, clientId || undefined);
      const nextRows = await fetchShippedKizHistory(session.accessToken, {
        clientId: clientId || undefined,
        periodFrom,
        periodTo,
        search: search || undefined,
      });
      setRows(nextRows);
      setMessage(`История обновлена: добавлено ${result.added}, проверено заявок ${result.checkedRequests}.`);
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shipment-history">
      <div className="shipment-history__filters">
        <label>
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">Все доступные клиенты</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Отгружено с</span>
          <input type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} />
        </label>
        <label>
          <span>по</span>
          <input type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} />
        </label>
        <label className="shipment-history__search">
          <span>КИЗ, заказ, ШК, товар или короб</span>
          <span>
            <Search size={16} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" />
          </span>
        </label>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={busy}>
          Показать
        </button>
        <button className="primary-button" type="button" onClick={() => void sync()} disabled={busy}>
          <RefreshCw size={16} aria-hidden="true" />
          {busy ? 'Обновляю…' : 'Обновить историю'}
        </button>
      </div>

      {message ? <p className="warehouse-inline">{message}</p> : null}
      <div className="shipment-history__summary">
        <strong>{rows.length}</strong>
        <span>отгруженных маркированных единиц в выбранном периоде</span>
      </div>

      <div className="shipment-history__table-wrap">
        <table className="shipment-history__table">
          <thead>
            <tr>
              <th>Отгрузка / приход</th>
              <th>Заявка / заказ</th>
              <th>Товар</th>
              <th>ШК / артикул</th>
              <th>Цвет / размер</th>
              <th>КИЗ</th>
              <th>Короб</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{formatDateTime(row.shippedAt)}</strong>
                  <span>приход: {formatDateTime(row.arrivalAt)}</span>
                </td>
                <td>
                  <strong>WMS №{String(row.requestNumber).padStart(6, '0')}</strong>
                  <span>{row.orderId ? `WB №${row.orderId}` : row.requestTitle}</span>
                  {row.supplyId ? <span>поставка {row.supplyId}</span> : null}
                </td>
                <td><strong>{row.productName}</strong><span>{row.internalSku}</span></td>
                <td><strong>{row.barcode ?? '—'}</strong><span>{row.article ?? '—'}</span></td>
                <td>{[row.color, row.size].filter(Boolean).join(' / ') || '—'}</td>
                <td><code>{row.kiz}</code></td>
                <td>{row.sourceBoxCode ?? 'Без короба'}</td>
              </tr>
            ))}
            {!busy && rows.length === 0 ? (
              <tr><td colSpan={7}>За выбранный период отгруженных КИЗ не найдено.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
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

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось загрузить историю.';
}
