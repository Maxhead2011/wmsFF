import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MoreHorizontal, Search, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
const moneyFormatter = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});
export function BillingClientRegister({ clients, invoices, selectedClientId, onSelect, onOpenSettings, }) {
    const [search, setSearch] = useState('');
    const rows = useMemo(() => buildRows(clients, invoices), [clients, invoices]);
    const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
    const visibleRows = useMemo(() => rows.filter((row) => {
        if (!normalizedSearch) {
            return true;
        }
        return `${row.client.code} ${row.client.name}`
            .toLocaleLowerCase('ru-RU')
            .includes(normalizedSearch);
    }), [normalizedSearch, rows]);
    const totals = useMemo(() => rows.reduce((result, row) => ({
        invoices: result.invoices + row.invoicesCount,
        issuedRub: result.issuedRub + row.issuedRub,
        debtRub: result.debtRub + row.debtRub,
    }), { invoices: 0, issuedRub: 0, debtRub: 0 }), [rows]);
    return (_jsxs("section", { className: "billing-client-register", "aria-label": "\u0420\u0435\u0435\u0441\u0442\u0440 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432 \u0431\u0438\u043B\u043B\u0438\u043D\u0433\u0430", children: [_jsxs("header", { className: "billing-client-register__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041A\u043E\u043D\u0442\u0440\u0430\u0433\u0435\u043D\u0442\u044B" }), _jsx("h3", { children: "\u041A\u043B\u0438\u0435\u043D\u0442\u044B \u0438 \u0441\u0447\u0435\u0442\u0430" })] }), _jsxs("label", { className: "billing-client-register__search", children: [_jsx(Search, { size: 16, "aria-hidden": "true" }), _jsx("input", { value: search, onChange: (event) => setSearch(event.target.value), placeholder: "\u041A\u043E\u0434 \u0438\u043B\u0438 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" })] })] }), _jsxs("div", { className: "billing-client-register__totals", children: [_jsx(RegisterMetric, { label: "\u041A\u043B\u0438\u0435\u043D\u0442\u043E\u0432", value: formatInteger(rows.length) }), _jsx(RegisterMetric, { label: "\u0421\u0447\u0435\u0442\u043E\u0432", value: formatInteger(totals.invoices) }), _jsx(RegisterMetric, { label: "\u0412\u044B\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E", value: `${formatMoney(totals.issuedRub)} ₽` }), _jsx(RegisterMetric, { label: "\u0414\u043E\u043B\u0433", value: `${formatMoney(totals.debtRub)} ₽`, tone: "danger" })] }), _jsx("div", { className: "billing-client-register__table-wrap", children: _jsxs("table", { className: "billing-client-register__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041A\u043E\u0434" }), _jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("th", { children: "\u0421\u0447\u0435\u0442\u0430" }), _jsx("th", { children: "\u0412\u044B\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E" }), _jsx("th", { children: "\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E" }), _jsx("th", { children: "\u0414\u043E\u043B\u0433" }), _jsx("th", { children: "\u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A\u0438" }), _jsx("th", { children: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0441\u0447\u0435\u0442" }), _jsx("th", { "aria-label": "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438" })] }) }), _jsxs("tbody", { children: [visibleRows.map((row) => {
                                    const isSelected = row.client.id === selectedClientId;
                                    return (_jsxs("tr", { "aria-selected": isSelected, className: isSelected ? 'is-selected' : undefined, onClick: () => onSelect(row.client.id), onKeyDown: (event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                onSelect(row.client.id);
                                            }
                                        }, tabIndex: 0, children: [_jsx("td", { children: _jsx("strong", { children: row.client.code }) }), _jsx("td", { children: _jsx("strong", { children: row.client.name }) }), _jsxs("td", { children: [_jsx("strong", { children: formatInteger(row.invoicesCount) }), _jsxs("span", { children: ["\u0432\u044B\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E ", formatInteger(row.issuedCount)] })] }), _jsx("td", { children: _jsxs("strong", { children: [formatMoney(row.issuedRub), " \u20BD"] }) }), _jsx("td", { children: _jsxs("strong", { children: [formatMoney(row.paidRub), " \u20BD"] }) }), _jsx("td", { children: _jsxs("strong", { className: row.debtRub > 0 ? 'billing-client-register__debt' : undefined, children: [formatMoney(row.debtRub), " \u20BD"] }) }), _jsx("td", { children: _jsx("strong", { children: formatInteger(row.draftCount) }) }), _jsx("td", { children: row.lastInvoiceDate ? _jsx("strong", { children: formatDate(row.lastInvoiceDate) }) : _jsx("span", { children: "\u043D\u0435\u0442 \u0441\u0447\u0435\u0442\u043E\u0432" }) }), _jsx("td", { children: _jsx("button", { className: "billing-client-register__menu", type: "button", onClick: (event) => {
                                                        event.stopPropagation();
                                                        onOpenSettings(row.client);
                                                    }, onKeyDown: (event) => event.stopPropagation(), "aria-label": `Настройки услуг ${row.client.name}`, title: "\u0423\u0441\u043B\u0443\u0433\u0438 \u0438 \u0446\u0435\u043D\u044B \u043A\u043B\u0438\u0435\u043D\u0442\u0430", children: _jsx(MoreHorizontal, { size: 19, "aria-hidden": "true" }) }) })] }, row.client.id));
                                }), visibleRows.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 9, children: _jsxs("div", { className: "billing-client-register__empty", children: [_jsx(UsersRound, { size: 20, "aria-hidden": "true" }), "\u041A\u043B\u0438\u0435\u043D\u0442\u044B \u043F\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u0443 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B."] }) }) })) : null] })] }) })] }));
}
function RegisterMetric({ label, value, tone, }) {
    return (_jsxs("div", { className: tone ? `billing-client-register__metric billing-client-register__metric--${tone}` : 'billing-client-register__metric', children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] }));
}
function buildRows(clients, invoices) {
    const invoicesByClient = new Map();
    invoices.forEach((invoice) => {
        if (invoice.status === 'CANCELLED') {
            return;
        }
        const current = invoicesByClient.get(invoice.client.id) ?? [];
        current.push(invoice);
        invoicesByClient.set(invoice.client.id, current);
    });
    return clients
        .map((client) => {
        const clientInvoices = invoicesByClient.get(client.id) ?? [];
        const issuedInvoices = clientInvoices.filter((invoice) => invoice.status !== 'DRAFT');
        const issuedRub = issuedInvoices.reduce((sum, invoice) => sum + Number(invoice.totalRub), 0);
        const paidRub = issuedInvoices.reduce((sum, invoice) => sum + Number(invoice.paidRub), 0);
        const lastInvoiceDate = clientInvoices.reduce((latest, invoice) => (!latest || invoice.periodFrom > latest ? invoice.periodFrom : latest), null);
        return {
            client,
            invoicesCount: clientInvoices.length,
            issuedCount: issuedInvoices.length,
            draftCount: clientInvoices.filter((invoice) => invoice.status === 'DRAFT').length,
            issuedRub,
            paidRub,
            debtRub: Math.max(0, issuedRub - paidRub),
            lastInvoiceDate,
        };
    })
        .filter((row) => row.invoicesCount > 0)
        .sort((left, right) => left.client.name.localeCompare(right.client.name, 'ru-RU'));
}
function formatMoney(value) {
    return moneyFormatter.format(value);
}
function formatInteger(value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}
function formatDate(value) {
    return dateFormatter.format(new Date(value));
}
