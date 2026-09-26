import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { AuthSession, BranchSummary, fetchBranches, payrollDownload, payrollImport, payrollRequest } from '../../lib/api';
import './payroll.css';

type Employee = { id: string; name: string; warehouseId: string; userId?: string | null; picker: boolean; loader: boolean; isActive: boolean; paymentMethod: string; paymentPhone?: string | null; paymentBank?: string | null; rates: Array<{ id: string; kind: string; rateKopecks: number; startsAt: string; endsAt?: string; temporary: boolean }> };
type Row = { key: string; employeeId: string; date: string; kind: string; amountKopecks: number; status: string; units?: number; workedMs?: number; lunchMs?: number; detail: { id?: string; status?: string; palletCount?: number } };
type Report = { rows: Row[]; issues: string[]; totals: { amountKopecks: number; paidKopecks: number } };
const money = (n: number) => (n / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' });
const statuses: Record<string, string> = { UNPAID: 'Не оплачено', REVIEW: 'На проверке', PAID: 'Оплачено' };
const kinds: Record<string, string> = { HOURLY: 'За час', PIECE: 'За единицу', PALLET: 'За паллету', HISTORY: 'История' };
const hours = (ms = 0) => { const minutes = Math.round(ms / 60000); return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`; };
// FIX: imported timesheets show their preserved hours and lunch alongside new shifts.
export function payrollTimeCells(row: Pick<Row, 'kind' | 'workedMs' | 'lunchMs' | 'units' | 'detail'>) {
  return ['HOURLY', 'HISTORY'].includes(row.kind) ? [hours(row.workedMs), hours(row.lunchMs)] : [row.units ?? row.detail.palletCount, '—'];
}
const iso = (s: string) => `${s}:00+03:00`;
const blank = { name: '', warehouseId: '', userId: '', picker: true, loader: false, isActive: true, paymentMethod: 'UNSPECIFIED', paymentPhone: '', paymentBank: '' };

// FIX: preserve the legacy workspace until the separately gated payroll module is enabled.
export function PayrollManagement({ session, legacy }: { session: AuthSession; legacy: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState('work');
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState('');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 7) + '-01');
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<Report | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ rows: unknown[]; employees: string[]; issues: string[]; totalKopecks: number } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [shifts, setShifts] = useState<Array<{ id: string; startsAt: string; endsAt: string | null; reason: string }>>([]);
  const [shiftEdit, setShiftEdit] = useState('');
  const employee = employees.find(e => e.id === selected);
  const api = <T,>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown) => payrollRequest<T>(session.accessToken, path, method, body);
  async function loadEmployees() {
    const rows = await api<Employee[]>('/employees'); setEmployees(rows);
  }
  async function run(action: () => Promise<void>) {
    setError(''); setMessage(''); setBusy(true);
    try { await action(); setMessage('Сохранено'); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let live = true;
    api<{ enabled: boolean }>('/capabilities').then(async result => {
      if (!live || !result.enabled) return;
      setEnabled(true);
      const [people, warehouses, pickingUsers] = await Promise.all([api<Employee[]>('/employees'), fetchBranches(session.accessToken), api<Array<{ id: string; name: string }>>('/picking-users')]);
      if (live) { setEmployees(people); setBranches(warehouses); setUsers(pickingUsers); }
    }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [session.accessToken]);
  useEffect(() => {
    setReport(null); setChecked([]);
    setShifts([]); setShiftEdit('');
    if (!enabled || !selected) return;
    let live = true;
    if (selected === '__all') {
      Promise.all(employees.map(p => api<Report>(`/employees/${encodeURIComponent(p.id)}/report?from=${from}&to=${to}`))).then(reports => {
        if (live) setReport({ rows: reports.flatMap(r => r.rows), issues: reports.flatMap((r, i) => r.issues.map(s => `${employees[i].name}: ${s}`)), totals: { amountKopecks: reports.reduce((s, r) => s + r.totals.amountKopecks, 0), paidKopecks: reports.reduce((s, r) => s + r.totals.paidKopecks, 0) } });
      }).catch(e => { if (live) setError(e.message); });
      return () => { live = false; };
    }
    api<Report>(`/employees/${encodeURIComponent(selected)}/report?from=${from}&to=${to}`)
      .then(r => { if (live) setReport(r); }).catch(e => { if (live) setError(e.message); });
    api<typeof shifts>(`/employees/${encodeURIComponent(selected)}/shifts`).then(r => { if (live) setShifts(r); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [selected, from, to, enabled]);
  async function reloadReport() {
    if (selected) { setReport(await api<Report>(`/employees/${encodeURIComponent(selected)}/report?from=${from}&to=${to}`)); setShifts(await api<typeof shifts>(`/employees/${selected}/shifts`)); }
    setChecked([]);
  }
  if (!enabled) return <>{error && <p role="alert">{error}</p>}{legacy}</>;
  const visibleRows = report?.rows.filter(r => tab === 'handling' ? r.kind === 'PALLET' : r.kind !== 'PALLET') ?? [];
  return <section className="payroll-management">
    <nav className="payroll-tiles" aria-label="Разделы ФОТ">{[['work', 'Табель и начисления'], ['handling', 'Погрузка и разгрузка'], ['settings', 'Настройки']].map(([value, label]) =>
      <button key={value} className={tab === value ? 'is-active' : ''} onClick={() => { setTab(value); setChecked([]); }}>{label}</button>)}</nav>
    {error && <p role="alert" className="panel-message panel-message--error">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="payroll-fields">
      <label>Сотрудник<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Выберите сотрудника</option><option value="__all">Все доступные сотрудники</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name}{e.isActive ? '' : ' · архив'}</option>)}</select></label>
      <label>С даты<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>По дату<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
    </div>
    {tab === 'settings' ? <>
      <details><summary>Перенос исторического табеля</summary><p>Старые часы, суммы и статусы сохраняются без перерасчёта по новым правилам. Сначала проверьте соответствие сотрудников.</p>
        <input type="file" accept=".xlsx" aria-label="Исторический табель" onChange={e => { const file = e.target.files?.[0]; setImportFile(file ?? null); setPreview(null); setMapping({}); if (file) void run(async () => setPreview(await payrollImport(session.accessToken, file))); }} />
        {preview && <><p>Строк: {preview.rows.length}. Сумма: {money(preview.totalKopecks)}.</p>{preview.issues.map((s, i) => <p role="alert" key={i}>{s}</p>)}
          <div className="payroll-fields">{preview.employees.map(name => <label key={name}>{name}<select required value={mapping[name] ?? ''} onChange={e => setMapping({ ...mapping, [name]: e.target.value })}><option value="">Выберите сотрудника WMS</option>{employees.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>)}</div>
          <button disabled={busy || !!preview.issues.length || preview.employees.some(name => !mapping[name])} onClick={() => void run(async () => { const result = await payrollImport<{ added: number; skipped: number }>(session.accessToken, importFile!, mapping); setPreview(null); setImportFile(null); await reloadReport(); setMessage(`Добавлено: ${result.added}; уже существуют: ${result.skipped}`); })}>Подтвердить перенос</button>
        </>}
      </details>
      <button onClick={() => { setEditing(''); setDraft({ ...blank, warehouseId: session.user.activeWarehouseId ?? '' }); }}>Новый сотрудник</button>
      {employee && <button onClick={() => { setEditing(employee.id); setDraft({ ...employee, userId: employee.userId ?? '', paymentPhone: employee.paymentPhone ?? '', paymentBank: employee.paymentBank ?? '' }); }}>Редактировать выбранного</button>}
      <form onSubmit={e => { e.preventDefault(); void run(async () => { await api(`/employees${editing ? '/' + encodeURIComponent(editing) : ''}`, editing ? 'PUT' : 'POST', { name: draft.name, userId: draft.userId || undefined, warehouseId: draft.warehouseId, picker: draft.picker, loader: draft.loader, isActive: draft.isActive, paymentMethod: draft.paymentMethod, paymentPhone: draft.paymentPhone, paymentBank: draft.paymentBank }); await loadEmployees(); }); }}>
        <h3>{editing ? 'Карточка сотрудника' : 'Добавить сотрудника'}</h3><div className="payroll-fields">
        <label>Имя<input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>Пользователь сборки (для сдельной оплаты)<select value={draft.userId} onChange={e => setDraft({ ...draft, userId: e.target.value })}><option value="">Не привязан</option>{users.map(u => <option value={u.id} key={u.id}>{u.name}</option>)}</select></label>
        <label>Филиал<select required value={draft.warehouseId} onChange={e => setDraft({ ...draft, warehouseId: e.target.value })}><option value="">Выберите филиал</option>{branches.map(b => <option value={b.id} key={b.id}>{b.name}</option>)}</select></label>
        <label>Способ выплаты<select value={draft.paymentMethod} onChange={e => setDraft({ ...draft, paymentMethod: e.target.value })}><option value="UNSPECIFIED">Не указан</option><option value="CASH">Наличные</option><option value="TRANSFER">Перевод</option></select></label>
        {draft.paymentMethod === 'TRANSFER' && <><label>Телефон для перевода<input type="tel" required value={draft.paymentPhone} onChange={e => setDraft({ ...draft, paymentPhone: e.target.value })} /></label><label>Банк<input required value={draft.paymentBank} onChange={e => setDraft({ ...draft, paymentBank: e.target.value })} /></label></>}
        </div><label><input type="checkbox" checked={draft.picker} onChange={e => setDraft({ ...draft, picker: e.target.checked })} />Сборщик</label>
        <label><input type="checkbox" checked={draft.loader} onChange={e => setDraft({ ...draft, loader: e.target.checked })} />Грузчик</label>
        <label><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />Активен</label>
        <button disabled={busy}>Сохранить сотрудника</button>
      </form>
      {employee && <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(async () => {
        await api(`/employees/${selected}/conditions`, 'POST', { kind: f.get('kind'), rateKopecks: Math.round(Number(f.get('rate')) * 100), startsAt: iso(String(f.get('start'))), endsAt: f.get('end') ? iso(String(f.get('end'))) : undefined, temporary: f.get('temporary') === 'on', reason: f.get('reason') }); await loadEmployees(); await reloadReport();
      }); }}><h3>Ставки и индивидуальные условия · {employee.name}</h3><div className="payroll-fields">
        <label>Тип оплаты<select name="kind">{Object.entries(kinds).filter(([k]) => k !== 'HISTORY').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Ставка, ₽<input name="rate" type="number" min="0" step="0.01" required /></label>
        <label>Начало, МСК<input name="start" type="datetime-local" required /></label><label>Окончание, МСК<input name="end" type="datetime-local" /></label>
        <label>Основание<input name="reason" required /></label></div><label><input type="checkbox" name="temporary" />Временное условие (нужна дата окончания)</label><button disabled={busy}>Добавить условие</button>
        <ul>{employee.rates.map(r => <li key={r.id}>{kinds[r.kind]}: {money(r.rateKopecks)} · {new Date(r.startsAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} — {r.endsAt ? new Date(r.endsAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'бессрочно'}{r.temporary ? ' · индивидуальное' : ''}</li>)}</ul>
      </form>}
    </> : <>
      {employee && <form onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(async () => {
        if (tab === 'work') await api(`/employees/${selected}/shifts${shiftEdit ? '/' + shiftEdit : ''}`, shiftEdit ? 'PUT' : 'POST', { startsAt: iso(String(f.get('start'))), endsAt: f.get('end') ? iso(String(f.get('end'))) : undefined, reason: f.get('reason') });
        else await api('/handling', 'POST', { warehouseId: employee.warehouseId, startsAt: iso(String(f.get('start'))), operation: f.get('operation'), palletCount: Number(f.get('pallets')) / (f.get('unit') === 'BOX' ? 16 : f.get('unit') === 'BAG' ? 5 : 1), employeeIds: f.getAll('participant'), reason: f.get('reason') });
        await reloadReport();
      }); }}><h3>{tab === 'work' ? 'Добавить приход и уход' : 'Добавить работу'}</h3><div className="payroll-fields">
        <label>Начало, МСК<input type="datetime-local" name="start" required /></label>
        {tab === 'work' ? <><label>Уход, МСК<input type="datetime-local" name="end" /></label><label>Запись<select value={shiftEdit} onChange={e => setShiftEdit(e.target.value)}><option value="">Новая смена</option>{shifts.map(s => <option key={s.id} value={s.id}>Исправить: {new Date(s.startsAt).toLocaleString('ru-RU')} — {s.endsAt ? new Date(s.endsAt).toLocaleString('ru-RU') : 'открыта'}</option>)}</select></label></> : <><label>Работа<select name="operation"><option value="UNLOAD">Разгрузка</option><option value="LOAD">Погрузка</option></select></label><label>Количество<input type="number" min="0.0001" step="0.0001" name="pallets" required /></label><label>Единица<select name="unit"><option value="PALLET">Паллеты</option><option value="BOX">Коробки (16 = паллета)</option><option value="BAG">Мешки (5 = паллета)</option></select></label></>}
        <label>Комментарий / основание<input name="reason" required /></label></div>
        {tab === 'handling' && <fieldset><legend>Все участники работы</legend>{employees.filter(e => e.warehouseId === employee.warehouseId && e.isActive).map(e => <label key={e.id}><input type="checkbox" name="participant" value={e.id} />{e.name}</label>)}</fieldset>}
        <button disabled={busy}>Сохранить</button>
      </form>}
      {report && <><p>Начислено: <strong>{money(report.totals.amountKopecks)}</strong> · Оплачено: {money(report.totals.paidKopecks)}</p>
        <div>{['xlsx', 'pdf'].map(format => <button key={format} disabled={busy || !employee} onClick={() => void run(async () => {
          const blob = await payrollDownload(session.accessToken, selected, from, to, format); const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `Табель_${from}_${to}.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        })}>Скачать {format.toUpperCase()}</button>)}</div>
        {report.issues.map((issue, i) => <p role="alert" key={i}>{issue}</p>)}
        <div className="payroll-table"><table><thead><tr><th><input aria-label="Выбрать все строки" type="checkbox" checked={visibleRows.length > 0 && visibleRows.every(r => checked.includes(r.key))} onChange={e => setChecked(e.target.checked ? visibleRows.map(r => r.key) : [])} /></th><th>Дата</th><th>Оплата</th><th>Время / единицы</th><th>Обед</th><th>Сумма</th><th>Статус</th></tr></thead>
        <tbody>{visibleRows.map(r => <tr key={r.key}><td><input type="checkbox" checked={checked.includes(r.key)} aria-label={`Выбрать ${r.date}`} onChange={e => setChecked(e.target.checked ? [...checked, r.key] : checked.filter(k => k !== r.key))} /></td><td>{r.date}<br /><small>{employees.find(e => e.id === r.employeeId)?.name}</small></td><td>{kinds[r.kind]}</td><td>{payrollTimeCells(r)[0]}</td><td>{payrollTimeCells(r)[1]}</td><td>{money(r.amountKopecks)}</td><td>{statuses[r.status]}{r.kind === 'PALLET' && r.detail.status === 'REVIEW' && <button disabled={busy} onClick={() => void run(async () => { await api(`/handling/${r.detail.id}/confirm`, 'POST'); await reloadReport(); })}>Подтвердить работу</button>}</td></tr>)}</tbody></table></div>
        {employee ? <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(async () => { await api('/statuses', 'POST', { employeeId: selected, dateFrom: from, dateTo: to, keys: checked, status: f.get('status'), comment: f.get('comment') }); await reloadReport(); }); }}><div className="payroll-fields"><label>Статус выбранных<select name="status">{Object.entries(statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Комментарий<input name="comment" /></label></div><button disabled={busy || !checked.length}>Применить к {checked.length} строкам</button></form> : <p>Для изменения статуса и личной выгрузки выберите сотрудника.</p>}
      </>}
    </>}
  </section>;
}
