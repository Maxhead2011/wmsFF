import {
  BarChart3,
  Boxes,
  CheckCircle2,
  DollarSign,
  Eye,
  KeyRound,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Warehouse,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  connectAnalyticsApi,
  fetchAnalyticsClients,
  fetchAnalyticsDashboard,
  syncAnalyticsDashboard,
  type AnalyticsClientSummary,
  type AnalyticsDashboard,
  type AnalyticsProduct,
  type AuthSession,
} from '../../lib/api';
import './analytics.css';

type AnalyticsPanelProps = { session: AuthSession };
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

const periods: Array<{ value: 7 | 30 | 90; label: string }> = [
  { value: 7, label: '7 дней' },
  { value: 30, label: '30 дней' },
  { value: 90, label: '90 дней' },
];

const availabilityOptions = [
  { value: 'all', label: 'Все товары' },
  { value: 'outOfStock', label: 'Нет остатков' },
  { value: 'deficient', label: 'Дефицит' },
  { value: 'balanced', label: 'Сбалансированные' },
  { value: 'actual', label: 'Продаются хорошо' },
  { value: 'nonActual', label: 'Слабые продажи' },
  { value: 'nonLiquid', label: 'Неликвид' },
];

export function AnalyticsPanel({ session }: AnalyticsPanelProps) {
  const [clients, setClients] = useState<AnalyticsClientSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [dashboard, setDashboard] = useState<AnalyticsDashboard | null>(null);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [periodDays, setPeriodDays] = useState<7 | 30 | 90>(30);
  const [search, setSearch] = useState('');
  const [availability, setAvailability] = useState('all');
  const [isSyncing, setSyncing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [isConnecting, setConnecting] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<AnalyticsProduct | null>(null);

  useEffect(() => {
    void loadClients();
  }, []);

  useEffect(() => {
    if (selectedClientId) void loadDashboard(selectedClientId);
  }, [selectedClientId]);

  async function loadClients(preferredClientId?: string) {
    setStatus('loading');
    setError('');
    try {
      const nextClients = await fetchAnalyticsClients(session.accessToken);
      setClients(nextClients);
      const nextClientId =
        preferredClientId && nextClients.some((client) => client.id === preferredClientId)
          ? preferredClientId
          : selectedClientId && nextClients.some((client) => client.id === selectedClientId)
            ? selectedClientId
            : nextClients[0]?.id || '';
      setSelectedClientId(nextClientId);
      if (!nextClientId) setStatus('ready');
    } catch (caught) {
      setStatus('error');
      setError(errorMessage(caught));
    }
  }

  async function loadDashboard(clientId = selectedClientId) {
    if (!clientId) return;
    setStatus('loading');
    setError('');
    try {
      const nextDashboard = await fetchAnalyticsDashboard(session.accessToken, clientId);
      setDashboard(nextDashboard);
      if (nextDashboard.sync?.periodDays && [7, 30, 90].includes(nextDashboard.sync.periodDays)) {
        setPeriodDays(nextDashboard.sync.periodDays as 7 | 30 | 90);
      }
      setStatus('ready');
    } catch (caught) {
      setStatus('error');
      setError(errorMessage(caught));
    }
  }

  async function sync() {
    if (!selectedClientId) return;
    setSyncing(true);
    setError('');
    setMessage('');
    try {
      const nextDashboard = await syncAnalyticsDashboard(session.accessToken, selectedClientId, periodDays);
      setDashboard(nextDashboard);
      setMessage(`Данные Wildberries обновлены за ${periodDays} дней.`);
      await loadClients(selectedClientId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSyncing(false);
    }
  }

  async function connect() {
    if (!selectedClientId || !apiKey.trim()) return;
    setConnecting(true);
    setError('');
    setMessage('');
    try {
      const result = await connectAnalyticsApi(session.accessToken, selectedClientId, apiKey.trim());
      setApiKey('');
      setMessage(`Подключён кабинет WB: ${result.accountName || 'Wildberries'}. Теперь можно загрузить аналитику.`);
      await loadClients(selectedClientId);
      await loadDashboard(selectedClientId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setConnecting(false);
    }
  }

  const products = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    return (dashboard?.products.items ?? []).filter((product) => {
      if (availability !== 'all') {
        if (availability === 'outOfStock' ? product.stockCount > 0 : product.availability !== availability) return false;
      }
      if (!query) return true;
      return [product.name, product.vendorCode, product.brandName, product.subjectName, product.nmId]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(query));
    });
  }, [availability, dashboard, search]);

  const topProducts = useMemo(
    () => [...(dashboard?.products.items ?? [])].sort((left, right) => right.orderSum - left.orderSum).slice(0, 8),
    [dashboard],
  );
  const maxTopRevenue = Math.max(1, ...topProducts.map((product) => product.orderSum));
  const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null;
  const canManageConnection = dashboard?.access.canManageConnection ?? session.user.permissionCodes.includes('system:admin');

  if (status === 'loading' && !dashboard) {
    return <AnalyticsNotice icon={RefreshCw} title="Загружаю аналитику" text="Получаем быстрый срез из отдельной аналитической базы." spin />;
  }

  if (clients.length === 0 && status !== 'loading') {
    return <AnalyticsNotice icon={ShieldCheck} title="Нет доступных клиентов" text="Назначьте клиентский доступ этому логину в профиле пользователя." />;
  }

  return (
    <section className="analytics-panel" aria-label="Аналитика Wildberries">
      <header className="analytics-hero">
        <div className="analytics-hero__glow" />
        <div className="analytics-hero__title">
          <span className="analytics-hero__icon"><Sparkles size={23} aria-hidden="true" /></span>
          <div>
            <p>LOGOFF INTELLIGENCE</p>
            <h2>Аналитика товаров и остатков</h2>
            <span>Продажи, воронка, дефицит, неликвид и сравнение остатков WB с WMS.</span>
          </div>
        </div>
        <div className="analytics-hero__controls">
          <label>
            <span>Клиент</span>
            <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
          <label>
            <span>Период</span>
            <select value={periodDays} onChange={(event) => setPeriodDays(Number(event.target.value) as 7 | 30 | 90)}>
              {periods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
            </select>
          </label>
          <button className="analytics-sync-button" type="button" disabled={!dashboard?.connection.connected || isSyncing} onClick={() => void sync()}>
            <RefreshCw className={isSyncing ? 'spin' : ''} size={17} aria-hidden="true" />
            {isSyncing ? 'Получаю данные' : 'Обновить WB'}
          </button>
        </div>
        <div className="analytics-hero__status">
          <span className={dashboard?.connection.connected ? 'ready' : 'missing'}>
            {dashboard?.connection.connected ? <CheckCircle2 size={15} /> : <TriangleAlert size={15} />}
            {dashboard?.connection.connected ? dashboard.connection.accountName || 'WB подключён' : 'API не подключён'}
          </span>
          <span>Данные: {dashboard?.sync?.lastSyncedAt ? formatDateTime(dashboard.sync.lastSyncedAt) : 'ещё не загружались'}</span>
          <span>Хранилище: отдельная база аналитики</span>
        </div>
      </header>

      {error ? <div className="analytics-alert analytics-alert--error"><TriangleAlert size={17} />{error}</div> : null}
      {message ? <div className="analytics-alert analytics-alert--success"><CheckCircle2 size={17} />{message}</div> : null}
      {dashboard?.sync?.lastError ? <div className="analytics-alert analytics-alert--warning"><TriangleAlert size={17} />{dashboard.sync.lastError}</div> : null}

      {!dashboard?.connection.connected ? (
        <section className="analytics-empty-source">
          <KeyRound size={30} aria-hidden="true" />
          <div>
            <h3>Подключите ключ категории «Аналитика» Wildberries</h3>
            <p>Ключ хранится зашифрованным в отдельной базе и никогда не отправляется в браузер после сохранения.</p>
          </div>
          {canManageConnection ? (
            <div className="analytics-key-form">
              <input type="password" autoComplete="off" placeholder="Вставьте API-ключ WB" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
              <button type="button" disabled={isConnecting || !apiKey.trim()} onClick={() => void connect()}>{isConnecting ? 'Проверяю' : 'Подключить'}</button>
            </div>
          ) : <strong>Обратитесь к администратору WMS.</strong>}
        </section>
      ) : null}

      {dashboard && dashboard.sync ? (
        <>
          <section className="analytics-kpis" aria-label="Ключевые показатели">
            <MetricCard icon={DollarSign} label="Заказы, сумма" value={money(dashboard.totals.ordersSum, dashboard.sync.currency)} detail={`${integer(dashboard.totals.orders)} заказов`} tone="violet" />
            <MetricCard icon={PackageCheck} label="Выкупы" value={`${decimal(dashboard.totals.buyoutPercent)}%`} detail={money(dashboard.totals.buyoutsSum, dashboard.sync.currency)} tone="green" />
            <MetricCard icon={Warehouse} label="Остаток на WB" value={`${integer(dashboard.totals.wbStock)} шт.`} detail={`${integer(dashboard.totals.products)} карточек`} tone="blue" />
              <MetricCard
                icon={Boxes}
                label="Остаток в LOGOFF"
                value={`${integer(dashboard.totals.wmsStock)} шт.`}
                detail={`Связано с WB: ${integer(dashboard.totals.wmsMatchedStock)} · вне отчёта WB: ${integer(dashboard.totals.wmsUnlinkedStock)}`}
                tone="cyan"
              />
            <MetricCard icon={TriangleAlert} label="Упущенные заказы" value={money(dashboard.totals.lostOrdersSum, dashboard.sync.currency)} detail={`${dashboard.totals.outOfStock} без остатка · ${dashboard.totals.lowStock} дефицит`} tone="orange" />
          </section>

          <div className="analytics-grid analytics-grid--insights">
            <section className="analytics-card analytics-recommendations">
              <div className="analytics-card__heading">
                <div><TrendingUp size={18} /><span><strong>Что требует внимания</strong><small>Автоматические действия по товарам</small></span></div>
                <span className="analytics-count">{dashboard.recommendations.length}</span>
              </div>
              {dashboard.recommendations.length ? (
                <div className="analytics-recommendation-list">
                  {dashboard.recommendations.slice(0, 10).map((item) => (
                    <button key={`${item.kind}:${item.nmId}`} className={`analytics-recommendation severity-${item.severity.toLowerCase()}`} type="button" onClick={() => setSelectedProduct(dashboard.products.items.find((product) => product.nmId === item.nmId) ?? null)}>
                      <span className="analytics-recommendation__marker" />
                      <span><strong>{item.name}</strong><small>{item.message}</small></span>
                      <em>{recommendationValue(item.kind, item.value, dashboard.sync?.currency || 'RUB')}</em>
                    </button>
                  ))}
                </div>
              ) : <AnalyticsEmpty text="Критических отклонений по загруженным товарам нет." />}
            </section>

            <section className="analytics-card analytics-top-chart">
              <div className="analytics-card__heading">
                <div><BarChart3 size={18} /><span><strong>Лидеры по заказам</strong><small>Сумма заказов за выбранный период</small></span></div>
              </div>
              <div className="analytics-bars">
                {topProducts.map((product, index) => (
                  <button type="button" key={product.nmId} onClick={() => setSelectedProduct(product)}>
                    <span className="analytics-bars__rank">{index + 1}</span>
                    <span className="analytics-bars__label"><strong>{product.name}</strong><small>{product.vendorCode || `WB ${product.nmId}`}</small></span>
                    <span className="analytics-bars__track"><i style={{ width: `${Math.max(3, (product.orderSum / maxTopRevenue) * 100)}%` }} /></span>
                    <em>{compactMoney(product.orderSum, dashboard.sync?.currency || 'RUB')}</em>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <section className="analytics-card analytics-products">
            <div className="analytics-card__heading analytics-products__heading">
              <div><ShoppingCart size={18} /><span><strong>Товары</strong><small>Продажи, конверсия и остатки WB / LOGOFF</small></span></div>
              <div className="analytics-products__filters">
                <label className="analytics-search"><Search size={16} /><input placeholder="Товар, артикул или nmID" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
                <select value={availability} onChange={(event) => setAvailability(event.target.value)}>{availabilityOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
                <span>{products.length}</span>
              </div>
            </div>
            <div className="analytics-table-wrap">
              <table className="analytics-table">
                <thead><tr><th>Товар</th><th>Статус</th><th>Заказы</th><th>Сумма</th><th>Конверсия</th><th>Выкуп</th><th>WB</th><th>LOGOFF</th><th>Динамика</th></tr></thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.nmId} onClick={() => setSelectedProduct(product)}>
                      <td><ProductIdentity product={product} /></td>
                      <td><AvailabilityBadge value={product.stockCount <= 0 ? 'outOfStock' : product.availability} /></td>
                      <td>{integer(product.orderCount)}</td>
                      <td>{money(product.orderSum, dashboard.sync?.currency || 'RUB')}</td>
                      <td>{decimal(product.cartToOrderPercent)}%</td>
                      <td>{decimal(product.funnelBuyoutPercent)}%</td>
                      <td><strong>{integer(product.stockCount)}</strong></td>
                      <td><strong>{integer(product.wmsStock)}</strong></td>
                      <td><DynamicValue value={product.orderCountDynamic} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!products.length ? <AnalyticsEmpty text="По выбранным фильтрам товары не найдены." /> : null}
          </section>

          <div className="analytics-grid analytics-grid--bottom">
            <section className="analytics-card">
              <div className="analytics-card__heading"><div><Warehouse size={18} /><span><strong>Регионы и склады WB</strong><small>Остатки и движение к покупателю</small></span></div></div>
              {dashboard.regions.length ? (
                <div className="analytics-region-list">
                  {dashboard.regions.slice(0, 14).map((region, index) => (
                    <div key={`${region.officeId || 'region'}:${region.regionName}:${index}`}>
                      <span><strong>{region.officeName || region.regionName}</strong><small>{region.officeName ? region.regionName : 'Регион'}</small></span>
                      <span><strong>{integer(region.stockCount)} шт.</strong><small>к клиенту {integer(region.toClientCount)} · возврат {integer(region.fromClientCount)}</small></span>
                    </div>
                  ))}
                </div>
              ) : <AnalyticsEmpty text="Детализация по регионам недоступна этому ключу WB; показатели товаров работают." />}
            </section>

            {canManageConnection ? (
              <section className="analytics-card analytics-source-admin">
                <div className="analytics-card__heading"><div><KeyRound size={18} /><span><strong>Подключение источника</strong><small>Только для администратора</small></span></div></div>
                <p>Клиент: <strong>{selectedClient?.name}</strong></p>
                <p>Кабинет WB: <strong>{dashboard.connection.accountName || 'не определён'}</strong></p>
                <p>Ключ проверен: <strong>{dashboard.connection.lastVerifiedAt ? formatDateTime(dashboard.connection.lastVerifiedAt) : '—'}</strong></p>
                <div className="analytics-key-form analytics-key-form--inline">
                  <input type="password" autoComplete="off" placeholder="Новый API-ключ WB" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
                  <button type="button" disabled={isConnecting || !apiKey.trim()} onClick={() => void connect()}>{isConnecting ? 'Проверяю' : 'Заменить ключ'}</button>
                </div>
                <small><ShieldCheck size={14} /> Ключ зашифрован AES-256-GCM и не возвращается через API.</small>
              </section>
            ) : null}
          </div>
        </>
      ) : dashboard?.connection.connected ? (
        <section className="analytics-first-sync">
          <BarChart3 size={34} />
          <h3>Источник подключён. Загрузите первый срез аналитики.</h3>
          <p>Будут собраны карточки, продажи, воронка, остатки и рекомендации за выбранный период.</p>
          <button type="button" disabled={isSyncing} onClick={() => void sync()}><RefreshCw className={isSyncing ? 'spin' : ''} size={17} />{isSyncing ? 'Получаю данные WB' : 'Загрузить аналитику'}</button>
        </section>
      ) : null}

      {selectedProduct ? <ProductModal product={selectedProduct} currency={dashboard?.sync?.currency || 'RUB'} onClose={() => setSelectedProduct(null)} /> : null}
    </section>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone }: { icon: typeof DollarSign; label: string; value: string; detail: string; tone: string }) {
  return <article className={`analytics-metric tone-${tone}`}><span><Icon size={19} /></span><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></article>;
}

function ProductIdentity({ product }: { product: AnalyticsProduct }) {
  return <div className="analytics-product-identity">{product.photoUrl ? <img src={product.photoUrl} alt="" loading="lazy" /> : <span><Boxes size={18} /></span>}<div><strong>{product.name}</strong><small>{product.vendorCode || 'Без артикула'} · WB {product.nmId}</small></div></div>;
}

function AvailabilityBadge({ value }: { value: string | null }) {
  return <span className={`analytics-availability availability-${value || 'unknown'}`}>{availabilityLabel(value)}</span>;
}

function DynamicValue({ value }: { value: number }) {
  const className = value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
  return <span className={`analytics-dynamic ${className}`}>{value > 0 ? '+' : ''}{decimal(value)}%</span>;
}

function ProductModal({ product, currency, onClose }: { product: AnalyticsProduct; currency: string; onClose: () => void }) {
  return (
    <div className="analytics-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="analytics-product-modal" role="dialog" aria-modal="true" aria-label={product.name}>
        <button className="analytics-modal-close" type="button" onClick={onClose}><X size={19} /></button>
        <ProductIdentity product={product} />
        <div className="analytics-product-modal__badges"><AvailabilityBadge value={product.stockCount <= 0 ? 'outOfStock' : product.availability} /><DynamicValue value={product.orderCountDynamic} /></div>
        <div className="analytics-product-modal__metrics">
          <span><small>Заказы</small><strong>{integer(product.orderCount)}</strong><em>{money(product.orderSum, currency)}</em></span>
          <span><small>Просмотры</small><strong>{integer(product.openCount)}</strong><em>корзина {integer(product.cartCount)}</em></span>
          <span><small>Конверсия</small><strong>{decimal(product.cartToOrderPercent)}%</strong><em>в корзину {decimal(product.addToCartPercent)}%</em></span>
          <span><small>Выкуп</small><strong>{decimal(product.funnelBuyoutPercent)}%</strong><em>{integer(product.funnelBuyoutCount)} шт.</em></span>
          <span><small>Остаток WB</small><strong>{integer(product.stockCount)}</strong><em>{money(product.stockSum, currency)}</em></span>
          <span><small>Остаток LOGOFF</small><strong>{integer(product.wmsStock)}</strong><em>{product.wmsSkuCount} SKU</em></span>
          <span><small>Упущено</small><strong>{money(product.lostOrdersSum, currency)}</strong><em>{decimal(product.lostOrdersCount)} заказа</em></span>
          <span><small>Оборачиваемость</small><strong>{product.turnoverDays === null ? '—' : `${decimal(product.turnoverDays)} дн.`}</strong><em>скорость {product.saleRateDays === null ? '—' : `${decimal(product.saleRateDays)} дн.`}</em></span>
        </div>
      </section>
    </div>
  );
}

function AnalyticsNotice({ icon: Icon, title, text, spin = false }: { icon: typeof RefreshCw; title: string; text: string; spin?: boolean }) {
  return <div className="analytics-notice"><Icon className={spin ? 'spin' : ''} size={28} /><h2>{title}</h2><p>{text}</p></div>;
}

function AnalyticsEmpty({ text }: { text: string }) {
  return <div className="analytics-empty"><Eye size={20} /><span>{text}</span></div>;
}

function recommendationValue(kind: string, value: number, currency: string) {
  if (kind === 'OUT_OF_STOCK') return compactMoney(value, currency);
  if (kind === 'LOW_CONVERSION' || kind === 'GROWTH') return `${decimal(value)}%`;
  return `${integer(value)} шт.`;
}

function availabilityLabel(value: string | null) {
  return ({ outOfStock: 'Нет остатка', deficient: 'Дефицит', actual: 'Хорошо продаётся', balanced: 'Баланс', nonActual: 'Слабые продажи', nonLiquid: 'Неликвид', invalidData: 'Нет данных' } as Record<string, string>)[value || ''] || 'Без оценки';
}

function money(value: number, currency = 'RUB') {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value || 0);
}

function compactMoney(value: number, currency = 'RUB') {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}

function integer(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value || 0);
}

function decimal(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value || 0);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось загрузить аналитику.';
}
