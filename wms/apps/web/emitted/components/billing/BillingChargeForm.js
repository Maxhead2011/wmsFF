import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ReceiptText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createBillingCharge, } from '../../lib/api';
import { billingUnitOptions } from './billingMeta';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function BillingChargeForm({ clients, requests, services, session, onCreated }) {
    const writableClientIds = useMemo(() => {
        if (session.user.permissionCodes.includes('system:admin') || session.user.clientScopeMode === 'ALL') {
            return new Set(clients.map((client) => client.id));
        }
        return new Set(session.user.writableClientIds);
    }, [clients, session.user]);
    const writableClients = clients.filter((client) => writableClientIds.has(client.id));
    const [clientId, setClientId] = useRememberedClientId(session.user.id, {
        initialClientId: writableClients[0]?.id ?? '',
    });
    const [serviceId, setServiceId] = useState('');
    const [requestId, setRequestId] = useState('');
    const [description, setDescription] = useState('');
    const [unit, setUnit] = useState('SERVICE');
    const [quantity, setQuantity] = useState('1');
    const [unitPriceRub, setUnitPriceRub] = useState('');
    const [serviceDate, setServiceDate] = useState('');
    const [comment, setComment] = useState('');
    const [error, setError] = useState(null);
    const [isSubmitting, setSubmitting] = useState(false);
    const selectedService = services.find((service) => service.id === serviceId);
    const clientRequests = requests.filter((request) => request.clientId === clientId);
    useEffect(() => {
        if (!selectedService) {
            return;
        }
        setUnit(selectedService.unit);
        setDescription((current) => current || selectedService.name);
        setUnitPriceRub((current) => current || priceInput(selectedService.defaultPriceRub));
    }, [selectedService?.id]);
    if (writableClients.length === 0) {
        return null;
    }
    async function submit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const charge = await createBillingCharge(session.accessToken, {
                clientId,
                serviceId: serviceId || undefined,
                requestId: requestId || undefined,
                description: description || undefined,
                unit,
                quantity: Number(quantity),
                unitPriceRub: unitPriceRub ? Number(unitPriceRub) : undefined,
                serviceDate: serviceDate || undefined,
                comment: comment || undefined,
            });
            onCreated(charge);
            setDescription('');
            setRequestId('');
            setQuantity('1');
            setComment('');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось создать начисление.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("form", { className: "billing-form", onSubmit: (event) => void submit(event), children: [_jsxs("div", { className: "billing-fields billing-fields--charge", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: writableClients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0423\u0441\u043B\u0443\u0433\u0430" }), _jsxs("select", { value: serviceId, onChange: (event) => setServiceId(event.target.value), children: [_jsx("option", { value: "", children: "\u0420\u0443\u0447\u043D\u043E\u0435 \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u0435" }), services.map((service) => (_jsxs("option", { value: service.id, children: [service.code, " \u00B7 ", service.name] }, service.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0417\u0430\u044F\u0432\u043A\u0430" }), _jsxs("select", { value: requestId, onChange: (event) => setRequestId(event.target.value), children: [_jsx("option", { value: "", children: "\u0411\u0435\u0437 \u0437\u0430\u044F\u0432\u043A\u0438" }), clientRequests.map((request) => (_jsx("option", { value: request.id, children: request.title }, request.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u0430\u0442\u0430 \u0443\u0441\u043B\u0443\u0433\u0438" }), _jsx("input", { type: "date", value: serviceDate, onChange: (event) => setServiceDate(event.target.value) })] }), _jsxs("label", { className: "billing-fields__wide", children: [_jsx("span", { children: "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435" }), _jsx("input", { value: description, onChange: (event) => setDescription(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0415\u0434\u0438\u043D\u0438\u0446\u0430" }), _jsx("select", { value: unit, onChange: (event) => setUnit(event.target.value), children: billingUnitOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("input", { min: "0.001", step: "0.001", type: "number", value: quantity, onChange: (event) => setQuantity(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0426\u0435\u043D\u0430, \u20BD" }), _jsx("input", { min: "0", step: "0.01", type: "number", value: unitPriceRub, onChange: (event) => setUnitPriceRub(event.target.value) })] }), _jsxs("label", { className: "billing-fields__wide", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: comment, onChange: (event) => setComment(event.target.value) })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("button", { className: "primary-button billing-submit", disabled: isSubmitting, type: "submit", children: [_jsx(ReceiptText, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Создаю' : 'Создать начисление' })] })] }));
}
function priceInput(value) {
    return value == null ? '' : String(value);
}
