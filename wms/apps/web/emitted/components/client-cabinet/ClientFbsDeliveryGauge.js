import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Clock3, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchFbsOrders, } from '../../lib/api';
const DAY_MS = 24 * 60 * 60 * 1000;
export function ClientFbsDeliveryGauge({ accessToken, clientId, }) {
    const [state, setState] = useState({
        status: 'loading',
        data: null,
        error: '',
    });
    useEffect(() => {
        let active = true;
        setState({ status: 'loading', data: null, error: '' });
        void fetchFbsOrders(accessToken, clientId)
            .then((data) => {
            if (active)
                setState({ status: 'ready', data, error: '' });
        })
            .catch((caught) => {
            if (!active)
                return;
            setState({
                status: 'error',
                data: null,
                error: caught instanceof Error
                    ? caught.message
                    : 'Не удалось рассчитать время доставки FBS.',
            });
        });
        return () => {
            active = false;
        };
    }, [accessToken, clientId]);
    const metric = useMemo(() => calculateDeliveryMetric(state.data), [state.data]);
    if (state.status === 'loading') {
        return (_jsxs("section", { className: "client-fbs-delivery client-fbs-delivery--loading", children: [_jsx(Clock3, { size: 20, "aria-hidden": "true" }), _jsx("span", { children: "\u0420\u0430\u0441\u0441\u0447\u0438\u0442\u044B\u0432\u0430\u044E \u0441\u0440\u0435\u0434\u043D\u0435\u0435 \u0432\u0440\u0435\u043C\u044F \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438 FBS\u2026" })] }));
    }
    if (state.status === 'error') {
        return (_jsxs("section", { className: "client-fbs-delivery client-fbs-delivery--empty", children: [_jsx(Truck, { size: 20, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u0421\u0440\u0435\u0434\u043D\u0435\u0435 \u0432\u0440\u0435\u043C\u044F \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438 FBS" }), _jsx("span", { children: state.error })] })] }));
    }
    if (!state.data.connected || !metric) {
        return (_jsxs("section", { className: "client-fbs-delivery client-fbs-delivery--empty", children: [_jsx(Truck, { size: 20, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: "\u0421\u0440\u0435\u0434\u043D\u0435\u0435 \u0432\u0440\u0435\u043C\u044F \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438 FBS" }), _jsx("span", { children: !state.data.connected
                                ? 'Маркетплейс ещё не подключён.'
                                : 'Показатель появится после первой передачи FBS-поставки в Wildberries.' })] })] }));
    }
    return (_jsxs("section", { className: `client-fbs-delivery client-fbs-delivery--${metric.tone}`, "aria-label": "\u0421\u0440\u0435\u0434\u043D\u0435\u0435 \u0432\u0440\u0435\u043C\u044F \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438 FBS", children: [_jsxs("div", { className: "client-fbs-delivery__heading", children: [_jsx("span", { className: "client-fbs-delivery__icon", children: _jsx(Truck, { size: 21, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("span", { children: "FBS \u00B7 \u043E\u0442 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0437\u0430\u043A\u0430\u0437\u0430 \u0434\u043E \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0438 Wildberries" }), _jsx("strong", { children: formatDeliveryDuration(metric.averageMs) })] }), _jsxs("small", { children: [metric.sampleSize, " \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0445 \u0437\u0430\u043A\u0430\u0437\u043E\u0432"] })] }), _jsxs("div", { className: "client-fbs-delivery__gauge", children: [_jsx("div", { className: "client-fbs-delivery__track", children: _jsx("span", { className: "client-fbs-delivery__marker", style: { left: `${metric.position}%` }, title: `Среднее: ${formatDeliveryDuration(metric.averageMs)}` }) }), _jsxs("div", { className: "client-fbs-delivery__scale", "aria-hidden": "true", children: [_jsx("span", { children: "0 \u0447" }), _jsx("span", { children: "12 \u0447" }), _jsx("span", { children: "19 \u0447" }), _jsx("span", { children: "24 \u0447+" })] })] }), _jsxs("p", { children: ["\u0411\u044B\u0441\u0442\u0440\u0435\u0435 \u0432\u0441\u0435\u0433\u043E: ", formatDeliveryDuration(metric.fastestMs), " \u00B7 \u0434\u043E\u043B\u044C\u0448\u0435 \u0432\u0441\u0435\u0433\u043E: ", formatDeliveryDuration(metric.slowestMs)] })] }));
}
function calculateDeliveryMetric(data) {
    if (!data)
        return null;
    const durations = data.orders.flatMap((order) => {
        const createdAt = validTimestamp(order.createdAt);
        const sentToWbAt = validTimestamp(order.shipmentPlan?.sentToWbAt);
        if (createdAt === null ||
            sentToWbAt === null ||
            sentToWbAt < createdAt) {
            return [];
        }
        return [sentToWbAt - createdAt];
    });
    if (durations.length === 0)
        return null;
    const averageMs = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
    return {
        averageMs,
        fastestMs: Math.min(...durations),
        slowestMs: Math.max(...durations),
        sampleSize: durations.length,
        position: Math.min(100, Math.max(0, (averageMs / DAY_MS) * 100)),
        tone: averageMs < 12 * 60 * 60 * 1000
            ? 'fast'
            : averageMs < 19 * 60 * 60 * 1000
                ? 'slow'
                : 'critical',
    };
}
function validTimestamp(value) {
    if (!value)
        return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}
function formatDeliveryDuration(milliseconds) {
    const totalMinutes = Math.max(0, Math.round(milliseconds / 60_000));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0)
        return `${days} д ${hours} ч`;
    if (hours > 0)
        return `${hours} ч ${minutes} мин`;
    return `${minutes} мин`;
}
