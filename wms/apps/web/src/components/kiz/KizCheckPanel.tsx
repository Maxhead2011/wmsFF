import { useRef, useState } from 'react';
import { checkKizHistory, type AuthSession, type KizCheckResult } from '../../lib/api';
import { KizReviewQueuePanel } from './KizReviewQueuePanel';

// FIX: a dedicated read-only scanner view, with explicit evidence instead of inferred relabeling.
export function KizCheckPanel({ session }: { session: AuthSession }) {
  const [scan, setScan] = useState('');
  const [result, setResult] = useState<KizCheckResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  return <section className="kiz-panel">
    <h2>Проверка КИЗов</h2>
    {import.meta.env.VITE_KIZ_REVIEW_QUEUE_ENABLED==='true'&&<KizReviewQueuePanel session={session} onInspect={async kiz=>{
      if(lock.current)return;lock.current=true;setScan(kiz);setBusy(true);setError('');setResult(null);
      try{setResult(await checkKizHistory(session.accessToken,kiz));}catch(e){setError(e instanceof Error?e.message:'Не удалось проверить КИЗ.');}
      finally{lock.current=false;setBusy(false);}
    }}/>}
    <p>Отсканируйте или вставьте КИЗ. Проверка не изменяет остатки и привязки.</p>
    <form className="kiz-search" onSubmit={async event => {
      event.preventDefault(); if (lock.current || !scan.trim()) return;
      lock.current = true; setBusy(true); setError(''); setResult(null);
      try { setResult(await checkKizHistory(session.accessToken, scan.trim())); }
      catch (e) { setError(e instanceof Error ? e.message : 'Не удалось проверить КИЗ.'); }
      finally { lock.current = false; setBusy(false); }
    }}>
      <label htmlFor="kiz-history-scan">КИЗ</label>
      <input id="kiz-history-scan" autoFocus value={scan} onChange={e => setScan(e.target.value)} disabled={busy} autoComplete="off" />
      <button className="primary-button" type="submit" disabled={busy || !scan.trim()}>{busy ? 'Проверяю…' : 'Проверить'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result && !result.found && <p>КИЗ не найден в выбранном филиале.</p>}
    {result?.ambiguous && <p role="alert">Найдено несколько записей. Нужна проверка привязок.</p>}
    {result?.matches.map(m => <article key={m.id} className="kiz-queue">
      <h3>{m.product.name} · {m.product.size}</h3>
      <p>{m.client} · {m.product.article} · {m.product.color}</p>
      <p>Короб: {m.boxCode ?? 'не назначен'} · Паллет: {m.palletCode ?? 'не назначен'} · {m.room} · {m.warehouse}</p>
      <p>Учётный статус: {m.status}</p>
      {m.locationWarning && <p role="alert">{m.locationWarning}</p>}
      {m.reuse && <>
        <h3>{m.reuse.decision === 'RELABEL' ? 'Нужна переклейка' : m.reuse.decision === 'REVIEW' ? 'Нужна проверка' : 'Можно продолжить сборку'}</h3>
        <p>{m.reuse.message}</p>
        <p>Честный знак: {m.reuse.circulation ?? 'статус не подтверждён'}. Проверено: {date(m.reuse.checkedAt)}</p>
        <div className="kiz-table-wrap"><table><thead><tr><th>Заявка ВМС</th><th>Заказ WB</th><th>Событие</th><th>Дата и время, МСК</th><th>Сотрудник</th><th>Поставка WB</th></tr></thead>
          <tbody>{m.reuse.history.map((h, i) => <tr key={i}>
            <td>{h.request ? `№${String(h.request.number).padStart(6, '0')} · ${h.request.status}` : '—'}{i === 0 ? ' · первая запись' : ''}</td>
            <td>{h.orderId ?? '—'}</td><td>{h.event}</td><td>{date(h.at)}</td><td>{h.worker ?? '—'}</td><td>{h.supplyId ?? '—'}</td>
          </tr>)}</tbody>
        </table></div>
      </>}
    </article>)}
  </section>;
}
function date(value: string | null) {
  return value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'Не зафиксировано';
}
