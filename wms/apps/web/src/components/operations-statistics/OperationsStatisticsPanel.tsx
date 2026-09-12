import { Fragment, useEffect, useState } from 'react';
import { fetchBranches, fetchClients, fetchOperationsStatistics, type AuthSession, type BranchSummary, type ClientSummary,
  type OperationsStatisticsReport, type OperationsStatisticsSummary } from '../../lib/api';
import './operations-statistics.css';

export function moscowDay(date: Date) { return new Date(+date + 3 * 3_600_000).toISOString().slice(0, 10); }
const number = (value: number) => value.toLocaleString('ru-RU');
const time = (value: string) => new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

export function OperationsStatisticsPanel({ session }: { session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]), [branches, setBranches] = useState<BranchSummary[]>([]);
  const [clientId, setClientId] = useState(''), [branchId, setBranchId] = useState(''), [marketplace, setMarketplace] = useState('');
  const [dateFrom, setDateFrom] = useState(() => moscowDay(new Date(Date.now() - 6 * 86_400_000)));
  const [dateTo, setDateTo] = useState(() => moscowDay(new Date()));
  const [data, setData] = useState<OperationsStatisticsReport | null>(null);
  const [error, setError] = useState(''), [optionsError, setOptionsError] = useState(''), [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0), [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    Promise.all([fetchClients(session.accessToken), fetchBranches(session.accessToken)]).then(([c, b]) => {
      if (active) { setClients(c); setBranches(b); setOptionsError(''); }
    }).catch(() => { if (active) setOptionsError('Не удалось загрузить фильтры. Обновите страницу.'); });
    return () => { active = false; };
  }, [session.accessToken]);
  useEffect(() => {
    let active = true, loading = false;
    setData(null);
    const load = async () => {
      if (loading || !dateFrom || !dateTo) return;
      loading = true; setBusy(true);
      try {
        const result = await fetchOperationsStatistics(session.accessToken, { clientId, branchId, marketplace, dateFrom, dateTo });
        if (active) { setData(result); setError(''); }
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить статистику.'); }
      finally { loading = false; if (active) setBusy(false); }
    };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    // FIX: late responses from an old client/filter must never overwrite the new report.
    return () => { active = false; window.clearInterval(timer); };
  }, [session.accessToken, session.user.activeWarehouseId, clientId, branchId, marketplace, dateFrom, dateTo, revision]);
  return <section className="ops-statistics" aria-label="Статистика обработки заказов">
    <header className="ops-statistics__heading"><div><p className="eyebrow">Склад и операции</p><h2>Статистика</h2>
      <p>От создания заказа до передачи в доставку WB/Ozon</p></div>
      <button type="button" disabled={busy} onClick={() => setRevision(v => v + 1)}>{busy ? 'Обновление…' : 'Обновить'}</button></header>
    <div className="ops-statistics__filters">
      <label>Клиент<select value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Все доступные клиенты</option>
        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Филиал<select value={branchId} onChange={e => setBranchId(e.target.value)}><option value="">Все доступные филиалы</option>
        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>Маркетплейс<select value={marketplace} onChange={e => setMarketplace(e.target.value)}><option value="">WB и Ozon</option>
        <option value="WILDBERRIES">Wildberries</option><option value="OZON">Ozon</option></select></label>
      <label>Заказы созданы с<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
      <label>По<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>
    </div>
    {(error || optionsError) && <p role="alert" className="ops-statistics__warning">{error || optionsError}{data ? ' Показаны предыдущие данные.' : ''}</p>}
    <p className="ops-statistics__note">Период — по дате создания заказа, время московское. Проценты — от отгруженных заказов с известными датами.
      Для Ozon начальная дата — поступление отправления в обработку, доступное в интеграции.
      Границы зон: 14 ч → жёлтая, 18 ч → оранжевая, 24 ч → красная, 48 ч → 48+.
      Электронная передача в доставку не подтверждает физический выезд товара.</p>
    {!data && <p role="status">{busy ? 'Загружаю статистику…' : 'Нет загруженного отчёта.'}</p>}
    {data && <>
      <div className="ops-statistics__cards">
        <article><span>Заказов в периоде</span><strong>{number(data.summary.total)}</strong></article>
        <article><span>Отгружено · время известно</span><strong>{number(data.summary.timedShipped)}</strong></article>
        <article><span>Ещё не отгружено</span><strong>{number(data.summary.pending)}</strong><small>Из них 24+ ч: {number(data.summary.pendingOver24h)}</small></article>
        <article><span>Среднее до отгрузки</span><strong>{data.summary.averageHours === null ? '—' : `${number(data.summary.averageHours)} ч`}</strong></article>
      </div>
      <div className="ops-statistics__heading"><p>Обновление таблицы — каждую минуту. Рассчитано: {time(data.generatedAt)}.</p>
        <button type="button" onClick={() => setExpanded(expanded.length ? [] : data.branches.map(b => b.id))}>{expanded.length ? 'Свернуть филиалы' : 'Развернуть филиалы'}</button></div>
      <StatisticsTable data={data} expanded={expanded} onToggle={id => setExpanded(current => current.includes(id) ? current.filter(v => v !== id) : [...current, id])} />
      {data.summary.total === 0 && <p>За выбранный период заказов с известной датой создания не найдено.</p>}
      <p className="ops-statistics__note">Последняя синхронизация среди включённых заказов: {data.lastSyncedAt ? time(data.lastSyncedAt) : 'нет данных'}.
        Отменённые заказы исключены из временных зон. «Нет данных» — нет даты передачи или даты противоречат друг другу.
        Заказ считается один раз, независимо от количества вещей; повторные сборки не увеличивают число заказов.</p>
      <p className="ops-statistics__warning">Без исходной даты заказа: {number(data.missingOrderDate)}. Это заказы выбранных клиентов и филиалов за всё время,
        которые невозможно отнести к выбранному периоду. Они не включены в проценты. История заполняется по мере синхронизации;
        время сборки и плановую дату отгрузки вместо отсутствующих дат не используем.</p>
    </>}
  </section>;
}

