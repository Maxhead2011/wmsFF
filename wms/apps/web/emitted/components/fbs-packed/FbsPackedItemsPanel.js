import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, Box, CheckCircle2, ClipboardCopy, PackageCheck, RefreshCw, Search, ShieldCheck, Warehouse, X, } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchClients, fetchFbsPackedItems, reconcileFbsPackedItems, } from '../../lib/api';
import './fbs-packed.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';
const CLIENT_STORAGE_KEY = 'wms:fbs-packed-items:client';
export function FbsPackedItemsPanel({ session }) {
    const initialPeriod = useMemo(() => packedPeriod(), []);
    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useState(() => localStorage.getItem(CLIENT_STORAGE_KEY) ?? '');
    const [marketplace, setMarketplace] = useState('ALL');
    const [dateFrom, setDateFrom] = useState(initialPeriod.from);
    const [dateTo, setDateTo] = useState(initialPeriod.to);
    const [search, setSearch] = useState('');
    const [requiresKiz, setRequiresKiz] = useState(false);
    const [report, setReport] = useState(null);
    const [selected, setSelected] = useState(null);
    const [viewMode, setViewMode] = useState('requests');
    const [expandedRequest, setExpandedRequest] = useState(null);
    const [loading, setLoading] = useState(true);
    const [reconciling, setReconciling] = useState(false);
    const [error, setError] = useState('');
    const [copyMessage, setCopyMessage] = useState('');
    const load = useCallback(async (page = 1) => {
        setLoading(true);
        setError('');
        try {
            const next = await fetchFbsPackedItems(session.accessToken, {
                clientId: clientId || undefined,
                marketplace,
                dateFrom: dateFrom || undefined,
                dateTo: dateTo || undefined,
                search: search.trim() || undefined,
                requiresKiz,
                page,
                pageSize: 100,
            });
            setReport(next);
            if (selected) {
                setSelected(next.items.find((row) => row.id === selected.id) ?? selected);
            }
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить журнал упаковки ТСД.');
        }
        finally {
            setLoading(false);
        }
    }, [clientId, dateFrom, dateTo, marketplace, requiresKiz, search, selected, session.accessToken]);
    useEffect(() => {
        void fetchClients(session.accessToken)
            .then(setClients)
            .catch(() => setClients([]));
        void load(1);
        // Начальная загрузка выполняется один раз; остальные изменения применяются кнопкой формы.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session.accessToken, session.user.activeWarehouseId]);
    function submit(event) {
        event.preventDefault();
        void load(1);
    }
    function changeClient(value) {
        setClientId(value);
        if (value)
            localStorage.setItem(CLIENT_STORAGE_KEY, value);
        else
            localStorage.removeItem(CLIENT_STORAGE_KEY);
    }
    const warningCount = report?.items.filter((row) => Boolean(row.assembly.marketplaceSubmitError || row.assembly.errorMessage)).length ?? 0;
    const withoutBoxCount = report?.items.filter((row) => !row.source.boxCode).length ?? 0;
    const stickerMismatchCount = report?.items.filter((row) => row.comparison?.status === 'STICKER_MISMATCH').length ?? 0;
    const requestGroups = useMemo(() => groupPackedItemsByRequest(report?.items ?? []), [report?.items]);
    const actualPackedUnits = report?.items.reduce((sum, row) => sum + Math.max(1, row.product.quantity), 0) ?? 0;
    async function reconcile() {
        if (!clientId) {
            setError('Для сверки с WB или Ozon сначала выберите клиента.');
            return;
        }
        if (!report?.items.length)
            return;
        setReconciling(true);
        setError('');
        try {
            const result = await reconcileFbsPackedItems(session.accessToken, {
                clientId,
                assemblyIds: report.items.map((row) => row.id),
            });
            const comparisons = new Map(result.items.map((row) => [row.id, row.comparison]));
            setReport((current) => current ? {
                ...current,
                items: current.items.map((row) => ({ ...row, comparison: comparisons.get(row.id) ?? row.comparison })),
            } : current);
            setSelected((current) => current ? { ...current, comparison: comparisons.get(current.id) ?? current.comparison } : current);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось выполнить сверку с маркетплейсом.');
        }
        finally {
            setReconciling(false);
        }
    }
    async function copyDetails(row) {
        const text = packedItemText(row);
        try {
            await navigator.clipboard.writeText(text);
            setCopyMessage('Данные скопированы');
            window.setTimeout(() => setCopyMessage(''), 1800);
        }
        catch {
            setCopyMessage('Не удалось скопировать');
        }
    }
    return (_jsx(WorkspaceTileGate, { eyebrow: "\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u044C \u0422\u0421\u0414", title: "\u0423\u043F\u0430\u043A\u043E\u0432\u043A\u0430 FBS", description: "\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435, \u0447\u0442\u043E \u0440\u0435\u0430\u043B\u044C\u043D\u043E \u043E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u043D\u0430 \u0422\u0421\u0414, \u0441\u043E\u043F\u043E\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u0441 \u0437\u0430\u043A\u0430\u0437\u0430\u043C\u0438 \u0438 \u043D\u0430\u0439\u0434\u0438\u0442\u0435 \u043D\u0435\u0432\u0435\u0440\u043D\u043E \u043D\u0430\u043A\u043B\u0435\u0435\u043D\u043D\u044B\u0435 \u0441\u0442\u0438\u043A\u0435\u0440\u044B.", tiles: [
            { title: 'По заявкам', description: 'Свернутая проверка фактически упакованных товаров по каждой заявке.', icon: PackageCheck, tone: 'blue' },
            { title: 'Все сканы', description: 'Полный журнал каждого товара, короба, КИЗ и стикера.', icon: Search, tone: 'violet' },
            { title: 'Сверка WB / Ozon', description: 'Найти ошибки наклейки и расхождения с реальными заказами.', icon: ShieldCheck, tone: 'green' },
        ], children: _jsxs("section", { className: "packed-audit", children: [_jsxs("header", { className: "packed-audit__hero", children: [_jsx("div", { className: "packed-audit__hero-icon", children: _jsx(PackageCheck, { size: 26 }) }), _jsxs("div", { children: [_jsx("span", { className: "packed-audit__eyebrow", children: "\u041A\u041E\u041D\u0422\u0420\u041E\u041B\u042C \u0422\u0421\u0414" }), _jsx("h1", { children: "\u0423\u043F\u0430\u043A\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u0442\u043E\u0432\u0430\u0440\u044B FBS" }), _jsx("p", { children: "\u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0436\u0443\u0440\u043D\u0430\u043B \u043A\u0430\u0436\u0434\u043E\u0439 \u0435\u0434\u0438\u043D\u0438\u0446\u044B, \u0441\u043E\u0431\u0440\u0430\u043D\u043D\u043E\u0439 \u043D\u0430 \u0422\u0421\u0414. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u0441\u0442\u0440\u043E\u043A\u0443, \u0447\u0442\u043E\u0431\u044B \u0443\u0432\u0438\u0434\u0435\u0442\u044C \u0432\u0441\u0435 \u0441\u0432\u044F\u0437\u0438." })] }), _jsxs("div", { className: "packed-audit__hero-actions", children: [_jsxs("button", { type: "button", className: "packed-audit__reconcile", onClick: () => void reconcile(), disabled: loading || reconciling || !report?.items.length, title: clientId ? 'Сверить текущую страницу с реальными заказами WB / Ozon' : 'Сначала выберите клиента', children: [_jsx(ShieldCheck, { size: 17, className: reconciling ? 'is-spinning' : undefined }), reconciling ? 'Сверяю…' : 'Сверить с WB / Ozon'] }), _jsxs("button", { type: "button", className: "packed-audit__refresh", onClick: () => void load(report?.page ?? 1), disabled: loading || reconciling, children: [_jsx(RefreshCw, { size: 17, className: loading ? 'is-spinning' : undefined }), "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"] })] })] }), _jsxs("form", { className: "packed-audit__filters", onSubmit: submit, children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => changeClient(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u044B" }), clients.map((client) => _jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441" }), _jsxs("select", { value: marketplace, onChange: (event) => setMarketplace(event.target.value), children: [_jsx("option", { value: "ALL", children: "\u0412\u0441\u0435" }), _jsx("option", { value: "WILDBERRIES", children: "Wildberries" }), _jsx("option", { value: "OZON", children: "Ozon" }), _jsx("option", { value: "YANDEX_MARKET", children: "\u042F\u043D\u0434\u0435\u043A\u0441 \u041C\u0430\u0440\u043A\u0435\u0442" })] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421 \u0434\u0430\u0442\u044B" }), _jsx("input", { type: "date", value: dateFrom, onChange: (event) => setDateFrom(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E \u0434\u0430\u0442\u0443" }), _jsx("input", { type: "date", value: dateTo, onChange: (event) => setDateTo(event.target.value) })] }), _jsxs("label", { className: "packed-audit__search", children: [_jsx("span", { children: "\u0411\u044B\u0441\u0442\u0440\u044B\u0439 \u043F\u043E\u0438\u0441\u043A" }), _jsxs("div", { children: [_jsx(Search, { size: 17 }), _jsx("input", { value: search, onChange: (event) => setSearch(event.target.value), placeholder: "\u0437\u0430\u043A\u0430\u0437, \u0437\u0430\u044F\u0432\u043A\u0430, \u043A\u043E\u0440\u043E\u0431, \u041A\u0418\u0417, \u0441\u0442\u0438\u043A\u0435\u0440, \u043F\u0430\u043B\u0435\u0442\u0441\u043E\u0440\u0442" })] })] }), _jsxs("label", { className: "packed-audit__check", children: [_jsx("input", { type: "checkbox", checked: requiresKiz, onChange: (event) => setRequiresKiz(event.target.checked) }), _jsx("span", { children: "\u0422\u043E\u043B\u044C\u043A\u043E \u0442\u043E\u0432\u0430\u0440\u044B \u0441 \u041A\u0418\u0417" })] }), _jsx("button", { type: "submit", className: "packed-audit__apply", disabled: loading, children: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C" })] }), _jsxs("div", { className: "packed-audit__stats", children: [_jsx(AuditStat, { icon: PackageCheck, label: "\u0420\u0435\u0430\u043B\u044C\u043D\u043E \u043E\u0442\u043F\u0438\u043A\u0430\u043D\u043E, \u0448\u0442.", value: actualPackedUnits, tone: "blue" }), _jsx(AuditStat, { icon: ShieldCheck, label: "FBS-\u0437\u0430\u044F\u0432\u043E\u043A \u0441 \u0444\u0430\u043A\u0442\u043E\u043C", value: requestGroups.length, tone: "green" }), _jsx(AuditStat, { icon: Box, label: "\u0411\u0435\u0437 \u0438\u0441\u0445\u043E\u0434\u043D\u043E\u0433\u043E \u043A\u043E\u0440\u043E\u0431\u0430", value: withoutBoxCount, tone: withoutBoxCount ? 'amber' : 'green' }), _jsx(AuditStat, { icon: AlertTriangle, label: "\u041D\u0435\u0432\u0435\u0440\u043D\u0430\u044F \u043D\u0430\u043A\u043B\u0435\u0439\u043A\u0430", value: stickerMismatchCount || warningCount, tone: stickerMismatchCount || warningCount ? 'red' : 'green' })] }), _jsxs("div", { className: "packed-audit__viewbar", children: [_jsxs("div", { children: [_jsx("b", { children: "\u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u0422\u0421\u0414" }), _jsx("span", { children: "\u0417\u0430\u044F\u0432\u043A\u0430 \u0440\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u0432 \u0441\u043F\u0438\u0441\u043E\u043A \u0440\u0435\u0430\u043B\u044C\u043D\u043E \u043E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0445 \u0442\u043E\u0432\u0430\u0440\u043E\u0432, \u0440\u0430\u0437\u043C\u0435\u0440\u043E\u0432 \u0438 \u043A\u043E\u0440\u043E\u0431\u043E\u0432." })] }), _jsxs("div", { className: "packed-audit__view-switch", role: "tablist", "aria-label": "\u0412\u0438\u0434 \u0436\u0443\u0440\u043D\u0430\u043B\u0430 \u0443\u043F\u0430\u043A\u043E\u0432\u043A\u0438", children: [_jsx("button", { type: "button", role: "tab", "aria-selected": viewMode === 'requests', className: viewMode === 'requests' ? 'is-active' : '', onClick: () => setViewMode('requests'), children: "\u041F\u043E \u0437\u0430\u044F\u0432\u043A\u0430\u043C" }), _jsx("button", { type: "button", role: "tab", "aria-selected": viewMode === 'items', className: viewMode === 'items' ? 'is-active' : '', onClick: () => setViewMode('items'), children: "\u0412\u0441\u0435 \u0441\u043A\u0430\u043D\u044B" })] })] }), error ? _jsxs("div", { className: "packed-audit__error", children: [_jsx(AlertTriangle, { size: 18 }), error] }) : null, viewMode === 'requests' ? (_jsxs("div", { className: "packed-audit__requests", "aria-busy": loading, children: [loading && !report ? _jsx("div", { className: "packed-audit__empty", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0441\u043A\u0430\u043D\u044B \u0422\u0421\u0414\u2026" }) : null, !loading && requestGroups.length === 0 ? _jsx("div", { className: "packed-audit__empty", children: "\u0417\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434 \u0432 \u0422\u0421\u0414 \u0435\u0449\u0451 \u043D\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u043E \u043D\u0438 \u043E\u0434\u043D\u043E\u0433\u043E \u0442\u043E\u0432\u0430\u0440\u0430." }) : null, requestGroups.map((group) => _jsx(PackedRequestCard, { group: group, expanded: expandedRequest === group.id, onToggle: () => setExpandedRequest((current) => current === group.id ? null : group.id), onItemOpen: setSelected }, group.id))] })) : (_jsxs("div", { className: "packed-audit__table", "aria-busy": loading, children: [_jsxs("div", { className: "packed-audit__table-head", children: [_jsx("span", { children: "\u0412\u0440\u0435\u043C\u044F / \u0422\u0421\u0414" }), _jsx("span", { children: "\u0417\u0430\u044F\u0432\u043A\u0430 / \u0437\u0430\u043A\u0430\u0437" }), _jsx("span", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("span", { children: "\u0425\u0440\u0430\u043D\u0435\u043D\u0438\u0435 / \u043A\u043E\u0440\u043E\u0431 \u0443\u043F\u0430\u043A\u043E\u0432\u043A\u0438" }), _jsx("span", { children: "\u0421\u0442\u0438\u043A\u0435\u0440 / \u041A\u0418\u0417" }), _jsx("span", { children: "\u0421\u043A\u043B\u0430\u0434 / \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A" })] }), loading && !report ? _jsx("div", { className: "packed-audit__empty", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0436\u0443\u0440\u043D\u0430\u043B\u2026" }) : null, !loading && report?.items.length === 0 ? _jsx("div", { className: "packed-audit__empty", children: "\u0417\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434 \u0443\u043F\u0430\u043A\u043E\u0432\u0430\u043D\u043D\u044B\u0445 \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E." }) : null, report?.items.map((row) => (_jsxs("button", { type: "button", className: `packed-audit__row${row.comparison?.status === 'STICKER_MISMATCH' ? ' is-sticker-mismatch' : row.comparison && row.comparison.status !== 'MATCHED' ? ' is-comparison-issue' : ''}`, onClick: () => setSelected(row), children: [_jsxs("span", { className: "packed-audit__time", children: [_jsx("b", { children: formatDateTime(row.assembly.completedAt) }), _jsx("small", { children: row.assembly.deviceCode }), _jsx(MarketplaceBadge, { marketplace: row.marketplace })] }), _jsxs("span", { children: [_jsxs("b", { children: ["\u2116", row.request?.number ?? '—'] }), _jsx("small", { className: "packed-audit__mono", children: row.orderId }), _jsx("small", { children: row.supplyId || 'Без поставки' })] }), _jsxs("span", { className: "packed-audit__product", children: [_jsxs("b", { children: [row.product.name || 'Товар без названия', row.product.size ? ` · ${row.product.size}` : ''] }), _jsx("small", { children: row.product.article || row.product.internalSku || 'Без артикула' }), _jsxs("small", { children: ["\u0428\u041A: ", row.product.barcode || '—', " \u00B7 ", row.product.quantity, " \u0448\u0442."] })] }), _jsxs("span", { children: [_jsx("b", { children: row.source.boxCode || 'Без короба' }), _jsxs("small", { children: ["\u041F\u0430\u043B\u0435\u0442\u0441\u043E\u0440\u0442: ", row.source.palletSort?.code || '—'] }), _jsxs("small", { children: ["\u0417\u043E\u043D\u0430: ", row.source.zone?.name || row.source.zone?.code || '—'] }), _jsxs("small", { className: row.cargoPlace ? 'packed-audit__packing-box' : 'packed-audit__packing-box is-empty', children: ["\u041A\u043E\u0440\u043E\u0431 \u0443\u043F\u0430\u043A\u043E\u0432\u043A\u0438: ", row.cargoPlace?.id || 'ещё не указан'] })] }), _jsxs("span", { children: [_jsx("b", { children: row.sticker.partB || row.sticker.barcode || 'Стикер не записан' }), _jsxs("small", { className: "packed-audit__mono", children: ["\u041A\u0418\u0417: ", shortCode(row.product.kiz)] }), row.comparison?.status === 'STICKER_MISMATCH' ? _jsx("em", { className: "packed-audit__sticker-error", children: "\u041D\u0430\u043A\u043B\u0435\u0439\u043A\u0430 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0437\u0430\u043A\u0430\u0437\u0430" }) : null, row.relabeling ? _jsxs("small", { className: "packed-audit__relabel", children: ["\u041F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0430: ", row.relabeling.sourceArticle || row.relabeling.sourceInternalSku] }) : null] }), _jsxs("span", { children: [_jsx("b", { children: row.marketplaceWarehouse.name || row.executionWarehouse?.name || 'Склад не указан' }), _jsx("small", { children: row.client?.name || 'Клиент не найден' }), _jsx("small", { children: row.assembly.workerName || 'Сотрудник не записан' }), (row.assembly.marketplaceSubmitError || row.assembly.errorMessage)
                                            ? _jsx("em", { className: "packed-audit__problem", children: "\u0415\u0441\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043E\u0431 \u043E\u0448\u0438\u0431\u043A\u0435" })
                                            : row.comparison?.status === 'MATCHED'
                                                ? _jsxs("em", { className: "packed-audit__ok", children: [_jsx(CheckCircle2, { size: 13 }), " \u0421\u0432\u0435\u0440\u0435\u043D\u043E"] })
                                                : _jsxs("em", { className: "packed-audit__ok", children: [_jsx(CheckCircle2, { size: 13 }), " \u0421\u043E\u0431\u0440\u0430\u043D\u043E"] })] })] }, row.id)))] })), report && report.pages > 1 ? (_jsxs("div", { className: "packed-audit__pager", children: [_jsx("button", { type: "button", disabled: loading || report.page <= 1, onClick: () => void load(report.page - 1), children: "\u041D\u0430\u0437\u0430\u0434" }), _jsxs("span", { children: ["\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 ", report.page, " \u0438\u0437 ", report.pages, " \u00B7 \u0432\u0441\u0435\u0433\u043E ", report.total] }), _jsx("button", { type: "button", disabled: loading || report.page >= report.pages, onClick: () => void load(report.page + 1), children: "\u0414\u0430\u043B\u044C\u0448\u0435" })] })) : null, selected ? (_jsx("div", { className: "packed-audit__backdrop", role: "presentation", onMouseDown: (event) => event.target === event.currentTarget && setSelected(null), children: _jsxs("aside", { className: "packed-audit__drawer", role: "dialog", "aria-modal": "true", "aria-label": "\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0430 \u0443\u043F\u0430\u043A\u043E\u0432\u0430\u043D\u043D\u043E\u0433\u043E \u0442\u043E\u0432\u0430\u0440\u0430", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("span", { children: "\u0423\u041F\u0410\u041A\u041E\u0412\u0410\u041D\u041D\u0410\u042F \u0415\u0414\u0418\u041D\u0418\u0426\u0410" }), _jsx("h2", { children: selected.product.name || 'Товар' })] }), _jsx("button", { type: "button", onClick: () => setSelected(null), "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 20 }) })] }), _jsxs("div", { className: "packed-audit__drawer-actions", children: [_jsxs("button", { type: "button", onClick: () => void copyDetails(selected), children: [_jsx(ClipboardCopy, { size: 16 }), " \u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0432\u0441\u0451"] }), copyMessage ? _jsx("small", { children: copyMessage }) : null] }), _jsx(AuditDetails, { row: selected })] }) })) : null] }) }));
}
function AuditStat({ icon: Icon, label, value, tone }) {
    return _jsxs("article", { className: `packed-audit__stat is-${tone}`, children: [_jsx(Icon, { size: 19 }), _jsxs("span", { children: [_jsx("b", { children: value.toLocaleString('ru-RU') }), _jsx("small", { children: label })] })] });
}
function MarketplaceBadge({ marketplace }) {
    const label = marketplace === 'WILDBERRIES' ? 'WB' : marketplace === 'OZON' ? 'OZON' : 'YM';
    return _jsx("em", { className: `packed-audit__market is-${marketplace.toLowerCase()}`, children: label });
}
function groupPackedItemsByRequest(items) {
    const groups = new Map();
    for (const item of items) {
        const key = item.request?.id ?? `unlinked:${item.id}`;
        groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()].map(([id, rows]) => {
        const products = new Map();
        for (const row of rows) {
            const label = [row.product.name || 'Товар без названия', row.product.size].filter(Boolean).join(' · ');
            const key = [row.product.skuId, row.product.barcode || '', label].join('|');
            const current = products.get(key) ?? { key, label, quantity: 0 };
            current.quantity += Math.max(1, row.product.quantity);
            products.set(key, current);
        }
        return {
            id,
            request: rows[0].request,
            items: rows,
            actualUnits: rows.reduce((sum, row) => sum + Math.max(1, row.product.quantity), 0),
            orderCount: new Set(rows.map((row) => row.orderId)).size,
            productCount: products.size,
            completedAt: rows.reduce((latest, row) => !latest || (row.assembly.completedAt && row.assembly.completedAt > latest) ? row.assembly.completedAt : latest, null),
            warehouseName: rows[0].marketplaceWarehouse.name || rows[0].executionWarehouse?.name || null,
            clientName: rows[0].client?.name || null,
            packingBoxes: [...new Set(rows.map((row) => row.cargoPlace?.id).filter((value) => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'ru')),
            products: [...products.values()].sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label, 'ru')),
        };
    }).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
}
function PackedRequestCard({ group, expanded, onToggle, onItemOpen, }) {
    const requestLabel = group.request ? `Заявка №${group.request.number}` : 'Заявка не определена';
    return _jsxs("article", { className: `packed-request${expanded ? ' is-expanded' : ''}`, children: [_jsxs("button", { type: "button", className: "packed-request__summary", onClick: onToggle, "aria-expanded": expanded, children: [_jsxs("span", { className: "packed-request__identity", children: [_jsx("small", { children: "\u0424\u0410\u041A\u0422 \u0422\u0421\u0414" }), _jsx("b", { children: requestLabel }), _jsxs("em", { children: [group.clientName || 'Клиент не указан', " \u00B7 ", group.warehouseName || 'Склад не указан'] })] }), _jsxs("span", { className: "packed-request__metrics", children: [_jsxs("strong", { children: [group.actualUnits, " ", _jsx("small", { children: "\u0448\u0442." })] }), _jsx("em", { children: "\u0440\u0435\u0430\u043B\u044C\u043D\u043E \u043E\u0442\u043F\u0438\u043A\u0430\u043D\u043E" })] }), _jsxs("span", { className: "packed-request__metrics", children: [_jsx("strong", { children: group.orderCount }), _jsx("em", { children: "\u0437\u0430\u043A\u0430\u0437\u043E\u0432" })] }), _jsxs("span", { className: "packed-request__metrics", children: [_jsx("strong", { children: group.productCount }), _jsx("em", { children: "\u0442\u043E\u0432\u0430\u0440\u043D\u044B\u0445 \u043F\u043E\u0437." })] }), _jsxs("span", { className: `packed-request__metrics packed-request__box-metric${group.packingBoxes.length === 0 ? ' is-empty' : ''}`, children: [_jsx("strong", { children: group.packingBoxes.length }), _jsx("em", { children: group.packingBoxes.length > 0 ? 'коробов FFL_FBS' : 'ещё не упаковано' })] }), _jsxs("span", { className: "packed-request__updated", children: [formatDateTime(group.completedAt), _jsx("i", { children: expanded ? 'Свернуть' : 'Показать товары' })] })] }), expanded ? _jsxs("div", { className: "packed-request__body", children: [_jsx("div", { className: "packed-request__products", children: group.products.map((product) => _jsxs("span", { children: [_jsxs("b", { children: [product.quantity, " \u0448\u0442."] }), product.label] }, product.key)) }), _jsx("div", { className: "packed-request__items", children: group.items.map((row) => _jsxs("button", { type: "button", onClick: () => onItemOpen(row), children: [_jsxs("span", { children: [_jsx("b", { children: row.product.name || 'Товар' }), _jsxs("small", { children: [row.product.size ? `Размер: ${row.product.size}` : 'Размер не указан', " \u00B7 \u0428\u041A: ", row.product.barcode || '—'] })] }), _jsxs("span", { children: [_jsxs("b", { children: [row.product.quantity, " \u0448\u0442."] }), _jsx("small", { children: "\u0444\u0430\u043A\u0442 \u0422\u0421\u0414" })] }), _jsxs("span", { children: [_jsx("small", { className: "packed-request__column-label", children: "\u041E\u0442\u043A\u0443\u0434\u0430 \u0432\u0437\u044F\u0442" }), _jsx("b", { children: row.source.boxCode || 'Без короба хранения' }), _jsxs("small", { children: [row.source.palletSort?.code || 'Без паллетсорта', " \u00B7 ", row.source.zone?.name || row.source.zone?.code || 'Без зоны'] })] }), _jsxs("span", { className: `packed-request__packing${row.cargoPlace ? '' : ' is-empty'}`, children: [_jsx("small", { className: "packed-request__column-label", children: "\u041A\u043E\u0440\u043E\u0431 \u0443\u043F\u0430\u043A\u043E\u0432\u043A\u0438" }), _jsx("b", { children: row.cargoPlace?.id || 'Ещё не упакован' }), _jsx("small", { children: row.cargoPlace?.status === 'CLOSED' ? 'короб закрыт' : row.cargoPlace ? 'короб открыт' : 'FFL_FBS-короб не указан' })] }), _jsxs("span", { children: [_jsx("b", { children: row.orderId }), _jsxs("small", { children: ["\u0437\u0430\u043A\u0430\u0437 \u00B7 ", row.sticker.partB || row.sticker.barcode || 'стикер не записан'] })] })] }, row.id)) })] }) : null] });
}
function AuditDetails({ row }) {
    return (_jsxs("div", { className: "packed-audit__details", children: [_jsxs(DetailSection, { title: "\u0417\u0430\u043A\u0430\u0437 \u0438 \u043A\u043B\u0438\u0435\u043D\u0442", icon: PackageCheck, children: [_jsx(Detail, { label: "\u041A\u043B\u0438\u0435\u043D\u0442", value: row.client ? `${row.client.code} · ${row.client.name}` : null }), _jsx(Detail, { label: "\u0417\u0430\u044F\u0432\u043A\u0430 WMS", value: row.request ? `№${row.request.number} · ${row.request.title}` : null }), _jsx(Detail, { label: "\u0417\u0430\u043A\u0430\u0437", value: row.orderId, mono: true }), _jsx(Detail, { label: "\u041F\u043E\u0441\u0442\u0430\u0432\u043A\u0430", value: row.supplyId, mono: true }), _jsx(Detail, { label: "\u0410\u043A\u043A\u0430\u0443\u043D\u0442", value: row.accountName })] }), _jsxs(DetailSection, { title: "\u0422\u043E\u0432\u0430\u0440", icon: ShieldCheck, children: [_jsx(Detail, { label: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435", value: row.product.name }), _jsx(Detail, { label: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B / SKU", value: [row.product.article, row.product.internalSku, row.product.clientSku].filter(Boolean).join(' · ') }), _jsx(Detail, { label: "\u0426\u0432\u0435\u0442 / \u0440\u0430\u0437\u043C\u0435\u0440", value: [row.product.color, row.product.size].filter(Boolean).join(' · ') }), _jsx(Detail, { label: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434 \u0442\u043E\u0432\u0430\u0440\u0430", value: row.product.barcode, mono: true }), _jsx(Detail, { label: "\u041A\u0418\u0417", value: row.product.kiz, mono: true, wide: true }), _jsx(Detail, { label: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E", value: `${row.product.quantity} шт.` })] }), row.relabeling ? _jsxs(DetailSection, { title: "\u041F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0430", icon: RefreshCw, children: [_jsx(Detail, { label: "\u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u0442\u043E\u0432\u0430\u0440", value: row.relabeling.sourceProductName }), _jsx(Detail, { label: "\u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u0430\u0440\u0442\u0438\u043A\u0443\u043B / SKU", value: [row.relabeling.sourceArticle, row.relabeling.sourceInternalSku].filter(Boolean).join(' · ') }), _jsx(Detail, { label: "\u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u0428\u041A", value: row.relabeling.sourceBarcode, mono: true })] }) : null, _jsxs(DetailSection, { title: "\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435", icon: Box, children: [_jsx(Detail, { label: "\u041A\u043E\u0440\u043E\u0431", value: row.source.boxCode, mono: true }), _jsx(Detail, { label: "\u0421\u0442\u0430\u0442\u0443\u0441 \u043A\u043E\u0440\u043E\u0431\u0430", value: row.source.boxStatus }), _jsx(Detail, { label: "\u041F\u0430\u043B\u0435\u0442\u0441\u043E\u0440\u0442", value: row.source.palletSort?.code, mono: true }), _jsx(Detail, { label: "\u0417\u043E\u043D\u0430", value: row.source.zone ? `${row.source.zone.code} · ${row.source.zone.name}` : null }), _jsx(Detail, { label: "\u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0441\u043A\u043B\u0430\u0434", value: row.executionWarehouse ? `${row.executionWarehouse.city} · ${row.executionWarehouse.name}` : null })] }), _jsxs(DetailSection, { title: "\u0421\u0442\u0438\u043A\u0435\u0440 \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0430", icon: Warehouse, children: [_jsx(Detail, { label: "\u0421\u043A\u043B\u0430\u0434 \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0430", value: [row.marketplaceWarehouse.name, row.marketplaceWarehouse.id].filter(Boolean).join(' · ') }), _jsx(Detail, { label: "\u0421\u0442\u0438\u043A\u0435\u0440, \u0447\u0430\u0441\u0442\u044C A", value: row.sticker.partA, mono: true }), _jsx(Detail, { label: "\u0421\u0442\u0438\u043A\u0435\u0440, \u0447\u0430\u0441\u0442\u044C B", value: row.sticker.partB, mono: true }), _jsx(Detail, { label: "\u0428\u041A \u0441\u0442\u0438\u043A\u0435\u0440\u0430", value: row.sticker.barcode, mono: true, wide: true }), _jsx(Detail, { label: "\u0413\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442\u043E", value: row.cargoPlace ? `${row.cargoPlace.id}${row.cargoPlace.barcode ? ` · ${row.cargoPlace.barcode}` : ''}` : null, mono: true }), _jsx(Detail, { label: "\u041A\u043E\u0440\u043E\u0431 \u0443\u043F\u0430\u043A\u043E\u0432\u043A\u0438", value: row.cargoPlace?.id, mono: true })] }), row.comparison ? _jsxs(DetailSection, { title: "\u0421\u0432\u0435\u0440\u043A\u0430 \u0441 \u0440\u0435\u0430\u043B\u044C\u043D\u044B\u043C \u0437\u0430\u043A\u0430\u0437\u043E\u043C", icon: ShieldCheck, children: [_jsx(Detail, { label: "\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442", value: comparisonLabel(row.comparison.status), danger: row.comparison.status !== 'MATCHED' }), _jsx(Detail, { label: "\u0421\u0442\u0430\u0442\u0443\u0441 \u043D\u0430 \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0435", value: row.comparison.order?.statusLabel }), _jsx(Detail, { label: "\u0422\u0435\u043A\u0443\u0449\u0430\u044F \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0430", value: row.comparison.order?.supplyId, mono: true }), _jsx(Detail, { label: "\u041D\u0430\u043A\u043B\u0435\u0435\u043D \u0441\u0442\u0438\u043A\u0435\u0440", value: stickerReference(row.comparison.actualSticker), mono: true, wide: true, danger: row.comparison.status === 'STICKER_MISMATCH' }), _jsx(Detail, { label: "\u0414\u043E\u043B\u0436\u0435\u043D \u0431\u044B\u0442\u044C \u0441\u0442\u0438\u043A\u0435\u0440", value: stickerReference(row.comparison.expectedSticker), mono: true, wide: true, danger: row.comparison.status === 'STICKER_MISMATCH' }), _jsx(Detail, { label: "\u041D\u0430\u0439\u0434\u0435\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F", value: row.comparison.issues.join(' '), wide: true, danger: row.comparison.issues.length > 0 })] }) : null, _jsxs(DetailSection, { title: "\u041A\u0442\u043E \u0438 \u043A\u043E\u0433\u0434\u0430", icon: PackageCheck, children: [_jsx(Detail, { label: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A", value: row.assembly.workerName }), _jsx(Detail, { label: "\u0422\u0421\u0414", value: row.assembly.deviceCode, mono: true }), _jsx(Detail, { label: "\u0421\u043E\u0431\u0440\u0430\u043D\u043E", value: formatDateTime(row.assembly.completedAt) }), _jsx(Detail, { label: "\u0423\u043F\u0430\u043A\u043E\u0432\u0430\u043D\u043E \u0432 \u0433\u0440\u0443\u0437\u043E\u043C\u0435\u0441\u0442\u043E", value: formatDateTime(row.assembly.cargoPackedAt) }), _jsx(Detail, { label: "\u041F\u0435\u0440\u0435\u0434\u0430\u043D\u043E \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0443", value: formatDateTime(row.assembly.marketplaceSubmittedAt) }), _jsx(Detail, { label: "\u0421\u0442\u0430\u0442\u0443\u0441 \u043C\u0435\u0442\u0430\u0434\u0430\u043D\u043D\u044B\u0445", value: row.assembly.wbMetaStatus }), _jsx(Detail, { label: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0438", value: row.assembly.marketplaceSubmitError, wide: true, danger: true }), _jsx(Detail, { label: "\u0421\u0438\u0441\u0442\u0435\u043C\u043D\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435", value: row.assembly.errorMessage, wide: true, danger: true })] })] }));
}
function DetailSection({ title, icon: Icon, children }) {
    return _jsxs("section", { className: "packed-audit__detail-section", children: [_jsxs("h3", { children: [_jsx(Icon, { size: 17 }), title] }), _jsx("dl", { children: children })] });
}
function Detail({ label, value, mono, wide, danger }) {
    return _jsxs("div", { className: `${wide ? 'is-wide ' : ''}${danger && value ? 'is-danger' : ''}`, children: [_jsx("dt", { children: label }), _jsx("dd", { className: mono ? 'packed-audit__mono' : undefined, children: value || '—' })] });
}
function packedPeriod() {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    return { from: localIsoDate(from), to: localIsoDate(to) };
}
function localIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function formatDateTime(value) {
    if (!value)
        return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}
function shortCode(value) {
    if (!value)
        return '—';
    return value.length > 24 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}
function stickerReference(value) {
    if (!value)
        return null;
    return value.partB || value.barcode || value.partA || null;
}
function comparisonLabel(status) {
    const labels = {
        MATCHED: 'Заказ, товар и наклейка совпадают',
        STICKER_MISMATCH: 'Наклейка относится к другому заказу',
        ORDER_CANCELLED: 'Заказ отменён',
        ORDER_NOT_FOUND: 'Заказ не найден в актуальном списке',
        ISSUES: 'Нужна проверка',
        CHECK_ERROR: 'Не удалось запросить маркетплейс',
        NOT_AVAILABLE: 'Запись упаковки недоступна',
    };
    return labels[status];
}
function packedItemText(row) {
    return [
        `Клиент: ${row.client ? `${row.client.code} · ${row.client.name}` : '—'}`,
        `Заявка: №${row.request?.number ?? '—'}`,
        `Заказ: ${row.orderId}`,
        `Поставка: ${row.supplyId ?? '—'}`,
        `Товар: ${row.product.name ?? '—'} · ${row.product.size ?? '—'}`,
        `Артикул: ${row.product.article ?? row.product.internalSku ?? '—'}`,
        `ШК товара: ${row.product.barcode ?? '—'}`,
        `КИЗ: ${row.product.kiz ?? '—'}`,
        `Короб хранения: ${row.source.boxCode ?? '—'}`,
        `Короб упаковки: ${row.cargoPlace?.id ?? 'ещё не упакован'}`,
        `Палетсорт: ${row.source.palletSort?.code ?? '—'}`,
        `Зона: ${row.source.zone?.name ?? row.source.zone?.code ?? '—'}`,
        `Склад: ${row.marketplaceWarehouse.name ?? row.executionWarehouse?.name ?? '—'}`,
        `Стикер: ${row.sticker.partB ?? row.sticker.barcode ?? '—'}`,
        `ТСД: ${row.assembly.deviceCode}`,
        `Сотрудник: ${row.assembly.workerName ?? '—'}`,
        `Собрано: ${formatDateTime(row.assembly.completedAt)}`,
        `Ошибка: ${row.assembly.marketplaceSubmitError ?? row.assembly.errorMessage ?? 'нет'}`,
    ].join('\n');
}
