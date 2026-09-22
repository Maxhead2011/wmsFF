import { useEffect, useState } from 'react';
import { Clock3, RefreshCw, Save, Play } from 'lucide-react';
import { fetchClients, request, type AuthSession, type ClientSummary } from '../../lib/api';
type Config = { enabled: boolean; times: string[]; allWarehouses: boolean; warehouseIds: string[] };
type Report = { startedAt?: string; status?: string; skipped?: number; error?: string; groups?: Array<{ label: string; count: number; requestNumber?: number; error?: string }> };
type Cabinet = { id: string; marketplace: string; accountName: string | null; config: Config; version: string | null; nextAt: string | null; routes: Array<{ id: string; name: string }>; history: Report[] };
export function AdministrationAutoAssembly({ session }: { session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useState('');
  const [data, setData] = useState<{ available: boolean; items: Cabinet[] } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => { let current = true; fetchClients(session.accessToken).then(items => { if (current) setClients(items); }).catch(e => { if (current) setError(e.message); }); return () => { current = false; }; }, [session.accessToken]);
  useEffect(() => {
    let current = true; setData(null); setError('');
    if (!clientId) return;
    setLoading(true);
    request<{ available: boolean; items: Cabinet[] }>(`/administration/auto-assembly?clientId=${encodeURIComponent(clientId)}`, { accessToken: session.accessToken }).then(value => { if (current) setData(value); }).catch(e => { if (current) setError(e.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [clientId, session.accessToken]);
  return <section className="admin-stack" aria-label="Автосборка">
    <div className="admin-section"><h3><Clock3 size={20} /> Автосборка FBS</h3><p>Создание заявок по расписанию. Ручная сборка остаётся доступной; заказы, уже взятые в работу, пропускаются.</p>
      <label>Клиент <select value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Выберите клиента</option>{clients.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}{loading && <p role="status">Загружаю кабинеты и маршрутизацию…</p>}
    {data && !data.available && <p role="status">Автосборка отключена на сервере.</p>}
    {data?.items.length === 0 && <p>У клиента нет активных кабинетов WB или Ozon.</p>}
    {data?.items.map(item => <CabinetSettings key={`${clientId}:${item.id}`} item={item} available={data.available} token={session.accessToken} />)}
  </section>;
}
function CabinetSettings({ item, token, available }: { item: Cabinet; token: string; available: boolean }) {
  const [config, setConfig] = useState(item.config);
  const [timesText, setTimesText] = useState(item.config.times.join(', '));
  const [version, setVersion] = useState(item.version);
  const [nextAt, setNextAt] = useState(item.nextAt);
  const [history, setHistory] = useState(item.history);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [interval, setInterval] = useState('6');
  const [start, setStart] = useState('06:00');
  function change(value: Partial<Config>) { setConfig(old => ({ ...old, ...value })); setDirty(true); setReport(null); }
  function makeTimes() {
    const hours = Number(interval); const [h, m] = start.split(':').map(Number);
    const times = Array.from({ length: 24 / hours }, (_, i) => `${String((h + i * hours) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`).sort();
    setTimesText(times.join(', ')); change({ times });
  }
  async function action(mode: 'save' | 'preview' | 'run') {
    if (mode === 'run' && !window.confirm('Создать заявки сейчас по сохранённым настройкам?')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const draft = { ...config, times: timesText.split(',').map(t => t.trim()).filter(Boolean) };
      const result = await request<Report>(`/administration/auto-assembly/${item.id}${mode === 'save' ? '' : '/' + mode}`, { method: mode === 'save' ? 'PUT' : 'POST', accessToken: token, body: { config: draft, version } });
      if (mode === 'preview') setReport(result);
      if (mode === 'run') { setReport(result); if (result) setHistory(old => [result, ...old].slice(0, 20)); }
      if (mode === 'save') {
        setDirty(false); setMessage('Настройки сохранены.');
        // Reload the authoritative version and next run instead of predicting server state.
        setConfig(draft);
        const saved = result as Report & { version?: string; nextAt?: string };
        setVersion(saved.version ?? null); setNextAt(draft.enabled ? saved.nextAt ?? null : null);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие.'); } finally { setBusy(false); }
  }
  return <section className="admin-section auto-assembly-cabinet"><header><h3>{item.marketplace === 'WILDBERRIES' ? 'Wildberries' : 'Ozon'} · {item.accountName || 'Кабинет'}</h3><span>{config.enabled ? 'По расписанию' : 'Приостановлено'}</span></header>
    <fieldset disabled={busy || !available} className="auto-assembly-fields"><label><input type="checkbox" checked={config.enabled} onChange={e => change({ enabled: e.target.checked })} /> Включить автосборку</label>
      <label>Время запусков, МСК<input value={timesText} onChange={e => { setTimesText(e.target.value); setDirty(true); setReport(null); }} placeholder="00:00, 06:00, 12:00, 18:00" /></label>
      <div className="auto-assembly-interval"><label>Каждые<select value={interval} onChange={e => setInterval(e.target.value)}>{[1, 2, 3, 4, 6, 8, 12, 24].map(h => <option key={h} value={h}>{h} ч.</option>)}</select></label><label>Начиная с<input type="time" value={start} onChange={e => setStart(e.target.value)} /></label><button className="admin-button" type="button" disabled={!start} onClick={makeTimes}>Заполнить время</button></div>
      <label><input type="checkbox" checked={config.allWarehouses} onChange={e => change({ allWarehouses: e.target.checked })} /> Все направления действующей маршрутизации</label>
      {!config.allWarehouses && <div>{item.routes.map(route => <label className="auto-assembly-route" key={route.id}><input type="checkbox" checked={config.warehouseIds.includes(route.id)} onChange={e => change({ warehouseIds: e.target.checked ? [...config.warehouseIds, route.id] : config.warehouseIds.filter(id => id !== route.id) })} />{route.name}</label>)}{!item.routes.length && <p>Индивидуальные направления не найдены. Настройте маршрутизацию или выберите все направления.</p>}</div>}
    </fieldset>
    <p>Ближайший запуск: {nextAt ? new Date(nextAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК' : 'не назначен'}{dirty ? ' · Есть несохранённые изменения' : ''}</p>
    {item.marketplace === 'OZON' && <p>Создаётся заявка WMS. Передача собранного заказа в Ozon остаётся действием сотрудника.</p>}
    <div className="auto-assembly-interval"><button className="admin-button" disabled={busy || !available} onClick={() => void action('save')}><Save size={16} />Сохранить</button><button className="admin-button admin-button--ghost" disabled={busy || !available} onClick={() => void action('preview')}><RefreshCw size={16} />Предпросмотр</button><button className="admin-button admin-button--ghost" disabled={busy || !available || dirty || !version} onClick={() => void action('run')}><Play size={16} />Запустить сейчас</button></div>
    {message && <p role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}{report && <ReportView report={report} />}
    <details><summary>История запусков ({history.length})</summary>{history.length ? history.map((r, i) => <ReportView key={r.startedAt || i} report={r} />) : <p>Запусков пока не было.</p>}</details>
  </section>;
}
function ReportView({ report }: { report: Report }) {
  const labels: Record<string, string> = { RUNNING: 'Запуск начат; результат ещё не подтверждён', DONE: 'Завершено', PARTIAL: 'Частично выполнено', ERROR: 'Ошибка' };
  return <div className="auto-assembly-report">{report.startedAt && <strong>{new Date(report.startedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК · {labels[report.status || ''] || report.status}</strong>}{report.error && <p className="form-error">{report.error}</p>}{report.groups?.map((g, i) => <p key={i}>{g.label}: {g.count} заказов {g.requestNumber ? `· Заявка №${String(g.requestNumber).padStart(6, '0')}` : ''}{g.error ? ` · ${g.error}` : ''}</p>)}<p>Пропущено заказов: {report.skipped ?? 0}</p></div>;
}
