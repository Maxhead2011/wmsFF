import { Calculator, PackageCheck, RefreshCw, Save, Search, Truck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchClientBillingServices,
  fetchClientFbsTurnkeyPricing,
  fetchFbsCalculatorDestinations,
  updateClientFbsTurnkeyPricing,
  upsertClientBillingService,
  type AuthSession,
  type BillingPriceTaxMode,
  type ClientBillingServiceSummary,
  type ClientSummary,
} from '../../lib/api';
import { billingUnitLabel } from './billingMeta';
import { useRememberedClientId } from '../../lib/rememberedClient';

type ClientBillingServicesPanelProps = {
  clients: ClientSummary[];
  session: AuthSession;
  fixedClientId?: string;
  section?: 'all' | 'fbo' | 'fbs';
  embedded?: boolean;
};

type EditableClientService = ClientBillingServiceSummary & {
  priceInput: string;
  commentInput: string;
  dirty: boolean;
  saving: boolean;
};

type EditableFbsTurnkey = {
  enabled: boolean;
  unitPriceInput: string;
  fixedPlusLogisticsEnabled: boolean;
  fixedPlusLogisticsUnitPriceInput: string;
  fixedPlusLogisticsDestination: string;
  tieredLogisticsEnabled: boolean;
  logisticsFreeItemsLimitInput: string;
  logisticsCubicMeterLitersInput: string;
  logisticsCubicMeterPriceInput: string;
  logisticsPalletPriceInput: string;
  primaryProcessingEnabled: boolean;
  primaryWhiteUnitPriceInput: string;
  primaryGrayUnitPriceInput: string;
  primaryReturnUnitPriceInput: string;
  primaryServices: Array<{
    serviceId: string;
    quantityMultiplier: number;
    matchKeywords: string;
  }>;
  dirty: boolean;
};

