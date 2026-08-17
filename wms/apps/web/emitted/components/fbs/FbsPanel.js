import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AlertTriangle, ArrowLeft, ArrowRightLeft, Archive, BarChart3, BadgeRussianRuble, Boxes, Calculator, CarFront, CalendarDays, ChevronDown, ChevronRight, CircleCheckBig, ClipboardList, Clock3, Download, FilePlus2, Link2, ListChecks, MapPin, MoreVertical, PackageCheck, PlugZap, Power, PowerOff, QrCode, RefreshCw, RotateCcw, Save, Search, Send, Settings2, ShoppingBasket, Truck, Warehouse, XCircle, } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assembleFbsOrders, cancelFbsOrders, changeFbsSuppliesDestination, connectFbsStockWarehouse, createFbsPass, createFbsMarketplaceConnection, createFbsRequest, deleteFbsPass, deliverFbsSupplies, downloadFbsCargoPlaceStickersPdf, downloadFbsProductShipmentReport, downloadFbsOrderStickersPdf, downloadFbsRequestPickListPdf, downloadFbsSupplyStickersPdf, enableFbsEmergencyAssembly, fetchClients, fetchFbsBillingSettings, fetchFbsActiveClients, fetchFbsCargoPackings, fetchFbsOrders, fetchFbsProductShipmentReport, fetchFbsPasses, fetchFbsStocks, fetchFbsWarehouseRoutes, moveFbsOrdersToNewSupply, removeCancelledFbsOrder, reconcileFbsStockItem, reshipFbsOrders, syncFbsStocks, updateFbsPass, updateFbsBillingSettings, updateFbsCargoPackingIgnore, updateFbsStockPublication, updateFbsStockPublicationBulk, updateFbsWarehouseRoutes, updateMarketplaceConnection, } from '../../lib/api';
import { FbsCostCalculator } from './FbsCostCalculator';
import './fbs.css';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
const FBS_MARKETPLACES = ['WILDBERRIES', 'OZON', 'YANDEX_MARKET'];
const INITIAL_FBS_MARKETPLACE_COUNTS = {
    WILDBERRIES: { status: 'loading', count: 0 },
    OZON: { status: 'loading', count: 0 },
    YANDEX_MARKET: { status: 'loading', count: 0 },
};
function activeOrdersWord(count) {
    const remainder100 = count % 100;
    const remainder10 = count % 10;
    if (remainder100 >= 11 && remainder100 <= 14)
        return 'заказов';
    if (remainder10 === 1)
        return 'заказ';
    if (remainder10 >= 2 && remainder10 <= 4)
        return 'заказа';
    return 'заказов';
}
function formatMarketplaceActiveOrders(state) {
    if (state.status === 'loading' && state.count === 0)
        return 'Считаем заказы…';
    if (state.status === 'error')
        return 'Не удалось посчитать';
    return `${state.count.toLocaleString('ru-RU')} ${activeOrdersWord(state.count)}`;
}
const FBS_HISTORY_STATE_KEY = '__wmsFbsMarketplace';
const fbsViews = [
    {
        id: 'active',
        title: 'Активные заказы по FBS',
        description: 'Новые заказы, сборка, упаковка и готовность к передаче.',
        icon: ShoppingBasket,
        accent: 'red',
    },
    {
        id: 'stocks',
        title: 'Товары FBS',
        description: 'Отдельное управление публикацией товаров: «Продавать» или «Не продавать» в Wildberries.',
        icon: PackageCheck,
        accent: 'green',
    },
    {
        id: 'cargo',
        title: 'Короба WMS',
        description: 'Физические короба WMS и грузоместа WB: состав, упаковка и готовность поставки.',
        icon: Boxes,
        accent: 'blue',
    },
    {
        id: 'shipped',
        title: 'Отгруженные',
        description: 'Переданные заказы со статусами, автоматически получаемыми из API.',
        icon: Truck,
        accent: 'green',
    },
    {
        id: 'report',
        title: 'Отчёт по товарам FBS',
        description: 'Отгруженные товары за период, поиск по ключевому слову и Excel.',
        icon: BarChart3,
        accent: 'violet',
    },
    {
        id: 'cancelled',
        title: 'Отменённые заказы',
        description: 'Заказы, отменённые продавцом, покупателем или перевозчиком.',
        icon: XCircle,
        accent: 'red',
    },
    {
        id: 'cost',
        title: 'Стоимость обработки FBS',
        description: 'Отгруженные заказы, тарифы, начисления и выставленные счета.',
        icon: BadgeRussianRuble,
        accent: 'amber',
    },
    {
        id: 'calculator',
        title: 'Калькулятор стоимости',
        description: 'Предварительный расчёт обработки и доставки партии FBS.',
        icon: Calculator,
        accent: 'blue',
    },
    {
        id: 'archive',
        title: 'Архив',
        description: 'Завершённые заказы, полученные покупателями.',
        icon: Archive,
        accent: 'slate',
    },
    {
        id: 'passes',
        title: 'Пропуска WB',
        description: 'Пропуска водителей и автомобилей на склады Wildberries.',
        icon: CarFront,
        accent: 'blue',
    },
    {
        id: 'pricing',
        title: 'Назначение стоимости обработки',
        description: 'Услуги клиента, доставка, шаг доплаты и комплектация коробов.',
        icon: Settings2,
        accent: 'violet',
    },
];
const ozonHiddenViews = new Set(['stocks', 'cargo', 'report', 'passes']);
export function FbsPanel({ session, navigationTarget, onNavigationTargetConsumed }) {
    const [marketplace, setMarketplace] = useState(navigationTarget ? 'WILDBERRIES' : null);
    const [activeView, setActiveView] = useState('active');
    const [clients, setClients] = useState([]);
    const [activeClients, setActiveClients] = useState([]);
    const [activeClientsLoading, setActiveClientsLoading] = useState(false);
    const [marketplaceOrderCounts, setMarketplaceOrderCounts] = useState(() => ({ ...INITIAL_FBS_MARKETPLACE_COUNTS }));
    const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id, {
        initialClientId: navigationTarget?.clientId ?? (session.user.clientIds.length === 1 ? session.user.clientIds[0] : ''),
    });
    const [search, setSearch] = useState(navigationTarget ? formatFbsRequestSearch(navigationTarget.requestNumber) : '');
    const [orderSearchFeedback, setOrderSearchFeedback] = useState(null);
    const [ordersState, setOrdersState] = useState({ status: 'idle', data: null, error: '' });
    const [syncAudit, setSyncAudit] = useState(null);
    const [syncAuditBusy, setSyncAuditBusy] = useState(false);
    const [cargoState, setCargoState] = useState({ status: 'idle', data: null, error: '' });
    const [cargoActionId, setCargoActionId] = useState(null);
    const [selectedOrderKeys, setSelectedOrderKeys] = useState(() => new Set());
    const [orderAction, setOrderAction] = useState(null);
    const [rowActionKey, setRowActionKey] = useState(null);
    const [orderActionMessage, setOrderActionMessage] = useState('');
    const [orderActionError, setOrderActionError] = useState('');
    const [deliveryRecovery, setDeliveryRecovery] = useState(null);
    const [assemblyDialog, setAssemblyDialog] = useState(null);
    const [connectionOpen, setConnectionOpen] = useState(false);
    const [connectionMarketplace, setConnectionMarketplace] = useState('WILDBERRIES');
    const [connectionName, setConnectionName] = useState('');
    const [sellerId, setSellerId] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [connectionError, setConnectionError] = useState('');
    const [isConnecting, setConnecting] = useState(false);
    const loadSequence = useRef(0);
    const marketplaceCountsLoadSequence = useRef(0);
    const canManagePricing = session.user.permissionCodes.includes('system:admin') ||
        session.user.permissionCodes.includes('billing:write') ||
        session.user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER');
    const canEnableEmergencyAssembly = session.user.permissionCodes.includes('system:admin') ||
        session.user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER');
    const canDownloadPickList = true;
    useEffect(() => {
        if (!navigationTarget)
            return;
        setMarketplace('WILDBERRIES');
        setConnectionMarketplace('WILDBERRIES');
        setActiveView('active');
        setSelectedClientId(navigationTarget.clientId);
        setSearch(formatFbsRequestSearch(navigationTarget.requestNumber));
        setOrderSearchFeedback({
            tone: 'success',
            text: `Показаны заказы заявки №${String(navigationTarget.requestNumber).padStart(6, '0')}.`,
        });
        onNavigationTargetConsumed?.();
    }, [navigationTarget?.key]);
    async function toggleCargoPackingIgnored(planId, ignored) {
        if (!canManagePricing || cargoActionId)
            return;
        const action = ignored ? 'игнорировать' : 'вернуть в работу';
        if (!window.confirm(`Точно ${action} эту поставку в «Коробах WMS»? Изменение сохранится в журнале администратора.`)) {
            return;
        }
        setCargoActionId(planId);
        try {
            await updateFbsCargoPackingIgnore(session.accessToken, planId, ignored);
            await loadCargoPackings();
        }
        catch (caught) {
            setCargoState((current) => ({
                status: 'error',
                data: current.data,
                error: caught instanceof Error ? caught.message : 'Не удалось изменить статус поставки.',
            }));
        }
        finally {
            setCargoActionId(null);
        }
    }
    useEffect(() => {
        let active = true;
        void fetchClients(session.accessToken)
            .then((rows) => {
            if (!active)
                return;
            setClients(rows);
            setSelectedClientId((current) => validRememberedClientId(current, rows, rows.length === 1 ? rows[0].id : ''));
        })
            .catch(() => {
            if (!active)
                return;
            setClients([]);
        });
        return () => {
            active = false;
        };
    }, [session.accessToken]);
    const loadOrders = useCallback(async (refresh = false) => {
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
        }
        catch (caught) {
            if (loadSequence.current === sequence) {
                setOrdersState({
                    status: 'error',
                    data: null,
                    error: caught instanceof Error ? caught.message : 'Не удалось загрузить заказы FBS.',
                });
            }
        }
    }, [marketplace, selectedClientId, session.accessToken]);
    async function runFbsSynchronizationAudit() {
        if (!selectedClientId || !marketplace || syncAuditBusy)
            return;
        setSyncAuditBusy(true);
        setOrderActionError('');
        try {
            // The audit intentionally requests a fresh marketplace snapshot first.
            // It only reports inconsistencies; it never changes request statuses itself.
            const fresh = await fetchFbsOrders(session.accessToken, selectedClientId, true);
            setOrdersState({ status: 'ready', data: fresh, error: '' });
            setSyncAudit(buildFbsSynchronizationAudit(fresh, marketplace));
        }
        catch (caught) {
            setOrderActionError(caught instanceof Error
                ? caught.message
                : 'Не удалось проверить соответствие заявок WMS и статусов маркетплейса.');
        }
        finally {
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
                if (rows.some((item) => item.client.id === current))
                    return current;
                return rows[0]?.client.id ?? current;
            });
        }
        catch {
            setActiveClients([]);
        }
        finally {
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
        const results = [];
        // Первый запрос наполняет серверный кэш, следующие считают свои маркетплейсы
        // без трёх одновременных обращений к API продавца.
        for (const targetMarketplace of FBS_MARKETPLACES) {
            try {
                const rows = await fetchFbsActiveClients(session.accessToken, targetMarketplace);
                const selectedClientRow = selectedClientId
                    ? rows.find((item) => item.client.id === selectedClientId)
                    : null;
                results.push([
                    targetMarketplace,
                    {
                        status: 'ready',
                        count: selectedClientId
                            ? selectedClientRow?.activeOrders ?? 0
                            : rows.reduce((sum, item) => sum + item.activeOrders, 0),
                    },
                ]);
            }
            catch {
                results.push([targetMarketplace, { status: 'error', count: 0 }]);
            }
        }
        if (marketplaceCountsLoadSequence.current !== sequence)
            return;
        setMarketplaceOrderCounts(Object.fromEntries(results));
    }, [selectedClientId, session.accessToken]);
    const loadCargoPackings = useCallback(async () => {
        if (!selectedClientId) {
            setCargoState({ status: 'idle', data: null, error: '' });
            return;
        }
        setCargoState((current) => ({ status: 'loading', data: current.data, error: '' }));
        try {
            const cargo = await fetchFbsCargoPackings(session.accessToken, selectedClientId);
            setCargoState({ status: 'ready', data: cargo, error: '' });
        }
        catch (caught) {
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
        if (!marketplace)
            return;
        void loadActiveClients();
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                void loadActiveClients();
            }
        }, 60_000);
        return () => window.clearInterval(timer);
    }, [loadActiveClients, marketplace]);
    useEffect(() => {
        if (marketplace)
            return;
        void loadMarketplaceOrderCounts();
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                void loadMarketplaceOrderCounts();
            }
        }, 60_000);
        return () => window.clearInterval(timer);
    }, [loadMarketplaceOrderCounts, marketplace]);
    useEffect(() => {
        if (marketplace !== 'WILDBERRIES' || activeView !== 'cargo' || !selectedClientId)
            return;
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
    const selectedClient = useMemo(() => clients.find((client) => client.id === selectedClientId) ?? null, [clients, selectedClientId]);
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
    const data = useMemo(() => filterFbsOrdersByMarketplace(ordersState.data, marketplace), [marketplace, ordersState.data]);
    useEffect(() => {
        const requestNumber = parseFbsRequestSearch(search);
        if (requestNumber === null || !data?.orders.length)
            return;
        const requestOrders = data.orders.filter((order) => order.request?.number === requestNumber);
        if (!requestOrders.length)
            return;
        const targetOrder = requestOrders.find((order) => order.category === 'active') ?? requestOrders[0];
        if (targetOrder.category !== activeView) {
            setActiveView(targetOrder.category);
        }
    }, [activeView, data, search]);
    const orderSearchEnabled = activeView === 'active' ||
        activeView === 'shipped' ||
        activeView === 'cancelled' ||
        activeView === 'archive';
    function submitOrderQuickSearch(event) {
        event.preventDefault();
        const requestNumber = parseFbsRequestSearch(search);
        if (requestNumber !== null) {
            const requestMatch = (data?.orders ?? []).find((order) => order.request?.number === requestNumber);
            if (!requestMatch) {
                setOrderSearchFeedback({
                    tone: 'error',
                    text: `Заявка №${String(requestNumber).padStart(6, '0')} не найдена у выбранного клиента.`,
                });
                return;
            }
            setActiveView(requestMatch.category);
            setSearch(formatFbsRequestSearch(requestNumber));
            setSelectedOrderKeys(new Set());
            setOrderSearchFeedback({
                tone: 'success',
                text: `Показаны заказы заявки №${String(requestNumber).padStart(6, '0')}.`,
            });
            return;
        }
        const query = normalizeFbsOrderNumber(search);
        if (!query) {
            setOrderSearchFeedback(null);
            return;
        }
        const orders = data?.orders ?? [];
        const exactMatch = orders.find((order) => [order.id, order.orderUid]
            .filter(Boolean)
            .some((value) => normalizeFbsOrderNumber(String(value)) === query));
        const match = exactMatch ?? orders.find((order) => [order.id, order.orderUid]
            .filter(Boolean)
            .some((value) => normalizeFbsOrderNumber(String(value)).includes(query)));
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
    const activeOrdersTotal = selectedClientId
        ? activeClients.find((item) => item.client.id === selectedClientId)?.activeOrders ?? 0
        : activeClients.reduce((sum, item) => sum + item.activeOrders, 0);
    const tileCounts = {
        active: activeOrdersTotal,
        stocks: 'WMS → WB',
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
    async function assembleSelectedOrders(orders) {
        if (!selectedClientId || orders.length === 0)
            return;
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
            }
            catch (caught) {
                setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось передать заказы в Ozon.');
            }
            finally {
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
    async function reshipSelectedOrders(orders) {
        if (!selectedClientId || orders.length === 0)
            return;
        setAssemblyDialog({
            orders,
            destination: data?.deliveryPlan.destination ?? 'PICKUP_POINT',
            mode: 'reship',
        });
    }
    async function submitAssemblyDirection() {
        if (!selectedClientId || !assemblyDialog || assemblyDialog.orders.length === 0)
            return;
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
            setOrderActionMessage(result.deliveryPlan.requiresCargoPlaces
                ? `${result.assembled} заказ(а/ов) ${mode === 'reship' ? 'переведено в повторную отгрузку' : 'переведено в сборку'}. Создано грузомест: ${cargoPlaceCount}, количество товаров в одном месте не ограничено. Теперь скачайте ШК заказов и QR грузомест.`
                : `${result.assembled} заказ(а/ов) ${mode === 'reship' ? 'переведено в повторную отгрузку' : 'переведено в сборку'}. Поставка идёт в сортировочный центр, поэтому грузоместа WB не создавались. Теперь можно скачать ШК заказов.`);
        }
        catch (caught) {
            setOrderActionError(caught instanceof Error ? caught.message : mode === 'reship' ? 'Не удалось создать повторную отгрузку.' : 'Не удалось перевести заказы в сборку.');
        }
        finally {
            setOrderAction(null);
        }
    }
    async function cancelSelectedOrders(orders) {
        if (!selectedClientId || orders.length === 0)
            return;
        if (!window.confirm(`Отменить ${orders.length} FBS-заказ(а/ов) у продавца? Действие изменит статус в Wildberries.`))
            return;
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
            if (result.failed.length)
                setOrderActionError(result.failed.map((item) => `${item.id}: ${item.message}`).join(' '));
        }
        catch (caught) {
            setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось отменить заказы.');
        }
        finally {
            setOrderAction(null);
        }
    }
    async function removeCancelledOrderFromWms(order) {
        if (!selectedClientId)
            return;
        if (!window.confirm(`Удалить отменённый заказ ${order.id} из заявки WMS? Резерв товара будет снят. На Wildberries ничего не изменится.`))
            return;
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
        }
        catch (caught) {
            setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось удалить отменённый заказ из WMS.');
        }
        finally {
            setOrderAction(null);
            setRowActionKey(null);
        }
    }
    async function deliverSelectedSupplies(orders) {
        if (!selectedClientId || orders.length === 0)
            return;
        const supplyCount = new Set(orders.map((order) => `${order.connectionId}:${order.supplyId}`)).size;
        if (!window.confirm(`Передать в доставку ${supplyCount} поставк(у/и)? Перед отправкой WMS обновит данные WB и проверит, что все заказы заявки собраны, КИЗ приняты, а отменённых или потерянных заказов нет. После закрытия в поставку нельзя будет добавить заказы.`))
            return;
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
            if (result.failed.length)
                setOrderActionError(result.failed.map((item) => `${item.supplyId}: ${item.message}`).join(' '));
            if (result.recovery && (result.recovery.rescanOrders.length > 0 || result.recovery.cancelledOrders.length > 0)) {
                setDeliveryRecovery(result.recovery);
            }
        }
        catch (caught) {
            setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось передать поставки в доставку.');
        }
        finally {
            setOrderAction(null);
        }
    }
    async function changeSelectedSuppliesToSortingCenter(orders) {
        if (!selectedClientId || orders.length === 0)
            return;
        const supplyCount = new Set(orders.map((order) => `${order.connectionId}:${order.supplyId}`)).size;
        const cargoPlaceCount = new Map(orders.map((order) => [
            `${order.connectionId}:${order.supplyId}`,
            order.shipmentPlan?.cargoPlaceCount ?? 0,
        ]));
        const totalCargoPlaces = [...cargoPlaceCount.values()].reduce((sum, count) => sum + count, 0);
        if (!window.confirm(`Сменить направление ${supplyCount} поставк(и) с ПВЗ на сортировочный центр?\n\n` +
            `Будут удалены грузоместа WB: ${totalCargoPlaces}. Упаковка грузомест будет расформирована. ` +
            'Заказы, собранные товары, КИЗ и наклейки заказов останутся без изменений.'))
            return;
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
            setOrderActionMessage(`Направление изменено у ${result.changed} поставк(и). Удалено грузомест WB: ${result.removedCargoPlaces}. ` +
                `Заказы и сборка сохранены, дальнейшая логистика будет рассчитана по тарифу СЦ. ` +
                `После завершения передайте поставку WB и скачайте ШК для СЦ.`);
            if (result.failed.length > 0) {
                setOrderActionError(result.failed.map((item) => `${item.supplyId}: ${item.message}`).join(' '));
            }
            void loadCargoPackings();
        }
        catch (caught) {
            setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось сменить направление поставки.');
        }
        finally {
            setOrderAction(null);
        }
    }
    async function moveSelectedOrdersToNewSupply(orders) {
        if (!selectedClientId || orders.length === 0)
            return;
        const sourceRequestNumbers = [...new Set(orders
                .map((order) => order.request?.number)
                .filter((number) => typeof number === 'number'))];
        const isMerge = sourceRequestNumbers.length > 1;
        const sourceSupplyIds = [...new Set(orders.map((order) => order.supplyId).filter(Boolean))];
        const sourceSupplyId = sourceSupplyIds.length > 1
            ? sourceSupplyIds.join(', ')
            : orders[0]?.supplyId;
        const sourceRequestNumber = orders[0]?.request?.number;
        if (!window.confirm(`Перенести ${orders.length} заказ(а/ов) из поставки ${sourceSupplyId} в новую поставку WB?\n\n` +
            `Для них будет создана отдельная заявка WMS. Заявка №${String(sourceRequestNumber ?? '').padStart(6, '0')} ` +
            'автоматически пересчитается. Статус заказов в WB останется «На сборке».'))
            return;
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
            setOrderActionMessage(`${isMerge ? 'Объединены заказы из нескольких заявок. ' : ''}` +
                `Перенесено заказов: ${result.moved}. Новая поставка: ${result.targetSupply.id}. ` +
                `Создана заявка №${String(result.targetRequest.number).padStart(6, '0')}. ` +
                (result.skipped > 0
                    ? `Не перенесено уже начатых на ТСД заказов: ${result.skipped} (${result.skippedOrders.map((order) => `№${order.id}`).join(', ')}). `
                    : '') +
                (result.targetSupply.cargoPlaceCount > 0
                    ? `Создано грузомест ПВЗ: ${result.targetSupply.cargoPlaceCount}.`
                    : 'Направление и параметры исходной поставки сохранены.'));
            void loadCargoPackings();
        }
        catch (caught) {
            setOrderActionError(caught instanceof Error
                ? caught.message
                : 'Не удалось перенести заказы в новую поставку.');
        }
        finally {
            setOrderAction(null);
        }
    }
    async function downloadSelectedCargoPlaceStickers(orders) {
        if (!selectedClientId || orders.length === 0)
            return;
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
        }
        catch (caught) {
            setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось скачать QR грузомест.');
        }
        finally {
            setOrderAction(null);
            setRowActionKey(null);
        }
    }
    async function downloadSelectedOrderStickers(orders) {
        if (!selectedClientId || orders.length === 0)
            return;
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
        }
        catch (caught) {
            setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось скачать ШК заказов.');
        }
        finally {
            setOrderAction(null);
            setRowActionKey(null);
        }
    }
    async function downloadSelectedSupplyStickers(orders) {
        if (!selectedClientId || orders.length === 0)
            return;
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
        }
        catch (caught) {
            setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось скачать ШК поставки для СЦ.');
        }
        finally {
            setOrderAction(null);
            setRowActionKey(null);
        }
    }
    async function downloadFbsPickList(order) {
        if (!order.request || order.request.status === 'CANCELLED')
            return;
        setOrderAction('pick-list');
        setRowActionKey(fbsOrderSelectionKey(order));
        setOrderActionMessage('');
        setOrderActionError('');
        try {
            const blob = await downloadFbsRequestPickListPdf(session.accessToken, order.request.id);
            downloadFbsBlob(blob, `Лист_подбора_FBS_${String(order.request.number).padStart(6, '0')}_${fileDateTime(new Date())}.pdf`);
            setOrderActionMessage(`Скачан лист подбора по заявке №${String(order.request.number).padStart(6, '0')}.`);
        }
        catch (caught) {
            setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось скачать лист подбора.');
        }
        finally {
            setOrderAction(null);
            setRowActionKey(null);
        }
    }
    async function enableEmergencyAssemblyForRequest(request) {
        if (!canEnableEmergencyAssembly || orderAction !== null)
            return;
        if (!window.confirm(`Экстренно вернуть заявку WMS №${String(request.number).padStart(6, '0')} в локальную сборку?\n\n` +
            'Заказы снова появятся у сборщиков на ТСД. Статус поставки и заказы в Wildberries НЕ изменятся. ' +
            'Используйте действие только если поставку ошибочно передали WB до физической сборки.'))
            return;
        setOrderAction('emergency-assembly');
        setRowActionKey(request.id);
        setOrderActionMessage('');
        setOrderActionError('');
        try {
            const result = await enableFbsEmergencyAssembly(session.accessToken, request.id);
            setOrderActionMessage(result.status === 'ALREADY_APPLIED'
                ? `Аварийная сборка заявки №${String(result.request.number).padStart(6, '0')} уже включена.`
                : `Заявка №${String(result.request.number).padStart(6, '0')} возвращена в локальную очередь ТСД: ${result.shippedOrders} заказ(а/ов). Wildberries не изменялся.`);
            await loadOrders(true);
        }
        catch (caught) {
            setOrderActionError(caught instanceof Error
                ? caught.message
                : 'Не удалось включить аварийную сборку заявки.');
        }
        finally {
            setOrderAction(null);
            setRowActionKey(null);
        }
    }
    async function createRequestFromSelectedOrders(orders) {
        if (!selectedClientId || orders.length === 0)
            return;
        const wbWarehouseKeys = Array.from(new Set(orders
            .filter((order) => order.marketplace === 'WILDBERRIES')
            .map((order) => `${order.connectionId}:${order.marketplace}:${order.warehouseId || order.officeId || 'unknown'}`)));
        if (wbWarehouseKeys.length > 1) {
            setOrderActionError('Выбраны заказы разных складов WB. Отфильтруйте один склад и создайте отдельную заявку.');
            return;
        }
        const wbWarehouseOrder = orders.find((order) => order.marketplace === 'WILDBERRIES');
        const wbWarehouseLabel = wbWarehouseOrder ? fbsOrderWarehouseLabel(wbWarehouseOrder) : '';
        if (!window.confirm(`Создать одну заявку на отгрузку из ${orders.length} выбранных FBS-заказов?`))
            return;
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
            setOrderActionMessage(`Создана заявка №${String(result.request.number).padStart(6, '0')}: ${result.linkedOrders} FBS-заказ(а/ов)${wbWarehouseLabel ? ` · ${wbWarehouseLabel}` : ''}.`);
        }
        catch (caught) {
            setOrderActionError(caught instanceof Error ? caught.message : 'Не удалось создать заявку из FBS-заказов.');
        }
        finally {
            setOrderAction(null);
        }
    }
    async function connectMarketplace(event) {
        event.preventDefault();
        if (!selectedClientId)
            return;
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
        }
        catch (caught) {
            setConnectionError(caught instanceof Error ? caught.message : 'Не удалось подключить API маркетплейса.');
        }
        finally {
            setConnecting(false);
        }
    }
    function openMarketplace(nextMarketplace) {
        window.history.pushState({ ...(window.history.state ?? {}), [FBS_HISTORY_STATE_KEY]: nextMarketplace }, '');
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
    function renderMarketplaceActiveCount(targetMarketplace) {
        const state = marketplaceOrderCounts[targetMarketplace];
        return (_jsxs("span", { className: "fbs-marketplace-card__active-count", "data-state": state.status, "data-has-orders": state.status === 'ready' && state.count > 0 ? 'true' : 'false', "aria-live": "polite", children: [_jsx("span", { className: "fbs-marketplace-card__active-dot", "aria-hidden": "true" }), formatMarketplaceActiveOrders(state)] }));
    }
    useEffect(() => {
        function handleBrowserBack(event) {
            const nextMarketplace = event.state?.[FBS_HISTORY_STATE_KEY];
            if (nextMarketplace === 'WILDBERRIES' ||
                nextMarketplace === 'OZON' ||
                nextMarketplace === 'YANDEX_MARKET') {
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
        return (_jsxs("section", { className: "fbs-panel fbs-marketplace-entry", "aria-label": "\u0412\u044B\u0431\u043E\u0440 FBS-\u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0430", children: [_jsxs("header", { className: "fbs-panel__hero fbs-marketplace-entry__hero", children: [_jsx("div", { className: "fbs-panel__hero-icon", children: _jsx(ShoppingBasket, { size: 24, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "FBS" }), _jsx("h2", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441" }), _jsx("p", { children: "\u0417\u0430\u043A\u0430\u0437\u044B \u0438 \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u044B Wildberries, Ozon \u0438 \u042F\u043D\u0434\u0435\u043A\u0441 \u041C\u0430\u0440\u043A\u0435\u0442\u0430 \u0440\u0430\u0431\u043E\u0442\u0430\u044E\u0442 \u0440\u0430\u0437\u0434\u0435\u043B\u044C\u043D\u043E \u0438 \u043D\u0435 \u0441\u043C\u0435\u0448\u0438\u0432\u0430\u044E\u0442\u0441\u044F \u0432 \u043E\u0434\u043D\u043E\u0439 \u043E\u0447\u0435\u0440\u0435\u0434\u0438." })] }), _jsx("span", { className: "fbs-panel__scope", children: "3 \u0440\u0430\u0431\u043E\u0447\u0438\u0445 \u043A\u043E\u043D\u0442\u0443\u0440\u0430" })] }), _jsxs("div", { className: "fbs-marketplace-picker", children: [_jsxs("button", { type: "button", className: "fbs-marketplace-card fbs-marketplace-card--wb", onClick: () => openMarketplace('WILDBERRIES'), children: [_jsx("span", { className: "fbs-marketplace-card__index", children: "1" }), _jsx("span", { className: "fbs-marketplace-card__brand", children: "WB" }), _jsxs("span", { className: "fbs-marketplace-card__content", children: [_jsx("small", { children: "Wildberries" }), _jsxs("span", { className: "fbs-marketplace-card__heading", children: [_jsx("strong", { children: "FBS WB" }), renderMarketplaceActiveCount('WILDBERRIES')] }), _jsx("p", { children: "\u0417\u0430\u043A\u0430\u0437\u044B, \u0441\u0431\u043E\u0440\u043A\u0430, \u043E\u0441\u0442\u0430\u0442\u043A\u0438 WB, \u043A\u043E\u0440\u043E\u0431\u0430, \u0433\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442\u0430, \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u0438 \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430." })] }), _jsx(ChevronRight, { size: 26, "aria-hidden": "true" })] }), _jsxs("button", { type: "button", className: "fbs-marketplace-card fbs-marketplace-card--ozon", onClick: () => openMarketplace('OZON'), children: [_jsx("span", { className: "fbs-marketplace-card__index", children: "2" }), _jsx("span", { className: "fbs-marketplace-card__brand", children: "OZON" }), _jsxs("span", { className: "fbs-marketplace-card__content", children: [_jsx("small", { children: "Ozon Seller" }), _jsxs("span", { className: "fbs-marketplace-card__heading", children: [_jsx("strong", { children: "FBS Ozon" }), renderMarketplaceActiveCount('OZON')] }), _jsx("p", { children: "\u041E\u0442\u0434\u0435\u043B\u044C\u043D\u0430\u044F \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0437\u0430\u043A\u0430\u0437\u043E\u0432 Ozon, \u0441\u0442\u0430\u0442\u0443\u0441\u044B \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0438, \u0430\u0440\u0445\u0438\u0432, \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u0438 API." })] }), _jsx(ChevronRight, { size: 26, "aria-hidden": "true" })] }), _jsxs("button", { type: "button", className: "fbs-marketplace-card fbs-marketplace-card--yandex", onClick: () => openMarketplace('YANDEX_MARKET'), children: [_jsx("span", { className: "fbs-marketplace-card__index", children: "3" }), _jsx("span", { className: "fbs-marketplace-card__brand", children: "\u042F" }), _jsxs("span", { className: "fbs-marketplace-card__content", children: [_jsx("small", { children: "\u042F\u043D\u0434\u0435\u043A\u0441 \u041C\u0430\u0440\u043A\u0435\u0442" }), _jsxs("span", { className: "fbs-marketplace-card__heading", children: [_jsx("strong", { children: "FBS \u042F\u043D\u0434\u0435\u043A\u0441" }), renderMarketplaceActiveCount('YANDEX_MARKET')] }), _jsx("p", { children: "\u041E\u0442\u0434\u0435\u043B\u044C\u043D\u0430\u044F \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u042F\u043D\u0434\u0435\u043A\u0441 \u041C\u0430\u0440\u043A\u0435\u0442\u0430, \u0441\u0431\u043E\u0440\u043A\u0430, \u0441\u0442\u0430\u0442\u0443\u0441\u044B, \u0430\u0440\u0445\u0438\u0432 \u0438 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 API." })] }), _jsx(ChevronRight, { size: 26, "aria-hidden": "true" })] })] })] }));
    }
    return (_jsxs("section", { className: "fbs-panel", "aria-label": "FBS", children: [_jsxs("header", { className: "fbs-panel__hero", children: [_jsx("div", { className: "fbs-panel__hero-icon", children: _jsx(ShoppingBasket, { size: 24, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsxs("button", { className: "fbs-marketplace-back", type: "button", onClick: closeMarketplace, children: [_jsx(ArrowLeft, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: "\u041D\u0430\u0437\u0430\u0434 \u043A \u0432\u044B\u0431\u043E\u0440\u0443 FBS" })] }), _jsx("p", { className: "eyebrow", children: marketplaceEyebrow(marketplace) }), _jsx("h2", { children: marketplaceTitle(marketplace) }), _jsx("p", { children: marketplace === 'WILDBERRIES'
                                    ? 'Заказы WB, складские остатки, короба, грузоместа, поставки и пропуска.'
                                    : marketplace === 'OZON'
                                        ? 'Заказы Ozon, статусы отгрузки, архив и стоимость обработки.'
                                        : 'Заказы Яндекс Маркета, сборка, статусы отгрузки, архив и стоимость обработки.' })] }), _jsx("span", { className: "fbs-panel__scope", children: activeView === 'calculator'
                            ? 'Предварительный расчёт'
                            : selectedClient
                                ? `${selectedClient.code} · ${selectedClient.name}`
                                : selectedClientId
                                    ? 'Клиент загружается'
                                    : 'Выберите клиента' })] }), _jsx("div", { className: "fbs-tiles", role: "tablist", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B\u044B FBS", children: visibleViews.map((view, index) => {
                    const Icon = view.icon;
                    const isActive = activeView === view.id;
                    return (_jsxs("div", { className: `fbs-tile fbs-tile--${view.accent}${isActive ? ' is-active' : ''}${view.id === 'active' ? ' fbs-tile--has-clients' : ''}`, children: [_jsxs("button", { className: "fbs-tile__open", type: "button", role: "tab", "aria-selected": isActive, onClick: () => setActiveView(view.id), children: [_jsx("span", { className: "fbs-tile__icon", children: _jsx(Icon, { size: 22, "aria-hidden": "true" }) }), _jsxs("span", { className: "fbs-tile__content", children: [_jsx("span", { className: "fbs-tile__number", children: index + 1 }), _jsx("strong", { children: view.title }), _jsx("small", { children: view.description })] }), _jsx("span", { className: "fbs-tile__count", children: tileCounts[view.id] })] }), view.id === 'active' ? (_jsxs("div", { className: "fbs-tile__clients", "aria-label": `Клиенты с активными заказами ${marketplaceLabel(marketplace)}`, children: [_jsx("span", { className: "fbs-tile__clients-title", children: "\u041A\u043B\u0438\u0435\u043D\u0442\u044B \u0441 \u0437\u0430\u043A\u0430\u0437\u0430\u043C\u0438" }), activeClientsLoading ? (_jsx("span", { className: "fbs-tile__clients-empty", children: "\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u044E \u0441\u043F\u0438\u0441\u043E\u043A\u2026" })) : activeClients.length > 0 ? (activeClients.map((item) => (_jsxs("button", { type: "button", className: item.client.id === selectedClientId ? 'is-selected' : undefined, onClick: () => {
                                            setSelectedClientId(item.client.id);
                                            setActiveView('active');
                                            setSearch('');
                                        }, children: [_jsx("span", { children: item.client.name }), _jsx("strong", { children: item.activeOrders })] }, item.client.id)))) : (_jsxs("span", { className: "fbs-tile__clients-empty", children: ["\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0437\u0430\u043A\u0430\u0437\u043E\u0432 ", marketplaceLabel(marketplace), " \u043D\u0435\u0442"] }))] })) : null] }, view.id));
                }) }), _jsxs("section", { className: "fbs-workspace", role: "tabpanel", "aria-label": activeConfig.title, children: [_jsxs("div", { className: "fbs-workspace__heading", children: [_jsxs("div", { children: [_jsxs("p", { className: "eyebrow", children: ["FBS \u00B7 ", marketplaceLabel(marketplace)] }), _jsx("h3", { children: activeConfig.title }), _jsx("p", { children: activeConfig.description })] }), activeView !== 'calculator' ? _jsxs("div", { className: "fbs-workspace__filters", children: [clients.length > 1 ? (_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: selectedClientId, onChange: (event) => setSelectedClientId(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id)))] })] })) : null, orderSearchEnabled ? (_jsxs("form", { className: "fbs-order-quick-search", onSubmit: submitOrderQuickSearch, children: [_jsxs("label", { className: "fbs-workspace__search fbs-workspace__search--order", children: [_jsx("span", { children: "\u0411\u044B\u0441\u0442\u0440\u044B\u0439 \u043F\u043E\u0438\u0441\u043A \u0437\u0430\u043A\u0430\u0437\u0430" }), _jsxs("span", { children: [_jsx(Search, { size: 17, "aria-hidden": "true" }), _jsx("input", { value: search, onChange: (event) => {
                                                                    setSearch(event.target.value);
                                                                    setOrderSearchFeedback(null);
                                                                }, placeholder: "\u041D\u043E\u043C\u0435\u0440 \u0437\u0430\u043A\u0430\u0437\u0430 WB, Ozon \u0438\u043B\u0438 \u042F\u043D\u0434\u0435\u043A\u0441", "aria-label": "\u041D\u043E\u043C\u0435\u0440 \u0437\u0430\u043A\u0430\u0437\u0430 \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0430" }), search ? (_jsx("button", { className: "fbs-order-quick-search__clear", type: "button", onClick: clearOrderQuickSearch, title: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A", "aria-label": "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A \u0437\u0430\u043A\u0430\u0437\u0430", children: _jsx(XCircle, { size: 17, "aria-hidden": "true" }) })) : null, _jsx("button", { className: "fbs-order-quick-search__submit", type: "submit", disabled: !search.trim() || ordersState.status === 'loading', children: "\u041D\u0430\u0439\u0442\u0438" })] })] }), orderSearchFeedback ? (_jsx("small", { className: `fbs-order-quick-search__feedback is-${orderSearchFeedback.tone}`, children: orderSearchFeedback.text })) : null] })) : activeView !== 'cost' && activeView !== 'pricing' && activeView !== 'passes' && activeView !== 'report' ? (_jsxs("label", { className: "fbs-workspace__search", children: [_jsx("span", { children: "\u041F\u043E\u0438\u0441\u043A" }), _jsxs("span", { children: [_jsx(Search, { size: 17, "aria-hidden": "true" }), _jsx("input", { value: search, onChange: (event) => setSearch(event.target.value), placeholder: "\u0417\u0430\u043A\u0430\u0437, \u0428\u041A, \u0442\u043E\u0432\u0430\u0440 \u0438\u043B\u0438 \u043A\u043E\u0440\u043E\u0431" })] })] })) : null, activeView !== 'pricing' && activeView !== 'passes' && activeView !== 'stocks' && activeView !== 'report' ? (_jsxs("button", { className: "fbs-refresh-button", type: "button", onClick: () => void (activeView === 'cargo' ? loadCargoPackings() : loadOrders(true)), disabled: !selectedClientId ||
                                            (activeView === 'cargo' ? cargoState.status === 'loading' : ordersState.status === 'loading'), children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: (activeView === 'cargo' ? cargoState.status : ordersState.status) === 'loading'
                                                    ? 'Обновляю'
                                                    : 'Обновить' })] })) : null] }) : null] }), activeView === 'calculator' ? (_jsx(FbsCostCalculator, { session: session, isAdmin: canManagePricing })) : !selectedClientId ? (_jsx(FbsNotice, { icon: Boxes, title: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430", text: "\u0417\u0430\u043A\u0430\u0437\u044B \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u044E\u0442\u0441\u044F \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E \u0434\u043B\u044F \u043A\u0430\u0436\u0434\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u043E\u0433\u043E \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0430." })) : activeView === 'pricing' && canManagePricing ? (_jsx(FbsPricingSettings, { clientId: selectedClientId, session: session, onSaved: () => void loadOrders(true) })) : activeView === 'passes' ? (_jsx(FbsPassesView, { clientId: selectedClientId, session: session })) : activeView === 'stocks' ? (_jsx(FbsStocksView, { clientId: selectedClientId, session: session, search: search })) : activeView === 'cargo' ? (_jsx(FbsCargoPackingView, { state: cargoState, search: search, canManage: canManagePricing, actionId: cargoActionId, onToggleIgnored: toggleCargoPackingIgnored })) : activeView === 'report' ? (_jsx(FbsProductShipmentsReportView, { clientId: selectedClientId, session: session })) : ordersState.status === 'error' ? (_jsx(FbsNotice, { icon: AlertTriangle, title: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0437\u0430\u043A\u0430\u0437\u044B", text: ordersState.error, tone: "error" })) : data && !data.connected ? (_jsx(FbsConnectionPrompt, { isOpen: connectionOpen, marketplace: connectionMarketplace, accountName: connectionName, sellerId: sellerId, apiKey: apiKey, error: connectionError, isSubmitting: isConnecting, onOpen: () => setConnectionOpen(true), onCancel: () => setConnectionOpen(false), onAccountNameChange: setConnectionName, onSellerIdChange: setSellerId, onApiKeyChange: setApiKey, onSubmit: connectMarketplace })) : ordersState.status === 'loading' && !data ? (_jsx(FbsNotice, { icon: RefreshCw, title: "\u041F\u043E\u043B\u0443\u0447\u0430\u044E \u0437\u0430\u043A\u0430\u0437\u044B", text: `Проверяем подключённые кабинеты ${marketplaceLabel(marketplace)}.` })) : activeView === 'cost' ? (_jsx(FbsCostView, { data: data })) : activeView === 'active' || activeView === 'shipped' || activeView === 'cancelled' || activeView === 'archive' ? (_jsx(FbsOrdersView, { data: data, view: activeView, search: search, selectedOrderKeys: selectedOrderKeys, onSelectionChange: setSelectedOrderKeys, orderAction: orderAction, rowActionKey: rowActionKey, actionMessage: orderActionMessage, actionError: orderActionError, onAssemble: assembleSelectedOrders, onReship: reshipSelectedOrders, onDeliver: deliverSelectedSupplies, onChangeDestination: changeSelectedSuppliesToSortingCenter, onMoveToNewSupply: moveSelectedOrdersToNewSupply, onCancel: cancelSelectedOrders, onRemoveCancelledOrder: removeCancelledOrderFromWms, onDownloadStickers: downloadSelectedOrderStickers, onDownloadCargoStickers: downloadSelectedCargoPlaceStickers, onDownloadSupplyStickers: downloadSelectedSupplyStickers, onDownloadPickList: downloadFbsPickList, canDownloadPickList: canDownloadPickList, canEnableEmergencyAssembly: canEnableEmergencyAssembly, onEnableEmergencyAssembly: enableEmergencyAssemblyForRequest, onCreateRequest: createRequestFromSelectedOrders, syncAudit: syncAudit, syncAuditBusy: syncAuditBusy, onRunSynchronizationAudit: runFbsSynchronizationAudit, onCloseSynchronizationAudit: () => setSyncAudit(null) })) : null, data?.connected &&
                        activeView !== 'pricing' &&
                        activeView !== 'calculator' &&
                        activeView !== 'passes' &&
                        activeView !== 'stocks' &&
                        activeView !== 'report' ? (_jsxs("div", { className: "fbs-source-line", children: [_jsxs("span", { children: [_jsx(Link2, { size: 14, "aria-hidden": "true" }), data.connections.map((connection) => marketplaceLabel(connection.marketplace)).join(', ')] }), _jsxs("span", { children: ["\u0421\u0442\u0430\u0442\u0443\u0441\u044B \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u044B ", formatDateTime(data.fetchedAt)] }), _jsx("span", { children: "\u0410\u0432\u0442\u043E\u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 \u0440\u0430\u0437 \u0432 \u043C\u0438\u043D\u0443\u0442\u0443" })] })) : null] }), assemblyDialog ? (_jsx(FbsAssemblyDestinationDialog, { orders: assemblyDialog.orders, destination: assemblyDialog.destination, mode: assemblyDialog.mode, isSubmitting: orderAction === 'assemble' || orderAction === 'reship', onDestinationChange: (destination) => setAssemblyDialog((current) => (current ? { ...current, destination } : current)), onCancel: () => setAssemblyDialog(null), onSubmit: () => void submitAssemblyDirection() })) : null, deliveryRecovery ? (_jsx(FbsDeliveryRecoveryDialog, { rescanOrders: deliveryRecovery.rescanOrders, cancelledOrders: deliveryRecovery.cancelledOrders, onClose: () => setDeliveryRecovery(null) })) : null] }));
}
function FbsProductShipmentsReportView({ clientId, session, }) {
    const initialPeriod = useMemo(() => fbsReportInitialPeriod(), []);
    const [dateFrom, setDateFrom] = useState(initialPeriod.dateFrom);
    const [dateTo, setDateTo] = useState(initialPeriod.dateTo);
    const [keyword, setKeyword] = useState('');
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState(null);
    const [error, setError] = useState('');
    const loadReport = useCallback(async () => {
        if (!clientId)
            return;
        setLoading(true);
        setError('');
        try {
            setReport(await fetchFbsProductShipmentReport(session.accessToken, {
                clientId,
                dateFrom,
                dateTo,
            }));
        }
        catch (caught) {
            setReport(null);
            setError(caught instanceof Error
                ? caught.message
                : 'Не удалось сформировать отчёт FBS.');
        }
        finally {
            setLoading(false);
        }
    }, [clientId, dateFrom, dateTo, session.accessToken]);
    useEffect(() => {
        setKeyword('');
        void loadReport();
    }, [clientId]);
    const filteredRows = useMemo(() => {
        const query = normalizeFbsReportSearch(keyword);
        if (!query || !report)
            return [];
        return report.rows.filter((row) => [
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
        ].some((value) => normalizeFbsReportSearch(value).includes(query)));
    }, [keyword, report]);
    const filteredSummary = useMemo(() => fbsProductReportSummary(filteredRows), [filteredRows]);
    function submit(event) {
        event.preventDefault();
        void loadReport();
    }
    async function download(mode) {
        if (!report)
            return;
        setDownloading(mode);
        setError('');
        try {
            const blob = await downloadFbsProductShipmentReport(session.accessToken, {
                clientId,
                dateFrom,
                dateTo,
                search: mode === 'filtered' ? keyword.trim() : undefined,
            });
            const suffix = mode === 'filtered' && keyword.trim()
                ? `_${keyword.trim().replace(/[^a-zа-яё0-9_-]+/giu, '_')}`
                : '';
            downloadFbsBlob(blob, `FBS_товары_${dateFrom}_${dateTo}${suffix}.xlsx`);
        }
        catch (caught) {
            setError(caught instanceof Error
                ? caught.message
                : 'Не удалось скачать Excel.');
        }
        finally {
            setDownloading(null);
        }
    }
    return (_jsxs("div", { className: "fbs-product-report", children: [_jsxs("form", { className: "fbs-product-report__period", onSubmit: submit, children: [_jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u0441" }), _jsx("input", { type: "date", value: dateFrom, onChange: (event) => setDateFrom(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u043F\u043E" }), _jsx("input", { type: "date", value: dateTo, onChange: (event) => setDateTo(event.target.value) })] }), _jsxs("button", { className: "button button-primary", type: "submit", disabled: loading, children: [loading ? _jsx(RefreshCw, { className: "is-spinning", size: 17 }) : _jsx(BarChart3, { size: 17 }), "\u0421\u0444\u043E\u0440\u043C\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043E\u0442\u0447\u0451\u0442"] })] }), error ? _jsx("p", { className: "fbs-product-report__error", children: error }) : null, _jsxs("section", { className: "fbs-product-report__window", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041E\u043A\u043D\u043E 1" }), _jsx("h4", { children: "\u041F\u043E\u043B\u043D\u044B\u0439 \u0441\u043F\u0438\u0441\u043E\u043A \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434" }), _jsx("p", { children: "\u0423\u0447\u0438\u0442\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0435 FBS-\u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0438 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0432 \u0442\u0435\u043A\u0443\u0449\u0435\u043C \u0444\u0438\u043B\u0438\u0430\u043B\u0435." })] }), _jsxs("button", { type: "button", className: "button button-secondary", disabled: !report || downloading !== null, onClick: () => void download('all'), children: [downloading === 'all' ? (_jsx(RefreshCw, { className: "is-spinning", size: 17 })) : (_jsx(Download, { size: 17 })), "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u0432\u0435\u0441\u044C \u043E\u0442\u0447\u0451\u0442"] })] }), report ? (_jsxs(_Fragment, { children: [_jsx(FbsProductReportSummary, { summary: report.summary }), _jsx(FbsProductReportTable, { rows: report.rows })] })) : loading ? (_jsx(FbsNotice, { icon: RefreshCw, title: "\u0424\u043E\u0440\u043C\u0438\u0440\u0443\u044E \u043E\u0442\u0447\u0451\u0442", text: "\u0421\u043E\u0431\u0438\u0440\u0430\u044E \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0435 FBS-\u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0438 \u0438 \u0433\u0440\u0443\u043F\u043F\u0438\u0440\u0443\u044E \u0442\u043E\u0432\u0430\u0440\u044B." })) : null] }), _jsxs("section", { className: "fbs-product-report__window fbs-product-report__window--search", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041E\u043A\u043D\u043E 2" }), _jsx("h4", { children: "\u041F\u043E\u0438\u0441\u043A \u043F\u0440\u043E\u0434\u0430\u0436 \u043F\u043E \u043A\u043B\u044E\u0447\u0435\u0432\u043E\u043C\u0443 \u0441\u043B\u043E\u0432\u0443" }), _jsx("p", { children: "\u041F\u043E\u0438\u0441\u043A \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u043F\u043E \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044E, SKU, \u0430\u0440\u0442\u0438\u043A\u0443\u043B\u0443, \u0440\u0430\u0437\u043C\u0435\u0440\u0443, \u0448\u0442\u0440\u0438\u0445\u043A\u043E\u0434\u0443, \u043D\u043E\u043C\u0435\u0440\u0443 \u0437\u0430\u043A\u0430\u0437\u0430 \u0438 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 WB." })] }), _jsxs("button", { type: "button", className: "button button-secondary", disabled: !keyword.trim() || !report || downloading !== null, onClick: () => void download('filtered'), children: [downloading === 'filtered' ? (_jsx(RefreshCw, { className: "is-spinning", size: 17 })) : (_jsx(Download, { size: 17 })), "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u043D\u0430\u0439\u0434\u0435\u043D\u043D\u043E\u0435"] })] }), _jsxs("label", { className: "fbs-product-report__keyword", children: [_jsx(Search, { size: 18, "aria-hidden": "true" }), _jsx("input", { value: keyword, onChange: (event) => setKeyword(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u041A\u043E\u0440\u0435\u044F" })] }), keyword.trim() ? (_jsxs(_Fragment, { children: [_jsx(FbsProductReportSummary, { summary: filteredSummary }), _jsx(FbsProductReportTable, { rows: filteredRows })] })) : (_jsx("div", { className: "fbs-product-report__hint", children: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0447\u0430\u0441\u0442\u044C \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F, \u0430\u0440\u0442\u0438\u043A\u0443\u043B\u0430 \u0438\u043B\u0438 \u043D\u043E\u043C\u0435\u0440 \u0437\u0430\u043A\u0430\u0437\u0430 WB." }))] })] }));
}
function FbsProductReportSummary({ summary, }) {
    return (_jsxs("div", { className: "fbs-product-report__summary", children: [_jsxs("span", { children: [_jsx("small", { children: "\u0422\u043E\u0432\u0430\u0440\u043E\u0432" }), _jsx("strong", { children: summary.products.toLocaleString('ru-RU') })] }), _jsxs("span", { children: [_jsx("small", { children: "\u041E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043E, \u0448\u0442." }), _jsx("strong", { children: summary.quantity.toLocaleString('ru-RU') })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0417\u0430\u043A\u0430\u0437\u043E\u0432 WB" }), _jsx("strong", { children: summary.orders.toLocaleString('ru-RU') })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0417\u0430\u044F\u0432\u043E\u043A WMS" }), _jsx("strong", { children: summary.requests.toLocaleString('ru-RU') })] })] }));
}
function FbsProductReportTable({ rows, }) {
    if (!rows.length) {
        return (_jsx("div", { className: "fbs-product-report__empty", children: "\u0417\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434 \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0438\u0445 \u043E\u0442\u0433\u0440\u0443\u0437\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E." }));
    }
    return (_jsx("div", { className: "fbs-table-wrap fbs-product-report__table", children: _jsxs("table", { className: "fbs-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B / SKU" }), _jsx("th", { children: "\u0420\u0430\u0437\u043C\u0435\u0440" }), _jsx("th", { children: "\u041E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043E" }), _jsx("th", { children: "\u0417\u0430\u043A\u0430\u0437\u043E\u0432 WB" }), _jsx("th", { children: "\u041D\u043E\u043C\u0435\u0440\u0430 \u0437\u0430\u043A\u0430\u0437\u043E\u0432 WB" }), _jsx("th", { children: "\u041F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 WB" }), _jsx("th", { children: "\u0417\u0430\u044F\u0432\u043A\u0438 WMS" }), _jsx("th", { children: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0430" })] }) }), _jsx("tbody", { children: rows.map((row, index) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: row.productName }), _jsx("small", { children: [row.color, row.barcode].filter(Boolean).join(' · ') })] }), _jsxs("td", { children: [_jsx("strong", { children: row.article || row.clientSku || row.internalSku || '—' }), _jsx("small", { children: row.internalSku })] }), _jsx("td", { children: row.size || '—' }), _jsx("td", { children: _jsxs("strong", { children: [row.quantity.toLocaleString('ru-RU'), " \u0448\u0442."] }) }), _jsx("td", { children: row.orders.toLocaleString('ru-RU') }), _jsx("td", { className: "fbs-product-report__numbers", children: row.wbOrderNumbers || '—' }), _jsx("td", { className: "fbs-product-report__numbers", children: row.wbSupplyNumbers || '—' }), _jsx("td", { className: "fbs-product-report__numbers", children: row.wmsRequestNumbers || '—' }), _jsx("td", { children: row.lastShippedAt ? formatDateTime(row.lastShippedAt) : '—' })] }, row.skuId || `${row.productName}-${row.barcode}-${index}`))) })] }) }));
}
function fbsProductReportSummary(rows) {
    const orderNumbers = new Set();
    const requestNumbers = new Set();
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
function normalizeFbsReportSearch(value) {
    return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
}
function fbsReportInitialPeriod() {
    const today = new Date();
    const dateTo = fbsLocalIsoDate(today);
    const dateFrom = `${dateTo.slice(0, 7)}-01`;
    return { dateFrom, dateTo };
}
function fbsLocalIsoDate(value) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
function FbsAssemblyDestinationDialog({ orders, destination, mode, isSubmitting, onDestinationChange, onCancel, onSubmit, }) {
    const itemCount = orders.reduce((sum, order) => sum + Math.max(1, order.itemCount), 0);
    const cargoPlaceCount = estimateFbsCargoPlaces(orders);
    const pickupPointUnavailable = orders.filter((order) => !order.pickupPointShipmentAllowed);
    const pickupBlocked = destination === 'PICKUP_POINT' && pickupPointUnavailable.length > 0;
    return (_jsx("div", { className: "fbs-assembly-dialog-backdrop", role: "presentation", children: _jsxs("section", { className: "fbs-assembly-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "fbs-assembly-title", children: [_jsx("div", { className: "fbs-assembly-dialog__icon", children: _jsx(Truck, { size: 24, "aria-hidden": "true" }) }), _jsxs("div", { className: "fbs-assembly-dialog__heading", children: [_jsx("p", { className: "eyebrow", children: mode === 'reship' ? 'Повторная отгрузка FBS' : 'Новая поставка FBS' }), _jsx("h3", { id: "fbs-assembly-title", children: "\u041A\u0443\u0434\u0430 \u0441\u0434\u0430\u0451\u043C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B?" }), _jsxs("p", { children: [orders.length, " \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u00B7 ", itemCount, " \u0435\u0434\u0438\u043D\u0438\u0446 \u0442\u043E\u0432\u0430\u0440\u0430"] })] }), _jsxs("div", { className: "fbs-assembly-dialog__choices", children: [_jsxs("button", { type: "button", className: destination === 'PICKUP_POINT' ? 'is-selected' : undefined, onClick: () => onDestinationChange('PICKUP_POINT'), children: [_jsx(MapPin, { size: 21, "aria-hidden": "true" }), _jsxs("span", { children: [_jsx("strong", { children: "\u041F\u0443\u043D\u043A\u0442 \u0432\u044B\u0434\u0430\u0447\u0438 \u0437\u0430\u043A\u0430\u0437\u043E\u0432" }), _jsxs("small", { children: ["WMS \u0441\u043E\u0437\u0434\u0430\u0441\u0442 ", cargoPlaceCount, " \u0433\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442 \u0431\u0435\u0437 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u044F \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0430 \u0438 \u043F\u043E\u043B\u0443\u0447\u0438\u0442 \u0434\u043B\u044F \u043D\u0438\u0445 QR."] })] })] }), _jsxs("button", { type: "button", className: destination === 'VNUKOVO_SORTING_CENTER' ? 'is-selected' : undefined, onClick: () => onDestinationChange('VNUKOVO_SORTING_CENTER'), children: [_jsx(Boxes, { size: 21, "aria-hidden": "true" }), _jsxs("span", { children: [_jsx("strong", { children: "\u0421\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043E\u0447\u043D\u044B\u0439 \u0446\u0435\u043D\u0442\u0440 WB" }), _jsx("small", { children: "\u0413\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442\u0430 \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u044E\u0442\u0441\u044F. \u041F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0438 \u0432 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0443 \u0441\u0442\u0430\u043D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D QR \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438." })] })] })] }), pickupBlocked ? (_jsxs("p", { className: "fbs-assembly-dialog__warning", children: ["Wildberries \u043D\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0430\u0435\u0442 \u0441\u0434\u0430\u0447\u0443 \u0447\u0435\u0440\u0435\u0437 \u041F\u0412\u0417 \u0434\u043B\u044F \u0437\u0430\u043A\u0430\u0437\u043E\u0432: ", pickupPointUnavailable.map((order) => order.id).join(', '), ". \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043E\u0447\u043D\u044B\u0439 \u0446\u0435\u043D\u0442\u0440."] })) : null, _jsxs("div", { className: "fbs-assembly-dialog__actions", children: [_jsx("button", { type: "button", className: "button button-secondary", onClick: onCancel, disabled: isSubmitting, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsx("button", { type: "button", className: "button button-primary", onClick: onSubmit, disabled: pickupBlocked || isSubmitting, children: isSubmitting ? 'Создаю поставку…' : destination === 'PICKUP_POINT'
                                ? `${mode === 'reship' ? 'Переотгрузить' : 'Собрать'} и создать ${cargoPlaceCount} мест`
                                : mode === 'reship' ? 'Переотгрузить через СЦ' : 'Собрать для СЦ' })] })] }) }));
}
function FbsDeliveryRecoveryDialog({ rescanOrders, cancelledOrders, onClose, }) {
    return (_jsx("div", { className: "fbs-assembly-dialog-backdrop", role: "presentation", children: _jsxs("section", { className: "fbs-assembly-dialog fbs-delivery-recovery", role: "dialog", "aria-modal": "true", "aria-labelledby": "fbs-delivery-recovery-title", children: [_jsx("div", { className: "fbs-assembly-dialog__icon fbs-delivery-recovery__icon", children: _jsx(AlertTriangle, { size: 24, "aria-hidden": "true" }) }), _jsxs("div", { className: "fbs-assembly-dialog__heading", children: [_jsx("p", { className: "eyebrow", children: "\u041F\u0435\u0440\u0435\u0434\u0430\u0447\u0430 \u0432 Wildberries \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043B\u0430\u0441\u044C \u043E\u0448\u0438\u0431\u043A\u043E\u0439" }), _jsx("h3", { id: "fbs-delivery-recovery-title", children: "\u041D\u0443\u0436\u043D\u044B \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u043D\u044B\u043C \u0437\u0430\u043A\u0430\u0437\u0430\u043C" }), _jsx("p", { children: "\u041E\u0441\u0442\u0430\u043B\u044C\u043D\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u0441\u043E\u0431\u0440\u0430\u043D\u043D\u043E\u0439 \u2014 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0435\u0451 \u043D\u0435 \u043D\u0443\u0436\u043D\u043E." })] }), _jsxs("div", { className: "fbs-delivery-recovery__content", children: [rescanOrders.length > 0 ? (_jsx(RecoveryOrderGroup, { title: "\u041F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u043E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043D\u0430 \u0422\u0421\u0414", description: "\u042D\u0442\u0438 \u0437\u0430\u043A\u0430\u0437\u044B \u0443\u0436\u0435 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0435\u043D\u044B \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0441\u0431\u043E\u0440\u043A\u0438. \u041E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u0443\u0439\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E \u0442\u043E\u043B\u044C\u043A\u043E \u0428\u041A \u0442\u043E\u0432\u0430\u0440\u0430 \u0438, \u0435\u0441\u043B\u0438 \u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F, \u0427\u0417.", tone: "rescan", orders: rescanOrders })) : null, cancelledOrders.length > 0 ? (_jsx(RecoveryOrderGroup, { title: "\u0417\u0430\u043A\u0430\u0437\u044B \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u044B \u0432 WB \u2014 \u0442\u043E\u0432\u0430\u0440 \u043D\u0443\u0436\u043D\u043E \u0432\u044B\u043B\u043E\u0436\u0438\u0442\u044C", description: "\u041D\u0435 \u0441\u043A\u0430\u043D\u0438\u0440\u0443\u0439\u0442\u0435 \u0438\u0445 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E. \u041D\u0430\u0439\u0434\u0438\u0442\u0435 \u0442\u043E\u0432\u0430\u0440 \u043F\u043E \u0443\u043A\u0430\u0437\u0430\u043D\u043D\u043E\u043C\u0443 \u0433\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442\u0443 \u0438\u043B\u0438 \u043A\u043E\u0440\u043E\u0431\u0443 \u0438 \u0432\u044B\u043B\u043E\u0436\u0438\u0442\u0435 \u0438\u0437 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438.", tone: "cancelled", orders: cancelledOrders })) : null, rescanOrders.length === 0 && cancelledOrders.length === 0 ? (_jsx("p", { className: "fbs-delivery-recovery__empty", children: "Wildberries \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043B \u043A\u043E\u043D\u043A\u0440\u0435\u0442\u043D\u044B\u0439 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u043D\u044B\u0439 \u0437\u0430\u043A\u0430\u0437. \u0421\u043E\u0441\u0442\u0430\u0432 \u0437\u0430\u044F\u0432\u043A\u0438 \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u0451\u043D." })) : null] }), _jsx("div", { className: "fbs-assembly-dialog__actions", children: _jsx("button", { type: "button", className: "button button-primary", onClick: onClose, children: "\u041F\u043E\u043D\u044F\u0442\u043D\u043E" }) })] }) }));
}
function RecoveryOrderGroup({ title, description, tone, orders, }) {
    return (_jsxs("section", { className: `fbs-delivery-recovery__group is-${tone}`, children: [_jsxs("div", { className: "fbs-delivery-recovery__group-heading", children: [tone === 'rescan' ? _jsx(RefreshCw, { size: 18, "aria-hidden": "true" }) : _jsx(XCircle, { size: 18, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: title }), _jsx("p", { children: description })] })] }), _jsx("div", { className: "fbs-delivery-recovery__orders", children: orders.map((order) => (_jsxs("article", { className: "fbs-delivery-recovery__order", children: [_jsxs("div", { className: "fbs-delivery-recovery__order-title", children: [_jsxs("strong", { children: ["WB \u2116", order.orderId] }), order.requestNumber ? _jsxs("span", { children: ["\u0417\u0430\u044F\u0432\u043A\u0430 \u2116", order.requestNumber] }) : null] }), _jsxs("p", { className: "fbs-delivery-recovery__product", children: [order.productName, order.size ? _jsxs("b", { children: [" \u00B7 \u0440\u0430\u0437\u043C\u0435\u0440 ", order.size] }) : null] }), _jsxs("dl", { className: "fbs-delivery-recovery__details", children: [order.article ? (_jsxs("div", { children: [_jsx("dt", { children: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B" }), _jsx("dd", { children: order.article })] })) : null, order.boxCode ? (_jsxs("div", { children: [_jsx("dt", { children: "\u041A\u043E\u0440\u043E\u0431" }), _jsx("dd", { children: order.boxCode })] })) : null, order.cargoPlaceCode ? (_jsxs("div", { children: [_jsx("dt", { children: "\u0413\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442\u043E" }), _jsx("dd", { children: order.cargoPlaceCode })] })) : null, order.barcode ? (_jsxs("div", { children: [_jsx("dt", { children: "\u0428\u041A" }), _jsx("dd", { children: order.barcode })] })) : null, order.kiz ? (_jsxs("div", { children: [_jsx("dt", { children: "\u0427\u0417" }), _jsx("dd", { className: "fbs-delivery-recovery__kiz", children: order.kiz })] })) : null] }), _jsx("p", { className: "fbs-delivery-recovery__reason", children: order.reason })] }, `${tone}-${order.orderId}`))) })] }));
}
function FbsStocksView({ clientId, session, search, }) {
    const [state, setState] = useState({
        status: 'loading',
        data: null,
        error: '',
    });
    const [actionSkuId, setActionSkuId] = useState(null);
    const [connectingWarehouse, setConnectingWarehouse] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [refreshingReserves, setRefreshingReserves] = useState(false);
    const [message, setMessage] = useState('');
    const [page, setPage] = useState(0);
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [showZeroWmsStock, setShowZeroWmsStock] = useState(false);
    const [selectedSkuIds, setSelectedSkuIds] = useState(() => new Set());
    const [saleLimits, setSaleLimits] = useState({});
    const [relabelAmounts, setRelabelAmounts] = useState({});
    const [bulkSaleLimit, setBulkSaleLimit] = useState('');
    const [bulkAction, setBulkAction] = useState(null);
    const [routingOpen, setRoutingOpen] = useState(false);
    const [routingBranches, setRoutingBranches] = useState([]);
    const [routingLoading, setRoutingLoading] = useState(false);
    const [routingSaving, setRoutingSaving] = useState(false);
    const [routingError, setRoutingError] = useState('');
    const [routingData, setRoutingData] = useState(null);
    const [routingDrafts, setRoutingDrafts] = useState({});
    const [routingForm, setRoutingForm] = useState({
        executionWarehouseId: '',
        dropoffWarehouseId: '',
        autoRouteNewWarehouses: false,
    });
    const canManageRouting = session.user.permissionCodes.includes('system:admin') ||
        session.user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER');
    const loadStocks = useCallback(async (connectionId, warehouseId, refreshReserves = false) => {
        setState((current) => ({ status: 'loading', data: current.data, error: '' }));
        try {
            const data = await fetchFbsStocks(session.accessToken, clientId, connectionId || undefined, warehouseId || undefined, refreshReserves);
            setState({ status: 'ready', data, error: '' });
            setPage(0);
            return data;
        }
        catch (caught) {
            setState((current) => ({
                status: 'error',
                data: current.data,
                error: caught instanceof Error ? caught.message : 'Не удалось загрузить остатки FBS.',
            }));
            return null;
        }
    }, [clientId, session.accessToken]);
    async function openRoutingSettings() {
        const connection = state.data?.connections.find((item) => item.id === state.data?.selectedConnectionId);
        if (!connection)
            return;
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
            setRoutingBranches(branches
                .filter((branch) => branch.isActive)
                .sort((left, right) => left.sortOrder - right.sortOrder || left.city.localeCompare(right.city, 'ru')));
            setRoutingData(routes);
            setRoutingDrafts(Object.fromEntries(routes.warehouses.map((warehouse) => [
                warehouse.marketplaceWarehouseId,
                {
                    mode: warehouse.mode,
                    executionWarehouseId: warehouse.executionWarehouseId ?? '',
                    dropoffWarehouseId: warehouse.dropoffWarehouseId ?? '',
                },
            ])));
        }
        catch (caught) {
            setRoutingError(caught instanceof Error ? caught.message : 'Не удалось загрузить склады WB и филиалы.');
        }
        finally {
            setRoutingLoading(false);
        }
    }
    async function saveRoutingSettings(event) {
        event.preventDefault();
        const connectionId = state.data?.selectedConnectionId;
        if (!connectionId)
            return;
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
        }
        catch (caught) {
            setRoutingError(caught instanceof Error ? caught.message : 'Не удалось сохранить маршрутизацию FBS.');
        }
        finally {
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
    const warehouseConnected = Boolean(selectedWarehouseId && connectedWarehouseId === selectedWarehouseId);
    const positiveFreeSkuIds = (state.data?.items ?? [])
        .filter((item) => item.sellable > 0)
        .map((item) => item.skuId);
    const selectedPositiveFreeCount = positiveFreeSkuIds.filter((skuId) => selectedSkuIds.has(skuId)).length;
    const allPositiveFreeSelected = positiveFreeSkuIds.length > 0 && selectedPositiveFreeCount === positiveFreeSkuIds.length;
    const hasSelection = selectedSkuIds.size > 0;
    function getSaleLimitValue(item) {
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
    function getRequestedAmount(item, saleLimit) {
        return saleLimit ?? item.sellable;
    }
    function getShortage(item, requestedAmount) {
        const localShortage = Math.max(0, requestedAmount - item.sellable);
        return Math.max(item.shortage ? item.shortageAmount : 0, localShortage);
    }
    function toggleSku(skuId) {
        setSelectedSkuIds((current) => {
            const next = new Set(current);
            if (next.has(skuId))
                next.delete(skuId);
            else
                next.add(skuId);
            return next;
        });
    }
    function toggleAllPositiveFreeSelection() {
        setSelectedSkuIds((current) => {
            const next = new Set(current);
            if (allPositiveFreeSelected)
                positiveFreeSkuIds.forEach((skuId) => next.delete(skuId));
            else
                positiveFreeSkuIds.forEach((skuId) => next.add(skuId));
            return next;
        });
    }
    function updateSaleLimit(skuId, value) {
        setSaleLimits((current) => ({
            ...current,
            [skuId]: value,
        }));
    }
    function getRelabelAmountValue(item) {
        const draft = relabelAmounts[item.skuId];
        if (draft === undefined)
            return item.relabelManualAmount;
        if (draft.trim() === '')
            return null;
        const numeric = Number(draft);
        return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : null;
    }
    function updateRelabelAmount(skuId, value) {
        setRelabelAmounts((current) => ({ ...current, [skuId]: value }));
    }
    async function setPublication(skuId, enabled, saleLimit, relabelManualAmount) {
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
            setMessage(enabled
                ? `Товар включён в продажу. В Wildberries передано: ${result.amount.toLocaleString('ru-RU')} шт.`
                : 'Продажа товара остановлена. В Wildberries передан остаток 0 шт.');
            await loadStocks(selectedConnectionId, selectedWarehouseId);
        }
        catch (caught) {
            setState((current) => ({
                status: 'error',
                data: current.data,
                error: caught instanceof Error ? caught.message : 'Не удалось изменить статус продажи.',
            }));
        }
        finally {
            setActionSkuId(null);
        }
    }
    async function correctWbExcess(item) {
        if (!selectedConnectionId || !selectedWarehouseId || !warehouseConnected)
            return;
        setActionSkuId(item.skuId);
        setMessage('');
        try {
            const result = await reconcileFbsStockItem(session.accessToken, {
                clientId,
                connectionId: selectedConnectionId,
                warehouseId: selectedWarehouseId,
                skuId: item.skuId,
            });
            setMessage(result.corrected
                ? `Остаток WB исправлен: было ${result.previousAmount.toLocaleString('ru-RU')} шт., стало ${result.amount.toLocaleString('ru-RU')} шт.`
                : 'Повторная проверка выполнена: превышения уже нет.');
            await loadStocks(selectedConnectionId, selectedWarehouseId);
        }
        catch (caught) {
            setState((current) => ({
                status: 'error',
                data: current.data,
                error: caught instanceof Error ? caught.message : 'Не удалось исправить остаток WB.',
            }));
        }
        finally {
            setActionSkuId(null);
        }
    }
    async function setPublicationBulk(enabled) {
        if (!selectedConnectionId || !selectedWarehouseId || !warehouseConnected || selectedSkuIds.size === 0)
            return;
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
            setMessage(`${enabled ? 'Включено' : 'Остановлено'} товаров: ${result.updatedProducts.toLocaleString('ru-RU')}. ` +
                `В Wildberries передано: ${result.amount.toLocaleString('ru-RU')} шт.`);
            await loadStocks(selectedConnectionId, selectedWarehouseId);
        }
        catch (caught) {
            setState((current) => ({
                status: 'error',
                data: current.data,
                error: caught instanceof Error ? caught.message : 'Не удалось массово изменить статус продажи.',
            }));
        }
        finally {
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
        }
        catch (caught) {
            setState((current) => ({
                status: 'error',
                data: current.data,
                error: caught instanceof Error ? caught.message : 'Не удалось синхронизировать остатки.',
            }));
        }
        finally {
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
        }
        finally {
            setRefreshingReserves(false);
        }
    }
    async function connectSelectedWarehouse() {
        if (!selectedConnectionId || !selectedWarehouseId || warehouseConnected)
            return;
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
        }
        catch (caught) {
            setState((current) => ({
                status: 'error',
                data: current.data,
                error: caught instanceof Error ? caught.message : 'Не удалось подключить склад FBS.',
            }));
        }
        finally {
            setConnectingWarehouse(false);
        }
    }
    if (state.status === 'loading' && !state.data) {
        return _jsx(FbsNotice, { icon: RefreshCw, title: "\u041F\u043E\u043B\u0443\u0447\u0430\u044E \u043E\u0441\u0442\u0430\u0442\u043A\u0438", text: "\u0421\u0432\u0435\u0440\u044F\u0435\u043C \u0442\u043E\u0432\u0430\u0440\u044B WMS \u0441 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u043E\u043C Wildberries." });
    }
    if (state.status === 'error' && !state.data) {
        return _jsx(FbsNotice, { icon: AlertTriangle, title: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043A\u0438", text: state.error, tone: "error" });
    }
    const data = state.data;
    if (!data?.connected) {
        return (_jsx(FbsNotice, { icon: PlugZap, title: "Wildberries \u043D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D", text: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0435 API Wildberries \u0432 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445 \u043A\u043B\u0438\u0435\u043D\u0442\u0430, \u0447\u0442\u043E\u0431\u044B \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043A\u0430\u043C\u0438 FBS." }));
    }
    if (!selectedWarehouseId) {
        return (_jsx(FbsNotice, { icon: Warehouse, title: "\u0421\u043A\u043B\u0430\u0434 Wildberries \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D", text: "\u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u0441\u043A\u043B\u0430\u0434 FBS \u0432 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0435 \u043F\u0440\u043E\u0434\u0430\u0432\u0446\u0430 Wildberries, \u0437\u0430\u0442\u0435\u043C \u0441\u043D\u043E\u0432\u0430 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0440\u0430\u0437\u0434\u0435\u043B." }));
    }
    return (_jsxs("section", { className: "fbs-stocks", children: [_jsxs("div", { className: "fbs-stocks__intro", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0422\u043E\u0432\u0430\u0440\u044B FBS \u00B7 WMS \u2192 Wildberries" }), _jsx("h3", { children: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0441\u0442\u0430\u0442\u0443\u0441\u043E\u043C \u00AB\u041F\u0440\u043E\u0434\u0430\u0432\u0430\u0442\u044C / \u041D\u0435 \u043F\u0440\u043E\u0434\u0430\u0432\u0430\u0442\u044C\u00BB" }), _jsx("p", { children: "WMS \u043F\u0435\u0440\u0435\u0434\u0430\u0451\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E. \u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0438, \u0446\u0435\u043D\u044B \u0438 \u0434\u0440\u0443\u0433\u0438\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0442\u043E\u0432\u0430\u0440\u0430 \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u044F\u044E\u0442\u0441\u044F." })] }), _jsxs("div", { className: "fbs-stocks__header-actions", children: [canManageRouting ? (_jsxs("button", { type: "button", className: "button button-secondary fbs-stocks__routing-button", onClick: () => void openRoutingSettings(), title: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u043C\u0430\u0440\u0448\u0440\u0443\u0442\u0438\u0437\u0430\u0446\u0438\u0438 FBS", "aria-label": "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u043C\u0430\u0440\u0448\u0440\u0443\u0442\u0438\u0437\u0430\u0446\u0438\u0438 FBS", children: [_jsx(MoreVertical, { size: 18, "aria-hidden": "true" }), "\u041C\u0430\u0440\u0448\u0440\u0443\u0442\u0438\u0437\u0430\u0446\u0438\u044F"] })) : null, _jsxs("button", { type: "button", className: "button button-secondary fbs-stocks__sync", onClick: () => void connectSelectedWarehouse(), disabled: warehouseConnected ||
                                    connectingWarehouse ||
                                    refreshingReserves ||
                                    syncing ||
                                    actionSkuId !== null ||
                                    bulkAction !== null, children: [warehouseConnected
                                        ? _jsx(CircleCheckBig, { size: 16, "aria-hidden": "true" })
                                        : _jsx(PlugZap, { size: 16, "aria-hidden": "true" }), connectingWarehouse
                                        ? 'Подключаю склад'
                                        : warehouseConnected
                                            ? 'Склад FBS подключён'
                                            : 'Подключить выбранный склад FBS'] }), _jsxs("button", { type: "button", className: "button button-secondary fbs-stocks__sync", onClick: () => void refreshReserves(), disabled: refreshingReserves || syncing || actionSkuId !== null || bulkAction !== null, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true", className: refreshingReserves ? 'is-spinning' : undefined }), refreshingReserves ? 'Обновляю резервы' : 'Обновить резервы'] }), _jsxs("button", { type: "button", className: "button button-primary fbs-stocks__sync", onClick: () => void synchronizeManagedStocks(), disabled: !warehouseConnected ||
                                    refreshingReserves ||
                                    syncing ||
                                    actionSkuId !== null ||
                                    bulkAction !== null ||
                                    data.summary.enabled + data.summary.disabled === 0, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true", className: syncing ? 'is-spinning' : undefined }), syncing ? 'Синхронизирую' : 'Синхронизировать выбранные'] })] })] }), _jsxs("div", { className: "fbs-stocks__selectors", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 WB" }), _jsx("select", { value: selectedConnectionId, disabled: refreshingReserves || syncing || actionSkuId !== null, onChange: (event) => {
                                    setSelectedSkuIds(new Set());
                                    setSaleLimits({});
                                    setRelabelAmounts({});
                                    setBulkSaleLimit('');
                                    void loadStocks(event.target.value);
                                }, children: data.connections.map((connection) => (_jsx("option", { value: connection.id, children: connection.accountName || 'Wildberries' }, connection.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u043A\u043B\u0430\u0434 WB" }), _jsx("select", { value: selectedWarehouseId, disabled: refreshingReserves || syncing || actionSkuId !== null, onChange: (event) => {
                                    setSelectedSkuIds(new Set());
                                    setSaleLimits({});
                                    setRelabelAmounts({});
                                    setBulkSaleLimit('');
                                    void loadStocks(selectedConnectionId, event.target.value);
                                }, children: data.warehouses.map((warehouse) => (_jsx("option", { value: warehouse.id, children: warehouse.name }, warehouse.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u0442\u0430\u0442\u0443\u0441 \u043F\u0440\u043E\u0434\u0430\u0436\u0438" }), _jsxs("select", { value: statusFilter, onChange: (event) => setStatusFilter(event.target.value), children: [_jsx("option", { value: "ALL", children: "\u0412\u0441\u0435 \u0442\u043E\u0432\u0430\u0440\u044B" }), _jsx("option", { value: "SELLING", children: "\u041F\u0440\u043E\u0434\u0430\u0432\u0430\u0442\u044C" }), _jsx("option", { value: "STOPPED", children: "\u041D\u0435 \u043F\u0440\u043E\u0434\u0430\u0432\u0430\u0442\u044C" }), _jsx("option", { value: "UNMANAGED", children: "\u041D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u043E" })] })] }), _jsxs("label", { className: "fbs-stocks__show-zero", children: [_jsx("input", { type: "checkbox", checked: showZeroWmsStock, onChange: (event) => setShowZeroWmsStock(event.target.checked) }), _jsx("span", { children: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0442\u043E\u0432\u0430\u0440\u044B \u0441 \u043D\u0443\u043B\u0435\u0432\u044B\u043C \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u043C WMS" })] })] }), _jsxs("div", { className: `fbs-stocks__warehouse-status ${warehouseConnected ? 'is-connected' : ''}`, children: [_jsx(Warehouse, { size: 18, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: warehouseConnected
                                    ? `Рабочий склад FBS: ${selectedWarehouse?.name || data.connectedWarehouseName || selectedWarehouseId}`
                                    : data.connectedWarehouseName
                                        ? `Сейчас подключён: ${data.connectedWarehouseName}`
                                        : 'Рабочий склад FBS ещё не подключён' }), _jsx("span", { children: warehouseConnected
                                    ? 'Публикация и синхронизация остатков выполняются только в этот склад Wildberries.'
                                    : 'Выберите склад WB, созданный для продаж FBS, и нажмите «Подключить выбранный склад FBS».' })] })] }), warehouseConnected ? (_jsxs("div", { className: "fbs-stocks__auto-sync", children: [_jsx(RefreshCw, { size: 18, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0430" }), _jsx("span", { children: "WMS \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u0442 \u043D\u043E\u0432\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B, \u0440\u0435\u0437\u0435\u0440\u0432\u044B \u0438 \u0441\u043A\u043B\u0430\u0434\u0441\u043A\u0438\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u043A\u0430\u0436\u0434\u0443\u044E \u043C\u0438\u043D\u0443\u0442\u0443 \u0438 \u043F\u0435\u0440\u0435\u0434\u0430\u0451\u0442 \u0432 WB \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0439 \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0444\u0438\u043B\u0438\u0430\u043B\u0430." })] })] })) : null, _jsxs("div", { className: `fbs-stocks__health ${data.summary.excessProducts > 0 ? 'is-danger' : 'is-ok'}`, role: "status", children: [data.summary.excessProducts > 0 ? (_jsx(AlertTriangle, { size: 22, "aria-hidden": "true" })) : (_jsx(CircleCheckBig, { size: 22, "aria-hidden": "true" })), _jsxs("div", { children: [_jsx("strong", { children: data.summary.excessProducts > 0
                                    ? 'Остатки WB превышают доступный остаток WMS'
                                    : 'Остатки WB соответствуют складу WMS' }), _jsx("span", { children: data.summary.excessProducts > 0
                                    ? `${data.summary.excessProducts.toLocaleString('ru-RU')} товар(ов) нужно исправить · превышение ${data.summary.excessUnits.toLocaleString('ru-RU')} шт.`
                                    : 'Ни по одному товару количество на WB не превышает свободный остаток WMS.' })] })] }), _jsxs("div", { className: "fbs-stocks__summary", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0422\u043E\u0432\u0430\u0440\u043E\u0432 \u0441\u043E\u043F\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E" }), _jsx("strong", { children: data.summary.products.toLocaleString('ru-RU') })] }), _jsxs("div", { className: "is-green", children: [_jsx("span", { children: "\u041F\u0440\u043E\u0434\u0430\u044E\u0442\u0441\u044F" }), _jsx("strong", { children: data.summary.enabled.toLocaleString('ru-RU') })] }), _jsxs("div", { className: "is-red", children: [_jsx("span", { children: "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u044B" }), _jsx("strong", { children: data.summary.disabled.toLocaleString('ru-RU') })] }), _jsxs("div", { children: [_jsx("span", { children: "\u041D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u043E" }), _jsx("strong", { children: data.summary.unmanaged.toLocaleString('ru-RU') })] }), _jsxs("div", { children: [_jsx("span", { children: "\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u043A \u043F\u0440\u043E\u0434\u0430\u0436\u0435" }), _jsxs("strong", { children: [data.summary.sellable.toLocaleString('ru-RU'), " \u0448\u0442."] })] }), _jsxs("div", { className: data.summary.differences > 0 ? 'is-amber' : 'is-green', children: [_jsx("span", { children: "\u0420\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u0439 \u0441 WB" }), _jsx("strong", { children: data.summary.differences.toLocaleString('ru-RU') })] })] }), _jsxs("div", { className: "fbs-stocks__rule", children: [_jsx(CircleCheckBig, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: "\u0410\u0432\u0442\u043E\u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u0435\u0442 \u043E\u0441\u0442\u0430\u0442\u043E\u043A WB \u043F\u0440\u0438 \u043D\u0435\u0445\u0432\u0430\u0442\u043A\u0435, \u043D\u043E \u043D\u0438\u043A\u043E\u0433\u0434\u0430 \u043D\u0435 \u043F\u043E\u0432\u044B\u0448\u0430\u0435\u0442 \u0435\u0433\u043E \u0441\u0430\u043C\u0430: \u0435\u0441\u043B\u0438 \u043D\u0430 WB 50, \u0430 \u0432 WMS 100, \u043E\u0441\u0442\u0430\u043D\u0435\u0442\u0441\u044F 50. \u041F\u043E\u0432\u044B\u0448\u0435\u043D\u0438\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \u00AB\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043F\u0440\u043E\u0434\u0430\u0436\u0443\u00BB. \u0414\u043B\u044F \u0442\u043E\u0432\u0430\u0440\u0430 \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0438 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E \u0443\u043A\u0430\u0436\u0438\u0442\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u043E\u0435 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u2014 \u043E\u043D\u043E \u0431\u0443\u0434\u0435\u0442 \u0432\u044B\u0447\u0442\u0435\u043D\u043E \u0438\u0437 \u0438\u0441\u0445\u043E\u0434\u043D\u043E\u0433\u043E \u0430\u0440\u0442\u0438\u043A\u0443\u043B\u0430." })] }), _jsxs("div", { className: "fbs-stocks__bulkbar", children: [_jsxs("label", { className: "fbs-stocks__select-all", children: [_jsx("input", { type: "checkbox", checked: allPositiveFreeSelected, onChange: toggleAllPositiveFreeSelection, disabled: positiveFreeSkuIds.length === 0 || bulkAction !== null || actionSkuId !== null || syncing }), _jsx("span", { children: hasSelection
                                    ? `Выбрано товаров: ${selectedSkuIds.size.toLocaleString('ru-RU')}`
                                    : `Выбрать все товары с положительным свободным остатком (${positiveFreeSkuIds.length.toLocaleString('ru-RU')})` })] }), _jsxs("div", { className: "fbs-stocks__bulk-actions", children: [_jsxs("label", { className: "fbs-stocks__bulk-limit", children: [_jsx("span", { children: "\u041F\u043E \u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0448\u0442. \u043A\u0430\u0436\u0434\u043E\u0433\u043E \u0442\u043E\u0432\u0430\u0440\u0430" }), _jsx("input", { type: "number", min: "0", step: "1", inputMode: "numeric", value: bulkSaleLimit, onChange: (event) => setBulkSaleLimit(event.target.value), disabled: !warehouseConnected || !hasSelection || bulkAction !== null || actionSkuId !== null || syncing, placeholder: "\u0412\u0435\u0441\u044C \u043E\u0441\u0442\u0430\u0442\u043E\u043A" })] }), _jsxs("button", { type: "button", className: "fbs-stocks__action fbs-stocks__action--on", disabled: !warehouseConnected || !hasSelection || bulkAction !== null || actionSkuId !== null || syncing, onClick: () => void setPublicationBulk(true), children: [_jsx(Power, { size: 14, "aria-hidden": "true" }), bulkAction === true ? 'Включаю…' : 'Продавать выбранные'] }), _jsxs("button", { type: "button", className: "fbs-stocks__action fbs-stocks__action--off", disabled: !warehouseConnected || !hasSelection || bulkAction !== null || actionSkuId !== null || syncing, onClick: () => void setPublicationBulk(false), children: [_jsx(PowerOff, { size: 14, "aria-hidden": "true" }), bulkAction === false ? 'Останавливаю…' : 'Не продавать выбранные'] })] })] }), message ? _jsx("p", { className: "fbs-stocks__message", children: message }) : null, state.status === 'error' && state.error ? _jsx("p", { className: "form-error", children: state.error }) : null, _jsxs("div", { className: "fbs-table-wrap fbs-stocks__table-wrap", children: [_jsxs("table", { className: "fbs-table fbs-stocks__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: "fbs-stocks__select-cell", "aria-label": "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0442\u043E\u0432\u0430\u0440\u044B", children: _jsx("input", { type: "checkbox", checked: allPositiveFreeSelected, onChange: toggleAllPositiveFreeSelection, disabled: positiveFreeSkuIds.length === 0 || bulkAction !== null || actionSkuId !== null || syncing }) }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0418\u0434\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u043E\u0440\u044B" }), _jsx("th", { children: "WMS" }), _jsx("th", { children: "\u0420\u0435\u0437\u0435\u0440\u0432" }), _jsx("th", { children: "\u041A \u043F\u0440\u043E\u0434\u0430\u0436\u0435" }), _jsx("th", { children: "\u041B\u0438\u043C\u0438\u0442 \u043F\u0440\u043E\u0434\u0430\u0436\u0438" }), _jsx("th", { children: "\u0412 WB" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441 \u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435" })] }) }), _jsx("tbody", { children: visibleItems.map((item) => {
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
                                    return (_jsxs("tr", { className: [
                                            shortageAmount > 0 ? 'fbs-stocks__row--shortage' : '',
                                            item.wbAmount > item.sellable ? 'fbs-stocks__row--wb-excess' : '',
                                        ].filter(Boolean).join(' ') || undefined, children: [_jsx("td", { className: "fbs-stocks__select-cell", children: _jsx("input", { type: "checkbox", checked: selectedSkuIds.has(item.skuId), onChange: () => toggleSku(item.skuId), disabled: bulkAction !== null || actionSkuId !== null || syncing, "aria-label": `Выбрать ${item.name}` }) }), _jsxs("td", { children: [_jsx("strong", { children: item.name }), _jsx("small", { children: [item.article, item.color, item.size].filter(Boolean).join(' · ') || item.internalSku }), item.relabeling.isTarget ? (_jsx("small", { className: "fbs-stocks__relabel-badge", children: "\u041F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0438 \u00B7 \u043D\u0430\u0441\u0442\u0440\u0430\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u0432\u0440\u0443\u0447\u043D\u0443\u044E" })) : null, item.relabeling.allocatedToTargets > 0 ? (_jsxs("small", { className: "fbs-stocks__relabel-source", children: ["\u041F\u0435\u0440\u0435\u0434\u0430\u043D\u043E \u0432 \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0443: ", item.relabeling.allocatedToTargets.toLocaleString('ru-RU'), " \u0448\u0442."] })) : null] }), _jsxs("td", { children: [_jsx("strong", { children: item.barcode || item.clientSku || item.internalSku }), _jsxs("small", { children: ["nmID ", item.nmId, " \u00B7 chrtID ", item.chrtId] })] }), _jsx("td", { children: _jsx("strong", { children: item.wmsAvailable.toLocaleString('ru-RU') }) }), _jsx("td", { children: _jsx("strong", { children: item.reserved.toLocaleString('ru-RU') }) }), _jsx("td", { children: _jsx("strong", { children: item.sellable.toLocaleString('ru-RU') }) }), _jsxs("td", { children: [_jsxs("label", { className: "fbs-stocks__limit-input", children: [_jsx("input", { type: "number", min: "0", step: "1", inputMode: "numeric", value: saleLimits[item.skuId] ?? (item.saleLimit === null ? '' : item.saleLimit), onChange: (event) => updateSaleLimit(item.skuId, event.target.value), disabled: busy || actionSkuId !== null || bulkAction !== null || syncing, placeholder: "\u0412\u0435\u0441\u044C \u043E\u0441\u0442\u0430\u0442\u043E\u043A", "aria-label": `Лимит продажи: ${item.name}` }), _jsx("small", { children: saleLimit === null ? 'Весь свободный остаток' : `В продажу: ${requestedAmount.toLocaleString('ru-RU')} шт.` })] }), item.relabeling.isTarget ? (_jsxs("label", { className: "fbs-stocks__relabel-input", children: [_jsx("span", { children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A \u0441 \u0443\u0447\u0451\u0442\u043E\u043C \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0438" }), _jsx("input", { type: "number", min: "0", step: "1", inputMode: "numeric", value: relabelAmounts[item.skuId] ?? (item.relabelManualAmount === null ? '' : item.relabelManualAmount), onChange: (event) => updateRelabelAmount(item.skuId, event.target.value), disabled: busy || actionSkuId !== null || bulkAction !== null || syncing, placeholder: "\u041D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0442\u044C \u0438\u0441\u0445\u043E\u0434\u043D\u044B\u0439", "aria-label": `Ручной остаток после переклейки: ${item.name}` }), _jsx("small", { children: relabelManualAmount === null
                                                                    ? 'Исходный товар в этот остаток не включён'
                                                                    : `Физически доступно: ${item.relabeling.capacity.toLocaleString('ru-RU')} шт. · из исходного: ${item.relabeling.allocatedFromSources.toLocaleString('ru-RU')} шт.` })] })) : null] }), _jsxs("td", { children: [_jsx("strong", { children: publishedAmount.toLocaleString('ru-RU') }), item.difference !== null && item.difference !== 0 ? (_jsxs("small", { className: "fbs-stocks__difference", children: ["\u043D\u0443\u0436\u043D\u043E \u043F\u0435\u0440\u0435\u0434\u0430\u0442\u044C ", item.targetAmount?.toLocaleString('ru-RU')] })) : null, item.wbAmount > item.sellable ? (_jsxs(_Fragment, { children: [_jsxs("small", { className: "fbs-stocks__wb-excess", children: ["\u041D\u0430 WB \u043B\u0438\u0448\u043D\u0438\u0445 ", (item.wbAmount - item.sellable).toLocaleString('ru-RU'), " \u0448\u0442."] }), _jsxs("button", { type: "button", className: "fbs-stocks__fix-excess", disabled: !warehouseConnected || busy || actionSkuId !== null || syncing, onClick: () => void correctWbExcess(item), children: [busy ? _jsx(RefreshCw, { className: "spin", size: 13 }) : _jsx(CircleCheckBig, { size: 13 }), "\u0418\u0441\u043F\u0440\u0430\u0432\u0438\u0442\u044C"] })] })) : null] }), _jsxs("td", { children: [_jsx("span", { className: `fbs-stocks__status fbs-stocks__status--${item.status.toLocaleLowerCase()}`, children: item.status === 'SELLING'
                                                            ? 'Продавать'
                                                            : item.status === 'STOPPED'
                                                                ? 'Не продавать'
                                                                : 'Не настроено' }), _jsxs("div", { className: "fbs-stocks__actions", children: [_jsxs("button", { type: "button", className: "fbs-stocks__action fbs-stocks__action--on", disabled: !warehouseConnected || busy || actionSkuId !== null || syncing, onClick: () => void setPublication(item.skuId, true, saleLimit, item.relabeling.isTarget ? relabelManualAmount : undefined), children: [_jsx(Power, { size: 14, "aria-hidden": "true" }), item.status === 'SELLING' ? 'Обновить продажу' : 'Продавать'] }), _jsxs("button", { type: "button", className: "fbs-stocks__action fbs-stocks__action--off", disabled: !warehouseConnected || busy || actionSkuId !== null || syncing || item.status === 'STOPPED', onClick: () => void setPublication(item.skuId, false), children: [_jsx(PowerOff, { size: 14, "aria-hidden": "true" }), "\u041D\u0435 \u043F\u0440\u043E\u0434\u0430\u0432\u0430\u0442\u044C"] })] }), shortageAmount > 0 ? (_jsxs("small", { className: "fbs-stocks__shortage", children: ["\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0442\u043E\u0432\u0430\u0440\u0430 \u0434\u043B\u044F \u043F\u0440\u043E\u0434\u0430\u0436\u0438 \u043F\u043E FBS: \u043D\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442 ", shortageAmount.toLocaleString('ru-RU'), " \u0448\u0442."] })) : null, item.lastError ? _jsx("small", { className: "fbs-stocks__row-error", children: item.lastError }) : null] })] }, item.skuId));
                                }) })] }), visibleItems.length === 0 ? (_jsxs("div", { className: "fbs-empty", children: [_jsx("span", { children: _jsx(Search, { size: 27, "aria-hidden": "true" }) }), _jsx("strong", { children: search.trim() ? `По запросу «${search.trim()}» ничего не найдено` : 'Нет сопоставленных товаров' }), _jsx("p", { children: search.trim()
                                    ? 'Измените поисковый запрос.'
                                    : 'Проверьте штрихкоды и артикулы товаров в WMS и Wildberries.' })] })) : null] }), pageCount > 1 ? (_jsxs("div", { className: "fbs-stocks__pager", children: [_jsx("button", { type: "button", className: "button button-secondary", disabled: currentPage === 0, onClick: () => setPage((value) => Math.max(0, value - 1)), children: "\u041D\u0430\u0437\u0430\u0434" }), _jsxs("span", { children: ["\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 ", currentPage + 1, " \u0438\u0437 ", pageCount, " \u00B7 \u043D\u0430\u0439\u0434\u0435\u043D\u043E ", filteredItems.length.toLocaleString('ru-RU')] }), _jsx("button", { type: "button", className: "button button-secondary", disabled: currentPage >= pageCount - 1, onClick: () => setPage((value) => Math.min(pageCount - 1, value + 1)), children: "\u0414\u0430\u043B\u0435\u0435" })] })) : null, routingOpen ? (_jsx("div", { className: "fbs-assembly-dialog-backdrop", role: "presentation", children: _jsxs("form", { className: "fbs-assembly-dialog fbs-routing-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "fbs-routing-title", onSubmit: saveRoutingSettings, children: [_jsx("div", { className: "fbs-assembly-dialog__icon fbs-routing-dialog__icon", children: _jsx(Settings2, { size: 24, "aria-hidden": "true" }) }), _jsxs("div", { className: "fbs-assembly-dialog__heading", children: [_jsx("p", { className: "eyebrow", children: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F WB" }), _jsx("h3", { id: "fbs-routing-title", children: "\u041C\u0430\u0440\u0448\u0440\u0443\u0442\u0438\u0437\u0430\u0446\u0438\u044F FBS-\u0437\u0430\u043A\u0430\u0437\u043E\u0432" }), _jsx("p", { children: state.data?.connections.find((item) => item.id === selectedConnectionId)?.accountName || 'Wildberries' })] }), _jsxs("div", { className: "fbs-routing-dialog__fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0424\u0438\u043B\u0438\u0430\u043B \u0438\u0441\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u0432\u0441\u0435\u0445 FBS-\u0437\u0430\u043A\u0430\u0437\u043E\u0432" }), _jsxs("select", { value: routingForm.executionWarehouseId, disabled: routingLoading || routingSaving, onChange: (event) => setRoutingForm((current) => ({
                                                ...current,
                                                executionWarehouseId: event.target.value,
                                            })), children: [_jsx("option", { value: "", children: "\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u043E \u0433\u043E\u0440\u043E\u0434\u0443 \u0441\u043A\u043B\u0430\u0434\u0430 WB" }), routingBranches.map((branch) => (_jsxs("option", { value: branch.id, children: [branch.city, " \u00B7 ", branch.name, " (", branch.code, ")"] }, branch.id)))] }), _jsx("small", { children: "\u0418\u043C\u0435\u043D\u043D\u043E \u0432 \u044D\u0442\u043E\u043C \u0444\u0438\u043B\u0438\u0430\u043B\u0435 \u0440\u0435\u0437\u0435\u0440\u0432\u0438\u0440\u0443\u044E\u0442\u0441\u044F \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u0438 \u0441\u043E\u0437\u0434\u0430\u0451\u0442\u0441\u044F \u0437\u0430\u044F\u0432\u043A\u0430 \u043D\u0430 \u0441\u0431\u043E\u0440\u043A\u0443." })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041C\u0435\u0441\u0442\u043E \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0439 \u0441\u0434\u0430\u0447\u0438" }), _jsxs("select", { value: routingForm.dropoffWarehouseId, disabled: routingLoading || routingSaving, onChange: (event) => setRoutingForm((current) => ({
                                                ...current,
                                                dropoffWarehouseId: event.target.value,
                                            })), children: [_jsx("option", { value: "", children: "\u041D\u0435 \u0437\u0430\u0434\u0430\u043D\u043E" }), routingBranches.map((branch) => (_jsxs("option", { value: branch.id, children: [branch.city, " \u00B7 ", branch.name, " (", branch.code, ")"] }, branch.id)))] }), _jsx("small", { children: "\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u043E\u043D\u043D\u0430\u044F \u0442\u043E\u0447\u043A\u0430, \u043A\u0443\u0434\u0430 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043E\u0442\u0432\u043E\u0437\u0438\u0442 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0443." })] }), _jsxs("label", { className: "fbs-routing-dialog__toggle", children: [_jsx("input", { type: "checkbox", checked: routingForm.autoRouteNewWarehouses, disabled: routingLoading || routingSaving, onChange: (event) => setRoutingForm((current) => ({
                                                ...current,
                                                autoRouteNewWarehouses: event.target.checked,
                                            })) }), _jsxs("span", { children: [_jsx("strong", { children: "\u041D\u043E\u0432\u044B\u0435 \u0441\u043A\u043B\u0430\u0434\u044B WB \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u044F\u0442\u044C \u0432 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u0444\u0438\u043B\u0438\u0430\u043B" }), _jsx("small", { children: "\u0413\u043E\u0440\u043E\u0434, \u0443\u043A\u0430\u0437\u0430\u043D\u043D\u044B\u0439 \u0443 \u0441\u043A\u043B\u0430\u0434\u0430 \u043F\u0440\u043E\u0434\u0430\u0432\u0446\u0430 \u0432 WB, \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u0438\u0442 \u0444\u0438\u043B\u0438\u0430\u043B \u0438\u0441\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F." })] })] }), _jsxs("section", { className: "fbs-routing-dialog__warehouse-routes", children: [_jsxs("div", { className: "fbs-routing-dialog__warehouse-heading", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u041E\u0442\u0434\u0435\u043B\u044C\u043D\u044B\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u0434\u043B\u044F \u0441\u043A\u043B\u0430\u0434\u043E\u0432 WB" }), _jsx("small", { children: "\u0414\u043B\u044F \u043A\u0430\u0436\u0434\u043E\u0433\u043E \u0441\u043A\u043B\u0430\u0434\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435, \u0433\u0434\u0435 \u0441\u043E\u0431\u0438\u0440\u0430\u0442\u044C \u0435\u0433\u043E \u043D\u043E\u0432\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B." })] }), _jsxs("span", { children: [routingData?.warehouses.length ?? 0, " \u0441\u043A\u043B\u0430\u0434\u043E\u0432"] })] }), routingLoading ? (_jsxs("div", { className: "fbs-routing-dialog__warehouse-empty", children: [_jsx(RefreshCw, { size: 17, className: "is-spinning", "aria-hidden": "true" }), "\u041F\u043E\u043B\u0443\u0447\u0430\u044E \u0441\u043F\u0438\u0441\u043E\u043A \u0441\u043A\u043B\u0430\u0434\u043E\u0432 \u0438\u0437 WB\u2026"] })) : routingData?.warehouses.length ? (_jsx("div", { className: "fbs-routing-dialog__warehouse-list", children: routingData.warehouses.map((warehouse) => {
                                                const draft = routingDrafts[warehouse.marketplaceWarehouseId] ?? {
                                                    mode: warehouse.mode,
                                                    executionWarehouseId: warehouse.executionWarehouseId ?? '',
                                                    dropoffWarehouseId: warehouse.dropoffWarehouseId ?? '',
                                                };
                                                const selectedExecution = routingBranches.find((branch) => branch.id === (draft.mode === 'CENTRAL'
                                                    ? routingForm.executionWarehouseId
                                                    : draft.executionWarehouseId));
                                                return (_jsxs("article", { className: `fbs-routing-dialog__warehouse-row is-${draft.mode.toLowerCase()}`, children: [_jsxs("div", { className: "fbs-routing-dialog__warehouse-name", children: [_jsx(Warehouse, { size: 18, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: warehouse.marketplaceWarehouseName }), _jsxs("span", { children: [warehouse.officeCity || warehouse.officeName || 'Город не указан', ' · ', "ID ", warehouse.marketplaceWarehouseId] })] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u0445\u0435\u043C\u0430 \u0440\u0430\u0431\u043E\u0442\u044B" }), _jsxs("select", { value: draft.mode, disabled: routingSaving, onChange: (event) => {
                                                                        const mode = event.target.value;
                                                                        setRoutingDrafts((current) => ({
                                                                            ...current,
                                                                            [warehouse.marketplaceWarehouseId]: {
                                                                                ...draft,
                                                                                mode,
                                                                                executionWarehouseId: mode === 'BRANCH' ? draft.executionWarehouseId : '',
                                                                                dropoffWarehouseId: mode === 'BRANCH' ? draft.dropoffWarehouseId : '',
                                                                            },
                                                                        }));
                                                                    }, children: [_jsx("option", { value: "DEFAULT", children: "\u041F\u043E \u043E\u0431\u0449\u0435\u043C\u0443 \u043F\u0440\u0430\u0432\u0438\u043B\u0443" }), _jsx("option", { value: "CENTRAL", children: "\u0427\u0435\u0440\u0435\u0437 \u043E\u0441\u043D\u043E\u0432\u043D\u043E\u0439 \u0444\u0438\u043B\u0438\u0430\u043B" }), _jsx("option", { value: "BRANCH", children: "\u0427\u0435\u0440\u0435\u0437 \u0441\u0432\u043E\u0439 \u0444\u0438\u043B\u0438\u0430\u043B" }), _jsx("option", { value: "EXCLUDED", children: "\u041D\u0435 \u043E\u0431\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u0442\u044C \u0432 WMS" })] })] }), draft.mode === 'BRANCH' ? (_jsxs("div", { className: "fbs-routing-dialog__warehouse-branch-fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0424\u0438\u043B\u0438\u0430\u043B \u0438\u0441\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F" }), _jsxs("select", { value: draft.executionWarehouseId, disabled: routingSaving, onChange: (event) => setRoutingDrafts((current) => ({
                                                                                ...current,
                                                                                [warehouse.marketplaceWarehouseId]: {
                                                                                    ...draft,
                                                                                    executionWarehouseId: event.target.value,
                                                                                },
                                                                            })), children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u0438\u043B\u0438\u0430\u043B" }), routingBranches.map((branch) => (_jsxs("option", { value: branch.id, children: [branch.city, " \u00B7 ", branch.name, " (", branch.code, ")"] }, branch.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041C\u0435\u0441\u0442\u043E \u0441\u0434\u0430\u0447\u0438" }), _jsxs("select", { value: draft.dropoffWarehouseId, disabled: routingSaving, onChange: (event) => setRoutingDrafts((current) => ({
                                                                                ...current,
                                                                                [warehouse.marketplaceWarehouseId]: {
                                                                                    ...draft,
                                                                                    dropoffWarehouseId: event.target.value,
                                                                                },
                                                                            })), children: [_jsx("option", { value: "", children: "\u041D\u0435 \u0437\u0430\u0434\u0430\u043D\u043E" }), routingBranches.map((branch) => (_jsxs("option", { value: branch.id, children: [branch.city, " \u00B7 ", branch.name, " (", branch.code, ")"] }, branch.id)))] })] })] })) : (_jsx("div", { className: "fbs-routing-dialog__warehouse-result", children: draft.mode === 'EXCLUDED' ? (_jsxs(_Fragment, { children: [_jsx(PowerOff, { size: 16, "aria-hidden": "true" }), " \u041D\u043E\u0432\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B \u043D\u0435 \u0440\u0435\u0437\u0435\u0440\u0432\u0438\u0440\u0443\u044E\u0442\u0441\u044F"] })) : selectedExecution ? (_jsxs(_Fragment, { children: [_jsx(MapPin, { size: 16, "aria-hidden": "true" }), " ", selectedExecution.city, " \u00B7 ", selectedExecution.name] })) : (_jsxs(_Fragment, { children: [_jsx(ArrowRightLeft, { size: 16, "aria-hidden": "true" }), " \u041C\u0430\u0440\u0448\u0440\u0443\u0442 \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u044F\u0435\u0442\u0441\u044F \u043E\u0431\u0449\u0438\u043C \u043F\u0440\u0430\u0432\u0438\u043B\u043E\u043C"] })) }))] }, warehouse.marketplaceWarehouseId));
                                            }) })) : (_jsx("div", { className: "fbs-routing-dialog__warehouse-empty", children: "\u0421\u043A\u043B\u0430\u0434\u044B WB \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B \u0438\u043B\u0438 API \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D." }))] })] }), _jsx("p", { className: "fbs-routing-dialog__notice", children: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430 \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u0430 \u043D\u043E\u0432\u044B\u0435 \u0438 \u0435\u0449\u0451 \u043D\u0435 \u0440\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0451\u043D\u043D\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B. \u0423\u0436\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u043D\u044B\u0435 \u0437\u0430\u044F\u0432\u043A\u0438, \u0440\u0435\u0437\u0435\u0440\u0432\u044B \u0438 \u0441\u0431\u043E\u0440\u043A\u0438 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u044F\u0442\u0441\u044F." }), routingError ? _jsx("p", { className: "form-error fbs-routing-dialog__error", children: routingError }) : null, _jsxs("div", { className: "fbs-assembly-dialog__actions", children: [_jsx("button", { type: "button", className: "button button-secondary", onClick: () => setRoutingOpen(false), disabled: routingSaving, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsx("button", { type: "submit", className: "button button-primary", disabled: routingLoading || routingSaving, children: routingSaving ? 'Сохраняю…' : 'Сохранить маршрутизацию' })] })] }) })) : null] }));
}
const emptyFbsPassForm = {
    firstName: '',
    lastName: '',
    carModel: '',
    carNumber: '',
    officeId: '',
};
function FbsPassesView({ clientId, session }) {
    const [state, setState] = useState({
        status: 'loading',
        data: null,
        error: '',
    });
    const [connectionId, setConnectionId] = useState('');
    const [editingPass, setEditingPass] = useState(null);
    const [form, setForm] = useState(emptyFbsPassForm);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const loadPasses = useCallback(async (requestedConnectionId) => {
        setState((current) => ({ status: 'loading', data: current.data, error: '' }));
        try {
            const data = await fetchFbsPasses(session.accessToken, clientId, requestedConnectionId || undefined);
            setConnectionId(data.selectedConnectionId ?? '');
            setState({ status: 'ready', data, error: '' });
        }
        catch (caught) {
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
    function updatePassForm(field, value) {
        setForm((current) => ({ ...current, [field]: value }));
    }
    function startEditing(pass) {
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
    async function submitPass(event) {
        event.preventDefault();
        if (!connectionId || !form.officeId)
            return;
        setSaving(true);
        setMessage('');
        const payload = {
            clientId,
            connectionId,
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            carModel: form.carModel.trim(),
            carNumber: form.carNumber.trim().toUpperCase(),
            officeId: Number(form.officeId),
        };
        try {
            if (editingPass)
                await updateFbsPass(session.accessToken, editingPass.id, payload);
            else
                await createFbsPass(session.accessToken, payload);
            setMessage(editingPass ? 'Пропуск обновлён.' : 'Пропуск создан и передан в Wildberries.');
            resetPassForm();
            await loadPasses(connectionId);
        }
        catch (caught) {
            setMessage(caught instanceof Error ? caught.message : 'Не удалось сохранить пропуск.');
        }
        finally {
            setSaving(false);
        }
    }
    async function removePass(pass) {
        if (!window.confirm(`Удалить пропуск для автомобиля ${pass.carNumber}?`))
            return;
        setSaving(true);
        setMessage('');
        try {
            await deleteFbsPass(session.accessToken, pass.id, clientId, connectionId);
            if (editingPass?.id === pass.id)
                resetPassForm();
            setMessage('Пропуск удалён.');
            await loadPasses(connectionId);
        }
        catch (caught) {
            setMessage(caught instanceof Error ? caught.message : 'Не удалось удалить пропуск.');
        }
        finally {
            setSaving(false);
        }
    }
    const data = state.data;
    if (state.status === 'loading' && !data) {
        return _jsx(FbsNotice, { icon: RefreshCw, title: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430", text: "\u041F\u043E\u043B\u0443\u0447\u0430\u0435\u043C \u0441\u043A\u043B\u0430\u0434\u044B \u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0435 \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430 \u0438\u0437 Wildberries." });
    }
    if (state.status === 'error' && !data) {
        return _jsx(FbsNotice, { icon: AlertTriangle, title: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430", text: state.error, tone: "error" });
    }
    if (!data?.selectedConnectionId) {
        return _jsx(FbsNotice, { icon: CarFront, title: "\u041D\u0435\u0442 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F Wildberries", text: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0435 API Wildberries \u0434\u043B\u044F \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0430." });
    }
    return (_jsxs("div", { className: "fbs-passes", children: [_jsxs("div", { className: "fbs-passes__intro", children: [_jsxs("div", { children: [_jsx(CarFront, { size: 22, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u041F\u0440\u043E\u043F\u0443\u0441\u043A\u0430 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u044B WB" }), _jsx("span", { children: "\u0414\u0430\u043D\u043D\u044B\u0435 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u0443\u044E\u0442\u0441\u044F \u043D\u0430\u043F\u0440\u044F\u043C\u0443\u044E \u0441 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u043E\u043C Wildberries." })] })] }), data.connections.length > 1 ? (_jsxs("label", { children: ["\u041A\u0430\u0431\u0438\u043D\u0435\u0442", _jsx("select", { value: connectionId, onChange: (event) => void loadPasses(event.target.value), children: data.connections.map((connection) => _jsx("option", { value: connection.id, children: connection.accountName || 'Wildberries' }, connection.id)) })] })) : null] }), _jsxs("form", { className: "fbs-passes__form", onSubmit: submitPass, children: [_jsx("h3", { children: editingPass ? `Изменить пропуск №${editingPass.id}` : 'Новый пропуск' }), _jsxs("label", { children: ["\u0418\u043C\u044F", _jsx("input", { required: true, value: form.firstName, onChange: (event) => updatePassForm('firstName', event.target.value) })] }), _jsxs("label", { children: ["\u0424\u0430\u043C\u0438\u043B\u0438\u044F", _jsx("input", { required: true, value: form.lastName, onChange: (event) => updatePassForm('lastName', event.target.value) })] }), _jsxs("label", { children: ["\u041C\u043E\u0434\u0435\u043B\u044C \u0430\u0432\u0442\u043E\u043C\u043E\u0431\u0438\u043B\u044F", _jsx("input", { required: true, value: form.carModel, onChange: (event) => updatePassForm('carModel', event.target.value) })] }), _jsxs("label", { children: ["\u0413\u043E\u0441\u043D\u043E\u043C\u0435\u0440", _jsx("input", { required: true, value: form.carNumber, onChange: (event) => updatePassForm('carNumber', event.target.value), placeholder: "\u0410123\u0412\u042177" })] }), _jsxs("label", { children: ["\u0421\u043A\u043B\u0430\u0434 WB", _jsxs("select", { required: true, value: form.officeId, onChange: (event) => updatePassForm('officeId', event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u043A\u043B\u0430\u0434" }), data.offices.map((office) => _jsxs("option", { value: office.id, children: [office.name, " \u00B7 ", office.address] }, office.id))] })] }), _jsxs("div", { className: "fbs-passes__form-actions", children: [_jsx("button", { className: "button button-primary", type: "submit", disabled: saving, children: saving ? 'Сохраняю…' : editingPass ? 'Сохранить' : 'Создать пропуск' }), editingPass ? _jsx("button", { className: "button button-secondary", type: "button", onClick: resetPassForm, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }) : null] })] }), message ? _jsx("p", { className: "fbs-passes__message", children: message }) : null, _jsx("div", { className: "fbs-passes__list", children: data.passes.length === 0 ? _jsx("p", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0445 \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u043E\u0432 \u043D\u0435\u0442." }) : data.passes.map((pass) => (_jsxs("article", { children: [_jsxs("div", { children: [_jsxs("strong", { children: [pass.carNumber, " \u00B7 ", pass.carModel] }), _jsxs("span", { children: [pass.firstName, " ", pass.lastName] }), _jsxs("span", { children: [pass.officeName || `Склад №${pass.officeId}`, " \u00B7 \u0434\u043E ", formatDateTime(pass.dateEnd)] })] }), _jsxs("div", { children: [_jsx("button", { type: "button", className: "button button-secondary", disabled: saving, onClick: () => startEditing(pass), children: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C" }), _jsx("button", { type: "button", className: "button button-secondary fbs-order-actions__danger", disabled: saving, onClick: () => void removePass(pass), children: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C" })] })] }, pass.id))) })] }));
}
function FbsCargoPackingView({ state, search, canManage, actionId, onToggleIgnored, }) {
    if (state.status === 'loading' && !state.data) {
        return _jsx(FbsNotice, { icon: RefreshCw, title: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043A\u043E\u0440\u043E\u0431\u0430 WMS", text: "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E \u0443\u043F\u0430\u043A\u043E\u0432\u043A\u0443 \u043F\u043E\u0441\u0442\u0430\u0432\u043E\u043A FBS." });
    }
    if (state.status === 'error' && !state.data) {
        return _jsx(FbsNotice, { icon: AlertTriangle, title: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0433\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442\u0430", text: state.error, tone: "error" });
    }
    const query = search.trim().toLowerCase();
    const supplies = (state.data?.supplies ?? []).filter((supply) => {
        if (!query)
            return true;
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
        return (_jsx(FbsNotice, { icon: Boxes, title: query ? 'Поиск ничего не нашёл' : 'Нет поставок для упаковки', text: query ? 'Измените номер заказа, поставки, короба WMS, грузоместа или ШК.' : 'Здесь появятся короба WMS и грузоместа WB, отсканированные при упаковке FBS.' }));
    }
    return (_jsxs("div", { className: "fbs-cargo-supplies", children: [state.error ? _jsx("p", { className: "fbs-order-actions__error", children: state.error }) : null, supplies.map((supply) => {
                const isWmsBoxes = supply.packingMode === 'SORTING_CENTER_BOX';
                const requestLabel = (supply.requestNumbers ?? [])
                    .map((number) => `№${String(number).padStart(6, '0')}`)
                    .join(', ');
                return (_jsxs("details", { className: `fbs-cargo-supply${supply.readyToDeliver ? ' is-ready' : ''}${supply.ignored ? ' is-ignored' : ''}`, open: !supply.readyToDeliver && !supply.ignored, children: [_jsxs("summary", { children: [_jsxs("span", { children: [_jsxs("strong", { children: ["\u041F\u043E\u0441\u0442\u0430\u0432\u043A\u0430 ", supply.supplyId] }), _jsxs("small", { children: [requestLabel ? `Заявка WMS ${requestLabel} · ` : '', supply.client.code, " \u00B7 ", supply.client.name, " \u00B7 ", isWmsBoxes ? 'Короба WMS' : 'Грузоместа WB'] })] }), _jsxs("span", { className: "fbs-cargo-supply__progress", children: [_jsxs("strong", { children: [supply.packedItems, " / ", supply.totalPlannedItems, " \u0435\u0434."] }), _jsxs("small", { children: [supply.closedCargoPlaces, " / ", supply.cargoPlaceCount, " ", isWmsBoxes ? 'коробов WMS закрыто' : 'грузомест закрыто'] })] }), _jsx("span", { className: `fbs-status ${supply.ignored ? 'fbs-status--ignored' : supply.readyToDeliver ? 'fbs-status--shipped' : 'fbs-status--active'}`, children: supply.ignored
                                        ? 'Игнорируется'
                                        : supply.readyToDeliver
                                            ? 'Готова к передаче WB'
                                            : supply.waitingAssembly > 0
                                                ? `Ещё собирается: ${supply.waitingAssembly}`
                                                : `Разложить: ${supply.remainingToPack}` })] }), _jsxs("div", { className: "fbs-cargo-places", children: [canManage ? (_jsxs("div", { className: "fbs-cargo-supply__admin", children: [_jsx("span", { children: supply.ignored
                                                ? `Игнорирование включил: ${supply.ignoredByName || 'администратор'}${supply.ignoredAt ? ` · ${formatDateTime(supply.ignoredAt)}` : ''}${supply.ignoreReason ? ` · ${supply.ignoreReason}` : ''}`
                                                : 'Поставка участвует в рабочей очереди упаковки FBS.' }), _jsx("button", { type: "button", className: `button button-secondary${supply.ignored ? '' : ' fbs-cargo-supply__ignore-button'}`, disabled: actionId !== null, onClick: () => void onToggleIgnored(supply.id, !supply.ignored), children: actionId === supply.id
                                                ? 'Сохраняю…'
                                                : supply.ignored
                                                    ? 'Вернуть в работу'
                                                    : 'Игнорировать' })] })) : null, supply.cargoPlaces.map((place, index) => (_jsxs("details", { className: `fbs-cargo-place fbs-cargo-place--${place.status.toLowerCase()}`, children: [_jsxs("summary", { children: [_jsx("span", { className: "fbs-cargo-place__number", children: index + 1 }), _jsxs("span", { children: [_jsx("strong", { children: place.cargoPlaceId }), _jsx("small", { className: "fbs-mono", children: isWmsBoxes ? 'Физический короб WMS' : place.cargoPlaceBarcode || 'QR ещё не сканировался' })] }), _jsxs("span", { children: [_jsxs("strong", { children: [place.packedItems, " \u0435\u0434. \u00B7 \u0431\u0435\u0437 \u043B\u0438\u043C\u0438\u0442\u0430"] }), _jsx("small", { children: place.status === 'CLOSED'
                                                                ? `Закрыто · ${place.closedByName || place.deviceCode || 'ТСД'}`
                                                                : place.status === 'OPEN'
                                                                    ? `Открыто · ${place.openedByName || place.deviceCode || 'ТСД'}`
                                                                    : 'Не начато' })] })] }), place.orders.length > 0 ? (_jsx("div", { className: "fbs-table-wrap fbs-cargo-place__table", children: _jsxs("table", { className: "fbs-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0417\u0430\u043A\u0430\u0437 WB" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0428\u041A \u0442\u043E\u0432\u0430\u0440\u0430" }), _jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431 WMS" }), _jsx("th", { children: "\u041D\u0430\u043A\u043B\u0435\u0439\u043A\u0430 WB" }), _jsx("th", { children: "\u0423\u043F\u0430\u043A\u043E\u0432\u0430\u043B" })] }) }), _jsx("tbody", { children: place.orders.map((order) => (_jsxs("tr", { children: [_jsx("td", { children: _jsxs("strong", { children: ["\u2116 ", order.orderId] }) }), _jsxs("td", { children: [_jsx("strong", { children: order.productName }), _jsx("small", { children: [order.article, order.color, order.size ? `размер ${order.size}` : null]
                                                                                .filter(Boolean)
                                                                                .join(' · ') || '—' })] }), _jsx("td", { children: _jsx("span", { className: "fbs-mono", children: order.productBarcode || '—' }) }), _jsx("td", { children: _jsx("span", { className: "fbs-mono", children: order.sourceBoxCode || '—' }) }), _jsxs("td", { children: [_jsx("strong", { children: order.wbStickerPartB || '—' }), _jsx("small", { className: "fbs-mono", children: order.wbStickerBarcode || '—' })] }), _jsxs("td", { children: [_jsx("strong", { children: order.packedByName || 'ТСД' }), _jsx("small", { children: formatDateTime(order.packedAt) })] })] }, order.orderId))) })] }) })) : (_jsxs("p", { className: "fbs-cargo-place__empty", children: ["\u041D\u0430 \u0422\u0421\u0414 \u0435\u0449\u0451 \u043D\u0435 \u043E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D \u043D\u0438 \u043E\u0434\u0438\u043D ", isWmsBoxes ? 'товар в этот короб WMS' : 'заказ', "."] }))] }, place.cargoPlaceId)))] })] }, supply.id));
            })] }));
}
function FbsOrdersView({ data, search, view, selectedOrderKeys, onSelectionChange, orderAction, rowActionKey, actionMessage, actionError, onAssemble, onReship, onDeliver, onChangeDestination, onMoveToNewSupply, onCancel, onRemoveCancelledOrder, onDownloadStickers, onDownloadCargoStickers, onDownloadSupplyStickers, onDownloadPickList, canDownloadPickList, canEnableEmergencyAssembly, onEnableEmergencyAssembly, onCreateRequest, syncAudit, syncAuditBusy, onRunSynchronizationAudit, onCloseSynchronizationAudit, }) {
    const [expandedGroupKeys, setExpandedGroupKeys] = useState(() => new Set());
    const [ordersLayout, setOrdersLayout] = useState('all');
    const [selectedWarehouseKey, setSelectedWarehouseKey] = useState('all');
    const [hiddenWaitingStockKeys, setHiddenWaitingStockKeys] = useState(() => new Set());
    const [quickSelectCount, setQuickSelectCount] = useState('28');
    const [orderSort, setOrderSort] = useState('date-oldest');
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
    const hasWildberriesWarehouseFilter = orders.some((order) => order.marketplace === 'WILDBERRIES');
    const warehouseGroupKeys = warehouseGroups.map((group) => group.key).join('|');
    useEffect(() => {
        if (selectedWarehouseKey !== 'all' &&
            !warehouseGroups.some((group) => group.key === selectedWarehouseKey)) {
            setSelectedWarehouseKey('all');
        }
    }, [selectedWarehouseKey, warehouseGroupKeys]);
    const warehouseScopedOrders = ordersLayout === 'warehouses' && selectedWarehouseKey !== 'all'
        ? orders.filter((order) => fbsOrderWarehouseKey(order) === selectedWarehouseKey)
        : orders;
    const dateScopedOrders = view === 'shipped'
        ? filterFbsShippedOrdersByDate(warehouseScopedOrders, shippedDateFrom, shippedDateTo)
        : warehouseScopedOrders;
    const normalizedSearch = search.trim().toLowerCase();
    const requestedRequestNumber = parseFbsRequestSearch(search);
    const searchedOrders = requestedRequestNumber !== null
        ? dateScopedOrders.filter((order) => order.request?.number === requestedRequestNumber)
        : normalizedSearch
            ? dateScopedOrders.filter((order) => [
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
                order.request?.id,
                order.request?.number,
                order.request?.title,
                ...order.barcodes,
                ...order.storageBoxes.map((box) => box.code),
            ]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(normalizedSearch)))
            : dateScopedOrders;
    const hiddenWaitingStockCount = searchedOrders.filter((order) => hiddenWaitingStockKeys.has(fbsOrderSelectionKey(order))).length;
    const visibleOrders = searchedOrders.filter((order) => !hiddenWaitingStockKeys.has(fbsOrderSelectionKey(order)));
    const readOnlyView = view === 'archive' || view === 'cancelled';
    const orderGroups = groupFbsOrdersBySupply(visibleOrders, view, orderSort);
    const orderGroupKeys = orderGroups.map((group) => group.key).join('|');
    useEffect(() => {
        if (!normalizedSearch)
            return;
        setExpandedGroupKeys(new Set(orderGroups.map((group) => group.key)));
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
    const assemblyOrders = selectedOrders.filter((order) => (order.marketplace === 'WILDBERRIES' && order.supplierStatus === 'new') ||
        (order.marketplace === 'OZON' && order.supplierStatus === 'awaiting_packaging'));
    const reshipOrders = selectedOrders.filter((order) => order.marketplace === 'WILDBERRIES' && order.requiresReshipment);
    const deliverOrders = selectedOrders.filter((order) => order.marketplace === 'WILDBERRIES' && order.supplierStatus === 'confirm' && Boolean(order.supplyId));
    const cancelOrders = selectedOrders.filter((order) => order.marketplace === 'WILDBERRIES' && ['new', 'confirm'].includes(order.supplierStatus));
    const changeDestinationOrders = selectedOrders.filter((order) => order.marketplace === 'WILDBERRIES' &&
        order.supplierStatus === 'confirm' &&
        Boolean(order.supplyId) &&
        fbsOrderRequiresCargoPlaces(order, data?.deliveryPlan.requiresCargoPlaces === true));
    const changeDestinationSupplyCount = new Set(changeDestinationOrders.map((order) => `${order.connectionId}:${order.supplyId}`)).size;
    const moveOrders = selectedOrders.filter(isFbsOrderMoveCandidate);
    const selectedMoveWarehouseKeys = new Set(moveOrders.map((order) => `${order.connectionId}:${order.marketplace}:${order.warehouseId || order.officeId || 'unknown'}`));
    const canMoveSelectedOrders = selectedOrders.length > 0 &&
        moveOrders.length === selectedOrders.length &&
        selectedMoveWarehouseKeys.size === 1;
    const selectedMoveRequestCount = new Set(moveOrders.map((order) => order.request?.id || `supply:${order.supplyId || order.id}`)).size;
    const stickerOrders = selectedOrders.filter(fbsOrderStickerIsAvailable);
    const cargoStickerOrders = selectedOrders.filter((order) => fbsOrderRequiresCargoPlaces(order, data?.deliveryPlan.requiresCargoPlaces === true) &&
        order.marketplace === 'WILDBERRIES' &&
        order.supplierStatus === 'confirm' &&
        Boolean(order.supplyId));
    const supplyStickerOrders = selectedOrders.filter((order) => !fbsOrderRequiresCargoPlaces(order, data?.deliveryPlan.requiresCargoPlaces === true) &&
        order.marketplace === 'WILDBERRIES' &&
        order.supplierStatus === 'complete' &&
        Boolean(order.supplyId));
    const requestOrders = selectedOrders.filter((order) => order.category === 'active' && (!order.request || order.request.status === 'CANCELLED'));
    const requestEligibleOrders = visibleOrders.filter((order) => order.category === 'active' && (!order.request || order.request.status === 'CANCELLED'));
    const unselectedRequestOrders = requestEligibleOrders.filter((order) => !selectedOrderKeys.has(fbsOrderSelectionKey(order)));
    const parsedQuickSelectCount = Math.max(0, Math.trunc(Number(quickSelectCount) || 0));
    const allVisibleSelected = bulkSelectableKeys.length > 0 && bulkSelectableKeys.every((key) => selectedOrderKeys.has(key));
    function toggleAllVisible() {
        const next = new Set(selectedOrderKeys);
        visibleKeys.forEach((key) => next.delete(key));
        if (!allVisibleSelected)
            bulkSelectableKeys.forEach((key) => next.add(key));
        onSelectionChange(next);
    }
    function toggleOrder(order) {
        const key = fbsOrderSelectionKey(order);
        const next = new Set(selectedOrderKeys);
        if (next.has(key))
            next.delete(key);
        else
            next.add(key);
        onSelectionChange(next);
    }
    function selectNextRequestOrders(count) {
        const safeCount = Math.max(0, Math.trunc(count));
        if (safeCount === 0)
            return;
        const next = new Set(selectedOrderKeys);
        unselectedRequestOrders
            .slice(0, safeCount)
            .forEach((order) => next.add(fbsOrderSelectionKey(order)));
        onSelectionChange(next);
    }
    function toggleGroup(groupKey) {
        setExpandedGroupKeys((current) => {
            const next = new Set(current);
            if (next.has(groupKey))
                next.delete(groupKey);
            else
                next.add(groupKey);
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
    return (_jsxs(_Fragment, { children: [_jsxs("section", { className: "fbs-warehouse-board", "aria-label": "\u041F\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0437\u0430\u043A\u0430\u0437\u043E\u0432 FBS", children: [_jsxs("header", { className: "fbs-warehouse-board__header", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041C\u0430\u0440\u0448\u0440\u0443\u0442\u0438\u0437\u0430\u0446\u0438\u044F FBS" }), _jsx("strong", { children: "\u0417\u0430\u043A\u0430\u0437\u044B \u043F\u043E \u0432\u0438\u0440\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u043C \u0441\u043A\u043B\u0430\u0434\u0430\u043C \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0430" }), _jsx("span", { children: "\u0424\u0438\u0437\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0441\u0431\u043E\u0440\u043A\u0430 \u0438 \u0441\u0434\u0430\u0447\u0430 \u043E\u0441\u0442\u0430\u044E\u0442\u0441\u044F \u0432 \u041C\u043E\u0441\u043A\u0432\u0435. \u0421\u043A\u043B\u0430\u0434 \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0430 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0434\u043B\u044F \u0440\u0430\u0437\u0434\u0435\u043B\u0435\u043D\u0438\u044F \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u0438 \u043F\u043E\u0441\u0442\u0430\u0432\u043E\u043A." })] }), _jsxs("div", { className: "fbs-warehouse-board__switch", role: "group", "aria-label": "\u0412\u0438\u0434 \u0441\u043F\u0438\u0441\u043A\u0430 \u0437\u0430\u043A\u0430\u0437\u043E\u0432", children: [_jsx("button", { type: "button", className: ordersLayout === 'all' ? 'is-active' : undefined, onClick: () => {
                                            setOrdersLayout('all');
                                            setSelectedWarehouseKey('all');
                                        }, children: "\u0412\u0441\u0435 \u0437\u0430\u043A\u0430\u0437\u044B" }), _jsxs("button", { type: "button", className: ordersLayout === 'warehouses' ? 'is-active' : undefined, onClick: () => setOrdersLayout('warehouses'), children: ["\u041F\u043E \u0441\u043A\u043B\u0430\u0434\u0430\u043C ", marketplaceBoardLabel] })] }), _jsxs("button", { type: "button", className: "fbs-sync-audit-button", onClick: () => void onRunSynchronizationAudit(), disabled: syncAuditBusy || !data?.connected, title: "\u0421\u0432\u0435\u0440\u0438\u0442\u044C \u0441\u0442\u0430\u0442\u0443\u0441\u044B \u0437\u0430\u044F\u0432\u043E\u043A WMS \u0441 \u0430\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u043C\u0438 \u0441\u0442\u0430\u0442\u0443\u0441\u0430\u043C\u0438 \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0430", children: [_jsx(RefreshCw, { className: syncAuditBusy ? 'is-spinning' : undefined, size: 16, "aria-hidden": "true" }), syncAuditBusy ? 'Проверяю…' : 'Проверить рассинхронизацию'] })] }), hasWildberriesWarehouseFilter ? (_jsxs("label", { className: "fbs-warehouse-board__filter", children: [_jsx("span", { children: "\u0424\u0438\u043B\u044C\u0442\u0440 \u0441\u043A\u043B\u0430\u0434\u0430 WB" }), _jsxs("select", { value: selectedWarehouseKey, onChange: (event) => {
                                    const nextWarehouseKey = event.target.value;
                                    setSelectedWarehouseKey(nextWarehouseKey);
                                    setOrdersLayout(nextWarehouseKey === 'all' ? 'all' : 'warehouses');
                                }, children: [_jsx("option", { value: "all", children: "\u0412\u0441\u0435 \u0441\u043A\u043B\u0430\u0434\u044B WB" }), warehouseGroups.map((group) => (_jsxs("option", { value: group.key, children: [group.label, " \u00B7 ", group.orders.length, " \u0437\u0430\u043A\u0430\u0437(\u0430/\u043E\u0432)"] }, group.key)))] }), selectedWarehouseKey !== 'all' ? _jsx("small", { children: "\u00AB\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u0435\u00BB \u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0435 \u0437\u0430\u044F\u0432\u043A\u0438 \u0440\u0430\u0431\u043E\u0442\u0430\u044E\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0441 \u0437\u0430\u043A\u0430\u0437\u0430\u043C\u0438 \u044D\u0442\u043E\u0433\u043E \u0441\u043A\u043B\u0430\u0434\u0430." }) : null] })) : null, ordersLayout === 'warehouses' ? (_jsxs("div", { className: "fbs-warehouse-tiles", children: [_jsxs("button", { type: "button", className: `fbs-warehouse-tile${selectedWarehouseKey === 'all' ? ' is-active' : ''}`, onClick: () => setSelectedWarehouseKey('all'), children: [_jsx("span", { className: "fbs-warehouse-tile__icon", children: _jsx(Boxes, { size: 19, "aria-hidden": "true" }) }), _jsxs("span", { className: "fbs-warehouse-tile__content", children: [_jsxs("strong", { children: ["\u0412\u0441\u0435 \u0441\u043A\u043B\u0430\u0434\u044B ", marketplaceBoardLabel] }), _jsx("small", { children: "\u0421\u0431\u043E\u0440\u043A\u0430: \u041C\u043E\u0441\u043A\u0432\u0430 \u00B7 \u0441\u0434\u0430\u0447\u0430: \u041C\u043E\u0441\u043A\u0432\u0430" }), _jsxs("span", { children: [orders.length, " \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u00B7 ", orders.reduce((sum, order) => sum + Math.max(1, order.itemCount), 0), " \u0442\u043E\u0432\u0430\u0440\u043E\u0432"] })] })] }), warehouseGroups.map((group) => (_jsxs("button", { type: "button", className: `fbs-warehouse-tile${selectedWarehouseKey === group.key ? ' is-active' : ''}${group.isUnknown ? ' is-warning' : ''}`, onClick: () => setSelectedWarehouseKey(group.key), children: [_jsx("span", { className: "fbs-warehouse-tile__icon", children: _jsx(Warehouse, { size: 19, "aria-hidden": "true" }) }), _jsxs("span", { className: "fbs-warehouse-tile__content", children: [_jsx("strong", { children: group.label }), _jsx("small", { children: "\u0421\u0431\u043E\u0440\u043A\u0430: \u041C\u043E\u0441\u043A\u0432\u0430 \u00B7 \u0441\u0434\u0430\u0447\u0430: \u041C\u043E\u0441\u043A\u0432\u0430" }), _jsxs("span", { children: [group.orders.length, " \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u00B7 ", group.itemCount, " \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u00B7 ", group.supplyCount, " \u043F\u043E\u0441\u0442\u0430\u0432\u043E\u043A"] }), group.criticalCount > 0 ? _jsxs("em", { children: ["\u041F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043E: ", group.criticalCount] }) : null] })] }, group.key)))] })) : null, hiddenWaitingStockCount > 0 ? (_jsxs("div", { className: "fbs-warehouse-board__hidden", children: [_jsxs("span", { children: ["\u0421\u043A\u0440\u044B\u0442\u043E \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E: ", hiddenWaitingStockCount] }), _jsx("button", { type: "button", onClick: () => setHiddenWaitingStockKeys(new Set()), children: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0441\u043A\u0440\u044B\u0442\u044B\u0435 \u0438\u0437 \u0432\u0438\u0434\u0443" })] })) : null] }), syncAudit ? (_jsxs("section", { className: `fbs-sync-audit${syncAudit.issues.length > 0 ? ' is-warning' : ' is-ok'}`, "aria-live": "polite", children: [_jsxs("div", { className: "fbs-sync-audit__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0441\u0442\u0430\u0442\u0443\u0441\u043E\u0432" }), _jsx("strong", { children: syncAudit.issues.length > 0
                                            ? `Найдено расхождений: ${syncAudit.issues.length}`
                                            : 'Расхождений между WMS и маркетплейсом не найдено' }), _jsxs("small", { children: ["\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E \u0437\u0430\u044F\u0432\u043E\u043A: ", syncAudit.checkedRequests, " \u00B7 \u0437\u0430\u043A\u0430\u0437\u043E\u0432: ", syncAudit.checkedOrders] })] }), _jsx("button", { type: "button", onClick: onCloseSynchronizationAudit, "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438", children: _jsx(XCircle, { size: 18, "aria-hidden": "true" }) })] }), syncAudit.issues.length > 0 ? (_jsx("div", { className: "fbs-sync-audit__list", children: syncAudit.issues.map((issue) => (_jsxs("article", { children: [_jsx(AlertTriangle, { size: 19, "aria-hidden": "true" }), _jsxs("div", { children: [_jsxs("strong", { children: ["\u0417\u0430\u044F\u0432\u043A\u0430 \u2116", String(issue.requestNumber).padStart(6, '0'), " \u00B7 ", issue.requestTitle] }), _jsxs("span", { children: ["WMS: ", fbsRequestStatusLabel(issue.wmsStatus), " \u00B7 WB: \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 ", issue.activeOrders, ", \u043E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u0445 ", issue.shippedOrders, ", \u043E\u0442\u043C\u0435\u043D\u0451\u043D\u043D\u044B\u0445 ", issue.cancelledOrders, "."] }), _jsx("small", { children: issue.kind === 'WMS_OPEN_MARKETPLACE_FINISHED'
                                                ? 'В WMS заявка ещё открыта, но все её заказы завершены в маркетплейсе. В ТСД её отправлять нельзя.'
                                                : 'WMS считает заявку закрытой, но в маркетплейсе ещё есть активные заказы. Проверьте их до закрытия.' })] })] }, issue.requestId))) })) : null] })) : null, view === 'shipped' ? (_jsxs("section", { className: "fbs-shipped-date-filter", "aria-label": "\u0424\u0438\u043B\u044C\u0442\u0440 \u043E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u0445 \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u043F\u043E \u0434\u0430\u0442\u0435", children: [_jsxs("div", { className: "fbs-shipped-date-filter__title", children: [_jsx(CalendarDays, { size: 18, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u0414\u0430\u0442\u0430 \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0438" }), _jsx("small", { children: "\u0417\u0430\u043A\u0430\u0437\u044B \u043D\u0438\u0436\u0435 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u0441\u0432\u0451\u0440\u043D\u0443\u0442\u044B \u043F\u043E \u0434\u043D\u044F\u043C." })] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421 \u0434\u0430\u0442\u044B" }), _jsx("input", { type: "date", value: shippedDateFrom, onChange: (event) => setShippedDateFrom(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E \u0434\u0430\u0442\u0443" }), _jsx("input", { type: "date", value: shippedDateTo, onChange: (event) => setShippedDateTo(event.target.value) })] }), _jsx("button", { type: "button", className: "button button-secondary", disabled: !shippedDateFrom && !shippedDateTo, onClick: () => { setShippedDateFrom(''); setShippedDateTo(''); }, children: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0434\u0430\u0442\u044B" })] })) : null, _jsx("div", { className: "fbs-order-sort", children: _jsxs("label", { children: [_jsx("span", { children: "\u0421\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043A\u0430 \u0437\u0430\u043A\u0430\u0437\u043E\u0432" }), _jsxs("select", { value: orderSort, onChange: (event) => setOrderSort(event.target.value), children: [_jsx("option", { value: "date-oldest", children: "\u041F\u043E \u0434\u0430\u0442\u0435 \u2014 \u0441\u0442\u0430\u0440\u044B\u0435 \u0441\u0432\u0435\u0440\u0445\u0443" }), _jsx("option", { value: "date-newest", children: "\u041F\u043E \u0434\u0430\u0442\u0435 \u2014 \u043D\u043E\u0432\u044B\u0435 \u0441\u0432\u0435\u0440\u0445\u0443" }), _jsx("option", { value: "order-asc", children: "\u041F\u043E \u043D\u043E\u043C\u0435\u0440\u0443 \u0437\u0430\u043A\u0430\u0437\u0430 \u2014 \u043F\u043E \u0432\u043E\u0437\u0440\u0430\u0441\u0442\u0430\u043D\u0438\u044E" }), _jsx("option", { value: "order-desc", children: "\u041F\u043E \u043D\u043E\u043C\u0435\u0440\u0443 \u0437\u0430\u043A\u0430\u0437\u0430 \u2014 \u043F\u043E \u0443\u0431\u044B\u0432\u0430\u043D\u0438\u044E" }), _jsx("option", { value: "request-asc", children: "\u041F\u043E \u043D\u043E\u043C\u0435\u0440\u0443 \u0437\u0430\u044F\u0432\u043A\u0438 WMS \u2014 \u043F\u043E \u0432\u043E\u0437\u0440\u0430\u0441\u0442\u0430\u043D\u0438\u044E" }), _jsx("option", { value: "request-desc", children: "\u041F\u043E \u043D\u043E\u043C\u0435\u0440\u0443 \u0437\u0430\u044F\u0432\u043A\u0438 WMS \u2014 \u043F\u043E \u0443\u0431\u044B\u0432\u0430\u043D\u0438\u044E" }), _jsx("option", { value: "warehouse-asc", children: "\u041F\u043E \u0441\u043A\u043B\u0430\u0434\u0443 \u2014 \u0410\u2013\u042F" }), _jsx("option", { value: "warehouse-desc", children: "\u041F\u043E \u0441\u043A\u043B\u0430\u0434\u0443 \u2014 \u042F\u2013\u0410" }), _jsx("option", { value: "status-asc", children: "\u041F\u043E \u0441\u0442\u0430\u0442\u0443\u0441\u0443 \u2014 \u0410\u2013\u042F" }), _jsx("option", { value: "status-desc", children: "\u041F\u043E \u0441\u0442\u0430\u0442\u0443\u0441\u0443 \u2014 \u042F\u2013\u0410" })] })] }) }), _jsxs("div", { className: "fbs-order-summary", children: [_jsxs("article", { children: [_jsx(Boxes, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: "\u0417\u0430\u043A\u0430\u0437\u043E\u0432" }), _jsx("strong", { children: visibleOrders.length })] }), _jsxs("article", { children: [_jsx(ShoppingBasket, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: "\u0422\u043E\u0432\u0430\u0440\u043E\u0432" }), _jsx("strong", { children: itemsCount })] }), _jsxs("article", { children: [_jsx(CircleCheckBig, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: view === 'active' ? 'В коробах' : 'С актуальным статусом' }), _jsx("strong", { children: view === 'active'
                                    ? visibleOrders.filter((order) => order.storageBoxes.length > 0).length
                                    : visibleOrders.length })] })] }), !readOnlyView && visibleOrders.length > 0 ? (_jsxs("div", { className: "fbs-order-actions", children: [_jsxs("div", { className: "fbs-order-actions__selection", children: [_jsxs("strong", { children: ["\u0412\u044B\u0431\u0440\u0430\u043D\u043E: ", selectedOrders.length] }), _jsx("span", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u0430\u043A\u0430\u0437\u044B \u0438 \u043D\u0443\u0436\u043D\u044B\u0439 \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0442 \u043F\u0435\u0447\u0430\u0442\u0438: \u041F\u0412\u0417 \u0438\u043B\u0438 \u0441\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043E\u0447\u043D\u044B\u0439 \u0446\u0435\u043D\u0442\u0440." }), view === 'active' ? (_jsxs("div", { className: "fbs-order-actions__quick-select", children: [_jsx("button", { type: "button", onClick: () => selectNextRequestOrders(28), disabled: unselectedRequestOrders.length === 0 || orderAction !== null, children: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0435 28" }), _jsxs("label", { children: [_jsx("span", { children: "\u0418\u043B\u0438 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("input", { type: "number", min: "1", max: Math.max(1, unselectedRequestOrders.length), step: "1", inputMode: "numeric", value: quickSelectCount, onChange: (event) => setQuickSelectCount(event.target.value), onKeyDown: (event) => {
                                                    if (event.key === 'Enter')
                                                        selectNextRequestOrders(parsedQuickSelectCount);
                                                } })] }), _jsx("button", { type: "button", onClick: () => selectNextRequestOrders(parsedQuickSelectCount), disabled: parsedQuickSelectCount < 1 ||
                                            unselectedRequestOrders.length === 0 ||
                                            orderAction !== null, children: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C" }), _jsxs("small", { children: ["\u041D\u0435 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u044B \u0432 \u0437\u0430\u044F\u0432\u043A\u0438 WMS: ", unselectedRequestOrders.length] })] })) : null] }), _jsxs("div", { className: "fbs-order-actions__buttons", children: [view === 'active' ? (_jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: "button button-primary", disabled: assemblyOrders.length === 0 || orderAction !== null, onClick: () => void onAssemble(assemblyOrders), children: [_jsx(ListChecks, { size: 16, "aria-hidden": "true" }), orderAction === 'assemble'
                                                ? 'Передаю…'
                                                : assemblyOrders.length > 0 && assemblyOrders.every((order) => order.marketplace === 'OZON')
                                                    ? `Передать в Ozon (${assemblyOrders.length})`
                                                    : `Собрать (${assemblyOrders.length})`] }), hasWildberriesOrders ? _jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: "button button-secondary", disabled: reshipOrders.length === 0 || orderAction !== null, onClick: () => void onReship(reshipOrders), children: [_jsx(RotateCcw, { size: 16, "aria-hidden": "true" }), orderAction === 'reship' ? 'Переотгружаю…' : `Переотгрузить (${reshipOrders.length})`] }), _jsxs("button", { type: "button", className: "button button-secondary", disabled: deliverOrders.length === 0 || orderAction !== null, onClick: () => void onDeliver(deliverOrders), children: [_jsx(Send, { size: 16, "aria-hidden": "true" }), orderAction === 'deliver' ? 'Передаю…' : `Передать WB (${deliverOrders.length})`] }), _jsxs("button", { type: "button", className: "button button-secondary fbs-order-actions__change-destination", disabled: changeDestinationOrders.length === 0 || orderAction !== null, onClick: () => void onChangeDestination(changeDestinationOrders), title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0433\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442\u0430 \u041F\u0412\u0417 \u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u044D\u0442\u0443 \u0436\u0435 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0443 \u0434\u043B\u044F \u0441\u0434\u0430\u0447\u0438 \u0432 \u0441\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043E\u0447\u043D\u044B\u0439 \u0446\u0435\u043D\u0442\u0440", children: [_jsx(ArrowRightLeft, { size: 16, "aria-hidden": "true" }), orderAction === 'change-destination'
                                                        ? 'Меняю направление…'
                                                        : `ПВЗ → СЦ (${changeDestinationSupplyCount})`] }), _jsxs("button", { type: "button", className: `button button-secondary${selectedMoveRequestCount > 1 ? ' fbs-order-actions__merge-supplies' : ''}`, disabled: !canMoveSelectedOrders || orderAction !== null, onClick: () => void onMoveToNewSupply(moveOrders), title: "\u041E\u0431\u044A\u0435\u0434\u0438\u043D\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u043D\u0435\u0441\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B \u043E\u0434\u043D\u043E\u0433\u043E \u0441\u043A\u043B\u0430\u0434\u0430 WB \u0438\u0437 \u0440\u0430\u0437\u043D\u044B\u0445 \u0437\u0430\u044F\u0432\u043E\u043A \u0432 \u043E\u0434\u043D\u0443 \u043D\u043E\u0432\u0443\u044E \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0443 \u0438 \u0437\u0430\u044F\u0432\u043A\u0443 WMS", children: [_jsx(ArrowRightLeft, { size: 16, "aria-hidden": "true" }), orderAction === 'move'
                                                        ? 'Переношу…'
                                                        : selectedMoveRequestCount > 1
                                                            ? `Объединить в заявку (${moveOrders.length})`
                                                            : `В новую поставку (${moveOrders.length})`] })] }) : null, _jsxs("button", { type: "button", className: "button button-secondary", disabled: requestOrders.length === 0 || orderAction !== null, onClick: () => void onCreateRequest(requestOrders), children: [_jsx(FilePlus2, { size: 16, "aria-hidden": "true" }), orderAction === 'request' ? 'Создаю…' : `Заявка (${requestOrders.length})`] }), _jsxs("button", { type: "button", className: "button button-secondary fbs-order-actions__danger", disabled: cancelOrders.length === 0 || orderAction !== null, onClick: () => void onCancel(cancelOrders), children: [_jsx(XCircle, { size: 16, "aria-hidden": "true" }), orderAction === 'cancel' ? 'Отменяю…' : `Отменить (${cancelOrders.length})`] })] })) : null, _jsxs("button", { type: "button", className: "button button-secondary", disabled: stickerOrders.length === 0 || orderAction !== null, onClick: () => void onDownloadStickers(stickerOrders), children: [_jsx(Download, { size: 16, "aria-hidden": "true" }), orderAction === 'stickers' ? 'Формирую…' : `ШК заказов (${stickerOrders.length})`] }), hasWildberriesOrders ? _jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: "button button-secondary", disabled: cargoStickerOrders.length === 0 || orderAction !== null, onClick: () => void onDownloadCargoStickers(cargoStickerOrders), title: "QR \u0433\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442 \u0434\u043B\u044F \u0441\u0434\u0430\u0447\u0438 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u0432 \u041F\u0412\u0417", children: [_jsx(QrCode, { size: 16, "aria-hidden": "true" }), orderAction === 'cargo' ? 'Формирую…' : `ШК для ПВЗ (${cargoStickerOrders.length})`] }), _jsxs("button", { type: "button", className: "button button-secondary", disabled: supplyStickerOrders.length === 0 || orderAction !== null, onClick: () => void onDownloadSupplyStickers(supplyStickerOrders), title: "QR \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0438 \u0432 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0443 \u0434\u043B\u044F \u0441\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043E\u0447\u043D\u043E\u0433\u043E \u0446\u0435\u043D\u0442\u0440\u0430", children: [_jsx(QrCode, { size: 16, "aria-hidden": "true" }), orderAction === 'supply' ? 'Формирую…' : `ШК для СЦ (${supplyStickerOrders.length})`] })] }) : null] }), hasWildberriesOrders ? _jsx("p", { className: "fbs-order-actions__hint", children: data?.deliveryPlan.requiresCargoPlaces
                            ? 'ПВЗ: печатается QR грузоместа. Количество товаров в одном грузоместе WMS не ограничивает.'
                            : 'СЦ: печатается QR поставки после её передачи в доставку. Грузоместа WB не создаются.' }) : null, actionMessage ? _jsx("p", { className: "fbs-order-actions__message", children: actionMessage }) : null, actionError ? _jsx("p", { className: "fbs-order-actions__error", children: actionError }) : null] })) : null, _jsxs("div", { className: "fbs-table-wrap", children: [_jsxs("table", { className: "fbs-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [!readOnlyView ? (_jsx("th", { className: "fbs-table__check", children: _jsx("input", { type: "checkbox", "aria-label": "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u0435 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u043D\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B", checked: allVisibleSelected, onChange: toggleAllVisible }) })) : null, _jsx("th", { children: "\u0417\u0430\u043A\u0430\u0437" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0428\u041A" }), view === 'active' ? _jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F" }) : null, _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441 API" }), _jsx("th", { children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B" }), _jsx("th", { children: view === 'active' ? 'Создан / прошло' : 'Отгрузка / время' }), view === 'cancelled' ? _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435" }) : null] }) }), orderGroups.map((group) => {
                                if (group.parentDateKey && !expandedGroupKeys.has(group.parentDateKey)) {
                                    return null;
                                }
                                const isCollapsed = group.isGrouped && !expandedGroupKeys.has(group.key);
                                const groupTitle = fbsOrderGroupTitle(group, view);
                                const groupWarehouse = fbsOrderGroupWarehouseLabel(group);
                                const groupDescription = fbsOrderGroupDescription(group, view, data?.deliveryPlan.requiresCargoPlaces === true);
                                const groupStickerOrders = group.orders.filter(fbsOrderStickerIsAvailable);
                                const groupDeliverOrders = group.orders.filter((order) => order.marketplace === 'WILDBERRIES' && order.supplierStatus === 'confirm' && Boolean(order.supplyId));
                                const groupCargoOrders = group.orders.filter((order) => order.marketplace === 'WILDBERRIES' &&
                                    fbsOrderRequiresCargoPlaces(order, data?.deliveryPlan.requiresCargoPlaces === true));
                                const groupSupplyStickerOrders = group.orders.filter((order) => order.marketplace === 'WILDBERRIES' &&
                                    order.supplierStatus === 'complete' &&
                                    Boolean(order.supplyId));
                                const groupChangeDestinationOrders = group.orders.filter((order) => order.marketplace === 'WILDBERRIES' &&
                                    order.supplierStatus === 'confirm' &&
                                    Boolean(order.supplyId) &&
                                    fbsOrderRequiresCargoPlaces(order, data?.deliveryPlan.requiresCargoPlaces === true));
                                const groupRequests = Array.from(new Map(group.orders
                                    .map((order) => order.request)
                                    .filter((request) => Boolean(request))
                                    .map((request) => [request.id, request])).values());
                                const emergencyEligibleRequests = groupRequests.filter((request) => !['PACKED', 'DONE', 'CANCELLED', 'REJECTED'].includes(request.status));
                                return (_jsxs("tbody", { className: group.isGrouped
                                        ? `fbs-table__shipment-group${group.kind === 'date' ? ' fbs-table__date-group' : ''}${group.parentDateKey ? ' fbs-table__shipment-group--nested' : ''}`
                                        : undefined, children: [group.isGrouped ? (_jsx("tr", { className: "fbs-table__shipment-heading", children: _jsx("td", { colSpan: tableColumnCount, children: _jsxs("div", { className: "fbs-table__shipment-heading-content", children: [_jsxs("div", { children: [group.kind === 'date'
                                                                    ? _jsx(CalendarDays, { size: 15, "aria-hidden": "true" })
                                                                    : _jsx(PackageCheck, { size: 15, "aria-hidden": "true" }), _jsx("button", { type: "button", className: "fbs-table__shipment-toggle", onClick: () => toggleGroup(group.key), "aria-expanded": !isCollapsed, "aria-label": isCollapsed ? 'Развернуть группу заказов' : 'Свернуть группу заказов', title: isCollapsed ? 'Развернуть группу заказов' : 'Свернуть группу заказов', children: isCollapsed ? _jsx(ChevronRight, { size: 16, "aria-hidden": "true" }) : _jsx(ChevronDown, { size: 16, "aria-hidden": "true" }) }), _jsx("strong", { children: groupTitle }), _jsx("b", { className: "fbs-table__shipment-warehouse", children: groupWarehouse }), _jsx("span", { children: groupDescription })] }), group.kind !== 'date' ? _jsxs("div", { className: "fbs-table__shipment-actions", children: [view === 'shipped'
                                                                    ? emergencyEligibleRequests.map((request) => request.fbsEmergencyAssemblyAt ? (_jsxs("span", { className: "fbs-emergency-assembly-status", title: `Включил: ${request.fbsEmergencyAssemblyByName || 'администратор'} · ${formatDateTime(request.fbsEmergencyAssemblyAt)}`, children: [_jsx(AlertTriangle, { size: 13, "aria-hidden": "true" }), "\u0410\u0432\u0430\u0440\u0438\u0439\u043D\u0430\u044F \u0441\u0431\u043E\u0440\u043A\u0430 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0430"] }, `emergency:${request.id}`)) : canEnableEmergencyAssembly ? (_jsxs("button", { type: "button", className: "fbs-emergency-assembly-button", disabled: orderAction !== null, onClick: () => void onEnableEmergencyAssembly(request), title: "\u0412\u0435\u0440\u043D\u0443\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443 \u0432 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u0443\u044E \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0422\u0421\u0414 \u0431\u0435\u0437 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0441\u0442\u0430\u0442\u0443\u0441\u0430 Wildberries", children: [_jsx(AlertTriangle, { size: 13, "aria-hidden": "true" }), orderAction === 'emergency-assembly' && rowActionKey === request.id
                                                                                ? 'Возвращаю…'
                                                                                : `Экстренно в сборку №${String(request.number).padStart(6, '0')}`] }, `emergency:${request.id}`)) : null)
                                                                    : null, !readOnlyView ? (_jsx("button", { type: "button", onClick: () => {
                                                                        const next = new Set(selectedOrderKeys);
                                                                        group.orders.forEach((order) => {
                                                                            const key = fbsOrderSelectionKey(order);
                                                                            next.add(key);
                                                                        });
                                                                        onSelectionChange(next);
                                                                    }, children: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443" })) : null, _jsxs("button", { type: "button", disabled: groupStickerOrders.length === 0 || orderAction !== null, onClick: () => void onDownloadStickers(groupStickerOrders), children: [_jsx(Download, { size: 13, "aria-hidden": "true" }), " \u0428\u041A \u0437\u0430\u043A\u0430\u0437\u043E\u0432"] }), groupCargoOrders.length > 0 ? (_jsxs("button", { type: "button", disabled: orderAction !== null, onClick: () => void onDownloadCargoStickers(groupCargoOrders), children: [_jsx(QrCode, { size: 13, "aria-hidden": "true" }), " QR \u0433\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442"] })) : null, view === 'shipped' && groupSupplyStickerOrders.length > 0 ? (_jsxs("button", { type: "button", disabled: orderAction !== null, onClick: () => void onDownloadSupplyStickers(groupSupplyStickerOrders), title: `Скачать QR поставки ${group.supplyId}`, children: [_jsx(QrCode, { size: 13, "aria-hidden": "true" }), " QR \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438"] })) : null, groupChangeDestinationOrders.length > 0 ? (_jsxs("button", { type: "button", disabled: orderAction !== null, onClick: () => void onChangeDestination(groupChangeDestinationOrders), title: "\u0418\u0441\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043E\u0448\u0438\u0431\u043E\u0447\u043D\u044B\u0439 \u0432\u044B\u0431\u043E\u0440 \u041F\u0412\u0417 \u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0437\u0430\u043A\u0430\u0437\u044B \u0434\u043B\u044F \u0441\u0434\u0430\u0447\u0438 \u0432 \u0421\u0426", children: [_jsx(ArrowRightLeft, { size: 13, "aria-hidden": "true" }), " \u041F\u0412\u0417 \u2192 \u0421\u0426"] })) : null, groupDeliverOrders.length > 0 ? (_jsxs("button", { type: "button", disabled: orderAction !== null, onClick: () => void onDeliver(groupDeliverOrders), children: [_jsx(Send, { size: 13, "aria-hidden": "true" }), " \u041F\u0435\u0440\u0435\u0434\u0430\u0442\u044C WB"] })) : null] }) : null] }) }) })) : null, group.kind !== 'date' && !isCollapsed ? group.orders.map((order) => (_jsx(FbsOrderRow, { order: order, now: clockNow, showBoxes: view === 'active', selectable: !readOnlyView, selected: selectedOrderKeys.has(fbsOrderSelectionKey(order)), onToggle: () => toggleOrder(order), actionsDisabled: orderAction !== null, stickerBusy: orderAction === 'stickers' && rowActionKey === fbsOrderSelectionKey(order), cargoBusy: orderAction === 'cargo' && rowActionKey === fbsOrderSelectionKey(order), supplyBusy: orderAction === 'supply' && rowActionKey === fbsOrderSelectionKey(order), pickListBusy: orderAction === 'pick-list' && rowActionKey === fbsOrderSelectionKey(order), requiresCargoPlaces: fbsOrderRequiresCargoPlaces(order, data?.deliveryPlan.requiresCargoPlaces === true), canDownloadPickList: canDownloadPickList, onHideWaitingStock: () => setHiddenWaitingStockKeys((current) => new Set(current).add(fbsOrderSelectionKey(order))), onDownloadSticker: () => void onDownloadStickers([order]), onDownloadCargoStickers: () => void onDownloadCargoStickers([order]), onDownloadSupplyStickers: () => void onDownloadSupplyStickers([order]), onDownloadPickList: () => void onDownloadPickList(order), showRemoveCancelledAction: view === 'cancelled', removeCancelledBusy: orderAction === 'remove-cancelled' && rowActionKey === fbsOrderSelectionKey(order), onRemoveCancelledOrder: () => void onRemoveCancelledOrder(order) }, `${order.marketplace}:${order.connectionId}:${order.id}`))) : null] }, group.key));
                            })] }), visibleOrders.length === 0 ? (_jsxs("div", { className: "fbs-empty", children: [_jsx("span", { children: _jsx(EmptyIcon, { size: 27, "aria-hidden": "true" }) }), _jsx("strong", { children: normalizedSearch ? `По запросу «${search.trim()}» ничего не найдено` : emptyCopy.title }), _jsx("p", { children: normalizedSearch ? 'Измените поисковый запрос или очистите поле.' : emptyCopy.text })] })) : null] })] }));
}
function FbsOrderRow({ order, now, showBoxes, selectable, selected, onToggle, actionsDisabled, stickerBusy, cargoBusy, supplyBusy, pickListBusy, requiresCargoPlaces, canDownloadPickList, onHideWaitingStock, onDownloadSticker, onDownloadCargoStickers, onDownloadSupplyStickers, onDownloadPickList, showRemoveCancelledAction, removeCancelledBusy, onRemoveCancelledOrder, }) {
    const canDownloadSticker = fbsOrderStickerIsAvailable(order);
    const canDownloadCargoStickers = requiresCargoPlaces &&
        order.marketplace === 'WILDBERRIES' &&
        order.supplierStatus === 'confirm' &&
        Boolean(order.supplyId);
    const canDownloadSupplyStickers = !requiresCargoPlaces &&
        order.marketplace === 'WILDBERRIES' &&
        order.supplierStatus === 'complete' &&
        Boolean(order.supplyId);
    const canHideWaitingStock = order.reservation?.status === 'WAITING_STOCK' &&
        order.category === 'active';
    const hasActiveRequest = Boolean(order.request && order.request.status !== 'CANCELLED');
    const orderCreatedAt = fbsOrderCreatedAt(order);
    const deliveryFinishedAt = fbsOrderDeliveryFinishedAt(order);
    const elapsed = orderCreatedAt
        ? Math.max(0, (order.category === 'active' || !deliveryFinishedAt
            ? now
            : deliveryFinishedAt) - orderCreatedAt)
        : null;
    return (_jsxs("tr", { className: selected ? 'fbs-table__row--selected' : undefined, children: [selectable ? (_jsx("td", { className: "fbs-table__check", children: _jsx("input", { type: "checkbox", "aria-label": `Выбрать заказ ${order.id}`, checked: selected, onChange: onToggle }) })) : null, _jsxs("td", { children: [_jsxs("strong", { children: ["\u2116 ", order.id] }), _jsx("small", { children: marketplaceLabel(order.marketplace) }), _jsxs("span", { className: `fbs-order-warehouse-badge${order.warehouseId ? '' : ' is-warning'}`, children: [_jsx(Warehouse, { size: 12, "aria-hidden": "true" }), fbsOrderWarehouseLabel(order)] }), order.request ? (_jsxs("span", { className: `fbs-request-link ${order.request.status === 'CANCELLED' ? 'fbs-request-link--cancelled' : ''}`, children: [order.request.status === 'CANCELLED' ? 'Отменённая заявка WMS' : 'Заявка WMS', " \u2116", String(order.request.number).padStart(6, '0')] })) : null] }), _jsxs("td", { children: [_jsx("strong", { children: order.product?.name || order.article || `Товар ${order.nmId ?? ''}` }), _jsx("small", { children: [
                            order.article,
                            order.product?.size ? `Размер: ${order.product.size}` : null,
                            order.nmId ? `nmID ${order.nmId}` : null,
                            `${Math.max(1, order.itemCount)} ед.`,
                        ]
                            .filter(Boolean)
                            .join(' · ') })] }), _jsx("td", { children: _jsx("span", { className: "fbs-mono", children: order.barcodes.join(', ') || 'не передан' }) }), showBoxes ? (_jsxs("td", { children: [order.reservation?.withoutBox && order.reservation.status === 'RESERVED' ? (_jsxs("div", { className: "fbs-pallet-reservation", children: [_jsx("strong", { children: "\u0417\u0430\u0440\u0435\u0437\u0435\u0440\u0432\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u0441\u043E \u0441\u043A\u043B\u0430\u0434\u0430" }), _jsx("small", { children: "\u0411\u0435\u0437 \u043F\u0440\u0438\u0432\u044F\u0437\u043A\u0438 \u043A \u043A\u043E\u0440\u043E\u0431\u0443 \u0438 \u043F\u0430\u043B\u0435\u0442-\u0441\u043E\u0440\u0442\u0443" })] })) : order.reservation?.boxCode ? (_jsxs("div", { className: "fbs-pallet-reservation", children: [_jsxs("strong", { children: ["\u0417\u0430\u0440\u0435\u0437\u0435\u0440\u0432\u0438\u0440\u043E\u0432\u0430\u043D: ", order.reservation.boxCode] }), _jsxs("small", { children: ["\u041F\u0430\u043B\u0435\u0442-\u0441\u043E\u0440\u0442 ", order.reservation.palletCode || 'не определён'] })] })) : order.reservation?.status === 'WAITING_STOCK' ? (_jsxs("div", { className: "fbs-pallet-reservation fbs-pallet-reservation--warning", children: [_jsx("strong", { children: "\u0420\u0435\u0437\u0435\u0440\u0432 \u043E\u0436\u0438\u0434\u0430\u0435\u0442 \u0442\u043E\u0432\u0430\u0440" }), _jsx("small", { children: order.reservation.problem ||
                                    (order.reservation.withoutBox
                                        ? 'На складе пока нет свободной единицы.'
                                        : 'В палет-сорте пока нет свободной единицы.') }), canHideWaitingStock ? (_jsx("button", { type: "button", className: "fbs-pallet-reservation__remove", onClick: onHideWaitingStock, title: "\u0421\u043A\u0440\u043E\u0435\u0442 \u0441\u0442\u0440\u043E\u043A\u0443 \u0442\u043E\u043B\u044C\u043A\u043E \u0432 \u0442\u0435\u043A\u0443\u0449\u0435\u043C \u0441\u043F\u0438\u0441\u043A\u0435. \u0417\u0430\u043A\u0430\u0437 \u043D\u0430 Wildberries \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u0441\u044F.", children: "\u0421\u043A\u0440\u044B\u0442\u044C \u0438\u0437 \u0432\u0438\u0434\u0443" })) : null] })) : null, order.reservation?.withoutBox ? null : order.relabeling ? (_jsxs("div", { className: "fbs-relabel-stock", children: [_jsx("strong", { children: "\u041D\u0443\u0436\u043D\u0430 \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0430" }), _jsxs("span", { children: ["\u0418\u0441\u043A\u0430\u0442\u044C: ", order.relabeling.sourceProductName || order.relabeling.sourceArticle] }), _jsxs("small", { children: ["\u0410\u0440\u0442\u0438\u043A\u0443\u043B \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435: ", order.relabeling.sourceArticle, order.product?.size ? ` · размер ${order.product.size}` : ''] }), order.storageBoxes.length > 0 ? (_jsx("div", { className: "fbs-box-list fbs-box-list--relabel", children: order.storageBoxes.map((box) => (_jsxs("span", { children: [box.code, " \u00B7 ", box.quantity, " \u0448\u0442."] }, `${box.code}:${box.status}`))) })) : (_jsx("span", { className: "fbs-missing-box", children: "\u0414\u043B\u044F \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0438 \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0438\u0439 \u043A\u043E\u0440\u043E\u0431 \u043F\u043E\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" }))] })) : order.storageBoxes.length > 0 ? (_jsx("div", { className: "fbs-box-list", children: order.storageBoxes.map((box) => (_jsxs("span", { children: [box.code, " \u00B7 ", box.quantity, " \u0448\u0442."] }, `${box.code}:${box.status}`))) })) : (_jsx("span", { className: "fbs-missing-box", children: "\u041D\u0430 \u043E\u0441\u0442\u0430\u0442\u043A\u0430\u0445 \u043A\u043E\u0440\u043E\u0431 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" }))] })) : null, _jsxs("td", { children: [_jsx("span", { className: `fbs-status fbs-status--${order.category}`, children: order.statusLabel }), _jsx("small", { children: order.supplierStatus }), order.supplyId ? (_jsxs("small", { children: [fbsMarketplaceShipmentLabel(order), " ", order.supplyId, " \u00B7 ", fbsShipmentDestinationLabel(order, requiresCargoPlaces)] })) : null, order.category === 'shipped' ? _jsx("small", { children: fbsSentToMarketplaceLabel(order) }) : null] }), _jsx("td", { children: _jsxs("div", { className: "fbs-order-documents", children: [_jsxs("button", { type: "button", className: "fbs-order-document-button", disabled: !canDownloadSticker || actionsDisabled, onClick: onDownloadSticker, title: canDownloadSticker
                                ? `Скачать ШК заказа ${order.id}`
                                : order.marketplace === 'OZON'
                                    ? 'Этикетка Ozon появится после передачи сборки в Ozon'
                                    : 'ШК появится после перевода заказа в сборку', children: [_jsx(Download, { size: 14, "aria-hidden": "true" }), stickerBusy ? 'Формирую…' : 'Скачать ШК'] }), order.marketplace === 'WILDBERRIES' ? _jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: "fbs-order-document-button fbs-order-document-button--cargo", disabled: !canDownloadCargoStickers || actionsDisabled, onClick: onDownloadCargoStickers, title: canDownloadCargoStickers
                                        ? `Скачать все QR грузомест поставки ${order.supplyId} для ПВЗ`
                                        : requiresCargoPlaces
                                            ? 'ШК для ПВЗ появится после создания грузомест и перевода заказа в сборку'
                                            : 'Для клиента выбрана сдача в сортировочный центр', children: [_jsx(QrCode, { size: 14, "aria-hidden": "true" }), cargoBusy ? 'Формирую…' : 'ШК для ПВЗ'] }), _jsxs("button", { type: "button", className: "fbs-order-document-button", disabled: !canDownloadSupplyStickers || actionsDisabled, onClick: onDownloadSupplyStickers, title: canDownloadSupplyStickers
                                        ? `Скачать QR поставки ${order.supplyId} для сортировочного центра`
                                        : requiresCargoPlaces
                                            ? 'Для клиента выбрана сдача в ПВЗ'
                                            : 'ШК для СЦ появится после передачи поставки в доставку', children: [_jsx(QrCode, { size: 14, "aria-hidden": "true" }), supplyBusy ? 'Формирую…' : 'ШК для СЦ'] })] }) : null, canDownloadPickList && hasActiveRequest ? (_jsxs("button", { type: "button", className: "fbs-order-document-button", disabled: actionsDisabled, onClick: onDownloadPickList, title: `Скачать лист подбора заявки №${String(order.request.number).padStart(6, '0')} для ${marketplaceLabel(order.marketplace)}`, children: [_jsx(ClipboardList, { size: 14, "aria-hidden": "true" }), pickListBusy ? 'Формирую…' : 'Лист подбора'] })) : null] }) }), _jsxs("td", { children: [_jsx("strong", { children: formatDateTime(order.createdAt || order.sellerDate) }), elapsed !== null ? (_jsxs("span", { className: `fbs-order-age fbs-order-age--${fbsOrderAgeTone(elapsed, order.category)}`, children: [_jsx(Clock3, { size: 13, "aria-hidden": "true" }), order.category === 'active' ? 'Прошло ' : 'До передачи ', formatElapsedDuration(elapsed)] })) : null, _jsx("small", { children: order.supplyId ? `Поставка ${order.supplyId}` : order.sellerDate || '' })] }), showRemoveCancelledAction ? (_jsx("td", { className: "fbs-cancelled-order-action", children: order.marketplace === 'WILDBERRIES' ? (_jsxs("button", { type: "button", disabled: actionsDisabled, onClick: onRemoveCancelledOrder, title: "\u0421\u043D\u0438\u043C\u0435\u0442 \u0440\u0435\u0437\u0435\u0440\u0432 \u0438 \u0443\u0434\u0430\u043B\u0438\u0442 \u0437\u0430\u043A\u0430\u0437 \u0438\u0437 \u0437\u0430\u044F\u0432\u043A\u0438 WMS. \u0421\u0442\u0430\u0442\u0443\u0441 \u043D\u0430 Wildberries \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u0441\u044F.", children: [_jsx(XCircle, { size: 14, "aria-hidden": "true" }), removeCancelledBusy ? 'Удаляю…' : 'Удалить из WMS'] })) : (_jsx("small", { children: "\u0423\u0434\u0430\u043B\u0435\u043D\u0438\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0432 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0435 \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0430" })) })) : null] }));
}
function FbsCostView({ data }) {
    const orders = (data?.orders ?? []).filter((order) => order.category === 'shipped');
    const totalRub = orders.reduce((sum, order) => sum + Number(order.billing?.totalRub ?? 0), 0);
    const invoiced = orders.filter((order) => order.billing?.invoiceNumber);
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "fbs-cost-summary", children: [_jsxs("article", { children: [_jsx("span", { children: "\u0417\u0430\u043A\u0430\u0437\u043E\u0432 \u0432 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0435" }), _jsx("strong", { children: orders.length }), _jsx("small", { children: "\u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u043E\u0441\u043B\u0435 \u043E\u0442\u0433\u0440\u0443\u0437\u043A\u0438" })] }), _jsxs("article", { children: [_jsx("span", { children: "\u0412\u044B\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E \u0432 \u0441\u0447\u0435\u0442\u0430" }), _jsx("strong", { children: invoiced.length }), _jsx("small", { children: "\u0437\u0430\u043A\u0430\u0437\u043E\u0432 FBS" })] }), _jsxs("article", { className: "fbs-cost-summary__total", children: [_jsx("span", { children: "\u0421\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0438" }), _jsxs("strong", { children: [formatMoney(totalRub), " \u20BD"] }), _jsx("small", { children: "\u043F\u043E \u0442\u0430\u0440\u0438\u0444\u0443 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" })] })] }), _jsxs("div", { className: "fbs-table-wrap", children: [_jsxs("table", { className: "fbs-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0417\u0430\u043A\u0430\u0437" }), _jsx("th", { children: "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441 \u0437\u0430\u043A\u0430\u0437\u0430" }), _jsx("th", { children: "\u041D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u0435" }), _jsx("th", { children: "\u0421\u0447\u0451\u0442" })] }) }), orders.length > 0 ? (_jsx("tbody", { children: orders.map((order) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsxs("strong", { children: ["\u2116 ", order.id] }), _jsxs("small", { children: [order.product?.name || order.article || 'Товар', order.product?.size ? ` · Размер: ${order.product.size}` : ''] })] }), _jsx("td", { children: marketplaceLabel(order.marketplace) }), _jsx("td", { children: _jsx("span", { className: "fbs-status fbs-status--shipped", children: order.statusLabel }) }), _jsxs("td", { children: [_jsxs("strong", { children: [formatMoney(order.billing?.totalRub ?? 0), " \u20BD"] }), _jsx("small", { children: Number(order.billing?.unitPriceRub ?? 0) > 0
                                                        ? order.billing?.status === 'APPROVED'
                                                            ? 'подтверждено'
                                                            : 'черновик'
                                                        : 'нужно настроить тариф FBS' }), order.billing?.breakdown ? (_jsxs("small", { children: ["\u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 ", formatMoney(order.billing.breakdown.fbsProcessingRub +
                                                            order.billing.breakdown.additionalServicesRub), " \u20BD \u00B7 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0430 ", formatMoney(order.billing.breakdown.deliveryRub), " \u20BD \u00B7 \u043A\u043E\u0440\u043E\u0431", ' ', formatMoney(order.billing.breakdown.boxFormationRub +
                                                            order.billing.breakdown.boxMaterialRub), " \u20BD", order.billing.breakdown.palletRub > 0
                                                            ? ` · паллеты ${formatMoney(order.billing.breakdown.palletRub)} ₽`
                                                            : ''] })) : null] }), _jsxs("td", { children: [_jsx("strong", { children: order.billing?.invoiceNumber || 'не выставлен' }), _jsx("small", { children: order.billing?.invoiceStatus || '' })] })] }, `cost:${order.marketplace}:${order.connectionId}:${order.id}`))) })) : null] }), orders.length === 0 ? (_jsxs("div", { className: "fbs-empty", children: [_jsx("span", { children: _jsx(BadgeRussianRuble, { size: 27, "aria-hidden": "true" }) }), _jsx("strong", { children: "\u0417\u0430\u043A\u0430\u0437\u043E\u0432 \u0434\u043B\u044F \u0440\u0430\u0441\u0447\u0451\u0442\u0430 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442" }), _jsx("p", { children: "\u041F\u043E\u0441\u043B\u0435 \u0441\u0442\u0430\u0442\u0443\u0441\u0430 \u00AB\u041F\u0435\u0440\u0435\u0434\u0430\u043D \u0432 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0443\u00BB \u0437\u0430\u043A\u0430\u0437 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0437\u0434\u0435\u0441\u044C." })] })) : null] })] }));
}
export function FbsPricingSettings({ clientId, session, onSaved, }) {
    const [data, setData] = useState(null);
    const [form, setForm] = useState(null);
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
            if (!active)
                return;
            setData(next);
            setForm(editableFbsSettings(next));
        })
            .catch((caught) => {
            if (!active)
                return;
            setData(null);
            setForm(null);
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить тарифы FBS.');
        })
            .finally(() => {
            if (active)
                setLoading(false);
        });
        return () => {
            active = false;
        };
    }, [clientId, session.accessToken]);
    if (isLoading && !form) {
        return _jsx(FbsNotice, { icon: RefreshCw, title: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0442\u0430\u0440\u0438\u0444\u044B FBS", text: "\u041F\u043E\u043B\u0443\u0447\u0430\u0435\u043C \u0443\u0441\u043B\u0443\u0433\u0438 \u0438 \u0446\u0435\u043D\u044B \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0430." });
    }
    if (!form || !data) {
        return _jsx(FbsNotice, { icon: AlertTriangle, title: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438", text: error || 'Повторите попытку.', tone: "error" });
    }
    const availableServices = data.serviceOptions.filter((service) => service.isActive);
    const palletOptions = availableServices.filter((service) => service.isPallet);
    const boxServices = availableServices.filter((service) => !service.isPallet);
    const additionalOptions = boxServices.filter((service) => service.id !== form.boxFormationServiceId &&
        service.id !== form.boxMaterialServiceId &&
        service.code !== 'BOX_ASSEMBLY' &&
        service.code !== 'BOX_60_40_40');
    const palletCapacityItems = form.boxCapacityItems * form.boxesPerPallet;
    const preview = [
        5,
        6,
        10,
        form.boxCapacityItems,
        ...(form.palletsEnabled ? [palletCapacityItems, palletCapacityItems + 1] : []),
    ].filter((items, index, all) => items > 0 && all.indexOf(items) === index);
    function patch(key, value) {
        setForm((current) => (current ? { ...current, [key]: value } : current));
        setSaved(false);
    }
    function toggleAdditionalService(serviceId, checked) {
        patch('additionalServices', checked
            ? [...form.additionalServices, {
                    serviceId,
                    quantityMultiplier: 1,
                    matchKeywords: '',
                }]
            : form.additionalServices.filter((selection) => selection.serviceId !== serviceId));
    }
    function changeMultiplier(serviceId, quantityMultiplier) {
        patch('additionalServices', form.additionalServices.map((selection) => selection.serviceId === serviceId
            ? { ...selection, quantityMultiplier: Math.max(0.001, quantityMultiplier || 1) }
            : selection));
    }
    async function saveSettings(event) {
        event.preventDefault();
        if (form.palletsEnabled && !form.palletServiceId) {
            setError('Для начисления паллет выберите услугу паллеты.');
            setSaved(false);
            return;
        }
        setSaving(true);
        setError('');
        setSaved(false);
        try {
            const next = await updateFbsBillingSettings(session.accessToken, clientId, form);
            setData(next);
            setForm(editableFbsSettings(next));
            setSaved(true);
            onSaved();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить тарифы FBS.');
        }
        finally {
            setSaving(false);
        }
    }
    return (_jsxs("form", { className: "fbs-pricing", onSubmit: saveSettings, children: [_jsxs("div", { className: "fbs-pricing__intro", children: [_jsxs("div", { children: [_jsx("span", { children: _jsx(Settings2, { size: 19, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsxs("strong", { children: [data.client.code, " \u00B7 ", data.client.name] }), _jsx("p", { children: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u043F\u0440\u0438\u043C\u0435\u043D\u044F\u044E\u0442\u0441\u044F \u043A \u043D\u043E\u0432\u044B\u043C \u0438 \u0435\u0449\u0451 \u043D\u0435 \u0432\u044B\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u043C \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F\u043C FBS." })] })] }), _jsx("span", { className: `fbs-pricing__pallet-status${form.palletsEnabled ? ' is-enabled' : ''}`, children: form.palletsEnabled ? 'Паллеты включены' : 'Паллеты отключены' })] }), _jsxs("section", { className: "fbs-pricing__section", children: [_jsx("header", { children: _jsxs("div", { children: [_jsx("span", { children: "01" }), _jsxs("div", { children: [_jsx("h4", { children: "\u041F\u0435\u0440\u0432\u0438\u0447\u043D\u0430\u044F \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), _jsx("p", { children: "\u0417\u0434\u0435\u0441\u044C \u0437\u0430\u0434\u0430\u0451\u0442\u0441\u044F, \u043A\u0430\u043A\u0438\u0435 \u0443\u0441\u043B\u0443\u0433\u0438 \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E \u0432\u0445\u043E\u0434\u044F\u0442 \u0432 \u043F\u0435\u0440\u0432\u0438\u0447\u043D\u0443\u044E \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0443 FBS." })] })] }) }), _jsx("div", { className: "fbs-pricing__pallets", children: _jsxs("label", { className: form.primaryProcessingEnabled ? 'is-enabled' : undefined, children: [_jsx("input", { checked: form.primaryProcessingEnabled, type: "checkbox", onChange: (event) => patch('primaryProcessingEnabled', event.target.checked) }), _jsxs("span", { children: [_jsx("strong", { children: "\u041D\u0430\u0447\u0438\u0441\u043B\u044F\u0442\u044C \u043F\u0435\u0440\u0432\u0438\u0447\u043D\u0443\u044E \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0443" }), _jsx("small", { children: "\u0412\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u043D\u0438\u0436\u0435 \u0443\u0441\u043B\u0443\u0433\u0438 \u0431\u0443\u0434\u0443\u0442 \u043D\u0430\u0447\u0438\u0441\u043B\u044F\u0442\u044C\u0441\u044F \u043F\u043E \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u043E\u043C\u0443 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0443." })] })] }) }), _jsxs("div", { className: "fbs-pricing__fields fbs-pricing__fields--processing", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 FBS \u0437\u0430 \u0435\u0434\u0438\u043D\u0438\u0446\u0443, \u20BD" }), _jsx("input", { min: "0", step: "0.01", type: "number", value: form.fbsProcessingPriceRub, onChange: (event) => patch('fbsProcessingPriceRub', nonNegativeNumber(event.target.value)), required: true })] }), _jsxs("div", { className: "fbs-pricing__service-picker", children: [_jsx("span", { children: "\u0421\u043E\u0441\u0442\u0430\u0432 \u043F\u0435\u0440\u0432\u0438\u0447\u043D\u043E\u0439 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0438. \u041F\u0440\u0438\u0437\u043D\u0430\u043A\u0438 \u043E\u0442\u0440\u0435\u0437\u0430 \u0431\u0435\u0440\u0443\u0442\u0441\u044F \u0438\u0437 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F, \u0430\u0440\u0442\u0438\u043A\u0443\u043B\u0430 \u0438 \u0440\u0430\u0437\u043C\u0435\u0440\u0430 SKU; \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0432\u0430\u0440\u0438\u0430\u043D\u0442\u043E\u0432 \u0440\u0430\u0437\u0434\u0435\u043B\u044F\u0439\u0442\u0435 \u0442\u043E\u0447\u043A\u043E\u0439 \u0441 \u0437\u0430\u043F\u044F\u0442\u043E\u0439." }), _jsxs("div", { children: [additionalOptions.map((service) => {
                                                const selected = form.additionalServices.find((selection) => selection.serviceId === service.id);
                                                return (_jsxs("label", { className: selected ? 'is-selected' : undefined, children: [_jsx("input", { checked: Boolean(selected), type: "checkbox", onChange: (event) => toggleAdditionalService(service.id, event.target.checked) }), _jsxs("span", { children: [_jsx("strong", { children: service.name }), _jsxs("small", { children: [service.code, " \u00B7 ", formatMoney(service.priceRub), " \u20BD \u0437\u0430 \u043E\u0442\u0440\u0435\u0437/\u0448\u0442."] }), selected ? (_jsx("input", { className: "fbs-pricing__match", placeholder: "\u041A\u0430\u043A \u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u0442\u044C: 3 \u043C; \u043E\u0442\u0440\u0435\u0437 3\u043C", type: "text", value: selected.matchKeywords, onChange: (event) => patch('additionalServices', form.additionalServices.map((selection) => selection.serviceId === service.id
                                                                        ? { ...selection, matchKeywords: event.target.value }
                                                                        : selection)) })) : null] }), selected ? (_jsx("input", { "aria-label": `Количество услуги ${service.name} на единицу товара`, min: "0.001", step: "0.001", type: "number", value: selected.quantityMultiplier, onChange: (event) => changeMultiplier(service.id, Number(event.target.value)) })) : null] }, service.id));
                                            }), additionalOptions.length === 0 ? (_jsx("p", { children: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0443 \u043E\u0441\u043D\u043E\u0432\u043D\u044B\u0435 \u0443\u0441\u043B\u0443\u0433\u0438 \u0432 \u0440\u0430\u0437\u0434\u0435\u043B\u0435 \u00AB\u0411\u0438\u043B\u043B\u0438\u043D\u0433\u00BB." })) : null] })] })] })] }), _jsxs("section", { className: "fbs-pricing__section", children: [_jsx("header", { children: _jsxs("div", { children: [_jsx("span", { children: "02" }), _jsxs("div", { children: [_jsx("h4", { children: "\u041B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430 \u043F\u0430\u0440\u0442\u0438\u0438 FBS" }), _jsx("p", { children: "\u041C\u043E\u0436\u043D\u043E \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u043E\u0431\u044B\u0447\u043D\u044B\u0439 \u0442\u0430\u0440\u0438\u0444 \u043B\u0438\u0431\u043E \u0441\u0442\u0443\u043F\u0435\u043D\u0438: \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E, \u043A\u0443\u0431, \u0437\u0430\u0442\u0435\u043C \u043F\u0430\u043B\u043B\u0435\u0442\u044B." })] })] }) }), _jsxs("div", { className: "fbs-pricing__pallets", children: [_jsxs("label", { className: form.tieredLogisticsEnabled ? 'is-enabled' : undefined, children: [_jsx("input", { checked: form.tieredLogisticsEnabled, type: "checkbox", onChange: (event) => patch('tieredLogisticsEnabled', event.target.checked) }), _jsxs("span", { children: [_jsx("strong", { children: "\u0421\u0442\u0443\u043F\u0435\u043D\u0447\u0430\u0442\u0430\u044F \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430" }), _jsx("small", { children: "\u0414\u043E \u043B\u0438\u043C\u0438\u0442\u0430 \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E; \u0437\u0430\u0442\u0435\u043C \u0446\u0435\u043D\u0430 \u0437\u0430 \u043E\u0431\u044A\u0451\u043C \u0434\u043E \u043A\u0443\u0431\u0430; \u0441\u0432\u044B\u0448\u0435 \u2014 \u0437\u0430 \u043A\u0430\u0436\u0434\u0443\u044E \u043F\u0430\u043B\u043B\u0435\u0442\u0443." })] })] }), _jsxs("div", { className: "fbs-pricing__fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0411\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E \u0434\u043E, \u0435\u0434." }), _jsx("input", { min: "0", step: "1", type: "number", value: form.logisticsFreeItemsLimit, onChange: (event) => patch('logisticsFreeItemsLimit', nonNegativeInteger(event.target.value)), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041E\u0431\u044A\u0451\u043C \u043E\u0434\u043D\u043E\u0433\u043E \u043A\u0443\u0431\u0430, \u043B" }), _jsx("input", { min: "1", step: "1", type: "number", value: form.logisticsCubicMeterLiters, onChange: (event) => patch('logisticsCubicMeterLiters', positiveInteger(event.target.value)), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0426\u0435\u043D\u0430 \u0434\u043E \u043E\u0434\u043D\u043E\u0433\u043E \u043A\u0443\u0431\u0430, \u20BD" }), _jsx("input", { min: "0", step: "0.01", type: "number", value: form.logisticsCubicMeterPriceRub, onChange: (event) => patch('logisticsCubicMeterPriceRub', nonNegativeNumber(event.target.value)), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0426\u0435\u043D\u0430 \u043A\u0430\u0436\u0434\u043E\u0439 \u043F\u0430\u043B\u043B\u0435\u0442\u044B, \u20BD" }), _jsx("input", { min: "0", step: "0.01", type: "number", value: form.logisticsPalletPriceRub, onChange: (event) => patch('logisticsPalletPriceRub', nonNegativeNumber(event.target.value)), required: true })] })] })] }), _jsxs("div", { className: "fbs-pricing__fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041C\u0430\u0440\u0448\u0440\u0443\u0442 \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E" }), _jsxs("select", { value: form.defaultDeliveryDestination, onChange: (event) => patch('defaultDeliveryDestination', event.target.value), children: [_jsx("option", { value: "PICKUP_POINT", children: "\u0411\u043B\u0438\u0436\u0430\u0439\u0448\u0438\u0439 \u041F\u0412\u0417" }), _jsx("option", { value: "VNUKOVO_SORTING_CENTER", children: "\u0421\u0426 \u0412\u043D\u0443\u043A\u043E\u0432\u043E" })] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0411\u0430\u0437\u043E\u0432\u044B\u0439 \u0432\u044B\u0435\u0437\u0434 \u043D\u0430 \u041F\u0412\u0417, \u20BD" }), _jsx("input", { min: "0", step: "0.01", type: "number", value: form.pickupPointBasePriceRub, onChange: (event) => patch('pickupPointBasePriceRub', nonNegativeNumber(event.target.value)), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0411\u0430\u0437\u043E\u0432\u044B\u0439 \u0432\u044B\u0435\u0437\u0434 \u0432 \u0421\u0426 \u0412\u043D\u0443\u043A\u043E\u0432\u043E, \u20BD" }), _jsx("input", { min: "0", step: "0.01", type: "number", value: form.vnukovoBasePriceRub, onChange: (event) => patch('vnukovoBasePriceRub', nonNegativeNumber(event.target.value)), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0415\u0434\u0438\u043D\u0438\u0446 \u0432\u0445\u043E\u0434\u0438\u0442 \u0432 \u0431\u0430\u0437\u043E\u0432\u044B\u0439 \u0432\u044B\u0435\u0437\u0434" }), _jsx("input", { min: "1", step: "1", type: "number", value: form.baseIncludedItems, onChange: (event) => patch('baseIncludedItems', positiveInteger(event.target.value)), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0420\u0430\u0437\u043C\u0435\u0440 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0433\u043E \u0431\u043B\u043E\u043A\u0430, \u0435\u0434." }), _jsx("input", { min: "1", step: "1", type: "number", value: form.extraBlockItems, onChange: (event) => patch('extraBlockItems', positiveInteger(event.target.value)), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u043E\u043F\u043B\u0430\u0442\u0430 \u0437\u0430 \u043A\u0430\u0436\u0434\u044B\u0439 \u0431\u043B\u043E\u043A, \u20BD" }), _jsx("input", { min: "0", step: "0.01", type: "number", value: form.extraBlockPriceRub, onChange: (event) => patch('extraBlockPriceRub', nonNegativeNumber(event.target.value)), required: true })] })] })] }), _jsxs("section", { className: "fbs-pricing__section", children: [_jsx("header", { children: _jsxs("div", { children: [_jsx("span", { children: "03" }), _jsxs("div", { children: [_jsx("h4", { children: "\u0424\u043E\u0440\u043C\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0438 \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u043A\u043E\u0440\u043E\u0431\u043E\u0432" }), _jsx("p", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u043A\u043E\u0440\u043E\u0431\u043E\u0432 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u043E \u0432\u043C\u0435\u0441\u0442\u0438\u043C\u043E\u0441\u0442\u0438." })] })] }) }), _jsxs("div", { className: "fbs-pricing__fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0421\u0440\u0435\u0434\u043D\u044F\u044F \u0432\u043C\u0435\u0441\u0442\u0438\u043C\u043E\u0441\u0442\u044C \u043A\u043E\u0440\u043E\u0431\u0430, \u0435\u0434." }), _jsx("input", { min: "1", step: "1", type: "number", value: form.boxCapacityItems, onChange: (event) => patch('boxCapacityItems', positiveInteger(event.target.value)), required: true }), _jsx("small", { children: "\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u043D\u043E\u0440\u043C\u0430\u0442\u0438\u0432 \u2014 14 \u0435\u0434\u0438\u043D\u0438\u0446 \u0442\u043E\u0432\u0430\u0440\u0430 \u043D\u0430 \u043A\u043E\u0440\u043E\u0431." })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0423\u0441\u043B\u0443\u0433\u0430 \u0444\u043E\u0440\u043C\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u043A\u043E\u0440\u043E\u0431\u0430" }), _jsxs("select", { value: form.boxFormationServiceId ?? '', onChange: (event) => patch('boxFormationServiceId', event.target.value || null), children: [_jsx("option", { value: "", children: "\u041D\u0435 \u043D\u0430\u0447\u0438\u0441\u043B\u044F\u0442\u044C" }), boxServices.map((service) => (_jsxs("option", { value: service.id, children: [service.name, " \u00B7 ", formatMoney(service.priceRub), " \u20BD"] }, `formation:${service.id}`)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u0441\u0430\u043C\u043E\u0433\u043E \u043A\u043E\u0440\u043E\u0431\u0430" }), _jsxs("select", { value: form.boxMaterialServiceId ?? '', onChange: (event) => patch('boxMaterialServiceId', event.target.value || null), children: [_jsx("option", { value: "", children: "\u041D\u0435 \u043D\u0430\u0447\u0438\u0441\u043B\u044F\u0442\u044C" }), boxServices.map((service) => (_jsxs("option", { value: service.id, children: [service.name, " \u00B7 ", formatMoney(service.priceRub), " \u20BD"] }, `material:${service.id}`)))] })] })] })] }), _jsxs("section", { className: "fbs-pricing__section", children: [_jsx("header", { children: _jsxs("div", { children: [_jsx("span", { children: "04" }), _jsxs("div", { children: [_jsx("h4", { children: "\u0423\u0447\u0451\u0442 \u043F\u0430\u043B\u043B\u0435\u0442" }), _jsx("p", { children: "\u041F\u0430\u043B\u043B\u0435\u0442\u044B \u043C\u043E\u0436\u043D\u043E \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E \u0434\u043B\u044F \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0438 \u0441\u0447\u0438\u0442\u0430\u0442\u044C \u043F\u043E \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0443 \u043A\u043E\u0440\u043E\u0431\u043E\u0432." })] })] }) }), _jsxs("div", { className: "fbs-pricing__pallets", children: [_jsxs("label", { className: form.palletsEnabled ? 'is-enabled' : undefined, children: [_jsx("input", { checked: form.palletsEnabled, type: "checkbox", onChange: (event) => patch('palletsEnabled', event.target.checked) }), _jsxs("span", { children: [_jsx("strong", { children: "\u041D\u0430\u0447\u0438\u0441\u043B\u044F\u0442\u044C \u043F\u0430\u043B\u043B\u0435\u0442\u044B \u0432 FBS" }), _jsx("small", { children: "\u0412 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043D\u043E\u043C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0438 \u043F\u0430\u043B\u043B\u0435\u0442\u043D\u044B\u0435 \u0443\u0441\u043B\u0443\u0433\u0438 \u043D\u0435 \u043F\u043E\u043F\u0430\u0434\u0443\u0442 \u0432 \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F \u043A\u043B\u0438\u0435\u043D\u0442\u0430." })] })] }), _jsxs("div", { className: "fbs-pricing__fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432 \u043D\u0430 \u043E\u0434\u043D\u043E\u0439 \u043F\u0430\u043B\u043B\u0435\u0442\u0435" }), _jsx("input", { disabled: !form.palletsEnabled, min: "1", step: "1", type: "number", value: form.boxesPerPallet, onChange: (event) => patch('boxesPerPallet', positiveInteger(event.target.value)), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0423\u0441\u043B\u0443\u0433\u0430 \u043F\u0430\u043B\u043B\u0435\u0442\u044B" }), _jsxs("select", { disabled: !form.palletsEnabled, value: form.palletServiceId ?? '', onChange: (event) => patch('palletServiceId', event.target.value || null), required: form.palletsEnabled, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0443\u0441\u043B\u0443\u0433\u0443" }), palletOptions.map((service) => (_jsxs("option", { value: service.id, children: [service.name, " \u00B7 ", formatMoney(service.priceRub), " \u20BD"] }, `pallet:${service.id}`)))] }), palletOptions.length === 0 ? (_jsx("small", { children: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0443 \u043F\u0430\u043B\u043B\u0435\u0442\u043D\u0443\u044E \u0443\u0441\u043B\u0443\u0433\u0443 \u0432 \u0440\u0430\u0437\u0434\u0435\u043B\u0435 \u00AB\u0411\u0438\u043B\u043B\u0438\u043D\u0433\u00BB." })) : null] })] })] })] }), _jsxs("section", { className: "fbs-pricing__preview", children: [_jsx("header", { children: _jsxs("div", { children: [_jsx("span", { children: _jsx(BadgeRussianRuble, { size: 18, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("h4", { children: "\u041F\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0440\u0430\u0441\u0447\u0451\u0442 \u043F\u0430\u0440\u0442\u0438\u0438" }), _jsx("p", { children: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442, \u043A\u0430\u043A \u0431\u0443\u0434\u0443\u0442 \u0441\u043A\u043B\u0430\u0434\u044B\u0432\u0430\u0442\u044C\u0441\u044F \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F \u043F\u0440\u0438 \u0442\u0435\u043A\u0443\u0449\u0438\u0445 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u0430\u0445." })] })] }) }), _jsx("div", { children: preview.map((items) => {
                            const calculation = calculateFbsPreview(form, data.serviceOptions, items);
                            return (_jsxs("article", { children: [_jsxs("span", { children: [items, " \u0435\u0434."] }), _jsxs("strong", { children: [formatMoney(calculation.totalRub), " \u20BD"] }), _jsxs("small", { children: ["\u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 ", formatMoney(calculation.processingRub), " \u00B7 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0430", ' ', formatMoney(calculation.deliveryRub), " \u00B7 ", calculation.boxCount, " \u043A\u043E\u0440.", form.palletsEnabled
                                                ? ` · ${calculation.palletCount} пал. (${formatMoney(calculation.palletRub)} ₽)`
                                                : ''] })] }, items));
                        }) })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, saved ? _jsx("p", { className: "fbs-pricing__success", children: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B. \u0427\u0435\u0440\u043D\u043E\u0432\u044B\u0435 \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F \u043F\u0435\u0440\u0435\u0441\u0447\u0438\u0442\u0430\u044E\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438." }) : null, _jsxs("footer", { className: "fbs-pricing__footer", children: [_jsx("p", { children: data.excludedRule }), _jsxs("button", { className: "primary-button", type: "submit", disabled: isSaving, children: [_jsx(Save, { size: 17, "aria-hidden": "true" }), isSaving ? 'Сохраняю' : 'Сохранить стоимость обработки'] })] })] }));
}
function FbsConnectionPrompt({ isOpen, marketplace, accountName, sellerId, apiKey, error, isSubmitting, onOpen, onCancel, onAccountNameChange, onSellerIdChange, onApiKeyChange, onSubmit, }) {
    if (!isOpen) {
        return (_jsxs("div", { className: "fbs-connect-empty", children: [_jsx("span", { children: _jsx(PlugZap, { size: 28, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsxs("strong", { children: ["API ", marketplaceLabel(marketplace), " \u043D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D"] }), _jsxs("p", { children: ["\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u043A\u0430\u0431\u0438\u043D\u0435\u0442 ", marketplaceLabel(marketplace), ", \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u043B\u0443\u0447\u0430\u0442\u044C \u0435\u0433\u043E FBS-\u0437\u0430\u043A\u0430\u0437\u044B \u0438 \u0441\u0442\u0430\u0442\u0443\u0441\u044B."] })] }), _jsxs("button", { className: "primary-button", type: "button", onClick: onOpen, children: [_jsx(PlugZap, { size: 16, "aria-hidden": "true" }), "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C API"] })] }));
    }
    return (_jsxs("form", { className: "fbs-connect-form", onSubmit: onSubmit, children: [_jsxs("div", { className: "fbs-connect-form__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041D\u043E\u0432\u043E\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435" }), _jsx("h4", { children: "API FBS" })] }), _jsx("button", { className: "icon-text-button", type: "button", onClick: onCancel, children: "\u041E\u0442\u043C\u0435\u043D\u0430" })] }), _jsxs("div", { className: "fbs-connect-form__grid", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441" }), _jsx("select", { value: marketplace, disabled: true, children: _jsx("option", { value: marketplace, children: marketplaceLabel(marketplace) }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0430" }), _jsx("input", { value: accountName, onChange: (event) => onAccountNameChange(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \u043E\u0441\u043D\u043E\u0432\u043D\u043E\u0439" })] }), marketplace !== 'WILDBERRIES' ? (_jsxs("label", { children: [_jsx("span", { children: marketplace === 'OZON' ? 'Client-Id Ozon' : 'Campaign ID Яндекс Маркета' }), _jsx("input", { value: sellerId, onChange: (event) => onSellerIdChange(event.target.value), required: true })] })) : null, _jsxs("label", { className: "fbs-connect-form__key", children: [_jsx("span", { children: "API-\u043A\u043B\u044E\u0447" }), _jsx("input", { type: "password", value: apiKey, onChange: (event) => onApiKeyChange(event.target.value), minLength: 8, required: true })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("button", { className: "primary-button", type: "submit", disabled: isSubmitting || apiKey.trim().length < 8, children: [_jsx(PlugZap, { size: 16, "aria-hidden": "true" }), isSubmitting ? 'Подключаю' : `Подключить ${marketplaceLabel(marketplace)}`] })] }));
}
function FbsNotice({ icon: Icon, title, text, tone = 'neutral', }) {
    return (_jsxs("div", { className: `fbs-empty fbs-empty--${tone}`, children: [_jsx("span", { children: _jsx(Icon, { size: 27, "aria-hidden": "true" }) }), _jsx("strong", { children: title }), _jsx("p", { children: text })] }));
}
function editableFbsSettings(data) {
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
function calculateFbsPreview(settings, serviceOptions, items) {
    const servicePriceById = new Map(serviceOptions.map((service) => [service.id, service.isActive ? Number(service.priceRub) : 0]));
    const processingPerItemRub = settings.fbsProcessingPriceRub +
        settings.additionalServices.reduce((sum, selection) => sum +
            (servicePriceById.get(selection.serviceId) ?? 0) * selection.quantityMultiplier, 0);
    const baseDeliveryRub = settings.defaultDeliveryDestination === 'VNUKOVO_SORTING_CENTER'
        ? settings.vnukovoBasePriceRub
        : settings.pickupPointBasePriceRub;
    const extraBlocks = Math.ceil(Math.max(0, items - settings.baseIncludedItems) / Math.max(1, settings.extraBlockItems));
    const deliveryRub = settings.tieredLogisticsEnabled
        ? items <= settings.logisticsFreeItemsLimit
            ? 0
            : settings.logisticsCubicMeterPriceRub
        : baseDeliveryRub + extraBlocks * settings.extraBlockPriceRub;
    const boxCount = Math.ceil(items / Math.max(1, settings.boxCapacityItems));
    const boxesRub = boxCount *
        ((servicePriceById.get(settings.boxFormationServiceId ?? '') ?? 0) +
            (servicePriceById.get(settings.boxMaterialServiceId ?? '') ?? 0));
    const palletCount = settings.palletsEnabled && settings.palletServiceId
        ? Math.ceil(boxCount / Math.max(1, settings.boxesPerPallet))
        : 0;
    const palletRub = palletCount * (servicePriceById.get(settings.palletServiceId ?? '') ?? 0);
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
function nonNegativeNumber(value) {
    return Math.max(0, Number(value) || 0);
}
function nonNegativeInteger(value) {
    return Math.max(0, Math.trunc(Number(value)) || 0);
}
function positiveInteger(value) {
    return Math.max(1, Math.trunc(Number(value)) || 1);
}
function normalizeFbsOrderNumber(value) {
    return value
        .trim()
        .toLocaleLowerCase('ru-RU')
        .replace(/^заказ\s*/u, '')
        .replace(/^№\s*/u, '')
        .replace(/\s+/g, '');
}
function formatFbsRequestSearch(requestNumber) {
    return `Заявка №${String(requestNumber).padStart(6, '0')}`;
}
function parseFbsRequestSearch(value) {
    const match = value.trim().match(/^заявка\s*№?\s*0*(\d+)$/i);
    if (!match)
        return null;
    const number = Number(match[1]);
    return Number.isSafeInteger(number) ? number : null;
}
function fbsCategorySearchLabel(category) {
    if (category === 'active')
        return 'активные заказы';
    if (category === 'shipped')
        return 'отгруженные';
    if (category === 'cancelled')
        return 'отменённые';
    return 'архив';
}
function filterFbsOrdersByMarketplace(source, marketplace) {
    if (!source || !marketplace)
        return null;
    const connections = source.connections.filter((connection) => connection.marketplace === marketplace);
    const orders = source.orders.filter((order) => order.marketplace === marketplace);
    const count = (category) => orders.filter((order) => order.category === category).length;
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
function marketplaceLabel(marketplace) {
    if (marketplace === 'WILDBERRIES')
        return 'Wildberries';
    if (marketplace === 'OZON')
        return 'Ozon';
    return 'Яндекс Маркет';
}
function marketplaceEyebrow(marketplace) {
    if (marketplace === 'WILDBERRIES')
        return 'Wildberries';
    if (marketplace === 'OZON')
        return 'Ozon Seller';
    return 'Яндекс Маркет';
}
function marketplaceTitle(marketplace) {
    if (marketplace === 'WILDBERRIES')
        return 'FBS Wildberries';
    if (marketplace === 'OZON')
        return 'FBS Ozon';
    return 'FBS Яндекс';
}
function fbsOrderWarehouseKey(order) {
    return [
        order.marketplace,
        order.connectionId,
        order.warehouseId || order.officeId || 'unknown',
    ].join(':');
}
function fbsOrderWarehouseLabel(order) {
    const marketplace = order.marketplace === 'WILDBERRIES'
        ? 'WB'
        : order.marketplace === 'OZON'
            ? 'Ozon'
            : 'Яндекс';
    const name = order.warehouseName?.trim();
    if (name)
        return `${marketplace} · ${name}`;
    if (order.warehouseId)
        return `${marketplace} · склад №${order.warehouseId}`;
    if (order.officeId)
        return `${marketplace} · ${order.officeId}`;
    return 'Склад маркетплейса не определён';
}
function groupFbsOrdersByWarehouse(orders, now) {
    const groups = new Map();
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
            itemCount: groupOrders.reduce((sum, order) => sum + Math.max(1, order.itemCount), 0),
            supplyCount: new Set(groupOrders
                .map((order) => order.supplyId)
                .filter((supplyId) => Boolean(supplyId))).size,
            criticalCount: groupOrders.filter((order) => {
                const createdAt = fbsOrderCreatedAt(order);
                return (order.category === 'active' &&
                    createdAt !== null &&
                    now - createdAt >= 19 * 60 * 60 * 1000);
            }).length,
            isUnknown: !first.warehouseId && !first.officeId,
        };
    })
        .sort((left, right) => Number(left.isUnknown) - Number(right.isUnknown) ||
        right.orders.length - left.orders.length ||
        left.label.localeCompare(right.label, 'ru-RU'));
}
function fbsOrderSelectionKey(order) {
    return `${order.connectionId}:${order.id}`;
}
function isFbsOrderMoveCandidate(order) {
    return (order.marketplace === 'WILDBERRIES' &&
        order.category === 'active' &&
        order.supplierStatus === 'confirm' &&
        Boolean(order.supplyId) &&
        Boolean(order.request) &&
        !['PACKED', 'DONE', 'CANCELLED', 'REJECTED'].includes(order.request?.status ?? ''));
}
function compareFbsOrdersOldestFirst(left, right) {
    const leftTime = fbsOrderCreatedAt(left);
    const rightTime = fbsOrderCreatedAt(right);
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
        return leftTime - rightTime;
    }
    if (leftTime !== null)
        return -1;
    if (rightTime !== null)
        return 1;
    return left.id.localeCompare(right.id, 'ru-RU', {
        numeric: true,
        sensitivity: 'base',
    });
}
function compareFbsOrders(left, right, sort) {
    if (sort === 'date-oldest' || sort === 'date-newest') {
        const leftTime = fbsOrderCreatedAt(left);
        const rightTime = fbsOrderCreatedAt(right);
        if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
            return sort === 'date-oldest' ? leftTime - rightTime : rightTime - leftTime;
        }
        if (leftTime !== null && rightTime === null)
            return -1;
        if (leftTime === null && rightTime !== null)
            return 1;
    }
    if (sort === 'request-asc' || sort === 'request-desc') {
        const leftRequest = left.request?.number;
        const rightRequest = right.request?.number;
        if (leftRequest !== undefined && rightRequest !== undefined && leftRequest !== rightRequest) {
            return sort === 'request-asc' ? leftRequest - rightRequest : rightRequest - leftRequest;
        }
        if (leftRequest !== undefined && rightRequest === undefined)
            return -1;
        if (leftRequest === undefined && rightRequest !== undefined)
            return 1;
    }
    if (sort === 'warehouse-asc' || sort === 'warehouse-desc') {
        const result = compareOptionalFbsText(left.warehouseName || left.warehouseId || left.officeId, right.warehouseName || right.warehouseId || right.officeId, sort === 'warehouse-desc');
        if (result !== 0)
            return result;
    }
    if (sort === 'status-asc' || sort === 'status-desc') {
        const result = compareOptionalFbsText(left.statusLabel || left.supplierStatus, right.statusLabel || right.supplierStatus, sort === 'status-desc');
        if (result !== 0)
            return result;
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
function compareOptionalFbsText(left, right, descending) {
    const leftValue = left?.trim() ?? '';
    const rightValue = right?.trim() ?? '';
    if (leftValue && !rightValue)
        return -1;
    if (!leftValue && rightValue)
        return 1;
    const result = leftValue.localeCompare(rightValue, 'ru-RU', {
        numeric: true,
        sensitivity: 'base',
    });
    return descending ? -result : result;
}
function fbsOrderCreatedAt(order) {
    return validTimestamp(order.createdAt) ?? validTimestamp(order.sellerDate);
}
function fbsOrderDeliveryFinishedAt(order) {
    return (validTimestamp(order.shipmentPlan?.sentToWbAt) ??
        (order.category !== 'active' ? validTimestamp(order.deliveryDate) : null));
}
function fbsOrderFinishedDayKey(order) {
    const timestamp = fbsOrderDeliveryFinishedAt(order) ?? fbsOrderCreatedAt(order);
    return timestamp === null ? null : new Date(timestamp).toISOString().slice(0, 10);
}
function validTimestamp(value) {
    if (!value)
        return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}
function formatElapsedDuration(milliseconds) {
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
function fbsOrderAgeTone(milliseconds, category) {
    if (category !== 'active')
        return 'finished';
    const hours = milliseconds / (60 * 60 * 1000);
    if (hours >= 19)
        return 'critical';
    if (hours >= 12)
        return 'warning';
    return 'normal';
}
function groupFbsOrdersBySupply(orders, view, sort) {
    if (view !== 'shipped')
        return groupFbsOrdersBySupplyOnly(orders);
    const baseGroups = groupFbsOrdersBySupplyOnly(orders);
    const dateGroups = new Map();
    for (const group of baseGroups) {
        const day = fbsOrderGroupFinishedDayKey(group) ?? 'unknown';
        dateGroups.set(day, [...(dateGroups.get(day) ?? []), group]);
    }
    const direction = sort === 'date-newest' ? -1 : 1;
    return [...dateGroups.entries()]
        .sort(([leftDay], [rightDay]) => {
        if (leftDay === 'unknown')
            return 1;
        if (rightDay === 'unknown')
            return -1;
        return leftDay.localeCompare(rightDay) * direction;
    })
        .flatMap(([day, groups]) => {
        const dateKey = `date:${day}`;
        const dateOrders = groups.flatMap((group) => group.orders);
        const dateGroup = {
            key: dateKey,
            kind: 'date',
            supplyId: '',
            requestNumber: null,
            requestNumbers: [
                ...new Set(dateOrders
                    .map((order) => order.request?.number)
                    .filter((number) => Boolean(number))),
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
function fbsOrderGroupFinishedDayKey(group) {
    const days = group.orders
        .map(fbsOrderFinishedDayKey)
        .filter((day) => day !== null)
        .sort();
    return days[0] ?? null;
}
function filterFbsShippedOrdersByDate(orders, dateFrom, dateTo) {
    if (!dateFrom && !dateTo)
        return orders;
    const isInPeriod = (order) => {
        const day = fbsOrderFinishedDayKey(order);
        if (dateFrom && (!day || day < dateFrom))
            return false;
        if (dateTo && (!day || day > dateTo))
            return false;
        return true;
    };
    const includedSupplyKeys = new Set(orders
        .filter((order) => Boolean(order.supplyId?.trim()) && isInPeriod(order))
        .map((order) => `${order.connectionId}:${order.supplyId.trim()}`));
    return orders.filter((order) => {
        const supplyId = order.supplyId?.trim();
        if (!supplyId)
            return isInPeriod(order);
        return includedSupplyKeys.has(`${order.connectionId}:${supplyId}`);
    });
}
function groupFbsOrdersBySupplyOnly(orders) {
    const groups = new Map();
    for (const order of orders) {
        const supplyId = order.supplyId?.trim() ?? '';
        const requestId = order.request?.id ?? '';
        const kind = supplyId ? 'supply' : requestId ? 'request' : 'order';
        const key = kind === 'supply'
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
function fbsOrderGroupTitle(group, view) {
    if (group.kind === 'date') {
        const day = group.key.slice('date:'.length);
        if (day === 'unknown') {
            return view === 'shipped' ? 'Дата отгрузки не определена' : 'Дата заказа не определена';
        }
        if (view === 'shipped')
            return `Отгружено ${formatDateOnly(day)}`;
        if (view === 'cancelled')
            return `Отменено ${formatDateOnly(day)}`;
        if (view === 'archive')
            return `Архив за ${formatDateOnly(day)}`;
        return `Заказы за ${formatDateOnly(day)}`;
    }
    if (group.kind === 'request') {
        return `Заявка WMS №${String(group.requestNumber ?? '').padStart(6, '0')}`;
    }
    if (view === 'shipped' && group.supplyId) {
        return `${fbsMarketplaceShipmentLabel(group.orders[0])} ${group.supplyId}`;
    }
    if (view === 'shipped')
        return 'Отгруженные без номера поставки';
    if (view === 'archive')
        return 'Заказы одной поставки';
    if (view === 'cancelled')
        return 'Заказы одной поставки';
    return 'Одна поставка FBS';
}
function fbsOrderGroupWarehouseLabel(group) {
    const warehouses = Array.from(new Set(group.orders
        .map((order) => order.warehouseName?.trim() || order.warehouseId?.trim() || '')
        .filter(Boolean)));
    const marketplace = fbsGroupMarketplaceShortLabel(group);
    if (warehouses.length === 0)
        return `СКЛАД ${marketplace}: НЕ ОПРЕДЕЛЁН`;
    const names = warehouses.map((warehouse) => warehouse.toLocaleUpperCase('ru-RU')).join(' / ');
    return `${warehouses.length > 1 ? 'СКЛАДЫ' : 'СКЛАД'} ${marketplace}: ${names}`;
}
function fbsOrderGroupDescription(group, view, fallbackRequiresCargoPlaces) {
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
function fbsSentToMarketplaceLabel(order) {
    const sender = order.shipmentPlan?.sentToWbBy?.name?.trim() || 'не зафиксирован';
    const sentAt = order.shipmentPlan?.sentToWbAt
        ? ` · ${formatDateTime(order.shipmentPlan.sentToWbAt)}`
        : '';
    return `Отправил в ${marketplaceLabel(order.marketplace)}: ${sender}${sentAt}`;
}
function fbsGroupMarketplaceShortLabel(group) {
    const marketplaces = Array.from(new Set(group.orders.map((order) => order.marketplace)));
    return marketplaces.map((marketplace) => {
        if (marketplace === 'WILDBERRIES')
            return 'WB';
        if (marketplace === 'OZON')
            return 'OZON';
        return 'ЯНДЕКС';
    }).join(' / ') || 'FBS';
}
function fbsMarketplaceShipmentLabel(order) {
    if (order.marketplace === 'WILDBERRIES')
        return 'Поставка WB';
    if (order.marketplace === 'OZON')
        return 'Отправление Ozon';
    return 'Отправление Яндекс';
}
function pluralizeRu(value, one, few, many) {
    const absolute = Math.abs(value) % 100;
    const lastDigit = absolute % 10;
    if (absolute > 10 && absolute < 20)
        return many;
    if (lastDigit === 1)
        return one;
    if (lastDigit >= 2 && lastDigit <= 4)
        return few;
    return many;
}
function estimateFbsCargoPlaces(orders) {
    const groups = new Map();
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
function fbsOrderRequiresCargoPlaces(order, fallback) {
    return order.shipmentPlan?.requiresCargoPlaces ?? fallback;
}
function buildFbsSynchronizationAudit(data, marketplace) {
    const groups = new Map();
    const marketplaceOrders = data.orders.filter((order) => order.marketplace === marketplace);
    for (const order of marketplaceOrders) {
        if (!order.request)
            continue;
        const current = groups.get(order.request.id) ?? { request: order.request, orders: [] };
        current.orders.push(order);
        groups.set(order.request.id, current);
    }
    const closedStatuses = new Set(['DONE', 'CANCELLED', 'REJECTED']);
    const issues = [];
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
        }
        else if (wmsClosed && activeOrders > 0) {
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
function fbsRequestStatusLabel(status) {
    const labels = {
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
function fbsOrderStickerIsAvailable(order) {
    if (order.marketplace === 'WILDBERRIES') {
        return ['confirm', 'complete'].includes(order.supplierStatus);
    }
    if (order.marketplace === 'OZON') {
        return ['awaiting_deliver', 'arbitration', 'delivering', 'delivered'].includes(order.supplierStatus);
    }
    return false;
}
function fbsShipmentDestinationLabel(order, fallbackRequiresCargoPlaces) {
    if (order.marketplace !== 'WILDBERRIES')
        return fbsMarketplaceShipmentLabel(order);
    const requiresCargoPlaces = fbsOrderRequiresCargoPlaces(order, fallbackRequiresCargoPlaces);
    if (!requiresCargoPlaces)
        return 'Сортировочный центр WB';
    const cargoPlaceCount = order.shipmentPlan?.cargoPlaceCount ?? 0;
    return `ПВЗ${cargoPlaceCount > 0 ? ` · ${cargoPlaceCount} грузомест` : ''}`;
}
function downloadFbsBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}
function fileDateTime(value) {
    const part = (number) => String(number).padStart(2, '0');
    return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}_${part(value.getHours())}-${part(value.getMinutes())}`;
}
function formatDateOnly(value) {
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime()))
        return value;
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(parsed);
}
function formatDateTime(value) {
    if (!value)
        return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return value;
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(parsed);
}
function formatMoney(value) {
    return new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(Number(value) || 0);
}
