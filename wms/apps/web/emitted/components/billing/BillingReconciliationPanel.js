import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, CalendarClock, HandCoins, ReceiptText, WalletCards } from 'lucide-react';
import { billingInvoiceStatusLabel, billingInvoiceStatusTone } from './billingMeta';
import './billing.css';
const moneyFormatter = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
});
export function BillingReconciliationPanel({ report, clientId, title = 'Сверка и задолженность', }) {
    const clients = report?.clients.filter((item) => !clientId || item.client.id === clientId) ?? [];
    const totals = buildTotals(clients);
    return (_jsxs("section", { className: "billing-reconciliation", "aria-label": title, children: [_jsx("div", { className: "billing-reconciliation__heading", children: _jsxs("div", { children: [_jsx("h3", { children: title }), _jsx("span", { children: report ? `Обновлено ${formatDateTime(report.generatedAt)}` : 'Нет данных' })] }) }), _jsxs("div", { className: "billing-reconciliation__metrics", children: [_jsx(ReconciliationMetric, { icon: ReceiptText, label: "\u0412\u044B\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E", value: `${formatMoney(totals.totalRub)} ₽` }), _jsx(ReconciliationMetric, { icon: WalletCards, label: "\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E", value: `${formatMoney(totals.paidRub)} ₽` }), _jsx(ReconciliationMetric, { icon: HandCoins, label: "\u0410\u0432\u0430\u043D\u0441", value: `${formatMoney(totals.advanceRub)} ₽` }), _jsx(ReconciliationMetric, { icon: CalendarClock, label: "\u041A \u043E\u043F\u043B\u0430\u0442\u0435", value: `${formatMoney(totals.debtRub)} ₽` }), _jsx(ReconciliationMetric, { icon: AlertTriangle, label: "\u041F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043E", value: `${formatMoney(totals.overdueRub)} ₽` })] }), clients.length > 0 ? (_jsx("div", { className: "billing-reconciliation__clients", children: clients.map((client) => (_jsx(ClientDebtCard, { item: client }, client.client.id))) })) : (_jsx("p", { className: "panel-message", children: "\u041E\u0442\u043A\u0440\u044B\u0442\u043E\u0439 \u0437\u0430\u0434\u043E\u043B\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u0438 \u043F\u043E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u043C \u0443\u0441\u043B\u043E\u0432\u0438\u044F\u043C \u043D\u0435\u0442." }))] }));
}
function ReconciliationMetric({ icon: Icon, label, value, }) {
    return (_jsxs("article", { className: "billing-reconciliation-metric", children: [_jsx(Icon, { size: 20, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] })] }));
}
function ClientDebtCard({ item }) {
    const visibleInvoices = item.invoices.filter((invoice) => invoice.remainingRub > 0).slice(0, 3);
    return (_jsxs("article", { className: "billing-reconciliation-client", children: [_jsxs("div", { className: "billing-reconciliation-client__summary", children: [_jsxs("div", { children: [_jsx("span", { children: item.client.code }), _jsx("strong", { children: item.client.name })] }), _jsxs("div", { children: [_jsxs("strong", { children: [formatMoney(item.debtRub), " \u20BD"] }), _jsxs("span", { children: ["\u0434\u043E\u043B\u0433, ", numberFormatter.format(item.openInvoicesCount), " \u0441\u0447\u0435\u0442\u043E\u0432"] })] }), _jsxs("div", { children: [_jsxs("strong", { children: [formatMoney(item.advanceRub), " \u20BD"] }), _jsx("span", { children: item.creditRub > 0 ? `остаток аванса ${formatMoney(item.creditRub)} ₽` : 'учтено в общем долге' })] }), _jsxs("div", { children: [_jsxs("strong", { children: [formatMoney(item.overdueRub), " \u20BD"] }), _jsxs("span", { children: ["\u043F\u0440\u043E\u0441\u0440\u043E\u0447\u043A\u0430, ", numberFormatter.format(item.overdueInvoicesCount), " \u0441\u0447\u0435\u0442\u043E\u0432"] })] }), _jsxs("div", { children: [_jsx("strong", { children: item.nearestDueDate ? formatDate(item.nearestDueDate) : '-' }), _jsx("span", { children: "\u0431\u043B\u0438\u0436\u0430\u0439\u0448\u0438\u0439 \u0441\u0440\u043E\u043A" })] })] }), visibleInvoices.length > 0 ? (_jsx("div", { className: "billing-reconciliation-invoices", children: visibleInvoices.map((invoice) => (_jsxs("div", { className: "billing-reconciliation-invoice", children: [_jsxs("div", { children: [_jsx("strong", { children: invoice.number }), _jsxs("span", { children: [formatDate(invoice.periodFrom), " - ", formatDate(invoice.periodTo)] })] }), _jsxs("div", { children: [_jsxs("strong", { children: [formatMoney(invoice.remainingRub), " \u20BD"] }), _jsx("span", { children: invoice.dueDate ? `до ${formatDate(invoice.dueDate)}` : 'без срока' })] }), _jsx("span", { className: `status status--${billingInvoiceStatusTone(invoice.status)}`, children: billingInvoiceStatusLabel(invoice.status) }), invoice.overdueDays > 0 ? _jsxs("span", { className: "status status--danger", children: [invoice.overdueDays, " \u0434\u043D."] }) : null] }, invoice.id))) })) : (_jsx("p", { className: "billing-reconciliation-client__empty", children: "\u041D\u0435\u0442 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0445 \u0441\u0447\u0435\u0442\u043E\u0432." }))] }));
}
function buildTotals(items) {
    return items.reduce((totals, item) => ({
        totalRub: roundMoney(totals.totalRub + item.totalRub),
        paidRub: roundMoney(totals.paidRub + item.paidRub),
        advanceRub: roundMoney(totals.advanceRub + item.advanceRub),
        debtRub: roundMoney(totals.debtRub + item.debtRub),
        overdueRub: roundMoney(totals.overdueRub + item.overdueRub),
    }), { totalRub: 0, paidRub: 0, advanceRub: 0, debtRub: 0, overdueRub: 0 });
}
function formatMoney(value) {
    return moneyFormatter.format(Number(value));
}
function formatDate(value) {
    return value ? new Date(value).toLocaleDateString('ru-RU') : '-';
}
function formatDateTime(value) {
    return new Date(value).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