export function ClientBillingServicesPanel({
  clients,
  session,
  fixedClientId,
  section = 'all',
  embedded = false,
}: ClientBillingServicesPanelProps) {
  const [clientId, setClientId] = useRememberedClientId(session.user.id, { fixedClientId });
  const [rows, setRows] = useState<EditableClientService[]>([]);
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'connected'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [isLoading, setLoading] = useState(false);
  const [isSavingAll, setSavingAll] = useState(false);
  const [fbsTurnkey, setFbsTurnkey] = useState<EditableFbsTurnkey | null>(null);
  const [fbsDestinations, setFbsDestinations] = useState<string[]>([]);
  const [isSavingFbsTurnkey, setSavingFbsTurnkey] = useState(false);
  const [error, setError] = useState('');
  const [fbsPricingNotice, setFbsPricingNotice] = useState('');

  const selectedClient = clients.find((client) => client.id === clientId) ?? null;
  const requiresDetailedPrimaryRates = isLukinClient(selectedClient);
  const connectedCount = rows.filter((row) => row.isActive).length;
  const dirtyCount = rows.filter((row) => row.dirty).length;
  const primaryServiceRows = rows.filter((row) => {
    const searchable = `${row.service.code} ${row.service.name}`.toLocaleLowerCase('ru-RU');
    return (
      row.isActive &&
      row.service.unit === 'PIECE' &&
      Number(row.priceRub ?? 0) > 0 &&
      row.service.code !== 'FBS_PROCESSING' &&
      !['перемарк', 'перекле', 'relabel'].some((marker) => searchable.includes(marker))
    );
  });
  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru-RU');
    return rows.filter((row) => {
      if (visibility === 'connected' && !row.isActive) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      return [
        row.service.code,
        row.service.name,
        billingUnitLabel(row.service.unit),
        row.commentInput,
      ]
        .join(' ')
        .toLocaleLowerCase('ru-RU')
        .includes(normalized);
    });
  }, [query, rows, visibility]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    if (fixedClientId) {
      changeClient(fixedClientId);
    }
  }, [fixedClientId]);

  async function loadServices(nextClientId = clientId) {
    if (!nextClientId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError('');
    setFbsPricingNotice('');
    try {
      const [services, turnkeyPricing, destinationOptions] = await Promise.all([
        fetchClientBillingServices(session.accessToken, nextClientId),
        fetchClientFbsTurnkeyPricing(session.accessToken, nextClientId),
        fetchFbsCalculatorDestinations(session.accessToken),
      ]);
      setRows(services.map(editableRow));
      setFbsDestinations(destinationOptions.destinations);
      setFbsTurnkey({
        enabled: turnkeyPricing.enabled,
        unitPriceInput: String(turnkeyPricing.unitPriceRub),
        fixedPlusLogisticsEnabled: turnkeyPricing.fixedPlusLogisticsEnabled,
        fixedPlusLogisticsUnitPriceInput: String(
          turnkeyPricing.fixedPlusLogisticsUnitPriceRub,
        ),
        fixedPlusLogisticsDestination:
          turnkeyPricing.fixedPlusLogisticsDestination ||
          destinationOptions.destinations[0] ||
          'Внуково',
        tieredLogisticsEnabled: turnkeyPricing.tieredLogisticsEnabled,
        logisticsFreeItemsLimitInput: String(turnkeyPricing.logisticsFreeItemsLimit),
        logisticsCubicMeterLitersInput: String(turnkeyPricing.logisticsCubicMeterLiters),
        logisticsCubicMeterPriceInput: String(turnkeyPricing.logisticsCubicMeterPriceRub),
        logisticsPalletPriceInput: String(turnkeyPricing.logisticsPalletPriceRub),
        primaryProcessingEnabled: turnkeyPricing.primaryProcessingEnabled,
        primaryWhiteUnitPriceInput: String(turnkeyPricing.primaryWhiteUnitPriceRub),
        primaryGrayUnitPriceInput: String(turnkeyPricing.primaryGrayUnitPriceRub),
        primaryReturnUnitPriceInput: String(turnkeyPricing.primaryReturnUnitPriceRub),
        primaryServices: turnkeyPricing.primaryServices,
        dirty: false,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  function changeClient(nextClientId: string) {
    setClientId(nextClientId);
    setRows([]);
    setFbsTurnkey(null);
    setFbsDestinations([]);
    setQuery('');
    setPage(1);
    setError('');
    setFbsPricingNotice('');
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

  async function saveFbsTurnkey() {
    if (!clientId || !fbsTurnkey) {
      return;
    }
    const unitPriceRub = Math.max(0, Number(fbsTurnkey.unitPriceInput) || 0);
    const fixedPlusLogisticsUnitPriceRub = Math.max(
      0,
      Number(fbsTurnkey.fixedPlusLogisticsUnitPriceInput) || 0,
    );
    const primaryWhiteUnitPriceRub = Math.max(
      0,
      Number(fbsTurnkey.primaryWhiteUnitPriceInput) || 0,
    );
    const primaryGrayUnitPriceRub = Math.max(
      0,
      Number(fbsTurnkey.primaryGrayUnitPriceInput) || 0,
    );
    const primaryReturnUnitPriceRub = Math.max(
      0,
      Number(fbsTurnkey.primaryReturnUnitPriceInput) || 0,
    );
    const logisticsFreeItemsLimit = Math.max(
      0,
      Math.trunc(Number(fbsTurnkey.logisticsFreeItemsLimitInput) || 0),
    );
    const logisticsCubicMeterLiters = Math.max(
      1,
      Math.trunc(Number(fbsTurnkey.logisticsCubicMeterLitersInput) || 0),
    );
    const logisticsCubicMeterPriceRub = Math.max(
      0,
      Number(fbsTurnkey.logisticsCubicMeterPriceInput) || 0,
    );
    const logisticsPalletPriceRub = Math.max(
      0,
      Number(fbsTurnkey.logisticsPalletPriceInput) || 0,
    );
    if (fbsTurnkey.enabled && fbsTurnkey.fixedPlusLogisticsEnabled) {
      setError('Выберите только один фиксированный режим расчёта FBS.');
      return;
    }
    if (fbsTurnkey.enabled && fbsTurnkey.tieredLogisticsEnabled) {
      setError('Ступенчатую логистику нельзя включить одновременно с тарифом «FBS под ключ».');
      return;
    }
    if (
      fbsTurnkey.tieredLogisticsEnabled &&
      (logisticsCubicMeterPriceRub <= 0 || logisticsPalletPriceRub <= 0)
    ) {
      setError('Укажите положительные цены за 1 м³ и за каждую паллету.');
      return;
    }
    if (fbsTurnkey.enabled && unitPriceRub <= 0) {
      setError('Укажите стоимость обработки одной единицы для тарифа «FBS под ключ».');
      return;
    }
    if (
      fbsTurnkey.fixedPlusLogisticsEnabled &&
      fixedPlusLogisticsUnitPriceRub <= 0
    ) {
      setError('Укажите фиксированную стоимость обработки одной единицы для тарифа «Фикс + логистика».');
      return;
    }
    if (
      fbsTurnkey.primaryProcessingEnabled &&
      requiresDetailedPrimaryRates &&
      (primaryWhiteUnitPriceRub <= 0 ||
        primaryGrayUnitPriceRub <= 0 ||
        primaryReturnUnitPriceRub <= 0)
    ) {
      setError(
        'Для первичной обработки укажите три положительные цены: «в белую», «в серую» и «возврат».',
      );
      return;
    }
    if (
      fbsTurnkey.primaryProcessingEnabled &&
      !requiresDetailedPrimaryRates &&
      (primaryWhiteUnitPriceRub <= 0 ||
        primaryGrayUnitPriceRub <= 0 ||
        primaryReturnUnitPriceRub <= 0) &&
      !window.confirm(
        'У клиента заполнены не все раздельные цены первичной обработки. Сохранить настройки без обязательных тарифов «в белую», «в серую» и «возврат»?',
      )
    ) {
      return;
    }
    const fixedPlusLogisticsDestination =
      fbsTurnkey.fixedPlusLogisticsDestination.trim();
    if (
      fbsTurnkey.fixedPlusLogisticsEnabled &&
      !fixedPlusLogisticsDestination
    ) {
      setError('Выберите город доставки для тарифа «Фикс + логистика».');
      return;
    }
    setSavingFbsTurnkey(true);
    setError('');
    setFbsPricingNotice('');
    try {
      const saved = await updateClientFbsTurnkeyPricing(session.accessToken, clientId, {
        enabled: fbsTurnkey.enabled,
        unitPriceRub,
        fixedPlusLogisticsEnabled: fbsTurnkey.fixedPlusLogisticsEnabled,
        fixedPlusLogisticsUnitPriceRub,
        fixedPlusLogisticsDestination,
        tieredLogisticsEnabled: fbsTurnkey.tieredLogisticsEnabled,
        logisticsFreeItemsLimit,
        logisticsCubicMeterLiters,
        logisticsCubicMeterPriceRub,
        logisticsPalletPriceRub,
        primaryProcessingEnabled: fbsTurnkey.primaryProcessingEnabled,
        primaryWhiteUnitPriceRub,
        primaryGrayUnitPriceRub,
        primaryReturnUnitPriceRub,
        primaryServices: fbsTurnkey.primaryServices,
      });
      setFbsTurnkey({
        enabled: saved.enabled,
        unitPriceInput: String(saved.unitPriceRub),
        fixedPlusLogisticsEnabled: saved.fixedPlusLogisticsEnabled,
        fixedPlusLogisticsUnitPriceInput: String(
          saved.fixedPlusLogisticsUnitPriceRub,
        ),
        fixedPlusLogisticsDestination:
          saved.fixedPlusLogisticsDestination,
        tieredLogisticsEnabled: saved.tieredLogisticsEnabled,
        logisticsFreeItemsLimitInput: String(saved.logisticsFreeItemsLimit),
        logisticsCubicMeterLitersInput: String(saved.logisticsCubicMeterLiters),
        logisticsCubicMeterPriceInput: String(saved.logisticsCubicMeterPriceRub),
        logisticsPalletPriceInput: String(saved.logisticsPalletPriceRub),
        primaryProcessingEnabled: saved.primaryProcessingEnabled,
        primaryWhiteUnitPriceInput: String(saved.primaryWhiteUnitPriceRub),
        primaryGrayUnitPriceInput: String(saved.primaryGrayUnitPriceRub),
        primaryReturnUnitPriceInput: String(saved.primaryReturnUnitPriceRub),
        primaryServices: saved.primaryServices,
        dirty: false,
      });
      const recalculation = saved.recalculation;
      setFbsPricingNotice(
        recalculation
          ? `Режим сохранён. Пересчитано черновых начислений: ${recalculation.recalculatedCharges}, черновых счетов: ${recalculation.recalculatedInvoices}.`
          : 'Режим сохранён. Черновые начисления FBS пересчитаны.',
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingFbsTurnkey(false);
    }
  }

  return (
    <section
      className={`client-services-panel${embedded ? ' client-services-panel--embedded' : ''}`}
      aria-label="Услуги и цены клиента"
    >
      <header className="client-services-panel__header">
        <div>
          <span>Настройка клиента</span>
          <h3>{section === 'fbo' ? 'Услуги FBO' : section === 'fbs' ? 'Режимы FBS' : 'Услуги и цены'}</h3>
          <p>
            {section === 'fbo'
              ? 'Стандартные и дополнительные услуги FBO с индивидуальной ценой клиента.'
              : section === 'fbs'
                ? 'Фиксированные режимы FBS и первичная обработка клиента.'
                : 'Индивидуальные тарифы выбранного клиента.'}
          </p>
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

      {section !== 'fbs' ? <div className="client-services-toolbar">
        {!fixedClientId ? (
          <label>
            <span>Клиент</span>
            <select value={clientId} onChange={(event) => changeClient(event.target.value)}>
              <option value="">Выберите клиента</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="client-services-toolbar__search-field">
          <span>Быстрый поиск услуг</span>
          <div className="client-services-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Быстрый поиск услуг"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Название, код, единица или комментарий"
            />
            {query ? (
              <button
                type="button"
                title="Очистить поиск"
                aria-label="Очистить быстрый поиск услуг"
                onClick={() => {
                  setQuery('');
                  setPage(1);
                }}
              >
                <X size={15} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <small>Найдено: {filteredRows.length}</small>
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
      </div> : null}

      {error ? <p className="form-error">{error}</p> : null}
      {fbsPricingNotice ? <p className="form-success">{fbsPricingNotice}</p> : null}

      {!clientId ? <p className="panel-message">Выберите клиента, чтобы настроить его услуги.</p> : null}
      {clientId ? (
        <>
          {section !== 'fbo' ? <section className="fbs-pricing-modes">
            <div className={`fbs-pricing-default${!fbsTurnkey?.enabled && !fbsTurnkey?.fixedPlusLogisticsEnabled ? ' is-active' : ''}`}>
              <Calculator size={20} aria-hidden="true" />
              <div>
                <strong>Калькулятор FBS</strong>
                <span>Работает автоматически, когда оба фиксированных режима выключены.</span>
              </div>
              <em>{!fbsTurnkey?.enabled && !fbsTurnkey?.fixedPlusLogisticsEnabled ? 'Активен' : 'Не выбран'}</em>
            </div>

            <section className={`fbs-turnkey-card${fbsTurnkey?.enabled ? ' is-enabled' : ''}`}>
              <div className="fbs-turnkey-card__icon" aria-hidden="true">
                <PackageCheck size={22} />
              </div>
              <div className="fbs-turnkey-card__copy">
                <strong>FBS под ключ</strong>
                <span>
                  Итог: количество отгруженных единиц × фиксированная цена.
                  Логистика и остальные услуги отдельно не добавляются.
                </span>
              </div>
              <label className="fbs-turnkey-card__toggle">
                <input
                  checked={fbsTurnkey?.enabled ?? false}
                  disabled={!fbsTurnkey || isLoading}
                  type="checkbox"
                  onChange={(event) => setFbsTurnkey((current) => current
                    ? {
                        ...current,
                        enabled: event.target.checked,
                        fixedPlusLogisticsEnabled: event.target.checked
                          ? false
                          : current.fixedPlusLogisticsEnabled,
                        tieredLogisticsEnabled: event.target.checked
                          ? false
                          : current.tieredLogisticsEnabled,
                        dirty: true,
                      }
                    : current)}
                />
                <span>{fbsTurnkey?.enabled ? 'Включено' : 'Выключено'}</span>
              </label>
              <label className="fbs-turnkey-card__price">
                <span>Цена за 1 единицу, ₽</span>
                <input
                  min="0"
                  step="0.01"
                  type="number"
                  value={fbsTurnkey?.unitPriceInput ?? ''}
                  disabled={!fbsTurnkey || isLoading}
                  onChange={(event) => setFbsTurnkey((current) => current
                    ? { ...current, unitPriceInput: event.target.value, dirty: true }
                    : current)}
                />
                <small>Например: 100 ед. × 50 ₽ = 5 000 ₽</small>
              </label>
            </section>

            <section className={`fbs-turnkey-card fbs-turnkey-card--logistics${fbsTurnkey?.fixedPlusLogisticsEnabled ? ' is-enabled' : ''}`}>
              <div className="fbs-turnkey-card__icon" aria-hidden="true">
                <Truck size={22} />
              </div>
              <div className="fbs-turnkey-card__copy">
                <strong>Фикс + логистика</strong>
                <span>
                  Итог: количество × фиксированная обработка + рассчитанная
                  логистика в выбранный город с налогом.
                </span>
              </div>
              <label className="fbs-turnkey-card__toggle">
                <input
                  checked={fbsTurnkey?.fixedPlusLogisticsEnabled ?? false}
                  disabled={!fbsTurnkey || isLoading}
                  type="checkbox"
                  onChange={(event) => setFbsTurnkey((current) => current
                    ? {
                        ...current,
                        fixedPlusLogisticsEnabled: event.target.checked,
                        enabled: event.target.checked ? false : current.enabled,
                        dirty: true,
                      }
                    : current)}
                />
                <span>{fbsTurnkey?.fixedPlusLogisticsEnabled ? 'Включено' : 'Выключено'}</span>
              </label>
              <div className="fbs-turnkey-card__settings">
                <label className="fbs-turnkey-card__price">
                  <span>Фикс за 1 единицу, ₽</span>
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={fbsTurnkey?.fixedPlusLogisticsUnitPriceInput ?? ''}
                    disabled={!fbsTurnkey || isLoading}
                    onChange={(event) => setFbsTurnkey((current) => current
                      ? {
                          ...current,
                          fixedPlusLogisticsUnitPriceInput: event.target.value,
                          dirty: true,
                        }
                      : current)}
                  />
                  <small>Например: 100 ед. × 50 ₽ + логистика</small>
                </label>
                <label className="fbs-turnkey-card__destination">
                  <span>Город логистики</span>
                  <input
                    list="fbs-fixed-logistics-destinations"
                    placeholder="Начните вводить город"
                    value={fbsTurnkey?.fixedPlusLogisticsDestination ?? ''}
                    disabled={!fbsTurnkey || isLoading}
                    onChange={(event) => setFbsTurnkey((current) => current
                      ? {
                          ...current,
                          fixedPlusLogisticsDestination: event.target.value,
                          dirty: true,
                        }
                      : current)}
                  />
                  <datalist id="fbs-fixed-logistics-destinations">
                    {fbsDestinations.map((destination) => (
                      <option key={destination} value={destination} />
                    ))}
                  </datalist>
                  <small>Используется активный тариф WMS выбранного города.</small>
                </label>
              </div>
            </section>

            <section className={`fbs-turnkey-card fbs-turnkey-card--logistics${fbsTurnkey?.tieredLogisticsEnabled ? ' is-enabled' : ''}`}>
              <div className="fbs-turnkey-card__icon" aria-hidden="true">
                <Truck size={22} />
              </div>
              <div className="fbs-turnkey-card__copy">
                <strong>Ступенчатая логистика FBS</strong>
                <span>
                  До указанного количества товаров логистика бесплатна. Затем WMS считает
                  общий объём отправок за день: до 1 м³ — цена за куб, свыше — цена за каждую паллету.
                </span>
              </div>
              <label className="fbs-turnkey-card__toggle">
                <input
                  checked={fbsTurnkey?.tieredLogisticsEnabled ?? false}
                  disabled={!fbsTurnkey || isLoading}
                  type="checkbox"
                  onChange={(event) => setFbsTurnkey((current) => current
                    ? {
                        ...current,
                        tieredLogisticsEnabled: event.target.checked,
                        enabled: event.target.checked ? false : current.enabled,
                        dirty: true,
                      }
                    : current)}
                />
                <span>{fbsTurnkey?.tieredLogisticsEnabled ? 'Включено' : 'Выключено'}</span>
              </label>
              <div className="fbs-turnkey-card__settings">
                <PrimaryProcessingPriceField
                  label="Бесплатно до, шт."
                  value={fbsTurnkey?.logisticsFreeItemsLimitInput ?? ''}
                  disabled={!fbsTurnkey || isLoading}
                  onChange={(value) => setFbsTurnkey((current) => current
                    ? { ...current, logisticsFreeItemsLimitInput: value, dirty: true }
                    : current)}
                />
                <PrimaryProcessingPriceField
                  label="Объём одного куба, л"
                  value={fbsTurnkey?.logisticsCubicMeterLitersInput ?? ''}
                  disabled={!fbsTurnkey || isLoading}
                  onChange={(value) => setFbsTurnkey((current) => current
                    ? { ...current, logisticsCubicMeterLitersInput: value, dirty: true }
                    : current)}
                />
                <PrimaryProcessingPriceField
                  label="Цена до 1 м³, ₽"
                  value={fbsTurnkey?.logisticsCubicMeterPriceInput ?? ''}
                  disabled={!fbsTurnkey || isLoading}
                  onChange={(value) => setFbsTurnkey((current) => current
                    ? { ...current, logisticsCubicMeterPriceInput: value, dirty: true }
                    : current)}
                />
                <PrimaryProcessingPriceField
                  label="Цена каждой паллеты, ₽"
                  value={fbsTurnkey?.logisticsPalletPriceInput ?? ''}
                  disabled={!fbsTurnkey || isLoading}
                  onChange={(value) => setFbsTurnkey((current) => current
                    ? { ...current, logisticsPalletPriceInput: value, dirty: true }
                    : current)}
                />
              </div>
              <small className="fbs-turnkey-card__hint">
                По умолчанию: до 20 шт. — 0 ₽; до 1 м³ — 1 500 ₽; больше 1 м³ — 2 500 ₽ за каждую паллету.
                Объём берётся из карточек товаров клиента.
              </small>
            </section>

            <section className={`fbs-turnkey-card fbs-turnkey-card--primary${fbsTurnkey?.primaryProcessingEnabled ? ' is-enabled' : ''}`}>
              <div className="fbs-turnkey-card__icon" aria-hidden="true">
                <PackageCheck size={22} />
              </div>
              <div className="fbs-turnkey-card__copy">
                <strong>Считать первичную обработку заказа</strong>
                <span>
                  Вид прихода определяется по префиксу короба из общих настроек
                  WMS: «белый приход» или «серый приход». Возвраты определяются
                  отдельно. Перемаркировка начисляется по фактическим заданиям FBS.
                </span>
              </div>
              <label className="fbs-turnkey-card__toggle">
                <input
                  checked={fbsTurnkey?.primaryProcessingEnabled ?? false}
                  disabled={!fbsTurnkey || isLoading}
                  type="checkbox"
                  onChange={(event) => setFbsTurnkey((current) => current
                    ? {
                        ...current,
                        primaryProcessingEnabled: event.target.checked,
                        dirty: true,
                      }
                    : current)}
                />
                <span>{fbsTurnkey?.primaryProcessingEnabled ? 'Включено' : 'Выключено'}</span>
              </label>
              <div className="fbs-turnkey-card__settings">
                <PrimaryProcessingPriceField
                  label="В белую, ₽/шт."
                  value={fbsTurnkey?.primaryWhiteUnitPriceInput ?? ''}
                  disabled={!fbsTurnkey || isLoading}
                  onChange={(value) => setFbsTurnkey((current) =>
                    current
                      ? { ...current, primaryWhiteUnitPriceInput: value, dirty: true }
                      : current)}
                />
                <PrimaryProcessingPriceField
                  label="В серую, ₽/шт."
                  value={fbsTurnkey?.primaryGrayUnitPriceInput ?? ''}
                  disabled={!fbsTurnkey || isLoading}
                  onChange={(value) => setFbsTurnkey((current) =>
                    current
                      ? { ...current, primaryGrayUnitPriceInput: value, dirty: true }
                      : current)}
                />
                <PrimaryProcessingPriceField
                  label="Возврат, ₽/шт."
                  value={fbsTurnkey?.primaryReturnUnitPriceInput ?? ''}
                  disabled={!fbsTurnkey || isLoading}
                  onChange={(value) => setFbsTurnkey((current) =>
                    current
                      ? { ...current, primaryReturnUnitPriceInput: value, dirty: true }
                      : current)}
                />
              </div>
              <div className="fbs-pricing__service-picker">
                <span>
                  Что входит в первичную обработку. Для разных отрезов укажите признаки из названия,
                  артикула или размера товара через точку с запятой; пустое поле означает «для всех товаров».
                </span>
                <div>
                  {primaryServiceRows.map((row) => {
                      const selected = fbsTurnkey?.primaryServices.find(
                        (selection) => selection.serviceId === row.service.id,
                      );
                      return (
                        <label className={selected ? 'is-selected' : undefined} key={row.service.id}>
                          <input
                            checked={Boolean(selected)}
                            type="checkbox"
                            onChange={(event) => setFbsTurnkey((current) => current
                              ? {
                                  ...current,
                                  primaryServices: event.target.checked
                                    ? [...current.primaryServices, {
                                        serviceId: row.service.id,
                                        quantityMultiplier: 1,
                                        matchKeywords: '',
                                      }]
                                    : current.primaryServices.filter((item) => item.serviceId !== row.service.id),
                                  dirty: true,
                                }
                              : current)}
                          />
                          <span>
                            <strong>{row.service.name}</strong>
                            <small>{row.service.code} · {Number(row.priceRub ?? 0).toLocaleString('ru-RU')} ₽ за отрез/шт.</small>
                            {selected ? (
                              <input
                                className="fbs-pricing__match"
                                placeholder="Как распознать: 3 м; отрез 3м"
                                type="text"
                                value={selected.matchKeywords}
                                onChange={(event) => setFbsTurnkey((current) => current
                                  ? {
                                      ...current,
                                      primaryServices: current.primaryServices.map((item) =>
                                        item.serviceId === row.service.id
                                          ? { ...item, matchKeywords: event.target.value }
                                          : item),
                                      dirty: true,
                                    }
                                  : current)}
                              />
                            ) : null}
                          </span>
                          {selected ? (
                            <input
                              aria-label={`Количество услуги ${row.service.name} на одну единицу товара`}
                              min="0.001"
                              step="0.001"
                              type="number"
                              value={selected.quantityMultiplier}
                              onChange={(event) => setFbsTurnkey((current) => current
                                ? {
                                    ...current,
                                    primaryServices: current.primaryServices.map((item) =>
                                      item.serviceId === row.service.id
                                        ? { ...item, quantityMultiplier: Math.max(0.001, Number(event.target.value) || 1) }
                                        : item),
                                    dirty: true,
                                  }
                                : current)}
                            />
                          ) : null}
                        </label>
                      );
                    })}
                  {primaryServiceRows.length === 0 ? (
                    <p>Сначала подключите клиенту услугу и задайте цену за один отрез/штуку.</p>
                  ) : null}
                </div>
              </div>
              <small className="fbs-turnkey-card__hint">
                {requiresDetailedPrimaryRates
                  ? 'Для ИП Лукина обязательны три раздельные положительные цены: «в белую», «в серую» и «возврат». '
                  : 'Для этого клиента три раздельные цены необязательны; если они не заполнены, WMS попросит подтверждение при сохранении. '}
                Перемаркировка: количество берётся из общих FBS-заказов,
                цена — из подключённой услуги клиента «Перемаркировка».
              </small>
            </section>

            <div className="fbs-pricing-modes__footer">
              <span>Режимы «Под ключ» и «Фикс + логистика» взаимоисключающие.</span>
              <button
                className="primary-button"
                disabled={!fbsTurnkey?.dirty || isSavingFbsTurnkey}
                type="button"
                onClick={() => void saveFbsTurnkey()}
              >
                <Save size={16} aria-hidden="true" />
                <span>{isSavingFbsTurnkey ? 'Сохраняю' : 'Сохранить режим расчёта'}</span>
              </button>
            </div>
          </section> : null}

          {section !== 'fbs' ? <>
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
          </> : null}
        </>
      ) : null}
    </section>
  );
}

function isLukinClient(client: ClientSummary | null) {
  if (!client) return false;
  return `${client.code} ${client.name}`
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .includes('лукин');
}

function PrimaryProcessingPriceField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="fbs-turnkey-card__price">
      <span>{label}</span>
      <input
        min="0"
        step="0.01"
        type="number"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
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
