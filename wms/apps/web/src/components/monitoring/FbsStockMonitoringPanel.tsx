import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock3,
  Download,
  Filter,
  LoaderCircle,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldQuestion,
  Wrench,
  X,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  downloadFbsStockMonitorWmsStocks,
  fetchFbsStockMonitor,
  fetchFbsStockMonitorConfig,
  fetchFbsStockMonitorEvent,
  previewFbsStockMonitorRepair,
  repairFbsStockMonitor,
  refreshFbsStockMonitor,
  updateFbsStockMonitorConfig,
  type AuthSession,
  type FbsStockMonitorConfig,
  type FbsStockMonitorEvent,
  type FbsStockMonitorEventDetail,
  type FbsStockMonitorResponse,
  type FbsStockMonitorRepairPreview,
  type FbsStockMonitorStatus,
} from '../../lib/api';

type Props = { session: AuthSession };
type SystemFilter = 'ALL' | 'WB' | 'WMS';
type StatusFilter = FbsStockMonitorStatus | 'ALL';
type RepairDialogState = { preview: FbsStockMonitorRepairPreview; idempotencyKey: string };

const statusCopy: Record<FbsStockMonitorStatus, string> = {
  SUCCESS: 'Подтверждено',
  ERROR: 'Ошибка',
  PENDING: 'Ожидание',
  UNAVAILABLE: 'Нет данных',
};

