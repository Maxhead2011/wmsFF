import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Tablet,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  disconnectAdministrationTsdRequest,
  fetchAdministrationTsdWorkloads,
  releaseAdministrationTsdWorkload,
  type AdministrationTsdWorkloads,
  type AuthSession,
} from '../../lib/api';

type Props = { session: AuthSession };
type Workload = AdministrationTsdWorkloads['devices'][number]['workloads'][number];

export function AdministrationTsdWorkloadsPanel({ session }: Props) {
  const [data, setData] = useState<AdministrationTsdWorkloads | null>(null);
  const [query, setQuery] = useState('');
  const [showIdle, setShowIdle] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setBusyKey('load');
    setError('');
    try {
      setData(await fetchAdministrationTsdWorkloads(session.accessToken));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusyKey('');
    }
  }

  async function release(deviceCode: string, workload: Workload) {
    if (workload.protected) return;
    const label = workload.orderId ? `заказ ${workload.orderId}` : `задачу по заявке №${formatRequest(workload.request.number)}`;
    if (!window.confirm(`Освободить ${label} на ТСД ${deviceCode}? Незащищённые сканы этой задачи будут сброшены.`)) return;
    const key = `release:${workload.id}`;
    setBusyKey(key);
    setMessage('');
    setError('');
    try {
      const result = await releaseAdministrationTsdWorkload(session.accessToken, {
        kind: workload.kind,
        workloadId: workload.id,
        requestId: workload.request.id,
        deviceCode,
      });
      setMessage(result.message);
      setData(await fetchAdministrationTsdWorkloads(session.accessToken));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusyKey('');
    }
  }

  async function disconnect(deviceCode: string, request: Workload['request']) {
    if (!window.confirm(`Отключить ТСД ${deviceCode} от заявки №${formatRequest(request.number)}? Все незавершённые и незащищённые задачи этой заявки вернутся в общую очередь.`)) return;
    const key = `disconnect:${deviceCode}:${request.id}`;
    setBusyKey(key);
    setMessage('');
    setError('');
    try {
      const result = await disconnectAdministrationTsdRequest(session.accessToken, {
        requestId: request.id,
        deviceCode,
      });
      setMessage(result.message);
      setData(await fetchAdministrationTsdWorkloads(session.accessToken));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusyKey('');
    }
  }

  const filteredDevices = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().toLocaleLowerCase('ru-RU');
    return data.devices
      .filter((device) => showIdle || device.workloads.length > 0)
      .map((device) => ({
        ...device,
        workloads: normalized
          ? device.workloads.filter((workload) =>
              [
                device.deviceCode,
                device.deviceName,
                device.user?.name,
                device.user?.email,
                workload.workerName,
                workload.request.number,
                workload.request.title,
                workload.request.client.code,
                workload.request.client.name,
                workload.orderId,
                workload.productName,
                workload.article,
                workload.sourceBoxCode,
              ].some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(normalized)),
            )
          : device.workloads,
      }))
      .filter((device) => !normalized || device.workloads.length > 0 || [device.deviceCode, device.deviceName, device.user?.name]
        .some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(normalized)));
  }, [data, query, showIdle]);

  if (!data && busyKey === 'load') {
    return <div className="admin-loading"><LoaderCircle className="spin" size={26} /><strong>Проверяю занятость ТСД…</strong></div>;
  }

  return (
    <section className="admin-section admin-tsd">
      <header className="admin-section__heading">
        <div>
          <span>Диспетчер задач</span>
          <h3>Занятые ТСД</h3>
          <p>Какая заявка открыта на каждом устройстве и какие заказы удерживает сотрудник.</p>
        </div>
        <button type="button" className="admin-button admin-button--ghost" disabled={Boolean(busyKey)} onClick={() => void load()}>
          <RefreshCw className={busyKey === 'load' ? 'spin' : ''} size={16} /> Обновить
        </button>
      </header>

      {data ? (
        <div className="admin-tsd__metrics" aria-label="Сводка по ТСД">
          <Metric label="Зарегистрировано" value={data.summary.registeredDevices} />
          <Metric label="Сейчас в сети" value={data.summary.onlineDevices} tone="good" />
          <Metric label="Занято устройств" value={data.summary.busyDevices} tone={data.summary.busyDevices ? 'warn' : 'good'} />
          <Metric label="Активных задач" value={data.summary.tasks} />
          <Metric label="Защищённых задач" value={data.summary.protectedTasks} tone={data.summary.protectedTasks ? 'danger' : 'good'} />
        </div>
      ) : null}

      <div className="admin-tsd__toolbar">
        <label className="admin-tsd__search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ТСД, сотрудник, заявка, заказ или товар" />
        </label>
        <label className="admin-tsd__toggle">
          <input type="checkbox" checked={showIdle} onChange={(event) => setShowIdle(event.target.checked)} />
          Показывать свободные ТСД
        </label>
      </div>

      {message ? <div className="admin-message admin-message--ok"><CheckCircle2 size={18} />{message}</div> : null}
      {error ? <div className="admin-message admin-message--error"><AlertTriangle size={18} />{error}</div> : null}

      <div className="admin-tsd__devices">
        {filteredDevices.map((device) => {
          const requests = uniqueRequests(device.workloads);
          return (
            <article className="admin-tsd-device" key={device.deviceCode}>
              <header>
                <div className="admin-tsd-device__identity">
                  <span className={`admin-tsd-device__icon ${device.online ? 'is-online' : ''}`}><Tablet size={20} /></span>
                  <div>
                    <strong>{device.deviceName || device.deviceCode}</strong>
                    <small>{device.deviceName ? device.deviceCode : 'Название устройства не задано'}</small>
                  </div>
                </div>
                <div className="admin-tsd-device__meta">
                  <span className={device.online ? 'is-online' : ''}>{device.online ? 'В сети' : 'Не в сети'}</span>
                  <span><UserRound size={14} /> {device.user?.name || device.workloads[0]?.workerName || 'Сотрудник не определён'}</span>
                  <span><Clock3 size={14} /> {device.lastSeenAt ? relativeTime(device.lastSeenAt) : 'не подключался'}</span>
                </div>
              </header>

              {requests.length > 0 ? (
                <div className="admin-tsd-device__request-actions">
                  {requests.map((request) => {
                    const key = `disconnect:${device.deviceCode}:${request.id}`;
                    const requestRows = device.workloads.filter((item) => item.request.id === request.id);
                    const blocked = requestRows.some((item) => item.protected);
                    return (
                      <div key={request.id}>
                        <span>Заявка №{formatRequest(request.number)} · {request.client.name}</span>
                        <button
                          type="button"
                          className="admin-button admin-button--danger-ghost"
                          disabled={Boolean(busyKey) || blocked}
                          title={blocked ? 'В заявке есть защищённая задача. Освободите её штатным действием по КИЗ.' : undefined}
                          onClick={() => void disconnect(device.deviceCode, request)}
                        >
                          {busyKey === key ? <LoaderCircle className="spin" size={15} /> : <LogOut size={15} />}
                          Отключить от заявки
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {device.workloads.length > 0 ? (
                <div className="admin-tsd-table-wrap">
                  <table className="admin-tsd-table">
                    <thead><tr><th>Заявка / заказ</th><th>Текущая задача</th><th>Сотрудник</th><th>Активность</th><th>Действие</th></tr></thead>
                    <tbody>
                      {device.workloads.map((workload) => {
                        const key = `release:${workload.id}`;
                        return (
                          <tr key={`${workload.kind}:${workload.id}`}>
                            <td>
                              <strong>№{formatRequest(workload.request.number)}</strong>
                              <span>{workload.orderId ? `Заказ ${workload.orderId}` : workload.request.title}</span>
                              <small>{workload.request.client.code} · {workload.request.client.name}</small>
                            </td>
                            <td>
                              <strong>{workload.stageLabel}</strong>
                              {workload.productName ? <span>{workload.productName}{workload.article ? ` · ${workload.article}` : ''}</span> : null}
                              {workload.sourceBoxCode ? <small>Короб: {workload.sourceBoxCode}</small> : null}
                              {workload.protected ? <small className="is-protected"><ShieldCheck size={13} /> Защищено от сброса</small> : null}
                            </td>
                            <td><span>{workload.workerName || device.user?.name || '—'}</span></td>
                            <td><span>{relativeTime(workload.updatedAt)}</span><small>{dateTime(workload.updatedAt)}</small></td>
                            <td>
                              <button
                                type="button"
                                className="admin-button admin-button--compact"
                                disabled={Boolean(busyKey) || workload.protected}
                                title={workload.protectedReason || undefined}
                                onClick={() => void release(device.deviceCode, workload)}
                              >
                                {busyKey === key ? <LoaderCircle className="spin" size={15} /> : <LogOut size={15} />}
                                Освободить задачу
                              </button>
                              {workload.protectedReason ? <small className="admin-tsd-table__reason">{workload.protectedReason}</small> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <div className="admin-tsd-device__empty"><CheckCircle2 size={18} /> Устройство свободно</div>}
            </article>
          );
        })}
        {filteredDevices.length === 0 ? (
          <div className="admin-tsd__empty"><CheckCircle2 size={24} /><strong>Занятых ТСД нет</strong><span>Все заявки доступны для работы.</span></div>
        ) : null}
      </div>
      {data ? <small className="admin-tsd__checked">Проверено: {dateTime(data.checkedAt)}</small> : null}
    </section>
  );
}

function Metric({ label, value, tone = '' }: { label: string; value: number; tone?: '' | 'good' | 'warn' | 'danger' }) {
  return <div className={tone ? `is-${tone}` : ''}><span>{label}</span><strong>{value}</strong></div>;
}

function uniqueRequests(workloads: Workload[]) {
  return [...new Map(workloads.map((workload) => [workload.request.id, workload.request])).values()];
}

function formatRequest(number: number) {
  return String(number).padStart(6, '0');
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'время неизвестно';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}

function errorText(value: unknown) {
  return value instanceof Error ? value.message : 'Не удалось выполнить действие.';
}
