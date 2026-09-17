import { useEffect, useRef, useState, type FormEvent } from 'react';
import { fetchWbPrintCheck, type WbPrintCheckReport } from '../../lib/api';

const time = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—';
const kiz = (value: string | null) => value?.replace(/\u001d/g, '<GS>') || 'Не записан';
export function printStatus(status: string) {
  return ({ PRINTED: 'Печать подтверждена агентом', QUEUED: 'Ожидает печати', CLAIMED: 'Забрано агентом, подтверждения печати нет', FAILED: 'Ошибка печати', CANCELLED: 'Печать отменена' } as Record<string, string>)[status] ?? status;
}
const wbStatus = (value: string) => ({ ACCEPTED: 'Принят WB — по записи ВМС', PENDING: 'Ожидает подтверждения', NOT_REQUIRED: 'Не требовался', UNKNOWN: 'Нет данных о подтверждении' } as Record<string,string>)[value] ?? value;

// FIX: a label-generation record is not proof that the print agent completed the job.
export function WbPrintCheckResults({ report }: { report: WbPrintCheckReport }) {
  return <div aria-live="polite">
    <h3>Заказ №{report.orderId}</h3>
    <p>Проверено: {time(report.checkedAt)} МСК. Статус WB — по сохранённым данным ВМС.</p>
    {!report.results.length && <p>По этому заказу нет доступных записей сборки или печати.</p>}
    {report.results.length > 1 && <p>Найдено записей: {report.results.length}. Кабинеты и попытки сборки показаны отдельно.</p>}
    {report.results.map((r, index) => <article className="service-card" key={`${r.clientId}:${r.id}`}>
      <h3>{r.clientName} · {r.connectionName || 'Кабинет не указан'}{r.archived ? ' · Архивная запись' : ''}</h3>
      <p>{r.requestNumber ? `Заявка №${String(r.requestNumber).padStart(6, '0')}` : 'Без заявки'} · {r.warehouseName || 'Филиал не определён'}</p>
      <p><strong>{r.productName || 'Товар не указан'}</strong><br/>{r.article} · ШК {r.barcode || '—'} · Короб {r.boxCode || '—'}</p>
      <p><strong>Привязка КИЗа:</strong> {wbStatus(r.wbMetaStatus)}<br/><code style={{ overflowWrap: 'anywhere' }}>{kiz(r.kiz)}</code></p>
      {r.errorMessage && <p role="alert">{r.errorMessage}</p>}
      <div style={{ overflowX: 'auto' }}><table className="data-table" aria-label={`События сборки ${index + 1}`}><thead><tr><th>Событие</th><th>Время МСК</th><th>Сотрудник</th><th>Короб / КИЗ</th></tr></thead><tbody>
        {r.scans.map((s, i) => <tr key={i}><td>{s.action === 'FBS_KIZ_SCAN_ACCEPTED' ? 'КИЗ отсканирован' : 'КИЗ заменён после отбора'}</td><td>{time(s.at)}</td><td>{s.worker || '—'}</td><td>{s.boxCode || '—'}<br/><code style={{ overflowWrap: 'anywhere' }}>{kiz(s.kiz)}</code></td></tr>)}
        {!r.scans.length && <tr><td colSpan={4}>Отдельной записи сканирования КИЗа не найдено.</td></tr>}
        {r.completedAt && <tr><td>Сборка завершена</td><td>{time(r.completedAt)}</td><td>{r.workerName || '—'}</td><td>{r.boxCode || '—'}</td></tr>}
      </tbody></table></div>
      <h4>Печать этикетки WB</h4>
      {!r.prints.length && <p>Подтверждения печати от агента нет.</p>}
      {r.prints.map(p => <section key={p.id} className="service-card">
        <strong>{printStatus(p.status)}</strong>
        <p>{p.deviceCode?.startsWith('SOS-WB:') ? 'SOS WB2' : p.source} · {p.station.name} · {p.station.printerName}</p>
        <p>Запросил: {p.requestedBy}, {time(p.createdAt)} МСК<br/>Агент забрал: {time(p.claimedAt)}<br/>Печать подтверждена: {p.status === 'PRINTED' ? time(p.printedAt) : 'Нет'}<br/>Попыток: {p.attempts}</p>
        <p>Стикер: {[r.stickerPartA, r.stickerPartB].filter(Boolean).join(' ') || p.stickerCode || '—'} · Код: {p.stickerCode || '—'}</p>
        <p>КИЗ задания печати: <code style={{ overflowWrap: 'anywhere' }}>{kiz(p.kiz)}</code></p>
        {r.kiz && kiz(p.kiz) !== kiz(r.kiz) && <p role="alert">КИЗ задания печати отличается от КИЗа этой сборки.</p>}
        {p.errorMessage && <p role="alert">Ошибка: {p.errorMessage} · {time(p.failedAt)}</p>}
      </section>)}
      {r.labelRequests.filter(h => !h.hasPrintJob).map((h, i) => <p key={i}>Этикетка сформирована/запрошена: {time(h.at)}, {h.worker}. Подтверждения агента для этой записи нет.</p>)}
    </article>)}
  </div>;
}

export function WbPrintCheckPanel({ accessToken }: { accessToken: string }) {
  const [orderId, setOrderId] = useState(''), [report, setReport] = useState<WbPrintCheckReport | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, [accessToken]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = orderId.trim().replace(/^№\s*/, '');
    if (!/^[1-9]\d{0,19}$/.test(value)) { setError('Введите номер заказа WB — только цифры.'); return; }
    const current = ++generation.current;
    setBusy(true); setError(''); setReport(null);
    try { const result = await fetchWbPrintCheck(accessToken, value); if (current === generation.current) setReport(result); }
    catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : 'Не удалось проверить печать.'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  return <section aria-label="Проверка печати WB">
    <h3>Проверка печати WB</h3>
    <form onSubmit={submit} className="service-card"><label>Номер заказа WB<input inputMode="numeric" value={orderId} placeholder="Например, 5786259714" onChange={e => { generation.current++; setOrderId(e.target.value); setReport(null); setError(''); setBusy(false); }}/></label><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Проверяю…' : 'Проверить'}</button></form>
    {error && <p role="alert">{error}</p>}
    {report && <WbPrintCheckResults report={report}/>}
  </section>;
}
