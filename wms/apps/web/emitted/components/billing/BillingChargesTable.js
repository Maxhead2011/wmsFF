import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { CheckCircle2, Info, Trash2, Truck, X } from 'lucide-react';
import { useState } from 'react';
import { deleteBillingStorageBreakdownDay, fetchBillingStorageBreakdown, } from '../../lib/api';
import { billingStatusLabel, billingStatusOptions, billingStatusTone, billingUnitLabel } from './billingMeta';
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});
const moneyFormatter = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
});
export function BillingChargesTable({ accessToken, charges, canWrite, onStatusChange, onFbsLogisticsTripChange, }) {
    const [breakdown, setBreakdown] = useState(null);
    const [breakdownError, setBreakdownError] = useState(null);
    const [tripBusy, setTripBusy] = useState(null);
    async function openStorageBreakdown(charge) {
        setBreakdownError(null);
        try {
            setBreakdown(await fetchBillingStorageBreakdown(accessToken, charge.id));
        }
        catch (caught) {
            setBreakdownError(errorMessage(caught));
        }
    }
    async function deleteStorageDay(date) {
        if (!breakdown) {
            return;
        }
        setBreakdownError(null);
        try {
            setBreakdown(await deleteBillingStorageBreakdownDay(accessToken, breakdown.chargeId, date));
        }
        catch (caught) {
            setBreakdownError(errorMessage(caught));
        }
    }
    return (_jsxs(_Fragment, { children: [breakdownError ? _jsx("p", { className: "form-error", children: breakdownError }) : null, _jsx("div", { className: "billing-table-wrap", children: _jsxs("table", { className: "data-table billing-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u041D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u0435" }), _jsx("th", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("th", { children: "\u0426\u0435\u043D\u0430" }), _jsx("th", { children: "\u0421\u0443\u043C\u043C\u0430" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), canWrite ? _jsx("th", { children: "\u041F\u0440\u043E\u0446\u0435\u0441\u0441" }) : null] }) }), _jsx("tbody", { children: charges.map((charge) => {
                                const trip = fbsLogisticsTrip(charge);
                                return (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: charge.description }), _jsx("span", { children: charge.request?.title ?? charge.service?.code ?? 'ручное начисление' }), _jsx("span", { children: chargeSourceLabel(charge) }), _jsx("span", { children: formatDate(charge.serviceDate) }), trip ? (_jsxs("div", { className: `billing-fbs-trip billing-fbs-trip--${trip.charged ? 'charged' : 'combined'}`, children: [_jsxs("span", { children: [_jsx(Truck, { size: 14, "aria-hidden": "true" }), trip.automaticPrimary
                                                                    ? 'Основной выезд клиента за день'
                                                                    : trip.extraTripOverride
                                                                        ? 'Отдельный выезд указан вручную'
                                                                        : 'Объединено с выездом клиента за этот день'] }), canWrite && charge.status === 'DRAFT' && !trip.automaticPrimary ? (_jsx("button", { type: "button", onClick: () => {
                                                                setTripBusy(charge.id);
                                                                Promise.resolve(onFbsLogisticsTripChange(charge.id, !trip.extraTripOverride)).finally(() => setTripBusy((current) => current === charge.id ? null : current));
                                                            }, disabled: tripBusy === charge.id, children: trip.extraTripOverride ? 'Объединить выезд' : 'Считать отдельным выездом' })) : null] })) : null, charge.source === 'STORAGE' ? (_jsxs("button", { className: "icon-text-button billing-breakdown-button", type: "button", onClick: () => void openStorageBreakdown(charge), children: [_jsx(Info, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0430" })] })) : null] }), _jsxs("td", { children: [_jsx("strong", { children: charge.client.code }), _jsx("span", { children: charge.client.name })] }), _jsxs("td", { children: [formatNumber(charge.quantity), " ", billingUnitLabel(charge.unit)] }), _jsxs("td", { children: [formatMoney(charge.unitPriceRub), " \u20BD"] }), _jsx("td", { children: _jsxs("strong", { children: [formatMoney(charge.totalRub), " \u20BD"] }) }), _jsxs("td", { children: [_jsx("span", { className: `status status--${billingStatusTone(charge.status)}`, children: billingStatusLabel(charge.status) }), charge.approvedBy ? _jsx("span", { children: charge.approvedBy.name }) : null] }), canWrite ? (_jsx("td", { children: _jsxs("label", { className: "billing-status-select", children: [_jsx(CheckCircle2, { size: 15, "aria-hidden": "true" }), _jsx("select", { value: charge.status, onChange: (event) => onStatusChange(charge.id, event.target.value), children: billingStatusOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }) })) : null] }, charge.id));
                            }) })] }) }), breakdown ? (_jsx("div", { className: "billing-storage-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0430 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F", children: _jsxs("div", { className: "billing-storage-modal__card", children: [_jsxs("div", { className: "billing-storage-modal__heading", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0430 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F" }), _jsxs("span", { children: [breakdown.periodFrom ?? '-', " - ", breakdown.periodTo ?? '-'] })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => setBreakdown(null), "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "billing-storage-modal__metrics", children: [_jsx(Metric, { label: "\u041B\u0438\u0442\u0440\u043E-\u0434\u043D\u0435\u0439", value: formatNumber(breakdown.quantity) }), _jsx(Metric, { label: "\u0422\u0430\u0440\u0438\u0444", value: `${formatMoney(breakdown.unitPriceRub)} ₽` }), _jsx(Metric, { label: "\u0421\u0443\u043C\u043C\u0430", value: `${formatMoney(breakdown.totalRub)} ₽` })] }), _jsx("div", { className: "billing-table-wrap billing-storage-modal__table", children: _jsxs("table", { className: "data-table billing-storage-detail-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0422\u0438\u043F" }), _jsx("th", { children: "\u0414\u0430\u0442\u0430" }), _jsx("th", { children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442" }), _jsx("th", { children: "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435" }), _jsx("th", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("th", { children: "\u0421\u0443\u043C\u043C\u0430, \u20BD" }), canWrite && breakdown.canDeleteRows ? _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435" }) : null] }) }), _jsx("tbody", { children: breakdown.rows.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: "\u0423\u0441\u043B\u0443\u0433\u0430" }), _jsx("td", { children: formatDate(row.date) }), _jsx("td", { children: row.document }), _jsx("td", { children: row.description }), _jsxs("td", { children: [_jsx("strong", { children: formatNumber(row.literDays) }), _jsxs("span", { children: [formatNumber(row.totalLiters), " \u043B, \u043F\u043E\u0437\u0438\u0446\u0438\u0439 ", row.positions] })] }), _jsx("td", { children: formatMoney(row.totalRub) }), canWrite && breakdown.canDeleteRows ? (_jsx("td", { children: _jsxs("button", { className: "icon-text-button", type: "button", onClick: () => void deleteStorageDay(row.date), children: [_jsx(Trash2, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C" })] }) })) : null] }, row.date))) })] }) })] }) })) : null] }));
}
function Metric({ label, value }) {
    return (_jsxs("article", { children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] }));
}
function formatDate(value) {
    return dateFormatter.format(new Date(value));
}
function formatNumber(value) {
    return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}
function formatMoney(value) {
    return moneyFormatter.format(Number(value));
}
function chargeSourceLabel(charge) {
    if (charge.source === 'STORAGE') {
        return 'авто: хранение';
    }
    if (charge.source === 'LOGISTICS') {
        return 'авто: логистика';
    }
    if (charge.metadata?.packageBilling === true) {
        return 'авто: обработка заявки';
    }
    return 'ручное';
}
function fbsLogisticsTrip(charge) {
    const value = charge.metadata?.logisticsTrip;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const trip = value;
    return {
        automaticPrimary: trip.automaticPrimary === true,
        extraTripOverride: trip.extraTripOverride === true,
        charged: trip.charged === true,
    };
}
function errorMessage(caught) {
    return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
