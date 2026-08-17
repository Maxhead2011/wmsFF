import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ChevronDown, ChevronRight, ClipboardCheck, FileCheck2, FileDown, Layers3, Pencil, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { billingInvoiceStatusLabel, billingInvoiceStatusOptions, billingInvoiceStatusTone } from './billingMeta';
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});
const moneyFormatter = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
});
export function BillingInvoicesTable({ invoices, canWrite, showClientColumn = true, selectableInvoiceIds = new Set(), selectedInvoiceIds = new Set(), onInvoiceSelectionChange, onOpenDocument, onDownloadPdf, onEdit, onStatusChange, }) {
    const [expandedGroupKeys, setExpandedGroupKeys] = useState(() => new Set());
    const invoiceGroups = groupBillingInvoices(invoices);
    const selectableInvoices = invoices.filter((invoice) => selectableInvoiceIds.has(invoice.id));
    const showInvoiceSelection = Boolean(onInvoiceSelectionChange) && selectableInvoices.length > 0;
    const allSelectableSelected = selectableInvoices.length > 0 && selectableInvoices.every((invoice) => selectedInvoiceIds.has(invoice.id));
    const tableColumnCount = 7 +
        (showInvoiceSelection ? 1 : 0) +
        (showClientColumn ? 1 : 0) +
        (onOpenDocument || onDownloadPdf ? 1 : 0) +
        (canWrite ? 1 : 0);
    function toggleGroup(groupKey) {
        setExpandedGroupKeys((current) => {
            const next = new Set(current);
            if (next.has(groupKey)) {
                next.delete(groupKey);
            }
            else {
                next.add(groupKey);
            }
            return next;
        });
    }
    function toggleInvoice(invoiceId) {
        if (!onInvoiceSelectionChange || !selectableInvoiceIds.has(invoiceId)) {
            return;
        }
        const next = new Set(selectedInvoiceIds);
        if (next.has(invoiceId)) {
            next.delete(invoiceId);
        }
        else {
            next.add(invoiceId);
        }
        onInvoiceSelectionChange(next);
    }
    function toggleInvoices(invoiceIds) {
        if (!onInvoiceSelectionChange) {
            return;
        }
        const allowedIds = invoiceIds.filter((id) => selectableInvoiceIds.has(id));
        const allSelected = allowedIds.length > 0 && allowedIds.every((id) => selectedInvoiceIds.has(id));
        const next = new Set(selectedInvoiceIds);
        allowedIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
        onInvoiceSelectionChange(next);
    }
    return (_jsx("div", { className: "billing-table-wrap billing-table-wrap--invoices", children: _jsxs("table", { className: "data-table billing-table billing-table--invoices", children: [_jsx("thead", { children: _jsxs("tr", { children: [showInvoiceSelection ? (_jsx("th", { className: "billing-invoice-selection-cell", children: _jsx("input", { type: "checkbox", checked: allSelectableSelected, onChange: () => toggleInvoices(selectableInvoices.map((invoice) => invoice.id)), "aria-label": "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A\u0438" }) })) : null, _jsx("th", { children: "\u0421\u0447\u0435\u0442" }), _jsx("th", { children: "\u0412\u0438\u0434" }), showClientColumn ? _jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }) : null, _jsx("th", { children: "\u041F\u0435\u0440\u0438\u043E\u0434" }), _jsx("th", { children: "\u0421\u0443\u043C\u043C\u0430" }), _jsx("th", { children: "\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u0421\u043E\u0441\u0442\u0430\u0432" }), onOpenDocument || onDownloadPdf ? _jsx("th", { children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B" }) : null, canWrite ? _jsx("th", { children: "\u041F\u0440\u043E\u0446\u0435\u0441\u0441" }) : null] }) }), invoiceGroups.map((group) => {
                    const isCollapsed = group.isGrouped && !expandedGroupKeys.has(group.key);
                    const groupTotalRub = group.invoices.reduce((sum, invoice) => sum + Number(invoice.totalRub), 0);
                    const groupItems = group.invoices.reduce((sum, invoice) => sum + invoice.items.length, 0);
                    const periodFrom = group.invoices.reduce((earliest, invoice) => (invoice.periodFrom < earliest ? invoice.periodFrom : earliest), group.invoices[0].periodFrom);
                    const periodTo = group.invoices.reduce((latest, invoice) => (invoice.periodTo > latest ? invoice.periodTo : latest), group.invoices[0].periodTo);
                    return (_jsxs("tbody", { className: group.isGrouped ? 'billing-invoice-draft-group' : undefined, children: [group.isGrouped ? (_jsx("tr", { className: "billing-invoice-draft-group__heading", children: _jsx("td", { colSpan: tableColumnCount, children: _jsxs("div", { className: "billing-invoice-draft-group__summary", children: [showInvoiceSelection ? (_jsx("input", { type: "checkbox", checked: group.invoices
                                                    .filter((invoice) => selectableInvoiceIds.has(invoice.id))
                                                    .every((invoice) => selectedInvoiceIds.has(invoice.id)), onChange: () => toggleInvoices(group.invoices.map((invoice) => invoice.id)), "aria-label": "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u044E \u0433\u0440\u0443\u043F\u043F\u0443 FBS-\u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A\u043E\u0432" })) : null, _jsx(Layers3, { size: 16, "aria-hidden": "true" }), _jsx("button", { className: "billing-invoice-draft-group__toggle", type: "button", onClick: () => toggleGroup(group.key), "aria-expanded": !isCollapsed, "aria-label": isCollapsed ? 'Развернуть FBS-черновики' : 'Свернуть FBS-черновики', children: isCollapsed ? _jsx(ChevronRight, { size: 16, "aria-hidden": "true" }) : _jsx(ChevronDown, { size: 16, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("strong", { children: "FBS-\u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A\u0438" }), _jsxs("span", { children: [showClientColumn ? `${group.invoices[0].client.name} · ` : '', group.invoices.length, " \u0441\u0447. \u00B7 ", formatMoney(groupTotalRub), " \u20BD \u00B7 ", groupItems, " \u043F\u043E\u0437. \u00B7 ", formatDate(periodFrom), "\u2013", formatDate(periodTo)] })] })] }) }) })) : null, !isCollapsed ? group.invoices.map((invoice) => {
                                const remaining = Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub));
                                return (_jsxs("tr", { children: [showInvoiceSelection ? (_jsx("td", { className: "billing-invoice-selection-cell", children: selectableInvoiceIds.has(invoice.id) ? (_jsx("input", { type: "checkbox", checked: selectedInvoiceIds.has(invoice.id), onChange: () => toggleInvoice(invoice.id), "aria-label": `Выбрать счёт ${invoice.number}` })) : null })) : null, _jsxs("td", { children: [_jsx("strong", { children: invoice.number }), invoice.dueDate ? _jsxs("span", { children: ["\u0434\u043E ", formatDate(invoice.dueDate)] }) : null] }), _jsx("td", { children: _jsx("div", { className: "billing-invoice-kinds", children: invoiceKindLabels(invoice).map((label) => (_jsx("span", { className: `billing-invoice-kind billing-invoice-kind--${invoiceKindTone(label)}`, children: label }, label))) }) }), showClientColumn ? (_jsxs("td", { children: [_jsx("strong", { children: invoice.client.code }), _jsx("span", { children: invoice.client.name })] })) : null, _jsxs("td", { children: [_jsx("strong", { children: formatDate(invoice.periodFrom) }), _jsx("span", { children: formatDate(invoice.periodTo) })] }), _jsxs("td", { children: [_jsxs("strong", { children: [formatMoney(invoice.totalRub), " \u20BD"] }), _jsxs("span", { children: ["\u043E\u0441\u0442\u0430\u0442\u043E\u043A ", formatMoney(remaining), " \u20BD"] })] }), _jsxs("td", { children: [_jsxs("strong", { children: [formatMoney(invoice.paidRub), " \u20BD"] }), invoice.paidAt ? _jsx("span", { children: formatDate(invoice.paidAt) }) : null] }), _jsxs("td", { children: [_jsx("span", { className: `status status--${billingInvoiceStatusTone(invoice.status)}`, children: billingInvoiceStatusLabel(invoice.status) }), invoice.issuedAt ? _jsx("span", { children: formatDate(invoice.issuedAt) }) : null] }), _jsxs("td", { children: [_jsxs("strong", { children: [invoice.items.length, " \u043F\u043E\u0437."] }), _jsxs("span", { children: [invoice.payments.length, " \u043E\u043F\u043B\u0430\u0442"] })] }), onOpenDocument || onDownloadPdf ? (_jsx("td", { children: _jsxs("div", { className: "billing-document-actions", children: [onOpenDocument ? (_jsxs(_Fragment, { children: [_jsxs("button", { className: "document-open-button", type: "button", onClick: () => onOpenDocument(invoice, 'invoice'), title: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0441\u0447\u0435\u0442 HTML", children: [_jsx(ReceiptText, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u0447\u0435\u0442" })] }), _jsxs("button", { className: "document-open-button", type: "button", onClick: () => onOpenDocument(invoice, 'act'), title: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0430\u043A\u0442 HTML", children: [_jsx(ClipboardCheck, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0410\u043A\u0442" })] })] })) : null, onDownloadPdf ? (_jsxs(_Fragment, { children: [_jsxs("button", { className: "document-open-button", type: "button", onClick: () => onDownloadPdf(invoice, 'invoice'), title: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u0441\u0447\u0435\u0442 PDF", children: [_jsx(FileDown, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u0447\u0435\u0442 PDF" })] }), _jsxs("button", { className: "document-open-button", type: "button", onClick: () => onDownloadPdf(invoice, 'act'), title: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u0430\u043A\u0442 PDF", children: [_jsx(FileDown, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0410\u043A\u0442 PDF" })] })] })) : null] }) })) : null, canWrite ? (_jsx("td", { children: _jsxs("div", { className: "billing-invoice-process-actions", children: [(invoice.status === 'DRAFT' || invoice.status === 'ISSUED') && onEdit ? (_jsxs("button", { className: "document-open-button", type: "button", onClick: () => onEdit(invoice), title: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0447\u0435\u0442", children: [_jsx(Pencil, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C" })] })) : null, _jsxs("label", { className: "billing-status-select", children: [_jsx(FileCheck2, { size: 15, "aria-hidden": "true" }), _jsx("select", { value: invoice.status, onChange: (event) => onStatusChange(invoice.id, event.target.value), children: billingInvoiceStatusOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] })] }) })) : null] }, invoice.id));
                            }) : null] }, group.key));
                })] }) }));
}
function groupBillingInvoices(invoices) {
    const fbsDraftsByClient = new Map();
    invoices.forEach((invoice) => {
        if (!isAutomaticFbsDraft(invoice)) {
            return;
        }
        const current = fbsDraftsByClient.get(invoice.clientId) ?? [];
        current.push(invoice);
        fbsDraftsByClient.set(invoice.clientId, current);
    });
    const emittedClients = new Set();
    const groups = [];
    invoices.forEach((invoice) => {
        const clientDrafts = fbsDraftsByClient.get(invoice.clientId) ?? [];
        if (isAutomaticFbsDraft(invoice) && clientDrafts.length > 1) {
            if (emittedClients.has(invoice.clientId)) {
                return;
            }
            emittedClients.add(invoice.clientId);
            groups.push({
                key: `fbs-drafts:${invoice.clientId}`,
                invoices: clientDrafts,
                isGrouped: true,
            });
            return;
        }
        groups.push({ key: `invoice:${invoice.id}`, invoices: [invoice], isGrouped: false });
    });
    return groups;
}
function isAutomaticFbsDraft(invoice) {
    return (invoice.status === 'DRAFT' &&
        (invoice.sourceKey?.startsWith('fbs-invoice:') === true ||
            invoice.sourceKey?.startsWith('fbs-primary-invoice:') === true ||
            invoice.sourceKey?.startsWith('fbs-merged:') === true));
}
function invoiceKindLabels(invoice) {
    const kinds = new Set();
    if (invoice.sourceKey?.startsWith('fbs-')) {
        kinds.add('FBS');
    }
    if (invoice.sourceKey?.startsWith('fbs-primary-invoice:')) {
        kinds.add('Первичная обработка');
    }
    invoice.items.forEach((item) => {
        const metadata = item.charge?.metadata;
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            return;
        }
        const kind = metadata.kind;
        if (kind === 'FBS' || kind === 'FBS_DAILY_LOGISTICS') {
            kinds.add('FBS');
        }
        if (kind === 'FBS_PRIMARY_PROCESSING') {
            kinds.add('FBS');
            kinds.add('Первичная обработка');
        }
    });
    if (kinds.size > 0) {
        return [...kinds];
    }
    if (invoice.source === 'LOGISTICS') {
        return ['Логистика'];
    }
    if (invoice.source === 'REQUEST_DONE') {
        return ['Услуги по заявке'];
    }
    return ['Другие услуги'];
}
function invoiceKindTone(label) {
    if (label === 'FBS') {
        return 'fbs';
    }
    if (label === 'Первичная обработка') {
        return 'primary';
    }
    if (label === 'Логистика') {
        return 'logistics';
    }
    return 'service';
}
function formatDate(value) {
    return dateFormatter.format(new Date(value));
}
function formatMoney(value) {
    return moneyFormatter.format(Number(value));
}
