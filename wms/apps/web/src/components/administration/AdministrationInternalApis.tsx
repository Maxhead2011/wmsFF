import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleGauge,
  Clock3,
  Database,
  LoaderCircle,
  MemoryStick,
  RefreshCw,
  RotateCcw,
  Route,
  Search,
  ServerCog,
  ShieldAlert,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAdministrationInternalApis,
  restartAdministrationInternalApi,
  type AdministrationInternalApiOverview,
  type AuthSession,
} from '../../lib/api';

type Props = { session: AuthSession };
type StatusFilter = 'ALL' | 'PROBLEMS';

export function AdministrationInternalApis({ session }: Props) {
  const [overview, setOverview] = useState<AdministrationInternalApiOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setOverview(await fetchAdministrationInternalApis(session.accessToken));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, [session.accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const modules = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
    return [...(overview?.modules ?? [])]
      .filter((module) => statusFilter === 'ALL' || module.status === 'DEGRADED')
      .filter((module) => !normalizedQuery || [
        module.name,
        module.description,
        ...module.prefixes,
        ...module.logic,
        ...module.dependencies,
      ].join(' ').toLocaleLowerCase('ru-RU').includes(normalizedQuery))
      .sort((left, right) => {
        if (left.status !== right.status) return left.status === 'DEGRADED' ? -1 : 1;
        return left.name.localeCompare(right.name, 'ru');
      });
  }, [overview?.modules, query, statusFilter]);

  async function submitRestart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!overview || restarting) return;

    setRestarting(true);
    setError('');
    setMessage('');
    const previousStartedAt = overview.runtime.startedAt;
    try {
      const accepted = await restartAdministrationInternalApi(session.accessToken, confirmation);
      setRestartOpen(false);
      setConfirmation('');
      setMessage(`${accepted.message} Ожидаю восстановления соединения…`);
      const recovered = await waitForApiRecovery(session.accessToken, previousStartedAt);
      setOverview(recovered);
      setMessage(`API перезапущен и снова отвечает. Новый процесс работает с ${formatDateTime(recovered.runtime.startedAt)}.`);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setRestarting(false);
    }
  }

  if (loading && !overview) {
    return <div className="admin-loading"><LoaderCircle className="admin-spin" size={20} /> Проверяю внутренние API…</div>;
  }

  return (
    <section className="admin-internal-api">
      {error ? <div className="admin-message admin-message--error"><AlertTriangle size={18} />{error}</div> : null}
      {message ? <div className="admin-message admin-message--ok"><CheckCircle2 size={18} />{message}</div> : null}

      {overview ? (
        <>
          <div className={overview.summary.degraded ? 'admin-internal-api__status is-degraded' : 'admin-internal-api__status'}>
            <div className="admin-internal-api__status-copy">
              <span className="admin-internal-api__status-icon">
                {overview.summary.degraded ? <AlertTriangle size={23} /> : <CircleGauge size={23} />}
              </span>
              <div>
                <strong>{overview.summary.degraded ? 'Есть модули с ограниченной работой' : 'Внутренний API работает штатно'}</strong>
                <p>{overview.scopeNote}</p>
              </div>
            </div>
            <dl className="admin-internal-api__runtime">
              <div>
                <dt><ServerCog size={14} /> Модули</dt>
                <dd>{overview.summary.working}/{overview.summary.modules}</dd>
              </div>
              <div>
                <dt><Route size={14} /> Маршруты</dt>
                <dd>{overview.summary.routes}</dd>
              </div>
              <div>
                <dt><Database size={14} /> Основная БД</dt>
                <dd className={overview.dependencies.database.status === 'WORKING' ? 'is-ok' : 'is-error'}>
                  {overview.dependencies.database.status === 'WORKING' ? `${overview.dependencies.database.latencyMs} мс` : 'Ошибка'}
                </dd>
              </div>
              <div>
                <dt><Clock3 size={14} /> Работает</dt>
                <dd>{formatUptime(overview.runtime.uptimeSeconds)}</dd>
              </div>
              <div>
                <dt><MemoryStick size={14} /> Память</dt>
                <dd>{overview.runtime.memoryMb} МБ</dd>
              </div>
            </dl>
          </div>

          <div className="admin-internal-api__toolbar">
            <label className="admin-internal-api__search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Название, маршрут, зависимость…"
                aria-label="Поиск внутреннего API"
              />
            </label>
            <div className="admin-internal-api__filters" aria-label="Фильтр состояния">
              <button type="button" className={statusFilter === 'ALL' ? 'active' : ''} onClick={() => setStatusFilter('ALL')}>
                Все {overview.summary.modules}
              </button>
              <button type="button" className={statusFilter === 'PROBLEMS' ? 'active is-danger' : ''} onClick={() => setStatusFilter('PROBLEMS')}>
                Проблемы {overview.summary.degraded}
              </button>
            </div>
            <button type="button" className="admin-button admin-button--ghost" disabled={loading || restarting} onClick={() => void load()}>
              <RefreshCw size={16} className={loading ? 'admin-spin' : ''} /> Проверить сейчас
            </button>
          </div>

          <div className="admin-internal-api__restart">
            <div>
              <ShieldAlert size={19} />
              <span>
                <strong>Перезапуск всего API</strong>
                <small>На 2–20 секунд могут прерваться веб и ТСД-запросы. Данные склада при этом не удаляются.</small>
              </span>
            </div>
            <button
              type="button"
              className="admin-button admin-button--danger-ghost"
              disabled={!overview.restart.canRestart || restarting}
              title={overview.restart.disabledReason ?? undefined}
              onClick={() => {
                setRestartOpen((current) => !current);
                setConfirmation('');
                setError('');
              }}
            >
              <RotateCcw size={16} className={restarting ? 'admin-spin' : ''} />
              {restarting ? 'Перезапускаю…' : 'Перезапустить API'}
            </button>
          </div>
          {!overview.restart.canRestart && overview.restart.disabledReason ? (
            <p className="admin-internal-api__restart-note">{overview.restart.disabledReason}</p>
          ) : null}

          {restartOpen ? (
            <form className="admin-internal-api__confirm" onSubmit={(event) => void submitRestart(event)}>
              <div>
                <strong>Подтвердите остановку текущего API-процесса</strong>
                <p>Введите без изменений: <code>{overview.restart.confirmation}</code></p>
              </div>
              <input
                autoFocus
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={overview.restart.confirmation}
                disabled={restarting}
                aria-label="Фраза подтверждения перезапуска API"
              />
              <div>
                <button type="button" className="admin-button admin-button--ghost" disabled={restarting} onClick={() => setRestartOpen(false)}>
                  Отмена
                </button>
                <button
                  type="submit"
                  className="admin-button admin-button--danger"
                  disabled={restarting || confirmation !== overview.restart.confirmation}
                >
                  {restarting ? <LoaderCircle size={16} className="admin-spin" /> : <RotateCcw size={16} />}
                  Подтвердить перезапуск
                </button>
              </div>
            </form>
          ) : null}

          <div className="admin-internal-api__list-head">
            <div>
              <strong>Внутренние группы маршрутов</strong>
              <span>Проблемные всегда показаны первыми</span>
            </div>
            <small>Проверено {formatDateTime(overview.checkedAt)}</small>
          </div>
          <div className="admin-internal-api__list">
            {modules.map((module) => <InternalApiRow module={module} key={module.id} />)}
            {!modules.length ? (
              <div className="admin-internal-api__empty">
                <Search size={20} /> По заданным условиям API не найдены.
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function InternalApiRow({ module }: { module: AdministrationInternalApiOverview['modules'][number] }) {
  const [open, setOpen] = useState(module.status === 'DEGRADED');

  return (
    <details
      className={module.status === 'DEGRADED' ? 'admin-internal-api-row is-degraded' : 'admin-internal-api-row'}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className={module.status === 'WORKING' ? 'admin-internal-api-row__state is-ok' : 'admin-internal-api-row__state is-error'}>
          {module.status === 'WORKING' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {module.status === 'WORKING' ? 'Работает' : 'Ограничено'}
        </span>
        <span className="admin-internal-api-row__identity">
          <strong>{module.name}</strong>
          <small>{module.description}</small>
        </span>
        <span className="admin-internal-api-row__routes">
          {module.prefixes.map((prefix) => <code key={prefix}>{prefix}</code>)}
        </span>
        <span className="admin-internal-api-row__count">{module.routeCount} методов</span>
        <ChevronDown className="admin-internal-api-row__chevron" size={18} />
      </summary>
      <div className="admin-internal-api-row__details">
        <section>
          <h4>Что выполняет</h4>
          <ul>{module.logic.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
        <section>
          <h4>Зависимости</h4>
          <div className="admin-internal-api-row__dependencies">
            {module.dependencies.map((dependency) => <span key={dependency}>{dependency}</span>)}
          </div>
          <p>{module.statusText}</p>
        </section>
      </div>
    </details>
  );
}

// ADDED: Recovery is verified by a changed process start time, not by a decorative success state.
async function waitForApiRecovery(accessToken: string, previousStartedAt: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(1_500);
    try {
      const result = await fetchAdministrationInternalApis(accessToken);
      if (result.runtime.startedAt !== previousStartedAt && result.runtime.status === 'WORKING') return result;
    } catch {
      // API is expected to be briefly unreachable while Docker starts the new process.
    }
  }
  throw new Error('API не подтвердил восстановление за 60 секунд. Проверьте контейнер API на сервере.');
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function formatUptime(totalSeconds: number) {
  if (totalSeconds < 60) return `${totalSeconds} сек`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч ${minutes % 60} мин`;
  return `${Math.floor(hours / 24)} д ${hours % 24} ч`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить операцию.';
}
