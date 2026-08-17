import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, FileSpreadsheet, PackageCheck, RefreshCw, Search, ShieldAlert, XCircle, } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
import { ConfirmDialog } from '../common/ConfirmDialog';
import './tsd-receipt-review.css';
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
});
export function TsdReceiptReviewPanel({ userId, dashboard, error, isLoading, onAcceptWithError, onDownloadBoxesXlsx, onRefresh, }) {
    const [query, setQuery] = useState('');
    const [clientId, setClientId] = useRememberedClientId(userId);
    const [filter, setFilter] = useState('ALL');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [pendingItem, setPendingItem] = useState(null);
    const [isConfirming, setConfirming] = useState(false);
    const [expandedBoxKey, setExpandedBoxKey] = useState(null);
    const [showAllBoxesToCheck, setShowAllBoxesToCheck] = useState(false);
    const [isDownloading, setDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState(null);
    const clients = useMemo(() => {
        const map = new Map();
        dashboard?.items.forEach((item) => map.set(item.client.id, item.client));
        return [...map.values()].sort((left, right) => left.name.localeCompare(right.name, 'ru'));
    }, [dashboard]);
    useEffect(() => {
        if (!clients.length)
            return;
        const nextClientId = validRememberedClientId(clientId, clients);
        if (nextClientId !== clientId)
            setClientId(nextClientId);
    }, [clientId, clients, setClientId]);
    const boxIssuesByKey = useMemo(() => {
        const map = new Map();
        dashboard?.items.forEach((item) => {
            if ((item.result !== 'NOT_ACCEPTED' && item.result !== 'REJECTED') || !item.boxCode) {
                return;
            }
            const key = reviewBoxKey(item.client.id, item.boxCode);
            map.set(key, [...(map.get(key) ?? []), item]);
        });
        return map;
    }, [dashboard]);
    const filteredBoxesToCheck = useMemo(() => (dashboard?.boxesToCheck ?? []).filter((box) => !clientId || box.client.id === clientId), [clientId, dashboard]);
    const visibleBoxesToCheck = showAllBoxesToCheck ? filteredBoxesToCheck : filteredBoxesToCheck.slice(0, 20);
    const filteredItems = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
        return (dashboard?.items ?? []).filter((item) => {
            if (clientId && item.client.id !== clientId) {
                return false;
            }
            if (filter !== 'ALL' &&
                !(filter === 'NOT_RECEIVED' && (item.result === 'NOT_ACCEPTED' || item.result === 'REJECTED')) &&
                item.result !== filter) {
                return false;
            }
            if (!normalizedQuery) {
                return true;
            }
            return searchableText(item).includes(normalizedQuery);
        });
    }, [clientId, dashboard, filter, query]);
    const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
    const visiblePage = Math.min(page, pageCount);
    const pageItems = filteredItems.slice((visiblePage - 1) * pageSize, visiblePage * pageSize);
    useEffect(() => {
        setPage(1);
    }, [clientId, filter, pageSize, query]);
    useEffect(() => {
        if (page > pageCount) {
            setPage(pageCount);
        }
    }, [page, pageCount]);
    async function confirmAcceptance() {
        if (!pendingItem) {
            return;
        }
        setConfirming(true);
        try {
            await onAcceptWithError(pendingItem);
            setPendingItem(null);
        }
        catch {
            // Ошибка уже показана родительской панелью; диалог остается открытым для повторной проверки.
        }
        finally {
            setConfirming(false);
        }
    }
    function focusBoxIssues(box) {
        setClientId(box.client.id);
        setQuery(box.boxCode);
        setFilter('NOT_RECEIVED');
        setPage(1);
    }
    async function downloadBoxesXlsx() {
        setDownloading(true);
        setDownloadError(null);
        try {
            const blob = await onDownloadBoxesXlsx(clientId || undefined);
            const selectedClient = clients.find((client) => client.id === clientId);
            downloadBlob(blob, `proverka-korobov-tsd${selectedClient?.code ? `-${safeFileName(selectedClient.code)}` : ''}-${new Date().toISOString().slice(0, 10)}.xlsx`);
        }
        catch (caught) {
            setDownloadError(caught instanceof Error ? caught.message : 'Не удалось скачать Excel для проверки коробов.');
        }
        finally {
            setDownloading(false);
        }
    }
    if (!dashboard && isLoading) {
        return _jsx("p", { className: "panel-message", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0434\u0430\u043D\u043D\u044B\u0435 \u043F\u0440\u0438\u0435\u043C\u043A\u0438 \u0422\u0421\u0414." });
    }
    return (_jsxs("div", { className: "tsd-receipt-review", children: [_jsxs("div", { className: "tsd-receipt-review__head", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u041F\u0440\u0438\u0435\u043C\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u0447\u0435\u0440\u0435\u0437 \u0422\u0421\u0414" }), _jsxs("span", { children: ["\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E ", formatDateTime(dashboard?.generatedAt)] })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onRefresh, disabled: isLoading, title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043F\u0440\u0438\u0435\u043C\u043A\u0443", children: _jsx(RefreshCw, { size: 17, "aria-hidden": "true" }) })] }), error ? _jsx("p", { className: "panel-message panel-message--error", children: error }) : null, downloadError ? _jsx("p", { className: "panel-message panel-message--error", children: downloadError }) : null, isLoading && dashboard ? _jsx("p", { className: "inline-status", children: "\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u044E \u0434\u0430\u043D\u043D\u044B\u0435." }) : null, _jsxs("div", { className: "tsd-receipt-review__stats", children: [_jsx(MetricButton, { icon: CheckCircle2, label: "\u041F\u0440\u0438\u043D\u044F\u0442\u043E \u0448\u0442\u0430\u0442\u043D\u043E", tone: "success", value: dashboard?.stats.acceptedQuantity ?? 0, active: filter === 'ACCEPTED', onClick: () => setFilter(filter === 'ACCEPTED' ? 'ALL' : 'ACCEPTED') }), _jsx(MetricButton, { icon: XCircle, label: "\u041D\u0435 \u043F\u0440\u0438\u043D\u044F\u0442\u043E", tone: "danger", value: dashboard?.stats.notAcceptedQuantity ?? 0, active: filter === 'NOT_RECEIVED', onClick: () => setFilter(filter === 'NOT_RECEIVED' ? 'ALL' : 'NOT_RECEIVED') }), _jsx(MetricButton, { icon: ShieldAlert, label: "\u041F\u0440\u0438\u043D\u044F\u0442\u043E \u0441 \u043E\u0448\u0438\u0431\u043A\u043E\u0439", tone: "warning", value: dashboard?.stats.acceptedWithErrorQuantity ?? 0, active: filter === 'ACCEPTED_WITH_ERROR', onClick: () => setFilter(filter === 'ACCEPTED_WITH_ERROR' ? 'ALL' : 'ACCEPTED_WITH_ERROR') }), _jsx(MetricButton, { icon: AlertTriangle, label: "\u0414\u0443\u0431\u043B\u0438 \u041A\u0418\u0417", tone: "violet", value: dashboard?.stats.duplicateKizQuantity ?? 0, active: false, onClick: () => {
                            setFilter('ALL');
                            setQuery('ДУБЛЬ КИЗ');
                        } })] }), _jsxs("section", { className: "tsd-box-checks", "aria-label": "\u041A\u043E\u0440\u043E\u0431\u0430 \u043D\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443", children: [_jsxs("div", { className: "tsd-box-checks__head", children: [_jsxs("div", { className: "tsd-box-checks__title", children: [_jsx(ClipboardCheck, { size: 19, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("h4", { children: "\u041A\u043E\u0440\u043E\u0431\u0430 \u043D\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443" }), _jsx("p", { children: "\u0417\u0434\u0435\u0441\u044C \u0441\u043E\u0431\u0440\u0430\u043D\u044B \u043A\u043E\u0440\u043E\u0431\u0430, \u0432 \u043A\u043E\u0442\u043E\u0440\u044B\u0445 \u0441\u043A\u0430\u043D\u044B \u0442\u043E\u0432\u0430\u0440\u0430 \u043D\u0435 \u043F\u043E\u043F\u0430\u043B\u0438 \u0432 \u043E\u0441\u0442\u0430\u0442\u043A\u0438 WMS." })] })] }), _jsxs("div", { className: "tsd-box-checks__head-actions", children: [_jsxs("button", { className: "review-action review-action--xlsx", type: "button", onClick: () => void downloadBoxesXlsx(), disabled: isDownloading, children: [_jsx(FileSpreadsheet, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isDownloading ? 'Готовлю Excel…' : 'Скачать Excel' })] }), _jsx("strong", { className: "tsd-box-checks__count", children: filteredBoxesToCheck.length })] })] }), _jsx("div", { className: "tsd-box-checks__table-wrap", children: _jsxs("table", { className: "tsd-box-checks__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442 / \u043A\u043E\u0440\u043E\u0431" }), _jsx("th", { children: "\u0423\u0447\u0442\u0435\u043D\u043E \u0432 WMS" }), _jsx("th", { children: "\u041D\u0435 \u043F\u0440\u0438\u043D\u044F\u0442\u043E" }), _jsx("th", { children: "\u0414\u0438\u0430\u043F\u0430\u0437\u043E\u043D \u043F\u0435\u0440\u0435\u0441\u0447\u0435\u0442\u0430" }), _jsx("th", { children: "\u041F\u0440\u043E\u0431\u043B\u0435\u043C\u044B" }), _jsx("th", { children: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u043E\u0448\u0438\u0431\u043A\u0430" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" })] }) }), _jsx("tbody", { children: visibleBoxesToCheck.length ? (visibleBoxesToCheck.map((box) => {
                                        const key = reviewBoxKey(box.client.id, box.boxCode);
                                        const issues = boxIssuesByKey.get(key) ?? [];
                                        const isExpanded = expandedBoxKey === key;
                                        return (_jsxs(Fragment, { children: [_jsxs("tr", { className: "tsd-box-checks__row", children: [_jsxs("td", { children: [_jsx("strong", { children: box.client.name }), _jsx("code", { children: box.boxCode }), !box.boxExists ? _jsx("span", { className: "tsd-box-checks__missing", children: "\u041A\u043E\u0440\u043E\u0431 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432 \u043E\u0441\u0442\u0430\u0442\u043A\u0430\u0445" }) : null] }), _jsxs("td", { children: [_jsx("strong", { children: box.accountedQuantity }), " \u0448\u0442."] }), _jsxs("td", { children: [_jsxs("strong", { className: "tsd-box-checks__danger", children: ["+", box.notAcceptedQuantity] }), " \u0448\u0442."] }), _jsxs("td", { children: [_jsxs("strong", { className: "tsd-box-checks__expected", children: [box.accountedQuantity, "\u2013", box.maximumPhysicalQuantity] }), ' ', "\u0448\u0442."] }), _jsxs("td", { children: [_jsxs("strong", { children: [box.issueOperations, " ", pluralizeIssue(box.issueOperations)] }), box.duplicateKizQuantity ? _jsxs("span", { children: ["\u0414\u0443\u0431\u043B\u0438 \u041A\u0418\u0417: ", box.duplicateKizQuantity] }) : null] }), _jsx("td", { children: formatDateTime(box.lastIssueAt) }), _jsx("td", { children: _jsxs("div", { className: "tsd-box-checks__actions", children: [_jsxs("button", { className: "review-action", type: "button", onClick: () => focusBoxIssues(box), children: [_jsx(Search, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u0442\u0440\u043E\u043A\u0438" })] }), _jsx("button", { className: `icon-button tsd-box-checks__toggle ${isExpanded ? 'is-open' : ''}`, type: "button", onClick: () => setExpandedBoxKey(isExpanded ? null : key), title: isExpanded ? 'Скрыть проблемные товары' : 'Показать проблемные товары', "aria-expanded": isExpanded, children: _jsx(ChevronDown, { size: 17, "aria-hidden": "true" }) })] }) })] }), isExpanded ? (_jsx("tr", { className: "tsd-box-checks__details-row", children: _jsx("td", { colSpan: 7, children: _jsx("div", { className: "tsd-box-checks__issues", children: issues.map((item) => (_jsxs("div", { className: "tsd-box-checks__issue", children: [_jsxs("div", { children: [_jsx("strong", { children: item.sku?.name || 'Товар без карточки' }), _jsxs("span", { children: ["\u0428\u041A: ", item.barcode || item.sku?.barcode || '-'] })] }), _jsxs("div", { children: [_jsxs("strong", { children: [item.quantity, " \u0448\u0442."] }), _jsx("span", { children: reasonLabel(item) })] }), _jsxs("div", { children: [_jsx("code", { children: item.kiz || 'КИЗ не указан' }), _jsx("strong", { className: `tsd-kiz-assessment tsd-kiz-assessment--${assessmentTone(item)}`, children: item.kizAssessment.label }), _jsx("span", { children: item.kizAssessment.guidance })] })] }, item.id))) }) }) })) : null] }, key));
                                    })) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432 \u0441 \u043D\u0435\u043F\u0440\u0438\u043D\u044F\u0442\u044B\u043C\u0438 \u0442\u043E\u0432\u0430\u0440\u0430\u043C\u0438 \u043D\u0435\u0442." }) })) })] }) }), filteredBoxesToCheck.length > 20 ? (_jsx("button", { className: "tsd-box-checks__more", type: "button", onClick: () => setShowAllBoxesToCheck((current) => !current), children: showAllBoxesToCheck ? 'Показать первые 20' : `Показать все ${filteredBoxesToCheck.length}` })) : null, _jsx("p", { className: "tsd-box-checks__note", children: "\u041D\u0438\u0436\u043D\u044F\u044F \u0433\u0440\u0430\u043D\u0438\u0446\u0430 \u2014 \u0443\u0447\u0435\u0442 WMS. \u0412\u0435\u0440\u0445\u043D\u044F\u044F \u2014 \u0435\u0441\u043B\u0438 \u043A\u0430\u0436\u0434\u044B\u0439 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u043D\u044B\u0439 \u0441\u043A\u0430\u043D \u043E\u0442\u043D\u043E\u0441\u0438\u0442\u0441\u044F \u043A \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0439 \u0435\u0434\u0438\u043D\u0438\u0446\u0435. \u041F\u043E\u0432\u0442\u043E\u0440\u043D\u044B\u0435 \u0441\u043A\u0430\u043D\u044B \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u044B, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u043A\u043E\u0440\u043E\u0431 \u043D\u0443\u0436\u043D\u043E \u043F\u0435\u0440\u0435\u0441\u0447\u0438\u0442\u0430\u0442\u044C \u0444\u0438\u0437\u0438\u0447\u0435\u0441\u043A\u0438." })] }), _jsxs("div", { className: "tsd-receipt-review__filters", children: [_jsxs("label", { className: "tsd-receipt-review__search", children: [_jsx(Search, { size: 17, "aria-hidden": "true" }), _jsx("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "\u041A\u043E\u0440\u043E\u0431, \u0428\u041A, \u041A\u0418\u0417, \u0442\u043E\u0432\u0430\u0440, \u0430\u0440\u0442\u0438\u043A\u0443\u043B" })] }), _jsxs("select", { value: clientId, onChange: (event) => setClientId(event.target.value), "aria-label": "\u041A\u043B\u0438\u0435\u043D\u0442 \u043F\u0440\u0438\u0435\u043C\u043A\u0438", children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u044B" }), clients.map((client) => (_jsx("option", { value: client.id, children: client.name }, client.id)))] }), _jsxs("select", { value: filter, onChange: (event) => setFilter(event.target.value), "aria-label": "\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043F\u0440\u0438\u0435\u043C\u043A\u0438", children: [_jsx("option", { value: "ALL", children: "\u0412\u0441\u0435 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B" }), _jsx("option", { value: "NOT_RECEIVED", children: "\u0412\u0441\u0435 \u043D\u0435\u043F\u0440\u0438\u043D\u044F\u0442\u044B\u0435" }), _jsx("option", { value: "NOT_ACCEPTED", children: "\u0422\u0440\u0435\u0431\u0443\u044E\u0442 \u0440\u0435\u0448\u0435\u043D\u0438\u044F" }), _jsx("option", { value: "ACCEPTED", children: "\u041F\u0440\u0438\u043D\u044F\u0442\u044B \u0448\u0442\u0430\u0442\u043D\u043E" }), _jsx("option", { value: "ACCEPTED_WITH_ERROR", children: "\u041F\u0440\u0438\u043D\u044F\u0442\u044B \u0441 \u043E\u0448\u0438\u0431\u043A\u043E\u0439" }), _jsx("option", { value: "REJECTED", children: "\u041E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u044B" })] })] }), _jsxs("div", { className: "tsd-receipt-review__summary", children: ["\u041D\u0430\u0439\u0434\u0435\u043D\u043E \u0441\u0442\u0440\u043E\u043A: ", _jsx("strong", { children: filteredItems.length }), " \u0438\u0437 ", _jsx("strong", { children: dashboard?.stats.totalOperations ?? 0 }), " \u00B7 \u0435\u0434\u0438\u043D\u0438\u0446:", _jsxs("strong", { children: [" ", sumQuantity(filteredItems)] }), _jsxs("div", { className: "tsd-receipt-review__pager", children: [_jsxs("label", { children: ["\u041D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435", _jsxs("select", { value: pageSize, onChange: (event) => setPageSize(Number(event.target.value)), children: [_jsx("option", { value: 20, children: "20" }), _jsx("option", { value: 50, children: "50" }), _jsx("option", { value: 100, children: "100" })] })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => setPage((current) => Math.max(1, current - 1)), disabled: visiblePage <= 1, title: "\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0430\u044F \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430", children: _jsx(ChevronLeft, { size: 16, "aria-hidden": "true" }) }), _jsxs("span", { children: [visiblePage, " \u0438\u0437 ", pageCount] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => setPage((current) => Math.min(pageCount, current + 1)), disabled: visiblePage >= pageCount, title: "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0430\u044F \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430", children: _jsx(ChevronRight, { size: 16, "aria-hidden": "true" }) })] })] }), _jsx("div", { className: "tsd-receipt-review__table-wrap", children: _jsxs("table", { className: "tsd-receipt-review__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442" }), _jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442 / \u043A\u043E\u0440\u043E\u0431" }), _jsx("th", { children: "\u041E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u0442\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u041A\u0418\u0417 \u0438 \u043D\u0430\u0439\u0434\u0435\u043D\u043D\u044B\u0439 \u0434\u0443\u0431\u043B\u044C" }), _jsx("th", { children: "\u041F\u0440\u0438\u0447\u0438\u043D\u0430" }), _jsx("th", { children: "\u041A\u0442\u043E / \u043A\u043E\u0433\u0434\u0430" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435" })] }) }), _jsx("tbody", { children: pageItems.length ? (pageItems.map((item) => (_jsxs("tr", { className: `tsd-receipt-review__row tsd-receipt-review__row--${resultClass(item.result)}`, children: [_jsxs("td", { children: [_jsx(ResultBadge, { result: item.result }), _jsxs("span", { children: [item.quantity, " \u0448\u0442."] })] }), _jsxs("td", { children: [_jsx("strong", { children: item.client.name }), _jsx("span", { className: "tsd-receipt-review__box", children: item.boxCode || 'Короб не указан' }), item.sourceDocument ? _jsx("span", { children: item.sourceDocument }) : null] }), _jsxs("td", { children: [_jsx("strong", { children: item.sku?.name || 'Карточка товара не найдена' }), _jsx("span", { children: productDetails(item) }), _jsxs("span", { children: ["\u0428\u041A: ", item.barcode || item.sku?.barcode || '-'] })] }), _jsxs("td", { children: [_jsx("code", { children: item.kiz || 'КИЗ не указан' }), _jsxs("div", { className: `tsd-kiz-assessment tsd-kiz-assessment--${assessmentTone(item)}`, children: [_jsx("strong", { children: item.kizAssessment.label }), _jsx("span", { children: item.kizAssessment.guidance }), item.kizAssessment.scanOccurrences > 1 ? (_jsxs("span", { children: ["\u0421\u043A\u0430\u043D\u043E\u0432 \u044D\u0442\u043E\u0433\u043E \u041A\u0418\u0417: ", item.kizAssessment.scanOccurrences] })) : null] }), item.duplicate ? (_jsxs("div", { className: "tsd-receipt-review__duplicate", children: [_jsxs("strong", { children: ["\u0423\u0436\u0435 \u0447\u0438\u0441\u043B\u0438\u0442\u0441\u044F: ", item.duplicate.boxCode || 'короб не указан'] }), _jsx("span", { children: item.duplicate.name }), _jsx("span", { children: duplicateDetails(item) })] })) : null] }), _jsxs("td", { children: [_jsx("strong", { children: reasonLabel(item) }), _jsx("span", { children: item.message || 'Ошибок нет' })] }), _jsxs("td", { children: [_jsx("strong", { children: item.operatorName || 'Оператор не определен' }), _jsx("span", { children: item.deviceCode }), _jsx("span", { children: formatDateTime(item.createdAt) })] }), _jsx("td", { children: item.result === 'NOT_ACCEPTED' ? (_jsxs("button", { className: "review-action review-action--accept-error", type: "button", onClick: () => setPendingItem(item), children: [_jsx(PackageCheck, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u041F\u0440\u0438\u043D\u044F\u0442\u044C \u0441 \u043E\u0448\u0438\u0431\u043A\u043E\u0439" })] })) : (_jsx("span", { children: item.result === 'ACCEPTED_WITH_ERROR' ? 'Оставлено в журнале' : 'Действий не требуется' })) })] }, item.id)))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "\u041F\u043E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u043C \u0443\u0441\u043B\u043E\u0432\u0438\u044F\u043C \u0441\u0442\u0440\u043E\u043A \u043F\u0440\u0438\u0435\u043C\u043A\u0438 \u043D\u0435\u0442." }) })) })] }) }), pendingItem ? (_jsx(ConfirmDialog, { title: "\u041F\u0440\u0438\u043D\u044F\u0442\u044C \u0442\u043E\u0432\u0430\u0440 \u0441 \u043E\u0448\u0438\u0431\u043A\u043E\u0439?", message: "\u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0435\u0434\u0438\u043D\u0438\u0446\u0430 \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0430 \u0432 \u0443\u043A\u0430\u0437\u0430\u043D\u043D\u044B\u0439 \u043A\u043E\u0440\u043E\u0431 \u0438 \u043E\u0441\u0442\u0430\u043D\u0435\u0442\u0441\u044F \u043E\u0442\u043C\u0435\u0447\u0435\u043D\u043D\u043E\u0439 \u043A\u0440\u0430\u0441\u043D\u044B\u043C. \u0417\u0430\u043D\u044F\u0442\u044B\u0439 \u041A\u0418\u0417 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u043D\u0435 \u043F\u0440\u0438\u0432\u044F\u0437\u044B\u0432\u0430\u0435\u0442\u0441\u044F.", details: acceptanceDetails(pendingItem), confirmLabel: `Принять ${pendingItem.quantity} шт. с ошибкой`, isBusy: isConfirming, onCancel: () => setPendingItem(null), onConfirm: () => void confirmAcceptance() })) : null] }));
}
function MetricButton({ active, icon: Icon, label, onClick, tone, value, }) {
    return (_jsxs("button", { className: `tsd-review-metric tsd-review-metric--${tone} ${active ? 'is-active' : ''}`, type: "button", onClick: onClick, children: [_jsx(Icon, { size: 18, "aria-hidden": "true" }), _jsx("span", { children: label }), _jsx("strong", { children: value })] }));
}
function ResultBadge({ result }) {
    const labels = {
        ACCEPTED: 'Принято',
        NOT_ACCEPTED: 'Не принято',
        ACCEPTED_WITH_ERROR: 'Принято с ошибкой',
        REJECTED: 'Отклонено',
    };
    return _jsx("span", { className: `tsd-review-result tsd-review-result--${resultClass(result)}`, children: labels[result] });
}
function resultClass(result) {
    return result.toLocaleLowerCase('ru-RU').replaceAll('_', '-');
}
function searchableText(item) {
    return [
        item.client.name,
        item.client.code,
        item.boxCode,
        item.barcode,
        item.kiz,
        item.sku?.name,
        item.sku?.article,
        item.sku?.internalSku,
        item.sku?.color,
        item.sku?.size,
        item.duplicate?.boxCode,
        item.duplicate?.name,
        item.duplicate?.article,
        item.message,
        item.kizAssessment.label,
        item.kizAssessment.guidance,
        ...item.kizAssessment.scannedBoxCodes,
        item.duplicate || (item.kizAssessment.kind !== 'NOT_PROVIDED' && item.kizAssessment.kind !== 'UNCONFIRMED')
            ? 'ДУБЛЬ КИЗ'
            : '',
    ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('ru-RU');
}
function assessmentTone(item) {
    if (item.kizAssessment.likelyAccidental === true) {
        return 'repeat';
    }
    if (item.kizAssessment.likelyAccidental === false) {
        return 'conflict';
    }
    return 'unknown';
}
function productDetails(item) {
    return [item.sku?.article || item.sku?.internalSku, item.sku?.color, item.sku?.size].filter(Boolean).join(' · ') || '-';
}
function duplicateDetails(item) {
    if (!item.duplicate) {
        return '';
    }
    return [item.duplicate.article, item.duplicate.color, item.duplicate.size, item.duplicate.barcode]
        .filter(Boolean)
        .join(' · ');
}
function reasonLabel(item) {
    if (item.duplicate) {
        return 'Дубль КИЗ';
    }
    if (item.result === 'ACCEPTED') {
        return 'Принято без ошибок';
    }
    if (item.result === 'ACCEPTED_WITH_ERROR') {
        return 'Ошибка подтверждена';
    }
    return 'Ошибка приемки';
}
function acceptanceDetails(item) {
    return [
        `Клиент: ${item.client.name}`,
        `Добавить в короб: ${item.boxCode || 'не указан'}`,
        `Товар: ${item.sku?.name || item.barcode || 'не определен'}`,
        `Количество: ${item.quantity} шт.`,
        `Исходный КИЗ: ${item.kiz || 'не указан'}`,
        item.duplicate
            ? `Этот КИЗ уже числится в коробе ${item.duplicate.boxCode || 'без номера'}, товар «${item.duplicate.name}».`
            : `Ошибка: ${item.message || 'причина не указана'}`,
    ];
}
function sumQuantity(items) {
    return items.reduce((sum, item) => sum + item.quantity, 0);
}
function reviewBoxKey(clientId, boxCode) {
    return `${clientId.trim().toLocaleUpperCase('ru-RU')}|${boxCode.trim().toLocaleUpperCase('ru-RU')}`;
}
function pluralizeIssue(value) {
    const mod100 = value % 100;
    const mod10 = value % 10;
    if (mod100 >= 11 && mod100 <= 14) {
        return 'ошибок';
    }
    if (mod10 === 1) {
        return 'ошибка';
    }
    if (mod10 >= 2 && mod10 <= 4) {
        return 'ошибки';
    }
    return 'ошибок';
}
function formatDateTime(value) {
    return value ? dateTimeFormatter.format(new Date(value)) : '-';
}
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}
function safeFileName(value) {
    return value.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'client';
}
