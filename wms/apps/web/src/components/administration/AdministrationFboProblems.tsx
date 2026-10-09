import { useEffect, useRef, useState } from 'react';
import './fbo-problems.css';
import { applyFboRecovery, downloadFboPickReport, downloadFboRecoveryDocument, fetchFboPickReport, fetchFboRecoveryDetails, fetchFboRecoveryRequests, previewFboRecovery, type AuthSession, type FboPickReportFilter, type FboPickReportRow, type FboRecoveryDetails, type FboRecoveryInput, type FboRecoveryPreview, type FboRecoveryRequest } from '../../lib/api';
const actions: Record<FboRecoveryInput['action'], string> = {
    CLOSE_PICK: 'Завершить отбор по факту', ADD_BOXES: 'Добавить целые короба', PACK_UNITS: 'Восстановить упаковку отобранного товара', SPLIT_BOXES: 'Разобрать целые короба', CONFIRM_BOXES: 'Подтвердить короба', FINISH: 'Завершить упаковку и сформировать файлы', REVERSE_WRITEOFF: 'Отменить ошибочное списание одной единицы',
};
export const canManageFboProblems = (session: AuthSession) => !session.user.isDemo && session.user.roleCodes.some(r => r === 'OWNER' || r === 'ADMIN');
const moscow = (date: string) => new Date(date).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
function save(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
// FIX: every edit invalidates the preview; apply sends only its immutable server token.
export function AdministrationFboProblems({ session }: {
    session: AuthSession;
}) {
    const [search, setSearch] = useState(''), [requests, setRequests] = useState<FboRecoveryRequest[]>([]), [details, setDetails] = useState<FboRecoveryDetails | null>(null);
    const [input, setInput] = useState<FboRecoveryInput>({ action: 'CLOSE_PICK', reason: '', physicalConfirmed: false }), [preview, setPreview] = useState<FboRecoveryPreview | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [mode, setMode] = useState<'repair' | 'report'>('repair');
    const [filter, setFilter] = useState<FboPickReportFilter>({}), [rows, setRows] = useState<FboPickReportRow[] | null>(null);
    const pending = useRef(false);
    const token = session.accessToken;
    const allowed = canManageFboProblems(session);
    async function run(fn: () => Promise<void>) { if (pending.current)
        return; pending.current = true; setBusy(true); setError(''); setMessage(''); try {
        await fn();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось выполнить действие');
    }
    finally {
        pending.current = false;
        setBusy(false);
    } }
    useEffect(() => { if (allowed)
        void run(async () => setRequests(await fetchFboRecoveryRequests(token, ''))); }, [token, allowed]);
    if (!allowed)
        return null;
    function edit(change: Partial<FboRecoveryInput>) { setInput(old => ({ ...old, ...change })); setPreview(null); }
    const id = details?.request.id;
    const choices = details ? (input.action === 'CONFIRM_BOXES' ? details.boxes.map(b => b.boxCode) : details.pendingWhole) : [];
    const eligible = details?.units.filter(u => input.action === 'REVERSE_WRITEOFF' ? u.state === 'PACKED' && u.kiz : u.state === 'PICKED') ?? [];
    const toggle = (values: string[] | undefined, value: string) => values?.includes(value) ? values.filter(v => v !== value) : [...(values ?? []), value];
    return <section className="admin-card fbo-problems">
  <h2>Проблемы FBO</h2>
  <p>Выберите поставку. Исправления выполняются по физическому факту с записью причины и результата в историю.</p>
  {error && <p role="alert" className="admin-message admin-message--error">{error}</p>}{message && <p role="status">{message}</p>}
  <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
   <form onSubmit={e => { e.preventDefault(); void run(async () => setRequests(await fetchFboRecoveryRequests(token, search))); }}>
    <label>Номер или название заявки <input value={search} onChange={e => setSearch(e.target.value)}/></label> <button>Найти</button>
   </form>
   <label>Поставка <select value={id ?? ''} onChange={e => { const next = e.target.value; setDetails(null); setPreview(null); setRows(null); setInput({ action: 'CLOSE_PICK', reason: '', physicalConfirmed: false }); if (next)
        void run(async () => setDetails(await fetchFboRecoveryDetails(token, next))); }}>
    <option value="">Выберите заявку</option>{requests.map(r => <option key={r.id} value={r.id}>№{r.number} · {r.title} · {r.warehouse?.name}</option>)}
   </select></label>
   {details && id && <>
    <h3>{details.request.title}</h3>
    <p>Отобрано: {details.units.filter(u => u.state !== 'RETURNED').length} · Упаковано: {details.units.filter(u => u.state === 'PACKED').length} · Коробов: {details.boxes.length} · Подтверждено: {details.boxes.filter(b => b.confirmedAt).length}</p>
    <button type="button" onClick={() => { setPreview(null); void run(async () => setDetails(await fetchFboRecoveryDetails(token, id))); }}>Обновить</button>
    <nav aria-label="Действия FBO"><button type="button" onClick={() => setMode('repair')}>Исправление этапов</button> <button type="button" onClick={() => setMode('report')}>Отчёт об отборе коробов</button></nav>
    {mode === 'report' ? <>
     <h3>Кто, когда и с какого паллета отбирал</h3><p>Время московское. Для старых отборов без записи местоположения паллет указан как «Не зафиксирован».</p>
     {(['worker', 'pallet', 'from', 'to'] as const).map((key, i) => <label key={key}>{['Сотрудник', 'Паллет', 'С даты', 'По дату'][i]} <input type={i > 1 ? 'date' : 'text'} value={filter[key] ?? ''} onChange={e => { setFilter(f => ({ ...f, [key]: e.target.value })); setRows(null); }}/></label>)}
     <label>Упаковка <select value={filter.state ?? ''} onChange={e => { setFilter(f => ({ ...f, state: e.target.value })); setRows(null); }}><option value="">Все</option><option value="PICKED">Ожидает упаковки</option><option value="PACKED">Упакован</option><option value="RETURNED">Возвращён</option></select></label>
     <button type="button" onClick={() => void run(async () => setRows(await fetchFboPickReport(token, id, filter)))}>Показать отчёт</button>
     <button type="button" onClick={() => void run(async () => save(await downloadFboPickReport(token, id, filter), `FBO_${details.request.number}_отбор.xlsx`))}>Скачать Excel</button>
     {rows && <><p>Всего единиц: {rows.reduce((n, r) => n + r.quantity, 0)}</p><div style={{ overflowX: 'auto' }}><table><thead><tr>{['Короб', 'Паллет при отборе', 'Сотрудник', 'Время МСК', 'Способ', 'Количество', 'Упаковка', 'Короб упаковки'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}><td>{r.box}</td><td>{r.pallet}</td><td>{r.worker}</td><td>{moscow(r.at)}</td><td>{r.mode}</td><td>{r.quantity}</td><td>{r.state}</td><td>{r.target}</td></tr>)}</tbody></table></div></>}
    </> : <>
     <details><summary>Сверка коробов ({details.boxes.filter(b => b.mismatches.length).length} с расхождениями)</summary>{details.boxes.map(b => <p key={b.boxCode}>{b.boxCode} · {b.quantity} ед. · {b.confirmedAt ? 'Подтверждён' : b.closedAt ? 'Закрыт' : 'Открыт'}{b.mismatches.length ? ` · ${b.mismatches.join('; ')}` : ''}</p>)}</details>
     {details.phase === 'COMPLETED' ? <><p>Упаковка завершена. Доступны документы и отчёт.</p>{(['products', 'packages'] as const).map(kind => <button key={kind} type="button" onClick={() => void run(async () => save(await downloadFboRecoveryDocument(token, id, kind), `FBO_${details.request.number}_${kind}.xlsx`))}>{kind === 'products' ? 'Скачать товары WB' : 'Скачать короба WB'}</button>)}</> : <>
      <label>Действие <select value={input.action} onChange={e => { setInput({ action: e.target.value as FboRecoveryInput['action'], reason: input.reason, physicalConfirmed: false }); setPreview(null); }}>{Object.entries(actions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {['ADD_BOXES', 'SPLIT_BOXES', 'CONFIRM_BOXES'].includes(input.action) && <><p>Выберите короба.</p><button type="button" onClick={() => edit({ boxCodes: choices })}>Выбрать все</button>{choices.map(code => <label key={code} style={{ display: 'block' }}><input type="checkbox" checked={input.boxCodes?.includes(code) ?? false} onChange={() => edit({ boxCodes: toggle(input.boxCodes, code) })}/>{code}</label>)}</>}
      {['PACK_UNITS', 'REVERSE_WRITEOFF'].includes(input.action) && <>
       {input.action === 'PACK_UNITS' && <label>Короб упаковки <select value={input.targetBoxCode ?? ''} onChange={e => edit({ targetBoxCode: e.target.value })}><option value="">Выберите короб</option>{details.boxes.filter(b => !b.wholeBox).map(b => <option key={b.boxCode}>{b.boxCode}</option>)}</select></label>}
       <div style={{ maxHeight: 320, overflowY: 'auto' }}>{eligible.map(u => <label key={u.id} style={{ display: 'block' }}><input type="checkbox" checked={input.unitIds?.includes(u.id) ?? false} onChange={() => edit({ unitIds: input.action === 'REVERSE_WRITEOFF' ? [u.id] : toggle(input.unitIds, u.id) })}/>{u.barcode} · {u.sourceBoxCode} → {u.targetBoxCode ?? 'Не упакован'} · {u.kiz ?? 'Без КИЗ'}</label>)}</div>
      </>}
      {input.action === 'REVERSE_WRITEOFF' && <label>Ошибочное списание <select value={input.movementId ?? ''} onChange={e => edit({ movementId: e.target.value })}><option value="">Выберите движение</option>{details.movements.map(m => <option key={m.id} value={m.id}>{moscow(m.createdAt)} · {m.comment ?? m.id}</option>)}</select></label>}
      <label style={{ display: 'block' }}>Причина <textarea value={input.reason} onChange={e => edit({ reason: e.target.value })}/></label>
      <label style={{ display: 'block' }}><input type="checkbox" checked={input.physicalConfirmed} onChange={e => edit({ physicalConfirmed: e.target.checked })}/>Подтверждаю физический состав и выбранное действие</label>
      <button type="button" disabled={!input.physicalConfirmed || input.reason.trim().length < 5 || (['ADD_BOXES', 'SPLIT_BOXES', 'CONFIRM_BOXES'].includes(input.action) && !input.boxCodes?.length)} onClick={() => void run(async () => setPreview(await previewFboRecovery(token, id, input)))}>Предпросмотр изменений</button>
      {preview && <section aria-label="Предпросмотр"><h3>{actions[input.action]}</h3><p>Изменение доступного остатка: {preview.summary.availableStockChange}. Изменение остатка «В сборке»: {preview.summary.packingStockChange}.</p><p>Короба: {preview.summary.affectedBoxes.join(', ') || '—'}</p><p>Выбрано товаров: {preview.summary.units.length}</p>{preview.summary.warning && <p>{preview.summary.warning}</p>}{preview.summary.units.map(u => <p key={u.id}>{u.barcode} · {u.source} → {u.target ?? '—'} · {u.kiz ?? 'Без КИЗ'}</p>)}<button type="button" onClick={() => void run(async () => { const current = preview.token; setPreview(null); await applyFboRecovery(token, id, current); setDetails(await fetchFboRecoveryDetails(token, id)); setRows(null); setInput({ ...input, physicalConfirmed: false, boxCodes: [], unitIds: [] }); setMessage('Изменения применены и записаны в историю.'); })}>Применить изменения</button></section>}
     </>}
    </>}
   </>}
  </fieldset>
 </section>;
}
