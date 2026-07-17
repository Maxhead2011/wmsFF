import { RefreshCw, Save, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  fetchClientBillingServices,
  upsertClientBillingService,
  type AuthSession,
  type BillingPriceTaxMode,
  type ClientBillingServiceSummary,
  type ClientSummary,
} from '../../lib/api';
import { billingUnitLabel } from './billingMeta';

type ClientBillingServicesPanelProps = {
  clients: ClientSummary[];
  session: AuthSession;
};

type EditableClientService = ClientBillingServiceSummary & {
  priceInput: string;
  commentInput: string;
  dirty: boolean;
  saving: boolean;
};

export function ClientBillingServicesPanel({ clients, session }: ClientBillingServicesPanelProps) {
  const [clientId, setClientId] = useState('');
  const [rows, setRows] = useState<EditableClientService[]>([]);
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'connected'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [isLoading, setLoading] = useState(false);
  const [isSavingAll, setSavingAll] = useState(false);
  const [error, setError] = useState('');

  const selectedClient = clients.find((client) => client.id === clientId) ?? null;
  const connectedCount = rows.filter((row) => row.isActive).length;
  const dirtyCount = rows.filter((row) => row.dirty).length;
  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru-RU');
    return rows.filter((row) => {
      if (visibility === 'connected' && !row.isActive) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      return `${row.service.code} ${row.service.name}`.toLocaleLowerCase('ru-RU').includes(normalized);
    });
  }, [query, rows, visibility]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  async function loadServices(nextClientId = clientId) {
    if (!nextClientId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const services = await fetchClientBillingServices(session.accessToken, nextClientId);
      setRows(services.map(editableRow));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  function changeClient(nextClientId: string) {
    setClientId(nextClientId);
    setRows([]);
    setQuery('');
    setPage(1);
    setError('');
    void loadServices(nextClientId);
  }

  function updateRow(serviceId: string, patch: Partial<EditableClientService>) {
    setRows((current) =>
      current.map((row) => (row.service.id === serviceId ? { ...row, ...patch, dirty: true } : row)),
    );
  }

  async function saveRow(serviceId: string) {
    const row = rows.find((candidate) => candidate.service.id === serviceId);
    if (!clientId || !row) {
      return;
    }
    setError('');
    setRows((current) => current.map((candidate) => (candidate.service.id === serviceId ? { ...candidate, saving: true } : candidate)));
    try {
      const saved = await saveService(session, clientId, row);
      setRows((current) => current.map((candidate) => (candidate.service.id === serviceId ? editableRow(saved) : candidate)));
    } catch (caught) {
      setError(errorMessage(caught));
      setRows((current) => current.map((candidate) => (candidate.service.id === serviceId ? { ...candidate, saving: false } : candidate)));
    }
  }

  async function saveAll() {
    const changed = rows.filter((row) => row.dirty);
    if (!clientId || changed.length === 0) {
      return;
    }
    setSavingAll(true);
    setError('');
    try {
      const saved = await Promise.all(changed.map((row) => saveService(session, clientId, row)));
      const byServiceId = new Map(saved.map((row) => [row.service.id, editableRow(row)]));
      setRows((current) => current.map((row) => byServiceId.get(row.service.id) ?? row));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingAll(false);
    }
  }

  return (
    <section className="client-services-panel" aria-label="Услуги и цены клиента">
      <header className="client-services-panel__header">
        <div>
          <span>Настройка клиента</span>
          <h3>Услуги и цены</h3>
          <p>Индивидуальные тарифы выбранного клиента.</p>
        </div>
        <button
          className="icon-button"
          disabled={!clientId || isLoading}
          type="button"
          onClick={() => void loadServices()}
          title="Обновить"
          aria-label="Обновить услуги клиента"
        >
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </header>

      <div className="client-services-toolbar">
        <label>
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => changeClient(event.target.value)}>
            <option value="">Выберите клиента</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Поиск услуги</span>
          <div className="client-services-search">
            <Search size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Название или код"
            />
          </div>
        </label>
        <label>
          <span>Показывать</span>
          <select
            value={visibility}
            onChange={(event) => {
              setVisibility(event.target.value as 'all' | 'connected');
              setPage(1);
            }}
          >
            <option value="all">Все услуги</option>
            <option value="connected">Только подключенные</option>
          </select>
        </label>
        <div className="client-services-toolbar__summary">
          <span>Подключено</span>
          <strong>{connectedCount}</strong>
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {!clientId ? <p className="panel-message">Выберите клиента, чтобы настроить его услуги.</p> : null}
      {clientId ? (
        <>
          <div className="billing-table-wrap">
            <table className="billing-table client-services-table">
              <thead>
                <tr>
                  <th>Подключена</th>
                  <th>Услуга</th>
                  <th>Единица</th>
                  <th>Цена, ₽</th>
                  <th>Налог</th>
                  <th>Комментарий</th>
                  <th aria-label="Сохранить" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr className={row.isActive ? 'is-connected' : undefined} key={row.service.id}>
                    <td>
                      <label className="client-service-toggle">
                        <input
                          checked={row.isActive}
                          type="checkbox"
                          onChange={(event) => updateRow(row.service.id, { isActive: event.target.checked })}
                        />
                        <span>{row.isActive ? 'Да' : 'Нет'}</span>
                      </label>
                    </td>
                    <td>
                      <strong>{row.service.name}</strong>
                      <small>{row.service.code}</small>
                    </td>
                    <td>{billingUnitLabel(row.service.unit)}</td>
                    <td>
                      <input
                        min="0"
                        step="0.01"
                        type="number"
                        value={row.priceInput}
                        onChange={(event) => updateRow(row.service.id, { priceInput: event.target.value })}
                      />
                      {row.taxMode === 'ADD_6_PERCENT' ? <small>Итого: {formatMoney(withTax(row.priceInput))} ₽</small> : null}
                    </td>
                    <td>
                      <select
                        value={row.taxMode}
                        onChange={(event) => updateRow(row.service.id, { taxMode: event.target.value as BillingPriceTaxMode })}
                      >
                        <option value="INCLUDED">Цена уже с налогом</option>
                        <option value="ADD_6_PERCENT">Добавить 6%</option>
                      </select>
                    </td>
                    <td>
                      <input
                        value={row.commentInput}
                        onChange={(event) => updateRow(row.service.id, { commentInput: event.target.value })}
                        placeholder="Необязательно"
                      />
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        disabled={!row.dirty || row.saving}
                        type="button"
                        onClick={() => void saveRow(row.service.id)}
                        title="Сохранить услугу"
                        aria-label={`Сохранить ${row.service.name}`}
                      >
                        <Save size={16} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={7}>{isLoading ? 'Загружаю услуги...' : 'Услуги не найдены.'}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <footer className="client-services-panel__footer">
            <span>{selectedClient?.name} · изменено строк: {dirtyCount}</span>
            <div className="client-services-pagination">
              <button className="secondary-button" disabled={currentPage <= 1} type="button" onClick={() => setPage(currentPage - 1)}>
                Назад
              </button>
              <span>Страница {currentPage} из {pageCount} · услуг: {filteredRows.length}</span>
              <button className="secondary-button" disabled={currentPage >= pageCount} type="button" onClick={() => setPage(currentPage + 1)}>
                Далее
              </button>
              <label>
                <span>На странице</span>
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>
            <button className="primary-button" disabled={dirtyCount === 0 || isSavingAll} type="button" onClick={() => void saveAll()}>
              <Save size={16} aria-hidden="true" />
              <span>{isSavingAll ? 'Сохраняю' : 'Сохранить изменения'}</span>
            </button>
          </footer>
        </>
      ) : null}
    </section>
  );
}

function editableRow(row: ClientBillingServiceSummary): EditableClientService {
  return {
    ...row,
    priceInput: String(row.priceRub ?? row.service.defaultPriceRub ?? 0),
    commentInput: row.comment ?? '',
    dirty: false,
    saving: false,
  };
}

function saveService(session: AuthSession, clientId: string, row: EditableClientService) {
  return upsertClientBillingService(session.accessToken, clientId, {
    serviceId: row.service.id,
    priceRub: Math.max(0, Number(row.priceInput) || 0),
    taxMode: row.taxMode,
    isActive: row.isActive,
    comment: row.commentInput.trim() || undefined,
  });
}

function withTax(value: string) {
  return ((Number(value) || 0) / 94) * 100;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось сохранить услуги клиента.';
}
