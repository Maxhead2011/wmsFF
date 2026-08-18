import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  Archive,
  BarChart3,
  BadgeRussianRuble,
  Boxes,
  Calculator,
  CarFront,
  CalendarDays,
  ChartPie,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  ClipboardList,
  Clock3,
  Download,
  FilePlus2,
  Link2,
  ListChecks,
  MapPin,
  MoreVertical,
  PackageCheck,
  PlugZap,
  Power,
  PowerOff,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  ShoppingBasket,
  Truck,
  Warehouse,
  XCircle,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  assembleFbsOrders,
  cancelFbsOrders,
  changeFbsSuppliesDestination,
  connectFbsStockWarehouse,
  createFbsPass,
  createFbsMarketplaceConnection,
  createFbsRequest,
  deleteFbsPass,
  deliverFbsSupplies,
  downloadFbsCargoPlaceStickersPdf,
  downloadFbsProductShipmentReport,
  downloadFbsOrderStickersPdf,
  downloadFbsRequestPickListPdf,
  downloadFbsSupplyStickersPdf,
  enableFbsEmergencyAssembly,
  fetchClients,
  fetchFbsBillingSettings,
  fetchFbsActiveClients,
  fetchFbsCargoPackings,
  fetchFbsOrders,
  fetchFbsProductShipmentReport,
  fetchFbsPasses,
  fetchFbsStocks,
  fetchFbsWarehouseRoutes,
  moveFbsOrdersToNewSupply,
  removeCancelledFbsOrder,
  reconcileFbsStockItem,
  reshipFbsOrders,
  syncFbsStocks,
  updateFbsPass,
  updateFbsBillingSettings,
  updateFbsCargoPackingIgnore,
  updateFbsStockPublication,
  updateFbsStockPublicationBulk,
  updateFbsWarehouseRoutes,
  updateMarketplaceConnection,
  type AuthSession,
  type ClientFbsOrders,
  type ClientSummary,
  type FbsBillingSettings,
  type FbsActiveClientSummary,
  type FbsCargoPackingsResponse,
  type FbsDeliveryDestination,
  type FbsDeliveryRecoveryItem,
  type FbsOrderSummary,
  type FbsPass,
  type FbsPassPayload,
  type FbsPassesResponse,
  type FbsProductShipmentReport,
  type FbsProductShipmentReportRow,
  type FbsStocksResponse,
  type FbsWarehouseRouteMode,
  type FbsWarehouseRoutesResponse,
  type UpdateFbsBillingSettingsPayload,
} from '../../lib/api';
import { FbsCostCalculator } from './FbsCostCalculator';
import { FbsStockAllocationView } from './FbsStockAllocationView';
import './fbs.css';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';

type FbsPanelProps = {
  session: AuthSession;
};

type FbsMarketplace = 'WILDBERRIES' | 'OZON' | 'YANDEX_MARKET';

type FbsMarketplaceActiveCount = {
  status: 'loading' | 'ready' | 'error';
  count: number;
};

const FBS_MARKETPLACES: FbsMarketplace[] = ['WILDBERRIES', 'OZON', 'YANDEX_MARKET'];

const INITIAL_FBS_MARKETPLACE_COUNTS: Record<FbsMarketplace, FbsMarketplaceActiveCount> = {
  WILDBERRIES: { status: 'loading', count: 0 },
  OZON: { status: 'loading', count: 0 },
  YANDEX_MARKET: { status: 'loading', count: 0 },
};

function activeOrdersWord(count: number) {
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  if (remainder100 >= 11 && remainder100 <= 14) return 'заказов';
  if (remainder10 === 1) return 'заказ';
  if (remainder10 >= 2 && remainder10 <= 4) return 'заказа';
  return 'заказов';
}

function formatMarketplaceActiveOrders(state: FbsMarketplaceActiveCount) {
  if (state.status === 'loading' && state.count === 0) return 'Считаем заказы…';
  if (state.status === 'error') return 'Не удалось посчитать';
  return `${state.count.toLocaleString('ru-RU')} ${activeOrdersWord(state.count)}`;
}

const FBS_HISTORY_STATE_KEY = '__wmsFbsMarketplace';

type FbsView =
  | 'active'
  | 'stocks'
  | 'allocation'
  | 'cargo'
  | 'shipped'
  | 'cancelled'
  | 'report'
  | 'cost'
  | 'calculator'
  | 'archive'
  | 'passes'
  | 'pricing';
type OrdersState =
  | { status: 'idle'; data: null; error: '' }
  | { status: 'loading'; data: ClientFbsOrders | null; error: '' }
  | { status: 'ready'; data: ClientFbsOrders; error: '' }
  | { status: 'error'; data: ClientFbsOrders | null; error: string };

type FbsSynchronizationIssue = {
  requestId: string;
  requestNumber: number;
  requestTitle: string;
  wmsStatus: string;
  activeOrders: number;
  shippedOrders: number;
  cancelledOrders: number;
  kind: 'WMS_OPEN_MARKETPLACE_FINISHED' | 'WMS_CLOSED_MARKETPLACE_ACTIVE';
};

type FbsSynchronizationAudit = {
  checkedAt: string;
  checkedRequests: number;
  checkedOrders: number;
  issues: FbsSynchronizationIssue[];
};

const fbsViews = [
  {
    id: 'active' as const,
    title: 'Активные заказы по FBS',
    description: 'Новые заказы, сборка, упаковка и готовность к передаче.',
    icon: ShoppingBasket,
    accent: 'red',
  },
  {
    id: 'stocks' as const,
    title: 'Товары FBS',
    description: 'Отдельное управление публикацией товаров: «Продавать» или «Не продавать» в Wildberries.',
    icon: PackageCheck,
    accent: 'green',
  },
  {
    id: 'allocation' as const,
    title: 'Распределение остатков',
    description: 'Проценты по рабочим складам WB, рекомендация по продажам и API внешней системы учёта.',
    icon: ChartPie,
    accent: 'blue',
  },
  {
    id: 'cargo' as const,
    title: 'Короба WMS',
    description: 'Физические короба WMS и грузоместа WB: состав, упаковка и готовность поставки.',
    icon: Boxes,
    accent: 'blue',
  },
  {
    id: 'shipped' as const,
    title: 'Отгруженные',
    description: 'Переданные заказы со статусами, автоматически получаемыми из API.',
    icon: Truck,
    accent: 'green',
  },
  {
    id: 'report' as const,
    title: 'Отчёт по товарам FBS',
    description: 'Отгруженные товары за период, поиск по ключевому слову и Excel.',
    icon: BarChart3,
    accent: 'violet',
  },
  {
    id: 'cancelled' as const,
    title: 'Отменённые заказы',
    description: 'Заказы, отменённые продавцом, покупателем или перевозчиком.',
    icon: XCircle,
    accent: 'red',
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
    description: 'Завершённые заказы, полученные покупателями.',
    icon: Archive,
    accent: 'slate',
  },
  {
    id: 'passes' as const,
    title: 'Пропуска WB',
    description: 'Пропуска водителей и автомобилей на склады Wildberries.',
    icon: CarFront,
    accent: 'blue',
  },
  {
    id: 'pricing' as const,
    title: 'Назначение стоимости обработки',
    description: 'Услуги клиента, доставка, шаг доплаты и комплектация коробов.',
    icon: Settings2,
    accent: 'violet',
  },
];

const ozonHiddenViews = new Set<FbsView>(['stocks', 'allocation', 'cargo', 'report', 'passes']);

