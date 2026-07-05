import { PlusCircle, RefreshCw, Save, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchBillingServices,
  fetchClientBillingServices,
  fetchClients,
  upsertClientBillingService,
  type AuthSession,
  type BillingPriceTaxMode,
  type BillingServiceSummary,
  type ClientBillingServiceSummary,
  type ClientSummary,
} from '../../lib/api';
import { BillingServiceForm } from '../billing/BillingServiceForm';
import { billingUnitLabel } from '../billing/billingMeta';
import '../billing/billing.css';
import './client-services.css';

type LoadState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T[];
  error?: string;
};

type ClientServicesPanelProps = {
  session: AuthSession;
};

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

export function ClientServicesPanel({ session }: ClientServicesPanelProps) {
  const [clients, setClients] = useState<LoadState<ClientSummary>>({ status: 'idle', data: [] });
  const [services, setServices] = useState<LoadState<BillingServiceSummary>>({ status: 'idle', data: [] });
  const [clientServices, setClientServices] = useState<LoadState<ClientBillingServiceSummary>>({ status: 'idle', data: [] });
  const [selectedClientId, setSelectedClientId] = useState('');
  const [query, setQuery] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedClient = clients.data.find((client) => client.id === selectedClientId);
  const visibleServices = useMemo(
    () => filterClientServices(clientServices.data, query, onlyActive),
    [clientServices.data, onlyActive, query],
  );
  const activeCount = useMemo(() => clientServices.data.filter((item) => item.isActive).length, [clientServices.data]);
  const missingPriceCount = useMemo(
    () => clientServices.data.filter((item) => item.isActive && numberFromInput(item.priceRub) <= 0).length,
    [clientServices.data],
  );
  const averagePrice = useMemo(() => {
    const active = clientServices.data.filter((item) => item.isActive && numberFromInput(item.priceRub) > 0);
    if (active.length === 0) {
      return 0;
    }

    return active.reduce((sum, item) => sum + numberFromInput(item.priceRub), 0) / active.length;
  }, [clientServices.data]);

  useEffect(() => {
    void loadBaseData();
  }, []);

  useEffect(() => {
    if (!selectedClientId) {
      setClientServices({ status: 'idle', data: [] });
      return;
    }

    void loadClientServices(selectedClientId);
  }, [selectedClientId]);

  async function loadBaseData() {
    setError(null);
    setMessage(null);
    setClients((current) => ({ ...current, status: 'loading', error: undefined }));
    setServices((current) => ({ ...current, status: 'loading', error: undefined }));

    try {
      const [nextClients, nextServices] = await Promise.all([
        fetchClients(session.accessToken),
        fetchBillingServices(session.accessToken),
      ]);
      setClients({ status: 'ready', data: nextClients });
      setServices({ status: 'ready', data: nextServices });

      if (!selectedClientId && nextClients.length > 0) {
        setSelectedClientId(nextClients[0].id);
      }
    } catch (caught) {
      const nextError = errorMessage(caught);
      setClients((current) => ({ ...current, status: 'error', error: nextError }));
      setServices((current) => ({ ...current, status: 'error', error: nextError }));
      setError(nextError);
    }
  }

  async function loadClientServices(clientId: string) {
    setError(null);
    setMessage(null);
    setClientServices((current) => ({ ...current, status: 'loading', error: undefined }));

    try {
      const nextServices = await fetchClientBillingServices(session.accessToken, clientId);
      setClientServices({ status: 'ready', data: nextServices });
    } catch (caught) {
      const nextError = errorMessage(caught);
      setClientServices((current) => ({ ...current, status: 'error', error: nextError }));
      setError(nextError);
    }
  }

  async function saveServices() {
    if (!selectedClientId) {
      setError('Выберите клиента.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      await Promise.all(
        clientServices.data.map((item) =>
          upsertClientBillingService(session.accessToken, selectedClientId, {
            serviceId: item.service.id,
            priceRub: numberFromInput(item.priceRub),
            taxMode: item.taxMode,
            isActive: item.isActive,
            comment: item.comment || undefined,
          }),
        ),
      );
      await loadClientServices(selectedClientId);
      setMessage('Услуги клиента сохранены. Эти цены будут использоваться при выставлении счетов.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSaving(false);
    }
  }

  function updateClientService(serviceId: string, patch: Partial<ClientBillingServiceSummary>) {
    setClientServices((current) => ({
      ...current,
      data: current.data.map((item) => (item.service.id === serviceId ? { ...item, ...patch } : item)),
    }));
  }

  function acceptService(service: BillingServiceSummary) {
    setServices((current) => ({ status: 'ready', data: [service, ...current.data] }));
    if (selectedClientId) {
      void loadClientServices(selectedClientId);
    }
  }

  return (
    <section className="client-services-panel" aria-label="Услуги клиентов">
      <div className="section-heading client-services-panel__heading">
        <div>
          <p className="eyebrow">Управление</p>
          <h2>Услуги клиентов</h2>
          <p>Здесь прописываются услуги, цены и налоговый режим, по которым WMS собирает счета.</p>
        </div>
        <button className="icon-button" type="button" onClick={() => void loadBaseData()} title="Обновить" aria-label="Обновить услуги">
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="client-services-panel__layout">
        <aside className="client-services-panel__sidebar" aria-label="Выбор клиента">
          <label>
            <span>Клиент</span>
            <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
              <option value="">Выберите клиента</option>
              {clients.data.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>

          <div className="client-services-panel__cards">
            <MetricCard label="Активных услуг" value={String(activeCount)} />
            <MetricCard label="Без цены" value={String(missingPriceCount)} tone={missingPriceCount > 0 ? 'warning' : 'ready'} />
            <MetricCard label="Средняя цена" value={`${formatMoney(averagePrice)} ₽`} />
          </div>

          {selectedClient ? (
            <div className="client-services-panel__client">
              <span>Выбран клиент</span>
              <strong>{selectedClient.name}</strong>
              <small>{selectedClient.legalName || 'Юр. название не заполнено'}</small>
            </div>
          ) : null}
        </aside>

        <div className="client-services-panel__workarea">
          <div className="client-services-panel__toolbar">
            <label className="client-services-panel__search">
              <Search size={16} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Найти услугу по названию или коду"
              />
            </label>
            <label className="client-services-panel__toggle">
              <input checked={onlyActive} type="checkbox" onChange={(event) => setOnlyActive(event.target.checked)} />
              <span>Только активные</span>
            </label>
            <button
              className="primary-button"
              disabled={isSaving || clientServices.status !== 'ready'}
              type="button"
              onClick={() => void saveServices()}
            >
              <Save size={16} aria-hidden="true" />
              <span>{isSaving ? 'Сохраняю' : 'Сохранить услуги'}</span>
            </button>
          </div>

          {error || clients.error || services.error || clientServices.error ? (
            <p className="form-error">{error || clients.error || services.error || clientServices.error}</p>
          ) : null}
          {message ? <p className="inline-status">{message}</p> : null}

          {!selectedClientId ? (
            <div className="client-services-panel__empty">
              <SlidersHorizontal size={22} aria-hidden="true" />
              <strong>Выберите клиента</strong>
              <span>После выбора появится таблица услуг и цен для счетов.</span>
            </div>
          ) : null}

          {selectedClientId ? (
            <div className="client-services-panel__table-wrap">
              <table className="data-table client-services-table">
                <thead>
                  <tr>
                    <th>Вкл.</th>
                    <th>Услуга</th>
                    <th>Код</th>
                    <th>Ед.</th>
                    <th>Цена, ₽</th>
                    <th>Налог</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleServices.map((item) => (
                    <tr className={item.isActive ? 'is-active' : undefined} key={item.service.id}>
                      <td>
                        <input
                          checked={item.isActive}
                          type="checkbox"
                          onChange={(event) => updateClientService(item.service.id, { isActive: event.target.checked })}
                        />
                      </td>
                      <td>
                        <strong>{item.service.name}</strong>
                        {item.service.defaultPriceRub !== null ? (
                          <span>Базовая: {formatMoney(item.service.defaultPriceRub)} ₽</span>
                        ) : null}
                      </td>
                      <td>{item.service.code}</td>
                      <td>{billingUnitLabel(item.service.unit)}</td>
                      <td>
                        <input
                          min="0"
                          step="0.01"
                          type="number"
                          value={String(item.priceRub ?? '')}
                          onChange={(event) => updateClientService(item.service.id, { priceRub: event.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          value={item.taxMode}
                          onChange={(event) => updateClientService(item.service.id, { taxMode: event.target.value as BillingPriceTaxMode })}
                        >
                          <option value="INCLUDED">В цене</option>
                          <option value="ADD_6_PERCENT">Добавить 6%</option>
                        </select>
                      </td>
                      <td>
                        <input
                          value={item.comment ?? ''}
                          onChange={(event) => updateClientService(item.service.id, { comment: event.target.value })}
                          placeholder="Для счета или правила"
                        />
                      </td>
                    </tr>
                  ))}
                  {visibleServices.length === 0 ? (
                    <tr>
                      <td colSpan={7}>Услуги не найдены.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}

          <details className="client-services-panel__create">
            <summary>
              <PlusCircle size={17} aria-hidden="true" />
              <span>Создать новую услугу в справочнике</span>
            </summary>
            <BillingServiceForm session={session} onCreated={acceptService} />
          </details>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: 'ready' | 'warning' }) {
  return (
    <article className={`client-services-panel__metric ${tone ? `client-services-panel__metric--${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function filterClientServices(items: ClientBillingServiceSummary[], query: string, onlyActive: boolean) {
  const normalizedQuery = normalizeSearch(query);

  return items
    .filter((item) => {
      if (onlyActive && !item.isActive) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return (
        normalizeSearch(item.service.name).includes(normalizedQuery) ||
        normalizeSearch(item.service.code).includes(normalizedQuery)
      );
    })
    .sort((left, right) => {
      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1;
      }

      return left.service.name.localeCompare(right.service.name, 'ru');
    });
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU');
}

function numberFromInput(value: string | number | null | undefined) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: string | number | null | undefined) {
  return moneyFormatter.format(numberFromInput(value));
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