export function FbsStockMonitoringPanel({ session }: Props) {
  const [data, setData] = useState<FbsStockMonitorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [clientId, setClientId] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [system, setSystem] = useState<SystemFilter>('ALL');
  const [product, setProduct] = useState('');
  const [dateFrom, setDateFrom] = useState(() => dateInput(-1));
  const [dateTo, setDateTo] = useState(() => dateInput(0));
  const [sort, setSort] = useState<'time' | 'status'>('time');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState('');
  const [detail, setDetail] = useState<FbsStockMonitorEventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<FbsStockMonitorConfig | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [preparingRepairId, setPreparingRepairId] = useState('');
  const [repairingId, setRepairingId] = useState('');
  const [repairDialog, setRepairDialog] = useState<RepairDialogState | null>(null);
  const clientSelectRef = useRef<HTMLSelectElement>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const response = await fetchFbsStockMonitor(session.accessToken, {
        clientId: clientId || undefined,
        connectionId: connectionId || undefined,
        warehouseId: warehouseId || undefined,
        status,
        system,
        product: product || undefined,
        q: query || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        sort,
        direction,
        page,
        pageSize: 50,
      });
      setData(response);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Мониторинг остатков временно недоступен.');
    } finally {
      if (initial) setLoading(false);
    }
  }, [clientId, connectionId, dateFrom, dateTo, direction, page, product, query, session.accessToken, sort, status, system, warehouseId]);

  useEffect(() => {
    let active = true;
    let timer = 0;
    let debounce = 0;
    const run = async (initial = false) => {
      if (!active) return;
      await load(initial);
    };
    debounce = window.setTimeout(() => void run(true), 250);
    timer = window.setInterval(() => void run(false), 15_000);
    return () => {
      active = false;
      window.clearTimeout(debounce);
      window.clearInterval(timer);
    };
  }, [load]);

  const connections = useMemo(
    () => (data?.filters.connections ?? []).filter((item) => !clientId || item.clientId === clientId),
    [clientId, data?.filters.connections],
  );
  const canConfigure = session.user.permissionCodes.includes('system:admin')
    || session.user.permissionCodes.includes('clients:write');
  const exportClientId = clientId || (data?.filters.clients.length === 1 ? data.filters.clients[0].id : '');
  const exportAction = wmsStockExportActionState(exporting, exportClientId);

  // FIX: export is independent from the current monitoring page and filters.
  const exportWmsStocks = async () => {
    // FIX: administrators start on "Все клиенты". Keep the action available
    // and guide them to the required client instead of showing a dead button.
    if (exportAction.needsClientSelection) {
      setError('Выберите клиента для выгрузки остатков в Excel.');
      clientSelectRef.current?.focus();
      return;
    }
    if (exportAction.disabled) return;
    setExporting(true);
    setError('');
    setNotice('');
    try {
      const blob = await downloadFbsStockMonitorWmsStocks(session.accessToken, exportClientId);
      if (blob.size === 0) throw new Error('WMS вернула пустой файл. Выгрузка отменена.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = wmsStockExportFileName(new Date());
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice('Актуальные остатки WMS выгружены в Excel.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сформировать Excel с остатками WMS.');
    } finally {
      setExporting(false);
    }
  };

  const manualRefresh = async (eventIds?: string[]) => {
    setRefreshing(true);
    setNotice('');
    try {
      const result = await refreshFbsStockMonitor(session.accessToken, {
        clientId: clientId || undefined,
        connectionId: connectionId || undefined,
        eventIds: eventIds ?? data?.items.map((item) => item.id),
      });
      setNotice(result.message || `Проверено: ${result.checked}. Подтверждено: ${result.succeeded}. Ошибок: ${result.failed}.`);
      await load(false);
      if (eventIds?.length === 1 && expandedId === eventIds[0]) await openDetail(eventIds[0], true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось повторить проверку.');
    } finally {
      setRefreshing(false);
    }
  };

  const openDetail = async (eventId: string, force = false) => {
    if (!force && expandedId === eventId) {
      setExpandedId('');
      setDetail(null);
      return;
    }
    setExpandedId(eventId);
    setDetailLoading(true);
    try {
      setDetail(await fetchFbsStockMonitorEvent(session.accessToken, eventId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить историю события.');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const openSettings = async () => {
    if (!connectionId) return;
    setSettingsOpen(true);
    setConfigBusy(true);
    try {
      setConfig(await fetchFbsStockMonitorConfig(session.accessToken, connectionId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить настройки мониторинга.');
      setSettingsOpen(false);
    } finally {
      setConfigBusy(false);
    }
  };

  const saveSettings = async () => {
    if (!config) return;
    setConfigBusy(true);
    try {
      const saved = await updateFbsStockMonitorConfig(session.accessToken, config.connectionId, {
        enabled: config.enabled,
        allowedDelaySeconds: config.allowedDelaySeconds,
        retryIntervalSeconds: config.retryIntervalSeconds,
        maxAttempts: config.maxAttempts,
        wbRule: config.wbRule,
        wmsRule: config.wmsRule,
      });
      setConfig(saved);
      setNotice('Настройки мониторинга сохранены. Они применяются к новым и следующим проверкам.');
      setSettingsOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить настройки мониторинга.');
    } finally {
      setConfigBusy(false);
    }
  };

  const prepareRepair = async (item: FbsStockMonitorEvent) => {
    if (!item.repairAvailable || preparingRepairId || repairingId) return;
    setPreparingRepairId(item.id);
    setError('');
    setNotice('');
    try {
      const preview = await previewFbsStockMonitorRepair(session.accessToken, item.id);
      setRepairDialog({ preview, idempotencyKey: repairOperationKey(item.id) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось повторно проверить остатки перед исправлением.');
      await load(false);
    } finally {
      setPreparingRepairId('');
    }
  };

  const confirmRepair = async () => {
    if (!repairDialog || repairingId) return;
    const eventId = repairDialog.preview.eventId;
    setRepairingId(eventId);
    setError('');
    setNotice('');
    try {
      const result = await repairFbsStockMonitor(
        session.accessToken,
        eventId,
        repairDialog.idempotencyKey,
      );
      // FIX: update the visible row and expanded history immediately; the
      // following background load only reconciles counters and page order.
      setData((current) => current ? {
        ...current,
        items: current.items.map((item) => item.id === eventId ? result.event : item),
      } : current);
      if (expandedId === eventId) setDetail(result.event);
      setNotice(result.message);
      setRepairDialog(null);
      await load(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Wildberries не принял исправление остатка.');
      await load(false);
      if (expandedId === eventId) await openDetail(eventId, true);
    } finally {
      setRepairingId('');
    }
  };

  if (loading && !data) return <StockMonitorSkeleton />;

  return (
    <section className="stock-monitor">
      <header className="stock-monitor__header">
        <div>
          <h2>Мониторинг остатков ВБ и WMS</h2>
          <p>Сопоставление заказов Wildberries с изменением агрегированного остатка ВБ и резервом или доступным количеством WMS.</p>
        </div>
        <div className="stock-monitor__header-actions">
          <span className="stock-monitor__updated"><Clock3 size={15} />Обновлено {data ? timeOnly(data.checkedAt) : '—'}</span>
          <button type="button" onClick={() => void exportWmsStocks()} disabled={exportAction.disabled} title={exportAction.needsClientSelection ? 'Нажмите и выберите клиента' : undefined}>
            {exporting ? <RefreshCw size={16} className="is-spinning" /> : <Download size={16} />}
            {exporting ? 'Формирую Excel…' : 'Выгрузить остатки в Excel'}
          </button>
          <button type="button" onClick={() => void manualRefresh()} disabled={refreshing || !data?.items.length}>
            <RefreshCw size={16} className={refreshing ? 'is-spinning' : ''} />
            {refreshing ? 'Проверяю…' : 'Проверить сейчас'}
          </button>
        </div>
      </header>

      {data ? <MonitorCounters data={data} /> : null}

      <div className="stock-monitor__filters">
        <label className="stock-monitor__search">
          <Search size={17} aria-hidden="true" />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Артикул, ШК, размер, цвет или заказ" />
        </label>
        <select ref={clientSelectRef} aria-label="Клиент" value={clientId} onChange={(event) => { setClientId(event.target.value); setConnectionId(''); setPage(1); }}>
          <option value="">Все клиенты</option>
          {data?.filters.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
        <select aria-label="Кабинет Wildberries" value={connectionId} onChange={(event) => { setConnectionId(event.target.value); setPage(1); }}>
          <option value="">Все кабинеты WB</option>
          {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.accountName || connection.id}</option>)}
        </select>
        <select aria-label="Склад Wildberries" value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setPage(1); }}>
          <option value="">Все склады</option>
          {data?.filters.warehouses.filter((item) => item.id).map((warehouse) => <option key={warehouse.id!} value={warehouse.id!}>{warehouse.name || warehouse.id}</option>)}
        </select>
        <select aria-label="Система" value={system} onChange={(event) => { setSystem(event.target.value as SystemFilter); setPage(1); }}>
          <option value="ALL">ВБ и WMS</option><option value="WB">Только ВБ</option><option value="WMS">Только WMS</option>
        </select>
        <select aria-label="Статус" value={status} onChange={(event) => { setStatus(event.target.value as StatusFilter); setPage(1); }}>
          <option value="ALL">Все статусы</option>
          {(Object.keys(statusCopy) as FbsStockMonitorStatus[]).map((value) => <option key={value} value={value}>{statusCopy[value]}</option>)}
        </select>
        <label className="stock-monitor__date"><span>С</span><input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} /></label>
        <label className="stock-monitor__date"><span>По</span><input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} /></label>
        <input className="stock-monitor__product" aria-label="Фильтр по скрытому наименованию товара" value={product} onChange={(event) => { setProduct(event.target.value); setPage(1); }} placeholder="Фильтр по названию" />
        <select aria-label="Сортировка" value={`${sort}:${direction}`} onChange={(event) => {
          const [nextSort, nextDirection] = event.target.value.split(':') as ['time' | 'status', 'asc' | 'desc'];
          setSort(nextSort); setDirection(nextDirection); setPage(1);
        }}>
          <option value="time:desc">Красные сверху · затем новые</option>
          <option value="time:asc">Красные сверху · затем старые</option>
        </select>
        {canConfigure ? (
          <button type="button" className="stock-monitor__settings-button" disabled={!connectionId} onClick={() => void openSettings()} title={!connectionId ? 'Сначала выберите кабинет WB' : undefined}>
            <Settings2 size={16} />Настройки
          </button>
        ) : null}
      </div>

      {settingsOpen ? <MonitorSettings config={config} busy={configBusy} onChange={setConfig} onSave={() => void saveSettings()} onClose={() => setSettingsOpen(false)} /> : null}
      {error ? <div className="stock-monitor__message is-error"><AlertTriangle size={17} />{error}<button type="button" aria-label="Закрыть ошибку" onClick={() => setError('')}><X size={15} /></button></div> : null}
      {notice ? <div className="stock-monitor__message is-success"><CheckCircle2 size={17} />{notice}<button type="button" aria-label="Закрыть сообщение" onClick={() => setNotice('')}><X size={15} /></button></div> : null}

      <div className="stock-monitor__table-wrap">
        <table className="stock-monitor__table">
          <thead>
            <tr>
              <th aria-label="История" />
              <th>Продажа / заказ</th>
              <th>Идентификаторы / характеристики</th>
              <th>Кол-во</th>
              <th>ВБ до → после / сейчас</th>
              <th>Статус ВБ</th>
              <th>WMS до → после / сейчас</th>
              <th>Резерв</th>
              <th>Статус WMS</th>
              <th>Последняя проверка</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <Fragment key={item.id}>
                <MonitorRow
                  item={item}
                  expanded={expandedId === item.id}
                  preparing={preparingRepairId === item.id}
                  busy={Boolean(preparingRepairId || repairingId)}
                  onOpen={() => void openDetail(item.id)}
                  onRepair={() => void prepareRepair(item)}
                />
                {expandedId === item.id ? (
                  <tr className="stock-monitor__detail-row">
                    <td colSpan={11}>
                      {detailLoading ? <div className="stock-monitor__detail-loading"><RefreshCw size={18} className="is-spinning" />Загружаю историю…</div> : detail ? (
                        <MonitorDetail detail={detail} refreshing={refreshing} onRefresh={() => void manualRefresh([detail.id])} />
                      ) : <div className="stock-monitor__detail-loading">История недоступна.</div>}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!data?.items.length ? (
          <div className="stock-monitor__empty">
            <Filter size={28} />
            <strong>События по этим условиям не найдены</strong>
            <span>Проверьте период и фильтры. Новые заказы WB появятся после очередного фонового обновления.</span>
          </div>
        ) : null}
      </div>

      {data ? (
        <footer className="stock-monitor__footer">
          <span>Показано {data.items.length} из {data.total} · страница {data.page} из {data.pages}</span>
          <div>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}><ChevronLeft size={16} />Назад</button>
            <button type="button" onClick={() => setPage((value) => Math.min(data.pages, value + 1))} disabled={page >= data.pages}>Дальше<ChevronRight size={16} /></button>
          </div>
        </footer>
      ) : null}

      {repairDialog ? (
        <MonitorRepairDialog
          preview={repairDialog.preview}
          busy={repairingId === repairDialog.preview.eventId}
          onConfirm={() => void confirmRepair()}
          onClose={() => { if (!repairingId) setRepairDialog(null); }}
        />
      ) : null}
    </section>
  );
}

function MonitorCounters({ data }: { data: FbsStockMonitorResponse }) {
  return (
    <div className="stock-monitor__counters">
      <div className="is-success"><CheckCircle2 size={19} /><span><strong>{data.counts.SUCCESS}</strong><small>Подтверждено</small></span></div>
      <div className="is-error"><AlertTriangle size={19} /><span><strong>{data.counts.ERROR}</strong><small>Расхождения</small></span></div>
      <div className="is-pending"><CircleDashed size={19} /><span><strong>{data.counts.PENDING}</strong><small>Ожидают</small></span></div>
      <div className="is-unavailable"><ShieldQuestion size={19} /><span><strong>{data.counts.UNAVAILABLE}</strong><small>Недостаточно данных</small></span></div>
      <div className="stock-monitor__technical">
        <small>Проверок за 24 ч.</small><strong>{data.technical.checks24h}</strong>
        <span>{data.technical.lastRunError ? 'Последний запуск с ошибкой' : data.technical.workerRunning ? 'Проверка выполняется' : 'Фоновый контроль активен'}</span>
      </div>
    </div>
  );
}

export function canRepairStockMonitorEvent(item: FbsStockMonitorEvent) {
  return item.overallStatus === 'ERROR'
    && item.wbStatus === 'ERROR'
    && item.wmsStatus === 'SUCCESS'
    && item.lastCheckedAt !== null
    && item.repairAvailable
    && !item.repairInProgress;
}

// FIX: a missing client requires guidance, not a disabled export control.
export function wmsStockExportActionState(exporting: boolean, clientId: string) {
  return { disabled: exporting, needsClientSelection: !clientId };
}

function MonitorRow({
  item,
  expanded,
  preparing,
  busy,
  onOpen,
  onRepair,
}: {
  item: FbsStockMonitorEvent;
  expanded: boolean;
  preparing: boolean;
  busy: boolean;
  onOpen: () => void;
  onRepair: () => void;
}) {
  const issue = item.wbMessage || item.wmsMessage;
  const repairAvailable = canRepairStockMonitorEvent(item);
  return (
    <tr className={`stock-monitor__row is-${item.overallStatus.toLowerCase()}`}>
      <td><button type="button" className="stock-monitor__expand" aria-label={expanded ? 'Свернуть историю' : 'Открыть историю'} aria-expanded={expanded} onClick={onOpen}><ChevronDown size={17} /></button></td>
      <td><time dateTime={item.saleAt}>{dateTime(item.saleAt)}</time><strong>№{item.orderId}</strong><small>{eventTypeLabel(item.eventType)} · {item.marketplaceWarehouseName || item.marketplaceWarehouseId || 'склад WB не указан'}</small></td>
      <td><strong>Арт. {item.article || '—'}</strong><span>ШК {item.barcode || '—'}</span><small>Размер {item.size || '—'} · цвет {item.color || '—'}</small><small>nmID {item.nmId || '—'}</small>{issue ? <em title={issue}>{issue}</em> : null}</td>
      <td className="stock-monitor__quantity">{item.quantity}</td>
      <td><AmountFlow before={item.wbBeforeAmount} after={item.wbAfterAmount} current={item.wbCurrentAmount} /></td>
      <td><StatusBadge status={item.wbStatus} label="ВБ" /></td>
      <td><AmountFlow before={item.wmsBeforeAmount} after={item.wmsAfterAmount} current={item.wmsCurrentAmount} /></td>
      <td className="stock-monitor__quantity">{amount(item.wmsReservedAmount)}</td>
      <td><StatusBadge status={item.wmsStatus} label="WMS" /></td>
      <td><time dateTime={item.lastCheckedAt || item.detectedAt}>{item.lastCheckedAt ? dateTime(item.lastCheckedAt) : 'Ещё не проверялось'}</time><small>WB: {item.wbAttempts} · WMS: {item.wmsAttempts}</small></td>
      <td className="stock-monitor__action">
        {item.repairInProgress ? <small>Исправление выполняется</small> : repairAvailable ? (
          <button type="button" disabled={busy} onClick={onRepair}>
            {preparing ? <LoaderCircle size={14} className="is-spinning" /> : <Wrench size={14} />}
            {preparing ? 'Проверяю…' : 'Исправить остаток'}
          </button>
        ) : <small>—</small>}
      </td>
    </tr>
  );
}

function MonitorDetail({ detail, refreshing, onRefresh }: { detail: FbsStockMonitorEventDetail; refreshing: boolean; onRefresh: () => void }) {
  return (
    <section className="stock-monitor-detail">
      <header>
        <div><h3>История заказа №{detail.orderId}</h3><p>Исходное событие, снимки остатков и все повторные проверки.</p></div>
        <button type="button" onClick={onRefresh} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'is-spinning' : ''} />Повторить проверку</button>
      </header>
      <dl className="stock-monitor-detail__facts">
        <div><dt>Событие</dt><dd>{eventTypeLabel(detail.eventType)}</dd></div>
        <div><dt>WB order UID</dt><dd>{detail.orderUid || '—'}</dd></div>
        <div><dt>SKU WMS</dt><dd>{detail.skuId}</dd></div>
        <div><dt>chrtID</dt><dd>{detail.chrtId ?? '—'}</dd></div>
        <div><dt>Ожидание до</dt><dd>{dateTime(detail.deadlineAt)}</dd></div>
        <div><dt>Следующая проверка</dt><dd>{detail.nextCheckAt ? dateTime(detail.nextCheckAt) : 'не запланирована'}</dd></div>
      </dl>
      <div className="stock-monitor-detail__timeline">
        {detail.history.map((entry) => (
          <article key={entry.id} className={`is-${entry.status.toLowerCase()}`}>
            <StatusIcon status={entry.status} />
            <div>
              <strong>{historyTitle(entry)}</strong>
              <span>{entry.kind === 'MANUAL_REPAIR'
                ? `До: ${amount(entry.beforeAmount)} · установлено: ${amount(entry.expectedAmount)} · после: ${amount(entry.currentAmount)} · резерв WMS: ${amount(entry.reservedAmount)}`
                : `До: ${amount(entry.beforeAmount)} · ожидалось: ${amount(entry.expectedAmount)} · сейчас: ${amount(entry.currentAmount)}${entry.system === 'WMS' ? ` · резерв: ${amount(entry.reservedAmount)}` : ''}`}</span>
              {entry.message ? <p>{entry.message}</p> : null}
              {entry.sourceIds ? <code>{sourceIds(entry.sourceIds)}</code> : null}
            </div>
            <time dateTime={entry.createdAt}>{dateTime(entry.createdAt)}</time>
          </article>
        ))}
      </div>
    </section>
  );
}

function MonitorRepairDialog({
  preview,
  busy,
  onConfirm,
  onClose,
}: {
  preview: FbsStockMonitorRepairPreview;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="stock-monitor-repair__backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="stock-monitor-repair" role="dialog" aria-modal="true" aria-labelledby="stock-monitor-repair-title">
        <header>
          <div>
            <h3 id="stock-monitor-repair-title">Подтвердите исправление остатка</h3>
            <p>Значения повторно получены из Wildberries и WMS. Остаток WB будет только уменьшен до безопасного доступного WMS.</p>
          </div>
          <button type="button" aria-label="Закрыть подтверждение" disabled={busy} onClick={onClose}><X size={17} /></button>
        </header>
        <dl>
          <div><dt>Артикул</dt><dd>{preview.article || '—'}</dd></div>
          <div><dt>Штрихкод</dt><dd>{preview.barcode || '—'}</dd></div>
          <div><dt>Текущий остаток WB</dt><dd>{amount(preview.currentWbAmount)}</dd></div>
          <div><dt>Доступно WMS</dt><dd>{amount(preview.currentWmsAvailableAmount)}</dd></div>
          <div><dt>Резерв WMS</dt><dd>{amount(preview.currentWmsReservedAmount)}</dd></div>
          <div className="stock-monitor-repair__target"><dt>Будет установлено в WB</dt><dd>{amount(preview.targetAmount)}</dd></div>
        </dl>
        <p className="stock-monitor-repair__checked">Актуальность данных: {dateTime(preview.checkedAt)}</p>
        <footer>
          <button type="button" className="is-secondary" disabled={busy} onClick={onClose} autoFocus>Отмена</button>
          <button type="button" className="is-primary" disabled={busy} onClick={onConfirm}>
            {busy ? <LoaderCircle size={15} className="is-spinning" /> : <Wrench size={15} />}
            {busy ? 'Исправляю и проверяю…' : 'Исправить остаток'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function MonitorSettings({ config, busy, onChange, onSave, onClose }: { config: FbsStockMonitorConfig | null; busy: boolean; onChange: (value: FbsStockMonitorConfig) => void; onSave: () => void; onClose: () => void }) {
  return (
    <section className="stock-monitor-settings" aria-label="Настройки мониторинга">
      <header><div><h3>Правила проверки кабинета</h3><p>Изменения влияют только на мониторинг и не меняют остатки или публикации.</p></div><button type="button" aria-label="Закрыть настройки" onClick={onClose}><X size={17} /></button></header>
      {config ? (
        <div className="stock-monitor-settings__form">
          <label className="stock-monitor-settings__toggle"><input type="checkbox" checked={config.enabled} onChange={(event) => onChange({ ...config, enabled: event.target.checked })} /><span>Мониторинг включён</span></label>
          <label><span>Допустимое ожидание, сек.</span><input type="number" min={30} max={86400} value={config.allowedDelaySeconds} onChange={(event) => onChange({ ...config, allowedDelaySeconds: Number(event.target.value) })} /></label>
          <label><span>Интервал проверки, сек.</span><input type="number" min={5} max={3600} value={config.retryIntervalSeconds} onChange={(event) => onChange({ ...config, retryIntervalSeconds: Number(event.target.value) })} /></label>
          <label><span>Максимум попыток</span><input type="number" min={1} max={100} value={config.maxAttempts} onChange={(event) => onChange({ ...config, maxAttempts: Number(event.target.value) })} /></label>
          <div className="stock-monitor-settings__rules"><span><b>ВБ:</b> точный заказ + ожидаемое изменение агрегированного остатка.</span><span><b>WMS:</b> резерв точного заказа или связанное изменение доступного количества.</span></div>
          <button type="button" className="stock-monitor-settings__save" onClick={onSave} disabled={busy}><Save size={16} />{busy ? 'Сохраняю…' : 'Сохранить настройки'}</button>
        </div>
      ) : <div className="stock-monitor__detail-loading"><RefreshCw size={18} className="is-spinning" />Загружаю настройки…</div>}
    </section>
  );
}

function AmountFlow({ before, after, current }: { before: number | null; after: number | null; current: number | null }) {
  return <span className="stock-monitor__amount-flow"><b>{amount(before)}</b><i>→</i><b>{amount(after)}</b><small>сейчас {amount(current)}</small></span>;
}

function StatusBadge({ status, label }: { status: FbsStockMonitorStatus; label: string }) {
  return <span className={`stock-monitor__status is-${status.toLowerCase()}`}><StatusIcon status={status} /><span><b>{label}</b>{statusCopy[status]}</span></span>;
}

function StatusIcon({ status }: { status: FbsStockMonitorStatus }) {
  if (status === 'SUCCESS') return <CheckCircle2 size={16} aria-hidden="true" />;
  if (status === 'ERROR') return <AlertTriangle size={16} aria-hidden="true" />;
  if (status === 'PENDING') return <CircleDashed size={16} aria-hidden="true" />;
  return <ShieldQuestion size={16} aria-hidden="true" />;
}

function StockMonitorSkeleton() {
  return <section className="stock-monitor stock-monitor--loading"><div className="stock-monitor__skeleton is-wide" /><div className="stock-monitor__skeleton-grid">{[1, 2, 3, 4].map((item) => <div className="stock-monitor__skeleton" key={item} />)}</div><div className="stock-monitor__skeleton is-table" /></section>;
}

function dateInput(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

function timeOnly(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

function wmsStockExportFileName(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return `wms_stocks_${local.slice(0, 10)}_${local.slice(11, 16).replace(':', '-')}.xlsx`;
}

function amount(value: number | null) { return value == null ? '—' : new Intl.NumberFormat('ru-RU').format(value); }
function eventTypeLabel(value: FbsStockMonitorEvent['eventType']) { return value === 'SALE' ? 'Продажа' : value === 'CANCEL' ? 'Отмена' : 'Возврат'; }
function historyTitle(entry: FbsStockMonitorEventDetail['history'][number]) {
  if (entry.kind === 'EVENT_DETECTED') return `${entry.system} · событие принято`;
  if (entry.kind === 'MANUAL_REPAIR') return `${entry.system} · ручное исправление остатка`;
  return `${entry.system} · проверка ${entry.attempt}`;
}
function sourceIds(value: Record<string, unknown>) {
  return Object.entries(value)
    .filter(([, item]) => item != null && item !== '')
    .map(([key, item]) => `${key}: ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`)
    .join(' · ');
}
function repairOperationKey(eventId: string) {
  const entropy = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `stock-monitor:${eventId}:${entropy}`;
}
