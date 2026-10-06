import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { AuthSession, BranchSummary, fetchBranches, payrollDownload, payrollImport, payrollRequest, payrollAttendancePhoto } from '../../lib/api';
import './payroll.css';
import { PayrollHistory } from './PayrollHistory';

type Employee = { id: string; payrollPrimaryId?: string | null; name: string; warehouseId: string; userId?: string | null; picker: boolean; loader: boolean; isActive: boolean; paymentMethod: string; paymentPhone?: string | null; paymentBank?: string | null; rates: Array<{ id: string; kind: string; rateKopecks: number; startsAt: string; endsAt?: string; temporary: boolean }> };
type Row = { key: string; employeeId: string; date: string; kind: string; amountKopecks: number; status: string; units?: number; workedMs?: number; lunchMs?: number; detail: { correctionToken?: string; lunchOverride?: number | null; id?: string; status?: string; warehouseId?: string; startsAt?: string; operation?: string; shares?: Array<{ employeeId: string }>; palletCount?: number; boxCount?: number; bagCount?: number; rollCount?: number; unitRateKopecks?: number; start?: number; end?: number; rate?: number; shifts?: Array<{ id: string; start: string; end: string; version?: number }>; segments?: Array<{ start: string; end: string; rateKopecks: number }> } };
type Report = { rows: Row[]; issues: string[]; totals: { amountKopecks: number; paidKopecks: number } };
const money = (n: number) => (n / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' });
const statuses: Record<string, string> = { UNPAID: 'Не оплачено', REVIEW: 'На проверке', PAID: 'Оплачено' };
const kinds: Record<string, string> = { HOURLY: 'За час', PIECE: 'За единицу', PALLET: 'За паллету', HISTORY: 'История' };
const hours = (ms = 0) => { const minutes = Math.round(ms / 60000); return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`; };
// FIX: imported timesheets show their preserved hours and lunch alongside new shifts.
export function payrollTimeCells(row: Pick<Row, 'kind' | 'workedMs' | 'lunchMs' | 'units' | 'detail'>) {
  return ['HOURLY', 'HISTORY'].includes(row.kind) ? [hours(row.workedMs), hours(row.lunchMs)] : [row.units ?? row.detail.palletCount, '—'];
}
const iso = (s: string) => `${s.length === 16 ? s + ':00' : s}+03:00`;
// FIX: preserve seconds/milliseconds when only lunch or the reason is changed.
export const payrollLocalTime = (s: string) => s ? new Date(Date.parse(s) + 3 * 3600000).toISOString().slice(0, 19) : '';
// FIX: datetime-local normalizes :00 seconds away; compare displayed instants before preserving the original precision.
export const payrollEditedTime = (value: string, original: string) => original && value && Date.parse(iso(value)) === Date.parse(iso(payrollLocalTime(original))) ? original : iso(value);
// FIX: initial conditions use only the new employee form, never another employee's rates.
export function payrollInitialConditions(form: FormData, loader: boolean) {
  const rows: Array<{ kind: string; rateKopecks: number; startsAt: string }> = [];
  for (const [field, kind] of [['initialRate', String(form.get('initialKind') || 'HOURLY')], ['initialPalletRate', 'PALLET']]) {
    if (kind === 'PALLET' && !loader) continue;
    const value = String(form.get(field) ?? '').trim();
    if (!value) continue;
    const rateKopecks = payrollOperationTariff(value);
    const start = String(form.get('initialStart') ?? '');
    if (!start) throw new Error('Укажите начало действия тарифа.');
    rows.push({ kind, rateKopecks: rateKopecks!, startsAt: iso(start) });
  }
  return rows;
}
// FIX: format only for display; preserve ISO values for API filters and chronological sorting.
export const payrollDate = (value: string) => value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1');
type SortKey = 'date' | 'name' | 'bank' | 'status';
type SortDirection = 'asc' | 'desc';
type EmployeeStatusFilter = 'all' | 'active' | 'inactive';
// FIX: filter current staff status without deleting access to archived timesheets.
export function payrollFilterEmployees<T extends { isActive: boolean }>(people: T[], status: EmployeeStatusFilter): T[] {
  return people.filter(p => status === 'all' || p.isActive === (status === 'active'));
}
export function payrollSortRows<T extends { employeeId: string; date: string; key: string; status?: string }>(rows: T[],
  people: Array<Pick<Employee, 'id' | 'name' | 'paymentMethod' | 'paymentBank'>>, key: SortKey, direction: SortDirection) {
  const lookup = new Map(people.map(p => [p.id, p]));
  const value = (r: T, field: SortKey) => {
    const p = lookup.get(r.employeeId);
    return field === 'status' ? r.status ?? '' : field === 'date' ? r.date : field === 'name' ? p?.name ?? '' : p?.paymentMethod === 'CASH' ? 'Наличные' : p?.paymentBank ?? '';
  };
  return [...rows].sort((a, b) => (direction === 'asc' ? 1 : -1) * value(a, key).localeCompare(value(b, key), 'ru')
    || value(a, 'name').localeCompare(value(b, 'name'), 'ru') || a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}
// FIX: historical times remain verbatim; real shifts retain overnight dates and separate visits.
export function payrollIntervalCells(row: Pick<Row, 'kind' | 'detail'>): [string, string] {
  if (row.kind === 'HISTORY') {
    const clock = (v?: number) => v === undefined ? '—' : hours(Math.round((v % 1) * 86400000));
    return [clock(row.detail.start), clock(row.detail.end)];
  }
  if (row.kind !== 'HOURLY') return ['—', '—'];
  const intervals: Array<{ start: string; end: string }> = [];
  for (const segment of row.detail.segments ?? []) {
    const previous = intervals[intervals.length - 1];
    if (previous && Date.parse(previous.end) === Date.parse(segment.start)) previous.end = segment.end;
    else intervals.push({ start: segment.start, end: segment.end });
  }
  const time = (v: string) => new Date(v).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return [intervals.map(i => time(i.start)).join('\n') || '—', intervals.map(i => time(i.end)).join('\n') || '—'];
}
const blank = { name: '', warehouseId: '', userId: '', picker: true, loader: false, isActive: true, paymentMethod: 'UNSPECIFIED', paymentPhone: '', paymentBank: '' };
const employeeDraft = (employee: Employee) => ({ name: employee.name, warehouseId: employee.warehouseId, userId: employee.userId ?? '',
  picker: employee.picker, loader: employee.loader, isActive: employee.isActive, paymentMethod: employee.paymentMethod,
  paymentPhone: employee.paymentMethod === 'TRANSFER' ? employee.paymentPhone ?? '' : '', paymentBank: employee.paymentMethod === 'TRANSFER' ? employee.paymentBank ?? '' : '' });

// FIX: display payout contacts next to totals for the selected period and visible kind of work.
export const payrollIdentityId = (p: {id: string; payrollPrimaryId?: string | null}) => p.payrollPrimaryId || p.id;
// FIX: status filtering and totals use the same visible selection; hidden rows never enter a payment.
export function payrollFilterRows<T extends {status:string}>(rows:T[],status:string):T[] { return rows.filter(r=>status==='all'||r.status===status); }
export function payrollSelectedTotal(rows:Array<Pick<Row,'key'|'status'|'amountKopecks'>>,keys:string[]) {
  const selected=new Set(keys);return rows.filter(r=>selected.has(r.key)&&r.status==='UNPAID').reduce((sum,r)=>sum+r.amountKopecks,0);
}
export function payrollPaymentSummary(people: Array<Pick<Employee, 'id' | 'name' | 'paymentMethod' | 'paymentPhone' | 'paymentBank' | 'payrollPrimaryId'>>,
  rows: Array<Pick<Row, 'employeeId' | 'amountKopecks' | 'status'>>, selected: string) {
  const selectedPerson=people.find(p=>p.id===selected);
  const roots=people.filter(p=>!p.payrollPrimaryId);
  return roots.filter(p => selected === '__all' || p.id === (selectedPerson ? payrollIdentityId(selectedPerson) : selected)).map(p => {
    const ids=new Set(people.filter(member=>payrollIdentityId(member)===p.id).map(member=>member.id));
    const own = rows.filter(r => ids.has(r.employeeId));
    const sum = (status?: string) => own.filter(r => !status || r.status === status).reduce((total, r) => total + r.amountKopecks, 0);
    return { id: p.id, name: p.name, amountKopecks: sum(), unpaidKopecks: sum('UNPAID'), paidKopecks: sum('PAID'), reviewKopecks: sum('REVIEW'),
      payment: p.paymentMethod === 'CASH' ? 'Наличные' : p.paymentMethod === 'TRANSFER' ? 'Перевод' : 'Способ выплаты не указан',
      phone: p.paymentMethod === 'TRANSFER' ? p.paymentPhone?.trim() || 'Не указан' : '—',
      bank: p.paymentMethod === 'TRANSFER' ? p.paymentBank?.trim() || 'Не указан' : '—' };
  // FIX: summarize only amounts present after period/status filters, not the whole employee directory.
  }).filter(p => p.amountKopecks !== 0 || p.unpaidKopecks !== 0 || p.paidKopecks !== 0 || p.reviewKopecks !== 0);
}

// FIX: settings are evaluated now, independently of timesheet dates; temporary conditions override base rates.
export function payrollCurrentRates(rates: Employee['rates'], now = Date.now()) {
  const active = rates.filter(r => Date.parse(r.startsAt) <= now && (!r.endsAt || now < Date.parse(r.endsAt)));
  return ['WORK', 'PALLET'].flatMap(group => {
    const candidates = active.filter(r => (r.kind === 'PALLET' ? 'PALLET' : 'WORK') === group);
    const rate = candidates.find(r => r.temporary) ?? candidates.find(r => !r.temporary);
    return rate ? [rate] : [];
  });
}

// FIX: preserve the legacy workspace until the separately gated payroll module is enabled.
export function PayrollManagement({ session, legacy, onBack }: { session: AuthSession; legacy: ReactNode; onBack?: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [correctionsEnabled, setCorrectionsEnabled] = useState(false);
  const [shiftVersion, setShiftVersion] = useState<number | undefined>();
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [employeeStatus, setEmployeeStatus] = useState<EmployeeStatusFilter>('all');
  const [tab, setTab] = useState('work');
  const [settingsSelected, setSettingsSelected] = useState('');
  const [cardMode, setCardMode] = useState<'view' | 'edit' | 'new'>('view');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
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
  const [manualOpen, setManualOpen] = useState(false);
  const [historyEdit, setHistoryEdit] = useState<Row | null>(null);
  const [shiftDraft, setShiftDraft] = useState({ start: '', end: '', originalStart: '', originalEnd: '', lunch: '' });
  const activeRoots = new Set(payrollFilterEmployees(employees.filter(p=>!p.payrollPrimaryId), employeeStatus).map(p=>p.id));
  const reportEmployees = employees.filter(p=>activeRoots.has(payrollIdentityId(p)));
  const selectedReportPeople = reportEmployees.filter(p=>selected==='__all'||p.id===selected||payrollIdentityId(p)===selected);
  useEffect(() => { setManualOpen(false); setHistoryEdit(null); }, [tab]);
  const employee = employees.find(e => e.id === (tab === 'settings' ? settingsSelected : selected));
  useEffect(() => {
    if (tab !== 'settings') return;
    if (cardMode === 'new' && !settingsSelected) return;
    setCardMode('view'); setEditing(employee?.id ?? '');
    setDraft(employee ? employeeDraft(employee) : { ...blank, warehouseId: session.user.activeWarehouseId ?? '' });
    setError(''); setMessage('');
  }, [tab, settingsSelected]);
  const api = <T,>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown) => payrollRequest<T>(session.accessToken, path, method, body);
  async function loadEmployees() {
    const rows = await api<Employee[]>('/employees'); setEmployees(rows);
  }
  async function run(action: () => Promise<void | string>, success = 'Сохранено') {
    setError(''); setMessage(''); setBusy(true);
    try { const result = await action(); setMessage(result ?? success); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let live = true;
    api<{ enabled: boolean; correctionsEnabled?: boolean }>('/capabilities').then(async result => {
      if (!live || !result.enabled) return;
      setEnabled(true); setCorrectionsEnabled(result.correctionsEnabled === true);
      const [people, warehouses, pickingUsers] = await Promise.all([api<Employee[]>('/employees'), fetchBranches(session.accessToken), api<Array<{ id: string; name: string }>>('/picking-users')]);
      if (live) { setEmployees(people); setBranches(warehouses); setUsers(pickingUsers); setSelected('__all'); }
    }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [session.accessToken]);
  useEffect(() => {
    setReport(null); setChecked([]);
    setShifts([]);
    if (!enabled || !selected || tab === 'settings') return;
    if (selected !== '__all' && !reportEmployees.some(p => p.id === selected)) {
      setSelected('__all'); setManualOpen(false); setHistoryEdit(null); setShiftEdit('');
      return;
    }
    let live = true;
    Promise.all(selectedReportPeople.map(p => api<Report>(`/employees/${encodeURIComponent(p.id)}/report?from=${from}&to=${to}`))).then(reports => {
      if (live) setReport({ rows: reports.flatMap(r => r.rows), issues: reports.flatMap((r, i) => r.issues.map(s => `${selectedReportPeople[i].name}: ${s}`)), totals: { amountKopecks: reports.reduce((s,r)=>s+r.totals.amountKopecks,0), paidKopecks: reports.reduce((s,r)=>s+r.totals.paidKopecks,0) } });
    }).catch(e => { if(live)setError(e.message); });
    if(selected!=='__all')api<typeof shifts>(`/employees/${encodeURIComponent(selected)}/shifts`).then(r=>{if(live)setShifts(r);}).catch(e=>{if(live)setError(e.message);});
    return () => { live = false; };
  }, [selected, from, to, enabled, employees, tab, employeeStatus]);
  // FIX: clear old report/actions immediately, including an employee hidden by the new filter.
  function changeEmployeeStatus(status: EmployeeStatusFilter) {
    setEmployeeStatus(status); setReport(null); setChecked([]); setShifts([]);
    selectEmployee('__all');
  }
  // FIX: changing the selected employee atomically replaces every draft field; never merge two cards.
  function selectEmployee(id: string) {
    if (tab === 'settings') { setSettingsSelected(id); setCardMode('view'); } else setSelected(id);
    setManualOpen(false); setHistoryEdit(null); setShiftEdit(''); setError(''); setMessage('');
    const next = employees.find(p => p.id === id);
    setEditing(next ? next.id : '');
    setDraft(next ? employeeDraft(next) : { ...blank, warehouseId: session.user.activeWarehouseId ?? '' });
  }
  async function reloadReport() {
    const reports=await Promise.all(selectedReportPeople.map(p=>api<Report>(`/employees/${encodeURIComponent(p.id)}/report?from=${from}&to=${to}`)));
    setReport({rows:reports.flatMap(r=>r.rows),issues:reports.flatMap((r,i)=>r.issues.map(s=>`${selectedReportPeople[i].name}: ${s}`)),totals:{amountKopecks:reports.reduce((n,r)=>n+r.totals.amountKopecks,0),paidKopecks:reports.reduce((n,r)=>n+r.totals.paidKopecks,0)}});
    if(selected&&selected!=='__all')setShifts(await api<typeof shifts>(`/employees/${selected}/shifts`));
    setChecked([]);
  }
  function editRow(row: Row, shift?: { id: string; start: string; end: string; version?: number }) {
    setSelected(row.employeeId); setError(''); setHistoryEdit(null); setManualOpen(false);
    if (row.status === 'PAID') { setError('Запись оплачена. Выберите её в таблице и переведите в статус «На проверке», затем нажмите «Редактировать».'); return; }
    if (row.kind === 'HISTORY') setHistoryEdit(row);
    else if (shift) {
      setShiftEdit(shift.id); setShiftVersion(shift.version); setShiftDraft({ start: payrollLocalTime(shift.start), end: payrollLocalTime(shift.end), originalStart: shift.start, originalEnd: shift.end, lunch: row.detail.lunchOverride == null ? '' : String(row.detail.lunchOverride) }); setManualOpen(true);
    }
  }
  if (!enabled) return <>{error && <p role="alert">{error}</p>}{legacy}</>;
  const visibleRows = payrollSortRows(payrollFilterRows(report?.rows.filter(r => tab === 'handling' ? r.kind === 'PALLET' : r.kind !== 'PALLET') ?? [], paymentStatus), employees, sortKey, sortDirection);
  const selectedRows=visibleRows.filter(r=>checked.includes(r.key));
  const payableTotal=payrollSelectedTotal(visibleRows,checked);
  const personKeys=(id:string)=>visibleRows.filter(r=>r.status==='UNPAID'&&payrollIdentityId(employees.find(p=>p.id===r.employeeId)!)===id).map(r=>r.key);
  const paymentSummary = payrollSortRows(payrollPaymentSummary(reportEmployees, visibleRows, selected).map(p => ({ ...p, employeeId: p.id, key: p.id,
    date: visibleRows.filter(r => r.employeeId === p.id).map(r => r.date).sort()[0] ?? '9999-12-31' })), employees, sortKey, sortDirection);
  return <section className="payroll-management">
    <header className="payroll-heading">{onBack && <button type="button" onClick={onBack}>← К расходам</button>}<h2>ФОТ</h2></header>
    <nav className="payroll-tiles" aria-label="Разделы ФОТ">{[['work', 'Табель и начисления'], ['handling', 'Погрузка и разгрузка'], ['settings', 'Настройки']].map(([value, label]) =>
      <button key={value} className={tab === value ? 'is-active' : ''} onClick={() => { setTab(value); setChecked([]); }}>{label}</button>)}</nav>
    {error && <p role="alert" className="panel-message panel-message--error">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="payroll-fields">
      {tab !== 'settings' && <label>Статус сотрудников<select disabled={busy} value={employeeStatus} onChange={e => changeEmployeeStatus(e.target.value as EmployeeStatusFilter)}><option value="all">Все</option><option value="active">Активные</option><option value="inactive">Неактивные</option></select></label>}
      <label>Сотрудник<select aria-label="Сотрудник" disabled={busy} value={tab === 'settings' ? settingsSelected : selected} onChange={e => selectEmployee(e.target.value)}><option value="">Выберите сотрудника</option>{tab !== 'settings' && <option value="__all">Все сотрудники по фильтру</option>}{(tab === 'settings' ? employees : reportEmployees).map(e => <option key={e.id} value={e.id}>{e.name}{e.isActive ? '' : ' · архив'}</option>)}</select></label>
      {tab !== 'settings' && <label>Статус оплаты<select aria-label="Статус оплаты" value={paymentStatus} onChange={e=>{setPaymentStatus(e.target.value);setChecked([]);}}><option value="all">Все</option>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
      {tab !== 'settings' && <><label>С даты<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>По дату<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></>}
      {tab !== 'settings' && <><label>Сортировать по<select aria-label="Сортировать по" value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}><option value="date">Дате</option><option value="name">Имени</option><option value="bank">Банку</option><option value="status">Статусу оплаты</option></select></label>
        <label>Порядок<select aria-label="Порядок" value={sortDirection} onChange={e => setSortDirection(e.target.value as SortDirection)}><option value="asc">По возрастанию</option><option value="desc">По убыванию</option></select></label></>}
    </div>
    {tab === 'settings' ? <>
      {correctionsEnabled && <details><summary>История изменений</summary><PayrollHistory api={api} /></details>}
      <PayrollTablets session={session} branches={branches} employees={employees} />
      {employee && <PayrollIdentitySettings key={employee.id} employee={employee} employees={employees} busy={busy} save={(id,memberIds)=>run(async()=>{await api(`/employees/${id}/identity`,'PUT',{memberIds});await loadEmployees();},'Карточки сотрудника связаны')} />}
      <details><summary>Перенос исторического табеля</summary><p>Старые часы, суммы и статусы сохраняются без перерасчёта по новым правилам. Сначала проверьте соответствие сотрудников.</p>
        <input type="file" accept=".xlsx" aria-label="Исторический табель" onChange={e => { const file = e.target.files?.[0]; setImportFile(file ?? null); setPreview(null); setMapping({}); if (file) void run(async () => { setPreview(await payrollImport(session.accessToken, file)); return 'Предпросмотр импорта готов'; }); }} />
        {preview && <><p>Строк: {preview.rows.length}. Сумма: {money(preview.totalKopecks)}.</p>{preview.issues.map((s, i) => <p role="alert" key={i}>{s}</p>)}
          <div className="payroll-fields">{preview.employees.map(name => <label key={name}>{name}<select required value={mapping[name] ?? ''} onChange={e => setMapping({ ...mapping, [name]: e.target.value })}><option value="">Выберите сотрудника WMS</option>{employees.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>)}</div>
          <button disabled={busy || !!preview.issues.length || preview.employees.some(name => !mapping[name])} onClick={() => void run(async () => { const result = await payrollImport<{ added: number; skipped: number }>(session.accessToken, importFile!, mapping); setPreview(null); setImportFile(null); await reloadReport(); return `Добавлено: ${result.added}; уже существуют: ${result.skipped}`; })}>Подтвердить перенос</button>
        </>}
      </details>
      <button disabled={busy} onClick={() => { setSettingsSelected(''); setCardMode('new'); setEditing(''); setDraft({ ...blank, warehouseId: session.user.activeWarehouseId ?? '' }); }}>Новый сотрудник</button>
      {employee && <button disabled={busy} onClick={() => { setEditing(employee.id); setDraft(employeeDraft(employee)); setCardMode('edit'); setMessage(''); }}>Редактировать</button>}
      {(employee || cardMode === 'new') && <form key={cardMode + settingsSelected} aria-label="Карточка сотрудника" onSubmit={e => { e.preventDefault(); const initialForm = new FormData(e.currentTarget); void run(async () => { const saved = await api<Employee>(`/employees${editing ? '/' + encodeURIComponent(editing) : ''}`, editing ? 'PUT' : 'POST', { name: draft.name, userId: draft.userId || undefined, warehouseId: draft.warehouseId, picker: draft.picker, loader: draft.loader, isActive: draft.isActive, paymentMethod: draft.paymentMethod, paymentPhone: draft.paymentPhone, paymentBank: draft.paymentBank, ...(!editing ? { initialConditions: payrollInitialConditions(initialForm, draft.loader) } : {}) }); await loadEmployees(); setSettingsSelected(saved.id); setEditing(saved.id); setDraft(employeeDraft({ ...saved, rates: saved.rates ?? [] })); setCardMode('view'); }, 'Сотрудник сохранён'); }}>
        <h3>{editing ? 'Карточка сотрудника' : 'Добавить сотрудника'}</h3><fieldset disabled={cardMode === 'view' || busy}><div className="payroll-fields">
        <label>Имя<input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>Пользователь сборки (для сдельной оплаты)<select value={draft.userId} onChange={e => setDraft({ ...draft, userId: e.target.value })}><option value="">Не привязан</option>{users.map(u => <option value={u.id} key={u.id}>{u.name}</option>)}</select></label>
        <label>Филиал<select required value={draft.warehouseId} onChange={e => setDraft({ ...draft, warehouseId: e.target.value })}><option value="">Выберите филиал</option>{branches.map(b => <option value={b.id} key={b.id}>{b.name}</option>)}</select></label>
        <label>Способ выплаты<select value={draft.paymentMethod} onChange={e => setDraft({ ...draft, paymentMethod: e.target.value, paymentPhone: '', paymentBank: '' })}><option value="UNSPECIFIED">Не указан</option><option value="CASH">Наличные</option><option value="TRANSFER">Перевод</option></select></label>
        {draft.paymentMethod === 'TRANSFER' && <><label>Телефон для перевода<input type="tel" required value={draft.paymentPhone} onChange={e => setDraft({ ...draft, paymentPhone: e.target.value })} /></label><label>Банк<input required value={draft.paymentBank} onChange={e => setDraft({ ...draft, paymentBank: e.target.value })} /></label></>}
        </div><label><input type="checkbox" checked={draft.picker} onChange={e => setDraft({ ...draft, picker: e.target.checked })} />Сборщик</label>
        <label><input type="checkbox" checked={draft.loader} onChange={e => setDraft({ ...draft, loader: e.target.checked })} />Грузчик</label>
        <label><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />Активен</label>
        {cardMode === 'new' && <section aria-label="Первоначальные тарифы"><h3>Тарифы сотрудника</h3><div className="payroll-fields">
          <label>Тип оплаты<select name="initialKind" defaultValue="HOURLY"><option value="HOURLY">За час</option><option value="PIECE">За единицу собранного товара</option></select></label>
          <label>Основная ставка, ₽<input name="initialRate" type="number" min="0" step="0.01" placeholder="Укажите ставку" /></label>
          {draft.loader && <label>Тариф за паллету, ₽<input name="initialPalletRate" type="number" min="0" step="0.01" placeholder="Укажите тариф" /></label>}
          <label>Начало действия, МСК<input name="initialStart" type="datetime-local" defaultValue={new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10) + 'T00:00'} required /></label>
        </div><p>Пустое поле — тариф пока не установлен. Сотрудник и указанные тарифы сохраняются вместе.</p></section>}
        </fieldset>{cardMode !== 'view'  && <><button disabled={busy}>Сохранить сотрудника</button><button type="button" disabled={busy} onClick={() => { setCardMode('view'); setDraft(employee ? employeeDraft(employee) : blank); }}>Отмена</button></>}
      </form>}
      {employee && <section aria-label="Действующие условия оплаты"><h3>Действующие условия оплаты · {employee.name}</h3>
        {!payrollCurrentRates(employee.rates).some(r => r.kind !== 'PALLET') && <p>Основная ставка: не установлена</p>}
        {payrollCurrentRates(employee.rates).map(r => <p key={r.id}>{kinds[r.kind]}: <strong>{money(r.rateKopecks)}</strong>{r.temporary ? ' · индивидуальное условие' : ' · основная ставка'}</p>)}
        <p>Индивидуальные условия сейчас: {payrollCurrentRates(employee.rates).some(r => r.temporary) ? 'есть' : 'нет'}</p>
        <details><summary>История и запланированные условия ({employee.rates.length})</summary><ul>{employee.rates.map(r => <li key={r.id}>{kinds[r.kind]}: {money(r.rateKopecks)} · {new Date(r.startsAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} — {r.endsAt ? new Date(r.endsAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'бессрочно'}{r.temporary ? ' · индивидуальное' : ''}</li>)}</ul></details>
      </section>}
      {employee && cardMode === 'edit' && <form key={employee.id} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(async () => {
        await api(`/employees/${employee.id}/conditions`, 'POST', { kind: f.get('kind'), rateKopecks: Math.round(Number(f.get('rate')) * 100), startsAt: iso(String(f.get('start'))), endsAt: f.get('end') ? iso(String(f.get('end'))) : undefined, temporary: f.get('temporary') === 'on', reason: f.get('reason') }); await loadEmployees(); return 'Условие оплаты сохранено';
      }); }}><h3>Изменить ставку или индивидуальное условие</h3><p>Новая ставка действует с указанного времени. Предыдущие периоды сохраняются.</p><div className="payroll-fields">
        <label>Тип оплаты<select name="kind" defaultValue={payrollCurrentRates(employee.rates)[0]?.kind ?? 'HOURLY'}>{Object.entries(kinds).filter(([k]) => k !== 'HISTORY').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Ставка, ₽<input name="rate" defaultValue={payrollCurrentRates(employee.rates)[0] ? payrollCurrentRates(employee.rates)[0].rateKopecks / 100 : undefined} type="number" min="0" step="0.01" required /></label>
        <label>Начало, МСК<input name="start" type="datetime-local" defaultValue={new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 16)} required /></label><label>Окончание, МСК<input name="end" type="datetime-local" /></label>
        <label>Основание<input name="reason" required /></label></div><label><input type="checkbox" name="temporary" />Временное условие (нужна дата окончания)</label><button disabled={busy}>Сохранить условие</button>

      </form>}
    </> : <>
      <div><button type="button" disabled={!employee || busy} onClick={() => { setManualOpen(!manualOpen); setHistoryEdit(null); setShiftEdit(''); setShiftDraft({ start: '', end: '', originalStart: '', originalEnd: '', lunch: '' }); }}>{manualOpen ? 'Закрыть форму' : tab === 'work' ? 'Добавить запись вручную' : 'Добавить погрузку / разгрузку'}</button>{!employee && <p>Выберите сотрудника для ручного добавления записи.</p>}</div>
      {tab === 'work' && employee && shifts.filter(s => !s.endsAt).map(s => <p key={s.id}>Открытая смена: {new Date(s.startsAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} <button type="button" onClick={() => editRow({ key: s.id, employeeId: employee.id, date: '', kind: 'HOURLY', status: 'UNPAID', amountKopecks: 0, detail: {} }, { id: s.id, start: s.startsAt, end: '' })}>Редактировать / закрыть смену</button></p>)}
      {historyEdit && <form role="dialog" aria-modal="true" aria-label="Редактирование записи" style={{ position: 'fixed', inset: '10% 5%', zIndex: 1000, background: 'white', padding: 24, overflowY: 'auto', boxShadow: '0 0 0 100vmax #0008', borderRadius: 16 }} key={historyEdit.key} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(async () => {
        await api(`/employees/${encodeURIComponent(historyEdit.employeeId)}/history/${encodeURIComponent(historyEdit.key.slice('HISTORY:'.length))}`, 'PUT', { startTime: f.get('historyStart'), endTime: f.get('historyEnd'), lunchMinutes: Number(f.get('historyLunch')), rateKopecks: Math.round(Number(f.get('historyRate')) * 100), reason: f.get('reason') });
        setHistoryEdit(null); await reloadReport();
      }); }}><h3>Редактировать запись за {payrollDate(historyEdit.date)}</h3><p>Обед сохраняется по табелю. После исправления сумма пересчитается, запись получит статус «На проверке».</p><div className="payroll-fields">
        <label>Начало<input type="time" name="historyStart" required defaultValue={payrollIntervalCells(historyEdit)[0]} /></label>
        <label>Окончание<input type="time" name="historyEnd" required defaultValue={payrollIntervalCells(historyEdit)[1]} /></label>
        <label>Обед, минут<input type="number" min="0" name="historyLunch" required defaultValue={Math.round((historyEdit.lunchMs ?? 0) / 60000)} /></label>
        <label>Ставка, ₽/ч<input type="number" min="0" step="0.01" name="historyRate" required defaultValue={historyEdit.detail.rate} /></label>
        <label>Причина исправления<input name="reason" required /></label></div><button disabled={busy}>Сохранить исправление</button><button type="button" onClick={() => setHistoryEdit(null)}>Отмена</button></form>}
      {employee && manualOpen && <form className={tab === 'work' ? 'payroll-shift-dialog' : undefined} role="dialog" aria-modal="true" aria-label="Редактирование записи" style={{ position: 'fixed', inset: '10% 5%', zIndex: 1000, background: 'white', padding: 24, overflowY: 'auto', boxShadow: '0 0 0 100vmax #0008', borderRadius: 16 }} key={`${selected}:${tab}:${shiftEdit}`} onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(async () => {
        if (tab === 'work') await api(`/employees/${selected}/shifts${shiftEdit ? '/' + shiftEdit : ''}`, shiftEdit ? 'PUT' : 'POST', { ...(correctionsEnabled && shiftEdit ? { employeeId: String(f.get('correctEmployee') || selected), expectedVersion: shiftVersion } : {}), startsAt: payrollEditedTime(String(f.get('start')), shiftDraft.originalStart), endsAt: f.get('end') ? payrollEditedTime(String(f.get('end')), shiftDraft.originalEnd) : undefined, lunchMinutes: f.get('lunch') === '' ? null : Number(f.get('lunch')), reason: f.get('reason') });
        else await api('/handling', 'POST', { warehouseId: employee.warehouseId, startsAt: iso(String(f.get('start'))), operation: f.get('operation'), palletCount: Number(f.get('pallets')), boxCount: Number(f.get('boxes')), bagCount: Number(f.get('bags')), rollCount: Number(f.get('rolls')), employeeIds: f.getAll('participant'), reason: f.get('reason') });
        await reloadReport(); setManualOpen(false); return 'Запись сохранена';
      }); }}><h3>{tab === 'work' ? shiftEdit ? 'Редактировать приход и уход' : 'Добавить приход и уход' : 'Добавить работу'}</h3><div className="payroll-fields">
        {correctionsEnabled && tab === 'work' && shiftEdit && <PayrollCorrectionEmployee people={employees} employee={employee} />}
        <label>Начало, МСК<input type="datetime-local" step="1" autoFocus name="start" required defaultValue={shiftDraft.start} /></label>
        {tab === 'work' ? <label>Уход, МСК<input type="datetime-local" step="1" name="end" defaultValue={shiftDraft.end} /></label> : <><label>Работа<select name="operation"><option value="UNLOAD">Разгрузка</option><option value="LOAD">Погрузка</option></select></label><label>Палеты<input type="number" min="0" step="0.0001" name="pallets" /></label><label>Короба<input type="number" min="0" step="1" name="boxes" /></label><label>Мешки<input type="number" min="0" step="1" name="bags" /></label><label>Рулоны<input type="number" min="0" step="1" name="rolls" /></label></>}
        <label>Комментарий / основание<input name="reason" required /></label>{tab === 'work' && <label>Обед за весь день, минут<input type="number" min="0" step="1" name="lunch" defaultValue={shiftDraft.lunch} placeholder="Автоматически" /><small>Пусто — автоматически; 0 — без обеда. Вычет один на все выходы за день.</small></label>}</div>
        {tab === 'handling' && <fieldset><legend>Все участники работы</legend>{employees.filter(e => e.warehouseId === employee.warehouseId && e.isActive).map(e => <label key={e.id}><input type="checkbox" name="participant" value={e.id} />{e.name}</label>)}</fieldset>}
        <button disabled={busy}>Сохранить</button>
        <button type="button" disabled={busy} onClick={() => setManualOpen(false)}>Отмена</button>
        {shiftEdit && tab === 'work' && <button type="button" disabled={busy} onClick={e => {
          const reason = String(new FormData(e.currentTarget.form!).get('reason') ?? '').trim();
          if (!reason) { setError('Укажите причину удаления в форме.'); e.currentTarget.form?.querySelector<HTMLInputElement>('[name="reason"]')?.focus(); return; }
          void run(async () => { await api(`/employees/${selected}/shifts/${shiftEdit}/cancel`, 'POST', { reason }); await reloadReport(); setManualOpen(false); return 'Запись удалена из табеля. История сохранена'; });
        }}>Удалить запись</button>}
        {error && <p role="alert">{error}</p>}
      </form>}
      {report && <><section aria-label="Суммы и реквизиты за период" className="payroll-payment-summary">
        <h3>Суммы и реквизиты · {from.split('-').reverse().join('.')} — {to.split('-').reverse().join('.')}</h3>
        <div className="payroll-table"><table><thead><tr><th>Сотрудник</th><th>Начислено за период</th><th>Куда выплатить</th><th>Телефон для перевода</th><th>Банк</th></tr></thead>
          <tbody>{paymentSummary.map(p => <tr key={p.id}><td><label><input type="checkbox" aria-label={`Выбрать для оплаты: ${p.name}`} disabled={busy||!personKeys(p.id).length} checked={personKeys(p.id).length>0&&personKeys(p.id).every(k=>checked.includes(k))} onChange={e=>{const keys=personKeys(p.id);setChecked(e.target.checked?[...new Set([...checked,...keys])]:checked.filter(k=>!keys.includes(k)));}}/><strong>{p.name}</strong></label>{employees.filter(member=>member.payrollPrimaryId===p.id).map(member=><small key={member.id}> · {member.name}</small>)}</td><td><strong>{money(p.amountKopecks)}</strong>
            <div className="payroll-payment-detail">Не оплачено: {money(p.unpaidKopecks)}<br />Оплачено: {money(p.paidKopecks)}<br />На проверке: {money(p.reviewKopecks)}</div></td>
            <td>{p.payment}</td><td>{p.phone}</td><td>{p.bank}</td></tr>)}</tbody></table></div>
        {!paymentSummary.length && <p>За выбранный период записей нет.</p>}
        <p role="status">Выбрано людей: <strong>{new Set(selectedRows.map(r=>payrollIdentityId(employees.find(p=>p.id===r.employeeId)!))).size}</strong>. К оплате: <strong>{money(payableTotal)}</strong>. На проверке и уже оплаченные строки в эту сумму не входят.</p>
        <p>Начислено по разделу: <strong>{money(paymentSummary.reduce((s, p) => s + p.amountKopecks, 0))}</strong>. Реквизиты — из текущей карточки сотрудника. Суммы на проверке показаны отдельно.</p>
      </section>
        <div>{['xlsx', 'pdf'].map(format => <button key={format} disabled={busy || !employee} onClick={() => void run(async () => {
          const blob = await payrollDownload(session.accessToken, selected, from, to, format); const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `Табель_${from}_${to}.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return 'Отчёт подготовлен';
        })}>Скачать {format.toUpperCase()}</button>)}</div>
        {report.issues.map((issue, i) => <p role="alert" key={i}>{issue}</p>)}
        <div className="payroll-table"><table aria-label="Записи табеля"><thead><tr><th><input aria-label="Выбрать все строки" type="checkbox" checked={visibleRows.length > 0 && visibleRows.every(r => checked.includes(r.key))} onChange={e => setChecked(e.target.checked ? visibleRows.map(r => r.key) : [])} /></th><th>Дата</th><th>Сотрудник</th><th>Банк / выплата</th><th>Начало</th><th>Окончание</th><th>Обед</th><th>Время итог / единицы</th><th>Ставка</th><th>Сумма</th><th>Статус</th><th>Действия</th></tr></thead>
        <tbody>{visibleRows.map(r => <tr key={r.key}>
          <td><input type="checkbox" checked={checked.includes(r.key)} aria-label={`Выбрать ${payrollDate(r.date)}`} onChange={e => setChecked(e.target.checked ? [...checked, r.key] : checked.filter(k => k !== r.key))} /></td>
          <td>{payrollDate(r.date)}</td><td>{employees.find(e => e.id === r.employeeId)?.name}</td><td>{employees.find(e => e.id === r.employeeId)?.paymentMethod === 'CASH' ? 'Наличные' : employees.find(e => e.id === r.employeeId)?.paymentBank || 'Не указан'}</td>
          <td className="payroll-time">{payrollIntervalCells(r)[0]}</td><td className="payroll-time">{payrollIntervalCells(r)[1]}</td>
          <td>{payrollTimeCells(r)[1]}</td><td>{['HOURLY', 'HISTORY'].includes(r.kind) ? hours((r.workedMs ?? 0) - (r.lunchMs ?? 0)) : r.units ?? payrollCargoText(r.detail)}</td>
          <td>{r.kind === 'HISTORY' && r.detail.rate !== undefined ? money(r.detail.rate * 100) : r.kind === 'HOURLY' ? [...new Set((r.detail.segments ?? []).map(s => s.rateKopecks))].map(money).join(' / ') : '—'}</td>
          <td>{money(r.amountKopecks)}</td><td>{statuses[r.status]}</td>
          <td>{r.kind === 'HISTORY' && <button type="button" disabled={busy} onClick={() => editRow(r)}>Редактировать</button>}
            {r.detail.shifts?.map((s, i) => <button key={s.id} type="button" disabled={busy} onClick={() => editRow(r, s)}>Редактировать{r.detail.shifts!.length > 1 ? ` ${i + 1}` : ''}</button>)}
            {r.kind === 'PALLET' && (r.detail.status === 'REVIEW' || correctionsEnabled) && <HandlingReview correctionsEnabled={correctionsEnabled} row={r} employees={employees} busy={busy || r.status === 'PAID'} api={api} run={run} reload={reloadReport} />}
          </td></tr>)}</tbody></table></div>
        <form onSubmit={e => { e.preventDefault(); const f=new FormData(e.currentTarget); const status=String(f.get('status')); void run(async()=>{
          const rows=status==='PAID'?selectedRows.filter(r=>r.status==='UNPAID'):selectedRows;
          if(!rows.length)throw new Error('Выберите начисления.');
          const entries=[...new Set(rows.map(r=>r.employeeId))].map(employeeId=>({employeeId,keys:rows.filter(r=>r.employeeId===employeeId).map(r=>r.key)}));
          await api('/statuses/batch','POST',{entries,dateFrom:from,dateTo:to,status,comment:String(f.get('comment')??''),expectedAmountKopecks:rows.reduce((sum,r)=>sum+r.amountKopecks,0)});await reloadReport();
        },'Статус выбранных начислений сохранён'); }}><div className="payroll-fields"><label>Статус выбранных<select name="status" defaultValue="PAID">{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Комментарий<input name="comment" /></label></div><button disabled={busy||!selectedRows.length}>Применить к выбранным начислениям ({selectedRows.length})</button></form>
      </>}
    </>}
  </section>;
}

