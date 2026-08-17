import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { CalendarDays, FileText, ReceiptText, WalletCards } from 'lucide-react';
import { billingInvoiceStatusLabel, billingStatusLabel, billingUnitLabel } from './billingMeta';
const periodFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const dateFormatter = new Intl.DateTimeFormat('ru-RU');
const moneyFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
export function BillingPeriodSummary({ charges, invoices }) {
    const periods = useMemo(() => buildBillingPeriods(charges, invoices), [charges, invoices]);
    const [selectedKey, setSelectedKey] = useState('');
    const selectedPeriod = periods.find((period) => period.key === selectedKey) ?? periods[0] ?? null;
    if (periods.length === 0) {
        return _jsx("p", { className: "panel-message", children: "\u041F\u0435\u0440\u0438\u043E\u0434\u043D\u043E\u0439 \u0434\u0435\u0442\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." });
    }
    return (_jsxs("section", { className: "billing-period-summary", "aria-label": "\u041F\u0435\u0440\u0438\u043E\u0434\u043D\u0430\u044F \u0434\u0435\u0442\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F \u0431\u0438\u043B\u043B\u0438\u043D\u0433\u0430", children: [_jsx("div", { className: "billing-period-summary__rail", children: periods.slice(0, 12).map((period) => (_jsxs("button", { className: `billing-period-card${period.key === selectedPeriod?.key ? ' is-active' : ''}`, type: "button", onClick: () => setSelectedKey(period.key), children: [_jsx(CalendarDays, { size: 17, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: period.label }), _jsxs("span", { children: [period.clients.size, " \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432 \u00B7 ", period.chargesCount, " \u043D\u0430\u0447\u0438\u0441\u043B. \u00B7 ", period.invoicesCount, " \u0441\u0447\u0435\u0442\u043E\u0432"] })] }), _jsxs("strong", { children: [formatMoney(period.debtRub), " \u20BD"] })] }, period.key))) }), selectedPeriod ? _jsx(BillingPeriodDetails, { period: selectedPeriod }) : null] }));
}
function BillingPeriodDetails({ period }) {
    return (_jsxs("div", { className: "billing-period-detail", children: [_jsxs("div", { className: "billing-period-detail__metrics", children: [_jsx(PeriodMetric, { icon: _jsx(FileText, { size: 18 }), label: "\u0423\u0441\u043B\u0443\u0433\u0438", value: `${formatMoney(period.chargesRub)} ₽` }), _jsx(PeriodMetric, { icon: _jsx(ReceiptText, { size: 18 }), label: "\u0421\u0447\u0435\u0442\u0430", value: `${formatMoney(period.invoicesRub)} ₽` }), _jsx(PeriodMetric, { icon: _jsx(WalletCards, { size: 18 }), label: "\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E", value: `${formatMoney(period.paidRub)} ₽` }), _jsx(PeriodMetric, { icon: _jsx(CalendarDays, { size: 18 }), label: "\u0414\u043E\u043B\u0433", value: `${formatMoney(period.debtRub)} ₽` })] }), _jsxs("div", { className: "billing-period-detail__grid", children: [_jsx(PeriodColumn, { title: "\u0423\u0441\u043B\u0443\u0433\u0438", emptyText: "\u0423\u0441\u043B\u0443\u0433 \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434 \u043D\u0435\u0442.", children: period.services.slice(0, 8).map((service) => (_jsxs("div", { className: "billing-period-row", children: [_jsxs("div", { children: [_jsx("strong", { children: service.title }), _jsxs("span", { children: [service.count, " \u043D\u0430\u0447\u0438\u0441\u043B. \u00B7 ", service.unit, " \u00B7 \u043A\u043E\u043B-\u0432\u043E ", formatNumber(service.quantity)] })] }), _jsxs("strong", { children: [formatMoney(service.totalRub), " \u20BD"] })] }, service.key))) }), _jsx(PeriodColumn, { title: "\u041A\u043B\u0438\u0435\u043D\u0442\u044B", emptyText: "\u041A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u0438\u0445 \u0438\u0442\u043E\u0433\u043E\u0432 \u043D\u0435\u0442.", children: period.clientRows.slice(0, 8).map((client) => (_jsxs("div", { className: "billing-period-row", children: [_jsxs("div", { children: [_jsx("strong", { children: client.title }), _jsxs("span", { children: ["\u0441\u0447\u0435\u0442\u0430 ", formatMoney(client.invoicesRub), " \u20BD \u00B7 \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E ", formatMoney(client.paidRub), " \u20BD"] })] }), _jsxs("strong", { children: [formatMoney(client.debtRub), " \u20BD"] })] }, client.key))) }), _jsxs(PeriodColumn, { title: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B", emptyText: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u043E\u0432 \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434 \u043D\u0435\u0442.", children: [period.invoices.slice(0, 6).map((invoice) => (_jsxs("div", { className: "billing-period-row", children: [_jsxs("div", { children: [_jsxs("strong", { children: ["\u0421\u0447\u0435\u0442 \u2116 ", invoice.number] }), _jsxs("span", { children: [invoice.client.code, " \u00B7 ", billingInvoiceStatusLabel(invoice.status), " \u00B7 ", formatDate(invoice.periodFrom)] })] }), _jsxs("strong", { children: [formatMoney(invoice.totalRub), " \u20BD"] })] }, invoice.id))), period.charges.slice(0, 4).map((charge) => (_jsxs("div", { className: "billing-period-row", children: [_jsxs("div", { children: [_jsx("strong", { children: charge.description }), _jsxs("span", { children: [charge.client.code, " \u00B7 ", billingStatusLabel(charge.status), " \u00B7 ", formatDate(charge.serviceDate)] })] }), _jsxs("strong", { children: [formatMoney(charge.totalRub), " \u20BD"] })] }, charge.id)))] })] })] }));
}
function PeriodMetric({ icon, label, value }) {
    return (_jsxs("article", { className: "billing-period-metric", children: [icon, _jsxs("div", { children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] })] }));
}
function PeriodColumn({ title, emptyText, children }) {
    const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
    return (_jsxs("div", { className: "billing-period-column", children: [_jsx("strong", { children: title }), items.length > 0 ? children : _jsx("p", { className: "billing-period-empty", children: emptyText })] }));
}
function buildBillingPeriods(charges, invoices) {
    const groups = new Map();
    charges.forEach((charge) => {
        const group = ensurePeriod(groups, charge.serviceDate);
        const totalRub = Number(charge.totalRub);
        group.clients.add(charge.clientId);
        group.chargesCount += 1;
        group.chargesRub += totalRub;
        group.approvedRub += charge.status === 'APPROVED' ? totalRub : 0;
        group.draftRub += charge.status === 'DRAFT' ? totalRub : 0;
        group.cancelledRub += charge.status === 'CANCELLED' ? totalRub : 0;
        group.charges.push(charge);
    });
    invoices.forEach((invoice) => {
        const group = ensurePeriod(groups, invoice.periodFrom);
        const totalRub = Number(invoice.totalRub);
        const paidRub = Number(invoice.paidRub);
        group.clients.add(invoice.clientId);
        group.invoicesCount += 1;
        group.paymentsCount += invoice.payments.length;
        group.invoicesRub += totalRub;
        group.paidRub += paidRub;
        group.debtRub += Math.max(0, totalRub - paidRub);
        group.invoices.push(invoice);
    });
    groups.forEach((group) => {
        group.services = buildServiceRows(group.charges);
        group.clientRows = buildClientRows(group.charges, group.invoices);
        group.charges.sort((left, right) => right.serviceDate.localeCompare(left.serviceDate));
        group.invoices.sort((left, right) => right.periodFrom.localeCompare(left.periodFrom));
    });
    return [...groups.values()].sort((left, right) => right.key.localeCompare(left.key));
}
function ensurePeriod(groups, dateValue) {
    const key = dateValue.slice(0, 7);
    const current = groups.get(key);
    if (current) {
        return current;
    }
    const created = {
        key,
        label: periodFormatter.format(new Date(`${key}-01T00:00:00.000Z`)),
        clients: new Set(),
        chargesCount: 0,
        invoicesCount: 0,
        paymentsCount: 0,
        chargesRub: 0,
        approvedRub: 0,
        draftRub: 0,
        cancelledRub: 0,
        invoicesRub: 0,
        paidRub: 0,
        debtRub: 0,
        charges: [],
        invoices: [],
        services: [],
        clientRows: [],
    };
    groups.set(key, created);
    return created;
}
function buildServiceRows(charges) {
    const services = new Map();
    charges.forEach((charge) => {
        const key = `${charge.serviceId ?? charge.source}:${charge.unit}`;
        const current = services.get(key);
        const totalRub = Number(charge.totalRub);
        const quantity = Number(charge.quantity);
        if (!current) {
            services.set(key, {
                key,
                title: charge.service?.name ?? charge.description,
                unit: billingUnitLabel(charge.unit),
                count: 1,
                quantity,
                totalRub,
            });
            return;
        }
        current.count += 1;
        current.quantity += quantity;
        current.totalRub += totalRub;
    });
    return [...services.values()].sort((left, right) => right.totalRub - left.totalRub);
}
function buildClientRows(charges, invoices) {
    const clients = new Map();
    charges.forEach((charge) => {
        const client = ensureClient(clients, charge.clientId, `${charge.client.code} · ${charge.client.name}`);
        client.chargesRub += Number(charge.totalRub);
    });
    invoices.forEach((invoice) => {
        const client = ensureClient(clients, invoice.clientId, `${invoice.client.code} · ${invoice.client.name}`);
        const totalRub = Number(invoice.totalRub);
        const paidRub = Number(invoice.paidRub);
        client.invoicesRub += totalRub;
        client.paidRub += paidRub;
        client.debtRub += Math.max(0, totalRub - paidRub);
    });
    return [...clients.values()].sort((left, right) => right.debtRub - left.debtRub || right.chargesRub - left.chargesRub);
}
function ensureClient(clients, key, title) {
    const current = clients.get(key);
    if (current) {
        return current;
    }
    const created = {
        key,
        title,
        chargesRub: 0,
        invoicesRub: 0,
        paidRub: 0,
        debtRub: 0,
    };
    clients.set(key, created);
    return created;
}
function formatMoney(value) {
    return moneyFormatter.format(Number(value));
}
function formatNumber(value) {
    return numberFormatter.format(value);
}
function formatDate(value) {
    return value ? dateFormatter.format(new Date(value)) : '-';
}
