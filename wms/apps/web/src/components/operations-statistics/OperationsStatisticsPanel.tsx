import { Fragment, useEffect, useState } from 'react';
import { fetchBranches, fetchClients, fetchOperationsStatistics, type AuthSession, type BranchSummary, type ClientSummary,
  fetchStatisticsRefresh, startStatisticsRefresh, type StatisticsRefresh, type OperationsStatisticsReport, type OperationsStatisticsSummary } from '../../lib/api';
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
  const [refresh, setRefresh] = useState<StatisticsRefresh | null>(null), [starting, setStarting] = useState(false);
  const refreshRunning = refresh?.status === 'running';
  const refreshMarketplace = async () => {
    setStarting(true); setError('');
    try { setRefresh(await startStatisticsRefresh(session.accessToken, { clientId, branchId, marketplace, dateFrom, dateTo })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось запустить обновление WB.'); }
    finally { setStarting(false); }
  };
  useEffect(() => {
    if (!refreshRunning || !refresh) return;
    let active = true, loading = false;
    const id = refresh.id;
    const poll = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await fetchStatisticsRefresh(session.accessToken, id);
        if (active) { setRefresh(result); if (result.status !== 'running') setRevision(v => v + 1); }
      } catch (caught) { if (active) { setError(caught instanceof Error ? caught.message : 'Не удалось проверить обновление WB.'); setRefresh(null); } }
      finally { loading = false; }
    };
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh?.id, refreshRunning, session.accessToken]);
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
      <p>От создания заказа до скана поставки на СЦ/ПВЗ · приёмка заказов отдельно</p></div>
      <button type="button" disabled={busy} onClick={() => setRevision(v => v + 1)}>{busy ? 'Обновление…' : 'Обновить таблицу'}</button>
      <button type="button" disabled={starting || refreshRunning || marketplace === 'OZON' || !dateFrom || !dateTo} onClick={() => void refreshMarketplace()}>
        {starting || refreshRunning ? 'Проверяю WB…' : 'Получить даты и статусы WB'}</button></header>
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
    {refresh && <div role="status" className={refresh.errors.length ? 'ops-statistics__warning' : 'ops-statistics__note'}>
      WB: {refresh.status === 'running' ? 'обновление выполняется' : refresh.status === 'complete' ? 'обновление завершено' : 'обновление неполное'}.
      Обновлено заказов: {number(refresh.ordersUpdated)}, кабинетов: {number(refresh.connectionsDone)}.
      {refresh.errors.map((message, i) => <p key={i}>{message}</p>)}</div>}
    <p className="ops-statistics__note">Только склады, обслуживаемые нашими филиалами; исключённые склады не учитываются.
      Период — по дате создания заказа, время московское. Проценты — от заказов с рассчитанным сроком до скана.
      Скан поставки — общий ориентир, не индивидуальный скан каждой вещи и не подтверждение приёмки всех заказов.
      Границы зон: 14 ч → жёлтая, 18 ч → оранжевая, 24 ч → красная, 48 ч → 48+.
      Перевод «В доставку» не используется вместо скана.</p>
    <p className="ops-statistics__warning">Для Ozon источник даты создания заказа покупателем и фактического скана ещё не подключён.
      Дата поступления в обработку и плановая отгрузка не подставляются вместо них.</p>
    {!data && <p role="status">{busy ? 'Загружаю статистику…' : 'Нет загруженного отчёта.'}</p>}
    {data && <>
      <div className="ops-statistics__cards">
        <article><span>Заказов в периоде</span><strong>{number(data.summary.total)}</strong></article>
        <article><span>Срок до скана рассчитан</span><strong>{number(data.summary.timedShipped)}</strong><small>По скану поставки: {number(data.summary.timingSources.supplyScan)}</small></article>
        <article><span>Приёмка WB подтверждена</span><strong>{number(data.summary.acceptance.confirmed)} / {number(data.summary.total)}</strong><small>Ожидают: {number(data.summary.acceptance.waiting)}</small></article>
        <article><span>Требуют повторной отгрузки</span><strong>{number(data.summary.acceptance.reshipment)}</strong><small>Неизвестный статус: {number(data.summary.acceptance.unknown)}</small></article>
        <article><span>Среднее до скана</span><strong>{data.summary.averageHours === null ? '—' : `${number(data.summary.averageHours)} ч`}</strong></article>
      </div>
      <div className="ops-statistics__heading"><p>Обновление таблицы — каждую минуту. Рассчитано: {time(data.generatedAt)}.</p>
        <button type="button" onClick={() => setExpanded(expanded.length ? [] : data.branches.map(b => b.id))}>{expanded.length ? 'Свернуть филиалы' : 'Развернуть филиалы'}</button></div>
      <StatisticsTable data={data} expanded={expanded} onToggle={id => setExpanded(current => current.includes(id) ? current.filter(v => v !== id) : [...current, id])} />
      {data.summary.total === 0 && <p>За выбранный период заказов с известной датой создания не найдено.</p>}
      <p className="ops-statistics__note">Последняя проверка WB: {data.lastSyncedAt ? time(data.lastSyncedAt) : 'нет данных'}.
        Самая старая проверка включённых заказов: {data.oldestCheckedAt ? time(data.oldestCheckedAt) : 'нет данных'}.
        Без проверки новым механизмом: {number(data.uncheckedOrders)}.
        Отменённые и требующие повторной отгрузки заказы исключены из временных зон. «Нет данных» — нет скана или даты противоречат друг другу.
        Заказ считается один раз, независимо от количества вещей; повторные сборки не увеличивают число заказов.</p>
      <p className="ops-statistics__warning">Без исходной даты заказа: {number(data.missingOrderDate)}. Это заказы выбранных клиентов и филиалов за всё время,
        которые невозможно отнести к выбранному периоду. Они не включены в проценты. Для заполнения истории используйте «Получить даты и статусы WB»;
        время сборки и плановую дату отгрузки вместо отсутствующих дат не используем.</p>
    </>}
  </section>;
}

