import {
  AlertTriangle,
  ArrowRightLeft,
  Archive,
  BadgeRussianRuble,
  Boxes,
  Calculator,
  CarFront,
  CircleCheckBig,
  ClipboardList,
  Clock3,
  Download,
  FilePlus2,
  Link2,
  ListChecks,
  MapPin,
  PackageCheck,
  PlugZap,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  ShoppingBasket,
  Truck,
  XCircle,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  assembleFbsOrders,
  cancelFbsOrders,
  changeFbsSuppliesDestination,
  createFbsPass,
  createFbsMarketplaceConnection,
  createFbsRequest,
  deleteFbsPass,
  deliverFbsSupplies,
  downloadFbsCargoPlaceStickersPdf,
  downloadFbsOrderStickersPdf,
  downloadFbsRequestPickListPdf,
  downloadFbsSupplyStickersPdf,
  fetchClients,
  fetchFbsActiveClients,
  fetchFbsBillingSettings,
  fetchFbsCargoPackings,
  fetchFbsOrders,
  fetchFbsPasses,
  moveFbsOrdersToNewSupply,
  reshipFbsOrders,
  updateFbsPass,
  updateFbsBillingSettings,
  type AuthSession,
  type ClientFbsOrders,
  type ClientSummary,
  type FbsActiveClientSummary,
  type FbsBillingSettings,
  type FbsCargoPackingsResponse,
  type FbsDeliveryDestination,
  type FbsOrderSummary,
  type FbsPass,
  type FbsPassPayload,
  type FbsPassesResponse,
  type UpdateFbsBillingSettingsPayload,
} from '../../lib/api';
import { FbsCostCalculator } from './FbsCostCalculator';
import './fbs.css';

type FbsPanelProps = {
  session: AuthSession;
};

type FbsView = 'active' | 'cargo' | 'shipped' | 'cancelled' | 'cost' | 'calculator' | 'archive' | 'passes' | 'pricing';
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
    id: 'cargo' as const,
    title: 'Упаковка грузомест ПВЗ',
    description: 'Точный состав каждого грузоместа, заполнение по 14 единиц и готовность поставки.',
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

