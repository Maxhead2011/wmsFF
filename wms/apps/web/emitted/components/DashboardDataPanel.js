import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Database, RefreshCw, ShieldCheck, Truck, UsersRound, XCircle, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchClients, fetchLogisticsTariffSets, fetchRoles, fetchStockBalances, downloadTsdReceiptReviewBoxesXlsx, fetchTsdReceiptReviewDashboard, fetchTsdReviewHistory, fetchTsdReviewQueue, resolveTsdReviewOperation, } from '../lib/api';
import { stockStatusLabel } from './client-cabinet/clientCabinetFormat';
import { TsdReceiptReviewPanel } from './tsd/TsdReceiptReviewPanel';
const dataTabs = [
    { id: 'clients', label: 'Клиенты', permission: 'clients:read', icon: UsersRound },
    { id: 'stock', label: 'Остатки', permission: 'stock:read', icon: Database },
    { id: 'tsdReview', label: 'Разбор ТСД', permission: 'stock:write', icon: AlertTriangle },
    { id: 'tsdHistory', label: 'История ТСД', permission: 'stock:write', icon: ClipboardCheck },
    { id: 'roles', label: 'Роли', permission: 'users:read', icon: ShieldCheck },
    { id: 'tariffs', label: 'Логистика', permission: 'logistics:read', icon: Truck },
];
const tsdReviewReasonOptions = [
    'INVENTORY_MISMATCH',
    'SKU_NOT_FOUND',
    'BOX_NOT_FOUND',
    'RECEIPT_FAILED',
    'DEVICE_MISMATCH',
    'VALIDATION_ERROR',
    'MANUAL_REJECT',
    'OTHER',
];
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});
export function DashboardDataPanel({ session }) {
    const [activeTab, setActiveTab] = useState('clients');
    const [clients, setClients] = useState({ status: 'idle', data: [] });
    const [stock, setStock] = useState({ status: 'idle', data: [] });
    const [tsdReview, setTsdReview] = useState({ status: 'idle', data: [] });
    const [tsdReceiptReview, setTsdReceiptReview] = useState({
        status: 'idle',
        data: null,
    });
    const [tsdHistory, setTsdHistory] = useState({ status: 'idle', data: [] });
    const [roles, setRoles] = useState({ status: 'idle', data: [] });
    const [tariffs, setTariffs] = useState({ status: 'idle', data: [] });
    const [rejectReasons, setRejectReasons] = useState({});
    const availableTabs = useMemo(() => dataTabs.filter((tab) => canUse(session.user, tab.permission)), [session.user]);
    const activeTabMeta = availableTabs.find((tab) => tab.id === activeTab);
    useEffect(() => {
        if (availableTabs.length > 0 && !activeTabMeta) {
            setActiveTab(availableTabs[0].id);
        }
    }, [activeTabMeta, availableTabs]);
    useEffect(() => {
        if (activeTabMeta) {
            void loadTab(activeTabMeta.id);
        }
    }, [activeTabMeta?.id]);
    async function loadTab(tab, force = false) {
        if (tab === 'clients') {
            if (!force && clients.status !== 'idle') {
                return;
            }
            setClients((current) => ({ ...current, status: 'loading', error: undefined }));
            try {
                setClients({ status: 'ready', data: await fetchClients(session.accessToken) });
            }
            catch (caught) {
                setClients((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
            }
        }
        if (tab === 'stock') {
            if (!force && stock.status !== 'idle') {
                return;
            }
            setStock((current) => ({ ...current, status: 'loading', error: undefined }));
            try {
                setStock({ status: 'ready', data: await fetchStockBalances(session.accessToken) });
            }
            catch (caught) {
                setStock((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
            }
        }
        if (tab === 'tsdReview') {
            if (!force && tsdReview.status !== 'idle' && tsdReceiptReview.status !== 'idle') {
                return;
            }
            setTsdReview((current) => ({ ...current, status: 'loading', error: undefined }));
            setTsdReceiptReview((current) => ({ ...current, status: 'loading', error: undefined }));
            try {
                const [queue, receiptDashboard] = await Promise.all([
                    fetchTsdReviewQueue(session.accessToken),
                    fetchTsdReceiptReviewDashboard(session.accessToken),
                ]);
                setTsdReview({ status: 'ready', data: queue });
                setTsdReceiptReview({ status: 'ready', data: receiptDashboard });
            }
            catch (caught) {
                setTsdReview((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
                setTsdReceiptReview((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
            }
        }
        if (tab === 'tsdHistory') {
            if (!force && tsdHistory.status !== 'idle') {
                return;
            }
            setTsdHistory((current) => ({ ...current, status: 'loading', error: undefined }));
            try {
                setTsdHistory({ status: 'ready', data: await fetchTsdReviewHistory(session.accessToken) });
            }
            catch (caught) {
                setTsdHistory((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
            }
        }
        if (tab === 'roles') {
            if (!force && roles.status !== 'idle') {
                return;
            }
            setRoles((current) => ({ ...current, status: 'loading', error: undefined }));
            try {
                setRoles({ status: 'ready', data: await fetchRoles(session.accessToken) });
            }
            catch (caught) {
                setRoles((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
            }
        }
        if (tab === 'tariffs') {
            if (!force && tariffs.status !== 'idle') {
                return;
            }
            setTariffs((current) => ({ ...current, status: 'loading', error: undefined }));
            try {
                setTariffs({ status: 'ready', data: await fetchLogisticsTariffSets(session.accessToken) });
            }
            catch (caught) {
                setTariffs((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
            }
        }
    }
    async function resolveReview(operation, action, reason) {
        setTsdReview((current) => ({ ...current, status: 'loading', error: undefined }));
        try {
            await resolveTsdReviewOperation(session.accessToken, operation.id, {
                action,
                comment: action === 'ACCEPT_RECEIPT_WITH_ERROR'
                    ? 'Фактическое наличие товара в коробе подтверждено администратором.'
                    : action === 'APPLY_INVENTORY_ADJUSTMENT'
                        ? 'Подтверждено оператором WMS.'
                        : 'Отклонено оператором WMS.',
                reason: action === 'REJECT' ? reason ?? defaultRejectReason(operation) : undefined,
            });
            await loadTab('tsdReview', true);
            setRejectReasons((current) => {
                const next = { ...current };
                delete next[operation.id];
                return next;
            });
        }
        catch (caught) {
            setTsdReview((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
            setTsdReceiptReview((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
            throw caught;
        }
    }
    function renderActiveTab() {
        if (!activeTabMeta) {
            return _jsx(PanelMessage, { text: "\u0423 \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F \u043D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0445 \u0440\u0430\u0437\u0434\u0435\u043B\u043E\u0432 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u043E\u0439 \u043F\u0430\u043D\u0435\u043B\u0438." });
        }
        if (activeTab === 'clients') {
            return renderLoadState(clients, 'Клиенты пока не заведены.', renderClients);
        }
        if (activeTab === 'stock') {
            return renderLoadState(stock, 'Остатки появятся после импорта или приемки.', renderStock);
        }
        if (activeTab === 'tsdReview') {
            const otherOperations = tsdReview.data.filter((operation) => operation.operationType !== 'receipt_scan');
            return (_jsxs(_Fragment, { children: [_jsx(TsdReceiptReviewPanel, { userId: session.user.id, dashboard: tsdReceiptReview.data, error: tsdReceiptReview.error, isLoading: tsdReceiptReview.status === 'idle' || tsdReceiptReview.status === 'loading', onRefresh: () => void loadTab('tsdReview', true), onDownloadBoxesXlsx: (clientId) => downloadTsdReceiptReviewBoxesXlsx(session.accessToken, clientId), onAcceptWithError: (item) => resolveReview({
                            id: item.id,
                        }, 'ACCEPT_RECEIPT_WITH_ERROR') }), otherOperations.length ? (_jsxs("div", { className: "tsd-review-other", children: [_jsx("h3", { children: "\u041F\u0440\u043E\u0447\u0438\u0435 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438 \u0422\u0421\u0414" }), renderTsdReview(otherOperations, rejectReasons, (operation, reason) => setRejectReasons((current) => ({
                                ...current,
                                [operation.id]: reason,
                            })), (operation, action, reason) => void resolveReview(operation, action, reason))] })) : null] }));
        }
        if (activeTab === 'tsdHistory') {
            return renderLoadState(tsdHistory, 'История разбора ТСД пока пустая.', renderTsdReviewHistory);
        }
        if (activeTab === 'roles') {
            return renderLoadState(roles, 'Роли еще не синхронизированы.', renderRoles);
        }
        return renderLoadState(tariffs, 'Тарифы логистики пока не загружены.', renderTariffs);
    }
    return (_jsxs("section", { className: "data-panel", "aria-label": "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435", children: [_jsxs("div", { className: "section-heading data-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0414\u0430\u043D\u043D\u044B\u0435 \u043E\u043D\u043B\u0430\u0439\u043D" }), _jsx("h2", { children: "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435" })] }), activeTabMeta ? (_jsx("button", { className: "icon-button", type: "button", onClick: () => void loadTab(activeTabMeta.id, true), title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C", "aria-label": "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435", children: _jsx(RefreshCw, { size: 18, "aria-hidden": "true" }) })) : null] }), availableTabs.length > 0 ? (_jsx("div", { className: "data-tabs", role: "tablist", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0445 \u0434\u0430\u043D\u043D\u044B\u0445", children: availableTabs.map((tab) => (_jsxs("button", { "aria-selected": activeTab === tab.id, className: activeTab === tab.id ? 'active' : '', onClick: () => setActiveTab(tab.id), role: "tab", type: "button", children: [_jsx(tab.icon, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: tab.label })] }, tab.id))) })) : null, _jsx("div", { className: "data-panel__body", children: renderActiveTab() })] }));
}
function renderLoadState(state, emptyText, renderReady) {
    if (state.status === 'idle' || (state.status === 'loading' && state.data.length === 0)) {
        return _jsx(PanelMessage, { text: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0434\u0430\u043D\u043D\u044B\u0435." });
    }
    if (state.status === 'error') {
        return _jsx(PanelMessage, { tone: "error", text: state.error ?? 'Не удалось загрузить данные.' });
    }
    if (state.data.length === 0) {
        return _jsx(PanelMessage, { text: emptyText });
    }
    return (_jsxs(_Fragment, { children: [state.status === 'loading' ? _jsx("p", { className: "inline-status", children: "\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u044E \u0441\u043F\u0438\u0441\u043E\u043A." }) : null, renderReady(state.data)] }));
}
function renderClients(items) {
    return (_jsx("div", { className: "data-table-wrap", children: _jsxs("table", { className: "data-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041A\u043E\u0434" }), _jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("th", { children: "\u0418\u041D\u041D" }), _jsx("th", { children: "\u041F\u043E\u0447\u0442\u0430" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u0421\u043E\u0437\u0434\u0430\u043D" })] }) }), _jsx("tbody", { children: items.map((client) => (_jsxs("tr", { children: [_jsx("td", { children: client.code }), _jsx("td", { children: client.name }), _jsx("td", { children: client.inn ?? '-' }), _jsx("td", { children: client.email ?? '-' }), _jsx("td", { children: _jsx("span", { className: "status status--ready", children: client.status }) }), _jsx("td", { children: formatDate(client.createdAt) })] }, client.id))) })] }) }));
}
function renderStock(items) {
    return (_jsx("div", { className: "data-table-wrap", children: _jsxs("table", { className: "data-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "SKU" }), _jsx("th", { children: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434" }), _jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431" }), _jsx("th", { children: "\u041F\u0430\u043B\u043B\u0435\u0442" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("th", { children: "\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E" })] }) }), _jsx("tbody", { children: items.map((balance) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: balance.sku.internalSku }), _jsx("span", { children: balance.sku.name })] }), _jsx("td", { children: primaryBarcode(balance) ?? '-' }), _jsx("td", { children: balance.box?.code ?? '-' }), _jsx("td", { children: balance.pallet?.code ?? '-' }), _jsx("td", { children: _jsx("span", { className: "status status--planned", children: stockStatusLabel(balance.status) }) }), _jsx("td", { children: balance.quantity }), _jsx("td", { children: formatDate(balance.updatedAt) })] }, balance.id))) })] }) }));
}
function renderRoles(items) {
    return (_jsx("div", { className: "role-grid", children: items.map((role) => (_jsxs("article", { className: "role-item", children: [_jsxs("div", { children: [_jsx("span", { className: "status status--ready", children: role.code }), _jsx("h3", { children: role.name })] }), _jsx("div", { className: "permission-list", children: role.permissions.map((permission) => (_jsx("span", { children: permission.code }, permission.code))) })] }, role.id))) }));
}
function renderTariffs(items) {
    return (_jsx("div", { className: "data-table-wrap", children: _jsxs("table", { className: "data-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041D\u0430\u0431\u043E\u0440" }), _jsx("th", { children: "\u0424\u0430\u0439\u043B" }), _jsx("th", { children: "\u041F\u0435\u0440\u0438\u043E\u0434" }), _jsx("th", { children: "\u041D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F" }), _jsx("th", { children: "\u0421\u043E\u0437\u0434\u0430\u043D" })] }) }), _jsx("tbody", { children: items.map((tariff) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: tariff.name }), _jsx("span", { children: tariff.note ?? 'без примечания' })] }), _jsx("td", { children: tariff.sourceFile ?? '-' }), _jsxs("td", { children: [formatDate(tariff.activeFrom), " - ", formatDate(tariff.activeTo)] }), _jsx("td", { children: tariff._count.directions }), _jsx("td", { children: formatDate(tariff.createdAt) })] }, tariff.id))) })] }) }));
}
function renderTsdReview(items, rejectReasons, onRejectReasonChange, onResolve) {
    return (_jsx("div", { className: "data-table-wrap", children: _jsxs("table", { className: "data-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u044F" }), _jsx("th", { children: "\u0422\u0421\u0414" }), _jsx("th", { children: "\u0414\u0430\u043D\u043D\u044B\u0435" }), _jsx("th", { children: "\u041F\u0440\u0438\u0447\u0438\u043D\u0430" }), _jsx("th", { children: "\u0421\u043E\u0437\u0434\u0430\u043D\u0430" }), _jsx("th", { children: "\u0420\u0435\u0448\u0435\u043D\u0438\u0435" })] }) }), _jsx("tbody", { children: items.map((operation) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: operation.operationType }), _jsx("span", { children: operation.operationKey })] }), _jsx("td", { children: operation.deviceId }), _jsx("td", { children: payloadSummary(operation.payload) }), _jsxs("td", { children: [_jsx("strong", { children: reviewReasonLabel(operation.reviewReason) }), _jsx("span", { children: operation.serverMessage ?? '-' })] }), _jsx("td", { children: formatDate(operation.createdAt) }), _jsx("td", { children: _jsxs("div", { className: "review-actions", children: [operation.operationType === 'inventory_scan' ? (_jsxs("button", { className: "review-action review-action--accept", type: "button", onClick: () => onResolve(operation, 'APPLY_INVENTORY_ADJUSTMENT'), children: [_jsx(CheckCircle2, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041F\u0440\u0438\u043D\u044F\u0442\u044C" })] })) : null, _jsx("select", { className: "review-reason-select", value: rejectReasons[operation.id] ?? defaultRejectReason(operation), onChange: (event) => onRejectReasonChange(operation, event.target.value), "aria-label": "\u041F\u0440\u0438\u0447\u0438\u043D\u0430 \u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0438\u044F", children: tsdReviewReasonOptions.map((reason) => (_jsx("option", { value: reason, children: reviewReasonLabel(reason) }, reason))) }), _jsxs("button", { className: "review-action review-action--reject", type: "button", onClick: () => onResolve(operation, 'REJECT', rejectReasons[operation.id] ?? defaultRejectReason(operation)), children: [_jsx(XCircle, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C" })] })] }) })] }, operation.id))) })] }) }));
}
function renderTsdReviewHistory(items) {
    return (_jsx("div", { className: "data-table-wrap", children: _jsxs("table", { className: "data-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u044F" }), _jsx("th", { children: "\u0420\u0435\u0448\u0435\u043D\u0438\u0435" }), _jsx("th", { children: "\u041E\u043F\u0435\u0440\u0430\u0442\u043E\u0440" }), _jsx("th", { children: "\u0414\u0430\u043D\u043D\u044B\u0435" }), _jsx("th", { children: "\u041F\u0440\u0438\u0447\u0438\u043D\u0430" }), _jsx("th", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("th", { children: "\u0414\u0430\u0442\u0430" })] }) }), _jsx("tbody", { children: items.map((operation) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: operation.operationType }), _jsx("span", { children: operation.operationKey })] }), _jsx("td", { children: _jsx("span", { className: `status status--${operation.status === 'ACCEPTED' ? 'ready' : 'planned'}`, children: reviewActionLabel(operation) }) }), _jsxs("td", { children: [_jsx("strong", { children: operation.reviewedBy?.name ?? '-' }), operation.reviewedBy?.email ? _jsx("span", { children: operation.reviewedBy.email }) : null] }), _jsx("td", { children: payloadSummary(operation.payload) }), _jsxs("td", { children: [_jsx("strong", { children: reviewReasonLabel(operation.reviewReason) }), _jsx("span", { children: operation.serverMessage ?? '-' })] }), _jsx("td", { children: operation.resolutionMessage ?? operation.reviewComment ?? operation.serverMessage ?? '-' }), _jsx("td", { children: formatDate(operation.reviewedAt) })] }, operation.id))) })] }) }));
}
function PanelMessage({ text, tone = 'neutral' }) {
    return _jsx("p", { className: `panel-message panel-message--${tone}`, children: text });
}
function canUse(user, permission) {
    return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось загрузить данные.';
}
function formatDate(value) {
    if (!value) {
        return 'не задано';
    }
    return dateFormatter.format(new Date(value));
}
function primaryBarcode(balance) {
    return balance.sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? balance.sku.barcodes[0]?.value;
}
function payloadSummary(payload) {
    const fields = ['clientId', 'barcode', 'skuId', 'boxCode', 'fromBoxCode', 'toBoxCode', 'quantity', 'countedQuantity'];
    return fields
        .map((field) => (payload[field] == null ? '' : `${field}: ${String(payload[field])}`))
        .filter(Boolean)
        .join(' · ');
}
function defaultRejectReason(operation) {
    return operation.reviewReason ?? 'MANUAL_REJECT';
}
function reviewReasonLabel(reason) {
    if (!reason) {
        return 'Причина не задана';
    }
    const labels = {
        INVENTORY_MISMATCH: 'Расхождение инвентаризации',
        SKU_NOT_FOUND: 'SKU не найден',
        BOX_NOT_FOUND: 'Короб не найден',
        RECEIPT_FAILED: 'Ошибка приемки',
        DEVICE_MISMATCH: 'Не тот ТСД',
        VALIDATION_ERROR: 'Ошибка данных',
        MANUAL_REJECT: 'Ручное отклонение',
        OTHER: 'Другая причина',
    };
    return labels[reason];
}
function reviewActionLabel(operation) {
    if (operation.reviewAction === 'APPLY_INVENTORY_ADJUSTMENT') {
        return 'Корректировка принята';
    }
    if (operation.reviewAction === 'REJECT') {
        return 'Отклонено';
    }
    return operation.status;
}
