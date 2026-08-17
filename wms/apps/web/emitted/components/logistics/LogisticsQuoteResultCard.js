import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
const moneyFormatter = new Intl.NumberFormat('ru-RU', {
    currency: 'RUB',
    maximumFractionDigits: 2,
    style: 'currency',
});
export function LogisticsQuoteResultCard({ result }) {
    const icon = result.requiresManualReview ? (_jsx(AlertTriangle, { size: 18, "aria-hidden": "true" })) : (_jsx(CheckCircle2, { size: 18, "aria-hidden": "true" }));
    return (_jsxs("div", { className: result.requiresManualReview ? 'quote-result quote-result--manual' : 'quote-result', children: [icon, _jsxs("div", { className: "quote-result__content", children: [_jsxs("div", { className: "quote-result__title", children: [_jsx("strong", { children: result.requiresManualReview ? 'Нужна ручная проверка' : formatMoney(result.estimatedTotalRub) }), _jsx("span", { children: result.tariffSet.name })] }), _jsxs("div", { className: "quote-result__grid", children: [_jsx(QuoteMetric, { label: "\u041C\u0430\u0440\u0448\u0440\u0443\u0442", value: `${result.route.origin} -> ${result.route.destination}` }), _jsx(QuoteMetric, { label: "\u0420\u0430\u0441\u0447\u0435\u0442", value: result.input.boxes ? `${result.input.boxes} короб.` : `${result.input.pallets} паллет.` }), _jsx(QuoteMetric, { label: "\u0421\u0442\u0443\u043F\u0435\u043D\u044C", value: result.tier.label }), _jsx(QuoteMetric, { label: "\u0426\u0435\u043D\u0430", value: formatMoney(result.tier.priceRub) })] }), result.note ? _jsx("p", { className: "quote-note", children: result.note }) : null] })] }));
}
function QuoteMetric({ label, value }) {
    return (_jsxs("div", { className: "quote-metric", children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] }));
}
function formatMoney(value) {
    return value == null ? 'Без автосуммы' : moneyFormatter.format(value);
}
