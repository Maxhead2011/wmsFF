import { useEffect, useState } from 'react';
import type { AuthSession, ClientSummary } from '../../lib/api';
import { fetchSettlements, type SettlementReport, type SettlementRow, type SettlementLine } from '../../lib/billing-settlements-api';
import './billing-settlements.css';
import { BillingPeriodClosingPanel } from './BillingPeriodClosingPanel';

const metrics = [
  ['unbilledRub', 'Не выставлено', 'unbilled'], ['draftRub', 'В черновиках', 'draft'],
  ['reviewRub', 'На проверке', 'review'], ['debtRub', 'Выставлено, не оплачено', 'debt'],
  ['overdueRub', 'Из этого просрочено', 'overdue'], ['clientAdvanceRub', 'Аванс клиента · все филиалы', 'advance'],
  ['clientCreditRub', 'Переплата по счетам', 'credit'],
] as const;
const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(value);
const date = (value: string) => value.slice(0, 10).split('-').reverse().join('.');
const today = () => {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function settlementLines(row: SettlementRow, bucket: string) { return row.lines.filter(line => line.buckets.includes(bucket)); }

// FIX: one scoped report drives register, explanations and review; no financial mutations here.
export function BillingSettlementsPanel({ session, clients, revision = 0, onReview }: { session: AuthSession; clients: ClientSummary[]; revision?: number;
  onReview?: (clientId: string, section: 'charges' | 'invoices') => void }) {
  const [from, setFrom] = useState(() => `${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [clientId, setClientId] = useState('');
  const [reload, setReload] = useState(0);
  const [report, setReport] = useState<SettlementReport | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'disabled'>('loading');
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<{ row: SettlementRow; bucket: string; label: string } | null>(null);
  const [issueFilter, setIssueFilter] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    setReport(null); setSelection(null); setError(''); setStatus('loading');
    void fetchSettlements(session, { periodFrom: from, periodTo: to, clientId: clientId || undefined }, abort.signal)
      .then(result => { if (abort.signal.aborted) return;
        if (!result.enabled) { setStatus('disabled'); return; }
        setReport(result); setStatus('ready');
      }).catch(e => { if (!abort.signal.aborted) { setError(e instanceof Error ? e.message : 'Не удалось получить расчёты.'); setStatus('error'); } });
    return () => abort.abort();
  }, [session.accessToken, session.user.activeWarehouseId, from, to, clientId, reload, revision]);
  return <section className="billing-settlements" aria-label="Клиенты и расчёты">
    <header><h3>Клиенты и расчёты</h3><button type="button" onClick={() => setReload(n => n + 1)}>Обновить расчёты</button></header>
    <div className="billing-settlements__filters">
      <label>Услуги с<input aria-label="Услуги с" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>По<input aria-label="Услуги по" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      <label>Клиент<select value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Все доступные клиенты</option>
        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    </div>
    <p>Начисления и черновики — за выбранные даты услуг. Долг и просрочка — по всем выставленным счетам филиала на сейчас.
      Аванс клиента показан отдельно и не вычитается из долга филиала.</p>
    {status === 'loading' ? <p role="status">Расчёт данных…</p> : null}
    {status === 'error' ? <p role="alert">{error}</p> : null}
    {status === 'disabled' ? <p>Реестр расчётов пока не включён для этого склада.</p> : null}
    {report ? <>
      <p>{report.warehouseName} · расчёт {date(report.calculatedAt)}</p>
      <div className="billing-settlements__scroll"><table><thead><tr><th>Клиент · филиал</th>
        {metrics.map(m => <th key={m[0]}>{m[1]}</th>)}<th>Работа без начисления</th></tr></thead>
        <tbody>{report.rows.map(row => <tr key={`${row.client.id}:${row.warehouseId}`}>
          <th scope="row">{row.client.name}<small>{row.client.code} · {row.warehouseName}</small></th>
          {metrics.map(([field, label, bucket]) => <td key={field}><button type="button"
            aria-label={`${label}: ${row.client.name}, ${money(row[field] ?? 0)}`} onClick={() => setSelection({ row, bucket, label })}>{money(row[field] ?? 0)}</button></td>)}
          <td>{row.missingWorkCount} обработок · сумма требует проверки</td>
        </tr>)}</tbody></table></div>
      {/* // FIX: settled records can exist even when no client needs further calculations. */}
      {report.rows.length === 0 ? <p>Нет клиентов с задолженностью или незавершёнными расчётами по выбранным условиям.</p> : null}
      {selection ? <section aria-label="Расшифровка суммы" className="billing-settlements__details">
        <header><h4>{selection.label} · {selection.row.client.name}</h4><button type="button" onClick={() => setSelection(null)}>Закрыть расшифровку</button></header>
        {settlementLines(selection.row, selection.bucket).map(line => <Line key={line.id} line={line} />)}
        {['draft', 'debt', 'overdue'].includes(selection.bucket) ? selection.row.lines.filter(line => line.kind === 'INVOICE_ITEM' &&
          (selection.bucket !== 'draft' || (line.date.slice(0, 10) >= report.periodFrom && line.date.slice(0, 10) <= report.periodTo)) &&
          line.invoices.some(i => settlementLines(selection.row, selection.bucket).some(parent => parent.invoices.some(p => p.id === i.id))))
          .map(line => <Line key={line.id} line={line} />) : null}
        {!settlementLines(selection.row, selection.bucket).length ? <p>Нет операций в этой сумме.</p> : null}
      </section> : null}
      <section aria-label="Требует проверки"><header><h3>Требует проверки · {report.issues.length}</h3>
        <label>Причина<select value={issueFilter} onChange={e => setIssueFilter(e.target.value)}><option value="">Все причины</option>
          {[...new Map(report.issues.map(i => [i.code, i.reason])).entries()].map(([code, reason]) => <option key={code} value={code}>{reason}</option>)}
        </select></label></header>
        <p>Пропуски начислений проверяются по подтверждённым FBS-операциям WB/Ozon, включая сохранённые попытки.
          Другие услуги требуют отдельной сверки. Сумма отсутствующего начисления не оценивается автоматически.</p>
        {report.issues.filter(i => !issueFilter || i.code === issueFilter).map(issue => <article key={issue.id} className="billing-settlements__issue">
          <strong>{issue.clientName} · {issue.reason}</strong><p>{issue.action}</p><Line line={issue.line} />
          {onReview ? <button type="button" onClick={() => onReview(issue.clientId, issue.line.kind === 'INVOICE' ? 'invoices' : 'charges')}>Открыть {issue.line.kind === 'INVOICE' ? 'счета' : 'начисления'} клиента</button> : null}
        </article>)}
        {!report.issues.length ? <p>В проверенных данных исключений не найдено.</p> : null}
      </section>
    </> : null}
    <BillingPeriodClosingPanel session={session} clientId={clientId} periodFrom={from} periodTo={to} onChanged={() => setReload(n => n + 1)} />
  </section>;
}
function Line({ line }: { line: SettlementLine }) {
  return <details className="billing-settlements__line"><summary>{date(line.date)} · {line.description} · {line.totalRub === null ? 'Сумма не определена' : money(line.totalRub)}</summary>
    <dl><dt>Заявка</dt><dd>{line.requestNumber ? `№${line.requestNumber}` : line.requestId ?? 'Без связи с заявкой'}</dd>
      <dt>Заказы</dt><dd>{line.orderIds.join(', ') || 'Не указаны'}{line.marketplace ? ` · ${line.marketplace}` : ''}</dd>
      {line.connectionId ? <><dt>Кабинет</dt><dd>{line.connectionId}</dd></> : null}
      <dt>Попытка обработки</dt><dd>{line.billingAttemptId ?? 'Исходная / не указана в источнике'}</dd>
      <dt>Дата услуги</dt><dd>{date(line.date)}</dd>
      <dt>Расчёт</dt><dd>{line.quantity ?? '—'} × {line.unitPriceRub ? `${line.unitPriceRub} ₽` : 'тариф требует проверки'}</dd>
      <dt>Счета</dt><dd>{line.invoices.map(i => `${i.number} (${i.status})`).join(', ') || 'Не включено в активный счёт'}</dd>
      {line.payments?.length ? <><dt>Оплаты</dt><dd>{line.payments.map(p => `${date(p.date)} · ${money(p.amountRub)}`).join('; ')}</dd></> : null}
    </dl>
  </details>;
}
