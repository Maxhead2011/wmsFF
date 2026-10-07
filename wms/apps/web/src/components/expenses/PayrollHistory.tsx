import { useEffect, useState } from 'react';

type State = {
  kind: 'SHIFT' | 'HANDLING';
  shift?: { employeeId: string; startsAt: string; endsAt: string | null; workDate: string };
  days?: Array<{ employeeId: string; workDate: string; lunchMinutes: number | null }>;
  handling?: { startsAt: string; operation: string; palletCount: string; boxCount: number; bagCount: number; rollCount: number; status: string; shares: Array<{ employeeId: string }> };
};
export type PayrollHistoryEntry = { id: string; createdAt: string; actorName: string; action: string; canUndo: boolean; undone: boolean;
  details: { reason?: string; comment?: string; names?: Record<string, string>; before?: State; after?: State; from?: string; to?: string } };
type Page = { entries: PayrollHistoryEntry[]; nextCursor: string | null };
const actions: Record<string, string> = { SHIFT_CORRECTED: 'Исправление смены', HANDLING_CORRECTED: 'Исправление погрузки / разгрузки', CORRECTION_UNDONE: 'Отмена изменения', SHIFT_CREATED: 'Добавление смены', SHIFT_UPDATED: 'Изменение смены', SHIFT_CANCELLED: 'Отмена смены', HANDLING_UPDATED: 'Изменение работы', HANDLING_CANCELLED: 'Отмена работы', HANDLING_CONFIRMED: 'Подтверждение работы', HISTORY_UPDATED: 'Исправление импортированного табеля', PAYMENT_STATUS: 'Статус оплаты', EMPLOYEE_CREATED: 'Добавление сотрудника', EMPLOYEE_UPDATED: 'Изменение карточки сотрудника', EMPLOYEE_IDENTITY_LINKED: 'Объединение карточек', CONDITION_CREATED: 'Условия оплаты', HISTORY_IMPORTED: 'Импорт табеля' };
const dateTime = (s?: string | null) => s ? new Date(s).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'Не указано';
// FIX: show business fields from the correction snapshot instead of internal database metadata.
export function payrollHistoryValues(state: State | undefined, names: Record<string, string> = {}): Array<[string, string]> {
  if (state?.shift) {
    const s = state.shift, day = state.days?.find(d => d.employeeId === s.employeeId && d.workDate === s.workDate);
    return [['Сотрудник', names[s.employeeId] || s.employeeId], ['Начало', dateTime(s.startsAt)], ['Окончание', dateTime(s.endsAt)], ['Обед за день', day?.lunchMinutes == null ? 'По отметкам / автоматически' : `${day.lunchMinutes} мин`]];
  }
  if (state?.handling) {
    const h = state.handling;
    return [['Участники', h.shares.map(s => names[s.employeeId] || s.employeeId).join(', ')], ['Начало', dateTime(h.startsAt)], ['Работа', h.operation === 'LOAD' ? 'Погрузка' : 'Разгрузка'], ['Палеты', String(h.palletCount)], ['Короба', String(h.boxCount)], ['Мешки', String(h.bagCount)], ['Рулоны', String(h.rollCount)], ['Состояние', h.status === 'CONFIRMED' ? 'Подтверждено' : h.status === 'REVIEW' ? 'На проверке' : 'Отменено']];
  }
  return [];
}
export function PayrollHistory({ api }: { api: <T>(path: string, method?: 'GET' | 'POST' | 'PUT', body?: unknown) => Promise<T> }) {
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 7) + '-01'), [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [page, setPage] = useState<Page>({ entries: [], nextCursor: null });
  const [selected, setSelected] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const entry = page.entries.find(e => e.id === selected);
  async function load(cursor?: string) {
    setBusy(true); setError('');
    try { const result = await api<Page>(`/history?from=${from}&to=${to}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); setPage(p => cursor ? { entries: [...p.entries, ...result.entries], nextCursor: result.nextCursor } : result); if (!cursor) setSelected(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось загрузить историю'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  return <section aria-label="История изменений ФОТ">
    <h3>История изменений</h3><p>Выберите изменение, проверьте значения до и после и нажмите «Отменить изменение».</p>
    <form onSubmit={e => { e.preventDefault(); setMessage(''); void load(); }}><div className="payroll-fields">
      <label>Изменения с даты<input aria-label="История с даты" type="date" required disabled={busy} value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>По дату<input aria-label="История по дату" type="date" required disabled={busy} value={to} onChange={e => setTo(e.target.value)} /></label>
      <button disabled={busy}>Обновить историю</button></div></form>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="payroll-table"><table><thead><tr><th>Выбрать</th><th>Когда, МСК</th><th>Кто изменил</th><th>Изменение</th><th>Причина</th></tr></thead>
      <tbody>{page.entries.map(e => <tr key={e.id}><td><input type="radio" name="payrollHistoryEntry" aria-label={`Выбрать изменение ${dateTime(e.createdAt)} ${e.actorName}`} checked={selected === e.id} disabled={busy} onChange={() => { setSelected(e.id); setReason(''); setMessage(''); setError(''); }} /></td><td>{dateTime(e.createdAt)}</td><td>{e.actorName}</td><td>{actions[e.action] || 'Изменение ФОТ'}{e.undone && ' · отменено'}</td><td>{e.details.reason || e.details.comment || '—'}</td></tr>)}</tbody></table></div>
    {!busy && !page.entries.length && <p>Изменений за период нет.</p>}
    {page.nextCursor && <button disabled={busy} onClick={() => void load(page.nextCursor!)}>Показать ещё</button>}
    {entry && <section aria-label="Выбранное изменение"><h4>{actions[entry.action] || 'Изменение ФОТ'}</h4>
      <div className="payroll-fields">{(['before', 'after'] as const).map(key => <div key={key}><strong>{key === 'before' ? 'Было' : 'Стало'}</strong><dl>{payrollHistoryValues(entry.details[key], entry.details.names).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>)}</div>
      {entry.canUndo ? <form onSubmit={e => { e.preventDefault(); setBusy(true); setError(''); void api(`/history/${encodeURIComponent(entry.id)}/undo`, 'POST', { reason }).then(async () => { await load(); setReason(''); setMessage('Изменение отменено. Результат сохранён в истории.'); }).catch(e => setError(e instanceof Error ? e.message : 'Не удалось отменить изменение')).finally(() => setBusy(false)); }}>
        <p>Отмена восстановит данные до выбранного исправления. Если запись уже оплачена или после неё были другие изменения, отмена будет заблокирована.</p>
        <label>Причина отмены<input aria-label="Причина отмены изменения" required maxLength={1000} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <button disabled={busy || !reason.trim()}>Отменить изменение</button>
      </form> : <p>{entry.undone ? 'Это изменение уже отменено.' : 'Для этой записи отмена недоступна: полный снимок восстановления не сохранён или это служебное событие.'}</p>}
    </section>}
  </section>;
}
