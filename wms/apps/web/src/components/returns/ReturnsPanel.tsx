import { useEffect, useRef, useState } from 'react';
import { fetchClients, request, type AuthSession, type ClientSummary } from '../../lib/api';
import './returns.css';

type Unit = { id: string; boxCode: string; barcode: string; productName: string; returnCode: string; condition: string; scannedByName: string };
type Batch = { id: string; status: string; createdAt: string; completedAt: string | null; createdByName: string; units: Unit[] };
const conditions: Record<string, string> = { NORMAL: 'Нормальное', INCOMPLETE: 'Разнопарка / неполный комплект', DAMAGED: 'Испачкан / повреждён', WRONG_ITEM: 'Неверное вложение' };

export function ReturnsPanel({ session }: { session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]), [clientId, setClientId] = useState('');
  const [batches, setBatches] = useState<Batch[]>([]), [selected, setSelected] = useState('');
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [marketplace, setMarketplace] = useState('WILDBERRIES'), [returnCode, setReturnCode] = useState(''), [barcode, setBarcode] = useState(''), [condition, setCondition] = useState('NORMAL'), [boxCode, setBoxCode] = useState('');
  const pending = useRef<{ path: string; body: unknown } | null>(null);
  const token = session.accessToken, batch = batches.find(b => b.id === selected);
  const canWrite = session.user.permissionCodes.some(p => p === 'stock:write' || p === 'system:admin');
  useEffect(() => { fetchClients(token).then(setClients).catch(e => setMessage(e.message)); }, [token]);
  async function refresh() { if (clientId) setBatches(await request<Batch[]>(`/returns?clientId=${encodeURIComponent(clientId)}`, { accessToken: token })); }
  useEffect(() => { let live = true; setBatches([]); setSelected(''); if (clientId) request<Batch[]>(`/returns?clientId=${encodeURIComponent(clientId)}`, { accessToken: token }).then(v => { if (live) setBatches(v); }).catch(e => { if (live) setMessage(e.message); }); return () => { live = false; }; }, [clientId, token]);
  async function mutate(path: string, body: unknown) {
    if (busy) return;
    pending.current ??= { path, body };
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}${pending.current.path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(pending.current.body),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) pending.current = null;
        throw new Error(Array.isArray(result.message) ? result.message.join('; ') : result.message || 'Ошибка сохранения');
      }
      const wasScan = pending.current.path.endsWith('/scan');
      const wasCreate = pending.current.path === '/returns';
      pending.current = null;
      if (wasScan) { setReturnCode(''); setBarcode(''); }
      if (wasCreate) setSelected(result.id);
      await refresh();
      setMessage(wasScan ? 'Возврат сохранён. Сканируйте следующий.' : 'Операция сохранена.');
    } catch (e) { setMessage(`${(e as Error).message}${pending.current ? ' Можно повторить тот же запрос.' : ''}`); }
    finally { setBusy(false); }
  }
  async function download(id: string) {
    setBusy(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/returns/${encodeURIComponent(id)}/export.xlsx`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Не удалось сформировать Excel.');
      const url = URL.createObjectURL(await response.blob()), a = document.createElement('a'); a.href = url; a.download = 'Возвраты.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  const visible = batches.filter(b => (!from || b.createdAt.slice(0, 10) >= from) && (!to || b.createdAt.slice(0, 10) <= to));
  return <section className="returns-panel">
    <h2>Обработка возвратов</h2>
    <p>После завершения сортировки короба поступают на хранение. До маркировки товар недоступен для сборки. Обработка возвратов начисляется отдельно.</p>
    <div className="returns-toolbar">
      <label>Клиент<select aria-label="Клиент" value={clientId} disabled={busy || !!pending.current} onChange={e => setClientId(e.target.value)}><option value="">Выберите клиента</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>С<input type="date" value={from} onChange={e => setFrom(e.target.value)}/></label><label>По<input type="date" value={to} onChange={e => setTo(e.target.value)}/></label>
      <button disabled={!clientId || busy} onClick={() => refresh().catch(e => setMessage(e.message))}>Обновить</button>
      {canWrite && <button disabled={!clientId || busy || !!pending.current} onClick={() => mutate('/returns', { id: crypto.randomUUID(), clientId })}>Начать сортировку</button>}
    </div>
    {message && <p role="status">{message}</p>}
    {pending.current && <button disabled={busy} onClick={() => mutate(pending.current!.path, pending.current!.body)}>Повторить тот же запрос</button>}
    <p>Последние партии (до 200): {visible.length} · Обработано: {visible.filter(b => b.status === 'STORED').reduce((n, b) => n + b.units.length, 0)} шт.</p>
    <div className="returns-batches">{visible.map(b => <button key={b.id} disabled={busy || !!pending.current} onClick={() => setSelected(b.id)}>{new Date(b.createdAt).toLocaleString('ru-RU')} · {b.createdByName} · {b.units.length} шт. · {b.status === 'STORED' ? 'На хранении' : 'Сортировка'}</button>)}</div>
    {batch && <>
      <h3>Партия от {new Date(batch.createdAt).toLocaleString('ru-RU')}</h3>
      {batch.status === 'SORTING' && canWrite && <form onSubmit={e => { e.preventDefault(); void mutate(`/returns/${batch.id}/scan`, { id: crypto.randomUUID(), marketplace, returnCode, barcode, condition, boxCode }); }}>
        <fieldset disabled={busy || !!pending.current} className="returns-toolbar">
          <label>Маркетплейс<select aria-label="Маркетплейс" value={marketplace} onChange={e => setMarketplace(e.target.value)}><option value="WILDBERRIES">Wildberries</option><option value="OZON">Ozon</option></select></label>
          <label>Код возврата<input required value={returnCode} onChange={e => setReturnCode(e.target.value)}/></label>
          <label>ШК фактического товара<input required value={barcode} onChange={e => setBarcode(e.target.value)}/></label>
          <label>Состояние<select aria-label="Состояние" value={condition} onChange={e => setCondition(e.target.value)}>{Object.entries(conditions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Короб<input required value={boxCode} onChange={e => setBoxCode(e.target.value)}/></label>
          <button type="submit">Сохранить возврат</button>
        </fieldset>
      </form>}
      <div className="returns-table"><table><thead><tr><th>Короб</th><th>Товар / ШК</th><th>Код возврата</th><th>Состояние</th><th>Сотрудник</th></tr></thead><tbody>{batch.units.map(u => <tr key={u.id}><td>{u.boxCode}</td><td>{u.productName}<br/>{u.barcode}</td><td>{u.returnCode}</td><td>{conditions[u.condition]}</td><td>{u.scannedByName}</td></tr>)}</tbody></table></div>
      <div className="returns-toolbar"><button disabled={busy} onClick={() => download(batch.id)}>Excel для клиента</button>
      {batch.status === 'SORTING' && canWrite && <button disabled={busy || !!pending.current || !batch.units.length} onClick={() => mutate(`/returns/${batch.id}/finish`, {})}>Завершить сортировку</button>}</div>
    </>}
  </section>;
}
