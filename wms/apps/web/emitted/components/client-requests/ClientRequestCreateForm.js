import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClientRequest, fetchBranches, previewClientRequestAvailability, } from '../../lib/api';
import { ClientRequestItemsEditor } from './ClientRequestItemsEditor';
import { emptyClientRequestItem, normalizeClientRequestItems } from './clientRequestItems';
import { requestPriorityOptions, requestTypeOptions } from './clientRequestMeta';
import { useRememberedClientId } from '../../lib/rememberedClient';
export function ClientRequestCreateForm({ clients, session, onCreated }) {
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
    const [branches, setBranches] = useState([]);
    const [warehouseId, setWarehouseId] = useState(session.user.activeWarehouseId ?? '');
    const [type, setType] = useState('OUTBOUND');
    const [priority, setPriority] = useState('NORMAL');
    const [title, setTitle] = useState('');
    const [comment, setComment] = useState('');
    const [desiredDate, setDesiredDate] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [destinationCity, setDestinationCity] = useState('');
    const [deliveryAddress, setDeliveryAddress] = useState('');
    const [items, setItems] = useState([emptyClientRequestItem()]);
    const [availability, setAvailability] = useState(null);
    const [error, setError] = useState(null);
    const [isSubmitting, setSubmitting] = useState(false);
    const [isCheckingAvailability, setCheckingAvailability] = useState(false);
    useEffect(() => {
        void fetchBranches(session.accessToken)
            .then((rows) => {
            setBranches(rows);
            setWarehouseId((current) => rows.some((branch) => branch.id === current)
                ? current
                : rows[0]?.id ?? '');
        })
            .catch((caught) => {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить филиалы.');
        });
    }, [session.accessToken]);
    const checkAvailability = useCallback(async (nextItems = items) => {
        if (!clientId || !warehouseId) {
            setAvailability(null);
            return null;
        }
        const requestItems = normalizeClientRequestItems(nextItems);
        if (requestItems.length === 0) {
            setAvailability(null);
            return null;
        }
        setCheckingAvailability(true);
        try {
            const nextAvailability = await previewClientRequestAvailability(session.accessToken, {
                clientId,
                warehouseId,
                type,
                items: requestItems,
            });
            setAvailability(nextAvailability);
            return nextAvailability;
        }
        finally {
            setCheckingAvailability(false);
        }
    }, [clientId, items, session.accessToken, type, warehouseId]);
    if (writableClients.length === 0) {
        return null;
    }
    async function submit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const requestItems = normalizeClientRequestItems(items);
            const nextAvailability = await checkAvailability(items);
            if (nextAvailability && !nextAvailability.canCommit) {
                setError('Исправьте красные позиции: удалите строку крестиком или уменьшите количество до доступного остатка.');
                return;
            }
            const request = await createClientRequest(session.accessToken, {
                clientId,
                warehouseId,
                type,
                priority,
                title,
                comment: comment || undefined,
                contactPhone: contactPhone || undefined,
                destinationCity,
                deliveryAddress: deliveryAddress || undefined,
                desiredDate: desiredDate || undefined,
                items: requestItems.length > 0 ? requestItems : undefined,
            });
            onCreated(request);
            setTitle('');
            setComment('');
            setDesiredDate('');
            setContactPhone('');
            setDestinationCity('');
            setDeliveryAddress('');
            setItems([emptyClientRequestItem()]);
            setAvailability(null);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось создать заявку.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("form", { className: "client-request-form", onSubmit: (event) => void submit(event), children: [_jsxs("div", { className: "client-request-fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0424\u0438\u043B\u0438\u0430\u043B \u0438\u0441\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F" }), _jsxs("select", { value: warehouseId, onChange: (event) => {
                                    setWarehouseId(event.target.value);
                                    setAvailability(null);
                                }, required: true, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u0438\u043B\u0438\u0430\u043B" }), branches.map((branch) => (_jsxs("option", { value: branch.id, children: [branch.city, " \u00B7 ", branch.name] }, branch.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("select", { value: clientId, onChange: (event) => {
                                    setClientId(event.target.value);
                                    setAvailability(null);
                                }, children: writableClients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0438\u043F" }), _jsx("select", { value: type, onChange: (event) => {
                                    setType(event.target.value);
                                    setAvailability(null);
                                }, children: requestTypeOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442" }), _jsx("select", { value: priority, onChange: (event) => setPriority(event.target.value), children: requestPriorityOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0416\u0435\u043B\u0430\u0435\u043C\u0430\u044F \u0434\u0430\u0442\u0430" }), _jsx("input", { type: "date", value: desiredDate, onChange: (event) => setDesiredDate(event.target.value) })] }), _jsxs("label", { className: "client-request-fields__wide", children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { required: true, value: title, onChange: (event) => setTitle(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0435\u043B\u0435\u0444\u043E\u043D" }), _jsx("input", { value: contactPhone, onChange: (event) => setContactPhone(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0413\u043E\u0440\u043E\u0434 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438" }), _jsx("input", { required: true, value: destinationCity, onChange: (event) => setDestinationCity(event.target.value) })] }), _jsxs("label", { className: "client-request-fields__wide", children: [_jsx("span", { children: "\u0410\u0434\u0440\u0435\u0441" }), _jsx("input", { value: deliveryAddress, onChange: (event) => setDeliveryAddress(event.target.value) })] }), _jsxs("label", { className: "client-request-fields__wide", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: comment, onChange: (event) => setComment(event.target.value) })] })] }), _jsx(ClientRequestItemsEditor, { items: items, accessToken: session.accessToken, clientId: clientId, availability: availability, onChange: (nextItems) => {
                    setItems(nextItems);
                }, onAvailabilityCheck: checkAvailability, onError: setError }), isCheckingAvailability ? _jsx("p", { className: "inline-status", children: "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E \u043E\u0441\u0442\u0430\u0442\u043A\u0438." }) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("button", { className: "primary-button client-request-submit", disabled: isSubmitting || !warehouseId, type: "submit", children: [_jsx(Send, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Создаю' : 'Создать заявку' })] })] }));
}