// FIX: operation-specific tariff is submitted only on confirmation, never saved as a personal rate.
export function payrollOperationTariff(value: string): number | undefined {
  if (!value.trim()) return undefined;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error('Введите тариф в рублях, не более двух знаков после запятой.');
  const kopecks = Math.round(Number(value.trim().replace(',', '.')) * 100);
  if (!Number.isSafeInteger(kopecks) || kopecks > 2147483647) throw new Error('Тариф слишком велик.');
  return kopecks;
}
// FIX: reassign this shift only; keep unrelated accounts and other shifts intact.
export function PayrollCorrectionEmployee({ people, employee }: { people: Array<Pick<Employee, 'id' | 'name' | 'warehouseId' | 'isActive'>>; employee: Pick<Employee, 'id' | 'warehouseId'> }) {
  return <label>Сотрудник этой смены<select name="correctEmployee" aria-label="Сотрудник этой смены" defaultValue={employee.id}>
    {people.filter(p => p.warehouseId === employee.warehouseId && (p.isActive || p.id === employee.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
  </select><small>При смене сотрудника время и фактические обеды переносятся вместе со сменой. Оплата пересчитывается по условиям выбранного сотрудника.</small></label>;
}
function HandlingReview({ row, employees, busy, api, run, reload, correctionsEnabled }: { row: Row; employees: Employee[]; busy: boolean; correctionsEnabled: boolean;
  api: (path: string, method: 'POST' | 'PUT', body?: unknown) => Promise<unknown>;
  run: (action: () => Promise<void>, success: string) => Promise<void>; reload: () => Promise<void> }) {
  const [tariff, setTariff] = useState('');
  const [mode, setMode] = useState('');
  const [error, setError] = useState('');
  const detail = row.detail;
  const members = detail.shares?.map(s => s.employeeId) ?? [row.employeeId];
  const act = (action: () => Promise<void>, success: string) => void run(async () => {
    setError('');
    try { await action(); await reload(); setMode(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить работу'); throw e; }
  }, success);
  const localStart = detail.startsAt ? payrollLocalTime(detail.startsAt) : '';
  return <div>
    {detail.status === 'REVIEW' && <><label>Разовый тариф, ₽ за паллету<input aria-label="Разовый тариф за паллету" inputMode="decimal" disabled={busy} value={tariff} placeholder={detail.unitRateKopecks != null ? String(detail.unitRateKopecks / 100) : "По ставкам участников"} onChange={e => setTariff(e.target.value)} /></label>
    <p>Тариф на всю работу делится поровну между {members.length} участниками. {detail.unitRateKopecks != null ? `Пусто — ${detail.unitRateKopecks / 100} ₽ за палету. 16 коробов / 5 мешков / 30 рулонов = 1 палета.` : 'Пусто — ставки участников на начало работы.'}</p>
    <button disabled={busy} onClick={() => act(async () => { const rateKopecks = payrollOperationTariff(tariff); await api(`/handling/${detail.id}/confirm`, 'POST', rateKopecks === undefined ? {} : { rateKopecks }); }, 'Работа подтверждена')}>Подтвердить работу</button></>}
    <button disabled={busy} onClick={() => setMode('edit')}>Редактировать</button>
    {detail.status === 'REVIEW' && <button disabled={busy} onClick={() => setMode('cancel')}>Отменить запись</button>}
    {error && <p role="alert">{error}</p>}
    {mode && <form key={`${detail.id}:${mode}`} onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      act(async () => {
        const reason = String(f.get('reason') ?? '').trim();
        if (!reason) throw new Error('Укажите причину.');
        if (mode === 'cancel') await api(`/handling/${detail.id}/cancel`, 'POST', { reason });
        else await api(`/handling/${detail.id}`, 'PUT', { ...(correctionsEnabled ? { expectedState: detail.correctionToken } : {}), warehouseId: detail.warehouseId, startsAt: payrollEditedTime(String(f.get('start')), detail.startsAt || ''),
          operation: f.get('operation'), palletCount: Number(f.get('pallets')), boxCount: Number(f.get('boxes')), bagCount: Number(f.get('bags')), rollCount: Number(f.get('rolls')), employeeIds: f.getAll('member'), reason });
      }, mode === 'cancel' ? 'Запись отменена, история сохранена' : 'Работа изменена');
    }}>
      {mode === 'edit' && <>
        <p>Выберите правильных участников и объёмы. После исправления работу потребуется подтвердить заново.</p><label>Начало, МСК<input name="start" type="datetime-local" step="1" defaultValue={localStart} required /></label>
        <label>Работа<select name="operation" defaultValue={detail.operation}><option value="LOAD">Погрузка</option><option value="UNLOAD">Разгрузка</option></select></label>
        <label>Палеты<input name="pallets" type="number" min="0" step="0.0001" defaultValue={detail.palletCount} /></label><label>Короба<input name="boxes" type="number" min="0" step="1" defaultValue={detail.boxCount ?? 0} /></label><label>Мешки<input name="bags" type="number" min="0" step="1" defaultValue={detail.bagCount ?? 0} /></label><label>Рулоны<input name="rolls" type="number" min="0" step="1" defaultValue={detail.rollCount ?? 0} /></label>
        <fieldset><legend>Участники</legend>{employees.filter(p => p.warehouseId === detail.warehouseId && (p.isActive || members.includes(p.id))).map(p => <label key={p.id}><input type="checkbox" name="member" value={p.id} defaultChecked={members.includes(p.id)} />{p.name}</label>)}</fieldset>
      </>}
      <label>Причина<input name="reason" required maxLength={1000} /></label>
      <button disabled={busy}>{mode === 'cancel' ? 'Подтвердить отмену записи' : 'Сохранить изменения'}</button>
      <button type="button" disabled={busy} onClick={() => setMode('')}>Закрыть</button>
    </form>}
  </div>;
}

type Tablet = { id: string; name: string; warehouseId: string; lastSeenAt: string | null; revokedAt: string | null };
type TabletEvent = { id: string; employeeId: string; name: string; kind: string; effectiveAt: string; status: string; reason: string; photoStatus: string };
// FIX: physical quantities remain legible instead of a rounded pallet equivalent.
export const payrollCargoText = (q: Row['detail']) => `${q.palletCount ?? 0} пал. · ${q.boxCount ?? 0} кор. · ${q.bagCount ?? 0} меш. · ${q.rollCount ?? 0} рул.`;
export const attendancePhotoStatus = (status: string) => ({ NOT_REQUESTED: 'На планшете', PENDING: 'Ожидаем планшет', STORED: 'Фото доступно', EXPIRED: 'Срок хранения истёк', UNAVAILABLE: 'Фото недоступно' }[status] ?? status);

// FIX: separate device administration; no financial data or WMS administrator credentials reach the tablet.
function PayrollTablets({ session, branches, employees }: { session: AuthSession; branches: BranchSummary[]; employees: Employee[] }) {
  const [enabled, setEnabled] = useState(false), [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<Tablet[]>([]), [events, setEvents] = useState<TabletEvent[]>([]);
  const [warehouse, setWarehouse] = useState(''), [employee, setEmployee] = useState('');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10)), [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [code, setCode] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [photo, setPhoto] = useState(''), [photoCaption, setPhotoCaption] = useState(''), [review, setReview] = useState<TabletEvent | null>(null), [reason, setReason] = useState(''), [corrected, setCorrected] = useState('');
  const api = <T,>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) => payrollRequest<T>(session.accessToken, '/attendance' + path, method, body);
  useEffect(() => { let live = true; api<{ enabled: boolean; correctionsEnabled?: boolean }>('/capabilities').then(r => { if (live) setEnabled(r.enabled); }).catch(() => {}); return () => { live = false; }; }, [session.accessToken]);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);
  async function load() {
    const [d, e] = await Promise.all([api<Tablet[]>('/devices'), api<TabletEvent[]>(`/events?from=${from}&to=${to}${employee ? '&employeeId=' + encodeURIComponent(employee) : ''}`)]);
    setDevices(d); setEvents(e);
  }
  async function run(action: () => Promise<void>, success = '') {
    setBusy(true); setError(''); setMessage('');
    try { await action(); setMessage(success); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить операцию.'); }
    finally { setBusy(false); }
  }
  if (!enabled) return null;
  return <section aria-label="Планшеты учёта времени">
    <button disabled={busy} onClick={() => { setOpen(!open); setPhoto(''); if (!open) void run(load); }}>Планшеты и отметки {open ? '▴' : '▾'}</button>
    {open && <>
      <h3>Подключение планшета</h3>
      <p>На планшете фото хранится 35 дней. В WMS оно поступает только после вашего запроса.</p>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <label>Филиал планшета<select disabled={busy} value={warehouse} onChange={e => { setWarehouse(e.target.value); setCode(''); }}><option value="">Выберите филиал</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <button disabled={busy || !warehouse} onClick={() => void run(async () => {
        const r = await api<{ code: string; expiresAt: string }>('/codes', 'POST', { warehouseId: warehouse });
        setCode(`${r.code} · до ${new Date(r.expiresAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК`);
      }, 'Код подключения создан')}>Выдать одноразовый код</button>
      {code && <p role="status">{code}</p>}
      <ul>{devices.map(d => <li key={d.id}>{d.name} · {branches.find(b => b.id === d.warehouseId)?.name ?? 'Филиал'} · {d.revokedAt ? 'Доступ отозван' : d.lastSeenAt ? `Связь ${new Date(d.lastSeenAt).toLocaleString('ru-RU')}` : 'Ещё не подключался'}
        {!d.revokedAt && <button disabled={busy} onClick={() => void run(async () => { await api(`/devices/${d.id}/revoke`, 'POST'); await load(); }, 'Доступ планшета отозван; локальная очередь сохранена')}>Отключить планшет {d.name}</button>}</li>)}</ul>
      <h3>Отметки с планшетов</h3>
      <div className="payroll-fields">
        <label>Сотрудник планшета<select disabled={busy} value={employee} onChange={e => { setEmployee(e.target.value); setEvents([]); setPhoto(''); setReview(null); }}><option value="">Все сотрудники</option>{employees.map(e => <option value={e.id} key={e.id}>{e.name}</option>)}</select></label>
        <label>Отметки с<input disabled={busy} type="date" value={from} onChange={e => { setFrom(e.target.value); setEvents([]); setPhoto(''); setReview(null); }} /></label>
        <label>Отметки по<input disabled={busy} type="date" value={to} onChange={e => { setTo(e.target.value); setEvents([]); setPhoto(''); setReview(null); }} /></label>
      </div>
      <button disabled={busy} onClick={() => void run(load)}>Показать / обновить отметки</button>
      <p>Показано до 500 последних отметок выбранного периода. Для более ранних выберите меньший период.</p>
      <table><thead><tr><th>Сотрудник</th><th>Дата и время</th><th>Действие</th><th>Состояние</th><th>Фото</th></tr></thead><tbody>{events.map(e => <tr key={e.id}>
        <td>{e.name}</td><td>{new Date(e.effectiveAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</td>
        <td>{({ CLOCK_IN: 'Приход', CLOCK_OUT: 'Уход', BREAK_START: 'Обед', BREAK_END: 'Вернулся', HANDLING: 'Погрузка / разгрузка' } as Record<string, string>)[e.kind]}</td>
        <td>{e.status === 'REVIEW' ? 'На проверке' : 'Обработано'} {e.reason}{e.status === 'REVIEW' && <button disabled={busy} onClick={() => { setReview(e); setReason(''); setCorrected(''); }}>Разобрать отметку</button>}</td>
        <td>{e.kind !== 'HANDLING' && <>{attendancePhotoStatus(e.photoStatus)}
          {e.photoStatus === 'NOT_REQUESTED' && <button disabled={busy} onClick={() => void run(async () => { await api(`/events/${e.id}/photo`, 'POST'); await load(); }, 'Запрос фото зарегистрирован. Обновите список после подключения планшета.')}>Запросить фото {e.name}</button>}
          {/* FIX: never leave the previous photograph visible while another mark is loading. */}
          {e.photoStatus === 'STORED' && <button disabled={busy} onClick={() => void run(async () => { setPhoto(''); setPhotoCaption(`${e.name} · ${({ CLOCK_IN: 'Приход', CLOCK_OUT: 'Уход', BREAK_START: 'Обед', BREAK_END: 'Вернулся' } as Record<string,string>)[e.kind]} · ${new Date(e.effectiveAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`); const blob = await payrollAttendancePhoto(session.accessToken, e.id); setPhoto(URL.createObjectURL(blob)); })}>Посмотреть фото {e.name}</button>}
        </>}</td></tr>)}</tbody></table>
      {photo && <div><p>{photoCaption}</p><button onClick={() => setPhoto('')}>Закрыть фото</button><img src={photo} alt="Фото отметки сотрудника" onError={() => { setPhoto(''); setError('Не удалось показать фото. Повторите загрузку этой отметки.'); }} style={{ maxWidth: '100%', maxHeight: 480 }} /></div>}
      {review && <form onSubmit={e => e.preventDefault()}><h4>Проверка отметки · {review.name}</h4>
        <label>Причина решения<input disabled={busy} value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label>
        {review.kind !== 'HANDLING' && <label>Исправленное время (МСК, при необходимости)<input disabled={busy} type="datetime-local" value={corrected} onChange={e => setCorrected(e.target.value)} /></label>}
        {(['ACCEPT', 'DISMISS'] as const).map(action => <button key={action} disabled={busy || !reason.trim()} onClick={() => void run(async () => {
          await api(`/events/${review.id}/resolve`, 'POST', { action, reason, ...(corrected ? { effectiveAt: `${corrected}:00+03:00` } : {}) }); setReview(null); await load();
        }, 'Решение сохранено; планшет получит его при синхронизации')}>{action === 'ACCEPT' ? 'Принять отметку' : 'Отклонить без начисления'}</button>)}
        <button disabled={busy} onClick={() => setReview(null)}>Закрыть проверку</button>
      </form>}
    </>}
  </section>;
}

// FIX: reversible links preserve every source card and paid history.
function PayrollIdentitySettings({employee,employees,busy,save}:{employee:Employee;employees:Employee[];busy:boolean;save:(id:string,ids:string[])=>Promise<void>}) {
  const primary=employees.find(p=>p.id===payrollIdentityId(employee))!;
  const [ids,setIds]=useState<string[]>([]);
  useEffect(()=>{setIds(employees.filter(p=>p.payrollPrimaryId===primary.id).map(p=>p.id));},[employees,primary.id]);
  const candidates=employees.filter(p=>p.warehouseId===primary.warehouseId&&p.id!==primary.id&&(!p.payrollPrimaryId||p.payrollPrimaryId===primary.id)&&!employees.some(other=>other.payrollPrimaryId===p.id));
  return <details className="payroll-identity"><summary>Несколько записей — один сотрудник</summary><p>Основная карточка: <strong>{primary.name}</strong>. Её имя и реквизиты используются для общей суммы. Ставки, отметки и выплаченные суммы исходных записей сохраняются.</p>
    <div className="payroll-identity-list">{candidates.map(p=><label key={p.id}><input type="checkbox" disabled={busy} checked={ids.includes(p.id)} onChange={e=>setIds(e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/>{p.name}{p.isActive?'':' · архив'}</label>)}</div>
    <p>Снимите отметку, чтобы снова учитывать карточку отдельно. Связь не удаляет возможные повторные начисления — их нужно сверить по исходным строкам.</p>
    <button type="button" disabled={busy} onClick={()=>void save(primary.id,ids)}>Сохранить связь карточек</button>
  </details>;
}
