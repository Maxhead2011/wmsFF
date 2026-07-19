import {
  AlertTriangle,
  Archive,
  BadgeRussianRuble,
  Boxes,
  CircleCheckBig,
  Clock3,
  Link2,
  PackageCheck,
  PlugZap,
  RefreshCw,
  Search,
  ShoppingBasket,
  Truck,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createFbsMarketplaceConnection,
  fetchClients,
  fetchFbsOrders,
  type AuthSession,
  type ClientFbsOrders,
  type ClientSummary,
  type FbsOrderSummary,
} from '../../lib/api';
import './fbs.css';

type FbsPanelProps = {
  session: AuthSession;
};

type FbsView = 'active' | 'shipped' | 'cost' | 'archive';
type OrdersState =
  | { status: 'idle'; data: null; error: '' }
  | { status: 'loading'; data: ClientFbsOrders | null; error: '' }
  | { status: 'ready'; data: ClientFbsOrders; error: '' }
  | { status: 'error'; data: ClientFbsOrders | null; error: string };

const fbsViews = [
  {
    id: 'active' as const,
    title: 'Активные заказы по FBS',
    description: 'Новые заказы, сборка, упаковка и готовность к передаче.',
    icon: ShoppingBasket,
    accent: 'red',
  },
  {
    id: 'shipped' as const,
    title: 'Отгруженные',
    description: 'Переданные заказы со статусами, автоматически получаемыми из API.',
    icon: Truck,
    accent: 'green',
  },
  {
    id: 'cost' as const,
    title: 'Стоимость обработки FBS',
    description: 'Отгруженные заказы, тарифы, начисления и выставленные счета.',
    icon: BadgeRussianRuble,
    accent: 'amber',
  },
  {
    id: 'archive' as const,
    title: 'Архив',
    description: 'Завершённые и отменённые заказы.',
    icon: Archive,
    accent: 'slate',
  },
];

