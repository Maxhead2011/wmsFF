import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, LogOut, RefreshCw, Search, ShieldCheck, Tablet, UserRound, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { disconnectAdministrationTsdRequest, fetchAdministrationTsdWorkloads, releaseAdministrationTsdWorkload, } from '../../lib/api';
export function AdministrationTsdWorkloadsPanel({ session }) {
    const [data, setData] = useState(null);
    const [query, setQuery] = useState('');
    const [showIdle, setShowIdle] = useState(false);
    const [busyKey, setBusyKey] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    useEffect(() => {
        void load();
    }, []);
    async function load() {
        setBusyKey('load');
        setError('');
        try {
            setData(await fetchAdministrationTsdWorkloads(session.accessToken));
        }
        catch (caught) {
            setError(errorText(caught));
        }
        finally {
            setBusyKey('');
        }
    }
    async function release(deviceCode, workload) {
        if (workload.protected)
            return;
        const label = workload.orderId ? `заказ ${workload.orderId}` : `задачу по заявке №${formatRequest(workload.request.number)}`;
        if (!window.confirm(`Освободить ${label} на ТСД ${deviceCode}? Незащищённые сканы этой задачи будут сброшены.`))
            return;
        const key = `release:${workload.id}`;
        setBusyKey(key);
        setMessage('');
        setError('');
        try {
            const result = await releaseAdministrationTsdWorkload(session.accessToken, {
                kind: workload.kind,
                workloadId: workload.id,
                requestId: workload.request.id,
                deviceCode,
            });
            setMessage(result.message);
            setData(await fetchAdministrationTsdWorkloads(session.accessToken));
        }
        catch (caught) {
            setError(errorText(caught));
        }
        finally {
            setBusyKey('');
        }
    }
    async function disconnect(deviceCode, request) {
        if (!window.confirm(`Отключить ТСД ${deviceCode} от заявки №${formatRequest(request.number)}? Все незавершённые и незащищённые задачи этой заявки вернутся в общую очередь.`))
            return;
        const key = `disconnect:${deviceCode}:${request.id}`;
        setBusyKey(key);
        setMessage('');
        setError('');
        try {
            const result = await disconnectAdministrationTsdRequest(session.accessToken, {
                requestId: request.id,
                deviceCode,
            });
            setMessage(result.message);
            setData(await fetchAdministrationTsdWorkloads(session.accessToken));
        }
        catch (caught) {
            setError(errorText(caught));
        }
        finally {
            setBusyKey('');
        }
    }
    const filteredDevices = useMemo(() => {
        if (!data)
            return [];
        const normalized = query.trim().toLocaleLowerCase('ru-RU');
        return data.devices
            .filter((device) => showIdle || device.workloads.length > 0)
            .map((device) => ({
            ...device,
            workloads: normalized
                ? device.workloads.filter((workload) => [
                    device.deviceCode,
                    device.deviceName,
                    device.user?.name,
                    device.user?.email,
                    workload.workerName,
                    workload.request.number,
                    workload.request.title,
                    workload.request.client.code,
                    workload.request.client.name,
                    workload.orderId,
                    workload.productName,
                    workload.article,
                    workload.sourceBoxCode,
                ].some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(normalized)))
                : device.workloads,
        }))
            .filter((device) => !normalized || device.workloads.length > 0 || [device.deviceCode, device.deviceName, device.user?.name]
            .some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(normalized)));
    }, [data, query, showIdle]);
    if (!data && busyKey === 'load') {
        return _jsxs("div", { className: "admin-loading", children: [_jsx(LoaderCircle, { className: "spin", size: 26 }), _jsx("strong", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E \u0437\u0430\u043D\u044F\u0442\u043E\u0441\u0442\u044C \u0422\u0421\u0414\u2026" })] });
    }
    return (_jsxs("section", { className: "admin-section admin-tsd", children: [_jsxs("header", { className: "admin-section__heading", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0414\u0438\u0441\u043F\u0435\u0442\u0447\u0435\u0440 \u0437\u0430\u0434\u0430\u0447" }), _jsx("h3", { children: "\u0417\u0430\u043D\u044F\u0442\u044B\u0435 \u0422\u0421\u0414" }), _jsx("p", { children: "\u041A\u0430\u043A\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430 \u043E\u0442\u043A\u0440\u044B\u0442\u0430 \u043D\u0430 \u043A\u0430\u0436\u0434\u043E\u043C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435 \u0438 \u043A\u0430\u043A\u0438\u0435 \u0437\u0430\u043A\u0430\u0437\u044B \u0443\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A." })] }), _jsxs("button", { type: "button", className: "admin-button admin-button--ghost", disabled: Boolean(busyKey), onClick: () => void load(), children: [_jsx(RefreshCw, { className: busyKey === 'load' ? 'spin' : '', size: 16 }), " \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"] })] }), data ? (_jsxs("div", { className: "admin-tsd__metrics", "aria-label": "\u0421\u0432\u043E\u0434\u043A\u0430 \u043F\u043E \u0422\u0421\u0414", children: [_jsx(Metric, { label: "\u0417\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043E", value: data.summary.registeredDevices }), _jsx(Metric, { label: "\u0421\u0435\u0439\u0447\u0430\u0441 \u0432 \u0441\u0435\u0442\u0438", value: data.summary.onlineDevices, tone: "good" }), _jsx(Metric, { label: "\u0417\u0430\u043D\u044F\u0442\u043E \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432", value: data.summary.busyDevices, tone: data.summary.busyDevices ? 'warn' : 'good' }), _jsx(Metric, { label: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0437\u0430\u0434\u0430\u0447", value: data.summary.tasks }), _jsx(Metric, { label: "\u0417\u0430\u0449\u0438\u0449\u0451\u043D\u043D\u044B\u0445 \u0437\u0430\u0434\u0430\u0447", value: data.summary.protectedTasks, tone: data.summary.protectedTasks ? 'danger' : 'good' })] })) : null, _jsxs("div", { className: "admin-tsd__toolbar", children: [_jsxs("label", { className: "admin-tsd__search", children: [_jsx(Search, { size: 17 }), _jsx("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "\u0422\u0421\u0414, \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A, \u0437\u0430\u044F\u0432\u043A\u0430, \u0437\u0430\u043A\u0430\u0437 \u0438\u043B\u0438 \u0442\u043E\u0432\u0430\u0440" })] }), _jsxs("label", { className: "admin-tsd__toggle", children: [_jsx("input", { type: "checkbox", checked: showIdle, onChange: (event) => setShowIdle(event.target.checked) }), "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0435 \u0422\u0421\u0414"] })] }), message ? _jsxs("div", { className: "admin-message admin-message--ok", children: [_jsx(CheckCircle2, { size: 18 }), message] }) : null, error ? _jsxs("div", { className: "admin-message admin-message--error", children: [_jsx(AlertTriangle, { size: 18 }), error] }) : null, _jsxs("div", { className: "admin-tsd__devices", children: [filteredDevices.map((device) => {
                        const requests = uniqueRequests(device.workloads);
                        return (_jsxs("article", { className: "admin-tsd-device", children: [_jsxs("header", { children: [_jsxs("div", { className: "admin-tsd-device__identity", children: [_jsx("span", { className: `admin-tsd-device__icon ${device.online ? 'is-online' : ''}`, children: _jsx(Tablet, { size: 20 }) }), _jsxs("div", { children: [_jsx("strong", { children: device.deviceName || device.deviceCode }), _jsx("small", { children: device.deviceName ? device.deviceCode : 'Название устройства не задано' })] })] }), _jsxs("div", { className: "admin-tsd-device__meta", children: [_jsx("span", { className: device.online ? 'is-online' : '', children: device.online ? 'В сети' : 'Не в сети' }), _jsxs("span", { children: [_jsx(UserRound, { size: 14 }), " ", device.user?.name || device.workloads[0]?.workerName || 'Сотрудник не определён'] }), _jsxs("span", { children: [_jsx(Clock3, { size: 14 }), " ", device.lastSeenAt ? relativeTime(device.lastSeenAt) : 'не подключался'] })] })] }), requests.length > 0 ? (_jsx("div", { className: "admin-tsd-device__request-actions", children: requests.map((request) => {
                                        const key = `disconnect:${device.deviceCode}:${request.id}`;
                                        const requestRows = device.workloads.filter((item) => item.request.id === request.id);
                                        const blocked = requestRows.some((item) => item.protected);
                                        return (_jsxs("div", { children: [_jsxs("span", { children: ["\u0417\u0430\u044F\u0432\u043A\u0430 \u2116", formatRequest(request.number), " \u00B7 ", request.client.name] }), _jsxs("button", { type: "button", className: "admin-button admin-button--danger-ghost", disabled: Boolean(busyKey) || blocked, title: blocked ? 'В заявке есть защищённая задача. Освободите её штатным действием по КИЗ.' : undefined, onClick: () => void disconnect(device.deviceCode, request), children: [busyKey === key ? _jsx(LoaderCircle, { className: "spin", size: 15 }) : _jsx(LogOut, { size: 15 }), "\u041E\u0442\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u043E\u0442 \u0437\u0430\u044F\u0432\u043A\u0438"] })] }, request.id));
                                    }) })) : null, device.workloads.length > 0 ? (_jsx("div", { className: "admin-tsd-table-wrap", children: _jsxs("table", { className: "admin-tsd-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0417\u0430\u044F\u0432\u043A\u0430 / \u0437\u0430\u043A\u0430\u0437" }), _jsx("th", { children: "\u0422\u0435\u043A\u0443\u0449\u0430\u044F \u0437\u0430\u0434\u0430\u0447\u0430" }), _jsx("th", { children: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A" }), _jsx("th", { children: "\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C" }), _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435" })] }) }), _jsx("tbody", { children: device.workloads.map((workload) => {
                                                    const key = `release:${workload.id}`;
                                                    return (_jsxs("tr", { children: [_jsxs("td", { children: [_jsxs("strong", { children: ["\u2116", formatRequest(workload.request.number)] }), _jsx("span", { children: workload.orderId ? `Заказ ${workload.orderId}` : workload.request.title }), _jsxs("small", { children: [workload.request.client.code, " \u00B7 ", workload.request.client.name] })] }), _jsxs("td", { children: [_jsx("strong", { children: workload.stageLabel }), workload.productName ? _jsxs("span", { children: [workload.productName, workload.article ? ` · ${workload.article}` : ''] }) : null, workload.sourceBoxCode ? _jsxs("small", { children: ["\u041A\u043E\u0440\u043E\u0431: ", workload.sourceBoxCode] }) : null, workload.protected ? _jsxs("small", { className: "is-protected", children: [_jsx(ShieldCheck, { size: 13 }), " \u0417\u0430\u0449\u0438\u0449\u0435\u043D\u043E \u043E\u0442 \u0441\u0431\u0440\u043E\u0441\u0430"] }) : null] }), _jsx("td", { children: _jsx("span", { children: workload.workerName || device.user?.name || '—' }) }), _jsxs("td", { children: [_jsx("span", { children: relativeTime(workload.updatedAt) }), _jsx("small", { children: dateTime(workload.updatedAt) })] }), _jsxs("td", { children: [_jsxs("button", { type: "button", className: "admin-button admin-button--compact", disabled: Boolean(busyKey) || workload.protected, title: workload.protectedReason || undefined, onClick: () => void release(device.deviceCode, workload), children: [busyKey === key ? _jsx(LoaderCircle, { className: "spin", size: 15 }) : _jsx(LogOut, { size: 15 }), "\u041E\u0441\u0432\u043E\u0431\u043E\u0434\u0438\u0442\u044C \u0437\u0430\u0434\u0430\u0447\u0443"] }), workload.protectedReason ? _jsx("small", { className: "admin-tsd-table__reason", children: workload.protectedReason }) : null] })] }, `${workload.kind}:${workload.id}`));
                                                }) })] }) })) : _jsxs("div", { className: "admin-tsd-device__empty", children: [_jsx(CheckCircle2, { size: 18 }), " \u0423\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E"] })] }, device.deviceCode));
                    }), filteredDevices.length === 0 ? (_jsxs("div", { className: "admin-tsd__empty", children: [_jsx(CheckCircle2, { size: 24 }), _jsx("strong", { children: "\u0417\u0430\u043D\u044F\u0442\u044B\u0445 \u0422\u0421\u0414 \u043D\u0435\u0442" }), _jsx("span", { children: "\u0412\u0441\u0435 \u0437\u0430\u044F\u0432\u043A\u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u0434\u043B\u044F \u0440\u0430\u0431\u043E\u0442\u044B." })] })) : null] }), data ? _jsxs("small", { className: "admin-tsd__checked", children: ["\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E: ", dateTime(data.checkedAt)] }) : null] }));
}
function Metric({ label, value, tone = '' }) {
    return _jsxs("div", { className: tone ? `is-${tone}` : '', children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] });
}
function uniqueRequests(workloads) {
    return [...new Map(workloads.map((workload) => [workload.request.id, workload.request])).values()];
}
function formatRequest(number) {
    return String(number).padStart(6, '0');
}
function dateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}
function relativeTime(value) {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp))
        return 'время неизвестно';
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
    if (minutes < 1)
        return 'только что';
    if (minutes < 60)
        return `${minutes} мин назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours} ч назад`;
    return `${Math.floor(hours / 24)} дн назад`;
}
function errorText(value) {
    return value instanceof Error ? value.message : 'Не удалось выполнить действие.';
}
