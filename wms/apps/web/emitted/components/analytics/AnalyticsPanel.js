import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { BarChart3, Boxes, CheckCircle2, DollarSign, Eye, KeyRound, MapPinned, PackageCheck, RefreshCw, Search, ShieldCheck, ShoppingCart, Sparkles, Target, TrendingUp, TriangleAlert, Warehouse, X, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { connectAnalyticsApi, fetchAnalyticsClients, fetchAnalyticsDashboard, syncAnalyticsDashboard, } from '../../lib/api';
import './analytics.css';
import { useRememberedClientId } from '../../lib/rememberedClient';
const periods = [
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
export function AnalyticsPanel({ session }) {
    const [clients, setClients] = useState([]);
    const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
    const [dashboard, setDashboard] = useState(null);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [periodDays, setPeriodDays] = useState(30);
    const [search, setSearch] = useState('');
    const [availability, setAvailability] = useState('all');
    const [isSyncing, setSyncing] = useState(false);
    const [apiKey, setApiKey] = useState('');
    const [isConnecting, setConnecting] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    useEffect(() => {
        void loadClients();
    }, []);
    useEffect(() => {
        if (selectedClientId)
            void loadDashboard(selectedClientId);
    }, [selectedClientId]);
    async function loadClients(preferredClientId) {
        setStatus('loading');
        setError('');
        try {
            const nextClients = await fetchAnalyticsClients(session.accessToken);
            setClients(nextClients);
            const nextClientId = preferredClientId && nextClients.some((client) => client.id === preferredClientId)
                ? preferredClientId
                : selectedClientId && nextClients.some((client) => client.id === selectedClientId)
                    ? selectedClientId
                    : nextClients[0]?.id || '';
            setSelectedClientId(nextClientId);
            if (!nextClientId)
                setStatus('ready');
        }
        catch (caught) {
            setStatus('error');
            setError(errorMessage(caught));
        }
    }
    async function loadDashboard(clientId = selectedClientId) {
        if (!clientId)
            return;
        setStatus('loading');
        setError('');
        try {
            const nextDashboard = await fetchAnalyticsDashboard(session.accessToken, clientId);
            setDashboard(nextDashboard);
            if (nextDashboard.sync?.periodDays && [7, 30, 90].includes(nextDashboard.sync.periodDays)) {
                setPeriodDays(nextDashboard.sync.periodDays);
            }
            setStatus('ready');
        }
        catch (caught) {
            setStatus('error');
            setError(errorMessage(caught));
        }
    }
    async function sync() {
        if (!selectedClientId)
            return;
        setSyncing(true);
        setError('');
        setMessage('');
        try {
            const nextDashboard = await syncAnalyticsDashboard(session.accessToken, selectedClientId, periodDays);
            setDashboard(nextDashboard);
            setMessage(`Данные Wildberries обновлены за ${periodDays} дней.`);
            await loadClients(selectedClientId);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setSyncing(false);
        }
    }
    async function connect() {
        if (!selectedClientId || !apiKey.trim())
            return;
        setConnecting(true);
        setError('');
        setMessage('');
        try {
            const result = await connectAnalyticsApi(session.accessToken, selectedClientId, apiKey.trim());
            setApiKey('');
            setMessage(`Подключён кабинет WB: ${result.accountName || 'Wildberries'}. Теперь можно загрузить аналитику.`);
            await loadClients(selectedClientId);
            await loadDashboard(selectedClientId);
        }
        catch (caught) {
            setError(errorMessage(caught));
        }
        finally {
            setConnecting(false);
        }
    }
    const products = useMemo(() => {
        const query = search.trim().toLocaleLowerCase('ru-RU');
        return (dashboard?.products.items ?? []).filter((product) => {
            if (availability !== 'all') {
                if (availability === 'outOfStock' ? product.stockCount > 0 : product.availability !== availability)
                    return false;
            }
            if (!query)
                return true;
            return [product.name, product.vendorCode, product.brandName, product.subjectName, product.nmId]
                .filter(Boolean)
                .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(query));
        });
    }, [availability, dashboard, search]);
    const topProducts = useMemo(() => [...(dashboard?.products.items ?? [])].sort((left, right) => right.orderSum - left.orderSum).slice(0, 8), [dashboard]);
    const maxTopRevenue = Math.max(1, ...topProducts.map((product) => product.orderSum));
    const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null;
    const canManageConnection = dashboard?.access.canManageConnection ?? session.user.permissionCodes.includes('system:admin');
    if (status === 'loading' && !dashboard) {
        return _jsx(AnalyticsNotice, { icon: RefreshCw, title: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0443", text: "\u041F\u043E\u043B\u0443\u0447\u0430\u0435\u043C \u0431\u044B\u0441\u0442\u0440\u044B\u0439 \u0441\u0440\u0435\u0437 \u0438\u0437 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0439 \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0439 \u0431\u0430\u0437\u044B.", spin: true });
    }
    if (clients.length === 0 && status !== 'loading') {
        return _jsx(AnalyticsNotice, { icon: ShieldCheck, title: "\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0445 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432", text: "\u041D\u0430\u0437\u043D\u0430\u0447\u044C\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u0438\u0439 \u0434\u043E\u0441\u0442\u0443\u043F \u044D\u0442\u043E\u043C\u0443 \u043B\u043E\u0433\u0438\u043D\u0443 \u0432 \u043F\u0440\u043E\u0444\u0438\u043B\u0435 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F." });
    }
    return (_jsxs("section", { className: "analytics-panel", "aria-label": "\u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430 Wildberries", children: [_jsxs("header", { className: "analytics-hero", children: [_jsx("div", { className: "analytics-hero__glow" }), _jsxs("div", { className: "analytics-hero__title", children: [_jsx("span", { className: "analytics-hero__icon", children: _jsx(Sparkles, { size: 23, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("p", { children: "LOGOFF INTELLIGENCE" }), _jsx("h2", { children: "\u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u0438 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432" }), _jsx("span", { children: "\u041F\u0440\u043E\u0434\u0430\u0436\u0438, \u0432\u043E\u0440\u043E\u043D\u043A\u0430, \u0434\u0435\u0444\u0438\u0446\u0438\u0442, \u043D\u0435\u043B\u0438\u043A\u0432\u0438\u0434 \u0438 \u0441\u0440\u0430\u0432\u043D\u0435\u043D\u0438\u0435 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 WB \u0441 WMS." })] })] }), _jsxs("div", { className: "analytics-hero__controls", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("select", { value: selectedClientId, onChange: (event) => setSelectedClientId(event.target.value), children: clients.map((client) => _jsx("option", { value: client.id, children: client.name }, client.id)) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434" }), _jsx("select", { value: periodDays, onChange: (event) => setPeriodDays(Number(event.target.value)), children: periods.map((period) => _jsx("option", { value: period.value, children: period.label }, period.value)) })] }), _jsxs("button", { className: "analytics-sync-button", type: "button", disabled: !dashboard?.connection.connected || isSyncing, onClick: () => void sync(), children: [_jsx(RefreshCw, { className: isSyncing ? 'spin' : '', size: 17, "aria-hidden": "true" }), isSyncing ? 'Получаю данные' : 'Обновить WB'] })] }), _jsxs("div", { className: "analytics-hero__status", children: [_jsxs("span", { className: dashboard?.connection.connected ? 'ready' : 'missing', children: [dashboard?.connection.connected ? _jsx(CheckCircle2, { size: 15 }) : _jsx(TriangleAlert, { size: 15 }), dashboard?.connection.connected ? dashboard.connection.accountName || 'WB подключён' : 'API не подключён'] }), _jsxs("span", { children: ["\u0414\u0430\u043D\u043D\u044B\u0435: ", dashboard?.sync?.lastSyncedAt ? formatDateTime(dashboard.sync.lastSyncedAt) : 'ещё не загружались'] }), _jsx("span", { children: "\u0425\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435: \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u0430\u044F \u0431\u0430\u0437\u0430 \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0438" })] })] }), error ? _jsxs("div", { className: "analytics-alert analytics-alert--error", children: [_jsx(TriangleAlert, { size: 17 }), error] }) : null, message ? _jsxs("div", { className: "analytics-alert analytics-alert--success", children: [_jsx(CheckCircle2, { size: 17 }), message] }) : null, dashboard?.sync?.lastError ? _jsxs("div", { className: "analytics-alert analytics-alert--warning", children: [_jsx(TriangleAlert, { size: 17 }), dashboard.sync.lastError] }) : null, !dashboard?.connection.connected ? (_jsxs("section", { className: "analytics-empty-source", children: [_jsx(KeyRound, { size: 30, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("h3", { children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u043A\u043B\u044E\u0447 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438 \u00AB\u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430\u00BB Wildberries" }), _jsx("p", { children: "\u041A\u043B\u044E\u0447 \u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F \u0437\u0430\u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u043C \u0432 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0439 \u0431\u0430\u0437\u0435 \u0438 \u043D\u0438\u043A\u043E\u0433\u0434\u0430 \u043D\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u043F\u043E\u0441\u043B\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F." })] }), canManageConnection ? (_jsxs("div", { className: "analytics-key-form", children: [_jsx("input", { type: "password", autoComplete: "off", placeholder: "\u0412\u0441\u0442\u0430\u0432\u044C\u0442\u0435 API-\u043A\u043B\u044E\u0447 WB", value: apiKey, onChange: (event) => setApiKey(event.target.value) }), _jsx("button", { type: "button", disabled: isConnecting || !apiKey.trim(), onClick: () => void connect(), children: isConnecting ? 'Проверяю' : 'Подключить' })] })) : _jsx("strong", { children: "\u041E\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044C \u043A \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0443 WMS." })] })) : null, dashboard && dashboard.sync ? (_jsxs(_Fragment, { children: [_jsxs("section", { className: "analytics-kpis", "aria-label": "\u041A\u043B\u044E\u0447\u0435\u0432\u044B\u0435 \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u0438", children: [_jsx(MetricCard, { icon: DollarSign, label: "\u0417\u0430\u043A\u0430\u0437\u044B, \u0441\u0443\u043C\u043C\u0430", value: money(dashboard.totals.ordersSum, dashboard.sync.currency), detail: `${integer(dashboard.totals.orders)} заказов`, tone: "violet" }), _jsx(MetricCard, { icon: PackageCheck, label: "\u0412\u044B\u043A\u0443\u043F\u044B", value: `${decimal(dashboard.totals.buyoutPercent)}%`, detail: money(dashboard.totals.buyoutsSum, dashboard.sync.currency), tone: "green" }), _jsx(MetricCard, { icon: Warehouse, label: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A \u043D\u0430 WB", value: `${integer(dashboard.totals.wbStock)} шт.`, detail: `${integer(dashboard.totals.products)} карточек`, tone: "blue" }), _jsx(MetricCard, { icon: Boxes, label: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A \u0432 LOGOFF", value: `${integer(dashboard.totals.wmsStock)} шт.`, detail: `Связано с WB: ${integer(dashboard.totals.wmsMatchedStock)} · вне отчёта WB: ${integer(dashboard.totals.wmsUnlinkedStock)}`, tone: "cyan" }), _jsx(MetricCard, { icon: TriangleAlert, label: "\u0423\u043F\u0443\u0449\u0435\u043D\u043D\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B", value: money(dashboard.totals.lostOrdersSum, dashboard.sync.currency), detail: `${dashboard.totals.outOfStock} без остатка · ${dashboard.totals.lowStock} дефицит`, tone: "orange" })] }), dashboard.regionalAnalytics.available ? (_jsxs(_Fragment, { children: [_jsxs("section", { className: "analytics-card analytics-regional-intelligence", children: [_jsxs("div", { className: "analytics-card__heading analytics-regional-heading", children: [_jsxs("div", { children: [_jsx(MapPinned, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: "\u041F\u0440\u043E\u0432\u0430\u043B\u044B \u0438 \u043F\u043E\u0442\u0435\u043D\u0446\u0438\u0430\u043B \u043F\u043E \u0440\u0435\u0433\u0438\u043E\u043D\u0430\u043C" }), _jsxs("small", { children: [dashboard.regionalAnalytics.demandSource === 'REGIONAL_SALES' ? 'Фактические продажи' : 'Расчётный спрос по оборачиваемости WB', " \u0437\u0430 ", dashboard.regionalAnalytics.periodDays, " \u0434\u043D\u0435\u0439, \u043E\u0441\u0442\u0430\u0442\u043E\u043A WB \u0438 \u0446\u0435\u043B\u044C \u043F\u043E\u043A\u0440\u044B\u0442\u0438\u044F ", dashboard.regionalAnalytics.targetDays, " \u0434\u043D\u0435\u0439"] })] })] }), _jsx("span", { className: "analytics-model-badge", children: "\u041C\u043E\u0434\u0435\u043B\u044C \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438" })] }), _jsxs("div", { className: "analytics-regional-summary", children: [_jsxs("article", { children: [_jsx("small", { children: "\u0420\u0435\u0433\u0438\u043E\u043D\u043E\u0432 \u0441 \u0434\u0435\u0444\u0438\u0446\u0438\u0442\u043E\u043C" }), _jsx("strong", { children: integer(dashboard.regionalAnalytics.summary.shortageRegions) }), _jsxs("em", { children: ["\u0438\u0437 ", integer(dashboard.regionalAnalytics.summary.regions)] })] }), _jsxs("article", { children: [_jsx("small", { children: "\u0420\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0443\u0435\u0442\u0441\u044F \u043F\u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C" }), _jsxs("strong", { children: [integer(dashboard.regionalAnalytics.summary.recommendedSupply), " \u0448\u0442."] }), _jsxs("em", { children: ["\u0434\u043E \u043F\u043E\u043A\u0440\u044B\u0442\u0438\u044F ", dashboard.regionalAnalytics.targetDays, " \u0434\u043D\u0435\u0439"] })] }), _jsxs("article", { children: [_jsx("small", { children: "\u0418\u0437\u0431\u044B\u0442\u043E\u0447\u043D\u044B\u0439 \u0437\u0430\u043F\u0430\u0441" }), _jsxs("strong", { children: [integer(dashboard.regionalAnalytics.summary.excessStock), " \u0448\u0442."] }), _jsx("em", { children: "\u043F\u043E\u043A\u0440\u044B\u0442\u0438\u0435 \u0431\u043E\u043B\u0435\u0435 60 \u0434\u043D\u0435\u0439" })] }), _jsxs("article", { children: [_jsx("small", { children: dashboard.regionalAnalytics.demandSource === 'REGIONAL_SALES' ? 'Продажи по регионам' : 'Расчётный спрос' }), _jsxs("strong", { children: [integer(dashboard.regionalAnalytics.summary.salesQty), " \u0448\u0442."] }), _jsx("em", { children: dashboard.regionalAnalytics.demandSource === 'REGIONAL_SALES' ? money(dashboard.regionalAnalytics.summary.salesAmount, dashboard.sync.currency) : 'оценка на базе saleRate WB' })] })] }), _jsx("div", { className: "analytics-table-wrap analytics-region-table-wrap", children: _jsxs("table", { className: "analytics-table analytics-region-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0420\u0435\u0433\u0438\u043E\u043D" }), _jsx("th", { children: "\u041F\u0440\u043E\u0434\u0430\u0436\u0438" }), _jsx("th", { children: "\u0414\u0438\u043D\u0430\u043C\u0438\u043A\u0430" }), _jsx("th", { children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A WB" }), _jsx("th", { children: "\u041F\u043E\u043A\u0440\u044B\u0442\u0438\u0435" }), _jsx("th", { children: "\u041F\u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C" }), _jsx("th", { children: "\u0413\u043B\u0430\u0432\u043D\u044B\u0439 \u0441\u043A\u043B\u0430\u0434" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" })] }) }), _jsx("tbody", { children: dashboard.regionalAnalytics.regions.map((region) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: region.regionName }), _jsxs("small", { className: "analytics-cell-note", children: ["\u0441\u043F\u0440\u043E\u0441 ", decimal(region.salesSharePercent), "% \u00B7 \u0437\u0430\u043F\u0430\u0441 ", decimal(region.stockSharePercent), "%"] })] }), _jsxs("td", { children: [integer(region.salesQty), " \u0448\u0442.", _jsx("small", { className: "analytics-cell-note", children: money(region.salesAmount, dashboard.sync?.currency || 'RUB') })] }), _jsx("td", { children: dashboard.regionalAnalytics.dynamicsAvailable ? _jsx(DynamicValue, { value: region.salesDynamicPercent }) : '—' }), _jsxs("td", { children: [integer(region.stockCount), " \u0448\u0442."] }), _jsx("td", { children: region.coverageDays === null ? '—' : `${decimal(region.coverageDays)} дн.` }), _jsx("td", { children: _jsx("strong", { className: region.recommendedSupply > 0 ? 'analytics-supply-positive' : '', children: region.recommendedSupply > 0 ? `${integer(region.recommendedSupply)} шт.` : '—' }) }), _jsxs("td", { children: [region.topWarehouse || '—', _jsx("small", { className: "analytics-cell-note", children: region.topWarehouse ? `${integer(region.topWarehouseStock)} шт.` : '' })] }), _jsx("td", { children: _jsx(RegionalStatusBadge, { value: region.status }) })] }, region.regionName))) })] }) })] }), _jsxs("section", { className: "analytics-card analytics-placement-actions", children: [_jsxs("div", { className: "analytics-card__heading analytics-regional-heading", children: [_jsxs("div", { children: [_jsx(Target, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: "\u041A\u0443\u0434\u0430 \u0438 \u043A\u0430\u043A\u043E\u0439 \u0442\u043E\u0432\u0430\u0440 \u043F\u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C" }), _jsx("small", { children: "\u041F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442\u043D\u044B\u0435 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u0438\u0437 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043E\u0441\u0442\u0430\u0442\u043A\u0430 LOGOFF" })] })] }), _jsx("span", { className: "analytics-count", children: dashboard.regionalAnalytics.productActions.length })] }), _jsxs("div", { className: "analytics-model-note", children: [_jsx(TriangleAlert, { size: 15 }), _jsx("span", { children: dashboard.regionalAnalytics.limitation })] }), !dashboard.regionalAnalytics.productActionsAvailable ? (_jsx(AnalyticsEmpty, { text: "WB \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0438\u043B \u0432\u044B\u0433\u0440\u0443\u0437\u043A\u0443 \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u043F\u0440\u043E\u0434\u0430\u0436. \u0420\u0435\u0433\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u0434\u0435\u0444\u0438\u0446\u0438\u0442\u044B \u0443\u0436\u0435 \u0440\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u043D\u044B; \u0442\u043E\u0432\u0430\u0440\u043D\u0430\u044F \u0434\u0435\u0442\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F \u0437\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0441\u044F \u043F\u0440\u0438 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u0443\u0441\u043F\u0435\u0448\u043D\u043E\u043C \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438." })) : dashboard.regionalAnalytics.productActions.length ? (_jsx("div", { className: "analytics-placement-list", children: dashboard.regionalAnalytics.productActions.slice(0, 30).map((action) => (_jsxs("article", { children: [_jsxs("div", { className: "analytics-placement-product", children: [action.photoUrl ? _jsx("img", { src: action.photoUrl, alt: "", loading: "lazy" }) : _jsx("span", { children: _jsx(Boxes, { size: 17 }) }), _jsxs("span", { children: [_jsx("strong", { children: action.name }), _jsx("small", { children: action.vendorCode || `WB ${action.nmId}` })] })] }), _jsxs("div", { children: [_jsx("small", { children: "\u0420\u0435\u0433\u0438\u043E\u043D" }), _jsx("strong", { children: action.regionName }), _jsxs("em", { children: [decimal(action.demandSharePercent), "% \u0441\u043F\u0440\u043E\u0441\u0430 \u0442\u043E\u0432\u0430\u0440\u0430"] })] }), _jsxs("div", { children: [_jsx("small", { children: "\u0420\u0430\u0441\u0447\u0451\u0442\u043D\u044B\u0439 \u043F\u0440\u043E\u0432\u0430\u043B" }), _jsxs("strong", { children: [integer(action.gap), " \u0448\u0442."] }), _jsxs("em", { children: ["\u0446\u0435\u043B\u044C ", integer(action.targetRegionStock), " \u00B7 \u043E\u0446\u0435\u043D\u043A\u0430 \u043E\u0441\u0442\u0430\u0442\u043A\u0430 ", integer(action.estimatedRegionStock)] })] }), _jsxs("div", { children: [_jsx("small", { children: "\u041F\u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0441\u0435\u0439\u0447\u0430\u0441" }), _jsxs("strong", { className: "analytics-supply-positive", children: [integer(action.recommendedQty), " \u0448\u0442."] }), _jsxs("em", { children: ["\u0432 LOGOFF ", integer(action.wmsStock), " \u0448\u0442."] })] }), _jsxs("div", { children: [_jsx("small", { children: "\u0414\u0438\u043D\u0430\u043C\u0438\u043A\u0430 \u0441\u043F\u0440\u043E\u0441\u0430" }), _jsx(DynamicValue, { value: action.salesDynamicPercent }), _jsx("em", { children: action.reason })] })] }, `${action.nmId}:${action.regionName}`))) })) : _jsx(AnalyticsEmpty, { text: "\u041F\u043E \u0442\u0435\u043A\u0443\u0449\u0435\u043C\u0443 \u0441\u043F\u0440\u043E\u0441\u0443 \u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u043C\u0443 \u043E\u0441\u0442\u0430\u0442\u043A\u0443 LOGOFF \u0441\u0440\u043E\u0447\u043D\u044B\u0445 \u0440\u0435\u0433\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0445 \u043F\u043E\u0441\u0442\u0430\u0432\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E." })] })] })) : (_jsxs("div", { className: "analytics-alert analytics-alert--warning", children: [_jsx(TriangleAlert, { size: 17 }), "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 WB, \u0447\u0442\u043E\u0431\u044B \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043F\u0440\u043E\u0434\u0430\u0436\u0438 \u043F\u043E \u0440\u0435\u0433\u0438\u043E\u043D\u0430\u043C \u0438 \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0430\u0446\u0438\u0438 \u043F\u043E \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0430\u043C."] })), _jsxs("div", { className: "analytics-grid analytics-grid--insights", children: [_jsxs("section", { className: "analytics-card analytics-recommendations", children: [_jsxs("div", { className: "analytics-card__heading", children: [_jsxs("div", { children: [_jsx(TrendingUp, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: "\u0427\u0442\u043E \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u0432\u043D\u0438\u043C\u0430\u043D\u0438\u044F" }), _jsx("small", { children: "\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u043F\u043E \u0442\u043E\u0432\u0430\u0440\u0430\u043C" })] })] }), _jsx("span", { className: "analytics-count", children: dashboard.recommendations.length })] }), dashboard.recommendations.length ? (_jsx("div", { className: "analytics-recommendation-list", children: dashboard.recommendations.slice(0, 10).map((item) => (_jsxs("button", { className: `analytics-recommendation severity-${item.severity.toLowerCase()}`, type: "button", onClick: () => setSelectedProduct(dashboard.products.items.find((product) => product.nmId === item.nmId) ?? null), children: [_jsx("span", { className: "analytics-recommendation__marker" }), _jsxs("span", { children: [_jsx("strong", { children: item.name }), _jsx("small", { children: item.message })] }), _jsx("em", { children: recommendationValue(item.kind, item.value, dashboard.sync?.currency || 'RUB') })] }, `${item.kind}:${item.nmId}`))) })) : _jsx(AnalyticsEmpty, { text: "\u041A\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0438\u0439 \u043F\u043E \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u043C \u0442\u043E\u0432\u0430\u0440\u0430\u043C \u043D\u0435\u0442." })] }), _jsxs("section", { className: "analytics-card analytics-top-chart", children: [_jsx("div", { className: "analytics-card__heading", children: _jsxs("div", { children: [_jsx(BarChart3, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: "\u041B\u0438\u0434\u0435\u0440\u044B \u043F\u043E \u0437\u0430\u043A\u0430\u0437\u0430\u043C" }), _jsx("small", { children: "\u0421\u0443\u043C\u043C\u0430 \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u0437\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434" })] })] }) }), _jsx("div", { className: "analytics-bars", children: topProducts.map((product, index) => (_jsxs("button", { type: "button", onClick: () => setSelectedProduct(product), children: [_jsx("span", { className: "analytics-bars__rank", children: index + 1 }), _jsxs("span", { className: "analytics-bars__label", children: [_jsx("strong", { children: product.name }), _jsx("small", { children: product.vendorCode || `WB ${product.nmId}` })] }), _jsx("span", { className: "analytics-bars__track", children: _jsx("i", { style: { width: `${Math.max(3, (product.orderSum / maxTopRevenue) * 100)}%` } }) }), _jsx("em", { children: compactMoney(product.orderSum, dashboard.sync?.currency || 'RUB') })] }, product.nmId))) })] })] }), _jsxs("section", { className: "analytics-card analytics-products", children: [_jsxs("div", { className: "analytics-card__heading analytics-products__heading", children: [_jsxs("div", { children: [_jsx(ShoppingCart, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: "\u0422\u043E\u0432\u0430\u0440\u044B" }), _jsx("small", { children: "\u041F\u0440\u043E\u0434\u0430\u0436\u0438, \u043A\u043E\u043D\u0432\u0435\u0440\u0441\u0438\u044F \u0438 \u043E\u0441\u0442\u0430\u0442\u043A\u0438 WB / LOGOFF" })] })] }), _jsxs("div", { className: "analytics-products__filters", children: [_jsxs("label", { className: "analytics-search", children: [_jsx(Search, { size: 16 }), _jsx("input", { placeholder: "\u0422\u043E\u0432\u0430\u0440, \u0430\u0440\u0442\u0438\u043A\u0443\u043B \u0438\u043B\u0438 nmID", value: search, onChange: (event) => setSearch(event.target.value) })] }), _jsx("select", { value: availability, onChange: (event) => setAvailability(event.target.value), children: availabilityOptions.map((option) => _jsx("option", { value: option.value, children: option.label }, option.value)) }), _jsx("span", { children: products.length })] })] }), _jsx("div", { className: "analytics-table-wrap", children: _jsxs("table", { className: "analytics-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u0417\u0430\u043A\u0430\u0437\u044B" }), _jsx("th", { children: "\u0421\u0443\u043C\u043C\u0430" }), _jsx("th", { children: "\u041A\u043E\u043D\u0432\u0435\u0440\u0441\u0438\u044F" }), _jsx("th", { children: "\u0412\u044B\u043A\u0443\u043F" }), _jsx("th", { children: "WB" }), _jsx("th", { children: "LOGOFF" }), _jsx("th", { children: "\u0414\u0438\u043D\u0430\u043C\u0438\u043A\u0430" })] }) }), _jsx("tbody", { children: products.map((product) => (_jsxs("tr", { onClick: () => setSelectedProduct(product), children: [_jsx("td", { children: _jsx(ProductIdentity, { product: product }) }), _jsx("td", { children: _jsx(AvailabilityBadge, { value: product.stockCount <= 0 ? 'outOfStock' : product.availability }) }), _jsx("td", { children: integer(product.orderCount) }), _jsx("td", { children: money(product.orderSum, dashboard.sync?.currency || 'RUB') }), _jsxs("td", { children: [decimal(product.cartToOrderPercent), "%"] }), _jsxs("td", { children: [decimal(product.funnelBuyoutPercent), "%"] }), _jsx("td", { children: _jsx("strong", { children: integer(product.stockCount) }) }), _jsx("td", { children: _jsx("strong", { children: integer(product.wmsStock) }) }), _jsx("td", { children: _jsx(DynamicValue, { value: product.orderCountDynamic }) })] }, product.nmId))) })] }) }), !products.length ? _jsx(AnalyticsEmpty, { text: "\u041F\u043E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u043C \u0444\u0438\u043B\u044C\u0442\u0440\u0430\u043C \u0442\u043E\u0432\u0430\u0440\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B." }) : null] }), _jsxs("div", { className: "analytics-grid analytics-grid--bottom", children: [_jsxs("section", { className: "analytics-card", children: [_jsx("div", { className: "analytics-card__heading", children: _jsxs("div", { children: [_jsx(Warehouse, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: "\u0420\u0435\u0433\u0438\u043E\u043D\u044B \u0438 \u0441\u043A\u043B\u0430\u0434\u044B WB" }), _jsx("small", { children: "\u041E\u0441\u0442\u0430\u0442\u043A\u0438 \u0438 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0435 \u043A \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044E" })] })] }) }), dashboard.regions.length ? (_jsx("div", { className: "analytics-region-list", children: dashboard.regions.slice(0, 14).map((region, index) => (_jsxs("div", { children: [_jsxs("span", { children: [_jsx("strong", { children: region.officeName || region.regionName }), _jsx("small", { children: region.officeName ? region.regionName : 'Регион' })] }), _jsxs("span", { children: [_jsxs("strong", { children: [integer(region.stockCount), " \u0448\u0442."] }), _jsxs("small", { children: ["\u043A \u043A\u043B\u0438\u0435\u043D\u0442\u0443 ", integer(region.toClientCount), " \u00B7 \u0432\u043E\u0437\u0432\u0440\u0430\u0442 ", integer(region.fromClientCount)] })] })] }, `${region.officeId || 'region'}:${region.regionName}:${index}`))) })) : _jsx(AnalyticsEmpty, { text: "\u0414\u0435\u0442\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F \u043F\u043E \u0440\u0435\u0433\u0438\u043E\u043D\u0430\u043C \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u044D\u0442\u043E\u043C\u0443 \u043A\u043B\u044E\u0447\u0443 WB; \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u0438 \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u0440\u0430\u0431\u043E\u0442\u0430\u044E\u0442." })] }), canManageConnection ? (_jsxs("section", { className: "analytics-card analytics-source-admin", children: [_jsx("div", { className: "analytics-card__heading", children: _jsxs("div", { children: [_jsx(KeyRound, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430" }), _jsx("small", { children: "\u0422\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430" })] })] }) }), _jsxs("p", { children: ["\u041A\u043B\u0438\u0435\u043D\u0442: ", _jsx("strong", { children: selectedClient?.name })] }), _jsxs("p", { children: ["\u041A\u0430\u0431\u0438\u043D\u0435\u0442 WB: ", _jsx("strong", { children: dashboard.connection.accountName || 'не определён' })] }), _jsxs("p", { children: ["\u041A\u043B\u044E\u0447 \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D: ", _jsx("strong", { children: dashboard.connection.lastVerifiedAt ? formatDateTime(dashboard.connection.lastVerifiedAt) : '—' })] }), _jsxs("div", { className: "analytics-key-form analytics-key-form--inline", children: [_jsx("input", { type: "password", autoComplete: "off", placeholder: "\u041D\u043E\u0432\u044B\u0439 API-\u043A\u043B\u044E\u0447 WB", value: apiKey, onChange: (event) => setApiKey(event.target.value) }), _jsx("button", { type: "button", disabled: isConnecting || !apiKey.trim(), onClick: () => void connect(), children: isConnecting ? 'Проверяю' : 'Заменить ключ' })] }), _jsxs("small", { children: [_jsx(ShieldCheck, { size: 14 }), " \u041A\u043B\u044E\u0447 \u0437\u0430\u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D AES-256-GCM \u0438 \u043D\u0435 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442\u0441\u044F \u0447\u0435\u0440\u0435\u0437 API."] })] })) : null] })] })) : dashboard?.connection.connected ? (_jsxs("section", { className: "analytics-first-sync", children: [_jsx(BarChart3, { size: 34 }), _jsx("h3", { children: "\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D. \u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u043F\u0435\u0440\u0432\u044B\u0439 \u0441\u0440\u0435\u0437 \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0438." }), _jsx("p", { children: "\u0411\u0443\u0434\u0443\u0442 \u0441\u043E\u0431\u0440\u0430\u043D\u044B \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0438, \u043F\u0440\u043E\u0434\u0430\u0436\u0438, \u0432\u043E\u0440\u043E\u043D\u043A\u0430, \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u0438 \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0430\u0446\u0438\u0438 \u0437\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434." }), _jsxs("button", { type: "button", disabled: isSyncing, onClick: () => void sync(), children: [_jsx(RefreshCw, { className: isSyncing ? 'spin' : '', size: 17 }), isSyncing ? 'Получаю данные WB' : 'Загрузить аналитику'] })] })) : null, selectedProduct ? _jsx(ProductModal, { product: selectedProduct, currency: dashboard?.sync?.currency || 'RUB', onClose: () => setSelectedProduct(null) }) : null] }));
}
function MetricCard({ icon: Icon, label, value, detail, tone }) {
    return _jsxs("article", { className: `analytics-metric tone-${tone}`, children: [_jsx("span", { children: _jsx(Icon, { size: 19 }) }), _jsxs("div", { children: [_jsx("small", { children: label }), _jsx("strong", { children: value }), _jsx("em", { children: detail })] })] });
}
function ProductIdentity({ product }) {
    return _jsxs("div", { className: "analytics-product-identity", children: [product.photoUrl ? _jsx("img", { src: product.photoUrl, alt: "", loading: "lazy" }) : _jsx("span", { children: _jsx(Boxes, { size: 18 }) }), _jsxs("div", { children: [_jsx("strong", { children: product.name }), _jsxs("small", { children: [product.vendorCode || 'Без артикула', " \u00B7 WB ", product.nmId] })] })] });
}
function AvailabilityBadge({ value }) {
    return _jsx("span", { className: `analytics-availability availability-${value || 'unknown'}`, children: availabilityLabel(value) });
}
function RegionalStatusBadge({ value }) {
    return _jsx("span", { className: `analytics-region-status status-${value.toLowerCase()}`, children: regionalStatusLabel(value) });
}
function DynamicValue({ value }) {
    const className = value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
    return _jsxs("span", { className: `analytics-dynamic ${className}`, children: [value > 0 ? '+' : '', decimal(value), "%"] });
}
function ProductModal({ product, currency, onClose }) {
    return (_jsx("div", { className: "analytics-modal-backdrop", role: "presentation", onMouseDown: (event) => { if (event.target === event.currentTarget)
            onClose(); }, children: _jsxs("section", { className: "analytics-product-modal", role: "dialog", "aria-modal": "true", "aria-label": product.name, children: [_jsx("button", { className: "analytics-modal-close", type: "button", onClick: onClose, children: _jsx(X, { size: 19 }) }), _jsx(ProductIdentity, { product: product }), _jsxs("div", { className: "analytics-product-modal__badges", children: [_jsx(AvailabilityBadge, { value: product.stockCount <= 0 ? 'outOfStock' : product.availability }), _jsx(DynamicValue, { value: product.orderCountDynamic })] }), _jsxs("div", { className: "analytics-product-modal__metrics", children: [_jsxs("span", { children: [_jsx("small", { children: "\u0417\u0430\u043A\u0430\u0437\u044B" }), _jsx("strong", { children: integer(product.orderCount) }), _jsx("em", { children: money(product.orderSum, currency) })] }), _jsxs("span", { children: [_jsx("small", { children: "\u041F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u044B" }), _jsx("strong", { children: integer(product.openCount) }), _jsxs("em", { children: ["\u043A\u043E\u0440\u0437\u0438\u043D\u0430 ", integer(product.cartCount)] })] }), _jsxs("span", { children: [_jsx("small", { children: "\u041A\u043E\u043D\u0432\u0435\u0440\u0441\u0438\u044F" }), _jsxs("strong", { children: [decimal(product.cartToOrderPercent), "%"] }), _jsxs("em", { children: ["\u0432 \u043A\u043E\u0440\u0437\u0438\u043D\u0443 ", decimal(product.addToCartPercent), "%"] })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0412\u044B\u043A\u0443\u043F" }), _jsxs("strong", { children: [decimal(product.funnelBuyoutPercent), "%"] }), _jsxs("em", { children: [integer(product.funnelBuyoutCount), " \u0448\u0442."] })] }), _jsxs("span", { children: [_jsx("small", { children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A WB" }), _jsx("strong", { children: integer(product.stockCount) }), _jsx("em", { children: money(product.stockSum, currency) })] }), _jsxs("span", { children: [_jsx("small", { children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A LOGOFF" }), _jsx("strong", { children: integer(product.wmsStock) }), _jsxs("em", { children: [product.wmsSkuCount, " SKU"] })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0423\u043F\u0443\u0449\u0435\u043D\u043E" }), _jsx("strong", { children: money(product.lostOrdersSum, currency) }), _jsxs("em", { children: [decimal(product.lostOrdersCount), " \u0437\u0430\u043A\u0430\u0437\u0430"] })] }), _jsxs("span", { children: [_jsx("small", { children: "\u041E\u0431\u043E\u0440\u0430\u0447\u0438\u0432\u0430\u0435\u043C\u043E\u0441\u0442\u044C" }), _jsx("strong", { children: product.turnoverDays === null ? '—' : `${decimal(product.turnoverDays)} дн.` }), _jsxs("em", { children: ["\u0441\u043A\u043E\u0440\u043E\u0441\u0442\u044C ", product.saleRateDays === null ? '—' : `${decimal(product.saleRateDays)} дн.`] })] })] })] }) }));
}
function AnalyticsNotice({ icon: Icon, title, text, spin = false }) {
    return _jsxs("div", { className: "analytics-notice", children: [_jsx(Icon, { className: spin ? 'spin' : '', size: 28 }), _jsx("h2", { children: title }), _jsx("p", { children: text })] });
}
function AnalyticsEmpty({ text }) {
    return _jsxs("div", { className: "analytics-empty", children: [_jsx(Eye, { size: 20 }), _jsx("span", { children: text })] });
}
function recommendationValue(kind, value, currency) {
    if (kind === 'OUT_OF_STOCK')
        return compactMoney(value, currency);
    if (kind === 'LOW_CONVERSION' || kind === 'GROWTH')
        return `${decimal(value)}%`;
    return `${integer(value)} шт.`;
}
function availabilityLabel(value) {
    return { outOfStock: 'Нет остатка', deficient: 'Дефицит', actual: 'Хорошо продаётся', balanced: 'Баланс', nonActual: 'Слабые продажи', nonLiquid: 'Неликвид', invalidData: 'Нет данных' }[value || ''] || 'Без оценки';
}
function regionalStatusLabel(value) {
    const labels = {
        CRITICAL: 'Критический дефицит',
        SHORTAGE: 'Нужно пополнить',
        OVERSTOCK: 'Избыток',
        BALANCED: 'Баланс',
        NO_DEMAND: 'Нет спроса',
        NO_DATA: 'Нет данных',
    };
    return labels[value];
}
function money(value, currency = 'RUB') {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value || 0);
}
function compactMoney(value, currency = 'RUB') {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}
function integer(value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value || 0);
}
function decimal(value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value || 0);
}
function formatDateTime(value) {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось загрузить аналитику.';
}
