import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Warehouse } from 'lucide-react';
import { useState } from 'react';
import { generateStorageCharge } from '../../lib/api';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function BillingStorageChargeForm({ clients, session, onCreated }) {
    const [clientId, setClientId] = useRememberedClientId(session.user.id, {
        initialClientId: clients[0]?.id ?? '',
    });
    const [periodFrom, setPeriodFrom] = useState(monthStart());
    const [periodTo, setPeriodTo] = useState(today());
    const [unitPriceRub, setUnitPriceRub] = useState('');
    const [approve, setApprove] = useState(false);
    const [comment, setComment] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);
    async function submit(event) {
        event.preventDefault();
        if (!clientId) {
            setError('Выберите клиента.');
            return;
        }
        setIsSubmitting(true);
        setError(null);
        try {
            const charge = await generateStorageCharge(session.accessToken, {
                clientId,
                periodFrom,
                periodTo,
                unitPriceRub: unitPriceRub ? Number(unitPriceRub) : undefined,
                approve,
                comment: comment || undefined,
            });
            onCreated(charge);
            setComment('');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось начислить хранение.');
        }
        finally {
            setIsSubmitting(false);
        }
    }
    return (_jsxs("form", { className: "billing-form", onSubmit: (event) => void submit(event), children: [_jsxs("div", { className: "billing-fields billing-fields--storage", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " - ", client.name] }, client.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u0441" }), _jsx("input", { type: "date", value: periodFrom, onChange: (event) => setPeriodFrom(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0438\u043E\u0434 \u043F\u043E" }), _jsx("input", { type: "date", value: periodTo, onChange: (event) => setPeriodTo(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u20BD / \u043B\u0438\u0442\u0440\u043E-\u0434\u0435\u043D\u044C" }), _jsx("input", { min: "0", step: "0.01", type: "number", value: unitPriceRub, onChange: (event) => setUnitPriceRub(event.target.value), placeholder: "\u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 0.05" })] }), _jsxs("label", { className: "billing-checkbox", children: [_jsx("input", { checked: approve, type: "checkbox", onChange: (event) => setApprove(event.target.checked) }), _jsx("span", { children: "\u0421\u0440\u0430\u0437\u0443 \u0443\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C" })] }), _jsxs("label", { className: "billing-fields__wide", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: comment, onChange: (event) => setComment(event.target.value), placeholder: "\u043A \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044E \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F" })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("button", { className: "primary-button billing-submit", disabled: isSubmitting || clients.length === 0, type: "submit", children: [_jsx(Warehouse, { size: 17, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Считаю' : 'Начислить хранение' })] })] }));
}
function today() {
    return formatDateInput(new Date());
}
function monthStart() {
    const date = new Date();
    date.setDate(1);
    return formatDateInput(date);
}
function formatDateInput(date) {
    return date.toISOString().slice(0, 10);
}
