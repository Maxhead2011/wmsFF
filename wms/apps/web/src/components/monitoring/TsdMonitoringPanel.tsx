import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  History,
  LockOpen,
  LogOut,
  PackageCheck,
  RefreshCw,
  ScanLine,
  Search,
  Tablet,
  UserRound,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  disconnectAdministrationTsdRequest,
  fetchTsdMonitoring,
  sendTsdMonitorAction,
  type AuthSession,
  type TsdMonitoring,
} from '../../lib/api';
import './tsd-monitoring.css';

type Props = { session: AuthSession };
type Device = TsdMonitoring['devices'][number];
type PickerWorker = TsdMonitoring['pickerStatistics']['workers'][number];
type TsdReleaseMetadata = { versionCode?: number; versionName?: string };
type HistoryFilter = 'all' | 'success' | 'error';
type MonitorAction = 'RELOAD_REQUEST' | 'UPDATE_APP' | 'UNLOCK_INVENTORY' | 'LOGOUT';
type HistoryEntry = {
  id: string;
  tone: Exclude<HistoryFilter, 'all'>;
  title: string;
  details: string[];
  deviceCode: string;
  deviceName: string;
  workerName: string;
  createdAt: string;
};

export function TsdMonitoringPanel({ session }: Props) {
  const [data, setData] = useState<TsdMonitoring | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [commandDevice, setCommandDevice] = useState('');
  const [notice, setNotice] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [errorDeviceCode, setErrorDeviceCode] = useState('');
  const [latestTsdVersion, setLatestTsdVersion] = useState('');

  useEffect(() => {
    let active = true;
    let timer = 0;
    const loadRelease = async () => {
      try {
        const response = await fetch(`/downloads/logoff-tsd.json?v=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const release = await response.json() as TsdReleaseMetadata;
        if (active && typeof release.versionName === 'string') {
          setLatestTsdVersion(release.versionName.trim());
        }
      } catch {
        // Если метаданные временно недоступны, обновление остаётся доступным — это безопаснее ложного статуса «Обновлён».
      }
    };
    void loadRelease();
    timer = window.setInterval(() => void loadRelease(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let timer = 0;
    const load = async (initial = false) => {
      if (initial) setLoading(true);
      try {
        const next = await fetchTsdMonitoring(session.accessToken);
        if (!active) return;
        setData(next);
        setError('');
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Мониторинг ТСД временно недоступен.');
      } finally {
        if (active && initial) setLoading(false);
      }
    };
    void load(true);
    timer = window.setInterval(() => void load(false), 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [session.accessToken]);

  const devices = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru-RU');
    return (data?.devices ?? []).filter((device) => {
      if (!device.online) return false;
      if (!normalized) return true;
      return [
        device.deviceCode,
        device.deviceName,
        device.user?.name,
        device.user?.email,
        device.liveState?.screenLabel,
        device.liveState?.clientName,
        device.liveState?.requestNumber,
        device.liveState?.orderId,
        device.liveState?.productName,
        device.liveState?.boxCode,
        ...device.workloads.flatMap((workload) => [
          workload.request.number,
          workload.request.client.name,
          workload.orderId,
          workload.productName,
          workload.sourceBoxCode,
        ]),
      ].some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(normalized));
    }).sort((left, right) => left.deviceCode.localeCompare(
      right.deviceCode,
      'ru-RU',
      { numeric: true, sensitivity: 'base' },
    ));
  }, [data, query]);

  const history = useMemo<HistoryEntry[]>(() => {
    const result: HistoryEntry[] = [];
    const seen = new Set<string>();
    for (const device of data?.devices ?? []) {
      const errorIds = new Set(device.errors.map((item) => item.id));
      for (const item of device.activity) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        const isError = errorIds.has(item.id)
          || item.type === 'monitor_error'
          || ['REJECTED', 'NEEDS_REVIEW'].includes(item.status);
        result.push({
          id: item.id,
          tone: isError ? 'error' : 'success',
          title: activityLabel(item),
          details: compactStrings([
            item.screen,
            item.requestNumber ? `Заявка №${String(item.requestNumber).padStart(6, '0')}` : null,
            item.orderId ? `Заказ ${item.orderId}` : null,
            item.clientName,
            item.boxCode ? `Короб ${item.boxCode}` : null,
            item.barcode ? `ШК ${item.barcode}` : null,
          ]),
          deviceCode: device.deviceCode,
          deviceName: device.deviceName || device.deviceCode,
          workerName: item.workerName || device.user?.name || 'Сотрудник не определён',
          createdAt: item.createdAt,
        });
      }
      for (const item of device.errors) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        result.push({
          id: item.id,
          tone: 'error',
          title: item.message,
          details: compactStrings([
            item.screen,
            item.requestNumber ? `Заявка №${String(item.requestNumber).padStart(6, '0')}` : null,
            item.orderId ? `Заказ ${item.orderId}` : null,
            item.clientName,
          ]),
          deviceCode: device.deviceCode,
          deviceName: device.deviceName || device.deviceCode,
          workerName: item.workerName || device.user?.name || 'Сотрудник не определён',
          createdAt: item.createdAt,
        });
      }
    }
    return result.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [data]);

  const visibleHistory = useMemo(
    () => historyFilter === 'all' ? history : history.filter((item) => item.tone === historyFilter),
    [history, historyFilter],
  );
  const errorDevice = useMemo(
    () => (data?.devices ?? []).find((device) => device.deviceCode === errorDeviceCode) ?? null,
    [data, errorDeviceCode],
  );

  useEffect(() => {
    if (!historyOpen && !errorDeviceCode) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHistoryOpen(false);
        setErrorDeviceCode('');
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [historyOpen, errorDeviceCode]);

  const sendCommand = async (device: Device, action: MonitorAction) => {
    const title = action === 'LOGOUT'
      ? 'выйти из аккаунта'
      : action === 'UPDATE_APP'
        ? 'тихо обновить приложение ТСД'
        : action === 'UNLOCK_INVENTORY'
          ? 'разблокировать инвентаризацию'
        : 'перезагрузить текущую заявку';
    if (!window.confirm(`Отправить на ${device.deviceName || device.deviceCode} команду «${title}»?`)) return;
    setCommandDevice(device.deviceCode);
    try {
      const result = await sendTsdMonitorAction(session.accessToken, device.deviceCode, action);
      setNotice(result.message);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось отправить команду на ТСД.');
    } finally {
      setCommandDevice('');
    }
  };

  const disconnectCurrentTask = async (device: Device) => {
    const current = device.workloads[0];
    const requestId = device.liveState?.requestId || current?.request.id;
    const requestNumber = device.liveState?.requestNumber || current?.request.number;
    if (!window.confirm(
      `Снять ВСЕ задания с ${device.deviceName || device.deviceCode}` +
      `${requestNumber ? ` по заявке №${String(requestNumber).padStart(6, '0')}` : ''}?\n\n` +
      'Будут сняты сборка FBS, заявка, инвентаризация и все остальные активные задания. Незавершённые заказы вернутся в общую очередь.',
    )) return;
    setCommandDevice(device.deviceCode);
    setNotice('');
    setError('');
    try {
      const result = await disconnectAdministrationTsdRequest(session.accessToken, {
        requestId,
        deviceCode: device.deviceCode,
      });
      setNotice(result.message);
      setData(await fetchTsdMonitoring(session.accessToken));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось снять текущее задание с ТСД.');
    } finally {
      setCommandDevice('');
    }
  };

  if (loading && !data) {
    return (
      <section className="tsd-monitor tsd-monitor--loading">
        <RefreshCw className="spin" size={28} />
        <strong>Подключаю диспетчерскую ТСД…</strong>
      </section>
    );
  }

  return (
    <section className="tsd-monitor">
      <header className="tsd-monitor__header">
        <div>
          <h2>Мониторинг ТСД</h2>
          <p>Живое состояние устройств, ход заявок и ошибки сканирования. Экран обновляется каждые 3 секунды.</p>
        </div>
        <div className="tsd-monitor__header-actions">
          <button type="button" className="tsd-monitor__history-button" onClick={() => setHistoryOpen(true)}>
            <History size={16} />
            История действий
            <span>{history.length}</span>
          </button>
          <div className="tsd-monitor__clock">
            <span className="tsd-monitor__live-dot" aria-hidden="true" />
            Онлайн
            <time>{data ? timeOnly(data.checkedAt) : '—'}</time>
          </div>
        </div>
      </header>

      {data ? (
        <div className="tsd-monitor__summary">
          <Summary label="В сети" value={data.summary.onlineDevices} icon={Wifi} tone="online" />
          <Summary label="В работе" value={data.summary.busyDevices} icon={Activity} />
          <Summary label="Активных задач" value={data.summary.tasks} icon={ScanLine} />
          <Summary label="Ошибок за 24 часа" value={data.summary.errors24h} icon={AlertTriangle} tone={data.summary.errors24h ? 'danger' : 'online'} />
        </div>
      ) : null}

      <div className="tsd-monitor__toolbar">
        <label className="tsd-monitor__search">
          <Search size={18} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти ТСД, сотрудника, заявку, заказ или короб" />
        </label>
      </div>

      {error ? <div className="tsd-monitor__error"><AlertTriangle size={18} />{error}</div> : null}
      {notice ? <div className="tsd-monitor__notice"><CheckCircle2 size={18} />{notice}</div> : null}

      <div className="tsd-monitor__wall">
        {devices.map((device) => (
          <DeviceFeed
            key={device.deviceCode}
            device={device}
            commandBusy={commandDevice === device.deviceCode}
            latestVersion={latestTsdVersion}
            onCommand={sendCommand}
            onDisconnectTask={disconnectCurrentTask}
            onOpenErrors={() => setErrorDeviceCode(device.deviceCode)}
          />
        ))}
      </div>

      {devices.length === 0 ? (
        <div className="tsd-monitor__empty">
          <Tablet size={30} />
          <strong>Активных ТСД сейчас нет</strong>
          <span>В мониторинге появятся только устройства, которые сейчас находятся в сети.</span>
        </div>
      ) : null}

      {data ? <PickerStatistics statistics={data.pickerStatistics} /> : null}

      {historyOpen ? (
        <div className="tsd-history-modal" role="presentation" onMouseDown={() => setHistoryOpen(false)}>
          <section
            className="tsd-history-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tsd-history-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="tsd-history-modal__header">
              <div>
                <h3 id="tsd-history-title">История действий ТСД</h3>
                <p>Успешные операции и ошибки всех устройств за последние 24 часа.</p>
              </div>
              <button type="button" aria-label="Закрыть историю" onClick={() => setHistoryOpen(false)} autoFocus>
                <X size={18} />
              </button>
            </header>
            <div className="tsd-history-modal__filters" aria-label="Фильтр истории">
              <HistoryFilterButton active={historyFilter === 'all'} onClick={() => setHistoryFilter('all')} label="Все" count={history.length} />
              <HistoryFilterButton active={historyFilter === 'success'} onClick={() => setHistoryFilter('success')} label="Успешные" count={history.filter((item) => item.tone === 'success').length} tone="success" />
              <HistoryFilterButton active={historyFilter === 'error'} onClick={() => setHistoryFilter('error')} label="Ошибки" count={history.filter((item) => item.tone === 'error').length} tone="error" />
            </div>
            <div className="tsd-history-modal__list">
              {visibleHistory.length ? visibleHistory.map((item) => (
                <article className={`tsd-history-row is-${item.tone}`} key={item.id}>
                  <span className="tsd-history-row__icon">
                    {item.tone === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                  </span>
                  <div className="tsd-history-row__content">
                    <strong>{item.title}</strong>
                    {item.details.length ? <p>{item.details.join(' · ')}</p> : null}
                    <span>{item.deviceName} · {item.workerName}</span>
                  </div>
                  <time dateTime={item.createdAt}>{dateTimeShort(item.createdAt)}</time>
                </article>
              )) : (
                <div className="tsd-history-modal__empty">
                  <CheckCircle2 size={26} />
                  <strong>Событий этого типа нет</strong>
                  <span>Выберите другой фильтр истории.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {errorDevice ? (
        <div className="tsd-history-modal" role="presentation" onMouseDown={() => setErrorDeviceCode('')}>
          <section
            className="tsd-history-modal__dialog tsd-history-modal__dialog--device-errors"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tsd-device-errors-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="tsd-history-modal__header">
              <div>
                <h3 id="tsd-device-errors-title">Ошибки · {errorDevice.deviceName || errorDevice.deviceCode}</h3>
                <p>{errorDevice.deviceCode} · последние 20 ошибок за 24 часа</p>
              </div>
              <button type="button" aria-label="Закрыть ошибки ТСД" onClick={() => setErrorDeviceCode('')} autoFocus>
                <X size={18} />
              </button>
            </header>
            <div className="tsd-history-modal__list">
              {errorDevice.errors.slice(0, 20).length ? errorDevice.errors.slice(0, 20).map((item) => (
                <article className="tsd-history-row is-error" key={item.id}>
                  <span className="tsd-history-row__icon"><AlertTriangle size={16} /></span>
                  <div className="tsd-history-row__content">
                    <strong>{item.message}</strong>
                    {compactStrings([
                      item.screen,
                      item.requestNumber ? `Заявка №${String(item.requestNumber).padStart(6, '0')}` : null,
                      item.orderId ? `Заказ ${item.orderId}` : null,
                      item.clientName,
                    ]).length ? (
                      <p>{compactStrings([
                        item.screen,
                        item.requestNumber ? `Заявка №${String(item.requestNumber).padStart(6, '0')}` : null,
                        item.orderId ? `Заказ ${item.orderId}` : null,
                        item.clientName,
                      ]).join(' · ')}</p>
                    ) : null}
                    <span>{item.workerName || errorDevice.user?.name || 'Сотрудник не определён'}</span>
                  </div>
                  <time dateTime={item.createdAt}>{dateTimeShort(item.createdAt)}</time>
                </article>
              )) : (
                <div className="tsd-history-modal__empty">
                  <CheckCircle2 size={26} />
                  <strong>Ошибок нет</strong>
                  <span>За последние 24 часа этот ТСД работал без зарегистрированных ошибок.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function PickerStatistics({ statistics }: { statistics: TsdMonitoring['pickerStatistics'] }) {
  return (
    <section className="tsd-picker-statistics">
      <header className="tsd-picker-statistics__header">
        <div>
          <span>Производительность сборки</span>
          <h3>Статистика по сборщикам</h3>
          <p>{statistics.period.label}. Учитываются завершённые FBS-заказы и фактически отпиканные единицы.</p>
        </div>
        <div className="tsd-picker-statistics__totals">
          <span><UserRound size={15} /><b>{statistics.summary.workers}</b> сборщиков</span>
          <span><PackageCheck size={15} /><b>{statistics.summary.orders}</b> заказов</span>
          <span><ScanLine size={15} /><b>{statistics.summary.units}</b> ед.</span>
        </div>
      </header>

      {statistics.workers.length ? (
        <div className="tsd-picker-statistics__grid">
          {statistics.workers.map((worker) => <PickerWorkerCard key={worker.workerId ?? worker.workerName} worker={worker} />)}
        </div>
      ) : (
        <div className="tsd-picker-statistics__empty">
          <Clock3 size={22} />
          <strong>За последние 24 часа завершённых заказов нет</strong>
          <span>Статистика появится после завершения первого FBS-заказа на ТСД.</span>
        </div>
      )}
    </section>
  );
}

function PickerWorkerCard({ worker }: { worker: PickerWorker }) {
  return (
    <article className="tsd-picker-card">
      <header>
        <span className="tsd-picker-card__avatar"><UserRound size={18} /></span>
        <div>
          <strong>{worker.workerName}</strong>
          <small>{worker.deviceCodes.length ? worker.deviceCodes.join(' · ') : 'ТСД не определён'}</small>
        </div>
      </header>
      <div className="tsd-picker-card__metrics">
        <span><small>Заказов</small><b>{worker.orders}</b></span>
        <span><small>Отпикано</small><b>{worker.units} ед.</b></span>
        <span><small>Среднее время</small><b>{formatDuration(worker.averageDurationSeconds)}</b></span>
        <span><small>Всего времени</small><b>{formatDuration(worker.measuredOrders ? worker.totalDurationSeconds : null)}</b></span>
      </div>
      <details className="tsd-picker-card__orders">
        <summary>Время по каждому заказу <ChevronDown size={15} /></summary>
        <div className="tsd-picker-card__order-list">
          {worker.orderDetails.map((order) => (
            <div key={order.taskId} className="tsd-picker-order">
              <div>
                <strong>Заказ {order.orderId}</strong>
                <span>Заявка №{String(order.requestNumber).padStart(6, '0')} · {order.clientName}</span>
                <small>{order.productName}{order.article ? ` · ${order.article}` : ''} · {order.units} ед.</small>
              </div>
              <div>
                <b>{formatDuration(order.durationSeconds)}</b>
                <time dateTime={order.completedAt}>{dateTimeShort(order.completedAt)}</time>
              </div>
            </div>
          ))}
        </div>
        {worker.measuredOrders < worker.orders ? (
          <p className="tsd-picker-card__measurement-note">
            Для {worker.orders - worker.measuredOrders} старых заказов время начала ещё не записывалось; новые сборки измеряются точно.
          </p>
        ) : null}
      </details>
    </article>
  );
}

function DeviceFeed({
  device,
  commandBusy,
  latestVersion,
  onCommand,
  onDisconnectTask,
  onOpenErrors,
}: {
  device: Device;
  commandBusy: boolean;
  latestVersion: string;
  onCommand: (device: Device, action: MonitorAction) => void;
  onDisconnectTask: (device: Device) => void;
  onOpenErrors: () => void;
}) {
  const current = device.workloads[0] ?? null;
  const state = device.liveState;
  const inventoryLocked = Boolean(
    state?.inventorySessionId
    || state?.screen?.startsWith('INVENTORY_')
    || state?.screenLabel?.toLocaleLowerCase('ru-RU').includes('инвентар'),
  );
  const progress = device.progress ?? heartbeatProgress(device);
  const requestNumber = state?.requestNumber ?? current?.request.number ?? null;
  const operator = device.user?.name || current?.workerName || 'Сотрудник не определён';
  const screenLabel = state?.screenLabel || current?.stageLabel || (device.online ? 'Главное меню' : 'Экран недоступен');
  const progressPercent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
    : 0;
  const installedVersion = state?.appVersion?.trim() ?? '';
  const isUpdated = Boolean(
    latestVersion
    && installedVersion
    && compareVersions(installedVersion, latestVersion) >= 0,
  );

  return (
    <article className={`tsd-feed ${device.online ? 'is-online' : 'is-offline'}${device.errors.length ? ' has-errors' : ''}`}>
      <header className="tsd-feed__topbar">
        <div className="tsd-feed__device">
          <span className="tsd-feed__camera-mark"><Tablet size={18} /></span>
          <div>
            <strong>{device.deviceName || device.deviceCode}</strong>
            <span>{device.deviceName ? device.deviceCode : 'Зарегистрированное устройство'}</span>
          </div>
        </div>
        <span className={`tsd-feed__connection ${device.online ? 'is-online' : ''}`}>
          {device.online ? <Wifi size={14} /> : <WifiOff size={14} />}
          {device.online ? 'В сети' : 'Нет связи'}
        </span>
      </header>

      <div className="tsd-feed__screen">
        <div className="tsd-feed__screen-head">
          <span>{screenLabel}</span>
          <time>{device.lastSeenAt ? relativeTime(device.lastSeenAt) : 'не подключался'}</time>
        </div>
        <div className="tsd-feed__operator">
          <UserRound size={18} />
          <div><span>Сейчас работает</span><strong>{operator}</strong></div>
        </div>

        {requestNumber ? (
          <div className="tsd-feed__request">
            <div>
              <span>Заявка</span>
              <strong>№{String(requestNumber).padStart(6, '0')}</strong>
              <small>{state?.clientName || current?.request.client.name || 'Клиент не определён'}</small>
            </div>
            {state?.orderId || current?.orderId ? (
              <div><span>Заказ</span><strong>{state?.orderId || current?.orderId}</strong></div>
            ) : null}
          </div>
        ) : (
          <div className="tsd-feed__idle"><CheckCircle2 size={19} /> На устройстве нет открытой заявки</div>
        )}

        {progress ? (
          <div className="tsd-feed__progress">
            <div><span>Выполнено</span><strong>{progress.completed} из {progress.total}</strong></div>
            <div className="tsd-feed__progress-track"><i style={{ transform: `scaleX(${progressPercent / 100})` }} /></div>
            <div className="tsd-feed__progress-notes">
              <span><PackageCheck size={14} /> Принято: {progress.completed}</span>
              <span><Box size={14} /> Осталось: {progress.remaining}</span>
              <b>{progressPercent}%</b>
            </div>
          </div>
        ) : null}

        {(state?.productName || current?.productName || state?.boxCode || current?.sourceBoxCode) ? (
          <div className="tsd-feed__current-item">
            <span>Текущее действие</span>
            <strong>{state?.productName || current?.productName || state?.lastAction || 'Сканирование'}</strong>
            {(state?.boxCode || current?.sourceBoxCode) ? <small>Короб: {state?.boxCode || current?.sourceBoxCode}</small> : null}
          </div>
        ) : null}

        <div className="tsd-feed__last-action">
          <Clock3 size={15} />
          <span>{state?.lastAction || activityLabel(device.activity[0]) || 'Ожидает действие сотрудника'}</span>
        </div>
      </div>

      <div className="tsd-feed__footer">
        <button
          type="button"
          className={`tsd-feed__errors-button${device.errors.length ? ' has-errors' : ''}`}
          onClick={onOpenErrors}
          aria-label={`Открыть ошибки ТСД ${device.deviceName || device.deviceCode}: ${device.errors.length}`}
        >
          {device.errors.length ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
          Ошибки
          <strong>{Math.min(20, device.errors.length)}</strong>
        </button>
        <span>Версия {state?.appVersion || 'не определена'}</span>
      </div>

      <div className="tsd-feed__controls">
        <button
          type="button"
          className={`is-unlock${inventoryLocked ? ' is-active' : ''}`}
          disabled={!device.online || commandBusy}
          onClick={() => onCommand(device, 'UNLOCK_INVENTORY')}
        >
          <LockOpen size={15} />
          Завершить инвентаризацию
        </button>
        <button
          type="button"
          className="is-release-task is-active"
          disabled={!device.online || commandBusy}
          onClick={() => onDisconnectTask(device)}
        >
          <XCircle size={15} />
          Снять все задания
        </button>
        <button
          type="button"
          className={`is-update${isUpdated ? ' is-updated' : ''}`}
          disabled={isUpdated || !device.online || commandBusy}
          onClick={() => onCommand(device, 'UPDATE_APP')}
          aria-label={isUpdated
            ? `ТСД обновлён до версии ${installedVersion}`
            : `Тихо обновить ТСД до версии ${latestVersion || 'актуальной'}`}
        >
          {isUpdated
            ? <CheckCircle2 size={15} />
            : <Download size={15} className={commandBusy ? 'is-spinning' : ''} />}
          {isUpdated ? 'Обновлён' : 'Тихое обновление'}
        </button>
        <button type="button" disabled={!device.online || commandBusy} onClick={() => onCommand(device, 'RELOAD_REQUEST')}>
          <RefreshCw size={15} className={commandBusy ? 'is-spinning' : ''} />
          Перезагрузить заявку
        </button>
        <button type="button" className="is-danger" disabled={!device.online || commandBusy} onClick={() => onCommand(device, 'LOGOUT')}>
          <LogOut size={15} />
          Выйти из аккаунта
        </button>
      </div>

    </article>
  );
}

function compareVersions(leftValue: string, rightValue: string) {
  const left = (leftValue.match(/\d+/g) ?? []).map(Number);
  const right = (rightValue.match(/\d+/g) ?? []).map(Number);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function HistoryFilterButton({
  active,
  onClick,
  label,
  count,
  tone = 'all',
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: 'all' | 'success' | 'error';
}) {
  return (
    <button type="button" className={`${active ? 'is-active ' : ''}is-${tone}`} onClick={onClick}>
      {label}<span>{count}</span>
    </button>
  );
}

function Summary({ label, value, icon: Icon, tone = '' }: { label: string; value: number; icon: typeof Wifi; tone?: '' | 'online' | 'danger' }) {
  return <div className={tone ? `is-${tone}` : ''}><Icon size={18} /><span>{label}</span><strong>{value}</strong></div>;
}

function heartbeatProgress(device: Device) {
  const state = device.liveState;
  const total = Number(state?.total ?? 0);
  const completed = Number(state?.completed ?? state?.accepted ?? 0);
  const remaining = Number(state?.remaining ?? Math.max(0, total - completed));
  return total > 0 ? { total, completed, remaining } : null;
}

function activityLabel(item: Device['activity'][number] | undefined) {
  if (!item) return '';
  const labels: Record<string, string> = {
    receipt_scan: 'Товар принят',
    assembly_stage: item.stage || 'Этап сборки изменён',
    box_search_scan: item.boxCode ? `Проверен короб ${item.boxCode}` : 'Проверен короб',
    move_scan: item.boxCode ? `Перемещение: ${item.boxCode}` : 'Выполнено перемещение',
    monitor_error: item.message || 'Ошибка на ТСД',
  };
  return labels[item.type] || item.message || item.stage || item.type.replaceAll('_', ' ');
}

function timeOnly(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return 'только что';
  if (seconds < 60) return `${seconds} сек назад`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.floor(minutes / 60)} ч назад`;
}

function dateTimeShort(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(value: number | null) {
  if (value === null) return 'нет замера';
  const seconds = Math.max(0, Math.round(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин ${rest} сек`;
  return `${rest} сек`;
}

function compactStrings(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}
