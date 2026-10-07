import { useEffect, useRef, useState } from 'react';
import type { AuthSession, BillingInvoiceSummary } from '../../lib/api';
type Balance = { originalTotalRub: number; correctionRub: number; effectiveTotalRub: number; remainingRub: number; overpaymentRub: number };
type ClosePreview = { canClose: boolean; previewHash: string; issues: Array<{ sourceId: string; code: string; reason: string }>; snapshots: Array<{ id: string; number: string; totalRub: string }> };
type CorrectionPreview = { invoiceId: string; invoiceNumber: string; amountRub: number; reason: string; kind: string; before: Balance; after: Balance; previewHash: string };
type Close = { id: string; periodFrom: string; periodTo: string; createdAt: string; reason: string; snapshot: Array<{ id: string; number: string; totalRub: string }> };
type Note = { id: string; invoiceNumber: string; amountRub: string; kind: string; reason: string; createdAt: string; author: string };
const money = (n: unknown) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(n));
const shortDate = (d: string) => d.slice(0, 10).split('-').reverse().join('.');
// FIX: explicit client/branch close and separate signed amendments; mutations always require a current preview.
export function BillingPeriodClosingPanel({ session, clientId, periodFrom, periodTo, onChanged }: { session: AuthSession; clientId: string; periodFrom: string; periodTo: string; onChanged: () => void }) {
  const [enabled, setEnabled] = useState(false), [periods, setPeriods] = useState<Close[]>([]), [invoices, setInvoices] = useState<BillingInvoiceSummary[]>([]), [notes, setNotes] = useState<Note[]>([]);
  const [reason, setReason] = useState(''), [preview, setPreview] = useState<ClosePreview | null>(null);
  const [invoiceId, setInvoiceId] = useState(''), [amount, setAmount] = useState(''), [correctionReason, setCorrectionReason] = useState(''), [kind, setKind] = useState<'ADJUSTMENT' | 'LATE_WORK'>('ADJUSTMENT');
  const [correction, setCorrection] = useState<CorrectionPreview | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [revision, setRevision] = useState(0);
  const pending = useRef(false), key = useRef('');
  const canWrite = (session.user.permissionCodes ?? []).some(p => ['system:admin', 'billing:write'].includes(p));
  async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const r = await fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/billing/${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal });
    const data = await r.json(); if (!r.ok) throw new Error([data.message ?? `Ошибка ${r.status}`].flat().join('; ')); return data;
  }
  const query = new URLSearchParams({ clientId, periodFrom, periodTo });
  useEffect(() => {
    const abort = new AbortController(); setPreview(null); setCorrection(null); setInvoiceId(''); setMessage(''); setPeriods([]); setNotes([]); setInvoices([]); setEnabled(false);
    void api<{ enabled: boolean }>('period-close/capabilities', undefined, abort.signal).then(async capability => {
      if (abort.signal.aborted) return; setEnabled(capability.enabled); if (!capability.enabled || !clientId) return;
      const [closed, documents, history] = await Promise.all([api<Close[]>(`period-close?${query}`, undefined, abort.signal),
        api<BillingInvoiceSummary[]>(`invoices?clientId=${encodeURIComponent(clientId)}`, undefined, abort.signal), api<Note[]>(`period-close/corrections?${query}`, undefined, abort.signal)]);
      if (!abort.signal.aborted) { setPeriods(closed); setInvoices(documents.filter(i => i.status !== 'CANCELLED')); setNotes(history); }
    }).catch(e => { if (!abort.signal.aborted) setMessage(e instanceof Error ? e.message : 'Не удалось получить периоды.'); });
    return () => abort.abort();
  }, [session.accessToken, session.user.activeWarehouseId, clientId, periodFrom, periodTo, revision]);
  async function action(operation: () => Promise<void>) {
    if (pending.current) return; pending.current = true; setBusy(true); setMessage('');
    try { await operation(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Операция не завершена.'); }
    finally { pending.current = false; setBusy(false); }
  }
  function changed(text: string) { setPreview(null); setCorrection(null); setRevision(n => n + 1); onChanged(); setMessage(text); }
  if (!enabled) return null;
  if (!clientId) return <p>Для закрытия периода выберите конкретного клиента выше. Закрытие относится к текущему филиалу.</p>;
  return <section aria-label="Закрытие периода и корректировки" className="billing-settlements__details">
    <h3>Закрытие периода и корректировки</h3><p>{shortDate(periodFrom)} — {shortDate(periodTo)} · выбранный клиент и текущий филиал</p>
    <p>Закрытие фиксирует услуги и счета. Неоплаченные счета сохраняют долг, оплаты можно принимать после закрытия.</p>
    {message ? <p role="status">{message}</p> : null}
    {canWrite ? <><label>Основание закрытия<input aria-label="Основание закрытия" maxLength={1000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
      <button disabled={busy} onClick={() => void action(async () => setPreview(await api<ClosePreview>('period-close/preview', { clientId, periodFrom, periodTo })))}>Проверить перед закрытием</button>
      {preview ? <div aria-label="Проверка закрытия"><p>Счетов: {preview.snapshots.length}</p>
        {preview.issues.map(i => <p key={`${i.sourceId}:${i.code}`}>{i.reason}</p>)}
        <button disabled={busy || !preview.canClose || !reason.trim()} onClick={() => void action(async () => {
          await api('period-close', { clientId, periodFrom, periodTo, reason: reason.trim(), previewHash: preview.previewHash }); changed('Период закрыт. Исходные суммы и оплаты сохранены.');
        })}>Закрыть проверенный период</button></div> : null}</> : null}
    {periods.map(p => <details key={p.id}><summary>Закрыт {shortDate(p.periodFrom)} — {shortDate(p.periodTo)}</summary>
      <p>{shortDate(p.createdAt)} · {p.reason}</p>{p.snapshot.map(i => <p key={i.id}>{i.number} · исходная сумма {money(i.totalRub)}</p>)}</details>)}
    {canWrite ? <fieldset disabled={busy}><legend>Отдельный документ исправления</legend>
      <label>Вид<select aria-label="Вид исправления" value={kind} onChange={e => { setKind(e.target.value as typeof kind); setInvoiceId(''); setCorrection(null); }}>
        <option value="ADJUSTMENT">Доначисление или уменьшение</option><option value="LATE_WORK">Поздняя работа — отдельный счёт</option></select></label>
      <label>Исходный счёт<select aria-label="Счёт для исправления" value={invoiceId} onChange={e => { setInvoiceId(e.target.value); setCorrection(null); }}><option value="">Выберите счёт</option>
        {invoices.filter(i => kind === 'LATE_WORK' ? i.status === 'DRAFT' : ['ISSUED', 'PAID'].includes(i.status)).map(i => <option key={i.id} value={i.id}>{i.number} · {money(i.totalRub)}</option>)}</select></label>
      {kind === 'ADJUSTMENT' ? <label>Изменение суммы<input aria-label="Изменение суммы" type="number" step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setCorrection(null); }} /></label> : <p>Поздние услуги сначала формируются отдельным черновиком; основание сохраняется перед его выставлением.</p>}
      <p>Положительное значение — доначисление, отрицательное — уменьшение. Исходный счёт сохраняется.</p>
      <label>Причина исправления<textarea aria-label="Причина исправления" maxLength={1000} value={correctionReason} onChange={e => { setCorrectionReason(e.target.value); setCorrection(null); }} /></label>
      <button disabled={!invoiceId || !correctionReason.trim() || (kind === 'ADJUSTMENT' && !amount)} onClick={() => void action(async () => {
        const result = await api<CorrectionPreview>('period-close/corrections/preview', { invoiceId, amountRub: kind === 'LATE_WORK' ? '0' : amount, reason: correctionReason.trim(), kind });
        key.current = crypto.randomUUID(); setCorrection(result);
      })}>Рассчитать исправление</button>
      {correction ? <div aria-label="Предварительная корректировка"><p>{correction.invoiceNumber} · изменение {money(correction.amountRub)}</p>
        <p>Стоимость после исправления: {money(correction.after.effectiveTotalRub)}. К оплате: {money(correction.after.remainingRub)}. Переплата: {money(correction.after.overpaymentRub)}.</p>
        <button onClick={() => void action(async () => { await api('period-close/corrections', { invoiceId: correction.invoiceId, amountRub: String(correction.amountRub), reason: correction.reason,
          kind: correction.kind, previewHash: correction.previewHash, operationKey: key.current }); changed('Отдельный документ исправления сохранён.'); })}>Сохранить отдельный документ</button></div> : null}
    </fieldset> : null}
    <h4>История исправлений</h4>{notes.map(n => <p key={n.id}>{shortDate(n.createdAt)} · {n.invoiceNumber} · {money(n.amountRub)} · {n.reason} · {n.author}</p>)}
    {!notes.length ? <p>Документов исправления пока нет.</p> : null}
  </section>;
}
