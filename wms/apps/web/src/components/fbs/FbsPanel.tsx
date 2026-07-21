import {
  AlertTriangle,
  Archive,
  BadgeRussianRuble,
  Boxes,
  Calculator,
  CircleCheckBig,
  Clock3,
  Download,
  FilePlus2,
  Link2,
  ListChecks,
  PackageCheck,
  PlugZap,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShoppingBasket,
  Truck,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  assembleFbsOrders,
  createFbsMarketplaceConnection,
  createFbsRequest,
  downloadFbsOrderStickersPdf,
  fetchClients,
  fetchFbsBillingSettings,
  fetchFbsOrders,
  updateFbsBillingSettings,
  type AuthSession,
  type ClientFbsOrders,
  type ClientSummary,
  type FbsBillingSettings,
  type FbsDeliveryDestination,
  type FbsOrderSummary,
  type UpdateFbsBillingSettingsPayload,
} from '../../lib/api';
import { FbsCostCalculator } from './FbsCostCalculator';
import './fbs.css';

type FbsPanelProps = {
  session: AuthSession;
};

type FbsView = 'active' | 'shipped' | 'cost' | 'calculator' | 'archive' | 'pricing';
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
    id: 'calculator' as const,
    title: 'Калькулятор стоимости',
    description: 'Предварительный расчёт обработки и доставки партии FBS.',
    icon: Calculator,
    accent: 'blue',
  },
  {
    id: 'archive' as const,
    title: 'Архив',
    description: 'Завершённые и отменённые заказы.',
    icon: Archive,
    accent: 'slate',
  },
  {
    id: 'pricing' as const,
    title: 'Назначение стоимости обработки',
    description: 'Услуги клиента, доставка, шаг доплаты и комплектация коробов.',
    icon: Settings2,
    accent: 'violet',
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
  const [selectedOrderKeys, setSelectedOrderKeys] = useState<Set<string>>(() => new Set());
  const [orderAction, setOrderAction] = useState<'assemble' | 'stickers' | 'request' | null>(null);
  const [orderActionMessage, setOrderActionMessage] = useState('');
  const [orderActionError, setOrderActionError] = useState('');
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionMarketplace, setConnectionMarketplace] = useState<'WILDBERRIES' | 'OZON'>('WILDBERRIES');
  const [connectionName, setConnectionName] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [isConnecting, setConnecting] = useState(false);
  const loadSequence = useRef(0);
  const canManagePricing =
    session.user.permissionCodes.includes('system:admin') ||
    session.user.permissionCodes.includes('billing:write') ||
    session.user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER');
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

  useEffect(() => {
    setSelectedOrderKeys(new Set());
    setOrderActionMessage('');
    setOrderActionError('');
  }, [selectedClientId]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );
  const calculatorEnabled = canManagePricing || Boolean(selectedClient?.fbsCalculatorEnabled);
  const roleVisibleViews = canManagePricing
    ? fbsViews
    : fbsViews.filter((view) => view.id !== 'pricing');
  const visibleViews = calculatorEnabled
    ? roleVisibleViews
    : roleVisibleViews.filter((view) => view.id !== 'calculator');

  useEffect(() => {
    if (activeView === 'calculator' && !calculatorEnabled) {
      setActiveView('active');
    }
  }, [activeView, calculatorEnabled]);

  const activeConfig = visibleViews.find((view) => view.id === activeView) ?? visibleViews[0];
  const data = ordersState.data;
  const tileCounts: Record<FbsView, number | string> = {
    active: data?.counts.active ?? 0,
    shipped: data?.counts.shipped ?? 0,
    cost: data?.counts.shipped ?? 0,
    calculator: '1–3000',
    archive: data?.counts.archive ?? 0,
    pricing: 'тарифы',
  };

  async function assembleSelectedOrders(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    if (!window.confirm(`Перевести ${orders.length} заказ(а/ов) Wildberries в статус «На сборке»?`)) return;

    setOrderAction('assemble');
    setOrderActionMessage('');
    setOrderActionError('');
    try {
      const result = await assembleFbsOrders(session.accessToken, {
        clientId: selectedClientId,
        orders: orders.map((order) => ({ connectionId: order.connectionId, id: order.id })),
      });
      ++loadSequence.current;
      setOrdersState({ status: 'ready', data: result.orders, error: '' });
      setOrderActionMessage(
        `${result.assembled} заказ(а/ов) переведено в сборку. Теперь можно скачать сформированные ШК заказов.`,
      );
    } catch (caught) {
      setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось перевести заказы в сборку.');
    } finally {
      setOrderAction(null);
    }
  }

  async function downloadSelectedOrderStickers(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    setOrderAction('stickers');
    setOrderActionMessage('');
    setOrderActionError('');
    try {
      const blob = await downloadFbsOrderStickersPdf(session.accessToken, {
        clientId: selectedClientId,
        orders: orders.map((order) => ({ connectionId: order.connectionId, id: order.id })),
      });
      downloadFbsBlob(blob, `FBS_WB_ШК_заказов_${fileDateTime(new Date())}.pdf`);
      setOrderActionMessage(`Скачан PDF со ШК: ${orders.length} заказ(а/ов).`);
    } catch (caught) {
      setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось скачать ШК заказов.');
    } finally {
      setOrderAction(null);
    }
  }

  async function createRequestFromSelectedOrders(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    if (!window.confirm(`Создать одну заявку на отгрузку из ${orders.length} выбранных FBS-заказов?`)) return;

    setOrderAction('request');
    setOrderActionMessage('');
    setOrderActionError('');
    try {
      const result = await createFbsRequest(session.accessToken, {
        clientId: selectedClientId,
        orders: orders.map((order) => ({ connectionId: order.connectionId, id: order.id })),
      });
      ++loadSequence.current;
      setOrdersState({ status: 'ready', data: result.orders, error: '' });
      setOrderActionMessage(
        `Создана заявка №${String(result.request.number).padStart(6, '0')}: ${result.linkedOrders} FBS-заказ(а/ов).`,
      );
    } catch (caught) {
      setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось создать заявку из FBS-заказов.');
    } finally {
      setOrderAction(null);
    }
  }

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
          {activeView === 'calculator'
            ? 'Предварительный расчёт'
            : selectedClient
            ? `${selectedClient.code} · ${selectedClient.name}`
            : selectedClientId
              ? 'Клиент загружается'
              : 'Выберите клиента'}
        </span>
      </header>

      <div className="fbs-tiles" role="tablist" aria-label="Разделы FBS">
        {visibleViews.map((view, index) => {
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
          {activeView !== 'calculator' ? <div className="fbs-workspace__filters">
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
            {activeView !== 'cost' && activeView !== 'pricing' ? (
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
            {activeView !== 'pricing' ? (
              <button
                className="fbs-refresh-button"
                type="button"
                onClick={() => void loadOrders(true)}
                disabled={!selectedClientId || ordersState.status === 'loading'}
              >
                <RefreshCw size={16} aria-hidden="true" />
                <span>{ordersState.status === 'loading' ? 'Обновляю' : 'Обновить'}</span>
              </button>
            ) : null}
          </div> : null}
        </div>

        {activeView === 'calculator' ? (
          <FbsCostCalculator session={session} isAdmin={canManagePricing} />
        ) : !selectedClientId ? (
          <FbsNotice icon={Boxes} title="Выберите клиента" text="Заказы загружаются отдельно для каждого клиентского кабинета." />
        ) : activeView === 'pricing' && canManagePricing ? (
          <FbsPricingSettings
            clientId={selectedClientId}
            session={session}
            onSaved={() => void loadOrders(true)}
          />
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
        ) : activeView === 'active' || activeView === 'shipped' || activeView === 'archive' ? (
          <FbsOrdersView
            data={data}
            view={activeView}
            search={search}
            selectedOrderKeys={selectedOrderKeys}
            onSelectionChange={setSelectedOrderKeys}
            orderAction={orderAction}
            actionMessage={orderActionMessage}
            actionError={orderActionError}
            onAssemble={assembleSelectedOrders}
            onDownloadStickers={downloadSelectedOrderStickers}
            onCreateRequest={createRequestFromSelectedOrders}
          />
        ) : null}

        {data?.connected && activeView !== 'pricing' && activeView !== 'calculator' ? (
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
  selectedOrderKeys,
  onSelectionChange,
  orderAction,
  actionMessage,
  actionError,
  onAssemble,
  onDownloadStickers,
  onCreateRequest,
}: {
  data: ClientFbsOrders | null;
  search: string;
  view: Exclude<FbsView, 'cost' | 'calculator' | 'pricing'>;
  selectedOrderKeys: Set<string>;
  onSelectionChange: (keys: Set<string>) => void;
  orderAction: 'assemble' | 'stickers' | 'request' | null;
  actionMessage: string;
  actionError: string;
  onAssemble: (orders: FbsOrderSummary[]) => Promise<void>;
  onDownloadStickers: (orders: FbsOrderSummary[]) => Promise<void>;
  onCreateRequest: (orders: FbsOrderSummary[]) => Promise<void>;
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
  const itemsCount = visibleOrders.reduce((sum, order) => sum + Math.max(1, order.itemCount), 0);
  const visibleKeys = visibleOrders.map(fbsOrderSelectionKey);
  const selectedOrders = visibleOrders.filter((order) => selectedOrderKeys.has(fbsOrderSelectionKey(order)));
  const assemblyOrders = selectedOrders.filter(
    (order) => order.marketplace === 'WILDBERRIES' && order.supplierStatus === 'new',
  );
  const stickerOrders = selectedOrders.filter(
    (order) => order.marketplace === 'WILDBERRIES' && ['confirm', 'complete'].includes(order.supplierStatus),
  );
  const requestOrders = selectedOrders.filter(
    (order) => order.category === 'active' && (!order.request || order.request.status === 'CANCELLED'),
  );
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedOrderKeys.has(key));

  function toggleAllVisible() {
    const next = new Set(selectedOrderKeys);
    if (allVisibleSelected) visibleKeys.forEach((key) => next.delete(key));
    else visibleKeys.forEach((key) => next.add(key));
    onSelectionChange(next);
  }

  function toggleOrder(order: FbsOrderSummary) {
    const key = fbsOrderSelectionKey(order);
    const next = new Set(selectedOrderKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  }
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

      {view === 'active' && visibleOrders.length > 0 ? (
        <div className="fbs-order-actions">
          <div className="fbs-order-actions__selection">
            <strong>Выбрано: {selectedOrders.length}</strong>
            <span>Можно собирать, скачать ШК или создать одну складскую заявку.</span>
          </div>
          <div className="fbs-order-actions__buttons">
            <button
              type="button"
              className="button button-primary"
              disabled={assemblyOrders.length === 0 || orderAction !== null}
              onClick={() => void onAssemble(assemblyOrders)}
            >
              <ListChecks size={16} aria-hidden="true" />
              {orderAction === 'assemble' ? 'Перевожу…' : `Собрать (${assemblyOrders.length})`}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={requestOrders.length === 0 || orderAction !== null}
              onClick={() => void onCreateRequest(requestOrders)}
            >
              <FilePlus2 size={16} aria-hidden="true" />
              {orderAction === 'request' ? 'Создаю…' : `Заявка (${requestOrders.length})`}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={stickerOrders.length === 0 || orderAction !== null}
              onClick={() => void onDownloadStickers(stickerOrders)}
            >
              <Download size={16} aria-hidden="true" />
              {orderAction === 'stickers' ? 'Формирую…' : `Скачать ШК (${stickerOrders.length})`}
            </button>
          </div>
          {actionMessage ? <p className="fbs-order-actions__message">{actionMessage}</p> : null}
          {actionError ? <p className="fbs-order-actions__error">{actionError}</p> : null}
        </div>
      ) : null}

      <div className="fbs-table-wrap">
        <table className="fbs-table">
          <thead>
            <tr>
              {view === 'active' ? (
                <th className="fbs-table__check">
                  <input
                    type="checkbox"
                    aria-label="Выбрать все показанные заказы"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                  />
                </th>
              ) : null}
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
                <FbsOrderRow
                  key={`${order.marketplace}:${order.connectionId}:${order.id}`}
                  order={order}
                  showBoxes={view === 'active'}
                  selectable={view === 'active'}
                  selected={selectedOrderKeys.has(fbsOrderSelectionKey(order))}
                  onToggle={() => toggleOrder(order)}
                />
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

function FbsOrderRow({
  order,
  showBoxes,
  selectable,
  selected,
  onToggle,
}: {
  order: FbsOrderSummary;
  showBoxes: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className={selected ? 'fbs-table__row--selected' : undefined}>
      {selectable ? (
        <td className="fbs-table__check">
          <input
            type="checkbox"
            aria-label={`Выбрать заказ ${order.id}`}
            checked={selected}
            onChange={onToggle}
          />
        </td>
      ) : null}
      <td>
        <strong>№ {order.id}</strong>
        <small>{marketplaceLabel(order.marketplace)}</small>
        {order.request ? (
          <span className={`fbs-request-link ${order.request.status === 'CANCELLED' ? 'fbs-request-link--cancelled' : ''}`}>
            {order.request.status === 'CANCELLED' ? 'Отменённая заявка' : 'Уже в заявке'} №{String(order.request.number).padStart(6, '0')}
          </span>
        ) : null}
      </td>
      <td>
        <strong>{order.product?.name || order.article || `Товар ${order.nmId ?? ''}`}</strong>
        <small>
          {[order.article, order.nmId ? `nmID ${order.nmId}` : null, `${Math.max(1, order.itemCount)} ед.`]
            .filter(Boolean)
            .join(' · ')}
        </small>
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
                    {order.billing?.breakdown ? (
                      <small>
                        обработка {formatMoney(
                          order.billing.breakdown.fbsProcessingRub +
                            order.billing.breakdown.additionalServicesRub,
                        )} ₽ · доставка {formatMoney(order.billing.breakdown.deliveryRub)} ₽ · короб{' '}
                        {formatMoney(
                          order.billing.breakdown.boxFormationRub +
                            order.billing.breakdown.boxMaterialRub,
                        )} ₽
                        {order.billing.breakdown.palletRub > 0
                          ? ` · паллеты ${formatMoney(order.billing.breakdown.palletRub)} ₽`
                          : ''}
                      </small>
                    ) : null}
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

function FbsPricingSettings({
  clientId,
  session,
  onSaved,
}: {
  clientId: string;
  session: AuthSession;
  onSaved: () => void;
}) {
  const [data, setData] = useState<FbsBillingSettings | null>(null);
  const [form, setForm] = useState<UpdateFbsBillingSettingsPayload | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setSaved(false);
    void fetchFbsBillingSettings(session.accessToken, clientId)
      .then((next) => {
        if (!active) return;
        setData(next);
        setForm(editableFbsSettings(next));
      })
      .catch((caught) => {
        if (!active) return;
        setData(null);
        setForm(null);
        setError(caught instanceof Error ? caught.message : 'Не удалось загрузить тарифы FBS.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientId, session.accessToken]);

  if (isLoading && !form) {
    return <FbsNotice icon={RefreshCw} title="Загружаю тарифы FBS" text="Получаем услуги и цены выбранного клиента." />;
  }
  if (!form || !data) {
    return <FbsNotice icon={AlertTriangle} title="Не удалось загрузить настройки" text={error || 'Повторите попытку.'} tone="error" />;
  }

  const availableServices = data.serviceOptions.filter((service) => service.isActive);
  const palletOptions = availableServices.filter((service) => service.isPallet);
  const boxServices = availableServices.filter((service) => !service.isPallet);
  const additionalOptions = boxServices.filter(
    (service) =>
      service.id !== form.boxFormationServiceId &&
      service.id !== form.boxMaterialServiceId &&
      service.code !== 'BOX_ASSEMBLY' &&
      service.code !== 'BOX_60_40_40',
  );
  const palletCapacityItems = form.boxCapacityItems * form.boxesPerPallet;
  const preview = [
    5,
    6,
    10,
    form.boxCapacityItems,
    ...(form.palletsEnabled ? [palletCapacityItems, palletCapacityItems + 1] : []),
  ].filter(
    (items, index, all) => items > 0 && all.indexOf(items) === index,
  );

  function patch<K extends keyof UpdateFbsBillingSettingsPayload>(
    key: K,
    value: UpdateFbsBillingSettingsPayload[K],
  ) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setSaved(false);
  }

  function toggleAdditionalService(serviceId: string, checked: boolean) {
    patch(
      'additionalServices',
      checked
        ? [...form!.additionalServices, { serviceId, quantityMultiplier: 1 }]
        : form!.additionalServices.filter((selection) => selection.serviceId !== serviceId),
    );
  }

  function changeMultiplier(serviceId: string, quantityMultiplier: number) {
    patch(
      'additionalServices',
      form!.additionalServices.map((selection) =>
        selection.serviceId === serviceId
          ? { ...selection, quantityMultiplier: Math.max(0.001, quantityMultiplier || 1) }
          : selection,
      ),
    );
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form!.palletsEnabled && !form!.palletServiceId) {
      setError('Для начисления паллет выберите услугу паллеты.');
      setSaved(false);
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const next = await updateFbsBillingSettings(session.accessToken, clientId, form!);
      setData(next);
      setForm(editableFbsSettings(next));
      setSaved(true);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить тарифы FBS.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="fbs-pricing" onSubmit={saveSettings}>
      <div className="fbs-pricing__intro">
        <div>
          <span>
            <Settings2 size={19} aria-hidden="true" />
          </span>
          <div>
            <strong>{data.client.code} · {data.client.name}</strong>
            <p>Настройки применяются к новым и ещё не выставленным начислениям FBS.</p>
          </div>
        </div>
        <span
          className={`fbs-pricing__pallet-status${form.palletsEnabled ? ' is-enabled' : ''}`}
        >
          {form.palletsEnabled ? 'Паллеты включены' : 'Паллеты отключены'}
        </span>
      </div>

      <section className="fbs-pricing__section">
        <header>
          <div>
            <span>01</span>
            <div>
              <h4>Обработка каждой единицы</h4>
              <p>Базовая цена FBS плюс выбранные действующие услуги клиента.</p>
            </div>
          </div>
        </header>
        <div className="fbs-pricing__fields fbs-pricing__fields--processing">
          <label>
            <span>Обработка FBS за единицу, ₽</span>
            <input
              min="0"
              step="0.01"
              type="number"
              value={form.fbsProcessingPriceRub}
              onChange={(event) => patch('fbsProcessingPriceRub', nonNegativeNumber(event.target.value))}
              required
            />
          </label>
          <div className="fbs-pricing__service-picker">
            <span>Дополнительные услуги клиента</span>
            <div>
              {additionalOptions.map((service) => {
                const selected = form.additionalServices.find(
                  (selection) => selection.serviceId === service.id,
                );
                return (
                  <label className={selected ? 'is-selected' : undefined} key={service.id}>
                    <input
                      checked={Boolean(selected)}
                      type="checkbox"
                      onChange={(event) => toggleAdditionalService(service.id, event.target.checked)}
                    />
                    <span>
                      <strong>{service.name}</strong>
                      <small>{service.code} · {formatMoney(service.priceRub)} ₽</small>
                    </span>
                    {selected ? (
                      <input
                        aria-label={`Количество услуги ${service.name} на единицу`}
                        min="0.001"
                        step="0.001"
                        type="number"
                        value={selected.quantityMultiplier}
                        onChange={(event) => changeMultiplier(service.id, Number(event.target.value))}
                      />
                    ) : null}
                  </label>
                );
              })}
              {additionalOptions.length === 0 ? (
                <p>Сначала подключите клиенту основные услуги в разделе «Биллинг».</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="fbs-pricing__section">
        <header>
          <div>
            <span>02</span>
            <div>
              <h4>Доставка партии FBS</h4>
              <p>Базовый выезд включает заданное количество единиц, затем цена растёт блоками.</p>
            </div>
          </div>
        </header>
        <div className="fbs-pricing__fields">
          <label>
            <span>Маршрут по умолчанию</span>
            <select
              value={form.defaultDeliveryDestination}
              onChange={(event) =>
                patch('defaultDeliveryDestination', event.target.value as FbsDeliveryDestination)
              }
            >
              <option value="PICKUP_POINT">Ближайший ПВЗ</option>
              <option value="VNUKOVO_SORTING_CENTER">СЦ Внуково</option>
            </select>
          </label>
          <label>
            <span>Базовый выезд на ПВЗ, ₽</span>
            <input
              min="0"
              step="0.01"
              type="number"
              value={form.pickupPointBasePriceRub}
              onChange={(event) => patch('pickupPointBasePriceRub', nonNegativeNumber(event.target.value))}
              required
            />
          </label>
          <label>
            <span>Базовый выезд в СЦ Внуково, ₽</span>
            <input
              min="0"
              step="0.01"
              type="number"
              value={form.vnukovoBasePriceRub}
              onChange={(event) => patch('vnukovoBasePriceRub', nonNegativeNumber(event.target.value))}
              required
            />
          </label>
          <label>
            <span>Единиц входит в базовый выезд</span>
            <input
              min="1"
              step="1"
              type="number"
              value={form.baseIncludedItems}
              onChange={(event) => patch('baseIncludedItems', positiveInteger(event.target.value))}
              required
            />
          </label>
          <label>
            <span>Размер следующего блока, ед.</span>
            <input
              min="1"
              step="1"
              type="number"
              value={form.extraBlockItems}
              onChange={(event) => patch('extraBlockItems', positiveInteger(event.target.value))}
              required
            />
          </label>
          <label>
            <span>Доплата за каждый блок, ₽</span>
            <input
              min="0"
              step="0.01"
              type="number"
              value={form.extraBlockPriceRub}
              onChange={(event) => patch('extraBlockPriceRub', nonNegativeNumber(event.target.value))}
              required
            />
          </label>
        </div>
      </section>

      <section className="fbs-pricing__section">
        <header>
          <div>
            <span>03</span>
            <div>
              <h4>Формирование и стоимость коробов</h4>
              <p>Количество коробов считается автоматически по вместимости.</p>
            </div>
          </div>
        </header>
        <div className="fbs-pricing__fields">
          <label>
            <span>Средняя вместимость короба, ед.</span>
            <input
              min="1"
              step="1"
              type="number"
              value={form.boxCapacityItems}
              onChange={(event) => patch('boxCapacityItems', positiveInteger(event.target.value))}
              required
            />
            <small>Например, для костюмов Лукина — 16 шт.</small>
          </label>
          <label>
            <span>Услуга формирования короба</span>
            <select
              value={form.boxFormationServiceId ?? ''}
              onChange={(event) => patch('boxFormationServiceId', event.target.value || null)}
            >
              <option value="">Не начислять</option>
              {boxServices.map((service) => (
                <option key={`formation:${service.id}`} value={service.id}>
                  {service.name} · {formatMoney(service.priceRub)} ₽
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Стоимость самого короба</span>
            <select
              value={form.boxMaterialServiceId ?? ''}
              onChange={(event) => patch('boxMaterialServiceId', event.target.value || null)}
            >
              <option value="">Не начислять</option>
              {boxServices.map((service) => (
                <option key={`material:${service.id}`} value={service.id}>
                  {service.name} · {formatMoney(service.priceRub)} ₽
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="fbs-pricing__section">
        <header>
          <div>
            <span>04</span>
            <div>
              <h4>Учёт паллет</h4>
              <p>Паллеты можно включить отдельно для клиента и считать по количеству коробов.</p>
            </div>
          </div>
        </header>
        <div className="fbs-pricing__pallets">
          <label className={form.palletsEnabled ? 'is-enabled' : undefined}>
            <input
              checked={form.palletsEnabled}
              type="checkbox"
              onChange={(event) => patch('palletsEnabled', event.target.checked)}
            />
            <span>
              <strong>Начислять паллеты в FBS</strong>
              <small>
                В выключенном состоянии паллетные услуги не попадут в начисления клиента.
              </small>
            </span>
          </label>
          <div className="fbs-pricing__fields">
            <label>
              <span>Коробов на одной паллете</span>
              <input
                disabled={!form.palletsEnabled}
                min="1"
                step="1"
                type="number"
                value={form.boxesPerPallet}
                onChange={(event) => patch('boxesPerPallet', positiveInteger(event.target.value))}
                required
              />
            </label>
            <label>
              <span>Услуга паллеты</span>
              <select
                disabled={!form.palletsEnabled}
                value={form.palletServiceId ?? ''}
                onChange={(event) => patch('palletServiceId', event.target.value || null)}
                required={form.palletsEnabled}
              >
                <option value="">Выберите услугу</option>
                {palletOptions.map((service) => (
                  <option key={`pallet:${service.id}`} value={service.id}>
                    {service.name} · {formatMoney(service.priceRub)} ₽
                  </option>
                ))}
              </select>
              {palletOptions.length === 0 ? (
                <small>Сначала подключите клиенту паллетную услугу в разделе «Биллинг».</small>
              ) : null}
            </label>
          </div>
        </div>
      </section>

      <section className="fbs-pricing__preview">
        <header>
          <div>
            <span>
              <BadgeRussianRuble size={18} aria-hidden="true" />
            </span>
            <div>
              <h4>Предварительный расчёт партии</h4>
              <p>Показывает, как будут складываться начисления при текущих параметрах.</p>
            </div>
          </div>
        </header>
        <div>
          {preview.map((items) => {
            const calculation = calculateFbsPreview(form, data.serviceOptions, items);
            return (
              <article key={items}>
                <span>{items} ед.</span>
                <strong>{formatMoney(calculation.totalRub)} ₽</strong>
                <small>
                  обработка {formatMoney(calculation.processingRub)} · доставка{' '}
                  {formatMoney(calculation.deliveryRub)} · {calculation.boxCount} кор.
                  {form.palletsEnabled
                    ? ` · ${calculation.palletCount} пал. (${formatMoney(calculation.palletRub)} ₽)`
                    : ''}
                </small>
              </article>
            );
          })}
        </div>
      </section>

      {error ? <p className="form-error">{error}</p> : null}
      {saved ? <p className="fbs-pricing__success">Настройки сохранены. Черновые начисления пересчитаются автоматически.</p> : null}
      <footer className="fbs-pricing__footer">
        <p>{data.excludedRule}</p>
        <button className="primary-button" type="submit" disabled={isSaving}>
          <Save size={17} aria-hidden="true" />
          {isSaving ? 'Сохраняю' : 'Сохранить стоимость обработки'}
        </button>
      </footer>
    </form>
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

function editableFbsSettings(data: FbsBillingSettings): UpdateFbsBillingSettingsPayload {
  return {
    defaultDeliveryDestination: data.settings.defaultDeliveryDestination,
    pickupPointBasePriceRub: Number(data.settings.pickupPointBasePriceRub),
    vnukovoBasePriceRub: Number(data.settings.vnukovoBasePriceRub),
    baseIncludedItems: Number(data.settings.baseIncludedItems),
    extraBlockItems: Number(data.settings.extraBlockItems),
    extraBlockPriceRub: Number(data.settings.extraBlockPriceRub),
    boxCapacityItems: Number(data.settings.boxCapacityItems),
    palletsEnabled: Boolean(data.settings.palletsEnabled),
    boxesPerPallet: Number(data.settings.boxesPerPallet),
    fbsProcessingPriceRub: Number(data.settings.fbsProcessingPriceRub),
    boxFormationServiceId: data.settings.boxFormationServiceId,
    boxMaterialServiceId: data.settings.boxMaterialServiceId,
    palletServiceId: data.settings.palletServiceId,
    additionalServices: data.settings.additionalServices.map((selection) => ({ ...selection })),
  };
}

function calculateFbsPreview(
  settings: UpdateFbsBillingSettingsPayload,
  serviceOptions: FbsBillingSettings['serviceOptions'],
  items: number,
) {
  const servicePriceById = new Map(
    serviceOptions.map((service) => [service.id, service.isActive ? Number(service.priceRub) : 0]),
  );
  const processingPerItemRub =
    settings.fbsProcessingPriceRub +
    settings.additionalServices.reduce(
      (sum, selection) =>
        sum +
        (servicePriceById.get(selection.serviceId) ?? 0) * selection.quantityMultiplier,
      0,
    );
  const baseDeliveryRub =
    settings.defaultDeliveryDestination === 'VNUKOVO_SORTING_CENTER'
      ? settings.vnukovoBasePriceRub
      : settings.pickupPointBasePriceRub;
  const extraBlocks = Math.ceil(
    Math.max(0, items - settings.baseIncludedItems) / Math.max(1, settings.extraBlockItems),
  );
  const deliveryRub = baseDeliveryRub + extraBlocks * settings.extraBlockPriceRub;
  const boxCount = Math.ceil(items / Math.max(1, settings.boxCapacityItems));
  const boxesRub =
    boxCount *
    ((servicePriceById.get(settings.boxFormationServiceId ?? '') ?? 0) +
      (servicePriceById.get(settings.boxMaterialServiceId ?? '') ?? 0));
  const palletCount =
    settings.palletsEnabled && settings.palletServiceId
      ? Math.ceil(boxCount / Math.max(1, settings.boxesPerPallet))
      : 0;
  const palletRub =
    palletCount * (servicePriceById.get(settings.palletServiceId ?? '') ?? 0);
  const processingRub = processingPerItemRub * items;
  return {
    processingRub,
    deliveryRub,
    boxesRub,
    boxCount,
    palletRub,
    palletCount,
    totalRub: processingRub + deliveryRub + boxesRub + palletRub,
  };
}

function nonNegativeNumber(value: string) {
  return Math.max(0, Number(value) || 0);
}

function positiveInteger(value: string) {
  return Math.max(1, Math.trunc(Number(value)) || 1);
}

function marketplaceLabel(marketplace: 'WILDBERRIES' | 'OZON') {
  return marketplace === 'WILDBERRIES' ? 'Wildberries' : 'Ozon';
}

function fbsOrderSelectionKey(order: Pick<FbsOrderSummary, 'connectionId' | 'id'>) {
  return `${order.connectionId}:${order.id}`;
}

function downloadFbsBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function fileDateTime(value: Date) {
  const part = (number: number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}_${part(value.getHours())}-${part(value.getMinutes())}`;
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
