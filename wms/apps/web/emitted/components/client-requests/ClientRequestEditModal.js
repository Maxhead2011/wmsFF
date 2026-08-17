import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Save, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { previewClientRequestAvailability, updateClientRequest, } from '../../lib/api';
import { ClientRequestItemsEditor } from './ClientRequestItemsEditor';
import { emptyClientRequestItem, normalizeClientRequestItems } from './clientRequestItems';
import { requestPriorityOptions, requestTypeOptions } from './clientRequestMeta';
export function ClientRequestEditModal({ request, session, canBypassAvailability, onClose, onSaved, }) {
    const [type, setType] = useState(request.type);
    const [priority, setPriority] = useState(request.priority);
    const [title, setTitle] = useState(request.title);
    const [comment, setComment] = useState(request.comment ?? '');
    const [desiredDate, setDesiredDate] = useState(toDateInput(request.desiredDate));
    const [contactName, setContactName] = useState(request.contactName ?? '');
    const [contactPhone, setContactPhone] = useState(request.contactPhone ?? '');
    const [destinationCity, setDestinationCity] = useState(request.destinationCity ?? '');
    const [deliveryAddress, setDeliveryAddress] = useState(request.deliveryAddress ?? '');
    const [items, setItems] = useState(() => requestItemsToDraft(request));
    const [availability, setAvailability] = useState(null);
    const [error, setError] = useState(null);
    const [isSubmitting, setSubmitting] = useState(false);
    const [isCheckingAvailability, setCheckingAvailability] = useState(false);
    const checkAvailability = useCallback(async (nextItems = items) => {
        const requestItems = normalizeClientRequestItems(nextItems);
        if (requestItems.length === 0) {
            setAvailability(null);
            return null;
        }
        setCheckingAvailability(true);
        try {
            const nextAvailability = await previewClientRequestAvailability(session.accessToken, {
                clientId: request.clientId,
                type,
                items: requestItems,
                excludeRequestId: request.id,
            });
            setAvailability(nextAvailability);
            return nextAvailability;
        }
        finally {
            setCheckingAvailability(false);
        }
    }, [items, request.clientId, request.id, session.accessToken, type]);
    async function submit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const requestItems = normalizeClientRequestItems(items);
            const nextAvailability = await checkAvailability(items);
            if (nextAvailability && !nextAvailability.canCommit && !canBypassAvailability) {
                setError('Исправьте красные позиции: удалите строку или уменьшите количество до доступного остатка.');
                return;
            }
            const updated = await updateClientRequest(session.accessToken, request.id, {
                type,
                priority,
                title,
                comment,
                contactName,
                contactPhone,
                destinationCity,
                deliveryAddress,
                desiredDate,
                items: requestItems,
            });
            onSaved(updated);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить заявку.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsx("div", { className: "client-request-edit-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0437\u0430\u044F\u0432\u043A\u0438", children: _jsxs("form", { className: "client-request-edit-modal__panel", onSubmit: (event) => void submit(event), children: [_jsxs("header", { className: "client-request-edit-modal__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0437\u0430\u044F\u0432\u043A\u0438" }), _jsxs("h3", { children: ["\u2116", String(request.number).padStart(6, '0'), " \u00B7 ", request.title] }), _jsxs("small", { children: [request.client.name, " \u00B7 ", request.status] })] }), _jsx("button", { className: "icon-button", type: "button", onClick: onClose, title: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("div", { className: "client-request-fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("input", { value: request.client.name, disabled: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0438\u043F" }), _jsx("select", { value: type, onChange: (event) => setType(event.target.value), children: requestTypeOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442" }), _jsx("select", { value: priority, onChange: (event) => setPriority(event.target.value), children: requestPriorityOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0416\u0435\u043B\u0430\u0435\u043C\u0430\u044F \u0434\u0430\u0442\u0430" }), _jsx("input", { type: "date", value: desiredDate, onChange: (event) => setDesiredDate(event.target.value) })] }), _jsxs("label", { className: "client-request-fields__wide", children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { required: true, value: title, onChange: (event) => setTitle(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043D\u0442\u0430\u043A\u0442" }), _jsx("input", { value: contactName, onChange: (event) => setContactName(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0435\u043B\u0435\u0444\u043E\u043D" }), _jsx("input", { value: contactPhone, onChange: (event) => setContactPhone(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0413\u043E\u0440\u043E\u0434 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438" }), _jsx("input", { required: true, value: destinationCity, onChange: (event) => setDestinationCity(event.target.value) })] }), _jsxs("label", { className: "client-request-fields__wide", children: [_jsx("span", { children: "\u0410\u0434\u0440\u0435\u0441" }), _jsx("input", { value: deliveryAddress, onChange: (event) => setDeliveryAddress(event.target.value) })] }), _jsxs("label", { className: "client-request-fields__wide", children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: comment, onChange: (event) => setComment(event.target.value) })] })] }), _jsx(ClientRequestItemsEditor, { items: items, accessToken: session.accessToken, clientId: request.clientId, availability: availability, showQuickSearch: true, showDatabasePicker: true, onChange: setItems, onAvailabilityCheck: checkAvailability, onError: setError }), isCheckingAvailability ? _jsx("p", { className: "inline-status", children: "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E \u043E\u0441\u0442\u0430\u0442\u043A\u0438." }) : null, availability && !availability.canCommit && canBypassAvailability ? (_jsx("p", { className: "form-error", children: "\u041F\u043E \u0447\u0430\u0441\u0442\u0438 \u0441\u0442\u0440\u043E\u043A \u043D\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043E\u0441\u0442\u0430\u0442\u043A\u0430. \u0423 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u043E." })) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("footer", { className: "client-request-edit-modal__actions", children: [_jsx("button", { className: "secondary-action", type: "button", onClick: onClose, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsxs("button", { className: "primary-button", disabled: isSubmitting, type: "submit", children: [_jsx(Save, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Сохраняю' : 'Сохранить заявку' })] })] })] }) }));
}
function requestItemsToDraft(request) {
    const items = request.items.map((item) => ({
        ...emptyClientRequestItem(),
        skuId: item.skuId ?? item.sku?.id ?? '',
        barcode: item.barcode ?? '',
        name: item.name ?? item.sku?.name ?? '',
        quantity: String(item.quantity || 1),
        comment: item.comment ?? '',
        internalSku: item.sku?.internalSku ?? '',
        clientSku: item.sku?.clientSku ?? '',
        article: item.sku?.article ?? '',
        color: item.sku?.color ?? '',
        size: item.sku?.size ?? '',
    }));
    return items.length > 0 ? items : [emptyClientRequestItem()];
}
function toDateInput(value) {
    return value ? value.slice(0, 10) : '';
}