export function FbsPanel({ session }: FbsPanelProps) {
  const [activeView, setActiveView] = useState<FbsView>('active');
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [activeClients, setActiveClients] = useState<FbsActiveClientSummary[]>([]);
  const [activeClientsLoading, setActiveClientsLoading] = useState(true);
  const [selectedClientId, setSelectedClientId] = useState(
    session.user.clientIds.length === 1 ? session.user.clientIds[0] : '',
  );
  const [search, setSearch] = useState('');
  const [ordersState, setOrdersState] = useState<OrdersState>({ status: 'idle', data: null, error: '' });
  const [cargoState, setCargoState] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: FbsCargoPackingsResponse | null;
    error: string;
  }>({ status: 'idle', data: null, error: '' });
  const [selectedOrderKeys, setSelectedOrderKeys] = useState<Set<string>>(() => new Set());
  const [orderAction, setOrderAction] = useState<
    'assemble' | 'reship' | 'move' | 'deliver' | 'change-destination' | 'cancel' | 'stickers' | 'cargo' | 'supply' | 'request' | 'pick-list' | null
  >(null);
  const [rowActionKey, setRowActionKey] = useState<string | null>(null);
  const [orderActionMessage, setOrderActionMessage] = useState('');
  const [orderActionError, setOrderActionError] = useState('');
  const [assemblyDialog, setAssemblyDialog] = useState<{
    orders: FbsOrderSummary[];
    destination: FbsDeliveryDestination;
    mode: 'assemble' | 'reship';
  } | null>(null);
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
  const canDownloadPickList = true;

  const loadActiveClients = useCallback(async () => {
    setActiveClientsLoading(true);
    try {
      setActiveClients(await fetchFbsActiveClients(session.accessToken));
    } catch {
      setActiveClients([]);
    } finally {
      setActiveClientsLoading(false);
    }
  }, [session.accessToken]);

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

  useEffect(() => {
    void loadActiveClients();
    const timer = window.setInterval(() => void loadActiveClients(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadActiveClients]);

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
      void loadOrders(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadOrders, selectedClientId]);

  useEffect(() => {
    if (activeView !== 'cargo' || !selectedClientId) return;
    void loadCargoPackings();
    const timer = window.setInterval(() => void loadCargoPackings(), 20_000);
    return () => window.clearInterval(timer);
  }, [activeView, loadCargoPackings, selectedClientId]);

  useEffect(() => {
    setSelectedOrderKeys(new Set());
    setRowActionKey(null);
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
  const activeOrdersTotal = activeClients.reduce((sum, item) => sum + item.activeOrders, 0);
  const tileCounts: Record<FbsView, number | string> = {
    active: activeOrdersTotal,
    cargo: cargoState.data?.supplies.filter((supply) => !supply.readyToDeliver).length ?? 0,
    shipped: data?.counts.shipped ?? 0,
    cancelled: data?.counts.cancelled ?? 0,
    cost: data?.counts.shipped ?? 0,
    calculator: '1–3000',
    archive: data?.counts.archive ?? 0,
    passes: '48 ч',
    pricing: 'тарифы',
  };

  async function assembleSelectedOrders(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
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
      void loadActiveClients();
      const cargoPlaceCount = result.supplies.reduce((sum, supply) => sum + supply.cargoPlaceCount, 0);
      setOrderActionMessage(
        result.deliveryPlan.requiresCargoPlaces
          ? `${result.assembled} заказ(а/ов) ${mode === 'reship' ? 'переведено в повторную отгрузку' : 'переведено в сборку'}. Создано грузомест: ${cargoPlaceCount} — по ${result.deliveryPlan.itemsPerCargoPlace} единиц. Теперь скачайте ШК заказов и QR грузомест.`
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
      void loadActiveClients();
    } catch (caught) {
      setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось отменить заказы.');
    } finally {
      setOrderAction(null);
    }
  }

  async function deliverSelectedSupplies(orders: FbsOrderSummary[]) {
    if (!selectedClientId || orders.length === 0) return;
    const supplyCount = new Set(orders.map((order) => `${order.connectionId}:${order.supplyId}`)).size;
    if (!window.confirm(`Передать в доставку ${supplyCount} поставк(у/и)? После закрытия в неё нельзя будет добавить заказы.`)) return;
    setOrderAction('deliver');
    setOrderActionMessage('');
    setOrderActionError('');
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
    const sourceSupplyId = orders[0]?.supplyId;
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
        `Перенесено заказов: ${result.moved}. Новая поставка: ${result.targetSupply.id}. ` +
        `Создана заявка №${String(result.targetRequest.number).padStart(6, '0')}. ` +
        (result.targetSupply.cargoPlaceCount > 0
          ? `Создано грузомест ПВЗ: ${result.targetSupply.cargoPlaceCount}.`
          : 'Направление и параметры исходной поставки сохранены.'),
      );
      void loadActiveClients();
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
      void loadActiveClients();
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
                <div className="fbs-tile__clients" aria-label="Клиенты с активными заказами FBS">
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
                    <span className="fbs-tile__clients-empty">Активных заказов нет</span>
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
            {activeView !== 'cost' && activeView !== 'pricing' && activeView !== 'passes' ? (
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
            {activeView !== 'pricing' && activeView !== 'passes' ? (
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
        ) : activeView === 'cargo' ? (
          <FbsCargoPackingView state={cargoState} search={search} />
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
            onDownloadStickers={downloadSelectedOrderStickers}
            onDownloadCargoStickers={downloadSelectedCargoPlaceStickers}
            onDownloadSupplyStickers={downloadSelectedSupplyStickers}
            onDownloadPickList={downloadFbsPickList}
            canDownloadPickList={canDownloadPickList}
            onCreateRequest={createRequestFromSelectedOrders}
          />
        ) : null}

        {data?.connected && activeView !== 'pricing' && activeView !== 'calculator' && activeView !== 'passes' ? (
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
    </section>
  );
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
              <small>WMS создаст {cargoPlaceCount} грузомест по 14 единиц и получит для них QR.</small>
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
}: {
  state: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: FbsCargoPackingsResponse | null;
    error: string;
  };
  search: string;
}) {
  if (state.status === 'loading' && !state.data) {
    return <FbsNotice icon={RefreshCw} title="Загружаю грузоместа" text="Проверяю упаковку поставок для ПВЗ." />;
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
        text={query ? 'Измените номер заказа, поставки, грузоместа или ШК.' : 'Здесь появятся поставки, созданные с направлением сдачи в ПВЗ.'}
      />
    );
  }

  return (
    <div className="fbs-cargo-supplies">
      {state.error ? <p className="fbs-order-actions__error">{state.error}</p> : null}
      {supplies.map((supply) => (
        <details className={`fbs-cargo-supply${supply.readyToDeliver ? ' is-ready' : ''}`} key={supply.id} open={!supply.readyToDeliver}>
          <summary>
            <span>
              <strong>Поставка {supply.supplyId}</strong>
              <small>{supply.client.code} · {supply.client.name}</small>
            </span>
            <span className="fbs-cargo-supply__progress">
              <strong>{supply.packedItems} / {supply.totalPlannedItems} ед.</strong>
              <small>{supply.closedCargoPlaces} / {supply.cargoPlaceCount} мест закрыто</small>
            </span>
            <span className={`fbs-status ${supply.readyToDeliver ? 'fbs-status--shipped' : 'fbs-status--active'}`}>
              {supply.readyToDeliver
                ? 'Готова к передаче WB'
                : supply.waitingAssembly > 0
                  ? `Ещё собирается: ${supply.waitingAssembly}`
                  : `Разложить: ${supply.remainingToPack}`}
            </span>
          </summary>
          <div className="fbs-cargo-places">
            {supply.cargoPlaces.map((place, index) => (
              <details className={`fbs-cargo-place fbs-cargo-place--${place.status.toLowerCase()}`} key={place.cargoPlaceId}>
                <summary>
                  <span className="fbs-cargo-place__number">{index + 1}</span>
                  <span>
                    <strong>{place.cargoPlaceId}</strong>
                    <small className="fbs-mono">{place.cargoPlaceBarcode || 'QR ещё не сканировался'}</small>
                  </span>
                  <span>
                    <strong>{place.packedItems} / {place.capacityItems} ед.</strong>
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
                  <p className="fbs-cargo-place__empty">На ТСД ещё не отсканирован ни один заказ.</p>
                )}
              </details>
            ))}
          </div>
        </details>
      ))}
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
  onDownloadStickers,
  onDownloadCargoStickers,
  onDownloadSupplyStickers,
  onDownloadPickList,
  canDownloadPickList,
  onCreateRequest,
}: {
  data: ClientFbsOrders | null;
  search: string;
  view: Exclude<FbsView, 'cargo' | 'cost' | 'calculator' | 'pricing' | 'passes'>;
  selectedOrderKeys: Set<string>;
  onSelectionChange: (keys: Set<string>) => void;
  orderAction: 'assemble' | 'reship' | 'move' | 'deliver' | 'change-destination' | 'cancel' | 'stickers' | 'cargo' | 'supply' | 'request' | 'pick-list' | null;
  rowActionKey: string | null;
  actionMessage: string;
  actionError: string;
  onAssemble: (orders: FbsOrderSummary[]) => Promise<void>;
  onReship: (orders: FbsOrderSummary[]) => Promise<void>;
  onDeliver: (orders: FbsOrderSummary[]) => Promise<void>;
  onChangeDestination: (orders: FbsOrderSummary[]) => Promise<void>;
  onMoveToNewSupply: (orders: FbsOrderSummary[]) => Promise<void>;
  onCancel: (orders: FbsOrderSummary[]) => Promise<void>;
  onDownloadStickers: (orders: FbsOrderSummary[]) => Promise<void>;
  onDownloadCargoStickers: (orders: FbsOrderSummary[]) => Promise<void>;
  onDownloadSupplyStickers: (orders: FbsOrderSummary[]) => Promise<void>;
  onDownloadPickList: (order: FbsOrderSummary) => Promise<void>;
  canDownloadPickList: boolean;
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
  const readOnlyView = view === 'archive' || view === 'cancelled';
  const orderGroups = groupFbsOrdersBySupply(visibleOrders);
  const tableColumnCount = 6 + (!readOnlyView ? 1 : 0) + (view === 'active' ? 1 : 0);
  const itemsCount = visibleOrders.reduce((sum, order) => sum + Math.max(1, order.itemCount), 0);
  const visibleKeys = visibleOrders.map(fbsOrderSelectionKey);
  const bulkSelectableOrders = visibleOrders;
  const bulkSelectableKeys = bulkSelectableOrders.map(fbsOrderSelectionKey);
  const selectedOrders = visibleOrders.filter((order) => selectedOrderKeys.has(fbsOrderSelectionKey(order)));
  const assemblyOrders = selectedOrders.filter(
    (order) => order.marketplace === 'WILDBERRIES' && order.supplierStatus === 'new',
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
  const moveOrders = selectedOrders.filter(
    (order) =>
      order.marketplace === 'WILDBERRIES' &&
      order.category === 'active' &&
      order.supplierStatus === 'confirm' &&
      Boolean(order.supplyId) &&
      Boolean(order.request) &&
      !['PACKED', 'DONE', 'CANCELLED', 'REJECTED'].includes(order.request?.status ?? ''),
  );
  const moveSourceCount = new Set(
    moveOrders.map(
      (order) => `${order.connectionId}:${order.supplyId}:${order.request?.id}`,
    ),
  ).size;
  const canMoveSelectedOrders =
    selectedOrders.length > 0 &&
    moveOrders.length === selectedOrders.length &&
    moveSourceCount === 1;
  const stickerOrders = selectedOrders.filter(
    (order) => order.marketplace === 'WILDBERRIES' && ['confirm', 'complete'].includes(order.supplierStatus),
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
          </div>
          <div className="fbs-order-actions__buttons">
            {view === 'active' ? (
              <>
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
                  className="button button-secondary"
                  disabled={!canMoveSelectedOrders || orderAction !== null}
                  onClick={() => void onMoveToNewSupply(moveOrders)}
                  title="Перенести выбранные несобранные заказы одной поставки в новую поставку WB и отдельную заявку WMS"
                >
                  <ArrowRightLeft size={16} aria-hidden="true" />
                  {orderAction === 'move'
                    ? 'Переношу…'
                    : `В новую поставку (${moveOrders.length})`}
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
          </div>
          <p className="fbs-order-actions__hint">
            {data?.deliveryPlan.requiresCargoPlaces
              ? `ПВЗ: печатаются QR грузомест — одно на каждые ${data.deliveryPlan.itemsPerCargoPlace} единиц товара.`
              : 'СЦ: печатается QR поставки после её передачи в доставку. Грузоместа WB не создаются.'}
          </p>
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
              <th>{view === 'active' ? 'Создан' : 'Отгрузка'}</th>
            </tr>
          </thead>
          {orderGroups.map((group) => {
            const groupStickerOrders = group.orders.filter(
              (order) => order.marketplace === 'WILDBERRIES' && ['confirm', 'complete'].includes(order.supplierStatus),
            );
            const groupDeliverOrders = group.orders.filter(
              (order) => order.marketplace === 'WILDBERRIES' && order.supplierStatus === 'confirm' && Boolean(order.supplyId),
            );
            const groupCargoOrders = group.orders.filter(
              (order) => fbsOrderRequiresCargoPlaces(order, data?.deliveryPlan.requiresCargoPlaces === true),
            );
            const groupChangeDestinationOrders = group.orders.filter(
              (order) =>
                order.marketplace === 'WILDBERRIES' &&
                order.supplierStatus === 'confirm' &&
                Boolean(order.supplyId) &&
                fbsOrderRequiresCargoPlaces(order, data?.deliveryPlan.requiresCargoPlaces === true),
            );
            return (
            <tbody
              key={group.key}
              className={group.isJointShipment ? 'fbs-table__shipment-group' : undefined}
            >
              {group.isJointShipment ? (
                <tr className="fbs-table__shipment-heading">
                  <td colSpan={tableColumnCount}>
                    <div className="fbs-table__shipment-heading-content">
                      <div>
                        <PackageCheck size={15} aria-hidden="true" />
                        <strong>Отгружены вместе</strong>
                        <span>
                          Поставка {group.supplyId} · {group.orders.length} заказов ·{' '}
                          {fbsShipmentDestinationLabel(group.orders[0], data?.deliveryPlan.requiresCargoPlaces === true)}
                        </span>
                      </div>
                      <div className="fbs-table__shipment-actions">
                        <button type="button" onClick={() => {
                          const next = new Set(selectedOrderKeys);
                          group.orders.forEach((order) => {
                            const key = fbsOrderSelectionKey(order);
                            next.add(key);
                          });
                          onSelectionChange(next);
                        }}>
                          Выбрать поставку
                        </button>
                        <button type="button" disabled={groupStickerOrders.length === 0 || orderAction !== null} onClick={() => void onDownloadStickers(groupStickerOrders)}>
                          <Download size={13} aria-hidden="true" /> ШК заказов
                        </button>
                        {groupCargoOrders.length > 0 ? (
                          <button type="button" disabled={orderAction !== null} onClick={() => void onDownloadCargoStickers(groupCargoOrders)}>
                            <QrCode size={13} aria-hidden="true" /> QR грузомест
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
                      </div>
                    </div>
                  </td>
                </tr>
              ) : null}
              {group.orders.map((order) => (
                <FbsOrderRow
                  key={`${order.marketplace}:${order.connectionId}:${order.id}`}
                  order={order}
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
                  onDownloadSticker={() => void onDownloadStickers([order])}
                  onDownloadCargoStickers={() => void onDownloadCargoStickers([order])}
                  onDownloadSupplyStickers={() => void onDownloadSupplyStickers([order])}
                  onDownloadPickList={() => void onDownloadPickList(order)}
                />
              ))}
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
  onDownloadSticker,
  onDownloadCargoStickers,
  onDownloadSupplyStickers,
  onDownloadPickList,
}: {
  order: FbsOrderSummary;
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
  onDownloadSticker: () => void;
  onDownloadCargoStickers: () => void;
  onDownloadSupplyStickers: () => void;
  onDownloadPickList: () => void;
}) {
  const canDownloadSticker =
    order.marketplace === 'WILDBERRIES' && ['confirm', 'complete'].includes(order.supplierStatus);
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
  const hasActiveRequest = Boolean(order.request && order.request.status !== 'CANCELLED');

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
        {order.supplyId ? (
          <small>
            Поставка {order.supplyId} · {requiresCargoPlaces
              ? `ПВЗ${order.shipmentPlan?.cargoPlaceCount ? ` · ${order.shipmentPlan.cargoPlaceCount} мест` : ''}`
              : 'Сортировочный центр WB'}
          </small>
        ) : null}
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
                : order.marketplace === 'WILDBERRIES'
                  ? 'ШК появится после перевода заказа в сборку'
                  : 'Скачивание ШК в этом модуле пока доступно для Wildberries'
            }
          >
            <Download size={14} aria-hidden="true" />
            {stickerBusy ? 'Формирую…' : 'Скачать ШК'}
          </button>
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
          {canDownloadPickList && hasActiveRequest ? (
            <button
              type="button"
              className="fbs-order-document-button"
              disabled={actionsDisabled}
              onClick={onDownloadPickList}
              title={`Скачать лист подбора заявки №${String(order.request!.number).padStart(6, '0')} с QR/ШК WB`}
            >
              <ClipboardList size={14} aria-hidden="true" />
              {pickListBusy ? 'Формирую…' : 'Лист подбора'}
            </button>
          ) : null}
        </div>
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

function groupFbsOrdersBySupply(orders: FbsOrderSummary[]) {
  const groups = new Map<string, { key: string; supplyId: string; orders: FbsOrderSummary[] }>();
  for (const order of orders) {
    const supplyId = order.supplyId?.trim() ?? '';
    const key = supplyId
      ? `supply:${order.connectionId}:${supplyId}`
      : `order:${fbsOrderSelectionKey(order)}`;
    const group = groups.get(key) ?? { key, supplyId, orders: [] };
    group.orders.push(order);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    isJointShipment: Boolean(group.supplyId) && group.orders.length > 1,
  }));
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
  return Array.from(groups.values()).reduce((sum, quantity) => sum + Math.ceil(quantity / 14), 0);
}

function fbsOrderRequiresCargoPlaces(order: FbsOrderSummary, fallback: boolean) {
  return order.shipmentPlan?.requiresCargoPlaces ?? fallback;
}

function fbsShipmentDestinationLabel(order: FbsOrderSummary, fallbackRequiresCargoPlaces: boolean) {
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
