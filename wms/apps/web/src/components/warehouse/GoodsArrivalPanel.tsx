import { FilePlus2, ReceiptText, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  billGoodsArrivals,
  createGoodsArrival,
  deleteGoodsArrival,
  fetchClients,
  fetchGoodsArrivalEstimate,
  fetchGoodsArrivals,
  type AuthSession,
  type ClientSummary,
  type GoodsArrivalEstimate,
  type GoodsArrivalSummary,
} from '../../lib/api';

export function GoodsArrivalPanel({ session }: { session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useState('');
  const [arrivalDate, setArrivalDate] = useState(today());
  const [bagCount, setBagCount] = useState('0');
  const [boxCount, setBoxCount] = useState('0');
  const [comment, setComment] = useState('');
  const [periodFrom, setPeriodFrom] = useState(monthStart());
  const [periodTo, setPeriodTo] = useState(today());
  const [rows, setRows] = useState<GoodsArrivalSummary[]>([]);
  const [estimate, setEstimate] = useState<GoodsArrivalEstimate | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetchClients(session.accessToken).then((items) => {
      setClients(items);
      setClientId((current) => current || items[0]?.id || '');
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Не удалось загрузить клиентов.'));
  }, [session.accessToken]);

  useEffect(() => {
    if (clientId) void load();
  }, [clientId, periodFrom, periodTo]);

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const [nextRows, nextEstimate] = await Promise.all([
        fetchGoodsArrivals(session.accessToken, { clientId, periodFrom, periodTo }),
        fetchGoodsArrivalEstimate(session.accessToken, clientId),
      ]);
      setRows(nextRows);
      setEstimate(nextEstimate);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить приходы товара.');
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      await createGoodsArrival(session.accessToken, {
        clientId,
        arrivalDate,
        bagCount: Number(bagCount) || 0,
        boxCount: Number(boxCount) || 0,
        comment: comment.trim() || undefined,
      });
      setBagCount('0');
      setBoxCount('0');
      setComment('');
      setMessage('Приход товара записан.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось записать приход.');
    }
  }

  async function bill() {
    setMessage('');
    try {
      const invoice = await billGoodsArrivals(session.accessToken, { clientId, periodFrom, periodTo });
      setMessage(`Черновик счета ${invoice.number} создан в биллинге.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сформировать счет ППР.');
    }
  }

  async function remove(id: string) {
    setMessage('');
    try {
      await deleteGoodsArrival(session.accessToken, id);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось удалить приход.');
    }
  }

  const totals = rows.reduce((sum, row) => ({ bags: sum.bags + row.bagCount, boxes: sum.boxes + row.boxCount }), { bags: 0, boxes: 0 });

  return (
    <div className="goods-arrivals">
      <form className="goods-arrivals__form" onSubmit={submit}>
        <label><span>Клиент</span><select value={clientId} onChange={(event) => setClientId(event.target.value)} required><option value="">Выберите клиента</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label><span>Дата прихода</span><input type="date" value={arrivalDate} onChange={(event) => setArrivalDate(event.target.value)} required /></label>
        <label><span>Мешки</span><input type="number" min="0" value={bagCount} onChange={(event) => setBagCount(event.target.value)} /></label>
        <label><span>Короба</span><input type="number" min="0" value={boxCount} onChange={(event) => setBoxCount(event.target.value)} /></label>
        <label className="goods-arrivals__comment"><span>Комментарий</span><input value={comment} onChange={(event) => setComment(event.target.value)} /></label>
        <button className="primary-button" type="submit" disabled={!clientId}><FilePlus2 size={16} /><span>Записать приход</span></button>
      </form>

      <div className="goods-arrivals__billing">
        <label><span>Период с</span><input type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} /></label>
        <label><span>Период по</span><input type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} /></label>
        <div><span>За период</span><strong>{totals.bags} мешков · {totals.boxes} коробов</strong></div>
        <div><span>Ориентировочно</span><strong>{money(estimate?.estimatedRub ?? 0)} ₽</strong></div>
        <button className="primary-button" type="button" onClick={() => void bill()} disabled={!clientId || rows.every((row) => Boolean(row.billingInvoiceId))}>
          <ReceiptText size={16} /><span>Сформировать счет ППР</span>
        </button>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /><span>Обновить</span></button>
      </div>
      {message ? <p className={message.includes('создан') || message.includes('записан') ? 'form-success' : 'form-error'}>{message}</p> : null}
      <div className="online-receipts__table-wrap">
        <table className="warehouse-drafts__table">
          <thead><tr><th>Дата</th><th>Клиент</th><th>Мешки</th><th>Короба</th><th>Комментарий</th><th>Счет</th><th /></tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.id}><td>{date(row.arrivalDate)}</td><td>{clients.find((client) => client.id === row.clientId)?.name ?? '-'}</td><td>{row.bagCount}</td><td>{row.boxCount}</td><td>{row.comment || '-'}</td><td>{row.billingInvoiceId ? 'Включен' : 'Не выставлен'}</td><td>{!row.billingInvoiceId ? <button className="icon-button danger-icon" type="button" onClick={() => void remove(row.id)} title="Удалить"><Trash2 size={15} /></button> : null}</td></tr>)}
            {!rows.length ? <tr><td colSpan={7}>За выбранный период приходов нет.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function today() { return new Date().toISOString().slice(0, 10); }
function monthStart() { const date = new Date(); date.setDate(1); return date.toISOString().slice(0, 10); }
function date(value: string) { return new Intl.DateTimeFormat('ru-RU').format(new Date(`${value}T00:00:00`)); }
function money(value: number) { return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
