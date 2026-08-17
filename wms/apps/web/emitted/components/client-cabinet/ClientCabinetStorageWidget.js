import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RefreshCw, Warehouse } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchStorageOverview } from '../../lib/api';
import { formatCabinetMoney, formatCabinetNumber } from './clientCabinetFormat';
export function ClientCabinetStorageWidget({ accessToken, client }) {
    const [state, setState] = useState({ status: 'idle', overview: null });
    const [periodTo, setPeriodTo] = useState(today());
    const periodFrom = monthStart(periodTo);
    useEffect(() => {
        if (!client.storageAccountingEnabled) {
            setState({ status: 'ready', overview: null });
            return;
        }
        let isActive = true;
        setState((current) => ({ ...current, status: current.overview ? 'loading' : 'loading', error: undefined }));
        async function loadStorage() {
            try {
                const overview = await fetchStorageOverview(accessToken, {
                    clientId: client.id,
                    periodFrom,
                    periodTo,
                });
                if (isActive) {
                    setState({ status: 'ready', overview });
                }
            }
            catch (caught) {
                if (isActive) {
                    setState({
                        status: 'error',
                        overview: null,
                        error: caught instanceof Error ? caught.message : 'Не удалось загрузить хранение.',
                    });
                }
            }
        }
        void loadStorage();
        return () => {
            isActive = false;
        };
    }, [accessToken, client.id, client.storageAccountingEnabled, periodFrom, periodTo]);
    function reload() {
        if (!client.storageAccountingEnabled) {
            return;
        }
        const nextDate = today();
        if (nextDate !== periodTo) {
            setPeriodTo(nextDate);
            return;
        }
        setPeriodTo(nextDate);
        setState((current) => ({ ...current, status: 'loading', error: undefined }));
        void fetchStorageOverview(accessToken, {
            clientId: client.id,
            periodFrom,
            periodTo: nextDate,
        })
            .then((overview) => setState({ status: 'ready', overview }))
            .catch((caught) => setState({
            status: 'error',
            overview: null,
            error: caught instanceof Error ? caught.message : 'Не удалось загрузить хранение.',
        }));
    }
    const overview = state.overview;
    const tariff = overview?.tariffRubPerLiterDay ?? numberValue(client.storagePriceRubPerLiterDay);
    const periodLabel = `с ${formatDate(periodFrom)} по ${formatDate(periodTo)}`;
    return (_jsxs("section", { className: "client-storage-widget", "aria-label": "\u0425\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430", children: [_jsxs("div", { className: "client-storage-widget__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0425\u0440\u0430\u043D\u0435\u043D\u0438\u0435" }), _jsx("strong", { children: periodLabel })] }), _jsxs("div", { className: "client-storage-widget__status", children: [_jsx("span", { className: client.storageAccountingEnabled ? 'status status--ready' : 'status status--planned', children: client.storageAccountingEnabled ? 'включено' : 'отключено' }), _jsx("button", { className: "icon-button", type: "button", onClick: reload, disabled: !client.storageAccountingEnabled || state.status === 'loading', title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435", "aria-label": "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435", children: _jsx(RefreshCw, { size: 16, "aria-hidden": "true" }) })] })] }), !client.storageAccountingEnabled ? _jsx("p", { className: "panel-message", children: "\u0423\u0447\u0435\u0442 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u0434\u043B\u044F \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D." }) : null, state.status === 'loading' && !overview ? _jsx("p", { className: "panel-message", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435." }) : null, state.status === 'error' ? _jsx("p", { className: "panel-message panel-message--error", children: state.error }) : null, client.storageAccountingEnabled ? (_jsxs("div", { className: "client-storage-widget__metrics", children: [_jsx(StorageMetric, { label: "\u041B\u0438\u0442\u0440\u043E\u0432 \u0441\u0435\u0439\u0447\u0430\u0441", value: formatCabinetNumber(overview?.totals.totalLiters ?? 0) }), _jsx(StorageMetric, { label: "\u041B\u0438\u0442\u0440\u043E-\u0434\u043D\u0435\u0439", value: formatCabinetNumber(overview?.totals.literDays ?? 0) }), _jsx(StorageMetric, { label: "\u041A \u043E\u043F\u043B\u0430\u0442\u0435 \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434", value: `${formatCabinetMoney(overview?.totals.storageCostRub ?? 0)} ₽` }), _jsx(StorageMetric, { label: "\u0422\u0430\u0440\u0438\u0444", value: `${formatCabinetNumber(tariff)} ₽/л` }), _jsx(StorageMetric, { label: "SKU", value: formatCabinetNumber(overview?.totals.skuCount ?? 0) }), _jsx(StorageMetric, { label: "\u0415\u0434\u0438\u043D\u0438\u0446", value: formatCabinetNumber(overview?.totals.quantity ?? 0) })] })) : null, _jsx(Warehouse, { className: "client-storage-widget__mark", size: 76, "aria-hidden": "true" })] }));
}
function StorageMetric({ label, value }) {
    return (_jsxs("div", { children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] }));
}
function formatDate(value) {
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T00:00:00.000Z`));
}
function numberValue(value) {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
}
function today() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function monthStart(value) {
    const match = value.match(/^(\d{4})-(\d{2})-/);
    return match ? `${match[1]}-${match[2]}-01` : today().replace(/-\d{2}$/, '-01');
}
