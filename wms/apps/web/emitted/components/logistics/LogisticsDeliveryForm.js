import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Truck } from 'lucide-react';
import { useRememberedClientId } from '../../lib/rememberedClient';
import { createLogisticsDeliveryRequest, fetchLogisticsTariffSet, } from '../../lib/api';
const DEFAULT_LOGISTICS_ORIGIN = 'Москва';
export function LogisticsDeliveryForm({ clients, requests, tariffs, session, onCreated }) {
    const [clientId, setClientId] = useRememberedClientId(session.user.id, {
        initialClientId: clients[0]?.id ?? '',
    });
    const [requestId, setRequestId] = useState('');
    const [tariffSetId, setTariffSetId] = useState(tariffs[0]?.id ?? '');
    const [tariffDetail, setTariffDetail] = useState(null);
    const [destination, setDestination] = useState('');
    const [quantityMode, setQuantityMode] = useState('boxes');
    const [quantity, setQuantity] = useState('1');
    const [desiredShipDate, setDesiredShipDate] = useState('');
    const [comment, setComment] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setSubmitting] = useState(false);
    const availableRequests = useMemo(() => requests.filter((request) => request.clientId === clientId && request.type === 'OUTBOUND'), [clientId, requests]);
    const selectedRequest = useMemo(() => availableRequests.find((request) => request.id === requestId) ?? null, [availableRequests, requestId]);
    const destinationOptions = useMemo(() => buildDestinationOptions(tariffDetail), [tariffDetail]);
    const packageCounts = useMemo(() => countRequestPackages(selectedRequest), [selectedRequest]);
    const isPackageDriven = Boolean(selectedRequest);
    const parsedQuantity = Number(quantity);
    const hasActualPackages = packageCounts.boxes + packageCounts.pallets > 0;
    const destinationExists = !destination.trim() || hasDestinationOption(destinationOptions, destination);
    const isUnknownDestination = Boolean(destination.trim() && destinationOptions.length > 0 && !destinationExists);
    const destinationListId = 'logistics-delivery-destinations';
    const canSubmit = Boolean(clientId &&
        destination.trim() &&
        (isPackageDriven ? hasActualPackages : Number.isInteger(parsedQuantity) && parsedQuantity > 0));
    useEffect(() => {
        if (selectedRequest?.destinationCity) {
            setDestination(selectedRequest.destinationCity);
        }
    }, [selectedRequest?.destinationCity]);
    useEffect(() => {
        if (!tariffSetId) {
            setTariffDetail(null);
            return;
        }
        let isMounted = true;
        fetchLogisticsTariffSet(session.accessToken, tariffSetId)
            .then((detail) => {
            if (isMounted) {
                setTariffDetail(detail);
            }
        })
            .catch(() => {
            if (isMounted) {
                setTariffDetail(null);
            }
        });
        return () => {
            isMounted = false;
        };
    }, [session.accessToken, tariffSetId]);
    async function submit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        try {
            // Русский комментарий: режим количества разворачиваем в одно поле, чтобы API сохранил короба или паллеты без двусмысленности.
            const created = await createLogisticsDeliveryRequest(session.accessToken, {
                clientId,
                requestId: requestId || undefined,
                tariffSetId: tariffSetId || undefined,
                destination: destination.trim(),
                desiredShipDate: desiredShipDate || undefined,
                comment: comment.trim() || undefined,
                ...(isPackageDriven ? {} : quantityMode === 'boxes' ? { boxes: parsedQuantity } : { pallets: parsedQuantity }),
            });
            onCreated(created);
            setDestination('');
            setQuantity('1');
            setComment('');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось создать заявку на доставку.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("form", { className: "delivery-form", onSubmit: submit, children: [_jsxs("div", { className: "delivery-fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("select", { value: clientId, onChange: (event) => {
                                    setClientId(event.target.value);
                                    setRequestId('');
                                }, required: true, children: clients.map((client) => (_jsxs("option", { value: client.id, children: [client.code, " \u00B7 ", client.name] }, client.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0418\u0441\u0445\u043E\u0434\u044F\u0449\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430" }), _jsxs("select", { value: requestId, onChange: (event) => setRequestId(event.target.value), children: [_jsx("option", { value: "", children: "\u0411\u0435\u0437 \u043F\u0440\u0438\u0432\u044F\u0437\u043A\u0438" }), availableRequests.map((request) => (_jsx("option", { value: request.id, children: request.title }, request.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0430\u0440\u0438\u0444" }), _jsxs("select", { value: tariffSetId, onChange: (event) => setTariffSetId(event.target.value), children: [_jsx("option", { value: "", children: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u043F\u043E \u0434\u0430\u0442\u0435" }), tariffs.map((tariff) => (_jsx("option", { value: tariff.id, children: tariff.name }, tariff.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u0430\u0442\u0430" }), _jsx("input", { type: "date", value: desiredShipDate, onChange: (event) => setDesiredShipDate(event.target.value) })] })] }), _jsxs("div", { className: "delivery-fields delivery-fields--route", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041E\u0442\u043A\u0443\u0434\u0430" }), _jsx("strong", { className: "readonly-field", children: DEFAULT_LOGISTICS_ORIGIN })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u0443\u0434\u0430" }), _jsx("input", { value: destination, onChange: (event) => setDestination(event.target.value), list: destinationListId, placeholder: "\u041D\u0430\u0447\u043D\u0438\u0442\u0435 \u0432\u0432\u043E\u0434\u0438\u0442\u044C \u0433\u043E\u0440\u043E\u0434", required: true }), _jsx("datalist", { id: destinationListId, children: destinationOptions.map((city) => (_jsx("option", { value: city }, city))) })] }), _jsxs("div", { className: "quote-mode", role: "tablist", "aria-label": "\u0415\u0434\u0438\u043D\u0438\u0446\u0430 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438", children: [_jsx("button", { className: quantityMode === 'boxes' ? 'active' : '', disabled: isPackageDriven, type: "button", onClick: () => setQuantityMode('boxes'), children: "\u041A\u043E\u0440\u043E\u0431\u0430" }), _jsx("button", { className: quantityMode === 'pallets' ? 'active' : '', disabled: isPackageDriven, type: "button", onClick: () => setQuantityMode('pallets'), children: "\u041F\u0430\u043B\u043B\u0435\u0442\u044B" })] }), _jsxs("label", { children: [_jsx("span", { children: isPackageDriven ? 'Фактические места' : 'Количество' }), isPackageDriven ? (_jsx("strong", { className: "readonly-field", children: formatPackageCounts(packageCounts) })) : (_jsx("input", { min: "1", step: "1", type: "number", value: quantity, onChange: (event) => setQuantity(event.target.value) }))] })] }), isPackageDriven && !hasActualPackages ? (_jsx("p", { className: "form-error", children: "\u041F\u043E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0439 \u0437\u0430\u044F\u0432\u043A\u0435 \u043D\u0435\u0442 \u0443\u043F\u0430\u043A\u043E\u0432\u043E\u0447\u043D\u044B\u0445 \u043C\u0435\u0441\u0442. \u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0443\u043F\u0430\u043A\u0443\u0439\u0442\u0435 \u0435\u0435 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435." })) : null, isUnknownDestination ? (_jsx("p", { className: "logistics-route-warning", children: "\u0413\u043E\u0440\u043E\u0434\u0430 \u043D\u0435\u0442 \u0432 \u0442\u0430\u0440\u0438\u0444\u0430\u0445. \u041F\u043E\u0441\u043B\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F \u0437\u0430\u044F\u0432\u043A\u0430 \u043F\u043E\u043F\u0430\u0434\u0435\u0442 \u0444\u0443\u043B\u0444\u0438\u043B\u043C\u0435\u043D\u0442\u0443 \u043D\u0430 \u0440\u0443\u0447\u043D\u043E\u0439 \u0440\u0430\u0441\u0447\u0435\u0442 \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u0438 \u043F\u0435\u0440\u0435\u0432\u043E\u0437\u043A\u0438." })) : null, _jsxs("div", { className: "delivery-footer", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: comment, onChange: (event) => setComment(event.target.value), placeholder: "\u041F\u043E\u0436\u0435\u043B\u0430\u043D\u0438\u044F \u043F\u043E \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0435" })] }), _jsxs("button", { className: "primary-button delivery-submit", type: "submit", disabled: !canSubmit || isSubmitting, children: [_jsx(Truck, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Создаю' : 'Создать заявку' })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null] }));
}
function countRequestPackages(request) {
    return (request?.packages ?? []).reduce((result, pack) => {
        if (isPalletPackage(pack.packageType)) {
            result.pallets += 1;
        }
        else {
            result.boxes += 1;
        }
        return result;
    }, { boxes: 0, pallets: 0 });
}
function isPalletPackage(packageType) {
    return ['PALLET', 'PALLETTE', 'ПАЛЛЕТ', 'ПАЛЛЕТА'].includes((packageType ?? '').trim().toUpperCase());
}
function formatPackageCounts(counts) {
    const parts = [];
    if (counts.boxes > 0) {
        parts.push(`${counts.boxes} кор.`);
    }
    if (counts.pallets > 0) {
        parts.push(`${counts.pallets} пал.`);
    }
    return parts.join(' / ') || 'нет упаковки';
}
function buildDestinationOptions(tariffSet) {
    if (!tariffSet) {
        return [];
    }
    const moscowDirections = tariffSet.directions.filter((direction) => isMoscowOrigin(direction.origin));
    const source = moscowDirections.length > 0 ? moscowDirections : tariffSet.directions;
    const options = new Map();
    source.forEach((direction) => {
        const destination = direction.destination.trim();
        if (!destination) {
            return;
        }
        options.set(normalizeLogisticsPoint(destination), destination);
    });
    return [...options.values()].sort((left, right) => left.localeCompare(right, 'ru'));
}
function hasDestinationOption(options, destination) {
    const normalized = normalizeLogisticsPoint(destination);
    return options.some((option) => normalizeLogisticsPoint(option) === normalized);
}
function isMoscowOrigin(origin) {
    const normalized = normalizeLogisticsPoint(origin);
    return normalized === normalizeLogisticsPoint(DEFAULT_LOGISTICS_ORIGIN) || normalized === 'москва' || normalized === 'moscow';
}
function normalizeLogisticsPoint(value) {
    return value.toLowerCase().replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
}