function Cells({ summary }: { summary: OperationsStatisticsSummary }) {
  return <><td>{number(summary.total)}</td><td>{number(summary.timedShipped)}</td>
    {/* FIX: no denominator means missing measurements, not 0% performance. */}
    {summary.buckets.map(b => <td key={b.color} className={`ops-zone ops-zone--${b.color}`}>
      {summary.timedShipped ? <><strong>{number(b.count)}</strong><small>{number(b.percent)}%</small></>
        : <span title="Нет рассчитанных сроков">—</span>}</td>)}
    <td>{number(summary.acceptance.confirmed)}</td><td>{number(summary.acceptance.waiting)}<small>Без скана 24+ ч: {number(summary.pendingOver24h)}</small></td>
    <td>{number(summary.acceptance.reshipment)}</td><td>{number(summary.cancelled)}</td><td>{number(summary.acceptance.unknown)}</td><td>{number(summary.unknown)}</td></>;
}
export function StatisticsTable({ data, expanded, onToggle }: {
  data: OperationsStatisticsReport; expanded: string[]; onToggle: (id: string) => void;
}) {
  return <div className="ops-statistics__scroll"><table><caption>Количество заказов и доля по срокам обработки</caption>
    <thead><tr><th scope="col">Филиал / склад продавца</th><th scope="col">Всего</th><th scope="col">Срок рассчитан</th>
      {data.summary.buckets.map(b => <th scope="col" key={b.color} className={`ops-zone ops-zone--${b.color}`}>{b.label}</th>)}
      <th scope="col">Приёмка подтверждена</th><th scope="col">Ожидают приёмки</th><th scope="col">Довезти</th>
      <th scope="col">Отменено</th><th scope="col">Статус неизвестен</th><th scope="col">Нет данных о времени</th></tr></thead>
    <tbody><tr className="ops-statistics__total"><th scope="row">Все филиалы</th><Cells summary={data.summary} /></tr>
      {data.branches.map(branch => <Fragment key={branch.id}>
        <tr className="ops-statistics__branch"><th scope="row"><button type="button" aria-expanded={expanded.includes(branch.id)}
          onClick={() => onToggle(branch.id)}>{expanded.includes(branch.id) ? '▾' : '▸'} {branch.name}</button></th><Cells summary={branch.summary} /></tr>
        {expanded.includes(branch.id) && branch.warehouses.map(w => <tr key={w.id}><th scope="row" className="ops-statistics__seller">{w.name}
          <small>{w.marketplace === 'OZON' ? 'Ozon' : 'WB'} · {w.clientName}{w.accountName ? ` · ${w.accountName}` : ''}</small></th><Cells summary={w.summary} /></tr>)}
        {expanded.includes(branch.id) && !branch.warehouses.length && <tr><td colSpan={14}>Нет складов продавца и заказов по выбранным фильтрам.</td></tr>}
      </Fragment>)}
    </tbody></table></div>;
}
