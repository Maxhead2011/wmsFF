import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { CalendarClock, Check, ReceiptText, Route } from 'lucide-react';
import { useState } from 'react';
import { logisticsDeliveryStatusLabel, logisticsDeliveryStatusOptions, logisticsDeliveryStatusTone, } from './logisticsMeta';
const dateFormatter = new Intl.DateTimeFormat('ru-RU');
const moneyFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export function LogisticsDeliveryRequestsTable({ items, trips, canWrite, canCreateBillingCharge, onBillingChargeCreate, onQuoteFinalize, onStatusChange, onTripAssign, }) {
    const [quoteDrafts, setQuoteDrafts] = useState({});
    function draftFor(request) {
        return (quoteDrafts[request.id] ?? {
            estimatedTotalRub: request.estimatedTotalRub == null ? '' : String(request.estimatedTotalRub),
            managerComment: request.managerComment ?? '',
            isSaving: false,
        });
    }
    function updateDraft(deliveryId, patch) {
        setQuoteDrafts((current) => ({
            ...current,
            [deliveryId]: {
                estimatedTotalRub: current[deliveryId]?.estimatedTotalRub ?? '',
                managerComment: current[deliveryId]?.managerComment ?? '',
                isSaving: current[deliveryId]?.isSaving ?? false,
                ...patch,
            },
        }));
    }
    async function submitQuote(event, request) {
        event.preventDefault();
        const draft = draftFor(request);
        const estimatedTotalRub = Number(draft.estimatedTotalRub);
        if (!Number.isFinite(estimatedTotalRub) || estimatedTotalRub <= 0) {
            return;
        }
        updateDraft(request.id, { isSaving: true });
        try {
            await onQuoteFinalize(request.id, {
                estimatedTotalRub,
                managerComment: draft.managerComment.trim() || undefined,
            });
        }
        finally {
            updateDraft(request.id, { isSaving: false });
        }
    }
    return (_jsx("div", { className: "delivery-table-wrap", children: _jsxs("table", { className: "data-table delivery-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("th", { children: "\u041C\u0430\u0440\u0448\u0440\u0443\u0442" }), _jsx("th", { children: "\u041E\u0431\u044A\u0435\u043C" }), _jsx("th", { children: "\u0414\u0430\u0442\u0430" }), _jsx("th", { children: "\u0420\u0430\u0441\u0447\u0435\u0442" }), _jsx("th", { children: "\u0411\u0438\u043B\u043B\u0438\u043D\u0433" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u0420\u0435\u0439\u0441" }), canWrite ? _jsx("th", { children: "\u041F\u0440\u043E\u0446\u0435\u0441\u0441" }) : null] }) }), _jsx("tbody", { children: items.map((request) => {
                        const draft = draftFor(request);
                        const canFinalize = canWrite && canFinalizeQuote(request);
                        const draftAmount = Number(draft.estimatedTotalRub);
                        const canSubmitDraft = Number.isFinite(draftAmount) && draftAmount > 0 && !draft.isSaving;
                        const assignableTrips = trips.filter((trip) => trip.id === request.tripId || (trip.status !== 'COMPLETED' && trip.status !== 'CANCELLED'));
                        return (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: request.client.code }), _jsx("span", { children: request.client.name })] }), _jsxs("td", { children: [_jsxs("strong", { children: [request.origin, " -> ", request.destination] }), _jsx("span", { children: request.request?.title ?? request.comment ?? '-' })] }), _jsx("td", { children: formatQuantity(request) }), _jsxs("td", { children: [_jsx("strong", { children: formatDate(request.desiredShipDate) }), request.plannedShipDate ? _jsxs("span", { children: ["\u043F\u043B\u0430\u043D ", formatDate(request.plannedShipDate)] }) : null] }), _jsx("td", { children: canFinalize ? (_jsxs("form", { className: "delivery-quote-form", onSubmit: (event) => void submitQuote(event, request), children: [_jsx("input", { min: "0.01", step: "0.01", type: "number", value: draft.estimatedTotalRub, onChange: (event) => updateDraft(request.id, { estimatedTotalRub: event.target.value }), placeholder: "\u0421\u0443\u043C\u043C\u0430, \u20BD" }), _jsx("input", { value: draft.managerComment, onChange: (event) => updateDraft(request.id, { managerComment: event.target.value }), placeholder: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsxs("button", { className: "delivery-quote-button", type: "submit", disabled: !canSubmitDraft, children: [_jsx(Check, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: draft.isSaving ? 'Сохраняю' : 'Зафиксировать' })] })] })) : (_jsxs(_Fragment, { children: [_jsx("strong", { children: formatMoney(request.estimatedTotalRub) }), _jsx("span", { children: request.requiresManualReview ? 'ручная проверка' : request.tariffSet?.name ?? '-' })] })) }), _jsx("td", { children: request.billingCharge ? (_jsxs("div", { className: "delivery-billing-link", children: [_jsx("strong", { children: formatMoney(request.billingCharge.totalRub) }), _jsx("span", { children: request.billingCharge.status })] })) : canCreateBillingCharge && canGenerateBillingCharge(request) ? (_jsxs("button", { className: "delivery-billing-button", type: "button", onClick: () => onBillingChargeCreate(request.id), children: [_jsx(ReceiptText, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u0447\u0435\u0442" })] })) : (_jsx("span", { className: "delivery-billing-muted", children: billingHint(request) })) }), _jsxs("td", { children: [canWrite ? (_jsxs("label", { className: "delivery-trip-select", children: [_jsx(Route, { size: 15, "aria-hidden": "true" }), _jsxs("select", { value: request.tripId ?? '', onChange: (event) => onTripAssign(request.id, event.target.value || null), children: [_jsx("option", { value: "", children: "\u0411\u0435\u0437 \u0440\u0435\u0439\u0441\u0430" }), assignableTrips.map((trip) => (_jsx("option", { value: trip.id, children: formatTripOption(trip) }, trip.id)))] })] })) : (_jsx("strong", { children: request.trip?.code ?? '-' })), request.trip ? (_jsxs("span", { children: [request.trip.carrier?.name ?? 'Без перевозчика', request.trip.plannedDate ? ` · ${formatDate(request.trip.plannedDate)}` : ''] })) : null] }), _jsxs("td", { children: [_jsx("span", { className: `status status--${logisticsDeliveryStatusTone(request.status)}`, children: logisticsDeliveryStatusLabel(request.status) }), request.managerComment ? _jsx("span", { children: request.managerComment }) : null] }), canWrite ? (_jsx("td", { children: _jsxs("label", { className: "delivery-status-select", children: [_jsx(CalendarClock, { size: 15, "aria-hidden": "true" }), _jsx("select", { value: request.status, onChange: (event) => onStatusChange(request.id, event.target.value), children: logisticsDeliveryStatusOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }) })) : null] }, request.id));
                    }) })] }) }));
}
function canFinalizeQuote(request) {
    return !request.billingCharge && (request.requiresManualReview || request.estimatedTotalRub == null);
}
function canGenerateBillingCharge(request) {
    return request.status === 'DELIVERED' && request.estimatedTotalRub != null && !request.requiresManualReview;
}
function billingHint(request) {
    if (request.requiresManualReview || request.estimatedTotalRub == null) {
        return 'требует расчет';
    }
    if (request.status !== 'DELIVERED') {
        return 'после доставки';
    }
    return '-';
}
function formatQuantity(request) {
    if (request.boxes != null) {
        return `${request.boxes} кор.`;
    }
    if (request.pallets != null) {
        return `${request.pallets} пал.`;
    }
    return '-';
}
function formatDate(value) {
    return value ? dateFormatter.format(new Date(value)) : '-';
}
function formatTripOption(trip) {
    return `${trip.code}${trip.plannedDate ? ` · ${formatDate(trip.plannedDate)}` : ''}`;
}
function formatMoney(value) {
    return value == null ? 'на проверке' : `${moneyFormatter.format(Number(value))} ₽`;
}
