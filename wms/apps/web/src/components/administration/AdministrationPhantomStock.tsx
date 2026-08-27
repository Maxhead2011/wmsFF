import { AlertTriangle, Boxes, CheckCircle2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  fetchAdministrationPhantomStocks,
  fixAdministrationPhantomStock,
  fixAllAdministrationPhantomStocks,
  type AdministrationPhantomStock,
  type AuthSession,
} from '../../lib/api';
import './phantom-stock.css';

type Props = {
  session: AuthSession;
  onCountChange?: (count: number) => void;
};

export function AdministrationPhantomStockPanel({ session, onCountChange }: Props) {
  const [data, setData] = useState<AdministrationPhantomStock | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const next = await fetchAdministrationPhantomStocks(session.accessToken);
        if (!active) return;
        setData(next);
        onCountChange?.(next.summary.findings);
        setError('');
      } catch (caught) {
        if (active) setError(errorMessage(caught));
      } finally {
        if (active && !quiet) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(true), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [session.accessToken, onCountChange]);

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const next = await fetchAdministrationPhantomStocks(session.accessToken);
      setData(next);
      onCountChange?.(next.summary.findings);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function fixOne(row: AdministrationPhantomStock['rows'][number]) {
    if (!window.confirm(`Удалить ${row.suspectQuantity} фантомн. ед. ${row.internalSku} из короба ${row.boxCode}?`)) return;
    setBusy(row.balanceId);
    setMessage('');
    setError('');
    try {
      const result = await fixAdministrationPhantomStock(session.accessToken, row.balanceId);
      setData(result.overview);
      onCountChange?.(result.overview.summary.findings);
      setMessage(`Фантомный остаток в коробе ${row.boxCode} удалён. Действие записано в журнал.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  }

  async function fixAll() {
    if (!data?.summary.findings) return;
    if (!window.confirm(`Исправить все найденные остатки: ${data.summary.findings} поз., ${data.summary.suspectUnits} ед.?`)) return;
    setBusy('all');
    setMessage('');
    setError('');
    try {
      const result = await fixAllAdministrationPhantomStocks(session.accessToken);
      setData(result.overview);
      onCountChange?.(result.overview.summary.findings);
      setMessage(`Исправлено ${result.fixed} позиций, удалено ${result.removedUnits} фантомных единиц.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="admin-section admin-phantom">
      <div className="admin-section__heading admin-phantom__heading">
        <div>
          <span className="admin-kicker">Автоматический контроль · обновление раз в минуту</span>
          <h3><ShieldCheck size={20} /> Фантомные остатки</h3>
          <p>Находит товар, который остался в PACKING/SHIPPING после закрытия заявки или имеет уже отгруженный КИЗ.</p>
        </div>
        <div className="admin-phantom__toolbar">
          <button className="admin-button admin-button--ghost" type="button" onClick={() => void reload()} disabled={loading || Boolean(busy)}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> Проверить сейчас
          </button>
          <button className="admin-button admin-button--danger" type="button" onClick={() => void fixAll()} disabled={!data?.summary.findings || Boolean(busy)}>
            <Trash2 size={16} /> {busy === 'all' ? 'Исправляю…' : 'Исправить все'}
          </button>
        </div>
      </div>

      {message ? <div className="admin-message admin-message--ok"><CheckCircle2 size={18} />{message}</div> : null}
      {error ? <div className="admin-message admin-message--error"><AlertTriangle size={18} />{error}</div> : null}

      <div className="admin-phantom__metrics">
        <Metric label="Проверено резервов" value={data?.summary.balancesChecked ?? 0} />
        <Metric label="Проблемных коробов" value={data?.summary.boxes ?? 0} danger={Boolean(data?.summary.boxes)} />
        <Metric label="Фантомных позиций" value={data?.summary.findings ?? 0} danger={Boolean(data?.summary.findings)} />
        <Metric label="Лишних единиц" value={data?.summary.suspectUnits ?? 0} danger={Boolean(data?.summary.suspectUnits)} />
      </div>

      {!loading && data?.rows.length === 0 ? (
        <div className="admin-phantom__clean"><CheckCircle2 size={25} /><strong>Фантомных остатков не найдено</strong><span>PACKING и SHIPPING согласованы с отгрузками и заявками.</span></div>
      ) : null}

      {data?.rows.length ? (
        <div className="admin-phantom__table-wrap">
          <table className="admin-phantom__table">
            <thead><tr><th>Короб / клиент</th><th>Товар</th><th>Статус</th><th>Остаток</th><th>Почему это фантом</th><th>Действие</th></tr></thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.balanceId}>
                  <td><strong>{row.boxCode}</strong><small>{row.clientCode} · {row.clientName}</small></td>
                  <td><strong>{row.internalSku}</strong><small>{row.skuName}{row.barcode ? ` · ШК ${row.barcode}` : ''}</small></td>
                  <td><span className={`admin-phantom__status admin-phantom__status--${row.status.toLowerCase()}`}>{row.status}</span></td>
                  <td><strong className="admin-phantom__quantity">{row.suspectQuantity} из {row.currentQuantity}</strong></td>
                  <td>
                    <strong>{row.reason}</strong>
                    {row.shippedMarks.map((mark) => <small key={mark.markId}>КИЗ {mark.maskedKiz} · заявка №{mark.requestNumber}{mark.orderId ? ` · WB ${mark.orderId}` : ''}</small>)}
                    {row.closedRequests.map((request) => <small key={request.movementId}>Закрытая заявка №{request.requestNumber} · зависло {request.quantity} шт.</small>)}
                  </td>
                  <td>
                    <button className="admin-button admin-button--danger admin-button--compact" type="button" onClick={() => void fixOne(row)} disabled={Boolean(busy)}>
                      <Trash2 size={15} /> {busy === row.balanceId ? 'Исправляю…' : 'Удалить фантом'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="admin-phantom__note"><Boxes size={15} /> Перед удалением сервер повторно проверяет остаток, КИЗ, закрытую заявку и блокировку инвентаризации. Изменившиеся строки не удаляются.</p>
    </section>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <div className={danger ? 'danger' : ''}><strong>{value}</strong><span>{label}</span></div>;
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось проверить фантомные остатки.';
}
