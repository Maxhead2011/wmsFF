import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BadgeRussianRuble, Boxes, ClipboardList, HandCoins, PackageCheck, ReceiptText } from 'lucide-react';
import { formatCabinetMoney, formatCabinetNumber } from './clientCabinetFormat';
const closedRequestStatuses = ['DONE', 'CANCELLED', 'REJECTED'];
export function ClientCabinetMetrics({ stock, requests, invoices, advanceRub, onNavigate, onOpenAdvance, }) {
    const uniqueSkuCount = new Set(stock.map((balance) => balance.skuId)).size;
    const totalQuantity = stock.reduce((sum, balance) => sum + Number(balance.quantity), 0);
    const activeRequests = requests.filter((request) => !closedRequestStatuses.includes(request.status)).length;
    // «К оплате» — это долг только по уже выставленным счетам.
    // Черновики и ещё не выставленные начисления не являются задолженностью клиента.
    const invoiceGrossDebtRub = invoices
        .filter((invoice) => invoice.status === 'ISSUED')
        .reduce((sum, invoice) => sum + Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub)), 0);
    const debtRub = Math.max(0, invoiceGrossDebtRub - advanceRub);
    const fbsInvoicesRub = invoices
        .filter((invoice) => invoice.status === 'ISSUED' || invoice.status === 'PAID')
        .reduce((sum, invoice) => sum + fbsInvoiceItemsRub(invoice), 0);
    return (_jsxs("div", { className: "client-cabinet-metrics", "aria-label": "\u0421\u0432\u043E\u0434\u043A\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u0430", children: [_jsx(MetricTile, { icon: PackageCheck, label: "SKU", value: formatCabinetNumber(uniqueSkuCount), onClick: () => onNavigate('skus') }), _jsx(MetricTile, { icon: Boxes, label: "\u0415\u0434\u0438\u043D\u0438\u0446 \u043D\u0430 \u043E\u0441\u0442\u0430\u0442\u043A\u0435", value: formatCabinetNumber(totalQuantity), onClick: () => onNavigate('stock') }), _jsx(MetricTile, { icon: ClipboardList, label: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0435 \u0437\u0430\u044F\u0432\u043A\u0438", value: formatCabinetNumber(activeRequests), onClick: () => onNavigate('requests') }), _jsx(MetricTile, { icon: ReceiptText, label: "\u041A \u043E\u043F\u043B\u0430\u0442\u0435", value: `${formatCabinetMoney(debtRub)} ₽`, onClick: () => onNavigate('invoices') }), _jsx(MetricTile, { icon: HandCoins, label: "\u0410\u0432\u0430\u043D\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435", value: `${formatCabinetMoney(advanceRub)} ₽`, onClick: onOpenAdvance }), _jsx(MetricTile, { icon: BadgeRussianRuble, label: "\u0412\u044B\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E \u043F\u043E FBS", value: `${formatCabinetMoney(fbsInvoicesRub)} ₽`, onClick: () => onNavigate('invoices') })] }));
}
function fbsInvoiceItemsRub(invoice) {
    const hasFbsMarker = isFbsSourceKey(invoice.sourceKey) ||
        invoice.items.some((item) => isFbsSourceKey(item.charge?.sourceKey) || /\bFBS\b/i.test(item.description));
    if (!hasFbsMarker) {
        return 0;
    }
    return invoice.items
        .filter((item) => {
        if (isFbsSourceKey(item.charge?.sourceKey) || /\bFBS\b/i.test(item.description)) {
            return true;
        }
        // В объединённых FBS-счетах строки первичной обработки и перемаркировки
        // могут не иметь chargeId, но относятся к тем же FBS-заказам.
        return /^(Первичная обработка|Перемаркировка)/i.test(item.description.trim());
    })
        .reduce((sum, item) => sum + Number(item.totalRub), 0);
}
function isFbsSourceKey(sourceKey) {
    return Boolean(sourceKey && (/^fbs[-:]/i.test(sourceKey) || /^fbs$/i.test(sourceKey)));
}
function MetricTile({ icon: Icon, label, value, onClick, }) {
    return (_jsxs("button", { className: "client-cabinet-metric", type: "button", onClick: onClick, children: [_jsx(Icon, { size: 21, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] })] }));
}