export function FbsPanel({ session }: FbsPanelProps) {
  const [marketplace, setMarketplace] = useState<FbsMarketplace | null>(null);
  const [activeView, setActiveView] = useState<FbsView>('active');
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [activeClients, setActiveClients] = useState<FbsActiveClientSummary[]>([]);
  const [activeClientsLoading, setActiveClientsLoading] = useState(false);
  const [marketplaceOrderCounts, setMarketplaceOrderCounts] = useState<
    Record<FbsMarketplace, FbsMarketplaceActiveCount>
  >(() => ({ ...INITIAL_FBS_MARKETPLACE_COUNTS }));
  const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id, {
    initialClientId: session.user.clientIds.length === 1 ? session.user.clientIds[0] : '',
  });
  const [search, setSearch] = useState('');
  const [orderSearchFeedback, setOrderSearchFeedback] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const [ordersState, setOrdersState] = useState<OrdersState>({ status: 'idle', data: null, error: '' });
  const [syncAudit, setSyncAudit] = useState<FbsSynchronizationAudit | null>(null);
  const [syncAuditBusy, setSyncAuditBusy] = useState(false);
  const [cargoState, setCargoState] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: FbsCargoPackingsResponse | null;
    error: string;
  }>({ status: 'idle', data: null, error: '' });
  const [cargoActionId, setCargoActionId] = useState<string | null>(null);
  const [selectedOrderKeys, setSelectedOrderKeys] = useState<Set<string>>(() => new Set());
  const [orderAction, setOrderAction] = useState<
    'assemble' | 'reship' | 'move' | 'deliver' | 'change-destination' | 'cancel' | 'remove-cancelled' | 'stickers' | 'cargo' | 'supply' | 'request' | 'recover-missing-requests' | 'pick-list' | 'emergency-assembly' | null
  >(null);
  const [rowActionKey, setRowActionKey] = useState<string | null>(null);
  const [orderActionMessage, setOrderActionMessage] = useState('');
  const [orderActionError, setOrderActionError] = useState('');
  const [deliveryRecovery, setDeliveryRecovery] = useState<{
    rescanOrders: FbsDeliveryRecoveryItem[];
    cancelledOrders: FbsDeliveryRecoveryItem[];
  } | null>(null);
  const [assemblyDialog, setAssemblyDialog] = useState<{
    orders: FbsOrderSummary[];
    destination: FbsDeliveryDestination;
    mode: 'assemble' | 'reship';
  } | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionMarketplace, setConnectionMarketplace] = useState<FbsMarketplace>('WILDBERRIES');
  const [connectionName, setConnectionName] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [isConnecting, setConnecting] = useState(false);
  const loadSequence = useRef(0);
  const marketplaceCountsLoadSequence = useRef(0);
  const canManagePricing =
    session.user.permissionCodes.includes('system:admin') ||
    session.user.permissionCodes.includes('billing:write') ||
    session.user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER');
  const canEnableEmergencyAssembly =
    session.user.permissionCodes.includes('system:admin') ||
    session.user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER');
  const canDownloadPickList = true;

  async function toggleCargoPackingIgnored(planId: string, ignored: boolean) {
    if (!canManagePricing || cargoActionId) return;
    const action = ignored ? 'игнорировать' : 'вернуть в работу';
    if (!window.confirm(`Точно ${action} эту поставку в «Коробах WMS»? Изменение сохранится в журнале администратора.`)) {
      return;
    }
    setCargoActionId(planId);
    try {
      await updateFbsCargoPackingIgnore(session.accessToken, planId, ignored);
      await loadCargoPackings();
    } catch (caught) {
      setCargoState((current) => ({
        status: 'error',
        data: current.data,
        error: caught instanceof Error ? caught.message : 'Не удалось изменить статус поставки.',
      }));
    } finally {
      setCargoActionId(null);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchClients(session.accessToken)
      .then((rows) => {
        if (!active) return;
        setClients(rows);
        setSelectedClientId((current) => validRememberedClientId(current, rows, rows.length === 1 ? rows[0].id : ''));
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
      if (!selectedClientId || !marketplace) {
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
    [marketplace, selectedClientId, session.accessToken],
  );

  async function runFbsSynchronizationAudit() {
    if (!selectedClientId || !marketplace || syncAuditBusy) return;
    setSyncAuditBusy(true);
    setOrderActionError('');
    try {
      // The audit intentionally requests a fresh marketplace snapshot first.
      // It only reports inconsistencies; it never changes request statuses itself.
      const fresh = await fetchFbsOrders(session.accessToken, selectedClientId, true);
      setOrdersState({ status: 'ready', data: fresh, error: '' });
      setSyncAudit(buildFbsSynchronizationAudit(fresh, marketplace));
    } catch (caught) {
      setOrderActionError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось проверить соответствие заявок WMS и статусов маркетплейса.',
      );
    } finally {
      setSyncAuditBusy(false);
    }
  }

  const loadActiveClients = useCallback(async () => {
    if (!marketplace) {
      setActiveClients([]);
      setActiveClientsLoading(false);
      return;
    }
    setActiveClientsLoading(true);
    try {
      const rows = await fetchFbsActiveClients(session.accessToken, marketplace);
      setActiveClients(rows);
      setSelectedClientId((current) => {
        if (rows.some((item) => item.client.id === current)) return current;
        return rows[0]?.client.id ?? current;
      });
    } catch {
      setActiveClients([]);
    } finally {
      setActiveClientsLoading(false);
    }
  }, [marketplace, session.accessToken]);

  const loadMarketplaceOrderCounts = useCallback(async () => {
    const sequence = ++marketplaceCountsLoadSequence.current;
    setMarketplaceOrderCounts((current) => ({
      WILDBERRIES: { status: 'loading', count: current.WILDBERRIES.count },
      OZON: { status: 'loading', count: current.OZON.count },
      YANDEX_MARKET: { status: 'loading', count: current.YANDEX_MARKET.count },
    }));

    const results: Array<readonly [FbsMarketplace, FbsMarketplaceActiveCount]> = [];
    // Загружаем последовательно: первый запрос наполняет серверный кэш заказов,
    // а следующие два считают свои маркетплейсы без лишних параллельных запросов к API.
    for (const targetMarketplace of FBS_MARKETPLACES) {
      try {
        const rows = await fetchFbsActiveClients(session.accessToken, targetMarketplace);
        results.push([
          targetMarketplace,
          {
            status: 'ready',
            count: rows.reduce((sum, item) => sum + item.activeOrders, 0),
          },
        ] as const);
      } catch {
        results.push([targetMarketplace, { status: 'error', count: 0 }] as const);
      }
    }

    if (marketplaceCountsLoadSequence.current !== sequence) return;
    setMarketplaceOrderCounts(
      Object.fromEntries(results) as Record<FbsMarketplace, FbsMarketplaceActiveCount>,
    );
  }, [session.accessToken]);

  const loadCargoPackings = useCallback(async () => {
    if (!selectedClientId) {
      setCargoState({ status: 'idle', data: null, error: '' });
      return;
    }
    setCargoState((current) => ({ status: 'loading', data: current.data, error: '' }));
    try {
      const cargo = await fetchFbsCargoPackings(session.accessToken, selectedClientId);
      setCargoState({ status: 'ready', data: cargo, error: '' });
    } catch (caught) {
      setCargoState((current) => ({
        status: 'error',
        data: current.data,
        error: caught instanceof Error ? caught.message : 'Не удалось загрузить состав грузомест.',
      }));
    }
  }, [selectedClientId, session.accessToken]);

  useEffect(() => {
    setConnectionOpen(false);
    setConnectionError('');
    void loadOrders();
    if (!selectedClientId) {
      return;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadOrders();
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadOrders, selectedClientId]);

  useEffect(() => {
    if (!marketplace) return;
    void loadActiveClients();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadActiveClients();
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadActiveClients, marketplace]);

  useEffect(() => {
    if (marketplace) return;
    void loadMarketplaceOrderCounts();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadMarketplaceOrderCounts();
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadMarketplaceOrderCounts, marketplace]);

  useEffect(() => {
    if (marketplace !== 'WILDBERRIES' || activeView !== 'cargo' || !selectedClientId) return;
    void loadCargoPackings();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadCargoPackings();
      }
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [activeView, loadCargoPackings, marketplace, selectedClientId]);

  useEffect(() => {
    setSelectedOrderKeys(new Set());
    setRowActionKey(null);
    setOrderActionMessage('');
    setOrderActionError('');
    setSyncAudit(null);
  }, [marketplace, selectedClientId]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );
  const calculatorEnabled = canManagePricing || Boolean(selectedClient?.fbsCalculatorEnabled);
  const visibleViews = useMemo(() => {
    const marketplaceViews = marketplace !== 'WILDBERRIES'
      ? fbsViews.filter((view) => !ozonHiddenViews.has(view.id))
      : fbsViews;
    const roleViews = canManagePricing
      ? marketplaceViews
      : marketplaceViews.filter((view) => view.id !== 'pricing');
    return calculatorEnabled
      ? roleViews
      : roleViews.filter((view) => view.id !== 'calculator');
  }, [calculatorEnabled, canManagePricing, marketplace]);

  useEffect(() => {
    if (!visibleViews.some((view) => view.id === activeView)) {
      setActiveView('active');
    }
  }, [activeView, visibleViews]);

  const activeConfig = visibleViews.find((view) => view.id === activeView) ?? visibleViews[0];
  const data = useMemo(
    () => filterFbsOrdersByMarketplace(ordersState.data, marketplace),
    [marketplace, ordersState.data],
  );
  const orderSearchEnabled =
    activeView === 'active' ||
    activeView === 'shipped' ||
    activeView === 'cancelled' ||
    activeView === 'archive';

  function submitOrderQuickSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = normalizeFbsOrderNumber(search);
    if (!query) {
      setOrderSearchFeedback(null);
      return;
    }
    const orders = data?.orders ?? [];
    const exactMatch = orders.find((order) =>
      [order.id, order.orderUid]
        .filter(Boolean)
        .some((value) => normalizeFbsOrderNumber(String(value)) === query),
    );
    const match = exactMatch ?? orders.find((order) =>
      [order.id, order.orderUid]
        .filter(Boolean)
        .some((value) => normalizeFbsOrderNumber(String(value)).includes(query)),
    );
    if (!match) {
      setOrderSearchFeedback({
        tone: 'error',
        text: `Заказ ${search.trim()} не найден у выбранного клиента.`,
      });
      return;
    }

    setActiveView(match.category);
    setSearch(match.id);
    setSelectedOrderKeys(new Set());
    setOrderSearchFeedback({
      tone: 'success',
      text: `Заказ ${match.id} найден: ${fbsCategorySearchLabel(match.category)}.`,
    });
  }

  function clearOrderQuickSearch() {
    setSearch('');
    setOrderSearchFeedback(null);
  }
  const activeOrdersTotal = activeClients.reduce((sum, item) => sum + item.activeOrders, 0);
  const tileCounts: Record<FbsView, number | string> = {
    active: activeOrdersTotal,
    stocks: 'WMS → WB',
    allocation: '100%',
    cargo: cargoState.data?.supplies.filter((supply) => !supply.readyToDeliver && !supply.ignored).length ?? 0,
    shipped: data?.counts.shipped ?? 0,
    cancelled: data?.counts.cancelled ?? 0,
    report: 'Excel',
    cost: data?.counts.shipped ?? 0,
    calculator: '1–3000',
    archive: data?.counts.archive ?? 0,
    passes: '48 ч',
    pricing: 'тарифы',
  };

  async function assembleSelectedOrders(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    if (orders.every((order) => order.marketplace === 'OZON')) {
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
        setSelectedOrderKeys(new Set());
        setOrderActionMessage(result.message || `В Ozon передано заказов: ${result.submitted ?? orders.length}.`);
      } catch (caught) {
        setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось передать заказы в Ozon.');
      } finally {
        setOrderAction(null);
      }
      return;
    }
    setAssemblyDialog({
      orders,
      destination: data?.deliveryPlan.destination ?? 'PICKUP_POINT',
      mode: 'assemble',
    });
  }

  async function reshipSelectedOrders(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    setAssemblyDialog({
      orders,
      destination: data?.deliveryPlan.destination ?? 'PICKUP_POINT',
      mode: 'reship',
    });
  }

  async function submitAssemblyDirection() {
    if (!selectedClientId || !assemblyDialog || assemblyDialog.orders.length === 0) return;
    const { orders, destination, mode } = assemblyDialog;
    setAssemblyDialog(null);

    setOrderAction(mode);
    setOrderActionMessage('');
    setOrderActionError('');
    try {
      const result = await (mode === 'reship' ? reshipFbsOrders : assembleFbsOrders)(session.accessToken, {
        clientId: selectedClientId,
        orders: orders.map((order) => ({ connectionId: order.connectionId, id: order.id })),
        deliveryDestination: destination,
      });
      ++loadSequence.current;
      setOrdersState({ status: 'ready', data: result.orders, error: '' });
      const cargoPlaceCount = result.supplies.reduce((sum, supply) => sum + supply.cargoPlaceCount, 0);
      setOrderActionMessage(
        result.deliveryPlan.requiresCargoPlaces
          ? `${result.assembled} заказ(а/ов) ${mode === 'reship' ? 'переведено в повторную отгрузку' : 'переведено в сборку'}. Создано грузомест: ${cargoPlaceCount}, количество товаров в одном месте не ограничено. Теперь скачайте ШК заказов и QR грузомест.`
          : `${result.assembled} заказ(а/ов) ${mode === 'reship' ? 'переведено в повторную отгрузку' : 'переведено в сборку'}. Поставка идёт в сортировочный центр, поэтому грузоместа WB не создавались. Теперь можно скачать ШК заказов.`,
      );
    } catch (caught) {
      setOrderActionError(caught instanceof Error ? caught.message : mode === 'reship' ? 'Не удалось создать повторную отгрузку.' : 'Не удалось перевести заказы в сборку.');
    } finally {
      setOrderAction(null);
    }
  }

  async function cancelSelectedOrders(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    if (!window.confirm(`Отменить ${orders.length} FBS-заказ(а/ов) у продавца? Действие изменит статус в Wildberries.`)) return;
    setOrderAction('cancel');
    setOrderActionMessage('');
    setOrderActionError('');
    try {
      const result = await cancelFbsOrders(session.accessToken, {
        clientId: selectedClientId,
        orders: orders.map((order) => ({ connectionId: order.connectionId, id: order.id })),
      });
      ++loadSequence.current;
      setOrdersState({ status: 'ready', data: result.orders, error: '' });
      setSelectedOrderKeys(new Set());
      setOrderActionMessage(`Отменено заказов: ${result.cancelled ?? 0}.${result.failed.length ? ` Не удалось: ${result.failed.length}.` : ''}`);
      if (result.failed.length) setOrderActionError(result.failed.map((item) => `${item.id}: ${item.message}`).join(' '));
    } catch (caught) {
      setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось отменить заказы.');
    } finally {
      setOrderAction(null);
    }
  }

  async function removeCancelledOrderFromWms(order: FbsOrderSummary) {
    if (!selectedClientId) return;
    if (!window.confirm(
      `Удалить отменённый заказ ${order.id} из заявки WMS? Резерв товара будет снят. На Wildberries ничего не изменится.`,
    )) return;
    const key = fbsOrderSelectionKey(order);
    setOrderAction('remove-cancelled');
    setRowActionKey(key);
    setOrderActionMessage('');
    setOrderActionError('');
    try {
      const result = await removeCancelledFbsOrder(session.accessToken, {
        clientId: selectedClientId,
        orders: [{ connectionId: order.connectionId, id: order.id }],
      });
      ++loadSequence.current;
      setOrdersState({ status: 'ready', data: result.orders, error: '' });
      setSelectedOrderKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setOrderActionMessage(result.message);
    } catch (caught) {
      setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось удалить отменённый заказ из WMS.');
    } finally {
      setOrderAction(null);
      setRowActionKey(null);
    }
  }

  async function deliverSelectedSupplies(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    const supplyCount = new Set(orders.map((order) => `${order.connectionId}:${order.supplyId}`)).size;
    if (!window.confirm(
      `Передать в доставку ${supplyCount} поставк(у/и)? Перед отправкой WMS обновит данные WB и проверит, что все заказы заявки собраны, КИЗ приняты, а отменённых или потерянных заказов нет. После закрытия в поставку нельзя будет добавить заказы.`,
    )) return;
    setOrderAction('deliver');
    setOrderActionMessage('');
    setOrderActionError('');
    setDeliveryRecovery(null);
    try {
      const result = await deliverFbsSupplies(session.accessToken, {
        clientId: selectedClientId,
        orders: orders.map((order) => ({ connectionId: order.connectionId, id: order.id })),
      });
      ++loadSequence.current;
      setOrdersState({ status: 'ready', data: result.orders, error: '' });
      setSelectedOrderKeys(new Set());
      setOrderActionMessage(`Передано в доставку поставок: ${result.delivered ?? 0}.${result.failed.length ? ` Не удалось: ${result.failed.length}.` : ' Счёт за обработку будет создан автоматически.'}`);
      if (result.failed.length) setOrderActionError(result.failed.map((item) => `${item.supplyId}: ${item.message}`).join(' '));
      if (result.recovery && (result.recovery.rescanOrders.length > 0 || result.recovery.cancelledOrders.length > 0)) {
        setDeliveryRecovery(result.recovery);
      }
    } catch (caught) {
      setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось передать поставки в доставку.');
    } finally {
      setOrderAction(null);
    }
  }

  async function changeSelectedSuppliesToSortingCenter(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    const supplyCount = new Set(orders.map((order) => `${order.connectionId}:${order.supplyId}`)).size;
    const cargoPlaceCount = new Map(
      orders.map((order) => [
        `${order.connectionId}:${order.supplyId}`,
        order.shipmentPlan?.cargoPlaceCount ?? 0,
      ]),
    );
    const totalCargoPlaces = [...cargoPlaceCount.values()].reduce((sum, count) => sum + count, 0);
    if (!window.confirm(
      `Сменить направление ${supplyCount} поставк(и) с ПВЗ на сортировочный центр?\n\n` +
      `Будут удалены грузоместа WB: ${totalCargoPlaces}. Упаковка грузомест будет расформирована. ` +
      'Заказы, собранные товары, КИЗ и наклейки заказов останутся без изменений.',
    )) return;

    setOrderAction('change-destination');
    setOrderActionMessage('');
    setOrderActionError('');
    try {
      const result = await changeFbsSuppliesDestination(session.accessToken, {
        clientId: selectedClientId,
        orders: orders.map((order) => ({ connectionId: order.connectionId, id: order.id })),
        deliveryDestination: 'VNUKOVO_SORTING_CENTER',
      });
      ++loadSequence.current;
      setOrdersState({ status: 'ready', data: result.orders, error: '' });
      setSelectedOrderKeys(new Set());
      setOrderActionMessage(
        `Направление изменено у ${result.changed} поставк(и). Удалено грузомест WB: ${result.removedCargoPlaces}. ` +
        `Заказы и сборка сохранены, дальнейшая логистика будет рассчитана по тарифу СЦ. ` +
        `После завершения передайте поставку WB и скачайте ШК для СЦ.`,
      );
      if (result.failed.length > 0) {
        setOrderActionError(result.failed.map((item) => `${item.supplyId}: ${item.message}`).join(' '));
      }
      void loadCargoPackings();
    } catch (caught) {
      setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось сменить направление поставки.');
    } finally {
      setOrderAction(null);
    }
  }

  async function moveSelectedOrdersToNewSupply(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    const sourceRequestNumbers = [...new Set(
      orders
        .map((order) => order.request?.number)
        .filter((number): number is number => typeof number === 'number'),
    )];
    const isMerge = sourceRequestNumbers.length > 1;
    const sourceSupplyIds = [...new Set(orders.map((order) => order.supplyId).filter(Boolean))];
    const sourceSupplyId = sourceSupplyIds.length > 1
      ? sourceSupplyIds.join(', ')
      : orders[0]?.supplyId;
    const sourceRequestNumber = orders[0]?.request?.number;
    if (!window.confirm(
      `Перенести ${orders.length} заказ(а/ов) из поставки ${sourceSupplyId} в новую поставку WB?\n\n` +
      `Для них будет создана отдельная заявка WMS. Заявка №${String(sourceRequestNumber ?? '').padStart(6, '0')} ` +
      'автоматически пересчитается. Статус заказов в WB останется «На сборке».',
    )) return;

    setOrderAction('move');
    setOrderActionMessage('');
    setOrderActionError('');
    try {
      const result = await moveFbsOrdersToNewSupply(session.accessToken, {
        clientId: selectedClientId,
        orders: orders.map((order) => ({
          connectionId: order.connectionId,
          id: order.id,
        })),
      });
      ++loadSequence.current;
      setOrdersState({ status: 'ready', data: result.orders, error: '' });
      setSelectedOrderKeys(new Set());
      setOrderActionMessage(
        `${isMerge ? 'Объединены заказы из нескольких заявок. ' : ''}` +
        `Перенесено заказов: ${result.moved}. Новая поставка: ${result.targetSupply.id}. ` +
        `Создана заявка №${String(result.targetRequest.number).padStart(6, '0')}. ` +
        (result.skipped > 0
          ? `Не перенесено уже начатых на ТСД заказов: ${result.skipped} (${result.skippedOrders.map((order) => `№${order.id}`).join(', ')}). `
          : '') +
        (result.targetSupply.cargoPlaceCount > 0
          ? `Создано грузомест ПВЗ: ${result.targetSupply.cargoPlaceCount}.`
          : 'Направление и параметры исходной поставки сохранены.'),
      );
      void loadCargoPackings();
    } catch (caught) {
      setOrderActionError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось перенести заказы в новую поставку.',
      );
    } finally {
      setOrderAction(null);
    }
  }

  async function downloadSelectedCargoPlaceStickers(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    setOrderAction('cargo');
    setRowActionKey(orders.length === 1 ? fbsOrderSelectionKey(orders[0]) : null);
    setOrderActionMessage('');
    setOrderActionError('');
    try {
      const blob = await downloadFbsCargoPlaceStickersPdf(session.accessToken, {
        clientId: selectedClientId,
        orders: orders.map((order) => ({ connectionId: order.connectionId, id: order.id })),
      });
      downloadFbsBlob(blob, `FBS_WB_QR_грузомест_${fileDateTime(new Date())}.pdf`);
      setOrderActionMessage('Скачан PDF с QR-кодами грузомест выбранных поставок.');
    } catch (caught) {
      setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось скачать QR грузомест.');
    } finally {
      setOrderAction(null);
      setRowActionKey(null);
    }
  }

  async function downloadSelectedOrderStickers(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    setOrderAction('stickers');
    setRowActionKey(orders.length === 1 ? fbsOrderSelectionKey(orders[0]) : null);
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
      setRowActionKey(null);
    }
  }

  async function downloadSelectedSupplyStickers(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    setOrderAction('supply');
    setRowActionKey(orders.length === 1 ? fbsOrderSelectionKey(orders[0]) : null);
    setOrderActionMessage('');
    setOrderActionError('');
    try {
      const blob = await downloadFbsSupplyStickersPdf(session.accessToken, {
        clientId: selectedClientId,
        orders: orders.map((order) => ({ connectionId: order.connectionId, id: order.id })),
      });
      downloadFbsBlob(blob, `FBS_WB_ШК_для_СЦ_${fileDateTime(new Date())}.pdf`);
      setOrderActionMessage('Скачан PDF со ШК поставок для сортировочного центра.');
    } catch (caught) {
      setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось скачать ШК поставки для СЦ.');
    } finally {
      setOrderAction(null);
      setRowActionKey(null);
    }
  }

  async function downloadFbsPickList(order: FbsOrderSummary) {
    if (!order.request || order.request.status === 'CANCELLED') return;
    setOrderAction('pick-list');
    setRowActionKey(fbsOrderSelectionKey(order));
    setOrderActionMessage('');
    setOrderActionError('');
    try {
      const blob = await downloadFbsRequestPickListPdf(session.accessToken, order.request.id);
      downloadFbsBlob(
        blob,
        `Лист_подбора_FBS_${String(order.request.number).padStart(6, '0')}_${fileDateTime(new Date())}.pdf`,
      );
      setOrderActionMessage(`Скачан лист подбора по заявке №${String(order.request.number).padStart(6, '0')}.`);
    } catch (caught) {
      setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось скачать лист подбора.');
    } finally {
      setOrderAction(null);
      setRowActionKey(null);
    }
  }

  async function enableEmergencyAssemblyForRequest(
    request: NonNullable<FbsOrderSummary['request']>,
  ) {
    if (!canEnableEmergencyAssembly || orderAction !== null) return;
    if (!window.confirm(
      `Экстренно вернуть заявку WMS №${String(request.number).padStart(6, '0')} в локальную сборку?\n\n` +
      'Заказы снова появятся у сборщиков на ТСД. Статус поставки и заказы в Wildberries НЕ изменятся. ' +
      'Используйте действие только если поставку ошибочно передали WB до физической сборки.',
    )) return;

    setOrderAction('emergency-assembly');
    setRowActionKey(request.id);
    setOrderActionMessage('');
    setOrderActionError('');
    try {
      const result = await enableFbsEmergencyAssembly(session.accessToken, request.id);
      setOrderActionMessage(
        result.status === 'ALREADY_APPLIED'
          ? `Аварийная сборка заявки №${String(result.request.number).padStart(6, '0')} уже включена.`
          : `Заявка №${String(result.request.number).padStart(6, '0')} возвращена в локальную очередь ТСД: ${result.shippedOrders} заказ(а/ов). Wildberries не изменялся.`,
      );
      await loadOrders(true);
    } catch (caught) {
      setOrderActionError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось включить аварийную сборку заявки.',
      );
    } finally {
      setOrderAction(null);
      setRowActionKey(null);
    }
  }

  async function createRequestFromSelectedOrders(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    const wbWarehouseKeys = Array.from(
      new Set(
        orders
          .filter((order) => order.marketplace === 'WILDBERRIES')
          .map((order) => `${order.connectionId}:${order.marketplace}:${order.warehouseId || order.officeId || 'unknown'}`),
      ),
    );
    if (wbWarehouseKeys.length > 1) {
      await createMissingWmsRequests(groupFbsOrdersForRequestsByWarehouse(orders, false), true);
      return;
    }
    const wbWarehouseOrder = orders.find((order) => order.marketplace === 'WILDBERRIES');
    const wbWarehouseLabel = wbWarehouseOrder ? fbsOrderWarehouseLabel(wbWarehouseOrder) : '';
    if (!window.confirm(`Создать одну заявку на отгрузку из ${orders.length} выбранных FBS-заказов?`)) return;

    setOrderAction('request');
    setOrderActionMessage('');
    setOrderActionError('');
    try {
      const result = await createFbsRequest(session.accessToken, {
        clientId: selectedClientId,
        orders: orders.map((order) => ({ connectionId: order.connectionId, id: order.id })),
        marketplaceWarehouseKey: wbWarehouseKeys[0],
      });
      ++loadSequence.current;
      setOrdersState({ status: 'ready', data: result.orders, error: '' });
      setOrderActionMessage(
        `Создана заявка №${String(result.request.number).padStart(6, '0')}: ${result.linkedOrders} FBS-заказ(а/ов)${wbWarehouseLabel ? ` · ${wbWarehouseLabel}` : ''}.`,
      );
    } catch (caught) {
      setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось создать заявку из FBS-заказов.');
    } finally {
      setOrderAction(null);
    }
  }

  async function createMissingWmsRequests(groups: FbsOrderSummary[][], selectedMixedWarehouses = false) {
    if (!selectedClientId || groups.length === 0 || orderAction !== null) return;
    const orderCount = groups.reduce((sum, group) => sum + group.length, 0);
    const summary = groups
      .map((group) => `${fbsOrderWarehouseLabel(group[0])}: ${group.length} заказ(а/ов)`)
      .join('\n');
    if (!window.confirm(
      `${selectedMixedWarehouses ? 'Выбраны заказы разных складов WB. Автоматически разделить их и создать заявки WMS?' : 'Создать отсутствующие заявки WMS по данным Wildberries?'}\n\n` +
      `${groups.length} заявок, ${orderCount} заказов:\n${summary}\n\n` +
      'Для каждого города/склада будет создана отдельная заявка. Уже привязанные заказы не затрагиваются.',
    )) return;

    setOrderAction('recover-missing-requests');
    setOrderActionMessage('');
    setOrderActionError('');
    let created = 0;
    let linked = 0;
    const failures: string[] = [];
    try {
      for (const group of groups) {
        const first = group[0];
        const marketplaceWarehouseKey =
          `${first.connectionId}:${first.marketplace}:${first.warehouseId || first.officeId || 'unknown'}`;
        try {
          const result = await createFbsRequest(session.accessToken, {
            clientId: selectedClientId,
            orders: group.map((order) => ({ connectionId: order.connectionId, id: order.id })),
            marketplaceWarehouseKey,
          });
          created += 1;
          linked += result.linkedOrders;
        } catch (caught) {
          failures.push(
            `${fbsOrderWarehouseLabel(first)}: ${caught instanceof Error ? caught.message : 'ошибка создания'}`,
          );
        }
      }
      await loadOrders(true);
      setOrderActionMessage(`Создано заявок WMS: ${created}. Привязано заказов: ${linked}.`);
      if (failures.length > 0) setOrderActionError(`Не созданы: ${failures.join(' ')}`);
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
        sellerId: connectionMarketplace === 'WILDBERRIES' ? '' : sellerId.trim(),
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

  function openMarketplace(nextMarketplace: FbsMarketplace) {
    window.history.pushState(
      { ...(window.history.state ?? {}), [FBS_HISTORY_STATE_KEY]: nextMarketplace },
      '',
    );
    setMarketplace(nextMarketplace);
    setConnectionMarketplace(nextMarketplace);
    setActiveView('active');
    setSearch('');
    setConnectionOpen(false);
    setConnectionError('');
  }

  function closeMarketplace() {
    if (window.history.state?.[FBS_HISTORY_STATE_KEY]) {
      window.history.back();
      return;
    }
    resetMarketplace();
  }

  function resetMarketplace() {
    setMarketplace(null);
    setActiveClients([]);
    setActiveView('active');
    setSearch('');
    setSelectedOrderKeys(new Set());
    setConnectionOpen(false);
    setConnectionError('');
  }

  function renderMarketplaceActiveCount(targetMarketplace: FbsMarketplace) {
    const state = marketplaceOrderCounts[targetMarketplace];
    return (
      <span
        className="fbs-marketplace-card__active-count"
        data-state={state.status}
        data-has-orders={state.status === 'ready' && state.count > 0 ? 'true' : 'false'}
        aria-live="polite"
      >
        <span className="fbs-marketplace-card__active-dot" aria-hidden="true" />
        {formatMarketplaceActiveOrders(state)}
      </span>
    );
  }

  useEffect(() => {
    function handleBrowserBack(event: PopStateEvent) {
      const nextMarketplace = event.state?.[FBS_HISTORY_STATE_KEY] as FbsMarketplace | undefined;
      if (
        nextMarketplace === 'WILDBERRIES' ||
        nextMarketplace === 'OZON' ||
        nextMarketplace === 'YANDEX_MARKET'
      ) {
        setMarketplace(nextMarketplace);
        setConnectionMarketplace(nextMarketplace);
        setActiveView('active');
        return;
      }
      resetMarketplace();
    }

    window.addEventListener('popstate', handleBrowserBack);
    return () => window.removeEventListener('popstate', handleBrowserBack);
  }, []);

  if (!marketplace) {
    return (
      <section className="fbs-panel fbs-marketplace-entry" aria-label="Выбор FBS-маркетплейса">
        <header className="fbs-panel__hero fbs-marketplace-entry__hero">
          <div className="fbs-panel__hero-icon">
            <ShoppingBasket size={24} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">FBS</p>
            <h2>Выберите маркетплейс</h2>
            <p>Заказы и инструменты Wildberries, Ozon и Яндекс Маркета работают раздельно и не смешиваются в одной очереди.</p>
          </div>
          <span className="fbs-panel__scope">3 рабочих контура</span>
        </header>

        <div className="fbs-marketplace-picker">
          <button
            type="button"
            className="fbs-marketplace-card fbs-marketplace-card--wb"
            onClick={() => openMarketplace('WILDBERRIES')}
          >
            <span className="fbs-marketplace-card__index">1</span>
            <span className="fbs-marketplace-card__brand">WB</span>
            <span className="fbs-marketplace-card__content">
              <small>Wildberries</small>
              <span className="fbs-marketplace-card__heading">
                <strong>FBS WB</strong>
                {renderMarketplaceActiveCount('WILDBERRIES')}
              </span>
              <p>Заказы, сборка, остатки WB, короба, грузоместа, поставки и пропуска.</p>
            </span>
            <ChevronRight size={26} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="fbs-marketplace-card fbs-marketplace-card--ozon"
            onClick={() => openMarketplace('OZON')}
          >
            <span className="fbs-marketplace-card__index">2</span>
            <span className="fbs-marketplace-card__brand">OZON</span>
            <span className="fbs-marketplace-card__content">
              <small>Ozon Seller</small>
              <span className="fbs-marketplace-card__heading">
                <strong>FBS Ozon</strong>
                {renderMarketplaceActiveCount('OZON')}
              </span>
              <p>Отдельная очередь заказов Ozon, статусы отгрузки, архив, стоимость и API.</p>
            </span>
            <ChevronRight size={26} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="fbs-marketplace-card fbs-marketplace-card--yandex"
            onClick={() => openMarketplace('YANDEX_MARKET')}
          >
            <span className="fbs-marketplace-card__index">3</span>
            <span className="fbs-marketplace-card__brand">Я</span>
            <span className="fbs-marketplace-card__content">
              <small>Яндекс Маркет</small>
              <span className="fbs-marketplace-card__heading">
                <strong>FBS Яндекс</strong>
                {renderMarketplaceActiveCount('YANDEX_MARKET')}
              </span>
              <p>Отдельная очередь заказов Яндекс Маркета, сборка, статусы, архив и подключение API.</p>
            </span>
            <ChevronRight size={26} aria-hidden="true" />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="fbs-panel" aria-label="FBS">
      <header className="fbs-panel__hero">
        <div className="fbs-panel__hero-icon">
          <ShoppingBasket size={24} aria-hidden="true" />
        </div>
        <div>
          <button className="fbs-marketplace-back" type="button" onClick={closeMarketplace}>
            <ArrowLeft size={18} aria-hidden="true" />
            <span>Назад к выбору FBS</span>
          </button>
          <p className="eyebrow">{marketplaceEyebrow(marketplace)}</p>
          <h2>{marketplaceTitle(marketplace)}</h2>
          <p>
            {marketplace === 'WILDBERRIES'
              ? 'Заказы WB, складские остатки, короба, грузоместа, поставки и пропуска.'
              : marketplace === 'OZON'
                ? 'Заказы Ozon, статусы отгрузки, архив и стоимость обработки.'
                : 'Заказы Яндекс Маркета, сборка, статусы отгрузки, архив и стоимость обработки.'}
          </p>
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
            <div
              className={`fbs-tile fbs-tile--${view.accent}${isActive ? ' is-active' : ''}${
                view.id === 'active' ? ' fbs-tile--has-clients' : ''
              }`}
              key={view.id}
            >
              <button
                className="fbs-tile__open"
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
              {view.id === 'active' ? (
                <div
                  className="fbs-tile__clients"
                  aria-label={`Клиенты с активными заказами ${marketplaceLabel(marketplace)}`}
                >
                  <span className="fbs-tile__clients-title">Клиенты с заказами</span>
                  {activeClientsLoading ? (
                    <span className="fbs-tile__clients-empty">Обновляю список…</span>
                  ) : activeClients.length > 0 ? (
                    activeClients.map((item) => (
                      <button
                        key={item.client.id}
                        type="button"
                        className={item.client.id === selectedClientId ? 'is-selected' : undefined}
                        onClick={() => {
                          setSelectedClientId(item.client.id);
                          setActiveView('active');
                          setSearch('');
                        }}
                      >
                        <span>{item.client.name}</span>
                        <strong>{item.activeOrders}</strong>
                      </button>
                    ))
                  ) : (
                    <span className="fbs-tile__clients-empty">
                      Активных заказов {marketplaceLabel(marketplace)} нет
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <section className="fbs-workspace" role="tabpanel" aria-label={activeConfig.title}>
        <div className="fbs-workspace__heading">
          <div>
            <p className="eyebrow">FBS · {marketplaceLabel(marketplace)}</p>
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
            {orderSearchEnabled ? (
              <form className="fbs-order-quick-search" onSubmit={submitOrderQuickSearch}>
                <label className="fbs-workspace__search fbs-workspace__search--order">
                  <span>Быстрый поиск заказа</span>
                  <span>
                    <Search size={17} aria-hidden="true" />
                    <input
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setOrderSearchFeedback(null);
                      }}
                      placeholder="Номер заказа WB, Ozon или Яндекс"
                      aria-label="Номер заказа маркетплейса"
                    />
                    {search ? (
                      <button
                        className="fbs-order-quick-search__clear"
                        type="button"
                        onClick={clearOrderQuickSearch}
                        title="Очистить поиск"
                        aria-label="Очистить поиск заказа"
                      >
                        <XCircle size={17} aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      className="fbs-order-quick-search__submit"
                      type="submit"
                      disabled={!search.trim() || ordersState.status === 'loading'}
                    >
                      Найти
                    </button>
                  </span>
                </label>
                {orderSearchFeedback ? (
                  <small className={`fbs-order-quick-search__feedback is-${orderSearchFeedback.tone}`}>
                    {orderSearchFeedback.text}
                  </small>
                ) : null}
              </form>
            ) : activeView !== 'cost' && activeView !== 'pricing' && activeView !== 'passes' && activeView !== 'report' ? (
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
            {activeView !== 'pricing' && activeView !== 'passes' && activeView !== 'stocks' && activeView !== 'report' ? (
              <button
                className="fbs-refresh-button"
                type="button"
                onClick={() => void (activeView === 'cargo' ? loadCargoPackings() : loadOrders(true))}
                disabled={
                  !selectedClientId ||
                  (activeView === 'cargo' ? cargoState.status === 'loading' : ordersState.status === 'loading')
                }
              >
                <RefreshCw size={16} aria-hidden="true" />
                <span>
                  {(activeView === 'cargo' ? cargoState.status : ordersState.status) === 'loading'
                    ? 'Обновляю'
                    : 'Обновить'}
                </span>
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
        ) : activeView === 'passes' ? (
          <FbsPassesView clientId={selectedClientId} session={session} />
        ) : activeView === 'stocks' ? (
          <FbsStocksView clientId={selectedClientId} session={session} search={search} />
        ) : activeView === 'allocation' ? (
          <FbsStockAllocationView
            clientId={selectedClientId}
            connectionId={data?.connections.find((connection) => connection.marketplace === 'WILDBERRIES')?.id ?? ''}
            session={session}
          />
        ) : activeView === 'cargo' ? (
          <FbsCargoPackingView
            state={cargoState}
            search={search}
            canManage={canManagePricing}
            actionId={cargoActionId}
            onToggleIgnored={toggleCargoPackingIgnored}
          />
        ) : activeView === 'report' ? (
          <FbsProductShipmentsReportView
            clientId={selectedClientId}
            session={session}
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
            onAccountNameChange={setConnectionName}
            onSellerIdChange={setSellerId}
            onApiKeyChange={setApiKey}
            onSubmit={connectMarketplace}
          />
        ) : ordersState.status === 'loading' && !data ? (
          <FbsNotice
            icon={RefreshCw}
            title="Получаю заказы"
            text={`Проверяем подключённые кабинеты ${marketplaceLabel(marketplace)}.`}
          />
        ) : activeView === 'cost' ? (
          <FbsCostView data={data} />
        ) : activeView === 'active' || activeView === 'shipped' || activeView === 'cancelled' || activeView === 'archive' ? (
          <FbsOrdersView
            data={data}
            view={activeView}
            search={search}
            selectedOrderKeys={selectedOrderKeys}
            onSelectionChange={setSelectedOrderKeys}
            orderAction={orderAction}
            rowActionKey={rowActionKey}
            actionMessage={orderActionMessage}
            actionError={orderActionError}
            onAssemble={assembleSelectedOrders}
            onReship={reshipSelectedOrders}
            onDeliver={deliverSelectedSupplies}
            onChangeDestination={changeSelectedSuppliesToSortingCenter}
            onMoveToNewSupply={moveSelectedOrdersToNewSupply}
            onCancel={cancelSelectedOrders}
            onRemoveCancelledOrder={removeCancelledOrderFromWms}
            onDownloadStickers={downloadSelectedOrderStickers}
            onDownloadCargoStickers={downloadSelectedCargoPlaceStickers}
            onDownloadSupplyStickers={downloadSelectedSupplyStickers}
            onDownloadPickList={downloadFbsPickList}
            canDownloadPickList={canDownloadPickList}
            canEnableEmergencyAssembly={canEnableEmergencyAssembly}
            onEnableEmergencyAssembly={enableEmergencyAssemblyForRequest}
            onCreateRequest={createRequestFromSelectedOrders}
            onCreateMissingRequests={createMissingWmsRequests}
            syncAudit={syncAudit}
            syncAuditBusy={syncAuditBusy}
            onRunSynchronizationAudit={runFbsSynchronizationAudit}
            onCloseSynchronizationAudit={() => setSyncAudit(null)}
          />
        ) : null}

        {data?.connected &&
        activeView !== 'pricing' &&
        activeView !== 'calculator' &&
        activeView !== 'passes' &&
        activeView !== 'stocks' &&
        activeView !== 'report' ? (
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
      {assemblyDialog ? (
        <FbsAssemblyDestinationDialog
          orders={assemblyDialog.orders}
          destination={assemblyDialog.destination}
          mode={assemblyDialog.mode}
          isSubmitting={orderAction === 'assemble' || orderAction === 'reship'}
          onDestinationChange={(destination) =>
            setAssemblyDialog((current) => (current ? { ...current, destination } : current))
          }
          onCancel={() => setAssemblyDialog(null)}
          onSubmit={() => void submitAssemblyDirection()}
        />
      ) : null}
      {deliveryRecovery ? (
        <FbsDeliveryRecoveryDialog
          rescanOrders={deliveryRecovery.rescanOrders}
          cancelledOrders={deliveryRecovery.cancelledOrders}
          onClose={() => setDeliveryRecovery(null)}
        />
      ) : null}
    </section>
  );
}

function FbsProductShipmentsReportView({
  clientId,
  session,
}: {
  clientId: string;
  session: AuthSession;
}) {
  const initialPeriod = useMemo(() => fbsReportInitialPeriod(), []);
  const [dateFrom, setDateFrom] = useState(initialPeriod.dateFrom);
  const [dateTo, setDateTo] = useState(initialPeriod.dateTo);
  const [keyword, setKeyword] = useState('');
  const [report, setReport] = useState<FbsProductShipmentReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<'all' | 'filtered' | null>(null);
  const [error, setError] = useState('');

  const loadReport = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError('');
    try {
      setReport(
        await fetchFbsProductShipmentReport(session.accessToken, {
          clientId,
          dateFrom,
          dateTo,
        }),
      );
    } catch (caught) {
      setReport(null);
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось сформировать отчёт FBS.',
      );
    } finally {
      setLoading(false);
    }
  }, [clientId, dateFrom, dateTo, session.accessToken]);

  useEffect(() => {
    setKeyword('');
    void loadReport();
  }, [clientId]);

  const filteredRows = useMemo(() => {
    const query = normalizeFbsReportSearch(keyword);
    if (!query || !report) return [];
    return report.rows.filter((row) =>
      [
        row.internalSku,
        row.clientSku,
        row.article,
        row.productName,
        row.color,
        row.size,
        row.barcode,
        row.wbOrderNumbers,
        row.wbSupplyNumbers,
        row.wmsRequestNumbers,
      ].some((value) => normalizeFbsReportSearch(value).includes(query)),
    );
  }, [keyword, report]);
  const filteredSummary = useMemo(
    () => fbsProductReportSummary(filteredRows),
    [filteredRows],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    void loadReport();
  }

  async function download(mode: 'all' | 'filtered') {
    if (!report) return;
    setDownloading(mode);
    setError('');
    try {
      const blob = await downloadFbsProductShipmentReport(
        session.accessToken,
        {
          clientId,
          dateFrom,
          dateTo,
          search: mode === 'filtered' ? keyword.trim() : undefined,
        },
      );
      const suffix =
        mode === 'filtered' && keyword.trim()
          ? `_${keyword.trim().replace(/[^a-zа-яё0-9_-]+/giu, '_')}`
          : '';
      downloadFbsBlob(
        blob,
        `FBS_товары_${dateFrom}_${dateTo}${suffix}.xlsx`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось скачать Excel.',
      );
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="fbs-product-report">
      <form className="fbs-product-report__period" onSubmit={submit}>
        <label>
          <span>Период с</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>
        <label>
          <span>по</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
        <button className="button button-primary" type="submit" disabled={loading}>
          {loading ? <RefreshCw className="is-spinning" size={17} /> : <BarChart3 size={17} />}
          Сформировать отчёт
        </button>
      </form>

      {error ? <p className="fbs-product-report__error">{error}</p> : null}

      <section className="fbs-product-report__window">
        <header>
          <div>
            <p className="eyebrow">Окно 1</p>
            <h4>Полный список товаров за период</h4>
            <p>
              Учитываются завершённые FBS-отгрузки выбранного клиента в текущем
              филиале.
            </p>
          </div>
          <button
            type="button"
            className="button button-secondary"
            disabled={!report || downloading !== null}
            onClick={() => void download('all')}
          >
            {downloading === 'all' ? (
              <RefreshCw className="is-spinning" size={17} />
            ) : (
              <Download size={17} />
            )}
            Скачать весь отчёт
          </button>
        </header>
        {report ? (
          <>
            <FbsProductReportSummary summary={report.summary} />
            <FbsProductReportTable rows={report.rows} />
          </>
        ) : loading ? (
          <FbsNotice
            icon={RefreshCw}
            title="Формирую отчёт"
            text="Собираю завершённые FBS-отгрузки и группирую товары."
          />
        ) : null}
      </section>

      <section className="fbs-product-report__window fbs-product-report__window--search">
        <header>
          <div>
            <p className="eyebrow">Окно 2</p>
            <h4>Поиск продаж по ключевому слову</h4>
            <p>
              Поиск работает по названию, SKU, артикулу, размеру, штрихкоду,
              номеру заказа и поставки WB.
            </p>
          </div>
          <button
            type="button"
            className="button button-secondary"
            disabled={!keyword.trim() || !report || downloading !== null}
            onClick={() => void download('filtered')}
          >
            {downloading === 'filtered' ? (
              <RefreshCw className="is-spinning" size={17} />
            ) : (
              <Download size={17} />
            )}
            Скачать найденное
          </button>
        </header>
        <label className="fbs-product-report__keyword">
          <Search size={18} aria-hidden="true" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="Например: Корея"
          />
        </label>
        {keyword.trim() ? (
          <>
            <FbsProductReportSummary summary={filteredSummary} />
            <FbsProductReportTable rows={filteredRows} />
          </>
        ) : (
          <div className="fbs-product-report__hint">
            Введите часть названия, артикула или номер заказа WB.
          </div>
        )}
      </section>
    </div>
  );
}

function FbsProductReportSummary({
  summary,
}: {
  summary: {
    products: number;
    quantity: number;
    orders: number;
    requests: number;
  };
}) {
  return (
    <div className="fbs-product-report__summary">
      <span><small>Товаров</small><strong>{summary.products.toLocaleString('ru-RU')}</strong></span>
      <span><small>Отгружено, шт.</small><strong>{summary.quantity.toLocaleString('ru-RU')}</strong></span>
      <span><small>Заказов WB</small><strong>{summary.orders.toLocaleString('ru-RU')}</strong></span>
      <span><small>Заявок WMS</small><strong>{summary.requests.toLocaleString('ru-RU')}</strong></span>
    </div>
  );
}

function FbsProductReportTable({
  rows,
}: {
  rows: FbsProductShipmentReportRow[];
}) {
  if (!rows.length) {
    return (
      <div className="fbs-product-report__empty">
        За выбранный период подходящих отгрузок не найдено.
      </div>
    );
  }
  return (
    <div className="fbs-table-wrap fbs-product-report__table">
      <table className="fbs-table">
        <thead>
          <tr>
            <th>Товар</th>
            <th>Артикул / SKU</th>
            <th>Размер</th>
            <th>Отгружено</th>
            <th>Заказов WB</th>
            <th>Номера заказов WB</th>
            <th>Поставки WB</th>
            <th>Заявки WMS</th>
            <th>Последняя отгрузка</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.skuId || `${row.productName}-${row.barcode}-${index}`}>
              <td>
                <strong>{row.productName}</strong>
                <small>{[row.color, row.barcode].filter(Boolean).join(' · ')}</small>
              </td>
              <td>
                <strong>{row.article || row.clientSku || row.internalSku || '—'}</strong>
                <small>{row.internalSku}</small>
              </td>
              <td>{row.size || '—'}</td>
              <td><strong>{row.quantity.toLocaleString('ru-RU')} шт.</strong></td>
              <td>{row.orders.toLocaleString('ru-RU')}</td>
              <td className="fbs-product-report__numbers">{row.wbOrderNumbers || '—'}</td>
              <td className="fbs-product-report__numbers">{row.wbSupplyNumbers || '—'}</td>
              <td className="fbs-product-report__numbers">{row.wmsRequestNumbers || '—'}</td>
              <td>{row.lastShippedAt ? formatDateTime(row.lastShippedAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fbsProductReportSummary(rows: FbsProductShipmentReportRow[]) {
  const orderNumbers = new Set<string>();
  const requestNumbers = new Set<string>();
  for (const row of rows) {
    row.wbOrderNumbers
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => orderNumbers.add(value));
    row.wmsRequestNumbers
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => requestNumbers.add(value));
  }
  return {
    products: rows.length,
    quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    orders: orderNumbers.size,
    requests: requestNumbers.size,
  };
}

function normalizeFbsReportSearch(value: string) {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
}

function fbsReportInitialPeriod() {
  const today = new Date();
  const dateTo = fbsLocalIsoDate(today);
  const dateFrom = `${dateTo.slice(0, 7)}-01`;
  return { dateFrom, dateTo };
}

function fbsLocalIsoDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
    value.getDate(),
  ).padStart(2, '0')}`;
}

function FbsAssemblyDestinationDialog({
  orders,
  destination,
  mode,
  isSubmitting,
  onDestinationChange,
  onCancel,
  onSubmit,
}: {
  orders: FbsOrderSummary[];
  destination: FbsDeliveryDestination;
  mode: 'assemble' | 'reship';
  isSubmitting: boolean;
  onDestinationChange: (destination: FbsDeliveryDestination) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const itemCount = orders.reduce((sum, order) => sum + Math.max(1, order.itemCount), 0);
  const cargoPlaceCount = estimateFbsCargoPlaces(orders);
  const pickupPointUnavailable = orders.filter((order) => !order.pickupPointShipmentAllowed);
  const pickupBlocked = destination === 'PICKUP_POINT' && pickupPointUnavailable.length > 0;

  return (
    <div className="fbs-assembly-dialog-backdrop" role="presentation">
      <section className="fbs-assembly-dialog" role="dialog" aria-modal="true" aria-labelledby="fbs-assembly-title">
        <div className="fbs-assembly-dialog__icon">
          <Truck size={24} aria-hidden="true" />
        </div>
        <div className="fbs-assembly-dialog__heading">
          <p className="eyebrow">{mode === 'reship' ? 'Повторная отгрузка FBS' : 'Новая поставка FBS'}</p>
          <h3 id="fbs-assembly-title">Куда сдаём выбранные заказы?</h3>
          <p>{orders.length} заказов · {itemCount} единиц товара</p>
        </div>

        <div className="fbs-assembly-dialog__choices">
          <button
            type="button"
            className={destination === 'PICKUP_POINT' ? 'is-selected' : undefined}
            onClick={() => onDestinationChange('PICKUP_POINT')}
          >
            <MapPin size={21} aria-hidden="true" />
            <span>
              <strong>Пункт выдачи заказов</strong>
              <small>WMS создаст {cargoPlaceCount} грузомест без ограничения количества и получит для них QR.</small>
            </span>
          </button>
          <button
            type="button"
            className={destination === 'VNUKOVO_SORTING_CENTER' ? 'is-selected' : undefined}
            onClick={() => onDestinationChange('VNUKOVO_SORTING_CENTER')}
          >
            <Boxes size={21} aria-hidden="true" />
            <span>
              <strong>Сортировочный центр WB</strong>
              <small>Грузоместа не создаются. После передачи в доставку станет доступен QR поставки.</small>
            </span>
          </button>
        </div>

        {pickupBlocked ? (
          <p className="fbs-assembly-dialog__warning">
            Wildberries не разрешает сдачу через ПВЗ для заказов: {pickupPointUnavailable.map((order) => order.id).join(', ')}.
            Выберите сортировочный центр.
          </p>
        ) : null}

        <div className="fbs-assembly-dialog__actions">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={isSubmitting}>
            Отмена
          </button>
          <button type="button" className="button button-primary" onClick={onSubmit} disabled={pickupBlocked || isSubmitting}>
            {isSubmitting ? 'Создаю поставку…' : destination === 'PICKUP_POINT'
              ? `${mode === 'reship' ? 'Переотгрузить' : 'Собрать'} и создать ${cargoPlaceCount} мест`
              : mode === 'reship' ? 'Переотгрузить через СЦ' : 'Собрать для СЦ'}
          </button>
        </div>
      </section>
    </div>
  );
}

function FbsDeliveryRecoveryDialog({
  rescanOrders,
  cancelledOrders,
  onClose,
}: {
  rescanOrders: FbsDeliveryRecoveryItem[];
  cancelledOrders: FbsDeliveryRecoveryItem[];
  onClose: () => void;
}) {
  return (
    <div className="fbs-assembly-dialog-backdrop" role="presentation">
      <section
        className="fbs-assembly-dialog fbs-delivery-recovery"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fbs-delivery-recovery-title"
      >
        <div className="fbs-assembly-dialog__icon fbs-delivery-recovery__icon">
          <AlertTriangle size={24} aria-hidden="true" />
        </div>
        <div className="fbs-assembly-dialog__heading">
          <p className="eyebrow">Передача в Wildberries завершилась ошибкой</p>
          <h3 id="fbs-delivery-recovery-title">Нужны действия только по проблемным заказам</h3>
          <p>Остальная заявка остаётся собранной — повторно сканировать её не нужно.</p>
        </div>

        <div className="fbs-delivery-recovery__content">
          {rescanOrders.length > 0 ? (
            <RecoveryOrderGroup
              title="Повторно отсканировать на ТСД"
              description="Эти заказы уже возвращены в очередь сборки. Отсканируйте заново только ШК товара и, если требуется, ЧЗ."
              tone="rescan"
              orders={rescanOrders}
            />
          ) : null}

          {cancelledOrders.length > 0 ? (
            <RecoveryOrderGroup
              title="Заказы отменены в WB — товар нужно выложить"
              description="Не сканируйте их повторно. Найдите товар по указанному грузоместу или коробу и выложите из отправки."
              tone="cancelled"
              orders={cancelledOrders}
            />
          ) : null}

          {rescanOrders.length === 0 && cancelledOrders.length === 0 ? (
            <p className="fbs-delivery-recovery__empty">
              Wildberries не указал конкретный проблемный заказ. Состав заявки не изменён.
            </p>
          ) : null}
        </div>

        <div className="fbs-assembly-dialog__actions">
          <button type="button" className="button button-primary" onClick={onClose}>
            Понятно
          </button>
        </div>
      </section>
    </div>
  );
}

function RecoveryOrderGroup({
  title,
  description,
  tone,
  orders,
}: {
  title: string;
  description: string;
  tone: 'rescan' | 'cancelled';
  orders: FbsDeliveryRecoveryItem[];
}) {
  return (
    <section className={`fbs-delivery-recovery__group is-${tone}`}>
      <div className="fbs-delivery-recovery__group-heading">
        {tone === 'rescan' ? <RefreshCw size={18} aria-hidden="true" /> : <XCircle size={18} aria-hidden="true" />}
        <div>
          <strong>{title}</strong>
          <p>{description}</p>
        </div>
      </div>
      <div className="fbs-delivery-recovery__orders">
        {orders.map((order) => (
          <article className="fbs-delivery-recovery__order" key={`${tone}-${order.orderId}`}>
            <div className="fbs-delivery-recovery__order-title">
              <strong>WB №{order.orderId}</strong>
              {order.requestNumber ? <span>Заявка №{order.requestNumber}</span> : null}
            </div>
            <p className="fbs-delivery-recovery__product">
              {order.productName}
              {order.size ? <b> · размер {order.size}</b> : null}
            </p>
            <dl className="fbs-delivery-recovery__details">
              {order.article ? (
                <div><dt>Артикул</dt><dd>{order.article}</dd></div>
              ) : null}
              {order.boxCode ? (
                <div><dt>Короб</dt><dd>{order.boxCode}</dd></div>
              ) : null}
              {order.cargoPlaceCode ? (
                <div><dt>Грузоместо</dt><dd>{order.cargoPlaceCode}</dd></div>
              ) : null}
              {order.barcode ? (
                <div><dt>ШК</dt><dd>{order.barcode}</dd></div>
              ) : null}
              {order.kiz ? (
                <div><dt>ЧЗ</dt><dd className="fbs-delivery-recovery__kiz">{order.kiz}</dd></div>
              ) : null}
            </dl>
            <p className="fbs-delivery-recovery__reason">{order.reason}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FbsStocksView({
  clientId,
  session,
  search,
}: {
  clientId: string;
  session: AuthSession;
  search: string;
}) {
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error';
    data: FbsStocksResponse | null;
    error: string;
  }>({
    status: 'loading',
    data: null,
    error: '',
  });
  const [actionSkuId, setActionSkuId] = useState<string | null>(null);
  const [connectingWarehouse, setConnectingWarehouse] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshingReserves, setRefreshingReserves] = useState(false);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SELLING' | 'STOPPED' | 'UNMANAGED'>('ALL');
  const [showZeroWmsStock, setShowZeroWmsStock] = useState(false);
  const [selectedSkuIds, setSelectedSkuIds] = useState<Set<string>>(() => new Set());
  const [saleLimits, setSaleLimits] = useState<Record<string, string>>({});
  const [relabelAmounts, setRelabelAmounts] = useState<Record<string, string>>({});
  const [bulkSaleLimit, setBulkSaleLimit] = useState('');
  const [bulkAction, setBulkAction] = useState<boolean | null>(null);
  const [routingOpen, setRoutingOpen] = useState(false);
  const [routingBranches, setRoutingBranches] = useState<FbsWarehouseRoutesResponse['branches']>([]);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [routingSaving, setRoutingSaving] = useState(false);
  const [routingError, setRoutingError] = useState('');
  const [routingData, setRoutingData] = useState<FbsWarehouseRoutesResponse | null>(null);
  const [routingDrafts, setRoutingDrafts] = useState<Record<string, {
    mode: FbsWarehouseRouteMode;
    executionWarehouseId: string;
    dropoffWarehouseId: string;
  }>>({});
  const [routingForm, setRoutingForm] = useState({
    executionWarehouseId: '',
    dropoffWarehouseId: '',
    autoRouteNewWarehouses: false,
  });
  const canManageRouting =
    session.user.permissionCodes.includes('system:admin') ||
    session.user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER');

  const loadStocks = useCallback(async (
    connectionId?: string,
    warehouseId?: string,
    refreshReserves = false,
  ) => {
    setState((current) => ({ status: 'loading', data: current.data, error: '' }));
    try {
      const data = await fetchFbsStocks(
        session.accessToken,
        clientId,
        connectionId || undefined,
        warehouseId || undefined,
        refreshReserves,
      );
      setState({ status: 'ready', data, error: '' });
      setPage(0);
      return data;
    } catch (caught) {
      setState((current) => ({
        status: 'error',
        data: current.data,
        error: caught instanceof Error ? caught.message : 'Не удалось загрузить остатки FBS.',
      }));
      return null;
    }
  }, [clientId, session.accessToken]);

  async function openRoutingSettings() {
    const connection = state.data?.connections.find(
      (item) => item.id === state.data?.selectedConnectionId,
    );
    if (!connection) return;

    setRoutingForm({
      executionWarehouseId: connection.fbsExecutionWarehouseId ?? '',
      dropoffWarehouseId: connection.fbsDropoffWarehouseId ?? '',
      autoRouteNewWarehouses: connection.fbsAutoRouteNewWarehouses,
    });
    setRoutingError('');
    setRoutingData(null);
    setRoutingDrafts({});
    setRoutingOpen(true);

    setRoutingLoading(true);
    try {
      const routes = await fetchFbsWarehouseRoutes(session.accessToken, connection.id);
      const branches = routes.branches;
      setRoutingBranches(
        branches
          .filter((branch) => branch.isActive)
          .sort((left, right) => left.sortOrder - right.sortOrder || left.city.localeCompare(right.city, 'ru')),
      );
      setRoutingData(routes);
      setRoutingDrafts(Object.fromEntries(routes.warehouses.map((warehouse) => [
        warehouse.marketplaceWarehouseId,
        {
          mode: warehouse.mode,
          executionWarehouseId: warehouse.executionWarehouseId ?? '',
          dropoffWarehouseId: warehouse.dropoffWarehouseId ?? '',
        },
      ])));
    } catch (caught) {
      setRoutingError(
        caught instanceof Error ? caught.message : 'Не удалось загрузить склады WB и филиалы.',
      );
    } finally {
      setRoutingLoading(false);
    }
  }

  async function saveRoutingSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const connectionId = state.data?.selectedConnectionId;
    if (!connectionId) return;
    if (routingForm.autoRouteNewWarehouses && !routingForm.executionWarehouseId) {
      setRoutingError('Выберите филиал исполнения.');
      return;
    }
    const branchWithoutExecution = routingData?.warehouses.find((warehouse) => {
      const draft = routingDrafts[warehouse.marketplaceWarehouseId];
      return draft?.mode === 'BRANCH' && !draft.executionWarehouseId;
    });
    if (branchWithoutExecution) {
      setRoutingError(`Выберите филиал исполнения для склада «${branchWithoutExecution.marketplaceWarehouseName}».`);
      return;
    }

    setRoutingSaving(true);
    setRoutingError('');
    try {
      await updateMarketplaceConnection(session.accessToken, connectionId, {
        fbsExecutionWarehouseId: routingForm.executionWarehouseId,
        fbsDropoffWarehouseId: routingForm.dropoffWarehouseId,
        fbsAutoRouteNewWarehouses: routingForm.autoRouteNewWarehouses,
      });
      if (routingData) {
        await updateFbsWarehouseRoutes(session.accessToken, connectionId, {
          items: routingData.warehouses.map((warehouse) => {
            const draft = routingDrafts[warehouse.marketplaceWarehouseId] ?? {
              mode: warehouse.mode,
              executionWarehouseId: warehouse.executionWarehouseId ?? '',
              dropoffWarehouseId: warehouse.dropoffWarehouseId ?? '',
            };
            return {
              marketplaceWarehouseId: warehouse.marketplaceWarehouseId,
              marketplaceWarehouseName: warehouse.marketplaceWarehouseName,
              officeId: warehouse.officeId ?? undefined,
              officeName: warehouse.officeName ?? undefined,
              officeCity: warehouse.officeCity ?? undefined,
              mode: draft.mode,
              executionWarehouseId: draft.executionWarehouseId || undefined,
              dropoffWarehouseId: draft.dropoffWarehouseId || undefined,
            };
          }),
        });
      }
      await loadStocks(connectionId, state.data?.selectedWarehouseId ?? undefined);
      setRoutingOpen(false);
      setMessage('Маршрутизация FBS сохранена. Индивидуальные правила применятся к новым заказам.');
    } catch (caught) {
      setRoutingError(
        caught instanceof Error ? caught.message : 'Не удалось сохранить маршрутизацию FBS.',
      );
    } finally {
      setRoutingSaving(false);
    }
  }

  useEffect(() => {
    setMessage('');
    setActionSkuId(null);
    setSelectedSkuIds(new Set());
    setSaleLimits({});
    setRelabelAmounts({});
    setBulkSaleLimit('');
    setBulkAction(null);
    void loadStocks();
  }, [loadStocks]);

  useEffect(() => {
    setPage(0);
  }, [search]);

  useEffect(() => {
    setSelectedSkuIds((current) => {
      const available = new Set((state.data?.items ?? []).map((item) => item.skuId));
      return new Set([...current].filter((skuId) => available.has(skuId)));
    });
  }, [state.data?.items]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
    const items = state.data?.items ?? [];
    return items.filter((item) => {
      if (!showZeroWmsStock && item.wmsAvailable <= 0 && item.wbAmount <= item.sellable) {
        return false;
      }
      if (statusFilter !== 'ALL' && item.status !== statusFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }

      return [
        item.name,
        item.article,
        item.internalSku,
        item.clientSku,
        item.barcode,
        item.nmId,
        item.chrtId,
        item.color,
        item.size,
        item.status === 'SELLING'
          ? 'продавать'
          : item.status === 'STOPPED'
            ? 'не продавать'
            : 'не настроено',
      ].some((value) => value?.toLocaleLowerCase('ru-RU').includes(normalizedSearch));
    });
  }, [search, showZeroWmsStock, state.data?.items, statusFilter]);

  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleItems = filteredItems.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const selectedConnectionId = state.data?.selectedConnectionId ?? '';
  const selectedWarehouseId = state.data?.selectedWarehouseId ?? '';
  const connectedWarehouseId = state.data?.connectedWarehouseId ?? '';
  const selectedWarehouse = state.data?.warehouses.find((warehouse) => warehouse.id === selectedWarehouseId) ?? null;
  const warehouseConnected = Boolean(
    selectedWarehouseId && connectedWarehouseId === selectedWarehouseId,
  );
  const positiveFreeSkuIds = (state.data?.items ?? [])
    .filter((item) => item.sellable > 0)
    .map((item) => item.skuId);
  const selectedPositiveFreeCount = positiveFreeSkuIds.filter((skuId) => selectedSkuIds.has(skuId)).length;
  const allPositiveFreeSelected = positiveFreeSkuIds.length > 0 && selectedPositiveFreeCount === positiveFreeSkuIds.length;
  const hasSelection = selectedSkuIds.size > 0;

  function getSaleLimitValue(item: FbsStocksResponse['items'][number]) {
    const draft = saleLimits[item.skuId];
    if (draft === undefined) {
      return item.saleLimit;
    }
    if (draft.trim() === '') {
      return null;
    }
    const numeric = Number(draft);
    return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : null;
  }

  function getRequestedAmount(item: FbsStocksResponse['items'][number], saleLimit: number | null) {
    return saleLimit ?? item.sellable;
  }

  function getShortage(item: FbsStocksResponse['items'][number], requestedAmount: number) {
    const localShortage = Math.max(0, requestedAmount - item.sellable);
    return Math.max(item.shortage ? item.shortageAmount : 0, localShortage);
  }

  function toggleSku(skuId: string) {
    setSelectedSkuIds((current) => {
      const next = new Set(current);
      if (next.has(skuId)) next.delete(skuId);
      else next.add(skuId);
      return next;
    });
  }

  function toggleAllPositiveFreeSelection() {
    setSelectedSkuIds((current) => {
      const next = new Set(current);
      if (allPositiveFreeSelected) positiveFreeSkuIds.forEach((skuId) => next.delete(skuId));
      else positiveFreeSkuIds.forEach((skuId) => next.add(skuId));
      return next;
    });
  }

  function updateSaleLimit(skuId: string, value: string) {
    setSaleLimits((current) => ({
      ...current,
      [skuId]: value,
    }));
  }

  function getRelabelAmountValue(item: FbsStocksResponse['items'][number]) {
    const draft = relabelAmounts[item.skuId];
    if (draft === undefined) return item.relabelManualAmount;
    if (draft.trim() === '') return null;
    const numeric = Number(draft);
    return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : null;
  }

  function updateRelabelAmount(skuId: string, value: string) {
    setRelabelAmounts((current) => ({ ...current, [skuId]: value }));
  }

  async function setPublication(
    skuId: string,
    enabled: boolean,
    saleLimit?: number | null,
    relabelManualAmount?: number | null,
  ) {
    if (!selectedConnectionId || !selectedWarehouseId || !warehouseConnected) {
      return;
    }

    setActionSkuId(skuId);
    setMessage('');
    try {
      const result = await updateFbsStockPublication(session.accessToken, {
        clientId,
        connectionId: selectedConnectionId,
        warehouseId: selectedWarehouseId,
        skuId,
        enabled,
        ...(enabled && saleLimit !== undefined ? { saleLimit } : {}),
        ...(enabled && relabelManualAmount !== undefined ? { relabelManualAmount } : {}),
      });
      setMessage(
        enabled
          ? `Товар включён в продажу. В Wildberries передано: ${result.amount.toLocaleString('ru-RU')} шт.`
          : 'Продажа товара остановлена. В Wildberries передан остаток 0 шт.',
      );
      await loadStocks(selectedConnectionId, selectedWarehouseId);
    } catch (caught) {
      setState((current) => ({
        status: 'error',
        data: current.data,
        error: caught instanceof Error ? caught.message : 'Не удалось изменить статус продажи.',
      }));
    } finally {
      setActionSkuId(null);
    }
  }

  async function correctWbExcess(item: FbsStocksResponse['items'][number]) {
    if (!selectedConnectionId || !selectedWarehouseId || !warehouseConnected) return;
    setActionSkuId(item.skuId);
    setMessage('');
    try {
      const result = await reconcileFbsStockItem(session.accessToken, {
        clientId,
        connectionId: selectedConnectionId,
        warehouseId: selectedWarehouseId,
        skuId: item.skuId,
      });
      setMessage(
        result.corrected
          ? `Остаток WB исправлен: было ${result.previousAmount.toLocaleString('ru-RU')} шт., стало ${result.amount.toLocaleString('ru-RU')} шт.`
          : 'Повторная проверка выполнена: превышения уже нет.',
      );
      await loadStocks(selectedConnectionId, selectedWarehouseId);
    } catch (caught) {
      setState((current) => ({
        status: 'error',
        data: current.data,
        error: caught instanceof Error ? caught.message : 'Не удалось исправить остаток WB.',
      }));
    } finally {
      setActionSkuId(null);
    }
  }

  async function setPublicationBulk(enabled: boolean) {
    if (!selectedConnectionId || !selectedWarehouseId || !warehouseConnected || selectedSkuIds.size === 0) return;
    const skuIds = [...selectedSkuIds];
    const requestedLimit = bulkSaleLimit.trim() === '' ? null : Number(bulkSaleLimit);
    if (requestedLimit !== null && (!Number.isFinite(requestedLimit) || requestedLimit < 0)) {
      setState((current) => ({
        status: 'error',
        data: current.data,
        error: 'Введите корректное количество для продажи.',
      }));
      return;
    }
    setBulkAction(enabled);
    setMessage('');
    try {
      const result = await updateFbsStockPublicationBulk(session.accessToken, {
        clientId,
        connectionId: selectedConnectionId,
        warehouseId: selectedWarehouseId,
        skuIds,
        enabled,
        ...(enabled ? { saleLimit: requestedLimit === null ? null : Math.trunc(requestedLimit) } : {}),
      });
      setSelectedSkuIds(new Set());
      setSaleLimits({});
      setRelabelAmounts({});
      setBulkSaleLimit('');
      setMessage(
        `${enabled ? 'Включено' : 'Остановлено'} товаров: ${result.updatedProducts.toLocaleString('ru-RU')}. ` +
          `В Wildberries передано: ${result.amount.toLocaleString('ru-RU')} шт.`,
      );
      await loadStocks(selectedConnectionId, selectedWarehouseId);
    } catch (caught) {
      setState((current) => ({
        status: 'error',
        data: current.data,
        error: caught instanceof Error ? caught.message : 'Не удалось массово изменить статус продажи.',
      }));
    } finally {
      setBulkAction(null);
    }
  }

  async function synchronizeManagedStocks() {
    if (!selectedConnectionId || !selectedWarehouseId || !warehouseConnected) {
      return;
    }
    if (!window.confirm('Передать в Wildberries актуальные остатки всех настроенных товаров?')) {
      return;
    }

    setSyncing(true);
    setMessage('');
    try {
      const result = await syncFbsStocks(session.accessToken, {
        clientId,
        connectionId: selectedConnectionId,
        warehouseId: selectedWarehouseId,
      });
      setMessage(`Синхронизировано товаров: ${result.synced.toLocaleString('ru-RU')}.`);
      await loadStocks(selectedConnectionId, selectedWarehouseId);
    } catch (caught) {
      setState((current) => ({
        status: 'error',
        data: current.data,
        error: caught instanceof Error ? caught.message : 'Не удалось синхронизировать остатки.',
      }));
    } finally {
      setSyncing(false);
    }
  }

  async function refreshReserves() {
    if (!selectedConnectionId || !selectedWarehouseId) {
      return;
    }
    setRefreshingReserves(true);
    setMessage('');
    try {
      const refreshed = await loadStocks(selectedConnectionId, selectedWarehouseId, true);
      if (refreshed) {
        const totalReserved = refreshed.items.reduce((sum, item) => sum + item.reserved, 0);
        setMessage(`Резервы обновлены. Сейчас зарезервировано: ${totalReserved.toLocaleString('ru-RU')} шт.`);
      }
    } finally {
      setRefreshingReserves(false);
    }
  }

  async function connectSelectedWarehouse() {
    if (!selectedConnectionId || !selectedWarehouseId || warehouseConnected) return;
    setConnectingWarehouse(true);
    setMessage('');
    try {
      const result = await connectFbsStockWarehouse(session.accessToken, {
        clientId,
        connectionId: selectedConnectionId,
        warehouseId: selectedWarehouseId,
      });
      setMessage(`Склад «${result.warehouseName}» подключён как рабочий склад продаж FBS.`);
      await loadStocks(selectedConnectionId, selectedWarehouseId);
    } catch (caught) {
      setState((current) => ({
        status: 'error',
        data: current.data,
        error: caught instanceof Error ? caught.message : 'Не удалось подключить склад FBS.',
      }));
    } finally {
      setConnectingWarehouse(false);
    }
  }

  if (state.status === 'loading' && !state.data) {
    return <FbsNotice icon={RefreshCw} title="Получаю остатки" text="Сверяем товары WMS с кабинетом Wildberries." />;
  }

  if (state.status === 'error' && !state.data) {
    return <FbsNotice icon={AlertTriangle} title="Не удалось получить остатки" text={state.error} tone="error" />;
  }

  const data = state.data;
  if (!data?.connected) {
    return (
      <FbsNotice
        icon={PlugZap}
        title="Wildberries не подключён"
        text="Подключите API Wildberries в настройках клиента, чтобы управлять остатками FBS."
      />
    );
  }

  if (!selectedWarehouseId) {
    return (
      <FbsNotice
        icon={Warehouse}
        title="Склад Wildberries не найден"
        text="Создайте склад FBS в кабинете продавца Wildberries, затем снова откройте раздел."
      />
    );
  }

  return (
    <section className="fbs-stocks">
      <div className="fbs-stocks__intro">
        <div>
          <p className="eyebrow">Товары FBS · WMS → Wildberries</p>
          <h3>Управление статусом «Продавать / Не продавать»</h3>
          <p>
            WMS передаёт только количество. Карточки, цены и другие настройки товара не изменяются.
          </p>
        </div>
        <div className="fbs-stocks__header-actions">
          {canManageRouting ? (
            <button
              type="button"
              className="button button-secondary fbs-stocks__routing-button"
              onClick={() => void openRoutingSettings()}
              title="Настройки маршрутизации FBS"
              aria-label="Открыть настройки маршрутизации FBS"
            >
              <MoreVertical size={18} aria-hidden="true" />
              Маршрутизация
            </button>
          ) : null}
          <button
            type="button"
            className="button button-secondary fbs-stocks__sync"
            onClick={() => void connectSelectedWarehouse()}
            disabled={
              warehouseConnected ||
              connectingWarehouse ||
              refreshingReserves ||
              syncing ||
              actionSkuId !== null ||
              bulkAction !== null
            }
          >
            {warehouseConnected
              ? <CircleCheckBig size={16} aria-hidden="true" />
              : <PlugZap size={16} aria-hidden="true" />}
            {connectingWarehouse
              ? 'Подключаю склад'
              : warehouseConnected
                ? 'Склад FBS подключён'
                : 'Подключить выбранный склад FBS'}
          </button>
          <button
            type="button"
            className="button button-secondary fbs-stocks__sync"
            onClick={() => void refreshReserves()}
            disabled={refreshingReserves || syncing || actionSkuId !== null || bulkAction !== null}
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
              className={refreshingReserves ? 'is-spinning' : undefined}
            />
            {refreshingReserves ? 'Обновляю резервы' : 'Обновить резервы'}
          </button>
          <button
            type="button"
            className="button button-primary fbs-stocks__sync"
            onClick={() => void synchronizeManagedStocks()}
            disabled={
              !warehouseConnected ||
              refreshingReserves ||
              syncing ||
              actionSkuId !== null ||
              bulkAction !== null ||
              data.summary.enabled + data.summary.disabled === 0
            }
          >
            <RefreshCw size={16} aria-hidden="true" className={syncing ? 'is-spinning' : undefined} />
            {syncing ? 'Синхронизирую' : 'Синхронизировать выбранные'}
          </button>
        </div>
      </div>

      <div className="fbs-stocks__selectors">
        <label>
          <span>Подключение WB</span>
          <select
            value={selectedConnectionId}
            disabled={refreshingReserves || syncing || actionSkuId !== null}
            onChange={(event) => {
              setSelectedSkuIds(new Set());
              setSaleLimits({});
              setRelabelAmounts({});
              setBulkSaleLimit('');
              void loadStocks(event.target.value);
            }}
          >
            {data.connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.accountName || 'Wildberries'}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Склад WB</span>
          <select
            value={selectedWarehouseId}
            disabled={refreshingReserves || syncing || actionSkuId !== null}
            onChange={(event) => {
              setSelectedSkuIds(new Set());
              setSaleLimits({});
              setRelabelAmounts({});
              setBulkSaleLimit('');
              void loadStocks(selectedConnectionId, event.target.value);
            }}
          >
            {data.warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Статус продажи</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="ALL">Все товары</option>
            <option value="SELLING">Продавать</option>
            <option value="STOPPED">Не продавать</option>
            <option value="UNMANAGED">Не настроено</option>
          </select>
        </label>
        <label className="fbs-stocks__show-zero">
          <input
            type="checkbox"
            checked={showZeroWmsStock}
            onChange={(event) => setShowZeroWmsStock(event.target.checked)}
          />
          <span>Показывать товары с нулевым остатком WMS</span>
        </label>
      </div>

      <div className={`fbs-stocks__warehouse-status ${warehouseConnected ? 'is-connected' : ''}`}>
        <Warehouse size={18} aria-hidden="true" />
        <div>
          <strong>
            {warehouseConnected
              ? `Рабочий склад FBS: ${selectedWarehouse?.name || data.connectedWarehouseName || selectedWarehouseId}`
              : data.connectedWarehouseName
                ? `Сейчас подключён: ${data.connectedWarehouseName}`
                : 'Рабочий склад FBS ещё не подключён'}
          </strong>
          <span>
            {warehouseConnected
              ? 'Публикация и синхронизация остатков выполняются только в этот склад Wildberries.'
              : 'Выберите склад WB, созданный для продаж FBS, и нажмите «Подключить выбранный склад FBS».'}
          </span>
        </div>
      </div>

      {warehouseConnected ? (
        <div className="fbs-stocks__auto-sync">
          <RefreshCw size={18} aria-hidden="true" />
          <div>
            <strong>Автоматическая синхронизация включена</strong>
            <span>
              WMS проверяет новые заказы, резервы и складские изменения каждую минуту и передаёт в WB только свободный остаток выбранного филиала.
            </span>
          </div>
        </div>
      ) : null}

      <div
        className={`fbs-stocks__health ${data.summary.excessProducts > 0 ? 'is-danger' : 'is-ok'}`}
        role="status"
      >
        {data.summary.excessProducts > 0 ? (
          <AlertTriangle size={22} aria-hidden="true" />
        ) : (
          <CircleCheckBig size={22} aria-hidden="true" />
        )}
        <div>
          <strong>
            {data.summary.excessProducts > 0
              ? 'Остатки WB превышают доступный остаток WMS'
              : 'Остатки WB соответствуют складу WMS'}
          </strong>
          <span>
            {data.summary.excessProducts > 0
              ? `${data.summary.excessProducts.toLocaleString('ru-RU')} товар(ов) нужно исправить · превышение ${data.summary.excessUnits.toLocaleString('ru-RU')} шт.`
              : 'Ни по одному товару количество на WB не превышает свободный остаток WMS.'}
          </span>
        </div>
      </div>

      <div className="fbs-stocks__summary">
        <div>
          <span>Товаров сопоставлено</span>
          <strong>{data.summary.products.toLocaleString('ru-RU')}</strong>
        </div>
        <div className="is-green">
          <span>Продаются</span>
          <strong>{data.summary.enabled.toLocaleString('ru-RU')}</strong>
        </div>
        <div className="is-red">
          <span>Остановлены</span>
          <strong>{data.summary.disabled.toLocaleString('ru-RU')}</strong>
        </div>
        <div>
          <span>Не настроено</span>
          <strong>{data.summary.unmanaged.toLocaleString('ru-RU')}</strong>
        </div>
        <div>
          <span>Доступно к продаже</span>
          <strong>{data.summary.sellable.toLocaleString('ru-RU')} шт.</strong>
        </div>
        <div className={data.summary.differences > 0 ? 'is-amber' : 'is-green'}>
          <span>Расхождений с WB</span>
          <strong>{data.summary.differences.toLocaleString('ru-RU')}</strong>
        </div>
      </div>

      <div className="fbs-stocks__rule">
        <CircleCheckBig size={18} aria-hidden="true" />
        <span>
          Автосинхронизация уменьшает остаток WB при нехватке, но никогда не повышает его сама: если на WB 50,
          а в WMS 100, останется 50. Повышение выполняется только кнопкой «Обновить продажу». Для товара после
          переклейки отдельно укажите разрешённое количество — оно будет вычтено из исходного артикула.
        </span>
      </div>

      <div className="fbs-stocks__bulkbar">
        <label className="fbs-stocks__select-all">
          <input
            type="checkbox"
            checked={allPositiveFreeSelected}
            onChange={toggleAllPositiveFreeSelection}
            disabled={positiveFreeSkuIds.length === 0 || bulkAction !== null || actionSkuId !== null || syncing}
          />
          <span>
            {hasSelection
              ? `Выбрано товаров: ${selectedSkuIds.size.toLocaleString('ru-RU')}`
              : `Выбрать все товары с положительным свободным остатком (${positiveFreeSkuIds.length.toLocaleString('ru-RU')})`}
          </span>
        </label>
        <div className="fbs-stocks__bulk-actions">
          <label className="fbs-stocks__bulk-limit">
            <span>По сколько шт. каждого товара</span>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={bulkSaleLimit}
              onChange={(event) => setBulkSaleLimit(event.target.value)}
              disabled={!warehouseConnected || !hasSelection || bulkAction !== null || actionSkuId !== null || syncing}
              placeholder="Весь остаток"
            />
          </label>
          <button
            type="button"
            className="fbs-stocks__action fbs-stocks__action--on"
            disabled={!warehouseConnected || !hasSelection || bulkAction !== null || actionSkuId !== null || syncing}
            onClick={() => void setPublicationBulk(true)}
          >
            <Power size={14} aria-hidden="true" />
            {bulkAction === true ? 'Включаю…' : 'Продавать выбранные'}
          </button>
          <button
            type="button"
            className="fbs-stocks__action fbs-stocks__action--off"
            disabled={!warehouseConnected || !hasSelection || bulkAction !== null || actionSkuId !== null || syncing}
            onClick={() => void setPublicationBulk(false)}
          >
            <PowerOff size={14} aria-hidden="true" />
            {bulkAction === false ? 'Останавливаю…' : 'Не продавать выбранные'}
          </button>
        </div>
      </div>

      {message ? <p className="fbs-stocks__message">{message}</p> : null}
      {state.status === 'error' && state.error ? <p className="form-error">{state.error}</p> : null}

      <div className="fbs-table-wrap fbs-stocks__table-wrap">
        <table className="fbs-table fbs-stocks__table">
          <thead>
            <tr>
              <th className="fbs-stocks__select-cell" aria-label="Выбрать товары">
                <input
                  type="checkbox"
                  checked={allPositiveFreeSelected}
                  onChange={toggleAllPositiveFreeSelection}
                  disabled={positiveFreeSkuIds.length === 0 || bulkAction !== null || actionSkuId !== null || syncing}
                />
              </th>
              <th>Товар</th>
              <th>Идентификаторы</th>
              <th>WMS</th>
              <th>Резерв</th>
              <th>К продаже</th>
              <th>Лимит продажи</th>
              <th>В WB</th>
              <th>Статус и действие</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => {
              const busy = actionSkuId === item.skuId;
              const saleLimit = getSaleLimitValue(item);
              const relabelManualAmount = getRelabelAmountValue(item);
              const requestedAmount = item.relabeling.isTarget && relabelManualAmount !== null
                ? relabelManualAmount
                : getRequestedAmount(item, saleLimit);
              const appliesBulkLimit = selectedSkuIds.has(item.skuId) && bulkSaleLimit.trim() !== '';
              const bulkRequestedAmount = Number(bulkSaleLimit);
              const effectiveRequestedAmount = appliesBulkLimit && Number.isFinite(bulkRequestedAmount)
                ? Math.max(0, Math.trunc(bulkRequestedAmount))
                : requestedAmount;
              const shortageAmount = getShortage(item, effectiveRequestedAmount);
              const publishedAmount = item.publishedAmount ?? item.wbAmount;
              return (
                <tr
                  key={item.skuId}
                  className={[
                    shortageAmount > 0 ? 'fbs-stocks__row--shortage' : '',
                    item.wbAmount > item.sellable ? 'fbs-stocks__row--wb-excess' : '',
                  ].filter(Boolean).join(' ') || undefined}
                >
                  <td className="fbs-stocks__select-cell">
                    <input
                      type="checkbox"
                      checked={selectedSkuIds.has(item.skuId)}
                      onChange={() => toggleSku(item.skuId)}
                      disabled={bulkAction !== null || actionSkuId !== null || syncing}
                      aria-label={`Выбрать ${item.name}`}
                    />
                  </td>
                  <td>
                    <strong>{item.name}</strong>
                    <small>
                      {[item.article, item.color, item.size].filter(Boolean).join(' · ') || item.internalSku}
                    </small>
                    {item.relabeling.isTarget ? (
                      <small className="fbs-stocks__relabel-badge">После переклейки · настраивается вручную</small>
                    ) : null}
                    {item.relabeling.allocatedToTargets > 0 ? (
                      <small className="fbs-stocks__relabel-source">
                        Передано в переклейку: {item.relabeling.allocatedToTargets.toLocaleString('ru-RU')} шт.
                      </small>
                    ) : null}
                  </td>
                  <td>
                    <strong>{item.barcode || item.clientSku || item.internalSku}</strong>
                    <small>nmID {item.nmId} · chrtID {item.chrtId}</small>
                  </td>
                  <td><strong>{item.wmsAvailable.toLocaleString('ru-RU')}</strong></td>
                  <td><strong>{item.reserved.toLocaleString('ru-RU')}</strong></td>
                  <td><strong>{item.sellable.toLocaleString('ru-RU')}</strong></td>
                  <td>
                    <label className="fbs-stocks__limit-input">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={saleLimits[item.skuId] ?? (item.saleLimit === null ? '' : item.saleLimit)}
                        onChange={(event) => updateSaleLimit(item.skuId, event.target.value)}
                        disabled={busy || actionSkuId !== null || bulkAction !== null || syncing}
                        placeholder="Весь остаток"
                        aria-label={`Лимит продажи: ${item.name}`}
                      />
                      <small>{saleLimit === null ? 'Весь свободный остаток' : `В продажу: ${requestedAmount.toLocaleString('ru-RU')} шт.`}</small>
                    </label>
                    {item.relabeling.isTarget ? (
                      <label className="fbs-stocks__relabel-input">
                        <span>Остаток с учётом переклейки</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={relabelAmounts[item.skuId] ?? (item.relabelManualAmount === null ? '' : item.relabelManualAmount)}
                          onChange={(event) => updateRelabelAmount(item.skuId, event.target.value)}
                          disabled={busy || actionSkuId !== null || bulkAction !== null || syncing}
                          placeholder="Не добавлять исходный"
                          aria-label={`Ручной остаток после переклейки: ${item.name}`}
                        />
                        <small>
                          {relabelManualAmount === null
                            ? 'Исходный товар в этот остаток не включён'
                            : `Физически доступно: ${item.relabeling.capacity.toLocaleString('ru-RU')} шт. · из исходного: ${item.relabeling.allocatedFromSources.toLocaleString('ru-RU')} шт.`}
                        </small>
                      </label>
                    ) : null}
                  </td>
                  <td>
                    <strong>{publishedAmount.toLocaleString('ru-RU')}</strong>
                    {item.difference !== null && item.difference !== 0 ? (
                      <small className="fbs-stocks__difference">
                        нужно передать {item.targetAmount?.toLocaleString('ru-RU')}
                      </small>
                    ) : null}
                    {item.wbAmount > item.sellable ? (
                      <>
                        <small className="fbs-stocks__wb-excess">
                          На WB лишних {(item.wbAmount - item.sellable).toLocaleString('ru-RU')} шт.
                        </small>
                        <button
                          type="button"
                          className="fbs-stocks__fix-excess"
                          disabled={!warehouseConnected || busy || actionSkuId !== null || syncing}
                          onClick={() => void correctWbExcess(item)}
                        >
                          {busy ? <RefreshCw className="spin" size={13} /> : <CircleCheckBig size={13} />}
                          Исправить
                        </button>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span className={`fbs-stocks__status fbs-stocks__status--${item.status.toLocaleLowerCase()}`}>
                      {item.status === 'SELLING'
                        ? 'Продавать'
                        : item.status === 'STOPPED'
                          ? 'Не продавать'
                          : 'Не настроено'}
                    </span>
                    <div className="fbs-stocks__actions">
                      <button
                        type="button"
                        className="fbs-stocks__action fbs-stocks__action--on"
                        disabled={!warehouseConnected || busy || actionSkuId !== null || syncing}
                        onClick={() => void setPublication(
                          item.skuId,
                          true,
                          saleLimit,
                          item.relabeling.isTarget ? relabelManualAmount : undefined,
                        )}
                      >
                        <Power size={14} aria-hidden="true" />
                        {item.status === 'SELLING' ? 'Обновить продажу' : 'Продавать'}
                      </button>
                      <button
                        type="button"
                        className="fbs-stocks__action fbs-stocks__action--off"
                        disabled={!warehouseConnected || busy || actionSkuId !== null || syncing || item.status === 'STOPPED'}
                        onClick={() => void setPublication(item.skuId, false)}
                      >
                        <PowerOff size={14} aria-hidden="true" />
                        Не продавать
                      </button>
                    </div>
                    {shortageAmount > 0 ? (
                      <small className="fbs-stocks__shortage">
                        Недостаточно товара для продажи по FBS: не хватает {shortageAmount.toLocaleString('ru-RU')} шт.
                      </small>
                    ) : null}
                    {item.lastError ? <small className="fbs-stocks__row-error">{item.lastError}</small> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleItems.length === 0 ? (
          <div className="fbs-empty">
            <span><Search size={27} aria-hidden="true" /></span>
            <strong>{search.trim() ? `По запросу «${search.trim()}» ничего не найдено` : 'Нет сопоставленных товаров'}</strong>
            <p>
              {search.trim()
                ? 'Измените поисковый запрос.'
                : 'Проверьте штрихкоды и артикулы товаров в WMS и Wildberries.'}
            </p>
          </div>
        ) : null}
      </div>

      {pageCount > 1 ? (
        <div className="fbs-stocks__pager">
          <button
            type="button"
            className="button button-secondary"
            disabled={currentPage === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            Назад
          </button>
          <span>
            Страница {currentPage + 1} из {pageCount} · найдено {filteredItems.length.toLocaleString('ru-RU')}
          </span>
          <button
            type="button"
            className="button button-secondary"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
          >
            Далее
          </button>
        </div>
      ) : null}

      {routingOpen ? (
        <div className="fbs-assembly-dialog-backdrop" role="presentation">
          <form
            className="fbs-assembly-dialog fbs-routing-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fbs-routing-title"
            onSubmit={saveRoutingSettings}
          >
            <div className="fbs-assembly-dialog__icon fbs-routing-dialog__icon">
              <Settings2 size={24} aria-hidden="true" />
            </div>
            <div className="fbs-assembly-dialog__heading">
              <p className="eyebrow">Настройки подключения WB</p>
              <h3 id="fbs-routing-title">Маршрутизация FBS-заказов</h3>
              <p>
                {state.data?.connections.find((item) => item.id === selectedConnectionId)?.accountName || 'Wildberries'}
              </p>
            </div>

            <div className="fbs-routing-dialog__fields">
              <label>
                <span>Филиал исполнения всех FBS-заказов</span>
                <select
                  value={routingForm.executionWarehouseId}
                  disabled={routingLoading || routingSaving}
                  onChange={(event) => setRoutingForm((current) => ({
                    ...current,
                    executionWarehouseId: event.target.value,
                  }))}
                >
                  <option value="">Автоматически по городу склада WB</option>
                  {routingBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.city} · {branch.name} ({branch.code})
                    </option>
                  ))}
                </select>
                <small>Именно в этом филиале резервируются остатки и создаётся заявка на сборку.</small>
              </label>

              <label>
                <span>Место фактической сдачи</span>
                <select
                  value={routingForm.dropoffWarehouseId}
                  disabled={routingLoading || routingSaving}
                  onChange={(event) => setRoutingForm((current) => ({
                    ...current,
                    dropoffWarehouseId: event.target.value,
                  }))}
                >
                  <option value="">Не задано</option>
                  {routingBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.city} · {branch.name} ({branch.code})
                    </option>
                  ))}
                </select>
                <small>Информационная точка, куда сотрудник фактически отвозит поставку.</small>
              </label>

              <label className="fbs-routing-dialog__toggle">
                <input
                  type="checkbox"
                  checked={routingForm.autoRouteNewWarehouses}
                  disabled={routingLoading || routingSaving}
                  onChange={(event) => setRoutingForm((current) => ({
                    ...current,
                    autoRouteNewWarehouses: event.target.checked,
                  }))}
                />
                <span>
                  <strong>Новые склады WB автоматически направлять в выбранный филиал</strong>
                  <small>Город, указанный у склада продавца в WB, не изменит филиал исполнения.</small>
                  </span>
              </label>

              <section className="fbs-routing-dialog__warehouse-routes">
                <div className="fbs-routing-dialog__warehouse-heading">
                  <div>
                    <strong>Отдельные правила для складов WB</strong>
                    <small>Для каждого склада выберите, где собирать его новые заказы.</small>
                  </div>
                  <span>{routingData?.warehouses.length ?? 0} складов</span>
                </div>

                {routingLoading ? (
                  <div className="fbs-routing-dialog__warehouse-empty">
                    <RefreshCw size={17} className="is-spinning" aria-hidden="true" />
                    Получаю список складов из WB…
                  </div>
                ) : routingData?.warehouses.length ? (
                  <div className="fbs-routing-dialog__warehouse-list">
                    {routingData.warehouses.map((warehouse) => {
                      const draft = routingDrafts[warehouse.marketplaceWarehouseId] ?? {
                        mode: warehouse.mode,
                        executionWarehouseId: warehouse.executionWarehouseId ?? '',
                        dropoffWarehouseId: warehouse.dropoffWarehouseId ?? '',
                      };
                      const selectedExecution = routingBranches.find(
                        (branch) => branch.id === (
                          draft.mode === 'CENTRAL'
                            ? routingForm.executionWarehouseId
                            : draft.executionWarehouseId
                        ),
                      );
                      return (
                        <article
                          className={`fbs-routing-dialog__warehouse-row is-${draft.mode.toLowerCase()}`}
                          key={warehouse.marketplaceWarehouseId}
                        >
                          <div className="fbs-routing-dialog__warehouse-name">
                            <Warehouse size={18} aria-hidden="true" />
                            <div>
                              <strong>{warehouse.marketplaceWarehouseName}</strong>
                              <span>
                                {warehouse.officeCity || warehouse.officeName || 'Город не указан'}
                                {' · '}ID {warehouse.marketplaceWarehouseId}
                              </span>
                            </div>
                          </div>

                          <label>
                            <span>Схема работы</span>
                            <select
                              value={draft.mode}
                              disabled={routingSaving}
                              onChange={(event) => {
                                const mode = event.target.value as FbsWarehouseRouteMode;
                                setRoutingDrafts((current) => ({
                                  ...current,
                                  [warehouse.marketplaceWarehouseId]: {
                                    ...draft,
                                    mode,
                                    executionWarehouseId:
                                      mode === 'BRANCH' ? draft.executionWarehouseId : '',
                                    dropoffWarehouseId:
                                      mode === 'BRANCH' ? draft.dropoffWarehouseId : '',
                                  },
                                }));
                              }}
                            >
                              <option value="DEFAULT">По общему правилу</option>
                              <option value="CENTRAL">Через основной филиал</option>
                              <option value="BRANCH">Через свой филиал</option>
                              <option value="EXCLUDED">Не обрабатывать в WMS</option>
                            </select>
                          </label>

                          {draft.mode === 'BRANCH' ? (
                            <div className="fbs-routing-dialog__warehouse-branch-fields">
                              <label>
                                <span>Филиал исполнения</span>
                                <select
                                  value={draft.executionWarehouseId}
                                  disabled={routingSaving}
                                  onChange={(event) => setRoutingDrafts((current) => ({
                                    ...current,
                                    [warehouse.marketplaceWarehouseId]: {
                                      ...draft,
                                      executionWarehouseId: event.target.value,
                                    },
                                  }))}
                                >
                                  <option value="">Выберите филиал</option>
                                  {routingBranches.map((branch) => (
                                    <option key={branch.id} value={branch.id}>
                                      {branch.city} · {branch.name} ({branch.code})
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Место сдачи</span>
                                <select
                                  value={draft.dropoffWarehouseId}
                                  disabled={routingSaving}
                                  onChange={(event) => setRoutingDrafts((current) => ({
                                    ...current,
                                    [warehouse.marketplaceWarehouseId]: {
                                      ...draft,
                                      dropoffWarehouseId: event.target.value,
                                    },
                                  }))}
                                >
                                  <option value="">Не задано</option>
                                  {routingBranches.map((branch) => (
                                    <option key={branch.id} value={branch.id}>
                                      {branch.city} · {branch.name} ({branch.code})
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          ) : (
                            <div className="fbs-routing-dialog__warehouse-result">
                              {draft.mode === 'EXCLUDED' ? (
                                <><PowerOff size={16} aria-hidden="true" /> Новые заказы не резервируются</>
                              ) : selectedExecution ? (
                                <><MapPin size={16} aria-hidden="true" /> {selectedExecution.city} · {selectedExecution.name}</>
                              ) : (
                                <><ArrowRightLeft size={16} aria-hidden="true" /> Маршрут определяется общим правилом</>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="fbs-routing-dialog__warehouse-empty">
                    Склады WB не найдены или API временно недоступен.
                  </div>
                )}
              </section>
            </div>

            <p className="fbs-routing-dialog__notice">
              Настройка действует только на новые и ещё не распределённые заказы. Уже созданные заявки,
              резервы и сборки автоматически не переносятся.
            </p>
            {routingError ? <p className="form-error fbs-routing-dialog__error">{routingError}</p> : null}

            <div className="fbs-assembly-dialog__actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setRoutingOpen(false)}
                disabled={routingSaving}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={routingLoading || routingSaving}
              >
                {routingSaving ? 'Сохраняю…' : 'Сохранить маршрутизацию'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

type FbsPassForm = Pick<FbsPassPayload, 'firstName' | 'lastName' | 'carModel' | 'carNumber'> & {
  officeId: string;
};

const emptyFbsPassForm: FbsPassForm = {
  firstName: '',
  lastName: '',
  carModel: '',
  carNumber: '',
  officeId: '',
};

function FbsPassesView({ clientId, session }: { clientId: string; session: AuthSession }) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; data: FbsPassesResponse | null; error: string }>({
    status: 'loading',
    data: null,
    error: '',
  });
  const [connectionId, setConnectionId] = useState('');
  const [editingPass, setEditingPass] = useState<FbsPass | null>(null);
  const [form, setForm] = useState<FbsPassForm>(emptyFbsPassForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const loadPasses = useCallback(async (requestedConnectionId?: string) => {
    setState((current) => ({ status: 'loading', data: current.data, error: '' }));
    try {
      const data = await fetchFbsPasses(session.accessToken, clientId, requestedConnectionId || undefined);
      setConnectionId(data.selectedConnectionId ?? '');
      setState({ status: 'ready', data, error: '' });
    } catch (caught) {
      setState((current) => ({
        status: 'error',
        data: current.data,
        error: caught instanceof Error ? caught.message : 'Не удалось загрузить пропуска Wildberries.',
      }));
    }
  }, [clientId, session.accessToken]);

  useEffect(() => {
    setEditingPass(null);
    setForm(emptyFbsPassForm);
    void loadPasses();
  }, [loadPasses]);

  function updatePassForm(field: keyof FbsPassForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startEditing(pass: FbsPass) {
    setEditingPass(pass);
    setForm({
      firstName: pass.firstName,
      lastName: pass.lastName,
      carModel: pass.carModel,
      carNumber: pass.carNumber,
      officeId: String(pass.officeId),
    });
    setMessage('');
  }

  function resetPassForm() {
    setEditingPass(null);
    setForm(emptyFbsPassForm);
  }

  async function submitPass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connectionId || !form.officeId) return;
    setSaving(true);
    setMessage('');
    const payload: FbsPassPayload = {
      clientId,
      connectionId,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      carModel: form.carModel.trim(),
      carNumber: form.carNumber.trim().toUpperCase(),
      officeId: Number(form.officeId),
    };
    try {
      if (editingPass) await updateFbsPass(session.accessToken, editingPass.id, payload);
      else await createFbsPass(session.accessToken, payload);
      setMessage(editingPass ? 'Пропуск обновлён.' : 'Пропуск создан и передан в Wildberries.');
      resetPassForm();
      await loadPasses(connectionId);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Не удалось сохранить пропуск.');
    } finally {
      setSaving(false);
    }
  }

  async function removePass(pass: FbsPass) {
    if (!window.confirm(`Удалить пропуск для автомобиля ${pass.carNumber}?`)) return;
    setSaving(true);
    setMessage('');
    try {
      await deleteFbsPass(session.accessToken, pass.id, clientId, connectionId);
      if (editingPass?.id === pass.id) resetPassForm();
      setMessage('Пропуск удалён.');
      await loadPasses(connectionId);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Не удалось удалить пропуск.');
    } finally {
      setSaving(false);
    }
  }

  const data = state.data;
  if (state.status === 'loading' && !data) {
    return <FbsNotice icon={RefreshCw} title="Загружаю пропуска" text="Получаем склады и действующие пропуска из Wildberries." />;
  }
  if (state.status === 'error' && !data) {
    return <FbsNotice icon={AlertTriangle} title="Не удалось загрузить пропуска" text={state.error} tone="error" />;
  }
  if (!data?.selectedConnectionId) {
    return <FbsNotice icon={CarFront} title="Нет подключения Wildberries" text="Сначала подключите API Wildberries для выбранного клиента." />;
  }

  return (
    <div className="fbs-passes">
      <div className="fbs-passes__intro">
        <div><CarFront size={22} aria-hidden="true" /><div><strong>Пропуска на склады WB</strong><span>Данные синхронизируются напрямую с кабинетом Wildberries.</span></div></div>
        {data.connections.length > 1 ? (
          <label>Кабинет<select value={connectionId} onChange={(event) => void loadPasses(event.target.value)}>{data.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.accountName || 'Wildberries'}</option>)}</select></label>
        ) : null}
      </div>
      <form className="fbs-passes__form" onSubmit={submitPass}>
        <h3>{editingPass ? `Изменить пропуск №${editingPass.id}` : 'Новый пропуск'}</h3>
        <label>Имя<input required value={form.firstName} onChange={(event) => updatePassForm('firstName', event.target.value)} /></label>
        <label>Фамилия<input required value={form.lastName} onChange={(event) => updatePassForm('lastName', event.target.value)} /></label>
        <label>Модель автомобиля<input required value={form.carModel} onChange={(event) => updatePassForm('carModel', event.target.value)} /></label>
        <label>Госномер<input required value={form.carNumber} onChange={(event) => updatePassForm('carNumber', event.target.value)} placeholder="А123ВС77" /></label>
        <label>Склад WB<select required value={form.officeId} onChange={(event) => updatePassForm('officeId', event.target.value)}><option value="">Выберите склад</option>{data.offices.map((office) => <option key={office.id} value={office.id}>{office.name} · {office.address}</option>)}</select></label>
        <div className="fbs-passes__form-actions">
          <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Сохраняю…' : editingPass ? 'Сохранить' : 'Создать пропуск'}</button>
          {editingPass ? <button className="button button-secondary" type="button" onClick={resetPassForm}>Отмена</button> : null}
        </div>
      </form>
      {message ? <p className="fbs-passes__message">{message}</p> : null}
      <div className="fbs-passes__list">
        {data.passes.length === 0 ? <p>Действующих пропусков нет.</p> : data.passes.map((pass) => (
          <article key={pass.id}>
            <div><strong>{pass.carNumber} · {pass.carModel}</strong><span>{pass.firstName} {pass.lastName}</span><span>{pass.officeName || `Склад №${pass.officeId}`} · до {formatDateTime(pass.dateEnd)}</span></div>
            <div><button type="button" className="button button-secondary" disabled={saving} onClick={() => startEditing(pass)}>Изменить</button><button type="button" className="button button-secondary fbs-order-actions__danger" disabled={saving} onClick={() => void removePass(pass)}>Удалить</button></div>
          </article>
        ))}
      </div>
    </div>
  );
}

function FbsCargoPackingView({
  state,
  search,
  canManage,
  actionId,
  onToggleIgnored,
}: {
  state: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: FbsCargoPackingsResponse | null;
    error: string;
  };
  search: string;
  canManage: boolean;
  actionId: string | null;
  onToggleIgnored: (planId: string, ignored: boolean) => Promise<void>;
}) {
  if (state.status === 'loading' && !state.data) {
    return <FbsNotice icon={RefreshCw} title="Загружаю короба WMS" text="Проверяю упаковку поставок FBS." />;
  }
  if (state.status === 'error' && !state.data) {
    return <FbsNotice icon={AlertTriangle} title="Не удалось загрузить грузоместа" text={state.error} tone="error" />;
  }
  const query = search.trim().toLowerCase();
  const supplies = (state.data?.supplies ?? []).filter((supply) => {
    if (!query) return true;
    return [
      supply.supplyId,
      supply.client.name,
      ...supply.cargoPlaces.flatMap((place) => [
        place.cargoPlaceId,
        place.cargoPlaceBarcode ?? '',
        ...place.orders.flatMap((order) => [
          order.orderId,
          order.productName,
          order.article ?? '',
          order.productBarcode ?? '',
          order.wbStickerPartB ?? '',
          order.sourceBoxCode ?? '',
        ]),
      ]),
    ].some((value) => value.toLowerCase().includes(query));
  });

  if (supplies.length === 0) {
    return (
      <FbsNotice
        icon={Boxes}
        title={query ? 'Поиск ничего не нашёл' : 'Нет поставок для упаковки'}
        text={query ? 'Измените номер заказа, поставки, короба WMS, грузоместа или ШК.' : 'Здесь появятся короба WMS и грузоместа WB, отсканированные при упаковке FBS.'}
      />
    );
  }

  return (
    <div className="fbs-cargo-supplies">
      {state.error ? <p className="fbs-order-actions__error">{state.error}</p> : null}
      {supplies.map((supply) => {
        const isWmsBoxes = supply.packingMode === 'SORTING_CENTER_BOX';
        const requestLabel = (supply.requestNumbers ?? [])
          .map((number) => `№${String(number).padStart(6, '0')}`)
          .join(', ');
        return (
        <details
          className={`fbs-cargo-supply${supply.readyToDeliver ? ' is-ready' : ''}${supply.ignored ? ' is-ignored' : ''}`}
          key={supply.id}
          open={!supply.readyToDeliver && !supply.ignored}
        >
          <summary>
            <span>
              <strong>Поставка {supply.supplyId}</strong>
              <small>
                {requestLabel ? `Заявка WMS ${requestLabel} · ` : ''}
                {supply.client.code} · {supply.client.name} · {isWmsBoxes ? 'Короба WMS' : 'Грузоместа WB'}
              </small>
            </span>
            <span className="fbs-cargo-supply__progress">
              <strong>{supply.packedItems} / {supply.totalPlannedItems} ед.</strong>
              <small>
                {supply.closedCargoPlaces} / {supply.cargoPlaceCount} {isWmsBoxes ? 'коробов WMS закрыто' : 'грузомест закрыто'}
              </small>
            </span>
            <span className={`fbs-status ${supply.ignored ? 'fbs-status--ignored' : supply.readyToDeliver ? 'fbs-status--shipped' : 'fbs-status--active'}`}>
              {supply.ignored
                ? 'Игнорируется'
                : supply.readyToDeliver
                ? 'Готова к передаче WB'
                : supply.waitingAssembly > 0
                  ? `Ещё собирается: ${supply.waitingAssembly}`
                  : `Разложить: ${supply.remainingToPack}`}
            </span>
          </summary>
          <div className="fbs-cargo-places">
            {canManage ? (
              <div className="fbs-cargo-supply__admin">
                <span>
                  {supply.ignored
                    ? `Игнорирование включил: ${supply.ignoredByName || 'администратор'}${supply.ignoredAt ? ` · ${formatDateTime(supply.ignoredAt)}` : ''}${supply.ignoreReason ? ` · ${supply.ignoreReason}` : ''}`
                    : 'Поставка участвует в рабочей очереди упаковки FBS.'}
                </span>
                <button
                  type="button"
                  className={`button button-secondary${supply.ignored ? '' : ' fbs-cargo-supply__ignore-button'}`}
                  disabled={actionId !== null}
                  onClick={() => void onToggleIgnored(supply.id, !supply.ignored)}
                >
                  {actionId === supply.id
                    ? 'Сохраняю…'
                    : supply.ignored
                      ? 'Вернуть в работу'
                      : 'Игнорировать'}
                </button>
              </div>
            ) : null}
            {supply.cargoPlaces.map((place, index) => (
              <details className={`fbs-cargo-place fbs-cargo-place--${place.status.toLowerCase()}`} key={place.cargoPlaceId}>
                <summary>
                  <span className="fbs-cargo-place__number">{index + 1}</span>
                  <span>
                    <strong>{place.cargoPlaceId}</strong>
                    <small className="fbs-mono">
                      {isWmsBoxes ? 'Физический короб WMS' : place.cargoPlaceBarcode || 'QR ещё не сканировался'}
                    </small>
                  </span>
                  <span>
                    <strong>{place.packedItems} ед. · без лимита</strong>
                    <small>
                      {place.status === 'CLOSED'
                        ? `Закрыто · ${place.closedByName || place.deviceCode || 'ТСД'}`
                        : place.status === 'OPEN'
                          ? `Открыто · ${place.openedByName || place.deviceCode || 'ТСД'}`
                          : 'Не начато'}
                    </small>
                  </span>
                </summary>
                {place.orders.length > 0 ? (
                  <div className="fbs-table-wrap fbs-cargo-place__table">
                    <table className="fbs-table">
                      <thead>
                        <tr>
                          <th>Заказ WB</th>
                          <th>Товар</th>
                          <th>ШК товара</th>
                          <th>Короб WMS</th>
                          <th>Наклейка WB</th>
                          <th>Упаковал</th>
                        </tr>
                      </thead>
                      <tbody>
                        {place.orders.map((order) => (
                          <tr key={order.orderId}>
                            <td><strong>№ {order.orderId}</strong></td>
                            <td>
                              <strong>{order.productName}</strong>
                              <small>
                                {[order.article, order.color, order.size ? `размер ${order.size}` : null]
                                  .filter(Boolean)
                                  .join(' · ') || '—'}
                              </small>
                            </td>
                            <td><span className="fbs-mono">{order.productBarcode || '—'}</span></td>
                            <td><span className="fbs-mono">{order.sourceBoxCode || '—'}</span></td>
                            <td>
                              <strong>{order.wbStickerPartB || '—'}</strong>
                              <small className="fbs-mono">{order.wbStickerBarcode || '—'}</small>
                            </td>
                            <td>
                              <strong>{order.packedByName || 'ТСД'}</strong>
                              <small>{formatDateTime(order.packedAt)}</small>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="fbs-cargo-place__empty">
                    На ТСД ещё не отсканирован ни один {isWmsBoxes ? 'товар в этот короб WMS' : 'заказ'}.
                  </p>
                )}
              </details>
            ))}
          </div>
        </details>
        );
      })}
    </div>
  );
}

function FbsOrdersView({
  data,
  search,
  view,
  selectedOrderKeys,
  onSelectionChange,
  orderAction,
  rowActionKey,
  actionMessage,
  actionError,
  onAssemble,
  onReship,
  onDeliver,
  onChangeDestination,
  onMoveToNewSupply,
  onCancel,
  onRemoveCancelledOrder,
  onDownloadStickers,
  onDownloadCargoStickers,
  onDownloadSupplyStickers,
  onDownloadPickList,
  canDownloadPickList,
  canEnableEmergencyAssembly,
  onEnableEmergencyAssembly,
  onCreateRequest,
  onCreateMissingRequests,
  syncAudit,
  syncAuditBusy,
  onRunSynchronizationAudit,
  onCloseSynchronizationAudit,
}: {
  data: ClientFbsOrders | null;
  search: string;
  // FIX: the allocation tile is not an orders-table view.
  view: Exclude<FbsView, 'stocks' | 'cargo' | 'cost' | 'calculator' | 'pricing' | 'passes' | 'report' | 'allocation'>;
  selectedOrderKeys: Set<string>;
  onSelectionChange: (keys: Set<string>) => void;
  orderAction: 'assemble' | 'reship' | 'move' | 'deliver' | 'change-destination' | 'cancel' | 'remove-cancelled' | 'stickers' | 'cargo' | 'supply' | 'request' | 'recover-missing-requests' | 'pick-list' | 'emergency-assembly' | null;
  rowActionKey: string | null;
  actionMessage: string;
  actionError: string;
  onAssemble: (orders: FbsOrderSummary[]) => Promise<void>;
  onReship: (orders: FbsOrderSummary[]) => Promise<void>;
  onDeliver: (orders: FbsOrderSummary[]) => Promise<void>;
  onChangeDestination: (orders: FbsOrderSummary[]) => Promise<void>;
  onMoveToNewSupply: (orders: FbsOrderSummary[]) => Promise<void>;
  onCancel: (orders: FbsOrderSummary[]) => Promise<void>;
  onRemoveCancelledOrder: (order: FbsOrderSummary) => Promise<void>;
  onDownloadStickers: (orders: FbsOrderSummary[]) => Promise<void>;
  onDownloadCargoStickers: (orders: FbsOrderSummary[]) => Promise<void>;
  onDownloadSupplyStickers: (orders: FbsOrderSummary[]) => Promise<void>;
  onDownloadPickList: (order: FbsOrderSummary) => Promise<void>;
  canDownloadPickList: boolean;
  canEnableEmergencyAssembly: boolean;
  onEnableEmergencyAssembly: (
    request: NonNullable<FbsOrderSummary['request']>,
  ) => Promise<void>;
  onCreateRequest: (orders: FbsOrderSummary[]) => Promise<void>;
  onCreateMissingRequests: (groups: FbsOrderSummary[][]) => Promise<void>;
  syncAudit: FbsSynchronizationAudit | null;
  syncAuditBusy: boolean;
  onRunSynchronizationAudit: () => Promise<void>;
  onCloseSynchronizationAudit: () => void;
}) {
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(() => new Set());
  // ADDED: ручное сворачивание важнее автораскрытия при фоновых обновлениях списка.
  const manuallyCollapsedGroupKeys = useRef<Set<string>>(new Set());
  const [ordersLayout, setOrdersLayout] = useState<'all' | 'warehouses'>('all');
  const [selectedWarehouseKey, setSelectedWarehouseKey] = useState('all');
  const [hiddenWaitingStockKeys, setHiddenWaitingStockKeys] = useState<Set<string>>(() => new Set());
  const [quickSelectCount, setQuickSelectCount] = useState('28');
  const [orderSort, setOrderSort] = useState<FbsOrderSort>('date-oldest');
  const [shippedDateFrom, setShippedDateFrom] = useState('');
  const [shippedDateTo, setShippedDateTo] = useState('');
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    setExpandedGroupKeys(new Set());
  }, [view]);
  const category = view;
  const orders = (data?.orders ?? [])
    .filter((order) => order.category === category)
    .sort((left, right) => compareFbsOrders(left, right, orderSort));
  const warehouseGroups = groupFbsOrdersByWarehouse(orders, clockNow);
  const hasWildberriesWarehouseFilter = orders.some(
    (order) => order.marketplace === 'WILDBERRIES',
  );
  const warehouseGroupKeys = warehouseGroups.map((group) => group.key).join('|');
  useEffect(() => {
    if (
      selectedWarehouseKey !== 'all' &&
      !warehouseGroups.some((group) => group.key === selectedWarehouseKey)
    ) {
      setSelectedWarehouseKey('all');
    }
  }, [selectedWarehouseKey, warehouseGroupKeys]);
  const warehouseScopedOrders =
    ordersLayout === 'warehouses' && selectedWarehouseKey !== 'all'
      ? orders.filter((order) => fbsOrderWarehouseKey(order) === selectedWarehouseKey)
      : orders;
  const dateScopedOrders = view === 'shipped'
    ? filterFbsShippedOrdersByDate(
        warehouseScopedOrders,
        shippedDateFrom,
        shippedDateTo,
      )
    : warehouseScopedOrders;
  const normalizedSearch = search.trim().toLowerCase();
  const searchedOrders = normalizedSearch
    ? dateScopedOrders.filter((order) =>
        [
          order.id,
          order.orderUid,
          order.article,
          order.nmId,
          order.product?.name,
          order.product?.internalSku,
          order.product?.size,
          order.supplyId,
          order.warehouseId,
          order.warehouseName,
          order.officeId,
          order.accountName,
          ...order.barcodes,
          ...order.storageBoxes.map((box) => box.code),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch)),
    )
    : dateScopedOrders;
  const hiddenWaitingStockCount = searchedOrders.filter(
    (order) => hiddenWaitingStockKeys.has(fbsOrderSelectionKey(order)),
  ).length;
  const visibleOrders = searchedOrders.filter(
    (order) => !hiddenWaitingStockKeys.has(fbsOrderSelectionKey(order)),
  );
  const readOnlyView = view === 'archive' || view === 'cancelled';
  const orderGroups = groupFbsOrdersBySupply(visibleOrders, view, orderSort);
  const orderGroupKeys = orderGroups.map((group) => group.key).join('|');
  useEffect(() => {
    if (!normalizedSearch) return;
    // FIX: не раскрываем повторно группы, которые пользователь уже свернул сам.
    setExpandedGroupKeys(new Set(
      orderGroups
        .map((group) => group.key)
        .filter((groupKey) => !manuallyCollapsedGroupKeys.current.has(groupKey)),
    ));
  }, [normalizedSearch, orderGroupKeys]);
  const tableColumnCount = 6 + (!readOnlyView ? 1 : 0) + (view === 'active' ? 1 : 0) + (view === 'cancelled' ? 1 : 0);
  const itemsCount = visibleOrders.reduce((sum, order) => sum + Math.max(1, order.itemCount), 0);
  const hasWildberriesOrders = visibleOrders.some((order) => order.marketplace === 'WILDBERRIES');
  const marketplaceBoardLabel = visibleOrders[0]?.marketplace === 'OZON'
    ? 'Ozon'
    : visibleOrders[0]?.marketplace === 'YANDEX_MARKET'
      ? 'Яндекс'
      : 'WB';
  const visibleKeys = visibleOrders.map(fbsOrderSelectionKey);
  const bulkSelectableOrders = visibleOrders;
  const bulkSelectableKeys = bulkSelectableOrders.map(fbsOrderSelectionKey);
  const selectedOrders = visibleOrders.filter((order) => selectedOrderKeys.has(fbsOrderSelectionKey(order)));
  const assemblyOrders = selectedOrders.filter(
    (order) =>
      (order.marketplace === 'WILDBERRIES' && order.supplierStatus === 'new') ||
      (order.marketplace === 'OZON' && order.supplierStatus === 'awaiting_packaging'),
  );
  const reshipOrders = selectedOrders.filter(
    (order) => order.marketplace === 'WILDBERRIES' && order.requiresReshipment,
  );
  const deliverOrders = selectedOrders.filter(
    (order) => order.marketplace === 'WILDBERRIES' && order.supplierStatus === 'confirm' && Boolean(order.supplyId),
  );
  const cancelOrders = selectedOrders.filter(
    (order) => order.marketplace === 'WILDBERRIES' && ['new', 'confirm'].includes(order.supplierStatus),
  );
  const changeDestinationOrders = selectedOrders.filter(
    (order) =>
      order.marketplace === 'WILDBERRIES' &&
      order.supplierStatus === 'confirm' &&
      Boolean(order.supplyId) &&
      fbsOrderRequiresCargoPlaces(order, data?.deliveryPlan.requiresCargoPlaces === true),
  );
  const changeDestinationSupplyCount = new Set(
    changeDestinationOrders.map((order) => `${order.connectionId}:${order.supplyId}`),
  ).size;
  const moveOrders = selectedOrders.filter(isFbsOrderMoveCandidate);
  const selectedMoveWarehouseKeys = new Set(
    moveOrders.map(
      (order) =>
        `${order.connectionId}:${order.marketplace}:${order.warehouseId || order.officeId || 'unknown'}`,
    ),
  );
  const canMoveSelectedOrders =
    selectedOrders.length > 0 &&
    moveOrders.length === selectedOrders.length &&
    selectedMoveWarehouseKeys.size === 1;
  const selectedMoveRequestCount = new Set(
    moveOrders.map((order) => order.request?.id || `supply:${order.supplyId || order.id}`),
  ).size;
  const stickerOrders = selectedOrders.filter(
    fbsOrderStickerIsAvailable,
  );
  const cargoStickerOrders = selectedOrders.filter(
    (order) =>
      fbsOrderRequiresCargoPlaces(order, data?.deliveryPlan.requiresCargoPlaces === true) &&
      order.marketplace === 'WILDBERRIES' &&
      order.supplierStatus === 'confirm' &&
      Boolean(order.supplyId),
  );
  const supplyStickerOrders = selectedOrders.filter(
    (order) =>
      !fbsOrderRequiresCargoPlaces(order, data?.deliveryPlan.requiresCargoPlaces === true) &&
      order.marketplace === 'WILDBERRIES' &&
      order.supplierStatus === 'complete' &&
      Boolean(order.supplyId),
  );
  const requestOrders = selectedOrders.filter(
    (order) => order.category === 'active' && (!order.request || order.request.status === 'CANCELLED'),
  );
  const requestEligibleOrders = visibleOrders.filter(
    (order) => order.category === 'active' && (!order.request || order.request.status === 'CANCELLED'),
  );
  const missingRequestGroups = view === 'active'
    ? groupMissingWmsRequestsByWarehouse(visibleOrders)
    : [];
  const unselectedRequestOrders = requestEligibleOrders.filter(
    (order) => !selectedOrderKeys.has(fbsOrderSelectionKey(order)),
  );
  const parsedQuickSelectCount = Math.max(0, Math.trunc(Number(quickSelectCount) || 0));
  const allVisibleSelected =
    bulkSelectableKeys.length > 0 && bulkSelectableKeys.every((key) => selectedOrderKeys.has(key));

  function toggleAllVisible() {
    const next = new Set(selectedOrderKeys);
    visibleKeys.forEach((key) => next.delete(key));
    if (!allVisibleSelected) bulkSelectableKeys.forEach((key) => next.add(key));
    onSelectionChange(next);
  }

  function toggleOrder(order: FbsOrderSummary) {
    const key = fbsOrderSelectionKey(order);
    const next = new Set(selectedOrderKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  }

  function selectNextRequestOrders(count: number) {
    const safeCount = Math.max(0, Math.trunc(count));
    if (safeCount === 0) return;
    const next = new Set(selectedOrderKeys);
    unselectedRequestOrders
      .slice(0, safeCount)
      .forEach((order) => next.add(fbsOrderSelectionKey(order)));
    onSelectionChange(next);
  }

  function selectVisibleAgeZone(zone: 'normal' | 'warning' | 'critical') {
    const matchingKeys = visibleOrders
      .filter((order) => {
        const createdAt = fbsOrderCreatedAt(order);
        if (createdAt === null || order.category !== 'active') return false;
        return fbsOrderAgeTone(Math.max(0, clockNow - createdAt), order.category) === zone;
      })
      .map(fbsOrderSelectionKey);
    const next = new Set(selectedOrderKeys);
    visibleKeys.forEach((key) => next.delete(key));
    matchingKeys.forEach((key) => next.add(key));
    onSelectionChange(next);
  }

  const visibleAgeZoneCounts = view === 'active'
    ? visibleOrders.reduce(
        (counts, order) => {
          const createdAt = fbsOrderCreatedAt(order);
          if (createdAt === null || order.category !== 'active') return counts;
          const tone = fbsOrderAgeTone(Math.max(0, clockNow - createdAt), order.category);
          if (tone === 'normal' || tone === 'warning' || tone === 'critical') counts[tone] += 1;
          return counts;
        },
        { normal: 0, warning: 0, critical: 0 },
      )
    : { normal: 0, warning: 0, critical: 0 };

  function toggleGroup(groupKey: string) {
    setExpandedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        // ADDED: запоминаем ручное сворачивание между обновлениями данных.
        next.delete(groupKey);
        manuallyCollapsedGroupKeys.current.add(groupKey);
      } else {
        // FIX: только явное нажатие пользователя снова разрешает раскрыть группу.
        next.add(groupKey);
        manuallyCollapsedGroupKeys.current.delete(groupKey);
      }
      return next;
    });
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
      text: 'Завершённые заказы за последние 30 дней будут храниться здесь.',
    },
    cancelled: {
      icon: XCircle,
      title: 'Отменённых FBS-заказов пока нет',
      text: 'Заказы, отменённые продавцом, покупателем или перевозчиком, будут собраны здесь.',
    },
  }[view];
  const EmptyIcon = emptyCopy.icon;

  return (
    <>
      <section className="fbs-warehouse-board" aria-label="Представление заказов FBS">
        <header className="fbs-warehouse-board__header">
          <div>
            <p className="eyebrow">Маршрутизация FBS</p>
            <strong>Заказы по виртуальным складам маркетплейса</strong>
            <span>Физическая сборка и сдача остаются в Москве. Склад маркетплейса используется для разделения заказов и поставок.</span>
          </div>
          <div className="fbs-warehouse-board__switch" role="group" aria-label="Вид списка заказов">
            <button
              type="button"
              className={ordersLayout === 'all' ? 'is-active' : undefined}
              onClick={() => {
                setOrdersLayout('all');
                setSelectedWarehouseKey('all');
              }}
            >
              Все заказы
            </button>
            <button
              type="button"
              className={ordersLayout === 'warehouses' ? 'is-active' : undefined}
              onClick={() => setOrdersLayout('warehouses')}
            >
              По складам {marketplaceBoardLabel}
            </button>
          </div>
          <button
            type="button"
            className="fbs-sync-audit-button"
            onClick={() => void onRunSynchronizationAudit()}
            disabled={syncAuditBusy || !data?.connected}
            title="Сверить статусы заявок WMS с актуальными статусами заказов маркетплейса"
          >
            <RefreshCw className={syncAuditBusy ? 'is-spinning' : undefined} size={16} aria-hidden="true" />
            {syncAuditBusy ? 'Проверяю…' : 'Проверить рассинхронизацию'}
          </button>
        </header>

        {hasWildberriesWarehouseFilter ? (
          <label className="fbs-warehouse-board__filter">
            <span>Фильтр склада WB</span>
            <select
              value={selectedWarehouseKey}
              onChange={(event) => {
                const nextWarehouseKey = event.target.value;
                setSelectedWarehouseKey(nextWarehouseKey);
                setOrdersLayout(nextWarehouseKey === 'all' ? 'all' : 'warehouses');
              }}
            >
              <option value="all">Все склады WB</option>
              {warehouseGroups.map((group) => (
                <option key={group.key} value={group.key}>{group.label} · {group.orders.length} заказ(а/ов)</option>
              ))}
            </select>
            {selectedWarehouseKey !== 'all' ? <small>«Выбрать все» и создание заявки работают только с заказами этого склада.</small> : null}
          </label>
        ) : null}

        {ordersLayout === 'warehouses' ? (
          <div className="fbs-warehouse-tiles">
            <button
              type="button"
              className={`fbs-warehouse-tile${selectedWarehouseKey === 'all' ? ' is-active' : ''}`}
              onClick={() => setSelectedWarehouseKey('all')}
            >
              <span className="fbs-warehouse-tile__icon"><Boxes size={19} aria-hidden="true" /></span>
              <span className="fbs-warehouse-tile__content">
                <strong>Все склады {marketplaceBoardLabel}</strong>
                <small>Сборка: Москва · сдача: Москва</small>
                <span>{orders.length} заказов · {orders.reduce((sum, order) => sum + Math.max(1, order.itemCount), 0)} товаров</span>
              </span>
            </button>
            {warehouseGroups.map((group) => (
              <button
                type="button"
                key={group.key}
                className={`fbs-warehouse-tile${selectedWarehouseKey === group.key ? ' is-active' : ''}${group.isUnknown ? ' is-warning' : ''}`}
                onClick={() => setSelectedWarehouseKey(group.key)}
              >
                <span className="fbs-warehouse-tile__icon"><Warehouse size={19} aria-hidden="true" /></span>
                <span className="fbs-warehouse-tile__content">
                  <strong>{group.label}</strong>
                  <small>Сборка: Москва · сдача: Москва</small>
                  <span>{group.orders.length} заказов · {group.itemCount} товаров · {group.supplyCount} поставок</span>
                  {group.criticalCount > 0 ? <em>Просрочено: {group.criticalCount}</em> : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {hiddenWaitingStockCount > 0 ? (
          <div className="fbs-warehouse-board__hidden">
            <span>Скрыто временно: {hiddenWaitingStockCount}</span>
            <button type="button" onClick={() => setHiddenWaitingStockKeys(new Set())}>Показать скрытые из виду</button>
          </div>
        ) : null}
      </section>

      {syncAudit ? (
        <section
          className={`fbs-sync-audit${syncAudit.issues.length > 0 ? ' is-warning' : ' is-ok'}`}
          aria-live="polite"
        >
          <div className="fbs-sync-audit__heading">
            <div>
              <p className="eyebrow">Проверка статусов</p>
              <strong>
                {syncAudit.issues.length > 0
                  ? `Найдено расхождений: ${syncAudit.issues.length}`
                  : 'Расхождений между WMS и маркетплейсом не найдено'}
              </strong>
              <small>
                Проверено заявок: {syncAudit.checkedRequests} · заказов: {syncAudit.checkedOrders}
              </small>
            </div>
            <button type="button" onClick={onCloseSynchronizationAudit} aria-label="Закрыть результат проверки">
              <XCircle size={18} aria-hidden="true" />
            </button>
          </div>
          {syncAudit.issues.length > 0 ? (
            <div className="fbs-sync-audit__list">
              {syncAudit.issues.map((issue) => (
                <article key={issue.requestId}>
                  <AlertTriangle size={19} aria-hidden="true" />
                  <div>
                    <strong>Заявка №{String(issue.requestNumber).padStart(6, '0')} · {issue.requestTitle}</strong>
                    <span>
                      WMS: {fbsRequestStatusLabel(issue.wmsStatus)} · WB: активных {issue.activeOrders},
                      отгруженных {issue.shippedOrders}, отменённых {issue.cancelledOrders}.
                    </span>
                    <small>
                      {issue.kind === 'WMS_OPEN_MARKETPLACE_FINISHED'
                        ? 'В WMS заявка ещё открыта, но все её заказы завершены в маркетплейсе. В ТСД её отправлять нельзя.'
                        : 'WMS считает заявку закрытой, но в маркетплейсе ещё есть активные заказы. Проверьте их до закрытия.'}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {view === 'shipped' ? (
        <section className="fbs-shipped-date-filter" aria-label="Фильтр отгруженных заказов по дате">
          <div className="fbs-shipped-date-filter__title">
            <CalendarDays size={18} aria-hidden="true" />
            <div>
              <strong>Дата отгрузки</strong>
              <small>Заказы ниже автоматически свёрнуты по дням.</small>
            </div>
          </div>
          <label>
            <span>С даты</span>
            <input type="date" value={shippedDateFrom} onChange={(event) => setShippedDateFrom(event.target.value)} />
          </label>
          <label>
            <span>По дату</span>
            <input type="date" value={shippedDateTo} onChange={(event) => setShippedDateTo(event.target.value)} />
          </label>
          <button
            type="button"
            className="button button-secondary"
            disabled={!shippedDateFrom && !shippedDateTo}
            onClick={() => { setShippedDateFrom(''); setShippedDateTo(''); }}
          >
            Сбросить даты
          </button>
        </section>
      ) : null}

      <div className="fbs-order-sort">
        <label>
          <span>Сортировка заказов</span>
          <select
            value={orderSort}
            onChange={(event) => setOrderSort(event.target.value as FbsOrderSort)}
          >
            <option value="date-oldest">По дате — старые сверху</option>
            <option value="date-newest">По дате — новые сверху</option>
            <option value="order-asc">По номеру заказа — по возрастанию</option>
            <option value="order-desc">По номеру заказа — по убыванию</option>
            <option value="request-asc">По номеру заявки WMS — по возрастанию</option>
            <option value="request-desc">По номеру заявки WMS — по убыванию</option>
            <option value="warehouse-asc">По складу — А–Я</option>
            <option value="warehouse-desc">По складу — Я–А</option>
            <option value="status-asc">По статусу — А–Я</option>
            <option value="status-desc">По статусу — Я–А</option>
          </select>
        </label>
      </div>

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

      {!readOnlyView && visibleOrders.length > 0 ? (
        <div className="fbs-order-actions">
          <div className="fbs-order-actions__selection">
            <strong>Выбрано: {selectedOrders.length}</strong>
            <span>Выберите заказы и нужный комплект печати: ПВЗ или сортировочный центр.</span>
            {view === 'active' ? (
              <div className="fbs-order-actions__quick-select">
                <div className="fbs-order-actions__age-zones" aria-label="Выбор заказов по времени ожидания">
                  <span>Выбрать всю зону:</span>
                  <button
                    type="button"
                    className="is-green"
                    onClick={() => selectVisibleAgeZone('normal')}
                    disabled={visibleAgeZoneCounts.normal === 0 || orderAction !== null}
                  >
                    Зелёная · {visibleAgeZoneCounts.normal}
                  </button>
                  <button
                    type="button"
                    className="is-yellow"
                    onClick={() => selectVisibleAgeZone('warning')}
                    disabled={visibleAgeZoneCounts.warning === 0 || orderAction !== null}
                  >
                    Жёлтая · {visibleAgeZoneCounts.warning}
                  </button>
                  <button
                    type="button"
                    className="is-red"
                    onClick={() => selectVisibleAgeZone('critical')}
                    disabled={visibleAgeZoneCounts.critical === 0 || orderAction !== null}
                  >
                    Красная · {visibleAgeZoneCounts.critical}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => selectNextRequestOrders(28)}
                  disabled={unselectedRequestOrders.length === 0 || orderAction !== null}
                >
                  Выбрать следующие 28
                </button>
                <label>
                  <span>Или количество</span>
                  <input
                    type="number"
                    min="1"
                    max={Math.max(1, unselectedRequestOrders.length)}
                    step="1"
                    inputMode="numeric"
                    value={quickSelectCount}
                    onChange={(event) => setQuickSelectCount(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') selectNextRequestOrders(parsedQuickSelectCount);
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => selectNextRequestOrders(parsedQuickSelectCount)}
                  disabled={
                    parsedQuickSelectCount < 1 ||
                    unselectedRequestOrders.length === 0 ||
                    orderAction !== null
                  }
                >
                  Выбрать
                </button>
                <small>
                  Не включены в заявки WMS: {unselectedRequestOrders.length}
                </small>
              </div>
            ) : null}
          </div>
          <div className="fbs-order-actions__buttons">
            {view === 'active' ? (
              <>
                <button
                  type="button"
                  className="button fbs-create-missing-requests"
                  disabled={missingRequestGroups.length === 0 || orderAction !== null}
                  onClick={() => void onCreateMissingRequests(missingRequestGroups)}
                  title="Сверить поставки WB и создать отдельные заявки WMS по городам"
                >
                  <FilePlus2 size={16} aria-hidden="true" />
                  {orderAction === 'recover-missing-requests'
                    ? 'Создаю заявки…'
                    : `Создать отсутствующие заявки · ${missingRequestGroups.length}`}
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={assemblyOrders.length === 0 || orderAction !== null}
                  onClick={() => void onAssemble(assemblyOrders)}
                >
                  <ListChecks size={16} aria-hidden="true" />
                  {orderAction === 'assemble'
                    ? 'Передаю…'
                    : assemblyOrders.length > 0 && assemblyOrders.every((order) => order.marketplace === 'OZON')
                      ? `Передать в Ozon (${assemblyOrders.length})`
                      : `Собрать (${assemblyOrders.length})`}
                </button>
                {hasWildberriesOrders ? <>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={reshipOrders.length === 0 || orderAction !== null}
                  onClick={() => void onReship(reshipOrders)}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  {orderAction === 'reship' ? 'Переотгружаю…' : `Переотгрузить (${reshipOrders.length})`}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={deliverOrders.length === 0 || orderAction !== null}
                  onClick={() => void onDeliver(deliverOrders)}
                >
                  <Send size={16} aria-hidden="true" />
                  {orderAction === 'deliver' ? 'Передаю…' : `Передать WB (${deliverOrders.length})`}
                </button>
                <button
                  type="button"
                  className="button button-secondary fbs-order-actions__change-destination"
                  disabled={changeDestinationOrders.length === 0 || orderAction !== null}
                  onClick={() => void onChangeDestination(changeDestinationOrders)}
                  title="Удалить грузоместа ПВЗ и сохранить эту же поставку для сдачи в сортировочный центр"
                >
                  <ArrowRightLeft size={16} aria-hidden="true" />
                  {orderAction === 'change-destination'
                    ? 'Меняю направление…'
                    : `ПВЗ → СЦ (${changeDestinationSupplyCount})`}
                </button>
                <button
                  type="button"
                  className={`button button-secondary${selectedMoveRequestCount > 1 ? ' fbs-order-actions__merge-supplies' : ''}`}
                  disabled={!canMoveSelectedOrders || orderAction !== null}
                  onClick={() => void onMoveToNewSupply(moveOrders)}
                  title="Объединить выбранные несобранные заказы одного склада WB из разных заявок в одну новую поставку и заявку WMS"
                >
                  <ArrowRightLeft size={16} aria-hidden="true" />
                  {orderAction === 'move'
                    ? 'Переношу…'
                    : selectedMoveRequestCount > 1
                      ? `Объединить в заявку (${moveOrders.length})`
                      : `В новую поставку (${moveOrders.length})`}
                </button>
                </> : null}
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
                  className="button button-secondary fbs-order-actions__danger"
                  disabled={cancelOrders.length === 0 || orderAction !== null}
                  onClick={() => void onCancel(cancelOrders)}
                >
                  <XCircle size={16} aria-hidden="true" />
                  {orderAction === 'cancel' ? 'Отменяю…' : `Отменить (${cancelOrders.length})`}
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="button button-secondary"
              disabled={stickerOrders.length === 0 || orderAction !== null}
              onClick={() => void onDownloadStickers(stickerOrders)}
            >
              <Download size={16} aria-hidden="true" />
              {orderAction === 'stickers' ? 'Формирую…' : `ШК заказов (${stickerOrders.length})`}
            </button>
            {hasWildberriesOrders ? <>
            <button
              type="button"
              className="button button-secondary"
              disabled={cargoStickerOrders.length === 0 || orderAction !== null}
              onClick={() => void onDownloadCargoStickers(cargoStickerOrders)}
              title="QR грузомест для сдачи поставки в ПВЗ"
            >
              <QrCode size={16} aria-hidden="true" />
              {orderAction === 'cargo' ? 'Формирую…' : `ШК для ПВЗ (${cargoStickerOrders.length})`}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={supplyStickerOrders.length === 0 || orderAction !== null}
              onClick={() => void onDownloadSupplyStickers(supplyStickerOrders)}
              title="QR поставки после передачи в доставку для сортировочного центра"
            >
              <QrCode size={16} aria-hidden="true" />
              {orderAction === 'supply' ? 'Формирую…' : `ШК для СЦ (${supplyStickerOrders.length})`}
            </button>
            </> : null}
          </div>
          {hasWildberriesOrders ? <p className="fbs-order-actions__hint">
            {data?.deliveryPlan.requiresCargoPlaces
              ? 'ПВЗ: печатается QR грузоместа. Количество товаров в одном грузоместе WMS не ограничивает.'
              : 'СЦ: печатается QR поставки после её передачи в доставку. Грузоместа WB не создаются.'}
          </p> : null}
          {actionMessage ? <p className="fbs-order-actions__message">{actionMessage}</p> : null}
          {actionError ? <p className="fbs-order-actions__error">{actionError}</p> : null}
        </div>
      ) : null}

      <div className="fbs-table-wrap">
        <table className="fbs-table">
          <thead>
            <tr>
              {!readOnlyView ? (
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
              <th>Документы</th>
              <th>{view === 'active' ? 'Создан / прошло' : 'Отгрузка / время'}</th>
              {view === 'cancelled' ? <th>Действие</th> : null}
            </tr>
          </thead>
          {orderGroups.map((group) => {
            if (group.parentDateKey && !expandedGroupKeys.has(group.parentDateKey)) {
              return null;
            }
            const isCollapsed = group.isGrouped && !expandedGroupKeys.has(group.key);
            const groupTitle = fbsOrderGroupTitle(group, view);
            const groupWarehouse = fbsOrderGroupWarehouseLabel(group);
            const groupDescription = fbsOrderGroupDescription(
              group,
              view,
              data?.deliveryPlan.requiresCargoPlaces === true,
            );
            const groupStickerOrders = group.orders.filter(
              fbsOrderStickerIsAvailable,
            );
            const groupDeliverOrders = group.orders.filter(
              (order) => order.marketplace === 'WILDBERRIES' && order.supplierStatus === 'confirm' && Boolean(order.supplyId),
            );
            const groupCargoOrders = group.orders.filter(
              (order) =>
                order.marketplace === 'WILDBERRIES' &&
                fbsOrderRequiresCargoPlaces(order, data?.deliveryPlan.requiresCargoPlaces === true),
            );
            const groupSupplyStickerOrders = group.orders.filter(
              (order) =>
                order.marketplace === 'WILDBERRIES' &&
                order.supplierStatus === 'complete' &&
                Boolean(order.supplyId),
            );
            const groupChangeDestinationOrders = group.orders.filter(
              (order) =>
                order.marketplace === 'WILDBERRIES' &&
                order.supplierStatus === 'confirm' &&
                Boolean(order.supplyId) &&
                fbsOrderRequiresCargoPlaces(order, data?.deliveryPlan.requiresCargoPlaces === true),
            );
            const groupRequests = Array.from(
              new Map(
                group.orders
                  .map((order) => order.request)
                  .filter(
                    (request): request is NonNullable<FbsOrderSummary['request']> =>
                      Boolean(request),
                  )
                  .map((request) => [request.id, request]),
              ).values(),
            );
            const emergencyEligibleRequests = groupRequests.filter(
              (request) =>
                !['PACKED', 'DONE', 'CANCELLED', 'REJECTED'].includes(request.status),
            );
            return (
            <tbody
              key={group.key}
              className={group.isGrouped
                ? `fbs-table__shipment-group${group.kind === 'date' ? ' fbs-table__date-group' : ''}${group.parentDateKey ? ' fbs-table__shipment-group--nested' : ''}`
                : undefined}
            >
              {group.isGrouped ? (
                <tr className="fbs-table__shipment-heading">
                  <td colSpan={tableColumnCount}>
                    <div className="fbs-table__shipment-heading-content">
                      <div>
                        {group.kind === 'date'
                          ? <CalendarDays size={15} aria-hidden="true" />
                          : <PackageCheck size={15} aria-hidden="true" />}
                        <button
                          type="button"
                          className="fbs-table__shipment-toggle"
                          onClick={() => toggleGroup(group.key)}
                          aria-expanded={!isCollapsed}
                          aria-label={isCollapsed ? 'Развернуть группу заказов' : 'Свернуть группу заказов'}
                          title={isCollapsed ? 'Развернуть группу заказов' : 'Свернуть группу заказов'}
                        >
                          {isCollapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                        </button>
                        <strong>{groupTitle}</strong>
                        <b className="fbs-table__shipment-warehouse">{groupWarehouse}</b>
                        <span>{groupDescription}</span>
                      </div>
                      {group.kind !== 'date' ? <div className="fbs-table__shipment-actions">
                        {view === 'shipped'
                          ? emergencyEligibleRequests.map((request) =>
                              request.fbsEmergencyAssemblyAt ? (
                                <span
                                  key={`emergency:${request.id}`}
                                  className="fbs-emergency-assembly-status"
                                  title={`Включил: ${request.fbsEmergencyAssemblyByName || 'администратор'} · ${formatDateTime(request.fbsEmergencyAssemblyAt)}`}
                                >
                                  <AlertTriangle size={13} aria-hidden="true" />
                                  Аварийная сборка включена
                                </span>
                              ) : canEnableEmergencyAssembly ? (
                                <button
                                  key={`emergency:${request.id}`}
                                  type="button"
                                  className="fbs-emergency-assembly-button"
                                  disabled={orderAction !== null}
                                  onClick={() => void onEnableEmergencyAssembly(request)}
                                  title="Вернуть заявку в локальную очередь ТСД без изменения статуса Wildberries"
                                >
                                  <AlertTriangle size={13} aria-hidden="true" />
                                  {orderAction === 'emergency-assembly' && rowActionKey === request.id
                                    ? 'Возвращаю…'
                                    : `Экстренно в сборку №${String(request.number).padStart(6, '0')}`}
                                </button>
                              ) : null,
                            )
                          : null}
                        {!readOnlyView ? (
                          <button type="button" onClick={() => {
                            const next = new Set(selectedOrderKeys);
                            group.orders.forEach((order) => {
                              const key = fbsOrderSelectionKey(order);
                              next.add(key);
                            });
                            onSelectionChange(next);
                          }}>
                            Выбрать группу
                          </button>
                        ) : null}
                        <button type="button" disabled={groupStickerOrders.length === 0 || orderAction !== null} onClick={() => void onDownloadStickers(groupStickerOrders)}>
                          <Download size={13} aria-hidden="true" /> ШК заказов
                        </button>
                        {groupCargoOrders.length > 0 ? (
                          <button type="button" disabled={orderAction !== null} onClick={() => void onDownloadCargoStickers(groupCargoOrders)}>
                            <QrCode size={13} aria-hidden="true" /> QR грузомест
                          </button>
                        ) : null}
                        {view === 'shipped' && groupSupplyStickerOrders.length > 0 ? (
                          <button
                            type="button"
                            disabled={orderAction !== null}
                            onClick={() => void onDownloadSupplyStickers(groupSupplyStickerOrders)}
                            title={`Скачать QR поставки ${group.supplyId}`}
                          >
                            <QrCode size={13} aria-hidden="true" /> QR поставки
                          </button>
                        ) : null}
                        {groupChangeDestinationOrders.length > 0 ? (
                          <button
                            type="button"
                            disabled={orderAction !== null}
                            onClick={() => void onChangeDestination(groupChangeDestinationOrders)}
                            title="Исправить ошибочный выбор ПВЗ и сохранить заказы для сдачи в СЦ"
                          >
                            <ArrowRightLeft size={13} aria-hidden="true" /> ПВЗ → СЦ
                          </button>
                        ) : null}
                        {groupDeliverOrders.length > 0 ? (
                          <button type="button" disabled={orderAction !== null} onClick={() => void onDeliver(groupDeliverOrders)}>
                            <Send size={13} aria-hidden="true" /> Передать WB
                          </button>
                        ) : null}
                      </div> : null}
                    </div>
                  </td>
                </tr>
              ) : null}
              {group.kind !== 'date' && !isCollapsed ? group.orders.map((order) => (
                <FbsOrderRow
                  key={`${order.marketplace}:${order.connectionId}:${order.id}`}
                  order={order}
                  now={clockNow}
                  showBoxes={view === 'active'}
                  selectable={!readOnlyView}
                  selected={selectedOrderKeys.has(fbsOrderSelectionKey(order))}
                  onToggle={() => toggleOrder(order)}
                  actionsDisabled={orderAction !== null}
                  stickerBusy={orderAction === 'stickers' && rowActionKey === fbsOrderSelectionKey(order)}
                  cargoBusy={orderAction === 'cargo' && rowActionKey === fbsOrderSelectionKey(order)}
                  supplyBusy={orderAction === 'supply' && rowActionKey === fbsOrderSelectionKey(order)}
                  pickListBusy={orderAction === 'pick-list' && rowActionKey === fbsOrderSelectionKey(order)}
                  requiresCargoPlaces={fbsOrderRequiresCargoPlaces(
                    order,
                    data?.deliveryPlan.requiresCargoPlaces === true,
                  )}
                  canDownloadPickList={canDownloadPickList}
                  onHideWaitingStock={() => setHiddenWaitingStockKeys((current) => new Set(current).add(fbsOrderSelectionKey(order)))}
                  onDownloadSticker={() => void onDownloadStickers([order])}
                  onDownloadCargoStickers={() => void onDownloadCargoStickers([order])}
                  onDownloadSupplyStickers={() => void onDownloadSupplyStickers([order])}
                  onDownloadPickList={() => void onDownloadPickList(order)}
                  showRemoveCancelledAction={view === 'cancelled'}
                  removeCancelledBusy={orderAction === 'remove-cancelled' && rowActionKey === fbsOrderSelectionKey(order)}
                  onRemoveCancelledOrder={() => void onRemoveCancelledOrder(order)}
                />
              )) : null}
            </tbody>
            );
          })}
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
  now,
  showBoxes,
  selectable,
  selected,
  onToggle,
  actionsDisabled,
  stickerBusy,
  cargoBusy,
  supplyBusy,
  pickListBusy,
  requiresCargoPlaces,
  canDownloadPickList,
  onHideWaitingStock,
  onDownloadSticker,
  onDownloadCargoStickers,
  onDownloadSupplyStickers,
  onDownloadPickList,
  showRemoveCancelledAction,
  removeCancelledBusy,
  onRemoveCancelledOrder,
}: {
  order: FbsOrderSummary;
  now: number;
  showBoxes: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  actionsDisabled: boolean;
  stickerBusy: boolean;
  cargoBusy: boolean;
  supplyBusy: boolean;
  pickListBusy: boolean;
  requiresCargoPlaces: boolean;
  canDownloadPickList: boolean;
  onHideWaitingStock: () => void;
  onDownloadSticker: () => void;
  onDownloadCargoStickers: () => void;
  onDownloadSupplyStickers: () => void;
  onDownloadPickList: () => void;
  showRemoveCancelledAction: boolean;
  removeCancelledBusy: boolean;
  onRemoveCancelledOrder: () => void;
}) {
  const canDownloadSticker =
    fbsOrderStickerIsAvailable(order);
  const canDownloadCargoStickers =
    requiresCargoPlaces &&
    order.marketplace === 'WILDBERRIES' &&
    order.supplierStatus === 'confirm' &&
    Boolean(order.supplyId);
  const canDownloadSupplyStickers =
    !requiresCargoPlaces &&
    order.marketplace === 'WILDBERRIES' &&
    order.supplierStatus === 'complete' &&
    Boolean(order.supplyId);
  const canHideWaitingStock =
    order.reservation?.status === 'WAITING_STOCK' &&
    order.category === 'active';
  const hasActiveRequest = Boolean(order.request && order.request.status !== 'CANCELLED');
  const orderCreatedAt = fbsOrderCreatedAt(order);
  const deliveryFinishedAt = fbsOrderDeliveryFinishedAt(order);
  const elapsed = orderCreatedAt
    ? Math.max(
        0,
        (order.category === 'active' || !deliveryFinishedAt
          ? now
          : deliveryFinishedAt) - orderCreatedAt,
      )
    : null;

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
        <span className={`fbs-order-warehouse-badge${order.warehouseId ? '' : ' is-warning'}`}>
          <Warehouse size={12} aria-hidden="true" />
          {fbsOrderWarehouseLabel(order)}
        </span>
        {order.request ? (
          <span className={`fbs-request-link ${order.request.status === 'CANCELLED' ? 'fbs-request-link--cancelled' : ''}`}>
            {order.request.status === 'CANCELLED' ? 'Отменённая заявка WMS' : 'Заявка WMS'} №{String(order.request.number).padStart(6, '0')}
          </span>
        ) : null}
      </td>
      <td>
        <strong>{order.product?.name || order.article || `Товар ${order.nmId ?? ''}`}</strong>
        <small>
          {[
            order.article,
            order.product?.size ? `Размер: ${order.product.size}` : null,
            order.nmId ? `nmID ${order.nmId}` : null,
            `${Math.max(1, order.itemCount)} ед.`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </small>
      </td>
      <td>
        <span className="fbs-mono">{order.barcodes.join(', ') || 'не передан'}</span>
      </td>
      {showBoxes ? (
        <td>
          {order.reservation?.withoutBox && order.reservation.status === 'RESERVED' ? (
            <div className="fbs-pallet-reservation">
              <strong>Зарезервировано со склада</strong>
              <small>Без привязки к коробу и палет-сорту</small>
            </div>
          ) : order.reservation?.boxCode ? (
            <div className="fbs-pallet-reservation">
              <strong>Зарезервирован: {order.reservation.boxCode}</strong>
              <small>
                Палет-сорт {order.reservation.palletCode || 'не определён'}
              </small>
            </div>
          ) : order.reservation?.status === 'WAITING_STOCK' ? (
            <div className="fbs-pallet-reservation fbs-pallet-reservation--warning">
              <strong>Резерв ожидает товар</strong>
              <small>
                {order.reservation.problem ||
                  (order.reservation.withoutBox
                    ? 'На складе пока нет свободной единицы.'
                    : 'В палет-сорте пока нет свободной единицы.')}
              </small>
              {canHideWaitingStock ? (
                <button
                  type="button"
                  className="fbs-pallet-reservation__remove"
                  onClick={onHideWaitingStock}
                  title="Скроет строку только в текущем списке. Заказ на Wildberries не изменится."
                >
                  Скрыть из виду
                </button>
              ) : null}
            </div>
          ) : null}
          {order.reservation?.withoutBox ? null : order.relabeling ? (
            <div className="fbs-relabel-stock">
              <strong>Нужна переклейка</strong>
              <span>
                Искать: {order.relabeling.sourceProductName || order.relabeling.sourceArticle}
              </span>
              <small>
                Артикул на складе: {order.relabeling.sourceArticle}
                {order.product?.size ? ` · размер ${order.product.size}` : ''}
              </small>
              {order.storageBoxes.length > 0 ? (
                <div className="fbs-box-list fbs-box-list--relabel">
                  {order.storageBoxes.map((box) => (
                    <span key={`${box.code}:${box.status}`}>
                      {box.code} · {box.quantity} шт.
                    </span>
                  ))}
                </div>
              ) : (
                <span className="fbs-missing-box">
                  Для переклейки подходящий короб пока не найден
                </span>
              )}
            </div>
          ) : order.storageBoxes.length > 0 ? (
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
        {order.supplyId ? (
          <small>
            {fbsMarketplaceShipmentLabel(order)} {order.supplyId} · {fbsShipmentDestinationLabel(order, requiresCargoPlaces)}
          </small>
        ) : null}
        {order.category === 'shipped' ? <small>{fbsSentToMarketplaceLabel(order)}</small> : null}
      </td>
      <td>
        <div className="fbs-order-documents">
          <button
            type="button"
            className="fbs-order-document-button"
            disabled={!canDownloadSticker || actionsDisabled}
            onClick={onDownloadSticker}
            title={
              canDownloadSticker
                ? `Скачать ШК заказа ${order.id}`
                : order.marketplace === 'OZON'
                  ? 'Этикетка Ozon появится после передачи сборки в Ozon'
                  : 'ШК появится после перевода заказа в сборку'
            }
          >
            <Download size={14} aria-hidden="true" />
            {stickerBusy ? 'Формирую…' : 'Скачать ШК'}
          </button>
          {order.marketplace === 'WILDBERRIES' ? <>
          <button
            type="button"
            className="fbs-order-document-button fbs-order-document-button--cargo"
            disabled={!canDownloadCargoStickers || actionsDisabled}
            onClick={onDownloadCargoStickers}
            title={
              canDownloadCargoStickers
                ? `Скачать все QR грузомест поставки ${order.supplyId} для ПВЗ`
                : requiresCargoPlaces
                  ? 'ШК для ПВЗ появится после создания грузомест и перевода заказа в сборку'
                  : 'Для клиента выбрана сдача в сортировочный центр'
            }
          >
            <QrCode size={14} aria-hidden="true" />
            {cargoBusy ? 'Формирую…' : 'ШК для ПВЗ'}
          </button>
          <button
            type="button"
            className="fbs-order-document-button"
            disabled={!canDownloadSupplyStickers || actionsDisabled}
            onClick={onDownloadSupplyStickers}
            title={
              canDownloadSupplyStickers
                ? `Скачать QR поставки ${order.supplyId} для сортировочного центра`
                : requiresCargoPlaces
                  ? 'Для клиента выбрана сдача в ПВЗ'
                  : 'ШК для СЦ появится после передачи поставки в доставку'
            }
          >
            <QrCode size={14} aria-hidden="true" />
            {supplyBusy ? 'Формирую…' : 'ШК для СЦ'}
          </button>
          </> : null}
          {canDownloadPickList && hasActiveRequest ? (
            <button
              type="button"
              className="fbs-order-document-button"
              disabled={actionsDisabled}
              onClick={onDownloadPickList}
              title={`Скачать лист подбора заявки №${String(order.request!.number).padStart(6, '0')} для ${marketplaceLabel(order.marketplace)}`}
            >
              <ClipboardList size={14} aria-hidden="true" />
              {pickListBusy ? 'Формирую…' : 'Лист подбора'}
            </button>
          ) : null}
        </div>
      </td>
      <td>
        <strong>{formatDateTime(order.createdAt || order.sellerDate)}</strong>
        {elapsed !== null ? (
          <span
            className={`fbs-order-age fbs-order-age--${fbsOrderAgeTone(elapsed, order.category)}`}
          >
            <Clock3 size={13} aria-hidden="true" />
            {order.category === 'active' ? 'Прошло ' : 'До передачи '}
            {formatElapsedDuration(elapsed)}
          </span>
        ) : null}
        <small>{order.supplyId ? `Поставка ${order.supplyId}` : order.sellerDate || ''}</small>
      </td>
      {showRemoveCancelledAction ? (
        <td className="fbs-cancelled-order-action">
          {order.marketplace === 'WILDBERRIES' ? (
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={onRemoveCancelledOrder}
              title="Снимет резерв и удалит заказ из заявки WMS. Статус на Wildberries не изменится."
            >
              <XCircle size={14} aria-hidden="true" />
              {removeCancelledBusy ? 'Удаляю…' : 'Удалить из WMS'}
            </button>
          ) : (
            <small>Удаление доступно в кабинете маркетплейса</small>
          )}
        </td>
      ) : null}
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
                    <small>
                      {order.product?.name || order.article || 'Товар'}
                      {order.product?.size ? ` · Размер: ${order.product.size}` : ''}
                    </small>
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

export function FbsPricingSettings({
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
        ? [...form!.additionalServices, {
            serviceId,
            quantityMultiplier: 1,
            matchKeywords: '',
          }]
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
              <h4>Первичная обработка клиента</h4>
              <p>Здесь задаётся, какие услуги по умолчанию входят в первичную обработку FBS.</p>
            </div>
          </div>
        </header>
        <div className="fbs-pricing__pallets">
          <label className={form.primaryProcessingEnabled ? 'is-enabled' : undefined}>
            <input
              checked={form.primaryProcessingEnabled}
              type="checkbox"
              onChange={(event) => patch('primaryProcessingEnabled', event.target.checked)}
            />
            <span>
              <strong>Начислять первичную обработку</strong>
              <small>Выбранные ниже услуги будут начисляться по фактически отгруженному количеству.</small>
            </span>
          </label>
        </div>
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
            <span>
              Состав первичной обработки. Признаки отреза берутся из названия, артикула и размера SKU;
              несколько вариантов разделяйте точкой с запятой.
            </span>
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
                      <small>{service.code} · {formatMoney(service.priceRub)} ₽ за отрез/шт.</small>
                      {selected ? (
                        <input
                          className="fbs-pricing__match"
                          placeholder="Как распознать: 3 м; отрез 3м"
                          type="text"
                          value={selected.matchKeywords}
                          onChange={(event) => patch(
                            'additionalServices',
                            form.additionalServices.map((selection) =>
                              selection.serviceId === service.id
                                ? { ...selection, matchKeywords: event.target.value }
                                : selection),
                          )}
                        />
                      ) : null}
                    </span>
                    {selected ? (
                      <input
                        aria-label={`Количество услуги ${service.name} на единицу товара`}
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
              <h4>Логистика партии FBS</h4>
              <p>Можно использовать обычный тариф либо ступени: бесплатно, куб, затем паллеты.</p>
            </div>
          </div>
        </header>
        <div className="fbs-pricing__pallets">
          <label className={form.tieredLogisticsEnabled ? 'is-enabled' : undefined}>
            <input
              checked={form.tieredLogisticsEnabled}
              type="checkbox"
              onChange={(event) => patch('tieredLogisticsEnabled', event.target.checked)}
            />
            <span>
              <strong>Ступенчатая логистика</strong>
              <small>До лимита бесплатно; затем цена за объём до куба; свыше — за каждую паллету.</small>
            </span>
          </label>
          <div className="fbs-pricing__fields">
            <label>
              <span>Бесплатно до, ед.</span>
              <input
                min="0"
                step="1"
                type="number"
                value={form.logisticsFreeItemsLimit}
                onChange={(event) => patch('logisticsFreeItemsLimit', nonNegativeInteger(event.target.value))}
                required
              />
            </label>
            <label>
              <span>Объём одного куба, л</span>
              <input
                min="1"
                step="1"
                type="number"
                value={form.logisticsCubicMeterLiters}
                onChange={(event) => patch('logisticsCubicMeterLiters', positiveInteger(event.target.value))}
                required
              />
            </label>
            <label>
              <span>Цена до одного куба, ₽</span>
              <input
                min="0"
                step="0.01"
                type="number"
                value={form.logisticsCubicMeterPriceRub}
                onChange={(event) => patch('logisticsCubicMeterPriceRub', nonNegativeNumber(event.target.value))}
                required
              />
            </label>
            <label>
              <span>Цена каждой паллеты, ₽</span>
              <input
                min="0"
                step="0.01"
                type="number"
                value={form.logisticsPalletPriceRub}
                onChange={(event) => patch('logisticsPalletPriceRub', nonNegativeNumber(event.target.value))}
                required
              />
            </label>
          </div>
        </div>
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
            <small>Текущий норматив — 14 единиц товара на короб.</small>
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
  onAccountNameChange,
  onSellerIdChange,
  onApiKeyChange,
  onSubmit,
}: {
  isOpen: boolean;
  marketplace: FbsMarketplace;
  accountName: string;
  sellerId: string;
  apiKey: string;
  error: string;
  isSubmitting: boolean;
  onOpen: () => void;
  onCancel: () => void;
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
          <strong>API {marketplaceLabel(marketplace)} не подключён</strong>
          <p>Подключите кабинет {marketplaceLabel(marketplace)}, чтобы получать его FBS-заказы и статусы.</p>
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
          <select value={marketplace} disabled>
            <option value={marketplace}>{marketplaceLabel(marketplace)}</option>
          </select>
        </label>
        <label>
          <span>Название кабинета</span>
          <input value={accountName} onChange={(event) => onAccountNameChange(event.target.value)} placeholder="Например, основной" />
        </label>
        {marketplace !== 'WILDBERRIES' ? (
          <label>
            <span>{marketplace === 'OZON' ? 'Client-Id Ozon' : 'Campaign ID Яндекс Маркета'}</span>
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
    primaryProcessingEnabled: Boolean(data.settings.primaryProcessingEnabled),
    defaultDeliveryDestination: data.settings.defaultDeliveryDestination,
    pickupPointBasePriceRub: Number(data.settings.pickupPointBasePriceRub),
    vnukovoBasePriceRub: Number(data.settings.vnukovoBasePriceRub),
    baseIncludedItems: Number(data.settings.baseIncludedItems),
    extraBlockItems: Number(data.settings.extraBlockItems),
    extraBlockPriceRub: Number(data.settings.extraBlockPriceRub),
    tieredLogisticsEnabled: Boolean(data.settings.tieredLogisticsEnabled),
    logisticsFreeItemsLimit: Number(data.settings.logisticsFreeItemsLimit),
    logisticsCubicMeterLiters: Number(data.settings.logisticsCubicMeterLiters),
    logisticsCubicMeterPriceRub: Number(data.settings.logisticsCubicMeterPriceRub),
    logisticsPalletPriceRub: Number(data.settings.logisticsPalletPriceRub),
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
  const deliveryRub = settings.tieredLogisticsEnabled
    ? items <= settings.logisticsFreeItemsLimit
      ? 0
      : settings.logisticsCubicMeterPriceRub
    : baseDeliveryRub + extraBlocks * settings.extraBlockPriceRub;
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

function nonNegativeInteger(value: string) {
  return Math.max(0, Math.trunc(Number(value)) || 0);
}

function positiveInteger(value: string) {
  return Math.max(1, Math.trunc(Number(value)) || 1);
}

function normalizeFbsOrderNumber(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/^заказ\s*/u, '')
    .replace(/^№\s*/u, '')
    .replace(/\s+/g, '');
}

function fbsCategorySearchLabel(category: FbsOrderSummary['category']) {
  if (category === 'active') return 'активные заказы';
  if (category === 'shipped') return 'отгруженные';
  if (category === 'cancelled') return 'отменённые';
  return 'архив';
}

function filterFbsOrdersByMarketplace(
  source: ClientFbsOrders | null,
  marketplace: FbsMarketplace | null,
): ClientFbsOrders | null {
  if (!source || !marketplace) return null;
  const connections = source.connections.filter((connection) => connection.marketplace === marketplace);
  const orders = source.orders.filter((order) => order.marketplace === marketplace);
  const count = (category: FbsOrderSummary['category']) =>
    orders.filter((order) => order.category === category).length;
  return {
    ...source,
    connected: connections.length > 0,
    connections,
    orders,
    counts: {
      active: count('active'),
      shipped: count('shipped'),
      cancelled: count('cancelled'),
      archive: count('archive'),
      all: orders.length,
    },
  };
}

function marketplaceLabel(marketplace: FbsMarketplace) {
  if (marketplace === 'WILDBERRIES') return 'Wildberries';
  if (marketplace === 'OZON') return 'Ozon';
  return 'Яндекс Маркет';
}

function marketplaceEyebrow(marketplace: FbsMarketplace) {
  if (marketplace === 'WILDBERRIES') return 'Wildberries';
  if (marketplace === 'OZON') return 'Ozon Seller';
  return 'Яндекс Маркет';
}

function marketplaceTitle(marketplace: FbsMarketplace) {
  if (marketplace === 'WILDBERRIES') return 'FBS Wildberries';
  if (marketplace === 'OZON') return 'FBS Ozon';
  return 'FBS Яндекс';
}

type FbsWarehouseGroup = {
  key: string;
  label: string;
  orders: FbsOrderSummary[];
  itemCount: number;
  supplyCount: number;
  criticalCount: number;
  isUnknown: boolean;
};

function fbsOrderWarehouseKey(
  order: Pick<FbsOrderSummary, 'connectionId' | 'marketplace' | 'warehouseId' | 'officeId'>,
) {
  return [
    order.marketplace,
    order.connectionId,
    order.warehouseId || order.officeId || 'unknown',
  ].join(':');
}

function fbsOrderWarehouseLabel(
  order: Pick<FbsOrderSummary, 'marketplace' | 'warehouseId' | 'warehouseName' | 'officeId'>,
) {
  const marketplace = order.marketplace === 'WILDBERRIES'
    ? 'WB'
    : order.marketplace === 'OZON'
      ? 'Ozon'
      : 'Яндекс';
  const name = order.warehouseName?.trim();
  if (name) return `${marketplace} · ${name}`;
  if (order.warehouseId) return `${marketplace} · склад №${order.warehouseId}`;
  if (order.officeId) return `${marketplace} · ${order.officeId}`;
  return 'Склад маркетплейса не определён';
}

function groupFbsOrdersByWarehouse(
  orders: FbsOrderSummary[],
  now: number,
): FbsWarehouseGroup[] {
  const groups = new Map<string, FbsOrderSummary[]>();
  for (const order of orders) {
    const key = fbsOrderWarehouseKey(order);
    const group = groups.get(key) ?? [];
    group.push(order);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, groupOrders]) => {
      const first = groupOrders[0];
      const account = first.accountName?.trim();
      const warehouseLabel = fbsOrderWarehouseLabel(first);
      return {
        key,
        label: account ? `${warehouseLabel} · ${account}` : warehouseLabel,
        orders: groupOrders,
        itemCount: groupOrders.reduce(
          (sum, order) => sum + Math.max(1, order.itemCount),
          0,
        ),
        supplyCount: new Set(
          groupOrders
            .map((order) => order.supplyId)
            .filter((supplyId): supplyId is string => Boolean(supplyId)),
        ).size,
        criticalCount: groupOrders.filter((order) => {
          const createdAt = fbsOrderCreatedAt(order);
          return (
            order.category === 'active' &&
            createdAt !== null &&
            now - createdAt >= 19 * 60 * 60 * 1000
          );
        }).length,
        isUnknown: !first.warehouseId && !first.officeId,
      };
    })
    .sort((left, right) =>
      Number(left.isUnknown) - Number(right.isUnknown) ||
      right.orders.length - left.orders.length ||
      left.label.localeCompare(right.label, 'ru-RU'),
    );
}

function fbsOrderSelectionKey(order: Pick<FbsOrderSummary, 'connectionId' | 'id'>) {
  return `${order.connectionId}:${order.id}`;
}

function groupMissingWmsRequestsByWarehouse(orders: FbsOrderSummary[]) {
  return groupFbsOrdersForRequestsByWarehouse(
    orders.filter((order) =>
      order.marketplace === 'WILDBERRIES' &&
      order.category === 'active' &&
      Boolean(order.supplyId) &&
      (!order.request || order.request.status === 'CANCELLED'),
    ),
    true,
  );
}

function groupFbsOrdersForRequestsByWarehouse(orders: FbsOrderSummary[], separateSupplies: boolean) {
  const groups = new Map<string, FbsOrderSummary[]>();
  for (const order of orders) {
    const warehouseKey = order.warehouseId || order.officeId || 'unknown';
    const key = `${order.connectionId}:${warehouseKey}${separateSupplies ? `:${order.supplyId || 'without-supply'}` : ''}`;
    const group = groups.get(key) ?? [];
    group.push(order);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) =>
    fbsOrderWarehouseLabel(left[0]).localeCompare(fbsOrderWarehouseLabel(right[0]), 'ru-RU') ||
    String(left[0].supplyId).localeCompare(String(right[0].supplyId), 'ru-RU', { numeric: true }),
  );
}

function isFbsOrderMoveCandidate(order: FbsOrderSummary) {
  return (
    order.marketplace === 'WILDBERRIES' &&
    order.category === 'active' &&
    order.supplierStatus === 'confirm' &&
    Boolean(order.supplyId) &&
    Boolean(order.request) &&
    !['PACKED', 'DONE', 'CANCELLED', 'REJECTED'].includes(
      order.request?.status ?? '',
    )
  );
}

type FbsOrderGroup = {
  key: string;
  kind: 'date' | 'supply' | 'request' | 'order';
  parentDateKey?: string;
  supplyId: string;
  requestNumber: number | null;
  requestNumbers: number[];
  orders: FbsOrderSummary[];
  isGrouped: boolean;
};

type FbsOrderSort =
  | 'date-oldest'
  | 'date-newest'
  | 'order-asc'
  | 'order-desc'
  | 'request-asc'
  | 'request-desc'
  | 'warehouse-asc'
  | 'warehouse-desc'
  | 'status-asc'
  | 'status-desc';

function compareFbsOrdersOldestFirst(
  left: FbsOrderSummary,
  right: FbsOrderSummary,
) {
  const leftTime = fbsOrderCreatedAt(left);
  const rightTime = fbsOrderCreatedAt(right);
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (leftTime !== null) return -1;
  if (rightTime !== null) return 1;
  return left.id.localeCompare(right.id, 'ru-RU', {
    numeric: true,
    sensitivity: 'base',
  });
}

function compareFbsOrders(
  left: FbsOrderSummary,
  right: FbsOrderSummary,
  sort: FbsOrderSort,
) {
  if (sort === 'date-oldest' || sort === 'date-newest') {
    const leftTime = fbsOrderCreatedAt(left);
    const rightTime = fbsOrderCreatedAt(right);
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
      return sort === 'date-oldest' ? leftTime - rightTime : rightTime - leftTime;
    }
    if (leftTime !== null && rightTime === null) return -1;
    if (leftTime === null && rightTime !== null) return 1;
  }

  if (sort === 'request-asc' || sort === 'request-desc') {
    const leftRequest = left.request?.number;
    const rightRequest = right.request?.number;
    if (leftRequest !== undefined && rightRequest !== undefined && leftRequest !== rightRequest) {
      return sort === 'request-asc' ? leftRequest - rightRequest : rightRequest - leftRequest;
    }
    if (leftRequest !== undefined && rightRequest === undefined) return -1;
    if (leftRequest === undefined && rightRequest !== undefined) return 1;
  }

  if (sort === 'warehouse-asc' || sort === 'warehouse-desc') {
    const result = compareOptionalFbsText(
      left.warehouseName || left.warehouseId || left.officeId,
      right.warehouseName || right.warehouseId || right.officeId,
      sort === 'warehouse-desc',
    );
    if (result !== 0) return result;
  }

  if (sort === 'status-asc' || sort === 'status-desc') {
    const result = compareOptionalFbsText(
      left.statusLabel || left.supplierStatus,
      right.statusLabel || right.supplierStatus,
      sort === 'status-desc',
    );
    if (result !== 0) return result;
  }

  const orderResult = left.id.localeCompare(right.id, 'ru-RU', {
    numeric: true,
    sensitivity: 'base',
  });
  if (orderResult !== 0) {
    return sort === 'order-desc' || sort === 'request-desc'
      ? -orderResult
      : orderResult;
  }
  return compareFbsOrdersOldestFirst(left, right);
}

function compareOptionalFbsText(
  left: string | null | undefined,
  right: string | null | undefined,
  descending: boolean,
) {
  const leftValue = left?.trim() ?? '';
  const rightValue = right?.trim() ?? '';
  if (leftValue && !rightValue) return -1;
  if (!leftValue && rightValue) return 1;
  const result = leftValue.localeCompare(rightValue, 'ru-RU', {
    numeric: true,
    sensitivity: 'base',
  });
  return descending ? -result : result;
}

function fbsOrderCreatedAt(order: FbsOrderSummary) {
  return validTimestamp(order.createdAt) ?? validTimestamp(order.sellerDate);
}

function fbsOrderDeliveryFinishedAt(order: FbsOrderSummary) {
  return (
    validTimestamp(order.shipmentPlan?.sentToWbAt) ??
    (order.category !== 'active' ? validTimestamp(order.deliveryDate) : null)
  );
}

function fbsOrderFinishedDayKey(order: FbsOrderSummary) {
  const timestamp = fbsOrderDeliveryFinishedAt(order) ?? fbsOrderCreatedAt(order);
  return timestamp === null ? null : new Date(timestamp).toISOString().slice(0, 10);
}

function validTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatElapsedDuration(milliseconds: number) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days} д ${hours} ч`;
  }
  if (hours > 0) {
    return `${hours} ч ${minutes} мин`;
  }
  return `${minutes} мин`;
}

function fbsOrderAgeTone(
  milliseconds: number,
  category: FbsOrderSummary['category'],
) {
  if (category !== 'active') return 'finished';
  const hours = milliseconds / (60 * 60 * 1000);
  if (hours >= 19) return 'critical';
  if (hours >= 12) return 'warning';
  return 'normal';
}

function groupFbsOrdersBySupply(
  orders: FbsOrderSummary[],
  view: FbsView,
  sort: FbsOrderSort,
): FbsOrderGroup[] {
  if (view !== 'shipped') return groupFbsOrdersBySupplyOnly(orders);

  const baseGroups = groupFbsOrdersBySupplyOnly(orders);
  const dateGroups = new Map<string, FbsOrderGroup[]>();

  for (const group of baseGroups) {
    const day = fbsOrderGroupFinishedDayKey(group) ?? 'unknown';
    dateGroups.set(day, [...(dateGroups.get(day) ?? []), group]);
  }

  const direction = sort === 'date-newest' ? -1 : 1;
  return [...dateGroups.entries()]
    .sort(([leftDay], [rightDay]) => {
      if (leftDay === 'unknown') return 1;
      if (rightDay === 'unknown') return -1;
      return leftDay.localeCompare(rightDay) * direction;
    })
    .flatMap(([day, groups]) => {
      const dateKey = `date:${day}`;
      const dateOrders = groups.flatMap((group) => group.orders);
      const dateGroup: FbsOrderGroup = {
        key: dateKey,
        kind: 'date',
        supplyId: '',
        requestNumber: null,
        requestNumbers: [
          ...new Set(
            dateOrders
              .map((order) => order.request?.number)
              .filter((number): number is number => Boolean(number)),
          ),
        ],
        orders: dateOrders,
        isGrouped: true,
      };
      const nestedGroups = groups.map((group) => ({
        ...group,
        key: `${dateKey}:${group.key}`,
        parentDateKey: dateKey,
      }));
      return [dateGroup, ...nestedGroups];
    });
}

function fbsOrderGroupFinishedDayKey(group: FbsOrderGroup) {
  const days = group.orders
    .map(fbsOrderFinishedDayKey)
    .filter((day): day is string => day !== null)
    .sort();
  return days[0] ?? null;
}

function filterFbsShippedOrdersByDate(
  orders: FbsOrderSummary[],
  dateFrom: string,
  dateTo: string,
) {
  if (!dateFrom && !dateTo) return orders;
  const isInPeriod = (order: FbsOrderSummary) => {
    const day = fbsOrderFinishedDayKey(order);
    if (dateFrom && (!day || day < dateFrom)) return false;
    if (dateTo && (!day || day > dateTo)) return false;
    return true;
  };
  const includedSupplyKeys = new Set(
    orders
      .filter((order) => Boolean(order.supplyId?.trim()) && isInPeriod(order))
      .map((order) => `${order.connectionId}:${order.supplyId!.trim()}`),
  );
  return orders.filter((order) => {
    const supplyId = order.supplyId?.trim();
    if (!supplyId) return isInPeriod(order);
    return includedSupplyKeys.has(`${order.connectionId}:${supplyId}`);
  });
}

function groupFbsOrdersBySupplyOnly(orders: FbsOrderSummary[]): FbsOrderGroup[] {
  const groups = new Map<
    string,
    Omit<FbsOrderGroup, 'isGrouped' | 'parentDateKey'>
  >();
  for (const order of orders) {
    const supplyId = order.supplyId?.trim() ?? '';
    const requestId = order.request?.id ?? '';
    const kind = supplyId ? 'supply' : requestId ? 'request' : 'order';
    const key =
      kind === 'supply'
        ? `supply:${order.connectionId}:${supplyId}`
        : kind === 'request'
          ? `request:${order.connectionId}:${requestId}`
          : `order:${fbsOrderSelectionKey(order)}`;
    const group = groups.get(key) ?? {
      key,
      kind,
      supplyId,
      requestNumber: order.request?.number ?? null,
      requestNumbers: [],
      orders: [],
    };
    if (order.request?.number && !group.requestNumbers.includes(order.request.number)) {
      group.requestNumbers.push(order.request.number);
    }
    group.orders.push(order);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    isGrouped: group.kind !== 'order',
  }));
}

function fbsOrderGroupTitle(group: FbsOrderGroup, view: FbsView) {
  if (group.kind === 'date') {
    const day = group.key.slice('date:'.length);
    if (day === 'unknown') {
      return view === 'shipped' ? 'Дата отгрузки не определена' : 'Дата заказа не определена';
    }
    if (view === 'shipped') return `Отгружено ${formatDateOnly(day)}`;
    if (view === 'cancelled') return `Отменено ${formatDateOnly(day)}`;
    if (view === 'archive') return `Архив за ${formatDateOnly(day)}`;
    return `Заказы за ${formatDateOnly(day)}`;
  }
  if (group.kind === 'request') {
    return `Заявка WMS №${String(group.requestNumber ?? '').padStart(6, '0')}`;
  }
  if (view === 'shipped' && group.supplyId) {
    return `${fbsMarketplaceShipmentLabel(group.orders[0])} ${group.supplyId}`;
  }
  if (view === 'shipped') return 'Отгруженные без номера поставки';
  if (view === 'archive') return 'Заказы одной поставки';
  if (view === 'cancelled') return 'Заказы одной поставки';
  return 'Одна поставка FBS';
}

function fbsOrderGroupWarehouseLabel(group: FbsOrderGroup) {
  const warehouses = Array.from(
    new Set(
      group.orders
        .map((order) => order.warehouseName?.trim() || order.warehouseId?.trim() || '')
        .filter(Boolean),
    ),
  );
  const marketplace = fbsGroupMarketplaceShortLabel(group);
  if (warehouses.length === 0) return `СКЛАД ${marketplace}: НЕ ОПРЕДЕЛЁН`;
  const names = warehouses.map((warehouse) => warehouse.toLocaleUpperCase('ru-RU')).join(' / ');
  return `${warehouses.length > 1 ? 'СКЛАДЫ' : 'СКЛАД'} ${marketplace}: ${names}`;
}

function fbsOrderGroupDescription(
  group: FbsOrderGroup,
  view: FbsView,
  fallbackRequiresCargoPlaces: boolean,
) {
  const ordersLabel = `${group.orders.length} ${pluralizeRu(group.orders.length, 'заказ', 'заказа', 'заказов')}`;
  if (group.kind === 'date') {
    const itemsCount = group.orders.reduce((sum, order) => sum + Math.max(1, order.itemCount), 0);
    const supplies = new Set(group.orders.map((order) => order.supplyId).filter(Boolean)).size;
    return `${ordersLabel} · ${itemsCount} товаров · ${supplies} поставок`;
  }
  if (group.kind === 'request') {
    const marketplace = group.orders[0]?.marketplace ?? 'WILDBERRIES';
    const shipment = marketplace === 'WILDBERRIES'
      ? 'поставке WB'
      : marketplace === 'OZON'
        ? 'отправлению Ozon'
        : 'отправлению Яндекс Маркета';
    const distribution = group.orders.length === 1 ? 'ещё не распределён' : 'ещё не распределены';
    return `${ordersLabel} · ${distribution} по ${shipment}`;
  }
  const shipment = fbsShipmentDestinationLabel(group.orders[0], fallbackRequiresCargoPlaces);
  const itemsCount = group.orders.reduce((sum, order) => sum + Math.max(1, order.itemCount), 0);
  const requestsLabel = group.requestNumbers.length > 0
    ? ` · заявка WMS ${group.requestNumbers.map((number) => `№${String(number).padStart(6, '0')}`).join(', ')}`
    : '';
  const prefix = group.supplyId ? `Поставка ${group.supplyId}${requestsLabel}` : view === 'shipped' ? 'Переданные заказы' : 'Заказы';
  const sentToMarketplaceLabel = view === 'shipped' ? ` · ${fbsSentToMarketplaceLabel(group.orders[0])}` : '';
  const emergencyLabel = group.orders.some((order) => order.request?.fbsEmergencyAssemblyAt)
    ? ' · аварийная локальная сборка активна'
    : '';
  return `${prefix} · ${itemsCount} товаров внутри (${ordersLabel}) · ${shipment}${sentToMarketplaceLabel}${emergencyLabel}`;
}

function fbsSentToMarketplaceLabel(order: FbsOrderSummary) {
  const sender = order.shipmentPlan?.sentToWbBy?.name?.trim() || 'не зафиксирован';
  const sentAt = order.shipmentPlan?.sentToWbAt
    ? ` · ${formatDateTime(order.shipmentPlan.sentToWbAt)}`
    : '';
  return `Отправил в ${marketplaceLabel(order.marketplace)}: ${sender}${sentAt}`;
}

function fbsGroupMarketplaceShortLabel(group: FbsOrderGroup) {
  const marketplaces = Array.from(new Set(group.orders.map((order) => order.marketplace)));
  return marketplaces.map((marketplace) => {
    if (marketplace === 'WILDBERRIES') return 'WB';
    if (marketplace === 'OZON') return 'OZON';
    return 'ЯНДЕКС';
  }).join(' / ') || 'FBS';
}

function fbsMarketplaceShipmentLabel(order: FbsOrderSummary) {
  if (order.marketplace === 'WILDBERRIES') return 'Поставка WB';
  if (order.marketplace === 'OZON') return 'Отправление Ozon';
  return 'Отправление Яндекс';
}

function pluralizeRu(value: number, one: string, few: string, many: string) {
  const absolute = Math.abs(value) % 100;
  const lastDigit = absolute % 10;
  if (absolute > 10 && absolute < 20) return many;
  if (lastDigit === 1) return one;
  if (lastDigit >= 2 && lastDigit <= 4) return few;
  return many;
}

function estimateFbsCargoPlaces(orders: FbsOrderSummary[]) {
  const groups = new Map<string, number>();
  for (const order of orders) {
    const key = [
      order.connectionId,
      order.cargoType ?? 'unknown-cargo',
      order.warehouseId ?? 'unknown-warehouse',
      order.crossBorderType ?? 'regular',
    ].join(':');
    groups.set(key, (groups.get(key) ?? 0) + Math.max(1, order.itemCount));
  }
  return groups.size;
}

function fbsOrderRequiresCargoPlaces(order: FbsOrderSummary, fallback: boolean) {
  return order.shipmentPlan?.requiresCargoPlaces ?? fallback;
}

function buildFbsSynchronizationAudit(
  data: ClientFbsOrders,
  marketplace: FbsMarketplace,
): FbsSynchronizationAudit {
  const groups = new Map<string, {
    request: NonNullable<FbsOrderSummary['request']>;
    orders: FbsOrderSummary[];
  }>();
  const marketplaceOrders = data.orders.filter((order) => order.marketplace === marketplace);
  for (const order of marketplaceOrders) {
    if (!order.request) continue;
    const current = groups.get(order.request.id) ?? { request: order.request, orders: [] };
    current.orders.push(order);
    groups.set(order.request.id, current);
  }

  const closedStatuses = new Set(['DONE', 'CANCELLED', 'REJECTED']);
  const issues: FbsSynchronizationIssue[] = [];
  for (const { request, orders } of groups.values()) {
    const activeOrders = orders.filter((order) => order.category === 'active').length;
    const shippedOrders = orders.filter((order) => order.category === 'shipped').length;
    const archivedOrders = orders.filter((order) => order.category === 'archive').length;
    const cancelledOrders = orders.filter((order) => order.category === 'cancelled').length;
    const wmsClosed = closedStatuses.has(request.status);
    if (!wmsClosed && activeOrders === 0 && shippedOrders === 0 && (archivedOrders > 0 || cancelledOrders > 0)) {
      issues.push({
        requestId: request.id,
        requestNumber: request.number,
        requestTitle: request.title,
        wmsStatus: request.status,
        activeOrders,
        shippedOrders,
        cancelledOrders,
        kind: 'WMS_OPEN_MARKETPLACE_FINISHED',
      });
    } else if (wmsClosed && activeOrders > 0) {
      issues.push({
        requestId: request.id,
        requestNumber: request.number,
        requestTitle: request.title,
        wmsStatus: request.status,
        activeOrders,
        shippedOrders,
        cancelledOrders,
        kind: 'WMS_CLOSED_MARKETPLACE_ACTIVE',
      });
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    checkedRequests: groups.size,
    checkedOrders: marketplaceOrders.length,
    issues: issues.sort((left, right) => right.requestNumber - left.requestNumber),
  };
}

function fbsRequestStatusLabel(status: string) {
  const labels: Record<string, string> = {
    DRAFT: 'Черновик',
    SUBMITTED: 'Новая',
    IN_WORK: 'В работе',
    PACKED: 'Собрана',
    DONE: 'Завершена',
    CANCELLED: 'Отменена',
    REJECTED: 'Отклонена',
  };
  return labels[status] ?? status;
}

function fbsOrderStickerIsAvailable(order: FbsOrderSummary) {
  if (order.marketplace === 'WILDBERRIES') {
    return ['confirm', 'complete'].includes(order.supplierStatus);
  }
  if (order.marketplace === 'OZON') {
    return ['awaiting_deliver', 'arbitration', 'delivering', 'delivered'].includes(
      order.supplierStatus,
    );
  }
  return false;
}

function fbsShipmentDestinationLabel(order: FbsOrderSummary, fallbackRequiresCargoPlaces: boolean) {
  if (order.marketplace !== 'WILDBERRIES') return fbsMarketplaceShipmentLabel(order);
  const requiresCargoPlaces = fbsOrderRequiresCargoPlaces(order, fallbackRequiresCargoPlaces);
  if (!requiresCargoPlaces) return 'Сортировочный центр WB';
  const cargoPlaceCount = order.shipmentPlan?.cargoPlaceCount ?? 0;
  return `ПВЗ${cargoPlaceCount > 0 ? ` · ${cargoPlaceCount} грузомест` : ''}`;
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

function formatDateOnly(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
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
