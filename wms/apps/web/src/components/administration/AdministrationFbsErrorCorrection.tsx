import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CircleX,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  checkAdministrationFbsRequestErrors,
  fetchAdministrationFbsErrorRequests,
  repairAdministrationFbsRequestErrors,
  type AdministrationFbsBoxAudit,
  type AdministrationFbsBoxAuditState,
  type AdministrationFbsErrorRequest,
  type AuthSession,
} from '../../lib/api';

type Props = { session: AuthSession };
type RowFilter = 'ISSUES' | 'ALL' | 'OK';

export function AdministrationFbsErrorCorrection({ session }: Props) {
  const [requests, setRequests] = useState<AdministrationFbsErrorRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [query, setQuery] = useState('');
  const [audit, setAudit] = useState<AdministrationFbsBoxAudit | null>(null);
  const [rowFilter, setRowFilter] = useState<RowFilter>('ISSUES');
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const filteredRequests = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru-RU');
    if (!normalized) return requests;
    return requests.filter((request) =>
      [request.number, request.title, request.client.code, request.client.name]
        .join(' ')
        .toLocaleLowerCase('ru-RU')
        .includes(normalized),
    );
  }, [query, requests]);

  const rows = useMemo(() => {
    if (!audit) return [];
    if (rowFilter === 'ALL') return audit.rows;
    if (rowFilter === 'OK') return audit.rows.filter((row) => row.state === 'OK');
    return audit.rows.filter((row) => row.state !== 'OK');
  }, [audit, rowFilter]);

  useEffect(() => {
    void loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    setError('');
    try {
      const result = await fetchAdministrationFbsErrorRequests(session.accessToken);
      setRequests(result);
      setSelectedRequestId((current) => current || result[0]?.id || '');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function check() {
    if (!selectedRequestId) return;
    setChecking(true);
    setError('');
    setMessage('');
    try {
      const result = await checkAdministrationFbsRequestErrors(session.accessToken, selectedRequestId);
      setAudit(result);
      setRowFilter(result.summary.issues > 0 ? 'ISSUES' : 'ALL');
      setMessage(
        result.summary.issues > 0
          ? `Проверка завершена: найдено проблемных коробов — ${result.summary.issues}. Данные пока не изменялись.`
          : 'Проверка завершена: список коробов соответствует живым остаткам.',
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setChecking(false);
    }
  }

  async function repair() {
    if (!audit || audit.summary.issues === 0 || repairing) return;
    const confirmed = window.confirm(
      `Исправить подбор коробов заявки №${String(audit.request.number).padStart(6, '0')}?\n\n` +
      'Незапущенные задания будут заново распределены по живым остаткам. Уже отсканированные ШК и КИЗ останутся без изменений.',
    );
    if (!confirmed) return;
    setRepairing(true);
    setError('');
    setMessage('');
    try {
      const result = await repairAdministrationFbsRequestErrors(session.accessToken, audit.request.id);
      setAudit(result.after);
      setRowFilter(result.after.summary.issues > 0 ? 'ISSUES' : 'ALL');
      setMessage(result.message);
      await loadRequests();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRepairing(false);
    }
  }

  return (
    <section className="admin-section admin-fbs-errors">
      <div className="admin-section__heading">
        <div>
          <span>Исправление ошибок</span>
          <h3>Проверка коробов FBS-заявки</h3>
        </div>
        <p>
          Сравнивает старый план подбора с живыми остатками, палетсортами и текущими FBS-резервами.
          Проверка ничего не меняет; исправление запускается только отдельной кнопкой.
        </p>
      </div>

      <div className="admin-fbs-errors__safety">
        <ShieldCheck size={20} />
        <div>
          <strong>Безопасный пересчёт</strong>
          <span>Чужие резервы не удаляются. Начатые заказы, отсканированные ШК и КИЗ сохраняются.</span>
        </div>
      </div>

      <div className="admin-fbs-errors__controls">
        <label className="admin-fbs-errors__search">
          <span>Быстрый поиск заявки</span>
          <div><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, клиент или название" /></div>
        </label>
        <label>
          <span>Активная FBS-заявка</span>
          <select
            value={selectedRequestId}
            onChange={(event) => {
              setSelectedRequestId(event.target.value);
              setAudit(null);
              setMessage('');
              setError('');
            }}
            disabled={loading}
          >
            {filteredRequests.length === 0 ? <option value="">Заявки не найдены</option> : null}
            {filteredRequests.map((request) => (
              <option key={request.id} value={request.id}>
                №{String(request.number).padStart(6, '0')} · {request.client.name} · осталось {request.tasks.outstanding}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="admin-button admin-button--primary" onClick={() => void check()} disabled={!selectedRequestId || checking || repairing}>
          {checking ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
          {checking ? 'Проверяю…' : 'Проверить короба'}
        </button>
        <button type="button" className="admin-button admin-button--danger" onClick={() => void repair()} disabled={!audit?.summary.issues || checking || repairing}>
          {repairing ? <LoaderCircle className="spin" size={17} /> : <Wrench size={17} />}
          {repairing ? 'Исправляю…' : 'Исправить найденное'}
        </button>
      </div>

      {message ? <div className="admin-message admin-message--ok"><CheckCircle2 size={18} />{message}</div> : null}
      {error ? <div className="admin-message admin-message--error"><CircleX size={18} />{error}</div> : null}

      {audit ? (
        <>
          <div className="admin-fbs-errors__request">
            <div>
              <span>Проверена заявка</span>
              <strong>№{String(audit.request.number).padStart(6, '0')} · {audit.request.client.name}</strong>
            </div>
            <dl>
              <div><dt>Всего заданий</dt><dd>{audit.taskSummary.total}</dd></div>
              <div><dt>Собрано</dt><dd>{audit.taskSummary.completed}</dd></div>
              <div><dt>Осталось</dt><dd>{audit.taskSummary.outstanding}</dd></div>
              <div><dt>Сейчас в работе</dt><dd>{audit.taskSummary.inProgress}</dd></div>
            </dl>
          </div>

          <div className="admin-fbs-errors__metrics">
            <Metric icon={<Boxes size={18} />} label="В плане" value={audit.summary.planBoxes} tone="neutral" />
            <Metric icon={<CheckCircle2 size={18} />} label="Доступны" value={audit.summary.healthy} tone="ok" />
            <Metric icon={<AlertTriangle size={18} />} label="Расхождения" value={audit.summary.issues} tone="danger" />
            <Metric icon={<CircleX size={18} />} label="Заняты резервами" value={audit.summary.blockedByReservations + audit.summary.skuOrQuantityMismatch} tone="warning" />
            <Metric icon={<RefreshCw size={18} />} label="Больше не нужны" value={audit.summary.noRemainingDemand} tone="neutral" />
            <Metric icon={<AlertTriangle size={18} />} label="Не на палетсорте" value={audit.summary.notOnPalletSort} tone="warning" />
          </div>

          <div className="admin-fbs-errors__toolbar">
            <div>
              <button type="button" className={rowFilter === 'ISSUES' ? 'active' : ''} onClick={() => setRowFilter('ISSUES')}>Только проблемы ({audit.summary.issues})</button>
              <button type="button" className={rowFilter === 'ALL' ? 'active' : ''} onClick={() => setRowFilter('ALL')}>Все ({audit.summary.planBoxes})</button>
              <button type="button" className={rowFilter === 'OK' ? 'active' : ''} onClick={() => setRowFilter('OK')}>Исправные ({audit.summary.healthy})</button>
            </div>
            <small>Проверено {new Date(audit.checkedAt).toLocaleString('ru-RU')}</small>
          </div>

          <div className="admin-fbs-errors__table-wrap">
            <table className="admin-fbs-errors__table">
              <thead>
                <tr><th>Короб / палетсорт</th><th>Состояние</th><th>Остаток</th><th>Резерв</th><th>Свободно</th><th>Нужно</th><th>Товары и действие</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.code}>
                    <td><strong>{row.code}</strong><small>{row.palletCode ?? 'Не размещён'}</small></td>
                    <td><Status state={row.state} label={row.stateLabel} /></td>
                    <td>{row.availableUnits}</td>
                    <td>{row.reservedUnits}</td>
                    <td>{row.freeUnits}</td>
                    <td>{row.requiredUnits}</td>
                    <td>
                      {row.products.length ? (
                        <details>
                          <summary>{row.products.length} товар(а/ов)</summary>
                          <ul>{row.products.map((product) => <li key={product.skuId}>{product.name}: ост. {product.available}, свободно {product.free}, нужно {product.required}</li>)}</ul>
                        </details>
                      ) : null}
                      {row.externalOrdersCount > 0 ? <small>Заняли заказы: {row.externalOrders.join(', ')}{row.externalOrdersCount > row.externalOrders.length ? ` и ещё ${row.externalOrdersCount - row.externalOrders.length}` : ''}</small> : null}
                      <span>{row.recommendation}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 ? <div className="admin-fbs-errors__empty"><CheckCircle2 size={22} />Расхождений не найдено.</div> : null}
          </div>
        </>
      ) : (
        <div className="admin-fbs-errors__empty">
          {loading ? <LoaderCircle className="spin" size={24} /> : <Search size={24} />}
          {loading ? 'Загружаю активные заявки…' : 'Выберите заявку и нажмите «Проверить короба».'}
        </div>
      )}
    </section>
  );
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return <article className={`is-${tone}`}><span>{icon}{label}</span><strong>{value}</strong></article>;
}

function Status({ state, label }: { state: AdministrationFbsBoxAuditState; label: string }) {
  return <span className={`admin-fbs-errors__status is-${state.toLocaleLowerCase('en-US')}`}>{label}</span>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить операцию.';
}
