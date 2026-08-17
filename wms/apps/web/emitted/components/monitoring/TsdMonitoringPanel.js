import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Activity, AlertTriangle, Box, CheckCircle2, ChevronDown, Clock3, Download, History, LockOpen, LogOut, PackageCheck, RefreshCw, ScanLine, Search, Tablet, UserRound, Wifi, WifiOff, X, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchTsdMonitoring, sendTsdMonitorAction, } from '../../lib/api';
import './tsd-monitoring.css';
export function TsdMonitoringPanel({ session }) {
    const [data, setData] = useState(null);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [commandDevice, setCommandDevice] = useState('');
    const [notice, setNotice] = useState('');
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyFilter, setHistoryFilter] = useState('all');
    const [errorDeviceCode, setErrorDeviceCode] = useState('');
    const [latestTsdVersion, setLatestTsdVersion] = useState('');
    useEffect(() => {
        let active = true;
        let timer = 0;
        const loadRelease = async () => {
            try {
                const response = await fetch(`/downloads/logoff-tsd.json?v=${Date.now()}`, { cache: 'no-store' });
                if (!response.ok)
                    return;
                const release = await response.json();
                if (active && typeof release.versionName === 'string') {
                    setLatestTsdVersion(release.versionName.trim());
                }
            }
            catch {
                // Если метаданные временно недоступны, обновление остаётся доступным — это безопаснее ложного статуса «Обновлён».
            }
        };
        void loadRelease();
        timer = window.setInterval(() => void loadRelease(), 60_000);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, []);
    useEffect(() => {
        let active = true;
        let timer = 0;
        const load = async (initial = false) => {
            if (initial)
                setLoading(true);
            try {
                const next = await fetchTsdMonitoring(session.accessToken);
                if (!active)
                    return;
                setData(next);
                setError('');
            }
            catch (caught) {
                if (active)
                    setError(caught instanceof Error ? caught.message : 'Мониторинг ТСД временно недоступен.');
            }
            finally {
                if (active && initial)
                    setLoading(false);
            }
        };
        void load(true);
        timer = window.setInterval(() => void load(false), 3_000);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [session.accessToken]);
    const devices = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase('ru-RU');
        return (data?.devices ?? []).filter((device) => {
            if (!device.online)
                return false;
            if (!normalized)
                return true;
            return [
                device.deviceCode,
                device.deviceName,
                device.user?.name,
                device.user?.email,
                device.liveState?.screenLabel,
                device.liveState?.clientName,
                device.liveState?.requestNumber,
                device.liveState?.orderId,
                device.liveState?.productName,
                device.liveState?.boxCode,
                ...device.workloads.flatMap((workload) => [
                    workload.request.number,
                    workload.request.client.name,
                    workload.orderId,
                    workload.productName,
                    workload.sourceBoxCode,
                ]),
            ].some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(normalized));
        }).sort((left, right) => left.deviceCode.localeCompare(right.deviceCode, 'ru-RU', { numeric: true, sensitivity: 'base' }));
    }, [data, query]);
    const history = useMemo(() => {
        const result = [];
        const seen = new Set();
        for (const device of data?.devices ?? []) {
            const errorIds = new Set(device.errors.map((item) => item.id));
            for (const item of device.activity) {
                if (seen.has(item.id))
                    continue;
                seen.add(item.id);
                const isError = errorIds.has(item.id)
                    || item.type === 'monitor_error'
                    || ['REJECTED', 'NEEDS_REVIEW'].includes(item.status);
                result.push({
                    id: item.id,
                    tone: isError ? 'error' : 'success',
                    title: activityLabel(item),
                    details: compactStrings([
                        item.screen,
                        item.requestNumber ? `Заявка №${String(item.requestNumber).padStart(6, '0')}` : null,
                        item.orderId ? `Заказ ${item.orderId}` : null,
                        item.clientName,
                        item.boxCode ? `Короб ${item.boxCode}` : null,
                        item.barcode ? `ШК ${item.barcode}` : null,
                    ]),
                    deviceCode: device.deviceCode,
                    deviceName: device.deviceName || device.deviceCode,
                    workerName: item.workerName || device.user?.name || 'Сотрудник не определён',
                    createdAt: item.createdAt,
                });
            }
            for (const item of device.errors) {
                if (seen.has(item.id))
                    continue;
                seen.add(item.id);
                result.push({
                    id: item.id,
                    tone: 'error',
                    title: item.message,
                    details: compactStrings([
                        item.screen,
                        item.requestNumber ? `Заявка №${String(item.requestNumber).padStart(6, '0')}` : null,
                        item.orderId ? `Заказ ${item.orderId}` : null,
                        item.clientName,
                    ]),
                    deviceCode: device.deviceCode,
                    deviceName: device.deviceName || device.deviceCode,
                    workerName: item.workerName || device.user?.name || 'Сотрудник не определён',
                    createdAt: item.createdAt,
                });
            }
        }
        return result.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }, [data]);
    const visibleHistory = useMemo(() => historyFilter === 'all' ? history : history.filter((item) => item.tone === historyFilter), [history, historyFilter]);
    const errorDevice = useMemo(() => (data?.devices ?? []).find((device) => device.deviceCode === errorDeviceCode) ?? null, [data, errorDeviceCode]);
    useEffect(() => {
        if (!historyOpen && !errorDeviceCode)
            return undefined;
        const closeOnEscape = (event) => {
            if (event.key === 'Escape') {
                setHistoryOpen(false);
                setErrorDeviceCode('');
            }
        };
        document.addEventListener('keydown', closeOnEscape);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', closeOnEscape);
            document.body.style.overflow = previousOverflow;
        };
    }, [historyOpen, errorDeviceCode]);
    const sendCommand = async (device, action) => {
        const title = action === 'LOGOUT'
            ? 'выйти из аккаунта'
            : action === 'UPDATE_APP'
                ? 'тихо обновить приложение ТСД'
                : action === 'UNLOCK_INVENTORY'
                    ? 'разблокировать инвентаризацию'
                    : 'перезагрузить текущую заявку';
        if (!window.confirm(`Отправить на ${device.deviceName || device.deviceCode} команду «${title}»?`))
            return;
        setCommandDevice(device.deviceCode);
        try {
            const result = await sendTsdMonitorAction(session.accessToken, device.deviceCode, action);
            setNotice(result.message);
            setError('');
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось отправить команду на ТСД.');
        }
        finally {
            setCommandDevice('');
        }
    };
    if (loading && !data) {
        return (_jsxs("section", { className: "tsd-monitor tsd-monitor--loading", children: [_jsx(RefreshCw, { className: "spin", size: 28 }), _jsx("strong", { children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0430\u044E \u0434\u0438\u0441\u043F\u0435\u0442\u0447\u0435\u0440\u0441\u043A\u0443\u044E \u0422\u0421\u0414\u2026" })] }));
    }
    return (_jsxs("section", { className: "tsd-monitor", children: [_jsxs("header", { className: "tsd-monitor__header", children: [_jsxs("div", { children: [_jsx("h2", { children: "\u041C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433 \u0422\u0421\u0414" }), _jsx("p", { children: "\u0416\u0438\u0432\u043E\u0435 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432, \u0445\u043E\u0434 \u0437\u0430\u044F\u0432\u043E\u043A \u0438 \u043E\u0448\u0438\u0431\u043A\u0438 \u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F. \u042D\u043A\u0440\u0430\u043D \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u043A\u0430\u0436\u0434\u044B\u0435 3 \u0441\u0435\u043A\u0443\u043D\u0434\u044B." })] }), _jsxs("div", { className: "tsd-monitor__header-actions", children: [_jsxs("button", { type: "button", className: "tsd-monitor__history-button", onClick: () => setHistoryOpen(true), children: [_jsx(History, { size: 16 }), "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439", _jsx("span", { children: history.length })] }), _jsxs("div", { className: "tsd-monitor__clock", children: [_jsx("span", { className: "tsd-monitor__live-dot", "aria-hidden": "true" }), "\u041E\u043D\u043B\u0430\u0439\u043D", _jsx("time", { children: data ? timeOnly(data.checkedAt) : '—' })] })] })] }), data ? (_jsxs("div", { className: "tsd-monitor__summary", children: [_jsx(Summary, { label: "\u0412 \u0441\u0435\u0442\u0438", value: data.summary.onlineDevices, icon: Wifi, tone: "online" }), _jsx(Summary, { label: "\u0412 \u0440\u0430\u0431\u043E\u0442\u0435", value: data.summary.busyDevices, icon: Activity }), _jsx(Summary, { label: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0437\u0430\u0434\u0430\u0447", value: data.summary.tasks, icon: ScanLine }), _jsx(Summary, { label: "\u041E\u0448\u0438\u0431\u043E\u043A \u0437\u0430 24 \u0447\u0430\u0441\u0430", value: data.summary.errors24h, icon: AlertTriangle, tone: data.summary.errors24h ? 'danger' : 'online' })] })) : null, _jsx("div", { className: "tsd-monitor__toolbar", children: _jsxs("label", { className: "tsd-monitor__search", children: [_jsx(Search, { size: 18, "aria-hidden": "true" }), _jsx("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "\u041D\u0430\u0439\u0442\u0438 \u0422\u0421\u0414, \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430, \u0437\u0430\u044F\u0432\u043A\u0443, \u0437\u0430\u043A\u0430\u0437 \u0438\u043B\u0438 \u043A\u043E\u0440\u043E\u0431" })] }) }), error ? _jsxs("div", { className: "tsd-monitor__error", children: [_jsx(AlertTriangle, { size: 18 }), error] }) : null, notice ? _jsxs("div", { className: "tsd-monitor__notice", children: [_jsx(CheckCircle2, { size: 18 }), notice] }) : null, _jsx("div", { className: "tsd-monitor__wall", children: devices.map((device) => (_jsx(DeviceFeed, { device: device, commandBusy: commandDevice === device.deviceCode, latestVersion: latestTsdVersion, onCommand: sendCommand, onOpenErrors: () => setErrorDeviceCode(device.deviceCode) }, device.deviceCode))) }), devices.length === 0 ? (_jsxs("div", { className: "tsd-monitor__empty", children: [_jsx(Tablet, { size: 30 }), _jsx("strong", { children: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0422\u0421\u0414 \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u0442" }), _jsx("span", { children: "\u0412 \u043C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433\u0435 \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0430\u0445\u043E\u0434\u044F\u0442\u0441\u044F \u0432 \u0441\u0435\u0442\u0438." })] })) : null, data ? _jsx(PickerStatistics, { statistics: data.pickerStatistics }) : null, historyOpen ? (_jsx("div", { className: "tsd-history-modal", role: "presentation", onMouseDown: () => setHistoryOpen(false), children: _jsxs("section", { className: "tsd-history-modal__dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "tsd-history-title", onMouseDown: (event) => event.stopPropagation(), children: [_jsxs("header", { className: "tsd-history-modal__header", children: [_jsxs("div", { children: [_jsx("h3", { id: "tsd-history-title", children: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439 \u0422\u0421\u0414" }), _jsx("p", { children: "\u0423\u0441\u043F\u0435\u0448\u043D\u044B\u0435 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438 \u0438 \u043E\u0448\u0438\u0431\u043A\u0438 \u0432\u0441\u0435\u0445 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432 \u0437\u0430 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 24 \u0447\u0430\u0441\u0430." })] }), _jsx("button", { type: "button", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E", onClick: () => setHistoryOpen(false), autoFocus: true, children: _jsx(X, { size: 18 }) })] }), _jsxs("div", { className: "tsd-history-modal__filters", "aria-label": "\u0424\u0438\u043B\u044C\u0442\u0440 \u0438\u0441\u0442\u043E\u0440\u0438\u0438", children: [_jsx(HistoryFilterButton, { active: historyFilter === 'all', onClick: () => setHistoryFilter('all'), label: "\u0412\u0441\u0435", count: history.length }), _jsx(HistoryFilterButton, { active: historyFilter === 'success', onClick: () => setHistoryFilter('success'), label: "\u0423\u0441\u043F\u0435\u0448\u043D\u044B\u0435", count: history.filter((item) => item.tone === 'success').length, tone: "success" }), _jsx(HistoryFilterButton, { active: historyFilter === 'error', onClick: () => setHistoryFilter('error'), label: "\u041E\u0448\u0438\u0431\u043A\u0438", count: history.filter((item) => item.tone === 'error').length, tone: "error" })] }), _jsx("div", { className: "tsd-history-modal__list", children: visibleHistory.length ? visibleHistory.map((item) => (_jsxs("article", { className: `tsd-history-row is-${item.tone}`, children: [_jsx("span", { className: "tsd-history-row__icon", children: item.tone === 'error' ? _jsx(AlertTriangle, { size: 16 }) : _jsx(CheckCircle2, { size: 16 }) }), _jsxs("div", { className: "tsd-history-row__content", children: [_jsx("strong", { children: item.title }), item.details.length ? _jsx("p", { children: item.details.join(' · ') }) : null, _jsxs("span", { children: [item.deviceName, " \u00B7 ", item.workerName] })] }), _jsx("time", { dateTime: item.createdAt, children: dateTimeShort(item.createdAt) })] }, item.id))) : (_jsxs("div", { className: "tsd-history-modal__empty", children: [_jsx(CheckCircle2, { size: 26 }), _jsx("strong", { children: "\u0421\u043E\u0431\u044B\u0442\u0438\u0439 \u044D\u0442\u043E\u0433\u043E \u0442\u0438\u043F\u0430 \u043D\u0435\u0442" }), _jsx("span", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0440\u0443\u0433\u043E\u0439 \u0444\u0438\u043B\u044C\u0442\u0440 \u0438\u0441\u0442\u043E\u0440\u0438\u0438." })] })) })] }) })) : null, errorDevice ? (_jsx("div", { className: "tsd-history-modal", role: "presentation", onMouseDown: () => setErrorDeviceCode(''), children: _jsxs("section", { className: "tsd-history-modal__dialog tsd-history-modal__dialog--device-errors", role: "dialog", "aria-modal": "true", "aria-labelledby": "tsd-device-errors-title", onMouseDown: (event) => event.stopPropagation(), children: [_jsxs("header", { className: "tsd-history-modal__header", children: [_jsxs("div", { children: [_jsxs("h3", { id: "tsd-device-errors-title", children: ["\u041E\u0448\u0438\u0431\u043A\u0438 \u00B7 ", errorDevice.deviceName || errorDevice.deviceCode] }), _jsxs("p", { children: [errorDevice.deviceCode, " \u00B7 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 20 \u043E\u0448\u0438\u0431\u043E\u043A \u0437\u0430 24 \u0447\u0430\u0441\u0430"] })] }), _jsx("button", { type: "button", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043E\u0448\u0438\u0431\u043A\u0438 \u0422\u0421\u0414", onClick: () => setErrorDeviceCode(''), autoFocus: true, children: _jsx(X, { size: 18 }) })] }), _jsx("div", { className: "tsd-history-modal__list", children: errorDevice.errors.slice(0, 20).length ? errorDevice.errors.slice(0, 20).map((item) => (_jsxs("article", { className: "tsd-history-row is-error", children: [_jsx("span", { className: "tsd-history-row__icon", children: _jsx(AlertTriangle, { size: 16 }) }), _jsxs("div", { className: "tsd-history-row__content", children: [_jsx("strong", { children: item.message }), compactStrings([
                                                item.screen,
                                                item.requestNumber ? `Заявка №${String(item.requestNumber).padStart(6, '0')}` : null,
                                                item.orderId ? `Заказ ${item.orderId}` : null,
                                                item.clientName,
                                            ]).length ? (_jsx("p", { children: compactStrings([
                                                    item.screen,
                                                    item.requestNumber ? `Заявка №${String(item.requestNumber).padStart(6, '0')}` : null,
                                                    item.orderId ? `Заказ ${item.orderId}` : null,
                                                    item.clientName,
                                                ]).join(' · ') })) : null, _jsx("span", { children: item.workerName || errorDevice.user?.name || 'Сотрудник не определён' })] }), _jsx("time", { dateTime: item.createdAt, children: dateTimeShort(item.createdAt) })] }, item.id))) : (_jsxs("div", { className: "tsd-history-modal__empty", children: [_jsx(CheckCircle2, { size: 26 }), _jsx("strong", { children: "\u041E\u0448\u0438\u0431\u043E\u043A \u043D\u0435\u0442" }), _jsx("span", { children: "\u0417\u0430 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 24 \u0447\u0430\u0441\u0430 \u044D\u0442\u043E\u0442 \u0422\u0421\u0414 \u0440\u0430\u0431\u043E\u0442\u0430\u043B \u0431\u0435\u0437 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0445 \u043E\u0448\u0438\u0431\u043E\u043A." })] })) })] }) })) : null] }));
}
function PickerStatistics({ statistics }) {
    return (_jsxs("section", { className: "tsd-picker-statistics", children: [_jsxs("header", { className: "tsd-picker-statistics__header", children: [_jsxs("div", { children: [_jsx("span", { children: "\u041F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C \u0441\u0431\u043E\u0440\u043A\u0438" }), _jsx("h3", { children: "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u043F\u043E \u0441\u0431\u043E\u0440\u0449\u0438\u043A\u0430\u043C" }), _jsxs("p", { children: [statistics.period.label, ". \u0423\u0447\u0438\u0442\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0435 FBS-\u0437\u0430\u043A\u0430\u0437\u044B \u0438 \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043E\u0442\u043F\u0438\u043A\u0430\u043D\u043D\u044B\u0435 \u0435\u0434\u0438\u043D\u0438\u0446\u044B."] })] }), _jsxs("div", { className: "tsd-picker-statistics__totals", children: [_jsxs("span", { children: [_jsx(UserRound, { size: 15 }), _jsx("b", { children: statistics.summary.workers }), " \u0441\u0431\u043E\u0440\u0449\u0438\u043A\u043E\u0432"] }), _jsxs("span", { children: [_jsx(PackageCheck, { size: 15 }), _jsx("b", { children: statistics.summary.orders }), " \u0437\u0430\u043A\u0430\u0437\u043E\u0432"] }), _jsxs("span", { children: [_jsx(ScanLine, { size: 15 }), _jsx("b", { children: statistics.summary.units }), " \u0435\u0434."] })] })] }), statistics.workers.length ? (_jsx("div", { className: "tsd-picker-statistics__grid", children: statistics.workers.map((worker) => _jsx(PickerWorkerCard, { worker: worker }, worker.workerId ?? worker.workerName)) })) : (_jsxs("div", { className: "tsd-picker-statistics__empty", children: [_jsx(Clock3, { size: 22 }), _jsx("strong", { children: "\u0417\u0430 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 24 \u0447\u0430\u0441\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0445 \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u043D\u0435\u0442" }), _jsx("span", { children: "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F \u043F\u0435\u0440\u0432\u043E\u0433\u043E FBS-\u0437\u0430\u043A\u0430\u0437\u0430 \u043D\u0430 \u0422\u0421\u0414." })] }))] }));
}
function PickerWorkerCard({ worker }) {
    return (_jsxs("article", { className: "tsd-picker-card", children: [_jsxs("header", { children: [_jsx("span", { className: "tsd-picker-card__avatar", children: _jsx(UserRound, { size: 18 }) }), _jsxs("div", { children: [_jsx("strong", { children: worker.workerName }), _jsx("small", { children: worker.deviceCodes.length ? worker.deviceCodes.join(' · ') : 'ТСД не определён' })] })] }), _jsxs("div", { className: "tsd-picker-card__metrics", children: [_jsxs("span", { children: [_jsx("small", { children: "\u0417\u0430\u043A\u0430\u0437\u043E\u0432" }), _jsx("b", { children: worker.orders })] }), _jsxs("span", { children: [_jsx("small", { children: "\u041E\u0442\u043F\u0438\u043A\u0430\u043D\u043E" }), _jsxs("b", { children: [worker.units, " \u0435\u0434."] })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0421\u0440\u0435\u0434\u043D\u0435\u0435 \u0432\u0440\u0435\u043C\u044F" }), _jsx("b", { children: formatDuration(worker.averageDurationSeconds) })] }), _jsxs("span", { children: [_jsx("small", { children: "\u0412\u0441\u0435\u0433\u043E \u0432\u0440\u0435\u043C\u0435\u043D\u0438" }), _jsx("b", { children: formatDuration(worker.measuredOrders ? worker.totalDurationSeconds : null) })] })] }), _jsxs("details", { className: "tsd-picker-card__orders", children: [_jsxs("summary", { children: ["\u0412\u0440\u0435\u043C\u044F \u043F\u043E \u043A\u0430\u0436\u0434\u043E\u043C\u0443 \u0437\u0430\u043A\u0430\u0437\u0443 ", _jsx(ChevronDown, { size: 15 })] }), _jsx("div", { className: "tsd-picker-card__order-list", children: worker.orderDetails.map((order) => (_jsxs("div", { className: "tsd-picker-order", children: [_jsxs("div", { children: [_jsxs("strong", { children: ["\u0417\u0430\u043A\u0430\u0437 ", order.orderId] }), _jsxs("span", { children: ["\u0417\u0430\u044F\u0432\u043A\u0430 \u2116", String(order.requestNumber).padStart(6, '0'), " \u00B7 ", order.clientName] }), _jsxs("small", { children: [order.productName, order.article ? ` · ${order.article}` : '', " \u00B7 ", order.units, " \u0435\u0434."] })] }), _jsxs("div", { children: [_jsx("b", { children: formatDuration(order.durationSeconds) }), _jsx("time", { dateTime: order.completedAt, children: dateTimeShort(order.completedAt) })] })] }, order.taskId))) }), worker.measuredOrders < worker.orders ? (_jsxs("p", { className: "tsd-picker-card__measurement-note", children: ["\u0414\u043B\u044F ", worker.orders - worker.measuredOrders, " \u0441\u0442\u0430\u0440\u044B\u0445 \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u0432\u0440\u0435\u043C\u044F \u043D\u0430\u0447\u0430\u043B\u0430 \u0435\u0449\u0451 \u043D\u0435 \u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u043B\u043E\u0441\u044C; \u043D\u043E\u0432\u044B\u0435 \u0441\u0431\u043E\u0440\u043A\u0438 \u0438\u0437\u043C\u0435\u0440\u044F\u044E\u0442\u0441\u044F \u0442\u043E\u0447\u043D\u043E."] })) : null] })] }));
}
function DeviceFeed({ device, commandBusy, latestVersion, onCommand, onOpenErrors, }) {
    const current = device.workloads[0] ?? null;
    const state = device.liveState;
    const inventoryLocked = Boolean(state?.inventorySessionId
        || state?.screen?.startsWith('INVENTORY_')
        || state?.screenLabel?.toLocaleLowerCase('ru-RU').includes('инвентар'));
    const progress = device.progress ?? heartbeatProgress(device);
    const requestNumber = state?.requestNumber ?? current?.request.number ?? null;
    const operator = device.user?.name || current?.workerName || 'Сотрудник не определён';
    const screenLabel = state?.screenLabel || current?.stageLabel || (device.online ? 'Главное меню' : 'Экран недоступен');
    const progressPercent = progress && progress.total > 0
        ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
        : 0;
    const installedVersion = state?.appVersion?.trim() ?? '';
    const isUpdated = Boolean(latestVersion
        && installedVersion
        && compareVersions(installedVersion, latestVersion) >= 0);
    return (_jsxs("article", { className: `tsd-feed ${device.online ? 'is-online' : 'is-offline'}${device.errors.length ? ' has-errors' : ''}`, children: [_jsxs("header", { className: "tsd-feed__topbar", children: [_jsxs("div", { className: "tsd-feed__device", children: [_jsx("span", { className: "tsd-feed__camera-mark", children: _jsx(Tablet, { size: 18 }) }), _jsxs("div", { children: [_jsx("strong", { children: device.deviceName || device.deviceCode }), _jsx("span", { children: device.deviceName ? device.deviceCode : 'Зарегистрированное устройство' })] })] }), _jsxs("span", { className: `tsd-feed__connection ${device.online ? 'is-online' : ''}`, children: [device.online ? _jsx(Wifi, { size: 14 }) : _jsx(WifiOff, { size: 14 }), device.online ? 'В сети' : 'Нет связи'] })] }), _jsxs("div", { className: "tsd-feed__screen", children: [_jsxs("div", { className: "tsd-feed__screen-head", children: [_jsx("span", { children: screenLabel }), _jsx("time", { children: device.lastSeenAt ? relativeTime(device.lastSeenAt) : 'не подключался' })] }), _jsxs("div", { className: "tsd-feed__operator", children: [_jsx(UserRound, { size: 18 }), _jsxs("div", { children: [_jsx("span", { children: "\u0421\u0435\u0439\u0447\u0430\u0441 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442" }), _jsx("strong", { children: operator })] })] }), requestNumber ? (_jsxs("div", { className: "tsd-feed__request", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0417\u0430\u044F\u0432\u043A\u0430" }), _jsxs("strong", { children: ["\u2116", String(requestNumber).padStart(6, '0')] }), _jsx("small", { children: state?.clientName || current?.request.client.name || 'Клиент не определён' })] }), state?.orderId || current?.orderId ? (_jsxs("div", { children: [_jsx("span", { children: "\u0417\u0430\u043A\u0430\u0437" }), _jsx("strong", { children: state?.orderId || current?.orderId })] })) : null] })) : (_jsxs("div", { className: "tsd-feed__idle", children: [_jsx(CheckCircle2, { size: 19 }), " \u041D\u0430 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435 \u043D\u0435\u0442 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0439 \u0437\u0430\u044F\u0432\u043A\u0438"] })), progress ? (_jsxs("div", { className: "tsd-feed__progress", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0412\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043E" }), _jsxs("strong", { children: [progress.completed, " \u0438\u0437 ", progress.total] })] }), _jsx("div", { className: "tsd-feed__progress-track", children: _jsx("i", { style: { transform: `scaleX(${progressPercent / 100})` } }) }), _jsxs("div", { className: "tsd-feed__progress-notes", children: [_jsxs("span", { children: [_jsx(PackageCheck, { size: 14 }), " \u041F\u0440\u0438\u043D\u044F\u0442\u043E: ", progress.completed] }), _jsxs("span", { children: [_jsx(Box, { size: 14 }), " \u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C: ", progress.remaining] }), _jsxs("b", { children: [progressPercent, "%"] })] })] })) : null, (state?.productName || current?.productName || state?.boxCode || current?.sourceBoxCode) ? (_jsxs("div", { className: "tsd-feed__current-item", children: [_jsx("span", { children: "\u0422\u0435\u043A\u0443\u0449\u0435\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435" }), _jsx("strong", { children: state?.productName || current?.productName || state?.lastAction || 'Сканирование' }), (state?.boxCode || current?.sourceBoxCode) ? _jsxs("small", { children: ["\u041A\u043E\u0440\u043E\u0431: ", state?.boxCode || current?.sourceBoxCode] }) : null] })) : null, _jsxs("div", { className: "tsd-feed__last-action", children: [_jsx(Clock3, { size: 15 }), _jsx("span", { children: state?.lastAction || activityLabel(device.activity[0]) || 'Ожидает действие сотрудника' })] })] }), _jsxs("div", { className: "tsd-feed__footer", children: [_jsxs("button", { type: "button", className: `tsd-feed__errors-button${device.errors.length ? ' has-errors' : ''}`, onClick: onOpenErrors, "aria-label": `Открыть ошибки ТСД ${device.deviceName || device.deviceCode}: ${device.errors.length}`, children: [device.errors.length ? _jsx(AlertTriangle, { size: 15 }) : _jsx(CheckCircle2, { size: 15 }), "\u041E\u0448\u0438\u0431\u043A\u0438", _jsx("strong", { children: Math.min(20, device.errors.length) })] }), _jsxs("span", { children: ["\u0412\u0435\u0440\u0441\u0438\u044F ", state?.appVersion || 'не определена'] })] }), _jsxs("div", { className: "tsd-feed__controls", children: [inventoryLocked ? (_jsxs("button", { type: "button", className: "is-unlock", disabled: commandBusy, onClick: () => onCommand(device, 'UNLOCK_INVENTORY'), children: [_jsx(LockOpen, { size: 15 }), "\u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044E"] })) : null, _jsxs("button", { type: "button", className: `is-update${isUpdated ? ' is-updated' : ''}`, disabled: isUpdated || !device.online || commandBusy, onClick: () => onCommand(device, 'UPDATE_APP'), "aria-label": isUpdated
                            ? `ТСД обновлён до версии ${installedVersion}`
                            : `Тихо обновить ТСД до версии ${latestVersion || 'актуальной'}`, children: [isUpdated
                                ? _jsx(CheckCircle2, { size: 15 })
                                : _jsx(Download, { size: 15, className: commandBusy ? 'is-spinning' : '' }), isUpdated ? 'Обновлён' : 'Тихое обновление'] }), _jsxs("button", { type: "button", disabled: !device.online || commandBusy, onClick: () => onCommand(device, 'RELOAD_REQUEST'), children: [_jsx(RefreshCw, { size: 15, className: commandBusy ? 'is-spinning' : '' }), "\u041F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443"] }), _jsxs("button", { type: "button", className: "is-danger", disabled: !device.online || commandBusy, onClick: () => onCommand(device, 'LOGOUT'), children: [_jsx(LogOut, { size: 15 }), "\u0412\u044B\u0439\u0442\u0438 \u0438\u0437 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430"] })] })] }));
}
function compareVersions(leftValue, rightValue) {
    const left = (leftValue.match(/\d+/g) ?? []).map(Number);
    const right = (rightValue.match(/\d+/g) ?? []).map(Number);
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0)
            return difference;
    }
    return 0;
}
function HistoryFilterButton({ active, onClick, label, count, tone = 'all', }) {
    return (_jsxs("button", { type: "button", className: `${active ? 'is-active ' : ''}is-${tone}`, onClick: onClick, children: [label, _jsx("span", { children: count })] }));
}
function Summary({ label, value, icon: Icon, tone = '' }) {
    return _jsxs("div", { className: tone ? `is-${tone}` : '', children: [_jsx(Icon, { size: 18 }), _jsx("span", { children: label }), _jsx("strong", { children: value })] });
}
function heartbeatProgress(device) {
    const state = device.liveState;
    const total = Number(state?.total ?? 0);
    const completed = Number(state?.completed ?? state?.accepted ?? 0);
    const remaining = Number(state?.remaining ?? Math.max(0, total - completed));
    return total > 0 ? { total, completed, remaining } : null;
}
function activityLabel(item) {
    if (!item)
        return '';
    const labels = {
        receipt_scan: 'Товар принят',
        assembly_stage: item.stage || 'Этап сборки изменён',
        box_search_scan: item.boxCode ? `Проверен короб ${item.boxCode}` : 'Проверен короб',
        move_scan: item.boxCode ? `Перемещение: ${item.boxCode}` : 'Выполнено перемещение',
        monitor_error: item.message || 'Ошибка на ТСД',
    };
    return labels[item.type] || item.message || item.stage || item.type.replaceAll('_', ' ');
}
function timeOnly(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function relativeTime(value) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 10)
        return 'только что';
    if (seconds < 60)
        return `${seconds} сек назад`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes} мин назад`;
    return `${Math.floor(minutes / 60)} ч назад`;
}
function dateTimeShort(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? '—'
        : date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function formatDuration(value) {
    if (value === null)
        return 'нет замера';
    const seconds = Math.max(0, Math.round(value));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    if (hours > 0)
        return `${hours} ч ${minutes} мин`;
    if (minutes > 0)
        return `${minutes} мин ${rest} сек`;
    return `${rest} сек`;
}
function compactStrings(values) {
    return values.filter((value) => Boolean(value && value.trim()));
}
