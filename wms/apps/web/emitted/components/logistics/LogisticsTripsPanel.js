import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CalendarDays, Plus, Route, Truck, UserRound } from 'lucide-react';
import { useState } from 'react';
import { createLogisticsCarrier, createLogisticsTrip, updateLogisticsTripStatus, } from '../../lib/api';
import { logisticsDeliveryStatusLabel, logisticsTripStatusLabel, logisticsTripStatusOptions, logisticsTripStatusTone, } from './logisticsMeta';
const dateFormatter = new Intl.DateTimeFormat('ru-RU');
export function LogisticsTripsPanel({ session, carriers, trips, canWrite, onCarrierCreated, onTripCreated, onTripUpdated, }) {
    const [carrierName, setCarrierName] = useState('');
    const [carrierPhone, setCarrierPhone] = useState('');
    const [carrierContact, setCarrierContact] = useState('');
    const [carrierComment, setCarrierComment] = useState('');
    const [tripCarrierId, setTripCarrierId] = useState('');
    const [plannedDate, setPlannedDate] = useState('');
    const [vehicleNumber, setVehicleNumber] = useState('');
    const [driverName, setDriverName] = useState('');
    const [driverPhone, setDriverPhone] = useState('');
    const [tripComment, setTripComment] = useState('');
    const [error, setError] = useState('');
    const [isSavingCarrier, setSavingCarrier] = useState(false);
    const [isSavingTrip, setSavingTrip] = useState(false);
    const [savingTripId, setSavingTripId] = useState('');
    async function submitCarrier(event) {
        event.preventDefault();
        setError('');
        setSavingCarrier(true);
        try {
            const created = await createLogisticsCarrier(session.accessToken, {
                name: carrierName.trim(),
                phone: carrierPhone.trim() || undefined,
                contactName: carrierContact.trim() || undefined,
                comment: carrierComment.trim() || undefined,
            });
            onCarrierCreated(created);
            setCarrierName('');
            setCarrierPhone('');
            setCarrierContact('');
            setCarrierComment('');
            setTripCarrierId(created.id);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось создать перевозчика.');
        }
        finally {
            setSavingCarrier(false);
        }
    }
    async function submitTrip(event) {
        event.preventDefault();
        setError('');
        setSavingTrip(true);
        try {
            const created = await createLogisticsTrip(session.accessToken, {
                carrierId: tripCarrierId || undefined,
                plannedDate: plannedDate || undefined,
                vehicleNumber: vehicleNumber.trim() || undefined,
                driverName: driverName.trim() || undefined,
                driverPhone: driverPhone.trim() || undefined,
                comment: tripComment.trim() || undefined,
            });
            onTripCreated(created);
            setVehicleNumber('');
            setDriverName('');
            setDriverPhone('');
            setTripComment('');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось создать рейс.');
        }
        finally {
            setSavingTrip(false);
        }
    }
    async function changeTripStatus(tripId, status) {
        setError('');
        setSavingTripId(tripId);
        try {
            const updated = await updateLogisticsTripStatus(session.accessToken, tripId, { status });
            onTripUpdated(updated);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось обновить статус рейса.');
        }
        finally {
            setSavingTripId('');
        }
    }
    return (_jsxs("div", { className: "logistics-trips", children: [canWrite ? (_jsxs("div", { className: "logistics-ops-grid", children: [_jsxs("form", { className: "carrier-form", onSubmit: submitCarrier, children: [_jsxs("div", { className: "logistics-form-title", children: [_jsx(Truck, { size: 17, "aria-hidden": "true" }), _jsx("strong", { children: "\u041F\u0435\u0440\u0435\u0432\u043E\u0437\u0447\u0438\u043A" })] }), _jsxs("div", { className: "trip-fields trip-fields--carrier", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("input", { value: carrierName, onChange: (event) => setCarrierName(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0435\u043B\u0435\u0444\u043E\u043D" }), _jsx("input", { value: carrierPhone, onChange: (event) => setCarrierPhone(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043D\u0442\u0430\u043A\u0442" }), _jsx("input", { value: carrierContact, onChange: (event) => setCarrierContact(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: carrierComment, onChange: (event) => setCarrierComment(event.target.value) })] })] }), _jsxs("button", { className: "primary-button trip-submit", type: "submit", disabled: !carrierName.trim() || isSavingCarrier, children: [_jsx(Plus, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSavingCarrier ? 'Сохраняю' : 'Добавить' })] })] }), _jsxs("form", { className: "trip-form", onSubmit: submitTrip, children: [_jsxs("div", { className: "logistics-form-title", children: [_jsx(Route, { size: 17, "aria-hidden": "true" }), _jsx("strong", { children: "\u0420\u0435\u0439\u0441" })] }), _jsxs("div", { className: "trip-fields", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041F\u0435\u0440\u0435\u0432\u043E\u0437\u0447\u0438\u043A" }), _jsxs("select", { value: tripCarrierId, onChange: (event) => setTripCarrierId(event.target.value), children: [_jsx("option", { value: "", children: "\u0411\u0435\u0437 \u043F\u0435\u0440\u0435\u0432\u043E\u0437\u0447\u0438\u043A\u0430" }), carriers.map((carrier) => (_jsx("option", { value: carrier.id, children: carrier.name }, carrier.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0414\u0430\u0442\u0430" }), _jsx("input", { type: "date", value: plannedDate, onChange: (event) => setPlannedDate(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041C\u0430\u0448\u0438\u043D\u0430" }), _jsx("input", { value: vehicleNumber, onChange: (event) => setVehicleNumber(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0412\u043E\u0434\u0438\u0442\u0435\u043B\u044C" }), _jsx("input", { value: driverName, onChange: (event) => setDriverName(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0435\u043B\u0435\u0444\u043E\u043D \u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044F" }), _jsx("input", { value: driverPhone, onChange: (event) => setDriverPhone(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439" }), _jsx("input", { value: tripComment, onChange: (event) => setTripComment(event.target.value) })] })] }), _jsxs("button", { className: "primary-button trip-submit", type: "submit", disabled: isSavingTrip, children: [_jsx(Plus, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isSavingTrip ? 'Создаю' : 'Создать рейс' })] })] })] })) : null, error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("div", { className: "trip-list", children: [trips.length === 0 ? _jsx("p", { className: "panel-message", children: "\u0420\u0435\u0439\u0441\u043E\u0432 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442." }) : null, trips.map((trip) => (_jsxs("article", { className: "trip-card", children: [_jsxs("div", { className: "trip-card__main", children: [_jsxs("div", { children: [_jsx("strong", { children: trip.code }), _jsx("span", { children: trip.carrier?.name ?? 'Без перевозчика' })] }), _jsx("span", { className: `status status--${logisticsTripStatusTone(trip.status)}`, children: logisticsTripStatusLabel(trip.status) })] }), _jsxs("div", { className: "trip-card__details", children: [_jsxs("span", { children: [_jsx(CalendarDays, { size: 14, "aria-hidden": "true" }), formatDate(trip.plannedDate)] }), _jsxs("span", { children: [_jsx(Truck, { size: 14, "aria-hidden": "true" }), trip.vehicleNumber || '-'] }), _jsxs("span", { children: [_jsx(UserRound, { size: 14, "aria-hidden": "true" }), trip.driverName || '-'] })] }), canWrite ? (_jsxs("label", { className: "trip-status-select", children: [_jsx("span", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("select", { value: trip.status, disabled: savingTripId === trip.id, onChange: (event) => void changeTripStatus(trip.id, event.target.value), children: logisticsTripStatusOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] })) : null, _jsxs("div", { className: "trip-deliveries", children: [trip.deliveries.length === 0 ? _jsx("span", { children: "\u0414\u043E\u0441\u0442\u0430\u0432\u043E\u043A \u043D\u0435\u0442" }) : null, trip.deliveries.slice(0, 4).map((delivery) => (_jsxs("span", { children: [delivery.client.code, ": ", delivery.origin, " -> ", delivery.destination, ", ", formatQuantity(delivery), " \u00B7", ' ', logisticsDeliveryStatusLabel(delivery.status)] }, delivery.id))), trip.deliveries.length > 4 ? _jsxs("span", { children: ["\u0415\u0449\u0435 ", trip.deliveries.length - 4] }) : null] })] }, trip.id)))] })] }));
}
function formatDate(value) {
    return value ? dateFormatter.format(new Date(value)) : '-';
}
function formatQuantity(value) {
    if (value.boxes != null) {
        return `${value.boxes} кор.`;
    }
    if (value.pallets != null) {
        return `${value.pallets} пал.`;
    }
    return '-';
}