export function FbsPanel({ session }: FbsPanelProps) {
  const [activeView, setActiveView] = useState<FbsView>('active');
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useState(
    session.user.clientIds.length === 1 ? session.user.clientIds[0] : '',
  );
  const [search, setSearch] = useState('');
  const [ordersState, setOrdersState] = useState<OrdersState>({ status: 'idle', data: null, error: '' });
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionMarketplace, setConnectionMarketplace] = useState<'WILDBERRIES' | 'OZON'>('WILDBERRIES');
  const [connectionName, setConnectionName] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [isConnecting, setConnecting] = useState(false);
  const loadSequence = useRef(0);

  useEffect(() => {
    let active = true;
    void fetchClients(session.accessToken)
      .then((rows) => {
        if (!active) return;
        setClients(rows);
        setSelectedClientId((current) => current || (rows.length === 1 ? rows[0].id : ''));
      })
      .catch(() => {
        if (!active) return;
        setClients([]);
      });
    return () => {
      active = false;
    };
  }, [session.accessToken]);

  const loadOrders = useCallback(
    async (refresh = false) => {
      if (!selectedClientId) {
        setOrdersState({ status: 'idle', data: null, error: '' });
        return;
      }
      const sequence = ++loadSequence.current;
      setOrdersState((current) => ({ status: 'loading', data: current.data, error: '' }));
      try {
        const data = await fetchFbsOrders(session.accessToken, selectedClientId, refresh);
        if (loadSequence.current === sequence) {
          setOrdersState({ status: 'ready', data, error: '' });
        }
      } catch (caught) {
        if (loadSequence.current === sequence) {
          setOrdersState({
            status: 'error',
            data: null,
            error: caught instanceof Error ? caught.message : 'Не удалось загрузить заказы FBS.',
          });
        }
      }
    },
    [selectedClientId, session.accessToken],
  );

  useEffect(() => {
    setConnectionOpen(false);
    setConnectionError('');
    void loadOrders();
    if (!selectedClientId) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadOrders(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadOrders, selectedClientId]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );
  const activeConfig = fbsViews.find((view) => view.id === activeView) ?? fbsViews[0];
  const data = ordersState.data;
  const tileCounts: Record<FbsView, number> = {
    active: data?.counts.active ?? 0,
    shipped: data?.counts.shipped ?? 0,
    cost: data?.counts.shipped ?? 0,
    archive: data?.counts.archive ?? 0,
  };

  async function connectMarketplace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClientId) return;
    setConnecting(true);
    setConnectionError('');
    try {
      await createFbsMarketplaceConnection(session.accessToken, {
        clientId: selectedClientId,
        marketplace: connectionMarketplace,
        accountName: connectionName.trim(),
        sellerId: connectionMarketplace === 'OZON' ? sellerId.trim() : '',
        apiKey: apiKey.trim(),
        isActive: true,
      });
      setConnectionOpen(false);
      setConnectionName('');
      setSellerId('');
      setApiKey('');
      await loadOrders(true);
    } catch (caught) {
      setConnectionError(caught instanceof Error ? caught.message : 'Не удалось подключить API маркетплейса.');
    } finally {
      setConnecting(false);
    }
  }

  return (
    <section className="fbs-panel" aria-label="FBS">
      <header className="fbs-panel__hero">
        <div className="fbs-panel__hero-icon">
          <ShoppingBasket size={24} aria-hidden="true" />
        </div>
        <div>
          <p className="eyebrow">Клиентский контур</p>
          <h2>Управление FBS</h2>
          <p>Заказы Wildberries и Ozon, складские короба, статусы отгрузки и стоимость обработки.</p>
        </div>
        <span className="fbs-panel__scope">
          {selectedClient
            ? `${selectedClient.code} · ${selectedClient.name}`
            : selectedClientId
              ? 'Клиент загружается'
              : 'Выберите клиента'}
        </span>
      </header>

      <div className="fbs-tiles" role="tablist" aria-label="Разделы FBS">
        {fbsViews.map((view, index) => {
          const Icon = view.icon;
          const isActive = activeView === view.id;
          return (
            <button
              className={`fbs-tile fbs-tile--${view.accent}${isActive ? ' is-active' : ''}`}
              key={view.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveView(view.id)}
            >
              <span className="fbs-tile__icon">
                <Icon size={22} aria-hidden="true" />
              </span>
              <span className="fbs-tile__content">
                <span className="fbs-tile__number">{index + 1}</span>
                <strong>{view.title}</strong>
                <small>{view.description}</small>
              </span>
              <span className="fbs-tile__count">{tileCounts[view.id]}</span>
            </button>
          );
        })}
      </div>

      <section className="fbs-workspace" role="tabpanel" aria-label={activeConfig.title}>
        <div className="fbs-workspace__heading">
          <div>
            <p className="eyebrow">FBS</p>
            <h3>{activeConfig.title}</h3>
            <p>{activeConfig.description}</p>
          </div>
          <div className="fbs-workspace__filters">
            {clients.length > 1 ? (
              <label>
                <span>Клиент</span>
                <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
                  <option value="">Выберите клиента</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.code} · {client.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {activeView !== 'cost' ? (
              <label className="fbs-workspace__search">
                <span>Поиск</span>
                <span>
                  <Search size={17} aria-hidden="true" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Заказ, ШК, товар или короб"
                  />
                </span>
              </label>
            ) : null}
            <button
              className="fbs-refresh-button"
              type="button"
              onClick={() => void loadOrders(true)}
              disabled={!selectedClientId || ordersState.status === 'loading'}
            >
              <RefreshCw size={16} aria-hidden="true" />
              <span>{ordersState.status === 'loading' ? 'Обновляю' : 'Обновить'}</span>
            </button>
          </div>
        </div>

        {!selectedClientId ? (
          <FbsNotice icon={Boxes} title="Выберите клиента" text="Заказы загружаются отдельно для каждого клиентского кабинета." />
        ) : ordersState.status === 'error' ? (
          <FbsNotice icon={AlertTriangle} title="Не удалось получить заказы" text={ordersState.error} tone="error" />
        ) : data && !data.connected ? (
          <FbsConnectionPrompt
            isOpen={connectionOpen}
            marketplace={connectionMarketplace}
            accountName={connectionName}
            sellerId={sellerId}
            apiKey={apiKey}
            error={connectionError}
            isSubmitting={isConnecting}
            onOpen={() => setConnectionOpen(true)}
            onCancel={() => setConnectionOpen(false)}
            onMarketplaceChange={setConnectionMarketplace}
            onAccountNameChange={setConnectionName}
            onSellerIdChange={setSellerId}
            onApiKeyChange={setApiKey}
            onSubmit={connectMarketplace}
          />
        ) : ordersState.status === 'loading' && !data ? (
          <FbsNotice icon={RefreshCw} title="Получаю заказы" text="Проверяем подключённые кабинеты Wildberries и Ozon." />
        ) : activeView === 'cost' ? (
          <FbsCostView data={data} />
        ) : (
          <FbsOrdersView data={data} view={activeView} search={search} />
        )}

        {data?.connected ? (
          <div className="fbs-source-line">
            <span>
              <Link2 size={14} aria-hidden="true" />
              {data.connections.map((connection) => marketplaceLabel(connection.marketplace)).join(', ')}
            </span>
            <span>Статусы обновлены {formatDateTime(data.fetchedAt)}</span>
            <span>Автообновление раз в минуту</span>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function FbsOrdersView({
  data,
  search,
  view,
}: {
  data: ClientFbsOrders | null;
  search: string;
  view: Exclude<FbsView, 'cost'>;
}) {
  const category = view;
  const orders = (data?.orders ?? []).filter((order) => order.category === category);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleOrders = normalizedSearch
    ? orders.filter((order) =>
        [
          order.id,
          order.orderUid,
          order.article,
          order.nmId,
          order.product?.name,
          order.product?.internalSku,
          order.supplyId,
          ...order.barcodes,
          ...order.storageBoxes.map((box) => box.code),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch)),
      )
    : orders;
  const itemsCount = visibleOrders.reduce((sum, order) => sum + Math.max(1, order.barcodes.length), 0);
  const emptyCopy = {
    active: {
      icon: Clock3,
      title: 'Активных FBS-заказов пока нет',
      text: 'Новые заказы появятся автоматически после их создания на маркетплейсе.',
    },
    shipped: {
      icon: PackageCheck,
      title: 'Отгруженных FBS-заказов пока нет',
      text: 'После передачи заказа в доставку API перенесёт его сюда и создаст строку расчёта обработки.',
    },
    archive: {
      icon: Archive,
      title: 'Архив FBS пока пуст',
      text: 'Отменённые и закрытые заказы за последние 30 дней будут храниться здесь.',
    },
  }[view];
  const EmptyIcon = emptyCopy.icon;

  return (
    <>
      <div className="fbs-order-summary">
        <article>
          <Boxes size={18} aria-hidden="true" />
          <span>Заказов</span>
          <strong>{visibleOrders.length}</strong>
        </article>
        <article>
          <ShoppingBasket size={18} aria-hidden="true" />
          <span>Товаров</span>
          <strong>{itemsCount}</strong>
        </article>
        <article>
          <CircleCheckBig size={18} aria-hidden="true" />
          <span>{view === 'active' ? 'В коробах' : 'С актуальным статусом'}</span>
          <strong>
            {view === 'active'
              ? visibleOrders.filter((order) => order.storageBoxes.length > 0).length
              : visibleOrders.length}
          </strong>
        </article>
      </div>

      <div className="fbs-table-wrap">
        <table className="fbs-table">
          <thead>
            <tr>
              <th>Заказ</th>
              <th>Товар</th>
              <th>ШК</th>
              {view === 'active' ? <th>Короб хранения</th> : null}
              <th>Статус API</th>
              <th>{view === 'active' ? 'Создан' : 'Отгрузка'}</th>
            </tr>
          </thead>
          {visibleOrders.length > 0 ? (
            <tbody>
              {visibleOrders.map((order) => (
                <FbsOrderRow key={`${order.marketplace}:${order.connectionId}:${order.id}`} order={order} showBoxes={view === 'active'} />
              ))}
            </tbody>
          ) : null}
        </table>
        {visibleOrders.length === 0 ? (
          <div className="fbs-empty">
            <span>
              <EmptyIcon size={27} aria-hidden="true" />
            </span>
            <strong>{normalizedSearch ? `По запросу «${search.trim()}» ничего не найдено` : emptyCopy.title}</strong>
            <p>{normalizedSearch ? 'Измените поисковый запрос или очистите поле.' : emptyCopy.text}</p>
          </div>
        ) : null}
      </div>
    </>
  );
}

function FbsOrderRow({ order, showBoxes }: { order: FbsOrderSummary; showBoxes: boolean }) {
  return (
    <tr>
      <td>
        <strong>№ {order.id}</strong>
        <small>{marketplaceLabel(order.marketplace)}</small>
      </td>
      <td>
        <strong>{order.product?.name || order.article || `Товар ${order.nmId ?? ''}`}</strong>
        <small>{[order.article, order.nmId ? `nmID ${order.nmId}` : null].filter(Boolean).join(' · ')}</small>
      </td>
      <td>
        <span className="fbs-mono">{order.barcodes.join(', ') || 'не передан'}</span>
      </td>
      {showBoxes ? (
        <td>
          {order.storageBoxes.length > 0 ? (
            <div className="fbs-box-list">
              {order.storageBoxes.map((box) => (
                <span key={`${box.code}:${box.status}`}>
                  {box.code} · {box.quantity} шт.
                </span>
              ))}
            </div>
          ) : (
            <span className="fbs-missing-box">На остатках короб не найден</span>
          )}
        </td>
      ) : null}
      <td>
        <span className={`fbs-status fbs-status--${order.category}`}>{order.statusLabel}</span>
        <small>{order.supplierStatus}</small>
      </td>
      <td>
        <strong>{formatDateTime(order.createdAt)}</strong>
        <small>{order.supplyId ? `Поставка ${order.supplyId}` : order.sellerDate || ''}</small>
      </td>
    </tr>
  );
}

function FbsCostView({ data }: { data: ClientFbsOrders | null }) {
  const orders = (data?.orders ?? []).filter((order) => order.category === 'shipped');
  const totalRub = orders.reduce((sum, order) => sum + Number(order.billing?.totalRub ?? 0), 0);
  const invoiced = orders.filter((order) => order.billing?.invoiceNumber);

  return (
    <>
      <div className="fbs-cost-summary">
        <article>
          <span>Заказов в обработке</span>
          <strong>{orders.length}</strong>
          <small>автоматически после отгрузки</small>
        </article>
        <article>
          <span>Выставлено в счета</span>
          <strong>{invoiced.length}</strong>
          <small>заказов FBS</small>
        </article>
        <article className="fbs-cost-summary__total">
          <span>Стоимость обработки</span>
          <strong>{formatMoney(totalRub)} ₽</strong>
          <small>по тарифу клиента</small>
        </article>
      </div>
      <div className="fbs-table-wrap">
        <table className="fbs-table">
          <thead>
            <tr>
              <th>Заказ</th>
              <th>Маркетплейс</th>
              <th>Статус заказа</th>
              <th>Начисление</th>
              <th>Счёт</th>
            </tr>
          </thead>
          {orders.length > 0 ? (
            <tbody>
              {orders.map((order) => (
                <tr key={`cost:${order.marketplace}:${order.connectionId}:${order.id}`}>
                  <td>
                    <strong>№ {order.id}</strong>
                    <small>{order.product?.name || order.article || 'Товар'}</small>
                  </td>
                  <td>{marketplaceLabel(order.marketplace)}</td>
                  <td>
                    <span className="fbs-status fbs-status--shipped">{order.statusLabel}</span>
                  </td>
                  <td>
                    <strong>{formatMoney(order.billing?.totalRub ?? 0)} ₽</strong>
                    <small>
                      {Number(order.billing?.unitPriceRub ?? 0) > 0
                        ? order.billing?.status === 'APPROVED'
                          ? 'подтверждено'
                          : 'черновик'
                        : 'нужно настроить тариф FBS'}
                    </small>
                  </td>
                  <td>
                    <strong>{order.billing?.invoiceNumber || 'не выставлен'}</strong>
                    <small>{order.billing?.invoiceStatus || ''}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          ) : null}
        </table>
        {orders.length === 0 ? (
          <div className="fbs-empty">
            <span>
              <BadgeRussianRuble size={27} aria-hidden="true" />
            </span>
            <strong>Заказов для расчёта пока нет</strong>
            <p>После статуса «Передан в доставку» заказ автоматически появится здесь.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}

function FbsConnectionPrompt({
  isOpen,
  marketplace,
  accountName,
  sellerId,
  apiKey,
  error,
  isSubmitting,
  onOpen,
  onCancel,
  onMarketplaceChange,
  onAccountNameChange,
  onSellerIdChange,
  onApiKeyChange,
  onSubmit,
}: {
  isOpen: boolean;
  marketplace: 'WILDBERRIES' | 'OZON';
  accountName: string;
  sellerId: string;
  apiKey: string;
  error: string;
  isSubmitting: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onMarketplaceChange: (value: 'WILDBERRIES' | 'OZON') => void;
  onAccountNameChange: (value: string) => void;
  onSellerIdChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!isOpen) {
    return (
      <div className="fbs-connect-empty">
        <span>
          <PlugZap size={28} aria-hidden="true" />
        </span>
        <div>
          <strong>API маркетплейса не подключён</strong>
          <p>Подключите кабинет Wildberries или Ozon, чтобы получать FBS-заказы и их статусы.</p>
        </div>
        <button className="primary-button" type="button" onClick={onOpen}>
          <PlugZap size={16} aria-hidden="true" />
          Подключить API
        </button>
      </div>
    );
  }

  return (
    <form className="fbs-connect-form" onSubmit={onSubmit}>
      <div className="fbs-connect-form__heading">
        <div>
          <p className="eyebrow">Новое подключение</p>
          <h4>API FBS</h4>
        </div>
        <button className="icon-text-button" type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
      <div className="fbs-connect-form__grid">
        <label>
          <span>Маркетплейс</span>
          <select value={marketplace} onChange={(event) => onMarketplaceChange(event.target.value as 'WILDBERRIES' | 'OZON')}>
            <option value="WILDBERRIES">Wildberries</option>
            <option value="OZON">Ozon</option>
          </select>
        </label>
        <label>
          <span>Название кабинета</span>
          <input value={accountName} onChange={(event) => onAccountNameChange(event.target.value)} placeholder="Например, основной" />
        </label>
        {marketplace === 'OZON' ? (
          <label>
            <span>Client-Id Ozon</span>
            <input value={sellerId} onChange={(event) => onSellerIdChange(event.target.value)} required />
          </label>
        ) : null}
        <label className="fbs-connect-form__key">
          <span>API-ключ</span>
          <input type="password" value={apiKey} onChange={(event) => onApiKeyChange(event.target.value)} minLength={8} required />
        </label>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={isSubmitting || apiKey.trim().length < 8}>
        <PlugZap size={16} aria-hidden="true" />
        {isSubmitting ? 'Подключаю' : `Подключить ${marketplaceLabel(marketplace)}`}
      </button>
    </form>
  );
}

function FbsNotice({
  icon: Icon,
  title,
  text,
  tone = 'neutral',
}: {
  icon: typeof Boxes;
  title: string;
  text: string;
  tone?: 'neutral' | 'error';
}) {
  return (
    <div className={`fbs-empty fbs-empty--${tone}`}>
      <span>
        <Icon size={27} aria-hidden="true" />
      </span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function marketplaceLabel(marketplace: 'WILDBERRIES' | 'OZON') {
  return marketplace === 'WILDBERRIES' ? 'Wildberries' : 'Ozon';
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}
