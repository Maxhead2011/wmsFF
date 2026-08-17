import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Calculator, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { assignLogisticsDeliveryTrip, createBillingInvoice, fetchClientRequests, fetchClients, fetchLogisticsCarriers, fetchLogisticsDeliveryRequests, fetchLogisticsTariffSet, fetchLogisticsTariffSets, fetchLogisticsTrips, finalizeLogisticsDeliveryQuote, generateLogisticsDeliveryBillingCharge, quoteLogistics, updateLogisticsDeliveryStatus, } from '../../lib/api';
import './logistics.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';
import { LogisticsDeliveryForm } from './LogisticsDeliveryForm';
import { LogisticsDeliveryRequestsTable } from './LogisticsDeliveryRequestsTable';
import { LogisticsOperationsSummary } from './LogisticsOperationsSummary';
import { LogisticsQuoteResultCard } from './LogisticsQuoteResultCard';
import { LogisticsTripsPanel } from './LogisticsTripsPanel';
const DEFAULT_LOGISTICS_ORIGIN = 'Москва';
const defaultQuoteDate = new Date().toISOString().slice(0, 10);
export function LogisticsQuotePanel({ session }) {
    const [tariffs, setTariffs] = useState([]);
    const [clients, setClients] = useState([]);
    const [clientRequests, setClientRequests] = useState([]);
    const [deliveryRequests, setDeliveryRequests] = useState([]);
    const [carriers, setCarriers] = useState([]);
    const [trips, setTrips] = useState([]);
    const [tariffSetId, setTariffSetId] = useState('');
    const [tariffDetail, setTariffDetail] = useState(null);
    const [destination, setDestination] = useState('');
    const [quantityMode, setQuantityMode] = useState('boxes');
    const [quantity, setQuantity] = useState('1');
    const [quoteDate, setQuoteDate] = useState(defaultQuoteDate);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    useEffect(() => {
        void loadData();
    }, [session.accessToken]);
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
    const destinationOptions = useMemo(() => buildDestinationOptions(tariffDetail), [tariffDetail]);
    const parsedQuantity = Number(quantity);
    const canSubmit = Boolean(destination.trim() && Number.isInteger(parsedQuantity) && parsedQuantity > 0);
    const destinationExists = !destination.trim() || hasDestinationOption(destinationOptions, destination);
    const isUnknownDestination = Boolean(destination.trim() && destinationOptions.length > 0 && !destinationExists);
    const destinationListId = 'logistics-quote-destinations';
    if (!canUse(session.user, 'logistics:read')) {
        return null;
    }
    async function loadData() {
        setLoading(true);
        setError('');
        try {
            const [nextTariffs, nextClients, nextClientRequests, nextDeliveryRequests, nextCarriers, nextTrips] = await Promise.all([
                fetchLogisticsTariffSets(session.accessToken),
                fetchClients(session.accessToken),
                fetchClientRequests(session.accessToken),
                fetchLogisticsDeliveryRequests(session.accessToken),
                fetchLogisticsCarriers(session.accessToken),
                fetchLogisticsTrips(session.accessToken),
            ]);
            setTariffs(nextTariffs);
            setClients(nextClients);
            setClientRequests(nextClientRequests);
            setDeliveryRequests(nextDeliveryRequests);
            setCarriers(nextCarriers);
            setTrips(nextTrips);
            setTariffSetId((current) => current || nextTariffs[0]?.id || '');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить логистику.');
        }
        finally {
            setLoading(false);
        }
    }
    function acceptDeliveryRequest(request) {
        setDeliveryRequests((current) => [request, ...current.filter((item) => item.id !== request.id)]);
    }
    async function changeDeliveryStatus(deliveryId, status) {
        setError('');
        setMessage('');
        try {
            const updated = await updateLogisticsDeliveryStatus(session.accessToken, deliveryId, { status });
            setDeliveryRequests((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось обновить статус доставки.');
        }
    }
    async function generateBillingCharge(deliveryId) {
        setError('');
        setMessage('');
        try {
            const updated = await generateLogisticsDeliveryBillingCharge(session.accessToken, deliveryId);
            const chargeId = updated.billingCharge?.id;
            if (chargeId) {
                const invoiceDate = dateOnly(updated.plannedShipDate ?? updated.desiredShipDate ?? updated.updatedAt);
                const invoice = await createBillingInvoice(session.accessToken, {
                    clientId: updated.clientId,
                    periodFrom: invoiceDate,
                    periodTo: invoiceDate,
                    chargeIds: [chargeId],
                    comment: `Логистика ${updated.origin} -> ${updated.destination}`,
                });
                setMessage(`Счет на логистику ${invoice.number} создан.`);
            }
            setDeliveryRequests((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось создать счет на логистику.');
        }
    }
    async function finalizeQuote(deliveryId, payload) {
        setError('');
        setMessage('');
        try {
            const updated = await finalizeLogisticsDeliveryQuote(session.accessToken, deliveryId, payload);
            setDeliveryRequests((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось зафиксировать расчет доставки.');
        }
    }
    async function assignDeliveryTrip(deliveryId, tripId) {
        setError('');
        setMessage('');
        try {
            const updated = await assignLogisticsDeliveryTrip(session.accessToken, deliveryId, { tripId });
            setDeliveryRequests((current) => current.map((item) => (item.id === updated.id ? updated : item)));
            setTrips(await fetchLogisticsTrips(session.accessToken));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось назначить рейс доставки.');
        }
    }
    async function submit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        setMessage('');
        setResult(null);
        try {
            if (destination.trim() && destinationOptions.length > 0 && !destinationExists) {
                setMessage('Города нет в загруженных тарифах. Создайте заявку на доставку ниже: она уйдет фулфилменту на ручной расчет стоимости.');
                return;
            }
            const parsedQuantity = Number(quantity);
            // Русский комментарий: backend принимает ровно один параметр количества, поэтому режим формы разворачиваем в boxes или pallets.
            const quote = await quoteLogistics(session.accessToken, {
                destination: destination.trim(),
                quoteDate: quoteDate || undefined,
                tariffSetId: tariffSetId || undefined,
                ...(quantityMode === 'boxes' ? { boxes: parsedQuantity } : { pallets: parsedQuantity }),
            });
            setResult(quote);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось рассчитать логистику.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsx(WorkspaceTileGate, { eyebrow: "\u041B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430", title: "\u0414\u043E\u0441\u0442\u0430\u0432\u043A\u0430 \u0438 \u0440\u0435\u0439\u0441\u044B", description: "\u0420\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u0439\u0442\u0435 \u043C\u0430\u0440\u0448\u0440\u0443\u0442, \u043E\u0444\u043E\u0440\u043C\u0438\u0442\u0435 \u0437\u0430\u044F\u0432\u043A\u0443 \u043D\u0430 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0443 \u0438\u043B\u0438 \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u0439\u0442\u0435 \u0440\u0435\u0439\u0441\u0430\u043C\u0438 \u0438 \u0438\u0445 \u043E\u043F\u043B\u0430\u0442\u043E\u0439.", tiles: [
            { title: 'Рассчитать доставку', description: 'Стоимость по направлению, тарифу, коробам или паллетам.', icon: Calculator, tone: 'blue' },
            { title: 'Заявки на доставку', description: 'Создать и обработать доставку клиента.', icon: RefreshCw, tone: 'orange' },
            { title: 'Рейсы и контроль', description: 'Назначить рейс, сменить статус и передать стоимость в биллинг.', icon: Calculator, tone: 'green' },
        ], children: _jsxs("section", { className: "logistics-panel", "aria-label": "\u0420\u0430\u0441\u0447\u0435\u0442 \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0438", children: [_jsxs("div", { className: "section-heading logistics-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430" }), _jsx("h2", { children: "\u0420\u0430\u0441\u0447\u0435\u0442 \u0438 \u0437\u0430\u044F\u0432\u043A\u0438 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438" })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => void loadData(), title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0442\u0430\u0440\u0438\u0444\u044B", "aria-label": "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0442\u0430\u0440\u0438\u0444\u044B", disabled: isLoading, children: _jsx(RefreshCw, { size: 18, "aria-hidden": "true" }) })] }), _jsxs("form", { className: "quote-form", onSubmit: submit, children: [_jsxs("div", { className: "quote-fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0431\u043E\u0440 \u0442\u0430\u0440\u0438\u0444\u043E\u0432" }), _jsxs("select", { value: tariffSetId, onChange: (event) => setTariffSetId(event.target.value), disabled: isLoading, children: [_jsx("option", { value: "", children: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u043F\u043E \u0434\u0430\u0442\u0435" }), tariffs.map((tariff) => (_jsx("option", { value: tariff.id, children: tariff.name }, tariff.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041E\u0442\u043A\u0443\u0434\u0430" }), _jsx("strong", { className: "readonly-field", children: DEFAULT_LOGISTICS_ORIGIN })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u0443\u0434\u0430" }), _jsx("input", { value: destination, onChange: (event) => setDestination(event.target.value), list: destinationListId, placeholder: "\u041D\u0430\u0447\u043D\u0438\u0442\u0435 \u0432\u0432\u043E\u0434\u0438\u0442\u044C \u0433\u043E\u0440\u043E\u0434", required: true }), _jsx("datalist", { id: destinationListId, children: destinationOptions.map((city) => (_jsx("option", { value: city }, city))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u0430\u0442\u0430" }), _jsx("input", { type: "date", value: quoteDate, onChange: (event) => setQuoteDate(event.target.value) })] })] }), _jsxs("div", { className: "quote-quantity-row", children: [_jsxs("div", { className: "quote-mode", role: "tablist", "aria-label": "\u0415\u0434\u0438\u043D\u0438\u0446\u0430 \u0440\u0430\u0441\u0447\u0435\u0442\u0430", children: [_jsx("button", { className: quantityMode === 'boxes' ? 'active' : '', type: "button", onClick: () => setQuantityMode('boxes'), children: "\u041A\u043E\u0440\u043E\u0431\u0430" }), _jsx("button", { className: quantityMode === 'pallets' ? 'active' : '', type: "button", onClick: () => setQuantityMode('pallets'), children: "\u041F\u0430\u043B\u043B\u0435\u0442\u044B" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" }), _jsx("input", { min: "1", step: "1", type: "number", value: quantity, onChange: (event) => setQuantity(event.target.value) })] }), _jsxs("button", { className: "primary-button quote-submit", type: "submit", disabled: !canSubmit || isSubmitting, children: [_jsx(Calculator, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSubmitting ? 'Расчет' : 'Рассчитать' })] })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, isUnknownDestination ? (_jsx("p", { className: "logistics-route-warning", children: "\u0413\u043E\u0440\u043E\u0434\u0430 \u043D\u0435\u0442 \u0432 \u0442\u0430\u0440\u0438\u0444\u0430\u0445. \u0414\u043B\u044F \u0442\u043E\u0447\u043D\u043E\u0439 \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u0438 \u0441\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u0437\u0430\u044F\u0432\u043A\u0443 \u043D\u0430 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0443: \u043E\u043D\u0430 \u043F\u043E\u043F\u0430\u0434\u0435\u0442 \u0444\u0443\u043B\u0444\u0438\u043B\u043C\u0435\u043D\u0442\u0443 \u043D\u0430 \u0440\u0430\u0441\u0447\u0435\u0442." })) : null, message ? _jsx("p", { className: "form-success", children: message }) : null] }), result ? _jsx(LogisticsQuoteResultCard, { result: result }) : null, canUse(session.user, 'logistics:request') && clients.length > 0 ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "logistics-panel__subheading", children: _jsx("h3", { children: "\u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0430 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0443" }) }), _jsx(LogisticsDeliveryForm, { clients: clients, requests: clientRequests, tariffs: tariffs, session: session, onCreated: acceptDeliveryRequest })] })) : null, _jsx("div", { className: "logistics-panel__subheading", children: _jsx("h3", { children: "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u0430\u044F \u0441\u0432\u043E\u0434\u043A\u0430" }) }), _jsx(LogisticsOperationsSummary, { carriers: carriers, trips: trips, deliveries: deliveryRequests }), canUse(session.user, 'logistics:write') || trips.length > 0 ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "logistics-panel__subheading", children: _jsx("h3", { children: "\u0420\u0435\u0439\u0441\u044B" }) }), _jsx(LogisticsTripsPanel, { session: session, carriers: carriers, trips: trips, canWrite: canUse(session.user, 'logistics:write'), onCarrierCreated: (carrier) => setCarriers((current) => [carrier, ...current]), onTripCreated: (trip) => setTrips((current) => [trip, ...current]), onTripUpdated: (trip) => setTrips((current) => current.map((item) => (item.id === trip.id ? trip : item))) })] })) : null, _jsx("div", { className: "logistics-panel__subheading", children: _jsx("h3", { children: "\u0417\u0430\u044F\u0432\u043A\u0438 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438" }) }), _jsxs("div", { className: "delivery-list", children: [isLoading && deliveryRequests.length === 0 ? _jsx("p", { className: "panel-message", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0437\u0430\u044F\u0432\u043A\u0438 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438." }) : null, !isLoading && deliveryRequests.length === 0 ? _jsx("p", { className: "panel-message", children: "\u0417\u0430\u044F\u0432\u043E\u043A \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." }) : null, deliveryRequests.length > 0 ? (_jsx(LogisticsDeliveryRequestsTable, { items: deliveryRequests, trips: trips, canWrite: canUse(session.user, 'logistics:write'), canCreateBillingCharge: canUse(session.user, 'logistics:write') && canUse(session.user, 'billing:write'), onBillingChargeCreate: (deliveryId) => void generateBillingCharge(deliveryId), onQuoteFinalize: finalizeQuote, onStatusChange: (deliveryId, status) => void changeDeliveryStatus(deliveryId, status), onTripAssign: (deliveryId, tripId) => void assignDeliveryTrip(deliveryId, tripId) })) : null] })] }) }));
}
function canUse(user, permission) {
    return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
function dateOnly(value) {
    return new Date(value).toISOString().slice(0, 10);
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
