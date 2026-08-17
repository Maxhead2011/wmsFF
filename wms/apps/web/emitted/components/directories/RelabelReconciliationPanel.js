import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AlertTriangle, CheckCircle2, RefreshCw, Search, ShieldCheck, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { applyFbsRelabelReconciliation, fetchFbsRelabelReconciliation, } from '../../lib/api';
export function RelabelReconciliationPanel({ session, clientId, canEdit, }) {
    const [dateFrom, setDateFrom] = useState(() => dateInputDaysAgo(14));
    const [dateTo, setDateTo] = useState(() => dateInputDaysAgo(0));
    const [barcode, setBarcode] = useState('');
    const [report, setReport] = useState(null);
    const [isLoading, setLoading] = useState(false);
    const [applyingIssueId, setApplyingIssueId] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    useEffect(() => {
        setReport(null);
        setMessage('');
        setError('');
    }, [clientId]);
    async function runCheck(event, refreshWb = true) {
        event?.preventDefault();
        if (!clientId)
            return;
        setLoading(true);
        setMessage('');
        setError('');
        try {
            setReport(await fetchFbsRelabelReconciliation(session.accessToken, {
                clientId,
                dateFrom,
                dateTo,
                barcode: barcode.trim() || undefined,
                refreshWb,
            }));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось выполнить сверку.');
        }
        finally {
            setLoading(false);
        }
    }
    async function applyIssue(issue) {
        if (!canEdit ||
            !issue.correctable ||
            !window.confirm(`Применить пропущенную переклейку по заказу WB №${issue.order.id}?\n\n` +
                `${issue.sourceSku?.name ?? 'Исходный товар'}: ${issue.correction.sourceDelta} шт.\n` +
                `${issue.targetSku?.name ?? 'Товар после переклейки'}: +${issue.correction.targetDelta} шт.\n\n` +
                'Операция сохранится в истории и не сможет примениться повторно.')) {
            return;
        }
        setApplyingIssueId(issue.id);
        setMessage('');
        setError('');
        try {
            const result = await applyFbsRelabelReconciliation(session.accessToken, {
                clientId,
                issueId: issue.id,
                dateFrom,
                dateTo,
                barcode: barcode.trim() || undefined,
            });
            setReport(result.report);
            setMessage(result.message);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось применить корректировку.');
        }
        finally {
            setApplyingIssueId('');
        }
    }
    return (_jsxs("section", { className: "relabel-reconciliation", children: [_jsxs("div", { className: "relabel-reconciliation__heading", children: [_jsxs("div", { children: [_jsx("span", { className: "relabel-reconciliation__icon", children: _jsx(ShieldCheck, { size: 21, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("h3", { children: "\u0421\u0432\u0435\u0440\u043A\u0430 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 \u0438 \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0438" }), _jsx("p", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u0442 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0435 \u0437\u0430\u044F\u0432\u043A\u0438, \u0440\u0435\u0437\u0435\u0440\u0432\u044B, \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0443\u044E \u0441\u0431\u043E\u0440\u043A\u0443, \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0438 \u0438 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 Wildberries." })] })] }), report ? (_jsxs("button", { type: "button", className: "icon-text-button", disabled: isLoading, onClick: () => void runCheck(undefined, true), children: [_jsx(RefreshCw, { size: 15, "aria-hidden": "true" }), "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0441 WB"] })) : null] }), _jsxs("form", { className: "relabel-reconciliation__filters", onSubmit: (event) => void runCheck(event, true), children: [_jsxs("label", { children: [_jsx("span", { children: "\u041E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E \u0441" }), _jsx("input", { type: "date", value: dateFrom, max: dateTo, onChange: (event) => setDateFrom(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u043E" }), _jsx("input", { type: "date", value: dateTo, min: dateFrom, onChange: (event) => setDateTo(event.target.value), required: true })] }), _jsxs("label", { className: "relabel-reconciliation__barcode", children: [_jsx("span", { children: "\u0428\u041A / \u0430\u0440\u0442\u0438\u043A\u0443\u043B \u0434\u043B\u044F \u0442\u043E\u0447\u0435\u0447\u043D\u043E\u0439 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438" }), _jsx("input", { value: barcode, onChange: (event) => setBarcode(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, 2049156013708" })] }), _jsxs("button", { className: "primary-button", type: "submit", disabled: isLoading || !clientId, children: [isLoading ? _jsx(RefreshCw, { className: "is-spinning", size: 17, "aria-hidden": "true" }) : _jsx(Search, { size: 17, "aria-hidden": "true" }), isLoading ? 'Сверяю WMS и WB…' : 'Проверить остатки'] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, message ? _jsx("p", { className: "form-success", children: message }) : null, report ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "relabel-reconciliation__summary", children: [_jsx(SummaryCard, { label: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A WMS", value: `${report.totals.stockUnits} шт.` }), _jsx(SummaryCard, { label: "\u0412\u0441\u0435\u0433\u043E \u0432 \u0440\u0435\u0437\u0435\u0440\u0432\u0435", value: `${report.totals.reservedUnits} шт.` }), _jsx(SummaryCard, { label: "\u0423\u0436\u0435 \u0432\u044B\u043D\u0443\u0442\u043E \u0441\u0431\u043E\u0440\u0449\u0438\u043A\u043E\u043C", value: `${report.totals.assembledReservedUnits} шт.` }), _jsx(SummaryCard, { label: "\u0415\u0449\u0451 \u043D\u0435 \u0441\u043E\u0431\u0440\u0430\u043D\u043E", value: `${report.totals.pendingReservedUnits} шт.` }), _jsx(SummaryCard, { label: "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u043E", value: `${report.totals.freeUnits} шт.`, tone: "success" }), _jsx(SummaryCard, { label: "\u0422\u0440\u0435\u0431\u0443\u044E\u0442 \u0432\u043D\u0438\u043C\u0430\u043D\u0438\u044F", value: String(report.totals.issues), tone: report.totals.issues > 0 ? 'danger' : 'success' })] }), _jsxs("div", { className: "relabel-reconciliation__wb-status", children: [_jsx(CheckCircle2, { size: 17, "aria-hidden": "true" }), _jsxs("span", { children: ["WB \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D: ", report.wb.ordersChecked, " \u0437\u0430\u043A\u0430\u0437\u043E\u0432, ", report.wb.suppliesChecked, " \u043F\u043E\u0441\u0442\u0430\u0432\u043E\u043A. \u0414\u0430\u043D\u043D\u044B\u0435 \u043D\u0430 ", formatDateTime(report.wb.fetchedAt), "."] })] }), _jsxs("div", { className: "relabel-reconciliation__block", children: [_jsx("div", { className: "relabel-reconciliation__block-title", children: _jsxs("div", { children: [_jsx("h4", { children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A \u0441 \u0443\u0447\u0451\u0442\u043E\u043C \u0440\u0435\u0437\u0435\u0440\u0432\u043E\u0432" }), _jsx("span", { children: "\u00AB\u0423\u0436\u0435 \u0432\u044B\u043D\u0443\u0442\u043E\u00BB \u2014 \u0442\u043E\u0432\u0430\u0440 \u0441\u043E\u0431\u0440\u0430\u043D, \u043D\u043E \u0437\u0430\u044F\u0432\u043A\u0430 WMS \u0435\u0449\u0451 \u043D\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0430." })] }) }), _jsx("div", { className: "client-table-scroll", children: _jsxs("table", { className: "client-directory-table relabel-reconciliation__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u0442\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u041F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0438" }), _jsx("th", { children: "WMS" }), _jsx("th", { children: "\u0420\u0435\u0437\u0435\u0440\u0432" }), _jsx("th", { children: "\u0413\u0434\u0435 \u0447\u0438\u0441\u043B\u0438\u0442\u0441\u044F" })] }) }), _jsxs("tbody", { children: [report.stockRows.map((row) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: row.sourceSku.name }), _jsx("small", { children: skuLine(row.sourceSku) })] }), _jsxs("td", { children: [_jsx("strong", { children: row.targetSku?.name ?? row.targetArticle }), _jsx("small", { children: row.targetSku ? skuLine(row.targetSku) : 'Карточка целевого SKU не найдена' })] }), _jsxs("td", { children: [_jsxs("strong", { children: [row.stock.available, " \u0448\u0442."] }), _jsxs("small", { children: ["\u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E ", row.stock.free, " \u00B7 \u0446\u0435\u043B\u0435\u0432\u043E\u0433\u043E SKU ", row.stock.targetAvailable] })] }), _jsxs("td", { children: [_jsxs("strong", { children: [row.stock.reserved, " \u0448\u0442."] }), _jsxs("small", { children: ["\u0443\u0436\u0435 \u0432\u044B\u043D\u0443\u0442\u043E ", row.reservations.assembled, " \u00B7 \u0435\u0449\u0451 \u043D\u0435 \u0441\u043E\u0431\u0440\u0430\u043D\u043E ", row.reservations.pending] }), row.reservations.requestNumbers.length > 0 ? (_jsxs("small", { children: ["\u0417\u0430\u044F\u0432\u043A\u0438: ", row.reservations.requestNumbers.map((number) => `№${String(number).padStart(6, '0')}`).join(', ')] })) : null] }), _jsx("td", { children: row.stock.boxes.length > 0
                                                                ? row.stock.boxes.map((box) => (_jsxs("span", { className: "relabel-reconciliation__box", children: [box.code, " \u2014 ", box.quantity, " \u0448\u0442."] }, box.code)))
                                                                : 'остатка нет' })] }, `${row.mappingId}-${row.sourceSku.id}-${row.targetSku?.id ?? 'missing'}`))), report.stockRows.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 5, children: "\u041F\u043E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u043C\u0443 \u0428\u041A \u0438\u043B\u0438 \u0430\u0440\u0442\u0438\u043A\u0443\u043B\u0443 \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u044F \u043F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B." }) })) : null] })] }) })] }), _jsxs("div", { className: "relabel-reconciliation__block", children: [_jsxs("div", { className: "relabel-reconciliation__block-title", children: [_jsxs("div", { children: [_jsx("h4", { children: "\u041E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0435 \u0437\u0430\u044F\u0432\u043A\u0438 \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434" }), _jsx("span", { children: "\u0421\u043E\u043F\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u044B \u043D\u043E\u043C\u0435\u0440\u0430 \u0437\u0430\u044F\u0432\u043E\u043A WMS, \u0437\u0430\u043A\u0430\u0437\u044B \u0438 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 WB." })] }), _jsx("strong", { children: report.requests.length })] }), _jsx("div", { className: "client-table-scroll", children: _jsxs("table", { className: "client-directory-table relabel-reconciliation__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0417\u0430\u044F\u0432\u043A\u0430" }), _jsx("th", { children: "\u0414\u0430\u0442\u0430 \u0441\u0434\u0430\u0447\u0438" }), _jsx("th", { children: "\u041F\u043E\u0441\u0442\u0430\u0432\u043A\u0430 WB" }), _jsx("th", { children: "\u0417\u0430\u043A\u0430\u0437\u044B" }), _jsx("th", { children: "\u041F\u0435\u0440\u0435\u043A\u043B\u0435\u0439\u043A\u0430" }), _jsx("th", { children: "\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442" })] }) }), _jsxs("tbody", { children: [report.requests.map((request) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsxs("strong", { children: ["\u2116", String(request.number).padStart(6, '0')] }), _jsx("small", { children: request.title })] }), _jsx("td", { children: formatDateTime(request.shippedAt) }), _jsx("td", { children: request.supplies.join(', ') || '—' }), _jsxs("td", { children: [request.wbShippedOrders, " \u0438\u0437 ", request.orders, " \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u044B WB"] }), _jsxs("td", { children: [request.relabelConfirmed, " \u0438\u0437 ", request.relabelExpected] }), _jsx("td", { children: _jsx("span", { className: request.issues > 0 ? 'relabel-reconciliation__result is-warning' : 'relabel-reconciliation__result is-ok', children: request.issues > 0 ? `${request.issues} замеч.` : 'Проверено' }) })] }, request.id))), report.requests.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 6, children: "\u0417\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434 \u0441\u0434\u0430\u043D\u043D\u044B\u0445 \u0437\u0430\u044F\u0432\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E." }) })) : null] })] }) })] }), _jsxs("div", { className: "relabel-reconciliation__block", children: [_jsxs("div", { className: "relabel-reconciliation__block-title", children: [_jsxs("div", { children: [_jsx("h4", { children: "\u041D\u0430\u0439\u0434\u0435\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F" }), _jsx("span", { children: "\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u0438\u0440\u043E\u0432\u043A\u0430 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0442\u0430\u043C, \u0433\u0434\u0435 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u0438 \u0446\u0435\u043B\u044C \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u044B \u043E\u0434\u043D\u043E\u0437\u043D\u0430\u0447\u043D\u043E." })] }), _jsx("strong", { children: report.issues.length })] }), report.issues.length > 0 ? (_jsx("div", { className: "relabel-reconciliation__issues", children: report.issues.map((issue) => (_jsxs("article", { className: issue.severity === 'CRITICAL' ? 'is-critical' : 'is-warning', children: [_jsx(AlertTriangle, { size: 20, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: issue.title }), _jsxs("span", { children: [issue.request ? `Заявка №${String(issue.request.number).padStart(6, '0')} · ` : '', "\u0437\u0430\u043A\u0430\u0437 WB \u2116", issue.order.id, issue.supplyId ? ` · ${issue.supplyId}` : '', issue.boxCode ? ` · короб ${issue.boxCode}` : ''] }), _jsx("p", { children: issue.explanation }), issue.sourceSku ? (_jsxs("small", { children: [issue.sourceSku.name, issue.targetSku ? ` → ${issue.targetSku.name}` : '', " \u00B7 ", issue.quantity, " \u0448\u0442."] })) : null] }), canEdit && issue.correctable ? (_jsxs("button", { type: "button", onClick: () => void applyIssue(issue), disabled: Boolean(applyingIssueId), children: [_jsx(Wrench, { size: 15, "aria-hidden": "true" }), applyingIssueId === issue.id ? 'Исправляю…' : 'Применить переклейку'] })) : (_jsx("em", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0432\u0440\u0443\u0447\u043D\u0443\u044E" }))] }, issue.id))) })) : (_jsxs("div", { className: "relabel-reconciliation__clean", children: [_jsx(CheckCircle2, { size: 22, "aria-hidden": "true" }), "\u041F\u043E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u043C\u0443 \u043F\u0435\u0440\u0438\u043E\u0434\u0443 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u0439 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E."] }))] })] })) : (_jsxs("div", { className: "relabel-reconciliation__empty", children: [_jsx(ShieldCheck, { size: 27, "aria-hidden": "true" }), "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043F\u0435\u0440\u0438\u043E\u0434 \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \u00AB\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043A\u0438\u00BB. \u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0447\u0438\u0442\u0430\u0435\u0442 \u0430\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u0435 \u0441\u0442\u0430\u0442\u0443\u0441\u044B \u043F\u043E\u0441\u0442\u0430\u0432\u043E\u043A \u0447\u0435\u0440\u0435\u0437 API WB."] }))] }));
}
function SummaryCard({ label, value, tone, }) {
    return (_jsxs("div", { className: tone ? `is-${tone}` : undefined, children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] }));
}
function dateInputDaysAgo(days) {
    const value = new Date();
    value.setDate(value.getDate() - days);
    return [
        value.getFullYear(),
        String(value.getMonth() + 1).padStart(2, '0'),
        String(value.getDate()).padStart(2, '0'),
    ].join('-');
}
function formatDateTime(value) {
    return new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(new Date(value));
}
function skuLine(sku) {
    return [
        sku.article ? `арт. ${sku.article}` : sku.internalSku,
        sku.size ? `размер ${sku.size}` : '',
        sku.primaryBarcode ? `ШК ${sku.primaryBarcode}` : '',
    ].filter(Boolean).join(' · ');
}
