import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, CheckCircle2, Clock3, Download, Route, Truck } from 'lucide-react';
import { logisticsDeliveryStatusLabel, logisticsTripStatusLabel } from './logisticsMeta';
const moneyFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat('ru-RU');
export function LogisticsOperationsSummary({ carriers, trips, deliveries }) {
    const summary = buildLogisticsSummary(carriers, trips, deliveries);
    return (_jsxs("section", { className: "logistics-summary", "aria-label": "\u0421\u0432\u043E\u0434\u043A\u0430 \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0438", children: [_jsxs("div", { className: "logistics-summary__toolbar", children: [_jsxs("div", { children: [_jsx("strong", { children: "SLA \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0438" }), _jsxs("span", { children: [summary.slaTotal, " \u0434\u043E\u0441\u0442\u0430\u0432\u043E\u043A \u0441 \u0434\u0430\u0442\u043E\u0439 SLA \u00B7 \u0441\u0440\u0435\u0434\u043D\u044F\u044F \u0437\u0430\u0434\u0435\u0440\u0436\u043A\u0430 ", summary.averageDelayDays, " \u0434\u043D."] })] }), _jsxs("button", { type: "button", onClick: () => downloadLogisticsCsv(deliveries), children: [_jsx(Download, { size: 16, "aria-hidden": "true" }), "\u042D\u043A\u0441\u043F\u043E\u0440\u0442 CSV"] })] }), _jsxs("div", { className: "logistics-summary__metrics", children: [_jsx(SummaryMetric, { icon: _jsx(Route, { size: 18 }), label: "\u0417\u0430\u044F\u0432\u043A\u0438", value: String(deliveries.length), hint: `${summary.unassignedCount} без рейса` }), _jsx(SummaryMetric, { icon: _jsx(Truck, { size: 18 }), label: "\u0420\u0435\u0439\u0441\u044B", value: String(trips.length), hint: `${summary.activeTripsCount} активных` }), _jsx(SummaryMetric, { icon: _jsx(Clock3, { size: 18 }), label: "SLA", value: `${summary.slaPercent}%`, hint: `${summary.onTimeCount} в срок, ${summary.lateDeliveredCount} поздно` }), _jsx(SummaryMetric, { icon: _jsx(AlertTriangle, { size: 18 }), label: "\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u044C", value: String(summary.overdueOpenCount + summary.manualReviewCount), hint: `${summary.overdueOpenCount} просрочено, ${summary.manualReviewCount} проверок` }), _jsx(SummaryMetric, { icon: _jsx(CheckCircle2, { size: 18 }), label: "\u041D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u043E", value: `${formatMoney(summary.billedRub)} ₽`, hint: `${summary.billedCount} доставок` })] }), _jsxs("div", { className: "logistics-summary__grid", children: [_jsx(SummaryColumn, { title: "\u041F\u0435\u0440\u0435\u0432\u043E\u0437\u0447\u0438\u043A\u0438", emptyText: "\u041F\u0435\u0440\u0435\u0432\u043E\u0437\u0447\u0438\u043A\u043E\u0432 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442.", children: summary.carriers.slice(0, 6).map((carrier) => (_jsxs("div", { className: "logistics-summary-row", children: [_jsxs("div", { children: [_jsx("strong", { children: carrier.title }), _jsxs("span", { children: [carrier.tripsCount, " \u0440\u0435\u0439\u0441. \u00B7 ", carrier.deliveriesCount, " \u0434\u043E\u0441\u0442. \u00B7 ", carrier.manualReviewCount, " \u043F\u0440\u043E\u0432\u0435\u0440\u043E\u043A"] })] }), _jsxs("strong", { children: [formatMoney(carrier.billedRub || carrier.estimatedRub), " \u20BD"] })] }, carrier.key))) }), _jsx(SummaryColumn, { title: "\u0411\u043B\u0438\u0436\u0430\u0439\u0448\u0438\u0435 \u0440\u0435\u0439\u0441\u044B", emptyText: "\u0420\u0435\u0439\u0441\u043E\u0432 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442.", children: summary.upcomingTrips.slice(0, 6).map((trip) => (_jsxs("div", { className: "logistics-summary-row", children: [_jsxs("div", { children: [_jsx("strong", { children: trip.code }), _jsxs("span", { children: [formatDate(trip.plannedDate), " \u00B7 ", logisticsTripStatusLabel(trip.status), " \u00B7 ", trip.carrier?.name ?? 'без перевозчика'] })] }), _jsxs("strong", { children: [trip.deliveries.length, " \u0434\u043E\u0441\u0442."] })] }, trip.id))) }), _jsx(SummaryColumn, { title: "\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u044C \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438", emptyText: "\u0417\u0430\u044F\u0432\u043E\u043A \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442.", children: summary.problemDeliveries.slice(0, 6).map((delivery) => (_jsxs("div", { className: "logistics-summary-row", children: [_jsxs("div", { children: [_jsxs("strong", { children: [delivery.origin, " - ", delivery.destination] }), _jsxs("span", { children: [delivery.client.code, " \u00B7 ", logisticsDeliveryStatusLabel(delivery.status), delivery.requiresManualReview ? ' · ручной расчет' : ''] })] }), _jsx("strong", { children: delivery.estimatedTotalRub == null ? 'проверка' : `${formatMoney(delivery.estimatedTotalRub)} ₽` })] }, delivery.id))) }), _jsx(SummaryColumn, { title: "SLA \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044C", emptyText: "\u041F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043D\u044B\u0445 \u0434\u043E\u0441\u0442\u0430\u0432\u043E\u043A \u043D\u0435\u0442.", children: summary.slaProblems.slice(0, 6).map((delivery) => (_jsxs("div", { className: "logistics-summary-row", children: [_jsxs("div", { children: [_jsxs("strong", { children: [delivery.client.code, " \u00B7 ", delivery.destination] }), _jsxs("span", { children: [formatDate(delivery.desiredShipDate), " \u00B7 ", deliverySlaLabel(delivery)] })] }), _jsxs("strong", { children: [delayDays(delivery), " \u0434\u043D."] })] }, delivery.id))) })] })] }));
}
function SummaryMetric({ icon, label, value, hint }) {
    return (_jsxs("article", { className: "logistics-summary-metric", children: [icon, _jsxs("div", { children: [_jsx("span", { children: label }), _jsx("strong", { children: value }), _jsx("small", { children: hint })] })] }));
}
function SummaryColumn({ title, emptyText, children }) {
    const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
    return (_jsxs("div", { className: "logistics-summary-column", children: [_jsx("strong", { children: title }), items.length > 0 ? children : _jsx("p", { className: "logistics-summary-empty", children: emptyText })] }));
}
function buildLogisticsSummary(carriers, trips, deliveries) {
    const carrierGroups = new Map();
    const slaDeliveries = deliveries.filter((delivery) => Boolean(delivery.desiredShipDate) && delivery.status === 'DELIVERED');
    const onTimeCount = slaDeliveries.filter((delivery) => !isDeliveryLate(delivery)).length;
    const lateDeliveredCount = slaDeliveries.length - onTimeCount;
    const overdueOpenCount = deliveries.filter((delivery) => Boolean(delivery.desiredShipDate) && !isDeliveryClosed(delivery) && isDeliveryLate(delivery)).length;
    const slaProblems = deliveries
        .filter((delivery) => Boolean(delivery.desiredShipDate) && isDeliveryLate(delivery))
        .sort((left, right) => delayDays(right) - delayDays(left));
    const totalDelayDays = slaProblems.reduce((sum, delivery) => sum + delayDays(delivery), 0);
    carriers.forEach((carrier) => {
        carrierGroups.set(carrier.id, {
            key: carrier.id,
            title: carrier.name,
            tripsCount: 0,
            deliveriesCount: 0,
            deliveredCount: 0,
            manualReviewCount: 0,
            estimatedRub: 0,
            billedRub: 0,
        });
    });
    trips.forEach((trip) => {
        const carrierKey = trip.carrier?.id ?? 'none';
        const carrier = ensureCarrierGroup(carrierGroups, carrierKey, trip.carrier?.name ?? 'Без перевозчика');
        carrier.tripsCount += 1;
    });
    deliveries.forEach((delivery) => {
        const carrierKey = delivery.trip?.carrier?.id ?? 'none';
        const carrier = ensureCarrierGroup(carrierGroups, carrierKey, delivery.trip?.carrier?.name ?? 'Без перевозчика');
        const estimatedRub = Number(delivery.estimatedTotalRub ?? 0);
        const billedRub = Number(delivery.billingCharge?.totalRub ?? 0);
        carrier.deliveriesCount += 1;
        carrier.deliveredCount += delivery.status === 'DELIVERED' ? 1 : 0;
        carrier.manualReviewCount += delivery.requiresManualReview || delivery.estimatedTotalRub == null ? 1 : 0;
        carrier.estimatedRub += estimatedRub;
        carrier.billedRub += billedRub;
    });
    return {
        activeTripsCount: trips.filter((trip) => trip.status !== 'COMPLETED' && trip.status !== 'CANCELLED').length,
        unassignedCount: deliveries.filter((delivery) => !delivery.tripId).length,
        manualReviewCount: deliveries.filter((delivery) => delivery.requiresManualReview || delivery.estimatedTotalRub == null).length,
        estimatedRub: deliveries.reduce((sum, delivery) => sum + Number(delivery.estimatedTotalRub ?? 0), 0),
        billedRub: deliveries.reduce((sum, delivery) => sum + Number(delivery.billingCharge?.totalRub ?? 0), 0),
        billedCount: deliveries.filter((delivery) => Boolean(delivery.billingCharge)).length,
        slaTotal: slaDeliveries.length,
        onTimeCount,
        lateDeliveredCount,
        overdueOpenCount,
        slaPercent: slaDeliveries.length > 0 ? Math.round((onTimeCount / slaDeliveries.length) * 100) : 100,
        averageDelayDays: slaProblems.length > 0 ? Math.round((totalDelayDays / slaProblems.length) * 10) / 10 : 0,
        slaProblems,
        carriers: [...carrierGroups.values()].sort((left, right) => right.deliveriesCount - left.deliveriesCount || right.tripsCount - left.tripsCount),
        upcomingTrips: trips
            .filter((trip) => trip.status !== 'COMPLETED' && trip.status !== 'CANCELLED')
            .sort((left, right) => String(left.plannedDate ?? '').localeCompare(String(right.plannedDate ?? ''))),
        problemDeliveries: deliveries
            .filter((delivery) => delivery.requiresManualReview || delivery.estimatedTotalRub == null || !delivery.tripId)
            .sort((left, right) => Number(right.requiresManualReview) - Number(left.requiresManualReview)),
    };
}
function ensureCarrierGroup(groups, key, title) {
    const current = groups.get(key);
    if (current) {
        return current;
    }
    const created = {
        key,
        title,
        tripsCount: 0,
        deliveriesCount: 0,
        deliveredCount: 0,
        manualReviewCount: 0,
        estimatedRub: 0,
        billedRub: 0,
    };
    groups.set(key, created);
    return created;
}
function downloadLogisticsCsv(deliveries) {
    const rows = [
        [
            'Клиент',
            'Маршрут',
            'Желаемая дата',
            'Плановая дата',
            'Статус',
            'SLA',
            'Рейс',
            'Перевозчик',
            'Коробки',
            'Паллеты',
            'Расчет, ₽',
            'Начислено, ₽',
            'Ручная проверка',
        ],
        ...deliveries.map((delivery) => [
            `${delivery.client.code} ${delivery.client.name}`,
            `${delivery.origin} - ${delivery.destination}`,
            formatDate(delivery.desiredShipDate),
            formatDate(delivery.plannedShipDate ?? delivery.trip?.plannedDate ?? null),
            logisticsDeliveryStatusLabel(delivery.status),
            deliverySlaLabel(delivery),
            delivery.trip?.code ?? '',
            delivery.trip?.carrier?.name ?? '',
            String(delivery.boxes ?? ''),
            String(delivery.pallets ?? ''),
            delivery.estimatedTotalRub == null ? '' : formatMoney(delivery.estimatedTotalRub),
            delivery.billingCharge?.totalRub == null ? '' : formatMoney(delivery.billingCharge.totalRub),
            delivery.requiresManualReview ? 'Да' : 'Нет',
        ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'logistics-sla-report.csv';
    link.click();
    URL.revokeObjectURL(url);
}
function deliverySlaLabel(delivery) {
    if (!delivery.desiredShipDate) {
        return 'Дата SLA не задана';
    }
    if (isDeliveryLate(delivery)) {
        return isDeliveryClosed(delivery) ? 'Доставлено с задержкой' : 'Просрочено';
    }
    if (delivery.status === 'DELIVERED') {
        return 'В срок';
    }
    return 'В работе';
}
function isDeliveryClosed(delivery) {
    return delivery.status === 'DELIVERED' || delivery.status === 'CANCELLED';
}
function isDeliveryLate(delivery) {
    if (!delivery.desiredShipDate || delivery.status === 'CANCELLED') {
        return false;
    }
    const dueEnd = endOfDay(delivery.desiredShipDate).getTime();
    const actual = delivery.status === 'DELIVERED' ? new Date(delivery.updatedAt).getTime() : Date.now();
    return actual > dueEnd;
}
function delayDays(delivery) {
    if (!delivery.desiredShipDate || !isDeliveryLate(delivery)) {
        return 0;
    }
    const dueEnd = endOfDay(delivery.desiredShipDate).getTime();
    const actual = delivery.status === 'DELIVERED' ? new Date(delivery.updatedAt).getTime() : Date.now();
    return Math.max(1, Math.ceil((actual - dueEnd) / 86_400_000));
}
function endOfDay(value) {
    const date = new Date(value);
    date.setHours(23, 59, 59, 999);
    return date;
}
function formatMoney(value) {
    return moneyFormatter.format(Number(value));
}
function formatDate(value) {
    return value ? dateFormatter.format(new Date(value)) : '-';
}
function csvCell(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