function Cells({ summary }: { summary: OperationsStatisticsSummary }) {
  return <><td>{number(summary.total)}</td><td>{number(summary.timedShipped)}</td>
    {summary.buckets.map(b => <td key={b.color} className={`ops-zone ops-zone--${b.color}`}><strong>{number(b.count)}</strong><small>{number(b.percent)}%</small></td>)}
    <td>{number(summary.pending)}<small>24+ ч: {number(summary.pendingOver24h)}</small></td><td>{number(summary.cancelled)}</td><td>{number(summary.unknown)}</td></>;
}
export function StatisticsTable({ data, expanded, onToggle }: {
  data: OperationsStatisticsReport; expanded: string[]; onToggle: (id: string) => void;
}) {
  return <div className="ops-statistics__scroll"><table><caption>Количество заказов и доля по срокам обработки</caption>
    <thead><tr><th scope="col">Филиал / склад продавца</th><th scope="col">Всего</th><th scope="col">Отгружено</th>
      {data.summary.buckets.map(b => <th scope="col" key={b.color} className={`ops-zone ops-zone--${b.color}`}>{b.label}</th>)}
      <th scope="col">В работе</th><th scope="col">Отменено</th><th scope="col">Нет данных</th></tr></thead>
    <tbody><tr className="ops-statistics__total"><th scope="row">Все филиалы</th><Cells summary={data.summary} /></tr>
      {data.branches.map(branch => <Fragment key={branch.id}>
        <tr className="ops-statistics__branch"><th scope="row"><button type="button" aria-expanded={expanded.includes(branch.id)}
          onClick={() => onToggle(branch.id)}>{expanded.includes(branch.id) ? '▾' : '▸'} {branch.name}</button></th><Cells summary={branch.summary} /></tr>
        {expanded.includes(branch.id) && branch.warehouses.map(w => <tr key={w.id}><th scope="row" className="ops-statistics__seller">{w.name}
          <small>{w.marketplace === 'OZON' ? 'Ozon' : 'WB'} · {w.clientName}{w.accountName ? ` · ${w.accountName}` : ''}</small></th><Cells summary={w.summary} /></tr>)}
        {expanded.includes(branch.id) && !branch.warehouses.length && <tr><td colSpan={11}>Нет складов продавца и заказов по выбранным фильтрам.</td></tr>}
      </Fragment>)}
    </tbody></table></div>;
}
