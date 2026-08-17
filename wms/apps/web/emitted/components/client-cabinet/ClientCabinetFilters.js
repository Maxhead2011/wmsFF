import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ChevronDown, Filter, RotateCcw } from 'lucide-react';
import { billingInvoiceStatusLabel, billingStatusLabel, requestStatusLabel } from './clientCabinetFormat';
export const emptyClientCabinetFilters = {
    dateFrom: '',
    dateTo: '',
    requestStatus: '',
    invoiceStatus: '',
    chargeStatus: '',
    notificationState: '',
    fileState: '',
};
const requestStatusOptions = [
    'SUBMITTED',
    'IN_REVIEW',
    'APPROVED',
    'IN_WORK',
    'PACKED',
    'DONE',
    'CANCELLED',
    'REJECTED',
];
const billingInvoiceStatusOptions = ['DRAFT', 'ISSUED', 'PAID', 'CANCELLED'];
const billingStatusOptions = ['DRAFT', 'APPROVED', 'CANCELLED'];
export function ClientCabinetFilters({ value, totals, isOpen, onChange, onToggle }) {
    const activeCount = Object.values(value).filter(Boolean).length;
    function update(patch) {
        onChange({ ...value, ...patch });
    }
    return (_jsxs("section", { className: `client-cabinet-filters ${isOpen ? 'is-open' : 'is-collapsed'}`, "aria-label": "\u0424\u0438\u043B\u044C\u0442\u0440\u044B \u043A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u043E\u0433\u043E \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0430", children: [_jsxs("div", { className: "client-cabinet-filters__header", children: [_jsxs("button", { className: "client-cabinet-filters__toggle", type: "button", onClick: onToggle, "aria-expanded": isOpen, title: isOpen ? 'Свернуть фильтры' : 'Показать фильтры', children: [_jsx(Filter, { size: 18, "aria-hidden": "true" }), _jsxs("span", { children: [_jsx("strong", { children: "\u0424\u0438\u043B\u044C\u0442\u0440\u044B" }), _jsx("small", { children: activeCount > 0 ? `${activeCount} активно` : 'без фильтров' })] }), _jsx(ChevronDown, { className: "client-cabinet-filters__chevron", size: 17, "aria-hidden": "true" })] }), _jsxs("div", { className: "client-cabinet-filter-summary", "aria-label": "\u0418\u0442\u043E\u0433\u0438 \u0444\u0438\u043B\u044C\u0442\u0440\u0430", children: [_jsxs("span", { children: [totals.requests, " \u0437\u0430\u044F\u0432\u043E\u043A"] }), _jsxs("span", { children: [totals.files, " \u0444\u0430\u0439\u043B\u043E\u0432"] }), _jsxs("span", { children: [totals.invoices, " \u0441\u0447\u0435\u0442\u043E\u0432"] }), _jsxs("span", { children: [totals.charges, " \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u0439"] }), _jsxs("span", { children: [totals.notifications, " \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0439"] })] }), _jsxs("button", { className: "icon-text-button client-cabinet-filters__reset", type: "button", onClick: () => onChange(emptyClientCabinetFilters), disabled: activeCount === 0, title: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440\u044B", children: [_jsx(RotateCcw, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C" })] })] }), isOpen ? (_jsxs("div", { className: "client-cabinet-filter-grid", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u0441" }), _jsx("input", { type: "date", value: value.dateFrom, onChange: (event) => update({ dateFrom: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u043F\u043E" }), _jsx("input", { type: "date", value: value.dateTo, onChange: (event) => update({ dateTo: event.target.value }) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0417\u0430\u044F\u0432\u043A\u0438" }), _jsxs("select", { value: value.requestStatus, onChange: (event) => update({ requestStatus: event.target.value }), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u0441\u0442\u0430\u0442\u0443\u0441\u044B" }), requestStatusOptions.map((status) => (_jsx("option", { value: status, children: requestStatusLabel(status) }, status)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0424\u0430\u0439\u043B\u044B" }), _jsxs("select", { value: value.fileState, onChange: (event) => update({ fileState: event.target.value }), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u0437\u0430\u044F\u0432\u043A\u0438" }), _jsx("option", { value: "WITH_FILES", children: "\u0421 \u0444\u0430\u0439\u043B\u0430\u043C\u0438" }), _jsx("option", { value: "WITHOUT_FILES", children: "\u0411\u0435\u0437 \u0444\u0430\u0439\u043B\u043E\u0432" })] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u0447\u0435\u0442\u0430" }), _jsxs("select", { value: value.invoiceStatus, onChange: (event) => update({ invoiceStatus: event.target.value }), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u0441\u0442\u0430\u0442\u0443\u0441\u044B" }), billingInvoiceStatusOptions.map((status) => (_jsx("option", { value: status, children: billingInvoiceStatusLabel(status) }, status)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F" }), _jsxs("select", { value: value.chargeStatus, onChange: (event) => update({ chargeStatus: event.target.value }), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u0441\u0442\u0430\u0442\u0443\u0441\u044B" }), billingStatusOptions.map((status) => (_jsx("option", { value: status, children: billingStatusLabel(status) }, status)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F" }), _jsxs("select", { value: value.notificationState, onChange: (event) => update({ notificationState: event.target.value }), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F" }), _jsx("option", { value: "UNREAD", children: "\u041D\u0435\u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043D\u044B\u0435" }), _jsx("option", { value: "READ", children: "\u041F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043D\u044B\u0435" })] })] })] })) : null] }));
}
